import { Prisma, QuoteRequestStatus, type Incoterm } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  chaveFonte,
  codigoParaCotacao,
  INT_MAX,
  kgInteiroParaCima,
  MOTIVO_ACIMA_LIMITE,
  MOTIVO_SEM_FONTE,
  MOTIVO_SEM_VINCULO,
} from '../utils/forecastCotacaoVinculo';
import { itemDaListaDeCompra } from '../utils/forecastDecisaoCompra';
import { candidatoDoProduto } from '../utils/forecastCandidatosCotacao';
import { HttpError } from '../utils/http';
import { buildRequestCode } from '../utils/requestCode';
import type { ForecastCotacoesLotePostInput } from '../validators/forecast';
import { AuditLogService } from './AuditLogService';
import { ForecastSnapshotService, type FrozenProduct } from './ForecastSnapshotService';
import { buildQuoteRequestItemCreateData } from './QuoteRequestItemFactory';

const ENTITY_DECISAO = 'forecast_purchase_decision';
const MAX_PROBLEMAS_NA_MENSAGEM = 5;

const MSG_CORRIDA =
  'A quantidade decidida de um dos itens acabou de ser gravada por outra pessoa. Atualize a tela e confira.';

type ItemDoLote = ForecastCotacoesLotePostInput['itens'][number];

export interface CotacaoCriadaItem {
  productId: number;
  item: string;
  catalogItemId: number;
  /** Codigo do Forecast que originou o item do catalogo (embalagem principal, senao o 1o vinculado). */
  codigo: string;
  /** Quantidade COTADA, em kg inteiro (para cima). */
  quantidadeKg: number;
  quoteRequestItemId: number;
}

export interface CotacaoCriada {
  id: number;
  requestCode: string;
  fonte: string;
  itens: CotacaoCriadaItem[];
}

export interface ForecastCotacoesLoteCriadas {
  snapshotId: number;
  label: string;
  cotacoes: CotacaoCriada[];
}

interface Referencia {
  sugeridaKg: number;
  demandaKg: number;
  manual: boolean;
}

interface ItemResolvido {
  entrada: ItemDoLote;
  nome: string;
  fonte: string;
  referencia: Referencia;
  catalogItemId: number;
  catalogCommercialName: string;
  codigo: string;
  quantidadeCotada: number;
}

interface Problema {
  status: 400 | 409;
  texto: string;
}

function corrida(): HttpError {
  return new HttpError(409, MSG_CORRIDA);
}

function naoEncontrada(): HttpError {
  return new HttpError(404, 'Quinzena nao encontrada.');
}

// Cria UMA cotacao POR FONTE, numa unica transacao, a partir dos itens decididos no pop-up "Criar cotacao" (E4a). Cada item
// da cotacao nasce vinculado ao Forecast (`forecastSnapshotId`/`forecastProductId`) e a decisao do item e gravada na mesma
// transacao (criada ou atualizada; `manuallyIncluded` para item de fora da lista, regra da E3). Qualquer item sem fonte, sem
// codigo vinculado ao catalogo, com item de catalogo inativo, fora da lista sem inclusao explicita ou ja presente em
// cotacao aberta recusa o lote INTEIRO (nada e gravado). O AuditLog guarda so ids, contagens, rotulo da quinzena e fonte:
// nunca a observacao (texto livre, que fica so na decisao e jamais chega ao fornecedor). Escolha dos fornecedores e envio
// continuam na pagina da cotacao.
export class ForecastCotacaoLoteService {
  static async criar(
    snapshotId: number,
    input: ForecastCotacoesLotePostInput,
    userId: number,
  ): Promise<ForecastCotacoesLoteCriadas> {
    const snapshot = await prisma.forecastSnapshot.findFirst({
      where: { id: snapshotId, deletedAt: null },
      select: { id: true, label: true, products: true },
    });
    if (!snapshot) throw naoEncontrada();
    const label = snapshot.label;
    const produtos = (snapshot.products as unknown as FrozenProduct[]).filter(
      (p): p is FrozenProduct & { productId: number } => typeof p.productId === 'number',
    );
    const nomePorProduto = new Map(produtos.map((p) => [p.productId, p.item] as const));
    const fora = input.itens.map((i) => i.productId).filter((id) => !nomePorProduto.has(id));
    if (fora.length > 0) {
      throw new HttpError(400, `Produto fora desta quinzena: ${fora.join(', ')}.`);
    }

    const resolvidos = await resolverItens(snapshotId, input.itens, nomePorProduto);

    // Uma cotacao por fonte, na ordem em que a fonte aparece no lote.
    const porFonte = new Map<string, { fonte: string; itens: ItemResolvido[] }>();
    for (const r of resolvidos) {
      const chave = chaveFonte(r.fonte);
      const grupo = porFonte.get(chave);
      if (grupo) grupo.itens.push(r);
      else porFonte.set(chave, { fonte: r.fonte.trim(), itens: [r] });
    }

    const incoterms: Incoterm[] = input.desiredIncoterm ?? ['FOB'];
    const prazo = input.deadlineAt ? new Date(input.deadlineAt) : null;

    try {
      return await prisma.$transaction(
        async (tx) => {
          // Serializa lotes da mesma quinzena (mesmo padrao de lockCommercialRequests: FOR NO KEY UPDATE nao bloqueia as FKs
          // filhas), para a checagem de item ja cotado e a criacao nao correrem juntas.
          await tx.$queryRaw`SELECT id FROM "ForecastSnapshot" WHERE id = ${snapshotId} FOR NO KEY UPDATE`;
          const viva = await tx.forecastSnapshot.findFirst({
            where: { id: snapshotId, deletedAt: null },
            select: { id: true },
          });
          if (!viva) throw naoEncontrada();

          const jaCotados = await tx.quoteRequestItem.findMany({
            where: {
              forecastSnapshotId: snapshotId,
              forecastProductId: { in: resolvidos.map((r) => r.entrada.productId) },
              deletedAt: null,
              quoteRequest: { deletedAt: null, status: QuoteRequestStatus.open },
            },
            select: { forecastProductId: true, quoteRequest: { select: { requestCode: true } } },
          });
          if (jaCotados.length > 0) {
            const textos = jaCotados
              .slice(0, MAX_PROBLEMAS_NA_MENSAGEM)
              .map((j) => `${nomePorProduto.get(j.forecastProductId as number) ?? j.forecastProductId}: já está na cotação aberta ${j.quoteRequest.requestCode}.`);
            throw new HttpError(409, mensagemDoLote(textos, jaCotados.length));
          }

          // Decisoes primeiro (na ordem do lote); a de cada item e criada/atualizada com a mesma regra do PUT de decisao.
          for (const r of resolvidos) {
            await gravarDecisao(tx, snapshotId, label, r, userId);
          }

          const cotacoes: CotacaoCriada[] = [];
          for (const grupo of porFonte.values()) {
            const quote = await tx.quoteRequest.create({
              data: {
                requestCode: buildRequestCode(),
                description: `Forecast ${label}`,
                desiredIncoterm: incoterms,
                destinationPort: input.destinationPort ?? null,
                originPort: input.originPort ?? 'Shanghai',
                currency: input.currency ?? 'USD',
                deadlineAt: prazo,
                status: QuoteRequestStatus.open,
                createdById: userId,
              },
            });
            await AuditLogService.log(
              {
                entityType: 'quote_request',
                entityId: quote.id,
                action: 'create',
                performedById: userId,
                afterData: { ...quote, items: [], quoteResponses: [] },
                metadata: {
                  via: 'forecast-cotacoes-lote',
                  forecastSnapshotId: snapshotId,
                  forecastLabel: label,
                  fonte: grupo.fonte,
                  totalItens: grupo.itens.length,
                  totalCotacoesDoLote: porFonte.size,
                },
              },
              tx,
            );

            const itens: CotacaoCriadaItem[] = [];
            for (const r of grupo.itens) {
              const criado = await tx.quoteRequestItem.create({
                data: {
                  ...buildQuoteRequestItemCreateData({
                    quoteRequestId: quote.id,
                    catalogItemId: r.catalogItemId,
                    catalogCommercialName: r.catalogCommercialName,
                    quantity: r.quantidadeCotada,
                    unit: 'KG',
                    quoteDestinationPort: quote.destinationPort,
                  }),
                  forecastSnapshotId: snapshotId,
                  forecastProductId: r.entrada.productId,
                },
                select: { id: true, catalogItemId: true, productName: true, quantity: true, unit: true },
              });
              await AuditLogService.log(
                {
                  entityType: 'quote_request_item',
                  entityId: criado.id,
                  action: 'create',
                  performedById: userId,
                  afterData: criado,
                  metadata: {
                    quoteRequestId: quote.id,
                    catalogItemId: r.catalogItemId,
                    forecastSnapshotId: snapshotId,
                    forecastProductId: r.entrada.productId,
                  },
                },
                tx,
              );
              itens.push({
                productId: r.entrada.productId,
                item: r.nome,
                catalogItemId: r.catalogItemId,
                codigo: r.codigo,
                quantidadeKg: r.quantidadeCotada,
                quoteRequestItemId: criado.id,
              });
            }
            cotacoes.push({ id: quote.id, requestCode: quote.requestCode, fonte: grupo.fonte, itens });
          }
          return { snapshotId, label, cotacoes };
        },
        { maxWait: 10_000, timeout: 60_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const alvo = String((error.meta as { target?: unknown } | undefined)?.target ?? '');
        if (alvo.includes('requestCode')) {
          throw new HttpError(409, 'Conflito ao gerar o código da cotação. Tente novamente.');
        }
        throw corrida();
      }
      throw error;
    }
  }
}

function mensagemDoLote(textos: string[], total: number): string {
  const resto = total > textos.length ? ` (e mais ${total - textos.length})` : '';
  return `Não foi possível gerar as cotações. ${textos.join(' ')}${resto}`;
}

// Resolve fonte, referencia congelavel, codigo e item de catalogo de cada item, juntando TODOS os problemas (o lote e
// recusado inteiro, com a lista dos motivos). Item da lista de compra usa a fonte do grupo; item de fora da lista so entra com
// `incluidoManualmente: true` e sendo candidato a cotacao (mesma regra da E3).
async function resolverItens(
  snapshotId: number,
  itens: ItemDoLote[],
  nomePorProduto: Map<number, string>,
): Promise<ItemResolvido[]> {
  const { relatorio, resultado } = await ForecastSnapshotService.getListaECandidatos(snapshotId);
  const productIds = itens.map((i) => i.productId);

  const codigos = await prisma.forecastProductCode.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, code: true, position: true, catalogItemId: true, packagingIsPrimary: true },
    orderBy: { position: 'asc' },
  });
  const codigosDoProduto = new Map<number, typeof codigos>();
  for (const c of codigos) {
    const lista = codigosDoProduto.get(c.productId);
    if (lista) lista.push(c);
    else codigosDoProduto.set(c.productId, [c]);
  }
  const catalogIds = [...new Set(codigos.flatMap((c) => (c.catalogItemId !== null ? [c.catalogItemId] : [])))];
  const catalogo = catalogIds.length
    ? await prisma.catalogItem.findMany({
        where: { id: { in: catalogIds } },
        select: { id: true, commercialName: true, isActive: true },
      })
    : [];
  const catalogoPorId = new Map(catalogo.map((c) => [c.id, c] as const));

  const problemas: Problema[] = [];
  const resolvidos: ItemResolvido[] = [];

  for (const entrada of itens) {
    const { productId } = entrada;
    const nomeBase = nomePorProduto.get(productId) ?? `#${productId}`;
    const problema = (status: 400 | 409, motivo: string, nome = nomeBase) => problemas.push({ status, texto: `${nome}: ${motivo}` });

    let fonte: string;
    let nome = nomeBase;
    let referencia: Referencia;
    const naLista = itemDaListaDeCompra(relatorio, productId);
    if (naLista) {
      const grupo = relatorio.grupos.find((g) => g.itens.includes(naLista));
      fonte = grupo?.fonte ?? '';
      nome = naLista.item;
      referencia = { sugeridaKg: naLista.quantidadeFinal, demandaKg: naLista.demanda, manual: false };
    } else if (entrada.incluidoManualmente === true) {
      const candidato = candidatoDoProduto(resultado, productId);
      if (!candidato) {
        problema(400, 'não é candidato a cotação nesta quinzena (fora da lista e sem demanda, sem fonte ou sem lead time).');
        continue;
      }
      fonte = candidato.fonte;
      nome = candidato.item;
      referencia = { sugeridaKg: candidato.quantidadeSugeridaKg ?? 0, demandaKg: candidato.anMotorKg, manual: true };
    } else {
      problema(400, 'o item não está na lista de compra desta quinzena. Para cotá-lo, inclua-o de propósito.');
      continue;
    }

    if (fonte.trim() === '') {
      problema(409, MOTIVO_SEM_FONTE, nome);
      continue;
    }
    const codigo = codigoParaCotacao(
      (codigosDoProduto.get(productId) ?? []).map((c) => ({
        code: c.code,
        position: c.position,
        catalogItemId: c.catalogItemId,
        principal: c.packagingIsPrimary,
      })),
    );
    if (!codigo || codigo.catalogItemId === null) {
      problema(409, MOTIVO_SEM_VINCULO, nome);
      continue;
    }
    const item = catalogoPorId.get(codigo.catalogItemId);
    if (!item || !item.isActive) {
      problema(
        409,
        `o item do catálogo ${item?.commercialName ?? `#${codigo.catalogItemId}`} está inativo ou não existe: reative-o em Itens antes de cotar.`,
        nome,
      );
      continue;
    }
    const quantidadeCotada = kgInteiroParaCima(entrada.quantidadeKg);
    if (quantidadeCotada <= 0) {
      problema(400, 'sem quantidade a comprar.', nome);
      continue;
    }
    if (quantidadeCotada > INT_MAX) {
      problema(400, MOTIVO_ACIMA_LIMITE, nome);
      continue;
    }
    resolvidos.push({
      entrada,
      nome,
      fonte,
      referencia,
      catalogItemId: item.id,
      catalogCommercialName: item.commercialName,
      codigo: codigo.code,
      quantidadeCotada,
    });
  }

  if (problemas.length > 0) {
    const status = problemas.some((p) => p.status === 400) ? 400 : 409;
    throw new HttpError(
      status,
      mensagemDoLote(
        problemas.slice(0, MAX_PROBLEMAS_NA_MENSAGEM).map((p) => p.texto),
        problemas.length,
      ),
    );
  }
  return resolvidos;
}

// Grava a decisao do item (criar/atualizar) com a mesma regra do PUT de decisao: concorrencia otimista por `updatedAt` (409),
// referencia (sugerida/demanda) congelada ao criar e a cada mudanca de quantidade, `manuallyIncluded` para item de fora da
// lista. `atualizadoEm` (opcional) e o `atualizadaEm` que o cliente leu. A observacao so e tocada quando vem no item.
async function gravarDecisao(
  tx: Prisma.TransactionClient,
  snapshotId: number,
  label: string,
  r: ItemResolvido,
  userId: number,
): Promise<void> {
  const { productId, quantidadeKg, observacao, atualizadoEm } = r.entrada;
  const atual = await tx.forecastPurchaseDecision.findUnique({
    where: { snapshotId_productId: { snapshotId, productId } },
  });

  if (atualizadoEm !== undefined) {
    const confere =
      atualizadoEm === null ? atual === null : atual !== null && atual.updatedAt.toISOString() === atualizadoEm;
    if (!confere) throw corrida();
  }

  const { referencia } = r;
  if (!atual) {
    const criada = await tx.forecastPurchaseDecision.create({
      data: {
        snapshotId,
        productId,
        quantityKg: quantidadeKg,
        status: 'nao',
        note: observacao ?? null,
        suggestedKg: referencia.sugeridaKg,
        demandKg: referencia.demandaKg,
        manuallyIncluded: referencia.manual,
        decidedById: userId,
      },
    });
    await AuditLogService.log(
      {
        entityType: ENTITY_DECISAO,
        entityId: criada.id,
        action: 'create',
        performedById: userId,
        metadata: {
          snapshotId,
          productId,
          label,
          via: 'cotacao-lote',
          quantidadeKg,
          sugeridaKg: referencia.sugeridaKg,
          demandaKg: referencia.demandaKg,
          status: criada.status,
          comObservacao: criada.note != null,
          ...(referencia.manual ? { incluidoManualmente: true } : {}),
        },
      },
      tx,
    );
    return;
  }

  const camposAlterados: string[] = [];
  const data: Prisma.ForecastPurchaseDecisionUncheckedUpdateManyInput = {};
  if (Number(atual.quantityKg) !== quantidadeKg) {
    camposAlterados.push('quantidadeKg');
    data.quantityKg = quantidadeKg;
    // Mudou a quantidade: recongela a sugestao e a demanda do momento.
    data.suggestedKg = referencia.sugeridaKg;
    data.demandKg = referencia.demandaKg;
  }
  if (referencia.manual && !atual.manuallyIncluded) {
    camposAlterados.push('incluidoManualmente');
    data.manuallyIncluded = true;
  }
  if (observacao !== undefined && observacao !== atual.note) {
    camposAlterados.push('observacao');
    data.note = observacao;
  }
  if (camposAlterados.length === 0) return;

  const resultado = await tx.forecastPurchaseDecision.updateMany({
    where: { id: atual.id, updatedAt: atual.updatedAt },
    data: { ...data, decidedById: userId, updatedAt: new Date() },
  });
  if (resultado.count === 0) throw corrida();
  const depois = await tx.forecastPurchaseDecision.findUnique({ where: { id: atual.id } });
  if (!depois) throw corrida();
  await AuditLogService.log(
    {
      entityType: ENTITY_DECISAO,
      entityId: atual.id,
      action: 'update',
      performedById: userId,
      metadata: {
        snapshotId,
        productId,
        label,
        via: 'cotacao-lote',
        quantidadeKg: Number(depois.quantityKg),
        sugeridaKg: Number(depois.suggestedKg),
        demandaKg: Number(depois.demandKg),
        status: depois.status,
        comObservacao: depois.note != null,
        ...(depois.manuallyIncluded ? { incluidoManualmente: true } : {}),
        antes: { quantidadeKg: Number(atual.quantityKg), status: atual.status },
        camposAlterados,
      },
    },
    tx,
  );
}
