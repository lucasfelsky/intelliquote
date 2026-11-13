import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { allowedQuoteActions, computeQuoteTotal, formatQuoteRef } from '../utils/indentQuote';
import { dbDateToKey } from '../utils/supplierDocumentDates';
import type { IndentQuoteListQuery } from '../validators/indentQuote';

// Leitura das cotacoes do IQ Indent (PR 3): lista, detalhe e os serializadores que o workflow reaproveita.
// Preco e total sao sempre Prisma.Decimal no backend e saem como string (nunca Number).

export const LIST_LIMIT = 500;
export const WRITE_ROLES = ['admin', 'comprador', 'gestor'];

/** Cliente do Prisma (global ou transacional): o detalhe e o mesmo dentro e fora da trava. */
export type QuoteDb = Pick<Prisma.TransactionClient, 'indentQuote'>;

const listInclude = {
  request: {
    select: {
      id: true,
      processNumber: true,
      status: true,
      client: { select: { id: true, name: true, city: true } },
    },
  },
  supplier: { select: { id: true, name: true, country: true, contactName: true, hasPartnership: true } },
  items: {
    orderBy: { requestItem: { position: 'asc' as const } },
    select: {
      cfrPricePerKg: true,
      requestItem: { select: { description: true, quantityKg: true, product: { select: { name: true } } } },
    },
  },
} satisfies Prisma.IndentQuoteInclude;

export const quoteDetailInclude = {
  request: {
    select: {
      id: true,
      processNumber: true,
      status: true,
      client: { select: { id: true, name: true, city: true, supplierRuleMode: true } },
    },
  },
  supplier: {
    select: { id: true, name: true, country: true, contactName: true, hasPartnership: true, type: true },
  },
  items: {
    orderBy: { requestItem: { position: 'asc' as const } },
    include: {
      requestItem: {
        select: {
          id: true,
          description: true,
          quantityKg: true,
          position: true,
          productId: true,
          product: { select: { id: true, name: true, cas: true, origin: true } },
        },
      },
    },
  },
} satisfies Prisma.IndentQuoteInclude;

type ListRow = Prisma.IndentQuoteGetPayload<{ include: typeof listInclude }>;
export type QuoteDetailRow = Prisma.IndentQuoteGetPayload<{ include: typeof quoteDetailInclude }>;

/** A cotacao ACEITA da solicitacao (no maximo uma), para o aviso de aceite unico e para as travas. */
export const acceptedSelect = {
  id: true,
  revision: true,
  supplier: { select: { name: true } },
  request: { select: { processNumber: true } },
} satisfies Prisma.IndentQuoteSelect;

export type AcceptedQuote = Prisma.IndentQuoteGetPayload<{ select: typeof acceptedSelect }>;

function fixed(value: unknown, digits: number): string {
  return new Prisma.Decimal(value as Prisma.Decimal.Value).toFixed(digits);
}

function fixedOrNull(value: unknown, digits: number): string | null {
  return value === null || value === undefined ? null : fixed(value, digits);
}

function serializeBase(row: ListRow | QuoteDetailRow) {
  const first = row.items[0]?.requestItem;

  return {
    id: row.id,
    ref: formatQuoteRef(row.request.processNumber, row.revision),
    revision: row.revision,
    status: row.status,
    requestId: row.requestId,
    processNumber: row.request.processNumber,
    requestStatus: row.request.status,
    client: row.request.client
      ? { id: row.request.client.id, name: row.request.client.name, city: row.request.client.city }
      : null,
    supplier: {
      id: row.supplier.id,
      name: row.supplier.name,
      country: row.supplier.country,
      contactName: row.supplier.contactName,
      hasPartnership: row.supplier.hasPartnership,
    },
    itemsSummary: {
      firstName: first ? (first.product?.name ?? first.description) : null,
      count: row.items.length,
    },
    currency: row.currency,
    total: computeQuoteTotal(
      row.items.map((item) => ({ quantityKg: item.requestItem.quantityKg, cfrPricePerKg: item.cfrPricePerKg })),
    ),
    validUntil: row.validUntil ? dbDateToKey(row.validUntil) : null,
    createdAt: row.createdAt,
  };
}

export function serializeListRow(row: ListRow) {
  return {
    ...serializeBase(row),
    exception: row.exceptionReason ? { reason: row.exceptionReason } : null,
  };
}

export function serializeDetail(row: QuoteDetailRow, accepted: AcceptedQuote | null, canWrite: boolean) {
  const otherAccepted = accepted && accepted.id !== row.id ? accepted : null;

  return {
    ...serializeBase(row),
    destination: row.destination,
    incoterm: row.incoterm,
    sentAt: row.sentAt,
    respondedAt: row.respondedAt,
    decidedAt: row.decidedAt,
    productionLeadTimeDays: row.productionLeadTimeDays,
    paymentTerms: row.paymentTerms,
    manufacturer: row.manufacturer,
    notes: row.notes,
    base: row.baseQuoteId !== null ? { id: row.baseQuoteId, ref: formatQuoteRef(row.request.processNumber, 1) } : null,
    acceptedQuote: otherAccepted
      ? {
          id: otherAccepted.id,
          ref: formatQuoteRef(otherAccepted.request.processNumber, otherAccepted.revision),
          supplierName: otherAccepted.supplier.name,
        }
      : null,
    client: row.request.client
      ? {
          id: row.request.client.id,
          name: row.request.client.name,
          city: row.request.client.city,
          supplierRuleMode: row.request.client.supplierRuleMode,
        }
      : null,
    supplier: {
      id: row.supplier.id,
      name: row.supplier.name,
      country: row.supplier.country,
      contactName: row.supplier.contactName,
      hasPartnership: row.supplier.hasPartnership,
      type: row.supplier.type,
    },
    exception: row.exceptionReason
      ? { reason: row.exceptionReason, byName: row.exceptionByName, at: row.exceptionAt }
      : null,
    items: row.items.map((item) => ({
      id: item.id,
      requestItemId: item.requestItemId,
      name: item.requestItem.product?.name ?? item.requestItem.description,
      cas: item.requestItem.product?.cas ?? null,
      productOrigin: item.requestItem.product?.origin ?? null,
      isFree: item.requestItem.productId === null || item.requestItem.product?.origin === 'LIVRE',
      quantityKg: fixed(item.requestItem.quantityKg, 3),
      packaging: item.packaging,
      fobPricePerKg: fixedOrNull(item.fobPricePerKg, 4),
      cfrPricePerKg: fixedOrNull(item.cfrPricePerKg, 4),
    })),
    allowedActions: allowedQuoteActions(row.status, canWrite, row.request.status, accepted !== null),
  };
}

/** Detalhe no formato unico da API (getById e resposta de toda acao). Usa o cliente recebido: dentro da trava, o `tx`. */
export async function loadQuoteDetail(db: QuoteDb, id: number, canWrite: boolean) {
  const row = await db.indentQuote.findUnique({ where: { id }, include: quoteDetailInclude });

  if (!row) {
    throw new HttpError(404, 'Cotação não encontrada.');
  }

  const accepted = await db.indentQuote.findFirst({
    where: { requestId: row.requestId, status: 'ACEITA' },
    select: acceptedSelect,
  });

  return serializeDetail(row, accepted, canWrite);
}

export class IndentQuoteService {
  // Ate 500 cotacoes mais recentes (inclui REVISADA); o agrupamento e feito na tela.
  static async list(query: IndentQuoteListQuery) {
    const where: Prisma.IndentQuoteWhereInput = {
      ...(query.status && query.status.length > 0 ? { status: { in: query.status } } : {}),
      ...(query.q
        ? {
            OR: [
              { request: { processNumber: { contains: query.q, mode: 'insensitive' } } },
              { request: { client: { name: { contains: query.q, mode: 'insensitive' } } } },
              { supplier: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const rows = await prisma.indentQuote.findMany({
      where,
      include: listInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT + 1,
    });

    const truncated = rows.length > LIST_LIMIT;
    return { data: rows.slice(0, LIST_LIMIT).map((row) => serializeListRow(row)), truncated };
  }

  static async getById(id: number, role: string) {
    return loadQuoteDetail(prisma, id, WRITE_ROLES.includes(role));
  }
}
