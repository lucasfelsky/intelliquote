import { Prisma, QuoteRequestStatus, type ForecastPurchaseDecision } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  avancarStatus,
  decidirVinculo,
  decisaoAoEntrarNaCotacao,
  decisaoAoSairDaCotacao,
  ehKg,
  quantidadeFinalNoFechamento,
  statusDaCotacao,
  type CotacaoVinculadaData,
  type VinculoForecast,
} from '../utils/forecastCotacaoVinculo';
import { candidatoDoProduto } from '../utils/forecastCandidatosCotacao';
import { itemDaListaDeCompra, paraDecisaoCompraData, type DecisaoCompraData } from '../utils/forecastDecisaoCompra';
import type { StatusCompra } from '../utils/forecastTypes';
import { HttpError } from '../utils/http';
import type { ForecastVinculoCotacaoPutInput } from '../validators/forecast';
import { AuditLogService } from './AuditLogService';
import { ForecastSnapshotService, type FrozenProduct } from './ForecastSnapshotService';

const ENTITY_TYPE = 'forecast_purchase_decision';

interface ItemVinculado {
  id: number;
  snapshotId: number;
  productId: number;
  /** Quantidade cotada (QuoteRequestItem.quantity, kg inteiro). */
  quantity: number;
}

// Envio que conta como "enviada": o evento terminou com ao menos um e-mail entregue (completed/partial).
const STATUS_ENVIO_ENTREGUE = ['completed', 'partial'];

const LIMITE_COTACOES_ABERTAS = 50;
const MSG_DECISAO_CORRIDA = 'A decisão deste item acabou de ser gravada por outra pessoa. Atualize a tela e confira.';
const MSG_DECISAO_MUDOU = 'A decisão deste item mudou durante a operação. Atualize a tela e confira.';

export interface CotacaoAbertaParaVinculo {
  id: number;
  requestCode: string;
  createdAt: string;
  listedAt: string;
  statusCotacao: 'criada' | 'enviada';
  /** Nomes distintos (tokens do portal nao revogados + respostas vivas; fornecedor vivo). */
  fornecedores: string[];
  itens: Array<{
    quoteRequestItemId: number;
    productName: string;
    quantity: number;
    unit: string;
    emKg: boolean;
    vinculo: VinculoForecast | null;
  }>;
  vinculadaAEsteItem: boolean;
  podeVincular: boolean;
  /** Por que nao pode vincular (D5: item fora de KG; ou cotacao ligada a outro produto da quinzena). */
  motivo: string | null;
}

export interface CotacoesAbertasParaVinculo {
  snapshotId: number;
  productId: number;
  cotacoes: CotacaoAbertaParaVinculo[];
}

export interface ResultadoVincular {
  acao: 'vincular' | 'trocar' | 'nenhuma';
  quoteRequestId: number;
  requestCode: string;
  itensVinculados: number;
  movidosDeOutraQuinzena: number;
  decisao: DecisaoCompraData;
}

export interface ResultadoDesvincular {
  acao: 'desvincular' | 'nenhuma';
  decisao: DecisaoCompraData | null;
}

export interface RegistroDeEnvio {
  /** Decisoes atualizadas pelo envio (itens vinculados ao Forecast que existem na cotacao). */
  atualizadas: number;
}

// Leitura e escrita do vinculo cotacao <-> Forecast (E4a). Leitura: a cotacao viva MAIS RECENTE vinculada a cada item da
// quinzena (itens e cotacoes excluidos nao contam). Escrita: o gancho do ENVIO aos fornecedores, que preenche a Qtd. final.
export class ForecastCotacaoVinculoService {
  // productId -> cotacao vinculada (a de maior id). Sem vinculo = ausente do mapa.
  static async cotacoesDosItens(
    snapshotId: number,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<Map<number, CotacaoVinculadaData>> {
    const itens = await db.quoteRequestItem.findMany({
      where: {
        forecastSnapshotId: snapshotId,
        forecastProductId: { not: null },
        deletedAt: null,
        quoteRequest: { deletedAt: null },
      },
      select: {
        forecastProductId: true,
        quoteRequest: {
          select: {
            id: true,
            requestCode: true,
            status: true,
            purchaseOrderSentAt: true,
            dispatchEvents: { where: { status: { in: STATUS_ENVIO_ENTREGUE } }, select: { id: true }, take: 1 },
          },
        },
      },
      orderBy: { quoteRequestId: 'asc' },
    });
    const mapa = new Map<number, CotacaoVinculadaData>();
    for (const item of itens) {
      if (item.forecastProductId === null) continue;
      const q = item.quoteRequest;
      // Ordem crescente: a ultima gravada no mapa e a de maior id.
      mapa.set(item.forecastProductId, {
        id: q.id,
        requestCode: q.requestCode,
        statusCotacao: statusDaCotacao({
          status: q.status === QuoteRequestStatus.closed ? 'closed' : 'open',
          purchaseOrderSentAt: q.purchaseOrderSentAt,
          enviada: q.dispatchEvents.length > 0,
        }),
      });
    }
    return mapa;
  }

  // Gancho do envio (DispatchController.create, depois de gravar o evento): para cada item da cotacao vinculado ao Forecast,
  // grava a Qtd. final = quantidade COTADA (QuoteRequestItem.quantity, kg inteiro), `finalAt` (so no 1o envio desta cotacao;
  // reenvios nao mexem na data) e `finalQuoteRequestId`, e leva o status da decisao a 'cotando' SO quando ainda e 'nao' (nunca
  // regride preco/confirmado/po). Decisao inexistente (apagada depois da criacao da cotacao) e ignorada. Tudo numa transacao
  // com AuditLog (ids, kg e status; nunca a observacao). O CHAMADOR captura qualquer erro: o envio nunca cai por causa daqui.
  static async registrarEnvio(quoteRequestId: number, userId: number | null): Promise<RegistroDeEnvio> {
    const itens = await prisma.quoteRequestItem.findMany({
      where: {
        quoteRequestId,
        deletedAt: null,
        forecastSnapshotId: { not: null },
        forecastProductId: { not: null },
      },
      select: { forecastSnapshotId: true, forecastProductId: true, quantity: true },
    });
    if (itens.length === 0) return { atualizadas: 0 };

    return prisma.$transaction(async (tx) => {
      const agora = new Date();
      let atualizadas = 0;
      for (const item of itens) {
        const snapshotId = item.forecastSnapshotId as number;
        const productId = item.forecastProductId as number;
        const atual = await tx.forecastPurchaseDecision.findUnique({
          where: { snapshotId_productId: { snapshotId, productId } },
        });
        if (!atual) continue;
        const atualizou = await ForecastCotacaoVinculoService.aplicarEnvioNaDecisao(
          tx,
          atual,
          { quoteRequestId, quantidade: item.quantity, userId, via: 'envio-cotacao' },
          agora,
        );
        if (atualizou) atualizadas += 1;
      }
      return { atualizadas };
    });
  }

  // Regra do ENVIO aplicada a UMA decisao (compartilhada por `registrarEnvio` e pelo vinculo de cotacao ja enviada): Qtd.
  // final = quantidade cotada, `finalAt` (so quando a Qtd. final passa a ser desta cotacao), `finalQuoteRequestId` e status
  // 'nao' -> 'cotando' (nunca regride os demais). Concorrencia otimista por `updatedAt`: outra pessoa gravou no meio = nao
  // sobrescreve (devolve false; a proxima leitura/envio reconcilia). Devolve true so quando gravou. Com AuditLog (`via`).
  private static async aplicarEnvioNaDecisao(
    tx: Prisma.TransactionClient,
    atual: ForecastPurchaseDecision,
    entrada: { quoteRequestId: number; quantidade: number; userId: number | null; via: string },
    agora: Date,
  ): Promise<boolean> {
    const { quoteRequestId, quantidade, userId, via } = entrada;
    const patch = decisaoAoEntrarNaCotacao(
      {
        status: atual.status as StatusCompra,
        finalKg: atual.finalKg === null ? null : Number(atual.finalKg),
        finalAt: atual.finalAt,
        finalQuoteRequestId: atual.finalQuoteRequestId,
      },
      { quoteRequestId, enviada: true, quantidadeCotada: quantidade },
      agora,
    );
    if (patch.camposAlterados.length === 0) return false;

    const resultado = await tx.forecastPurchaseDecision.updateMany({
      where: { id: atual.id, updatedAt: atual.updatedAt },
      data: {
        finalKg: patch.finalKg,
        finalAt: patch.finalAt,
        finalQuoteRequestId: patch.finalQuoteRequestId,
        status: patch.status,
        updatedAt: agora,
      },
    });
    if (resultado.count === 0) return false;
    await AuditLogService.log(
      {
        entityType: ENTITY_TYPE,
        entityId: atual.id,
        action: 'update',
        performedById: userId,
        metadata: {
          snapshotId: atual.snapshotId,
          productId: atual.productId,
          via,
          quoteRequestId,
          finalKg: quantidade,
          status: patch.status,
          camposAlterados: patch.camposAlterados,
          antes: {
            finalKg: atual.finalKg === null ? null : Number(atual.finalKg),
            finalQuoteRequestId: atual.finalQuoteRequestId,
            status: atual.status,
          },
        },
      },
      tx,
    );
    return true;
  }

  // Itens vivos da cotacao vinculados ao Forecast, agrupados por (quinzena, produto). `itemIds` entram na busca de vencedores.
  private static async itensVinculados(quoteRequestId: number): Promise<ItemVinculado[]> {
    const itens = await prisma.quoteRequestItem.findMany({
      where: {
        quoteRequestId,
        deletedAt: null,
        forecastSnapshotId: { not: null },
        forecastProductId: { not: null },
      },
      select: { id: true, forecastSnapshotId: true, forecastProductId: true, quantity: true },
      orderBy: { id: 'asc' },
    });
    return itens.map((i) => ({
      id: i.id,
      snapshotId: i.forecastSnapshotId as number,
      productId: i.forecastProductId as number,
      quantity: i.quantity,
    }));
  }

  // Trava a decisao (FOR NO KEY UPDATE) e a le: serializa o gancho com o PUT/outros ganchos sem bloquear FKs.
  private static async decisaoTravada(tx: Prisma.TransactionClient, snapshotId: number, productId: number) {
    const achada = await tx.forecastPurchaseDecision.findUnique({
      where: { snapshotId_productId: { snapshotId, productId } },
      select: { id: true },
    });
    if (!achada) return null;
    await tx.$queryRaw`SELECT id FROM "ForecastPurchaseDecision" WHERE id = ${achada.id} FOR NO KEY UPDATE`;
    return tx.forecastPurchaseDecision.findUnique({ where: { id: achada.id } });
  }

  // Gancho do FECHAMENTO (QuoteRequestController.close, depois do commit): congela a Qtd. final de cada item vinculado ao
  // Forecast = quantidade da resposta VENCEDORA do item; sem vencedor para o item, a quantidade cotada. Regra de vencedor:
  // resposta viva (`deletedAt` nulo) com `isWinner` OU a resposta de origem de uma alternativa via parceiro vencedora e nao
  // revogada; `QuoteResponseItem` indisponivel/excluido ou de quantidade <= 0 nao conta. Grava `finalKg`, `finalAt` (momento do
  // fechamento) e `finalQuoteRequestId` e avanca o status para 'confirmado' sem regredir po/preco. Refechar (apos reabrir)
  // RECALCULA e sobrescreve os mesmos campos: nao ha tabela de historico para duplicar (o AuditLog guarda o "antes"). Se uma
  // cotacao MAIS NOVA (id maior) ja e a dona da Qtd. final do item, esta nao a sobrescreve. O CHAMADOR captura qualquer erro:
  // o fechamento nunca cai por causa daqui.
  static async registrarFechamento(quoteRequestId: number, userId: number | null): Promise<RegistroDeEnvio> {
    const itens = await ForecastCotacaoVinculoService.itensVinculados(quoteRequestId);
    if (itens.length === 0) return { atualizadas: 0 };

    const respostas = await prisma.quoteResponse.findMany({
      where: {
        quoteRequestId,
        deletedAt: null,
        OR: [{ isWinner: true }, { creditSupportRequests: { some: { isWinner: true, revokedAt: null } } }],
      },
      select: {
        items: {
          where: { deletedAt: null, isUnavailable: false, quoteRequestItemId: { in: itens.map((i) => i.id) } },
          select: { quoteRequestItemId: true, quantity: true },
        },
      },
    });
    const vencedoras = new Map<number, number[]>();
    for (const resposta of respostas) {
      for (const it of resposta.items) {
        vencedoras.set(it.quoteRequestItemId, [...(vencedoras.get(it.quoteRequestItemId) ?? []), it.quantity]);
      }
    }

    // Por (quinzena, produto): soma da Qtd. final dos itens (normalmente um so item por produto na cotacao).
    const porProduto = new Map<string, { snapshotId: number; productId: number; kg: number; origem: 'vencedora' | 'cotada' }>();
    for (const item of itens) {
      const qtd = quantidadeFinalNoFechamento(item.quantity, vencedoras.get(item.id) ?? []);
      const chave = `${item.snapshotId}:${item.productId}`;
      const atual = porProduto.get(chave);
      porProduto.set(chave, {
        snapshotId: item.snapshotId,
        productId: item.productId,
        kg: (atual?.kg ?? 0) + qtd.kg,
        origem: atual?.origem === 'vencedora' || qtd.origem === 'vencedora' ? 'vencedora' : 'cotada',
      });
    }

    return prisma.$transaction(async (tx) => {
      const agora = new Date();
      let atualizadas = 0;
      for (const alvo of porProduto.values()) {
        const atual = await ForecastCotacaoVinculoService.decisaoTravada(tx, alvo.snapshotId, alvo.productId);
        if (!atual) continue;
        // Outra cotacao (mais nova) ja assumiu a Qtd. final deste item: nao sobrescreve.
        if (atual.finalQuoteRequestId !== null && atual.finalQuoteRequestId > quoteRequestId) continue;

        const novoStatus = avancarStatus(atual.status as StatusCompra, 'confirmado');
        await tx.forecastPurchaseDecision.update({
          where: { id: atual.id },
          data: { finalKg: alvo.kg, finalAt: agora, finalQuoteRequestId: quoteRequestId, status: novoStatus },
        });
        atualizadas += 1;
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: atual.id,
            action: 'update',
            performedById: userId,
            metadata: {
              snapshotId: alvo.snapshotId,
              productId: alvo.productId,
              via: 'fechamento-cotacao',
              quoteRequestId,
              finalKg: alvo.kg,
              origemQuantidade: alvo.origem,
              status: novoStatus,
              camposAlterados: ['finalKg', 'finalAt', 'finalQuoteRequestId', ...(novoStatus !== atual.status ? ['status'] : [])],
              antes: {
                finalKg: atual.finalKg === null ? null : Number(atual.finalKg),
                finalQuoteRequestId: atual.finalQuoteRequestId,
                status: atual.status,
              },
            },
          },
          tx,
        );
      }
      return { atualizadas };
    });
  }

  // Gancho da PO ENVIADA (PurchaseOrderEmailService, depois de marcar `purchaseOrderSentAt`): leva a decisao de cada item
  // vinculado ao Forecast dessa cotacao a 'po' (sem regredir 'preco'). So o status: a quantidade nao muda. Idempotente: se ja
  // esta em 'po'/'preco' nao grava nada. Mesma guarda de "cotacao mais nova e dona do item" do fechamento. O CHAMADOR captura
  // qualquer erro: o envio da PO nunca cai por causa daqui.
  static async registrarPoEnviada(
    quoteRequestId: number,
    userId: number | null,
    quoteResponseId?: number | null,
  ): Promise<RegistroDeEnvio> {
    let itens = await ForecastCotacaoVinculoService.itensVinculados(quoteRequestId);
    if (itens.length === 0) return { atualizadas: 0 };
    // PO a uma proposta/fornecedor especifico (pode cobrir so parte dos itens): so conta o item que essa proposta cobre
    // (resposta viva, item vivo, disponivel e de quantidade > 0). Sem a proposta informada, valem todos os itens vinculados.
    if (quoteResponseId) {
      const cobertos = await prisma.quoteResponseItem.findMany({
        where: {
          quoteResponseId,
          deletedAt: null,
          isUnavailable: false,
          quantity: { gt: 0 },
          quoteResponse: { quoteRequestId, deletedAt: null },
          quoteRequestItemId: { in: itens.map((i) => i.id) },
        },
        select: { quoteRequestItemId: true },
      });
      const idsCobertos = new Set(cobertos.map((c) => c.quoteRequestItemId));
      itens = itens.filter((i) => idsCobertos.has(i.id));
      if (itens.length === 0) return { atualizadas: 0 };
    }
    const chaves = new Map(itens.map((i) => [`${i.snapshotId}:${i.productId}`, i]));

    return prisma.$transaction(async (tx) => {
      let atualizadas = 0;
      for (const alvo of chaves.values()) {
        const atual = await ForecastCotacaoVinculoService.decisaoTravada(tx, alvo.snapshotId, alvo.productId);
        if (!atual) continue;
        if (atual.finalQuoteRequestId !== null && atual.finalQuoteRequestId > quoteRequestId) continue;

        const novoStatus = avancarStatus(atual.status as StatusCompra, 'po');
        if (novoStatus === atual.status) continue;
        await tx.forecastPurchaseDecision.update({ where: { id: atual.id }, data: { status: novoStatus } });
        atualizadas += 1;
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: atual.id,
            action: 'update',
            performedById: userId,
            metadata: {
              snapshotId: alvo.snapshotId,
              productId: alvo.productId,
              via: 'po-enviada',
              quoteRequestId,
              status: novoStatus,
              camposAlterados: ['status'],
              antes: { status: atual.status },
            },
          },
          tx,
        );
      }
      return { atualizadas };
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Vincular cotacao EXISTENTE a um item do Forecast (PR2). Reaproveita o vinculo de E4a (`forecastSnapshotId`/
  // `forecastProductId` do item da cotacao) e a decisao de compra. Gravacao so admin/comprador (rota); AuditLog em tudo.

  // Itens de catalogo de QUALQUER embalagem do produto (D6): o casamento nao se limita ao `codigoParaCotacao`.
  private static async catalogoDoProduto(
    productId: number,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<number[]> {
    const codigos = await db.forecastProductCode.findMany({
      where: { productId, catalogItemId: { not: null } },
      select: { catalogItemId: true },
    });
    return [...new Set(codigos.flatMap((c) => (c.catalogItemId !== null ? [c.catalogItemId] : [])))];
  }

  private static async quinzenaDoProduto(snapshotId: number, productId: number) {
    const snapshot = await prisma.forecastSnapshot.findFirst({
      where: { id: snapshotId, deletedAt: null },
      select: { id: true, label: true, products: true },
    });
    if (!snapshot) throw new HttpError(404, 'Quinzena nao encontrada.');
    const produtos = snapshot.products as unknown as FrozenProduct[];
    if (!produtos.some((p) => p.productId === productId)) {
      throw new HttpError(400, `Produto fora desta quinzena: ${productId}.`);
    }
    return snapshot;
  }

  // Cotacoes ABERTAS e vivas que contem o produto (qualquer embalagem vinculada ao catalogo), para o modal "Vincular
  // cotacao". `podeVincular`/`motivo` seguem `decidirVinculo` com `substituir: true` (a lista nao bloqueia por troca; o PUT
  // decide). So leitura: sem AuditLog.
  static async cotacoesAbertasDoProduto(snapshotId: number, productId: number): Promise<CotacoesAbertasParaVinculo> {
    await ForecastCotacaoVinculoService.quinzenaDoProduto(snapshotId, productId);
    const catalogo = await ForecastCotacaoVinculoService.catalogoDoProduto(productId);
    if (catalogo.length === 0) return { snapshotId, productId, cotacoes: [] };

    const itensWhere = { deletedAt: null, catalogItemId: { in: catalogo } };
    const linhas = await prisma.quoteRequest.findMany({
      where: { status: QuoteRequestStatus.open, deletedAt: null, items: { some: itensWhere } },
      orderBy: [{ listedAt: 'desc' }, { id: 'desc' }],
      take: LIMITE_COTACOES_ABERTAS,
      select: {
        id: true,
        requestCode: true,
        createdAt: true,
        listedAt: true,
        items: {
          where: itensWhere,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            productName: true,
            quantity: true,
            unit: true,
            forecastSnapshotId: true,
            forecastProductId: true,
          },
        },
        dispatchEvents: { where: { status: { in: STATUS_ENVIO_ENTREGUE } }, select: { id: true }, take: 1 },
        portalTokens: {
          where: { revokedAt: null, supplier: { deletedAt: null } },
          select: { supplier: { select: { name: true } } },
        },
        quoteResponses: {
          where: { deletedAt: null, supplier: { deletedAt: null } },
          select: { supplier: { select: { name: true } } },
        },
      },
    });

    const cotacoes = linhas.map((q): CotacaoAbertaParaVinculo => {
      const itens = q.items.map((i) => ({
        quoteRequestItemId: i.id,
        productName: i.productName,
        quantity: i.quantity,
        unit: i.unit,
        emKg: ehKg(i.unit),
        vinculo:
          i.forecastSnapshotId !== null && i.forecastProductId !== null
            ? { snapshotId: i.forecastSnapshotId, productId: i.forecastProductId }
            : null,
      }));
      const decisao = decidirVinculo({
        snapshotId,
        productId,
        quoteRequestId: q.id,
        requestCode: q.requestCode,
        cotacaoAberta: true,
        itensDoProduto: itens.map((i) => ({ id: i.quoteRequestItemId, unit: i.unit, quantity: i.quantity, vinculo: i.vinculo })),
        outraAbertaLigada: null,
        substituir: true,
      });
      const nomes = new Set<string>();
      for (const t of q.portalTokens) nomes.add(t.supplier.name);
      for (const r of q.quoteResponses) nomes.add(r.supplier.name);
      return {
        id: q.id,
        requestCode: q.requestCode,
        createdAt: q.createdAt.toISOString(),
        listedAt: q.listedAt.toISOString(),
        statusCotacao: q.dispatchEvents.length > 0 ? 'enviada' : 'criada',
        fornecedores: [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        itens,
        vinculadaAEsteItem: itens.some((i) => i.vinculo?.snapshotId === snapshotId && i.vinculo.productId === productId),
        podeVincular: decisao.tipo === 'vincular' || decisao.tipo === 'trocar',
        motivo: decisao.tipo === 'erro' ? decisao.motivo : null,
      };
    });
    return { snapshotId, productId, cotacoes };
  }

  // Referencia da quinzena para a decisao CRIADA pelo vinculo (D3, mesma regra do lote): item da lista -> `quantidadeFinal`/
  // `demanda`, `manual: false`; fora da lista e candidato -> `quantidadeSugeridaKg ?? 0`/`anMotorKg`, `manual: true`; nenhum
  // dos dois -> 400.
  private static async referenciaDaQuinzena(snapshotId: number, productId: number) {
    const { relatorio, resultado } = await ForecastSnapshotService.getListaECandidatos(snapshotId);
    const naLista = itemDaListaDeCompra(relatorio, productId);
    if (naLista) return { sugeridaKg: naLista.quantidadeFinal, demandaKg: naLista.demanda, manual: false };
    const candidato = candidatoDoProduto(resultado, productId);
    if (!candidato) {
      throw new HttpError(
        400,
        'O item não está na lista de compra desta quinzena nem é candidato a cotação (fora da lista e sem demanda, sem fonte ou sem lead time).',
      );
    }
    return { sugeridaKg: candidato.quantidadeSugeridaKg ?? 0, demandaKg: candidato.anMotorKg, manual: true };
  }

  // Liga a cotacao ABERTA existente ao item (quinzena + produto) numa transacao: trava a quinzena (serializa com "Cotar"
  // do lote) e a cotacao; liga os itens KG do produto; cria a decisao se nao houver (quantidade = a COTADA); cotacao ja
  // enviada aplica a regra do envio; na TROCA solta a(s) cotacao(oes) aberta(s) anterior(es) (so com `substituir`), com a
  // saida do status/Qtd. final (D2). Item ligado a OUTRA quinzena e MOVIDO (D1); a decisao antiga nao e alterada.
  static async vincular(
    snapshotId: number,
    productId: number,
    input: ForecastVinculoCotacaoPutInput,
    userId: number,
  ): Promise<ResultadoVincular> {
    const { quoteRequestId } = input;
    const substituir = input.substituir === true;
    const snapshot = await ForecastCotacaoVinculoService.quinzenaDoProduto(snapshotId, productId);

    // A referencia (cara: roda o motor) so e resolvida quando a decisao ainda nao existe.
    const decisaoExistente = await prisma.forecastPurchaseDecision.findUnique({
      where: { snapshotId_productId: { snapshotId, productId } },
      select: { id: true },
    });
    const referencia = decisaoExistente ? null : await ForecastCotacaoVinculoService.referenciaDaQuinzena(snapshotId, productId);

    try {
      return await prisma.$transaction(
        async (tx) => {
          // Mesma trava do lote: serializa vinculo e "Cotar" da mesma quinzena. Ordem de travas: quinzena -> cotacao -> decisao.
          await tx.$queryRaw`SELECT id FROM "ForecastSnapshot" WHERE id = ${snapshotId} FOR NO KEY UPDATE`;
          const viva = await tx.forecastSnapshot.findFirst({ where: { id: snapshotId, deletedAt: null }, select: { id: true } });
          if (!viva) throw new HttpError(404, 'Quinzena nao encontrada.');

          await tx.$queryRaw`SELECT id FROM "QuoteRequest" WHERE id = ${quoteRequestId} FOR NO KEY UPDATE`;
          const cotacao = await tx.quoteRequest.findFirst({
            where: { id: quoteRequestId, deletedAt: null },
            select: {
              id: true,
              requestCode: true,
              status: true,
              dispatchEvents: { where: { status: { in: STATUS_ENVIO_ENTREGUE } }, select: { id: true }, take: 1 },
            },
          });
          if (!cotacao) throw new HttpError(404, 'Cotação não encontrada.');
          const enviada = cotacao.dispatchEvents.length > 0;

          const catalogo = await ForecastCotacaoVinculoService.catalogoDoProduto(productId, tx);
          const itens = catalogo.length
            ? await tx.quoteRequestItem.findMany({
                where: { quoteRequestId, deletedAt: null, catalogItemId: { in: catalogo } },
                orderBy: { id: 'asc' },
                select: { id: true, unit: true, quantity: true, forecastSnapshotId: true, forecastProductId: true },
              })
            : [];

          // Itens de OUTRAS cotacoes abertas e vivas ja ligadas a este (quinzena, produto) (a de maior id e a "outra ligada").
          const itensDeOutras = await tx.quoteRequestItem.findMany({
            where: {
              forecastSnapshotId: snapshotId,
              forecastProductId: productId,
              deletedAt: null,
              quoteRequestId: { not: quoteRequestId },
              quoteRequest: { deletedAt: null, status: QuoteRequestStatus.open },
            },
            orderBy: { id: 'asc' },
            select: { id: true, quoteRequestId: true, quoteRequest: { select: { requestCode: true } } },
          });
          const maisNova = itensDeOutras.reduce<(typeof itensDeOutras)[number] | null>(
            (acc, i) => (acc === null || i.quoteRequestId > acc.quoteRequestId ? i : acc),
            null,
          );

          const decidido = decidirVinculo({
            snapshotId,
            productId,
            quoteRequestId,
            requestCode: cotacao.requestCode,
            cotacaoAberta: cotacao.status === QuoteRequestStatus.open,
            itensDoProduto: itens.map((i) => ({
              id: i.id,
              unit: i.unit,
              quantity: i.quantity,
              vinculo:
                i.forecastSnapshotId !== null && i.forecastProductId !== null
                  ? { snapshotId: i.forecastSnapshotId, productId: i.forecastProductId }
                  : null,
            })),
            outraAbertaLigada: maisNova ? { id: maisNova.quoteRequestId, requestCode: maisNova.quoteRequest.requestCode } : null,
            substituir,
          });
          if (decidido.tipo === 'erro') throw new HttpError(decidido.status, decidido.motivo);

          let decisao = await ForecastCotacaoVinculoService.decisaoTravada(tx, snapshotId, productId);
          if (decidido.tipo === 'nenhuma' && decisao) {
            return {
              acao: 'nenhuma' as const,
              quoteRequestId,
              requestCode: cotacao.requestCode,
              itensVinculados: 0,
              movidosDeOutraQuinzena: 0,
              decisao: paraDecisaoCompraData(decisao),
            };
          }

          // 'nenhuma' sem decisao (apagada depois do vinculo): so recria a decisao com a quantidade cotada.
          const ligar = decidido.tipo === 'nenhuma' ? [] : decidido.ligar;
          const mover = decidido.tipo === 'nenhuma' ? [] : decidido.mover;
          const quantidadeCotada =
            decidido.tipo === 'nenhuma'
              ? itens.filter((i) => ehKg(i.unit)).reduce((soma, i) => soma + i.quantity, 0)
              : decidido.quantidadeCotada;
          const trocar = decidido.tipo === 'trocar';

          // TROCA: solta os itens das outras cotacoes abertas ligadas a este item.
          const antigasIds = [...new Set(itensDeOutras.map((i) => i.quoteRequestId))].sort((a, b) => a - b);
          if (trocar) {
            await tx.quoteRequestItem.updateMany({
              where: { id: { in: itensDeOutras.map((i) => i.id) } },
              data: { forecastSnapshotId: null, forecastProductId: null },
            });
            for (const solto of itensDeOutras) {
              await AuditLogService.log(
                {
                  entityType: 'quote_request_item',
                  entityId: solto.id,
                  action: 'update',
                  performedById: userId,
                  metadata: {
                    via: 'forecast-vincular',
                    operacao: 'trocar-saida',
                    quoteRequestId: solto.quoteRequestId,
                    antes: { snapshotId, productId },
                    depois: null,
                  },
                },
                tx,
              );
            }
          }

          // Liga os itens KG da cotacao; os movidos de outra quinzena registram o vinculo anterior (D1).
          const operacao = trocar ? 'trocar' : 'vincular';
          if (ligar.length > 0) {
            await tx.quoteRequestItem.updateMany({
              where: { id: { in: ligar } },
              data: { forecastSnapshotId: snapshotId, forecastProductId: productId },
            });
            const anteriores = new Map<number, VinculoForecast>(mover.map((m) => [m.itemId, m.de] as const));
            for (const itemId of ligar) {
              await AuditLogService.log(
                {
                  entityType: 'quote_request_item',
                  entityId: itemId,
                  action: 'update',
                  performedById: userId,
                  metadata: {
                    via: 'forecast-vincular',
                    operacao,
                    quoteRequestId,
                    antes: anteriores.get(itemId) ?? null,
                    depois: { snapshotId, productId },
                  },
                },
                tx,
              );
            }
          }

          if (!decisao) {
            // D3: a decisao nasce com a quantidade JA COTADA; sugerida/demanda/manual vem da referencia da quinzena.
            if (!referencia) throw new HttpError(409, MSG_DECISAO_MUDOU);
            decisao = await tx.forecastPurchaseDecision.create({
              data: {
                snapshotId,
                productId,
                quantityKg: quantidadeCotada,
                status: 'nao',
                suggestedKg: referencia.sugeridaKg,
                demandKg: referencia.demandaKg,
                manuallyIncluded: referencia.manual,
                decidedById: userId,
              },
            });
            await AuditLogService.log(
              {
                entityType: ENTITY_TYPE,
                entityId: decisao.id,
                action: 'create',
                performedById: userId,
                metadata: {
                  snapshotId,
                  productId,
                  label: snapshot.label,
                  via: 'forecast-vincular',
                  quoteRequestId,
                  quantidadeKg: quantidadeCotada,
                  sugeridaKg: referencia.sugeridaKg,
                  demandaKg: referencia.demandaKg,
                  status: decisao.status,
                  comObservacao: false,
                  ...(referencia.manual ? { incluidoManualmente: true } : {}),
                },
              },
              tx,
            );
          } else if (trocar) {
            // Saida da(s) cotacao(oes) antiga(s): Qtd. final zerada se veio de uma delas; o status so volta a 'nao' se nao sobra
            // outra cotacao ativa (a NOVA conta como ativa so se ja foi enviada: o status passa a seguir o envio dela).
            const ficaComOutraAtiva =
              enviada ||
              (await tx.quoteRequestItem.count({
                where: {
                  forecastSnapshotId: snapshotId,
                  forecastProductId: productId,
                  deletedAt: null,
                  quoteRequestId: { not: quoteRequestId },
                  quoteRequest: { deletedAt: null },
                },
              })) > 0;
            const { status, zerarFinal } = efeitoDeSair(decisao, antigasIds, ficaComOutraAtiva);
            decisao = await ForecastCotacaoVinculoService.gravarSaida(tx, decisao, status, zerarFinal, {
              via: 'forecast-vincular',
              operacao: 'trocar',
              quoteRequestId: antigasIds[antigasIds.length - 1] ?? null,
              userId,
            });
          }

          // Cotacao ja enviada: a decisao segue a regra do envio (D4).
          if (enviada) {
            await ForecastCotacaoVinculoService.aplicarEnvioNaDecisao(
              tx,
              decisao,
              { quoteRequestId, quantidade: quantidadeCotada, userId, via: 'forecast-vincular' },
              new Date(),
            );
          }

          const final = await tx.forecastPurchaseDecision.findUnique({ where: { id: decisao.id } });
          if (!final) throw new HttpError(409, MSG_DECISAO_MUDOU);
          return {
            acao: (trocar ? 'trocar' : 'vincular') as 'vincular' | 'trocar',
            quoteRequestId,
            requestCode: cotacao.requestCode,
            itensVinculados: ligar.length,
            movidosDeOutraQuinzena: mover.length,
            decisao: paraDecisaoCompraData(final),
          };
        },
        { maxWait: 10_000, timeout: 60_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, MSG_DECISAO_CORRIDA);
      }
      throw error;
    }
  }

  // Grava o efeito de SAIR de uma cotacao na decisao ja travada (zerar Qtd. final e/ou voltar o status). Nada a mudar =
  // devolve a mesma decisao. Concorrencia otimista por `updatedAt` (409). AuditLog so com ids, kg e status.
  private static async gravarSaida(
    tx: Prisma.TransactionClient,
    atual: ForecastPurchaseDecision,
    novoStatus: StatusCompra,
    zerarFinal: boolean,
    ctx: { via: string; operacao: string; quoteRequestId: number | null; userId: number },
  ): Promise<ForecastPurchaseDecision> {
    const camposAlterados = [
      ...(zerarFinal ? ['finalKg', 'finalAt', 'finalQuoteRequestId'] : []),
      ...(novoStatus !== atual.status ? ['status'] : []),
    ];
    if (camposAlterados.length === 0) return atual;

    const resultado = await tx.forecastPurchaseDecision.updateMany({
      where: { id: atual.id, updatedAt: atual.updatedAt },
      data: {
        status: novoStatus,
        ...(zerarFinal ? { finalKg: null, finalAt: null, finalQuoteRequestId: null } : {}),
        updatedAt: new Date(),
      },
    });
    if (resultado.count === 0) throw new HttpError(409, MSG_DECISAO_CORRIDA);
    await AuditLogService.log(
      {
        entityType: ENTITY_TYPE,
        entityId: atual.id,
        action: 'update',
        performedById: ctx.userId,
        metadata: {
          snapshotId: atual.snapshotId,
          productId: atual.productId,
          via: ctx.via,
          operacao: ctx.operacao,
          quoteRequestId: ctx.quoteRequestId,
          status: novoStatus,
          camposAlterados,
          antes: {
            finalKg: atual.finalKg === null ? null : Number(atual.finalKg),
            finalQuoteRequestId: atual.finalQuoteRequestId,
            status: atual.status,
          },
        },
      },
      tx,
    );
    const depois = await tx.forecastPurchaseDecision.findUnique({ where: { id: atual.id } });
    if (!depois) throw new HttpError(409, MSG_DECISAO_MUDOU);
    return depois;
  }

  // Desfaz o vinculo das cotacoes ABERTAS ligadas ao item. Cotacao fechada ligada nao se desliga (409); nada ligado =
  // `nenhuma` (idempotente). Ao sair: Qtd. final zerada se veio da cotacao solta e status 'cotando' -> 'nao' se nao sobra
  // outra cotacao viva ligada (D2: unica excecao a "nunca regride").
  static async desvincular(snapshotId: number, productId: number, userId: number): Promise<ResultadoDesvincular> {
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ForecastSnapshot" WHERE id = ${snapshotId} FOR NO KEY UPDATE`;
        const viva = await tx.forecastSnapshot.findFirst({ where: { id: snapshotId, deletedAt: null }, select: { id: true } });
        if (!viva) throw new HttpError(404, 'Quinzena nao encontrada.');

        const ligados = await tx.quoteRequestItem.findMany({
          where: {
            forecastSnapshotId: snapshotId,
            forecastProductId: productId,
            deletedAt: null,
            quoteRequest: { deletedAt: null },
          },
          orderBy: { id: 'asc' },
          select: { id: true, quoteRequestId: true, quoteRequest: { select: { requestCode: true, status: true } } },
        });
        if (ligados.length === 0) {
          const d = await tx.forecastPurchaseDecision.findUnique({ where: { snapshotId_productId: { snapshotId, productId } } });
          return { acao: 'nenhuma' as const, decisao: d ? paraDecisaoCompraData(d) : null };
        }

        const abertos = ligados.filter((i) => i.quoteRequest.status === QuoteRequestStatus.open);
        if (abertos.length === 0) {
          throw new HttpError(409, `A cotação ${ligados[0].quoteRequest.requestCode} está fechada; o vínculo não pode ser desfeito.`);
        }
        const cotacoesAbertas = [...new Set(abertos.map((i) => i.quoteRequestId))].sort((a, b) => a - b);
        for (const id of cotacoesAbertas) {
          await tx.$queryRaw`SELECT id FROM "QuoteRequest" WHERE id = ${id} FOR NO KEY UPDATE`;
        }

        await tx.quoteRequestItem.updateMany({
          where: { id: { in: abertos.map((i) => i.id) } },
          data: { forecastSnapshotId: null, forecastProductId: null },
        });
        for (const item of abertos) {
          await AuditLogService.log(
            {
              entityType: 'quote_request_item',
              entityId: item.id,
              action: 'update',
              performedById: userId,
              metadata: {
                via: 'forecast-vincular',
                operacao: 'desvincular',
                quoteRequestId: item.quoteRequestId,
                antes: { snapshotId, productId },
                depois: null,
              },
            },
            tx,
          );
        }

        // Sobra item vivo ligado em cotacao viva (inclusive fechada)? Entao o status nao regride.
        const ficaComOutraAtiva =
          (await tx.quoteRequestItem.count({
            where: { forecastSnapshotId: snapshotId, forecastProductId: productId, deletedAt: null, quoteRequest: { deletedAt: null } },
          })) > 0;

        const atual = await ForecastCotacaoVinculoService.decisaoTravada(tx, snapshotId, productId);
        if (!atual) return { acao: 'desvincular' as const, decisao: null };
        const { status, zerarFinal } = efeitoDeSair(atual, cotacoesAbertas, ficaComOutraAtiva);
        const depois = await ForecastCotacaoVinculoService.gravarSaida(tx, atual, status, zerarFinal, {
          via: 'forecast-desvincular',
          operacao: 'desvincular',
          quoteRequestId: cotacoesAbertas[cotacoesAbertas.length - 1] ?? null,
          userId,
        });
        return { acao: 'desvincular' as const, decisao: paraDecisaoCompraData(depois) };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }
}

// Aplica `decisaoAoSairDaCotacao` a cada cotacao solta, em sequencia (a Qtd. final zerada por uma nao e comparada de novo).
function efeitoDeSair(
  atual: ForecastPurchaseDecision,
  cotacoesSoltas: readonly number[],
  ficaComOutraAtiva: boolean,
): { status: StatusCompra; zerarFinal: boolean } {
  const corrente = { status: atual.status as StatusCompra, finalQuoteRequestId: atual.finalQuoteRequestId };
  let zerarFinal = false;
  for (const id of cotacoesSoltas) {
    const efeito = decisaoAoSairDaCotacao(corrente, id, ficaComOutraAtiva);
    zerarFinal = zerarFinal || efeito.zerarFinal;
    corrente.status = efeito.status;
    if (efeito.zerarFinal) corrente.finalQuoteRequestId = null;
  }
  return { status: corrente.status, zerarFinal };
}
