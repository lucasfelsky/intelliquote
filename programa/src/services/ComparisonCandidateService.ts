import { Prisma, type Incoterm } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { computeIsStale } from './CreditSupportService';

// PR4a (Credit Support): um encaminhamento `responded` (nao revogado) entra na Comparacao
// como CANDIDATO proprio ("Fornecedor X via Parceiro Y"). A "resposta virtual" copia os
// escalares da resposta de ORIGEM (moeda/cambio/frete/tributos/incoterm) e troca preco e
// prazo pelos do parceiro; a identidade e (quoteResponseId, creditSupportRequestId).
// Formulas de landed cost/score nao mudam: a virtual passa pela MESMA classificacao e pelo
// MESMO compareResponses das respostas diretas.

type Client = Prisma.TransactionClient | typeof prisma;

export interface VirtualCreditItem {
  quoteRequestItemId: number;
  quantity: number;
  unitPrice: Prisma.Decimal;
  isUnavailable: boolean;
  quoteRequestItem: { productName: string };
}

export interface CreditPartnerRef {
  id: number;
  name: string;
}

export interface PartnerContactRef {
  id: number;
  name: string;
  email: string;
}

export interface VirtualCreditResponse {
  /** Resposta de ORIGEM (mantem FKs, historico e relatorios). */
  id: number;
  quoteRequestId: number;
  supplierId: number;
  supplier: { id: number; name: string; contacts: PartnerContactRef[] };
  offeredPrice: Prisma.Decimal;
  currency: string;
  exchangeRate: Prisma.Decimal;
  freightCost: Prisma.Decimal;
  insuranceCost: Prisma.Decimal;
  otherFees: Prisma.Decimal;
  importDuty: Prisma.Decimal;
  ipi: Prisma.Decimal;
  pis: Prisma.Decimal;
  cofins: Prisma.Decimal;
  offeredIncoterm: Incoterm;
  paymentTermsDays: number;
  isWinner: boolean;
  items: VirtualCreditItem[];
  creditSupportRequestId: number;
  creditPartner: CreditPartnerRef;
  partnerContact: PartnerContactRef | null;
  partnerValidityDays: number | null;
  validityExpired: boolean;
}

export interface ExcludedCreditEntry {
  quoteResponseId: number;
  supplierId: number;
  supplier: { id: number; name: string };
  creditSupportRequestId: number;
  creditPartner: CreditPartnerRef;
  reason: 'stale';
  unavailableItems: never[];
}

const creditRequestInclude = {
  items: { orderBy: { position: 'asc' as const } },
  supplier: { select: { id: true, name: true } },
  creditPartner: { select: { id: true, name: true } },
  creditPartnerContact: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CreditSupportRequestInclude;

// Mesmo include de CreditSupportService.listByQuoteRequest (itens para o computeIsStale) +
// contato principal do fornecedor. SEM filtro de deletedAt: resposta excluida => stale.
const originResponseInclude = {
  items: {
    where: { deletedAt: null, quoteRequestItem: { deletedAt: null } },
    include: { quoteRequestItem: { include: { catalogItem: true } } },
    orderBy: { quoteRequestItemId: 'asc' as const },
  },
  supplier: {
    select: {
      id: true,
      name: true,
      contacts: {
        orderBy: [{ isPrimary: 'desc' as const }, { id: 'asc' as const }],
        take: 1,
        select: { id: true, name: true, email: true },
      },
    },
  },
} satisfies Prisma.QuoteResponseInclude;

type CreditRequestRow = Prisma.CreditSupportRequestGetPayload<{ include: typeof creditRequestInclude }>;
type OriginResponse = Prisma.QuoteResponseGetPayload<{ include: typeof originResponseInclude }>;

const DAY_MS = 24 * 60 * 60 * 1000;

function partnerItems(row: CreditRequestRow): VirtualCreditItem[] {
  return row.items.map((item) => ({
    quoteRequestItemId: item.quoteRequestItemId,
    quantity: item.quantity,
    unitPrice: item.partnerUnitPrice ?? new Prisma.Decimal(0),
    isUnavailable: item.isUnavailable,
    quoteRequestItem: { productName: item.productName },
  }));
}

function hasUnpricedAvailableItem(row: CreditRequestRow): boolean {
  return row.items.some((item) => !item.isUnavailable && item.partnerUnitPrice === null);
}

export function isPartnerValidityExpired(
  row: { respondedAt: Date | null; partnerValidityDays: number | null },
  now: Date = new Date(),
): boolean {
  if (!row.respondedAt || row.partnerValidityDays === null) return false;
  return row.respondedAt.getTime() + row.partnerValidityDays * DAY_MS < now.getTime();
}

function toVirtual(row: CreditRequestRow, origin: OriginResponse, now: Date): VirtualCreditResponse {
  return {
    id: row.quoteResponseId,
    quoteRequestId: row.quoteRequestId,
    supplierId: origin.supplierId,
    supplier: { id: origin.supplier.id, name: origin.supplier.name, contacts: origin.supplier.contacts },
    offeredPrice: row.partnerTotalPrice ?? new Prisma.Decimal(0),
    currency: origin.currency,
    exchangeRate: origin.exchangeRate,
    freightCost: origin.freightCost,
    insuranceCost: origin.insuranceCost,
    otherFees: origin.otherFees,
    importDuty: origin.importDuty,
    ipi: origin.ipi,
    pis: origin.pis,
    cofins: origin.cofins,
    offeredIncoterm: origin.offeredIncoterm,
    paymentTermsDays: row.partnerPaymentTermsDays ?? origin.paymentTermsDays,
    isWinner: row.isWinner === true,
    items: partnerItems(row),
    creditSupportRequestId: row.id,
    creditPartner: { id: row.creditPartner.id, name: row.creditPartner.name },
    partnerContact: row.creditPartnerContact ?? null,
    partnerValidityDays: row.partnerValidityDays,
    validityExpired: isPartnerValidityExpired(row, now),
  };
}

/**
 * Encaminhamentos respondidos e nao revogados da cotacao, como respostas virtuais prontas
 * para a `partitionForComparison`. Stale (proposta de origem mudou/excluida) vai para
 * `stale` (fora do ranking, `reason: 'stale'`). Linha `responded` com item disponivel sem
 * preco do parceiro (nao deveria existir) e pulada: nunca derruba a comparacao.
 */
export async function loadCreditAlternatives(
  quoteRequestId: number,
  now: Date = new Date(),
): Promise<{ virtual: VirtualCreditResponse[]; stale: ExcludedCreditEntry[] }> {
  const rows = await prisma.creditSupportRequest.findMany({
    where: { quoteRequestId, revokedAt: null, respondedAt: { not: null } },
    orderBy: { id: 'asc' },
    include: creditRequestInclude,
  });
  if (rows.length === 0) return { virtual: [], stale: [] };

  const responseIds = Array.from(new Set(rows.map((row) => row.quoteResponseId)));
  const origins = await prisma.quoteResponse.findMany({
    where: { id: { in: responseIds } },
    include: originResponseInclude,
  });
  const originById = new Map(origins.map((origin) => [origin.id, origin]));

  const virtual: VirtualCreditResponse[] = [];
  const stale: ExcludedCreditEntry[] = [];
  for (const row of rows) {
    const origin = originById.get(row.quoteResponseId);
    if (!origin || computeIsStale(row, origin)) {
      stale.push({
        quoteResponseId: row.quoteResponseId,
        supplierId: row.supplierId,
        supplier: { id: row.supplier.id, name: row.supplier.name },
        creditSupportRequestId: row.id,
        creditPartner: { id: row.creditPartner.id, name: row.creditPartner.name },
        reason: 'stale',
        unavailableItems: [],
      });
      continue;
    }
    if (hasUnpricedAvailableItem(row)) continue;
    virtual.push(toVirtual(row, origin, now));
  }
  return { virtual, stale };
}

/** Zera `CreditSupportRequest.isWinner` da cotacao (ou da resposta de origem). Idempotente. */
export async function clearCreditWinners(
  tx: Client,
  where: { quoteRequestId: number } | { quoteResponseId: number },
): Promise<{ count: number }> {
  return tx.creditSupportRequest.updateMany({
    where: { ...where, isWinner: true },
    data: { isWinner: false },
  });
}

/**
 * PR4b: apos editar a resposta de ORIGEM, zera o vencedor-parceiro SO' dos encaminhamentos que
 * ficaram stale de verdade (`computeIsStale`); re-salvar sem mudanca nao derruba a vencedora.
 * Sem vencedor-parceiro => 1 query so'. Devolve os ids zerados. Idempotente.
 */
export async function clearStaleCreditWinners(client: Client, quoteResponseId: number): Promise<number[]> {
  const winners = await client.creditSupportRequest.findMany({
    where: { quoteResponseId, isWinner: true },
    include: creditRequestInclude,
  });
  if (winners.length === 0) return [];

  const origin = await client.quoteResponse.findFirst({
    where: { id: quoteResponseId },
    include: originResponseInclude,
  });
  const staleIds = winners.filter((row) => !origin || computeIsStale(row, origin)).map((row) => row.id);
  if (staleIds.length === 0) return [];

  await client.creditSupportRequest.updateMany({
    where: { id: { in: staleIds }, isWinner: true },
    data: { isWinner: false },
  });
  return staleIds;
}

export interface CreditCandidateForAward {
  row: CreditRequestRow;
  isStale: boolean;
  basket: { id: number; offeredPrice: Prisma.Decimal; items: VirtualCreditItem[] };
}

/**
 * Carrega a alternativa para adjudicacao (manual/approve). 404 se nao existe, nao pertence a
 * cotacao/resposta, foi revogada ou nao foi respondida. `isStale` e decidido pelo chamador
 * (409 "A oferta do parceiro mudou ou foi revogada").
 */
export async function loadCreditCandidateForAward(
  client: Client,
  params: { creditSupportRequestId: number; quoteRequestId: number; quoteResponseId: number },
): Promise<CreditCandidateForAward> {
  const row = await client.creditSupportRequest.findFirst({
    where: {
      id: params.creditSupportRequestId,
      quoteRequestId: params.quoteRequestId,
      quoteResponseId: params.quoteResponseId,
      revokedAt: null,
      respondedAt: { not: null },
    },
    include: creditRequestInclude,
  });
  if (!row) {
    throw new HttpError(404, 'Encaminhamento de Credit Support nao encontrado para esta proposta.');
  }
  const origin = await client.quoteResponse.findFirst({
    where: { id: params.quoteResponseId },
    include: originResponseInclude,
  });
  return {
    row,
    isStale: !origin || computeIsStale(row, origin) || hasUnpricedAvailableItem(row),
    basket: {
      id: row.quoteResponseId,
      offeredPrice: row.partnerTotalPrice ?? new Prisma.Decimal(0),
      items: partnerItems(row),
    },
  };
}

export const CREDIT_OFFER_CHANGED_MESSAGE =
  'A oferta do parceiro mudou ou foi revogada. Refaca a comparacao.';
