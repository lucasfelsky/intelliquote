import { Prisma, QuoteRequestStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  avancarStatus,
  quantidadeFinalNoFechamento,
  statusDaCotacao,
  type CotacaoVinculadaData,
} from '../utils/forecastCotacaoVinculo';
import type { StatusCompra } from '../utils/forecastTypes';
import { AuditLogService } from './AuditLogService';

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

        const primeiroEnvio = atual.finalQuoteRequestId !== quoteRequestId || atual.finalAt === null;
        const novoStatus = atual.status === 'nao' ? 'cotando' : atual.status;
        const mudou =
          primeiroEnvio ||
          Number(atual.finalKg ?? Number.NaN) !== item.quantity ||
          novoStatus !== atual.status;
        if (!mudou) continue;

        const resultado = await tx.forecastPurchaseDecision.updateMany({
          where: { id: atual.id, updatedAt: atual.updatedAt },
          data: {
            finalKg: item.quantity,
            finalAt: primeiroEnvio ? agora : atual.finalAt,
            finalQuoteRequestId: quoteRequestId,
            status: novoStatus,
            updatedAt: agora,
          },
        });
        // Outra pessoa gravou a decisao no meio: nao sobrescreve; a proxima leitura/envio reconcilia.
        if (resultado.count === 0) continue;
        atualizadas += 1;
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: atual.id,
            action: 'update',
            performedById: userId,
            metadata: {
              snapshotId,
              productId,
              via: 'envio-cotacao',
              quoteRequestId,
              finalKg: item.quantity,
              status: novoStatus,
              camposAlterados: ['finalKg', ...(primeiroEnvio ? ['finalAt'] : []), 'finalQuoteRequestId', ...(novoStatus !== atual.status ? ['status'] : [])],
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
}
