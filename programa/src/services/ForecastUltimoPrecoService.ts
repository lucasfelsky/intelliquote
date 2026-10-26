import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';

// Ultimo preco negociado de um produto do Forecast: SO LEITURA (sem AuditLog, sem transacao).
// Cadeia: ForecastProductCode.catalogItemId -> QuoteRequestItem.catalogItemId -> QuoteResponseItem.unitPrice
// da proposta VENCEDORA direta (Credit Support fica de fora) em cotacao fechada ou com PO enviada.
// ATENCAO: do fornecedor sai SO o nome. Nunca selecionar contato, e-mail, site, notas nem custo desembarcado.

export interface ForecastUltimoPreco {
  valorUnitario: string;
  moeda: string;
  unidade: string;
  incoterm: string;
  fornecedor: string;
  cotacao: { id: number; codigo: string };
  fechadaEm: string | null;
  poEnviadaEm: string | null;
  catalogItemId: number;
  codigos: string[];
}

export type ForecastUltimoPrecoMotivo = 'sem_vinculo_catalogo' | 'sem_cotacao_vencedora';

export interface ForecastUltimoPrecoData {
  productId: number;
  ultimoPreco: ForecastUltimoPreco | null;
  motivo: ForecastUltimoPrecoMotivo | null;
}

export interface UltimoPrecoCandidata {
  id: number;
  unitPrice: { toFixed: (digits: number) => string };
  quoteRequestItem: { id: number; unit: string; catalogItemId: number | null };
  quoteResponse: {
    id: number;
    currency: string;
    offeredIncoterm: string;
    supplier: { name: string };
    quoteRequest: {
      id: number;
      requestCode: string;
      status: string;
      closedAt: Date | null;
      purchaseOrderSentAt: Date | null;
    };
  };
}

export interface UltimoPrecoCodigo {
  code: string;
  position: number;
  catalogItemId: number | null;
}

// Data de referencia: fechamento (cotacao fechada) ou, sem ele, o envio da PO.
function dataDeReferencia(q: UltimoPrecoCandidata['quoteResponse']['quoteRequest']): number | null {
  const data = q.status === 'closed' && q.closedAt ? q.closedAt : q.purchaseOrderSentAt;
  return data ? data.getTime() : null;
}

function compara(a: UltimoPrecoCandidata, b: UltimoPrecoCandidata): number {
  const da = dataDeReferencia(a.quoteResponse.quoteRequest);
  const db = dataDeReferencia(b.quoteResponse.quoteRequest);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return db - da;
  }
  const qa = a.quoteResponse.quoteRequest.id;
  const qb = b.quoteResponse.quoteRequest.id;
  if (qa !== qb) return qb - qa;
  return b.id - a.id;
}

// Funcao pura: escolhe a candidata mais recente (data de referencia desc, cotacao desc, item desc).
export function escolherUltimoPreco(
  candidatas: UltimoPrecoCandidata[],
  codigos: UltimoPrecoCodigo[] = [],
): ForecastUltimoPreco | null {
  if (candidatas.length === 0) return null;
  const vencedora = [...candidatas].sort(compara)[0];
  const q = vencedora.quoteResponse.quoteRequest;
  const catalogItemId = vencedora.quoteRequestItem.catalogItemId as number;
  return {
    valorUnitario: vencedora.unitPrice.toFixed(2),
    moeda: vencedora.quoteResponse.currency,
    unidade: vencedora.quoteRequestItem.unit,
    incoterm: vencedora.quoteResponse.offeredIncoterm,
    fornecedor: vencedora.quoteResponse.supplier.name,
    cotacao: { id: q.id, codigo: q.requestCode },
    fechadaEm: q.status === 'closed' && q.closedAt ? todayKeyInSaoPaulo(q.closedAt) : null,
    poEnviadaEm: q.purchaseOrderSentAt ? todayKeyInSaoPaulo(q.purchaseOrderSentAt) : null,
    catalogItemId,
    codigos: [...codigos]
      .sort((a, b) => a.position - b.position)
      .filter((c) => c.catalogItemId === catalogItemId)
      .map((c) => c.code),
  };
}

export class ForecastUltimoPrecoService {
  static async doProduto(productId: number): Promise<ForecastUltimoPrecoData> {
    const produto = await prisma.forecastProduct.findUnique({
      where: { id: productId },
      select: {
        id: true,
        codes: { select: { code: true, position: true, catalogItemId: true }, orderBy: { position: 'asc' } },
      },
    });
    if (!produto) {
      throw new HttpError(404, 'Produto nao encontrado.');
    }

    const catalogItemIds = [
      ...new Set(produto.codes.flatMap((c) => (c.catalogItemId !== null ? [c.catalogItemId] : []))),
    ];
    if (catalogItemIds.length === 0) {
      return { productId: produto.id, ultimoPreco: null, motivo: 'sem_vinculo_catalogo' };
    }

    const where: Prisma.QuoteResponseItemWhereInput = {
      deletedAt: null,
      isUnavailable: false,
      unitPrice: { gt: 0 },
      quoteRequestItem: { deletedAt: null, catalogItemId: { in: catalogItemIds } },
      quoteResponse: {
        deletedAt: null,
        isWinner: true,
        quoteRequest: {
          deletedAt: null,
          OR: [{ status: 'closed' }, { purchaseOrderSentAt: { not: null } }],
        },
      },
    };
    const candidatas = await prisma.quoteResponseItem.findMany({
      where,
      select: {
        id: true,
        unitPrice: true,
        quoteRequestItem: { select: { id: true, unit: true, catalogItemId: true } },
        quoteResponse: {
          select: {
            id: true,
            currency: true,
            offeredIncoterm: true,
            supplier: { select: { name: true } },
            quoteRequest: {
              select: { id: true, requestCode: true, status: true, closedAt: true, purchaseOrderSentAt: true },
            },
          },
        },
      },
    });

    const ultimoPreco = escolherUltimoPreco(candidatas, produto.codes);
    return {
      productId: produto.id,
      ultimoPreco,
      motivo: ultimoPreco ? null : 'sem_cotacao_vencedora',
    };
  }
}
