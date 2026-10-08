import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { sumQuoteItems } from '../utils/quoteBasket';
import { normalizeItemOriginPort } from '../utils/originPort';
import { QuoteComparisonService } from './QuoteComparisonService';
import { ExchangeRateService } from './ExchangeRateService';
import {
  isAvailablePortalItem,
  type SupplierPortalResponseItemInput,
  type SupplierPortalResponseSubmitInput,
} from '../validators/supplierPortal';

export interface SubmittedResponseMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export class SupplierPortalResponseService {
  static async getByTokenId(tokenId: number, client: PrismaClient = prisma) {
    return client.supplierPortalResponse.findUnique({
      where: { portalTokenId: tokenId },
      include: { items: true },
    });
  }

  static async submit(input: {
    tokenId: number;
    quoteRequestId: number;
    supplierId: number;
    supplierContactId: number;
    payload: SupplierPortalResponseSubmitInput;
    meta?: SubmittedResponseMeta;
  }) {
    const client = prisma;
    // Itens "Temporarily unavailable" nao entram em nenhuma soma/checagem de preco:
    // o servidor ignora qualquer valor enviado para eles e grava zeros.
    const seenItemIds = new Set<number>();
    for (const item of input.payload.items) {
      if (seenItemIds.has(item.quoteRequestItemId)) {
        throw new HttpError(
          400,
          `Duplicate item in the proposal (id=${item.quoteRequestItemId}). Please reload the page.`,
        );
      }
      seenItemIds.add(item.quoteRequestItemId);
    }
    const availableItems = input.payload.items.filter(isAvailablePortalItem);
    if (
      availableItems.length !==
      input.payload.items.filter((item) => !item.isUnavailable).length
    ) {
      throw new HttpError(400, 'Provide unitPrice, quantity and totalPrice for every available item.');
    }
    const computedTotal = sumQuoteItems(availableItems);
    for (const item of availableItems) {
      const expectedTotal = new Prisma.Decimal(item.unitPrice).times(item.quantity);
      if (expectedTotal.minus(item.totalPrice).abs().gt(0.01)) {
        throw new HttpError(400, 'The item total does not match the unit price times the quantity.');
      }
    }
    if (Math.abs(computedTotal - Number(input.payload.totalPrice)) > 0.01) {
      throw new HttpError(
        400,
        'The proposal total does not match the sum of the items.',
      );
    }

    const quoteRequestItems = await client.quoteRequestItem.findMany({
      where: { quoteRequestId: input.quoteRequestId, deletedAt: null },
      select: { id: true, productName: true, catalogItem: { select: { marketName: true } } },
    });
    const itemIdSet = new Set(quoteRequestItems.map((item) => item.id));
    for (const item of input.payload.items) {
      if (!itemIdSet.has(item.quoteRequestItemId)) {
        throw new HttpError(
          400,
          `Invalid item in the proposal (id=${item.quoteRequestItemId}). Please reload the page.`,
        );
      }
    }

    const quoteRequest = await client.quoteRequest.findUnique({
      where: { id: input.quoteRequestId },
      select: { desiredIncoterm: true },
    });
    const quoteIncoterms: string[] = [...new Set<string>(quoteRequest?.desiredIncoterm ?? [])];
    const normalizedIncotermPrices = normalizeIncotermPrices(
      quoteIncoterms,
      input.payload.incoterm,
      input.payload.items,
    );

    const currency = input.payload.currency ?? 'USD';
    if (input.payload.totalPriceCurrency && input.payload.totalPriceCurrency !== currency) {
      throw new HttpError(400, 'The total currency must match the proposal currency.');
    }
    const scalarData = {
      currency,
      incoterm: input.payload.incoterm,
      paymentTermsDays: input.payload.paymentTermsDays,
      totalPrice: new Prisma.Decimal(input.payload.totalPrice),
      totalPriceCurrency: input.payload.totalPriceCurrency ?? currency,
      validityDays: input.payload.validityDays,
      notes: input.payload.notes ?? null,
      originPort: input.payload.originPort ?? null,
      submitterIp: input.meta?.ip ?? null,
      submitterUserAgent: input.meta?.userAgent ?? null,
    };
    const itemsCreate = input.payload.items.map(
      (item: SupplierPortalResponseItemInput, index: number) => {
        if (!isAvailablePortalItem(item)) {
          return {
            quoteRequestItemId: item.quoteRequestItemId,
            unitPrice: new Prisma.Decimal(0),
            quantity: 0,
            totalPrice: new Prisma.Decimal(0),
            leadTimeDays: null,
            notes: item.notes ?? null,
            originPort: null,
            incotermPrices: Prisma.DbNull,
            isUnavailable: true,
            // Item indisponivel ignora DG mesmo que o cliente envie true
            isDangerousGood: false,
          };
        }
        const prices = normalizedIncotermPrices[index];
        return {
          quoteRequestItemId: item.quoteRequestItemId,
          unitPrice: new Prisma.Decimal(item.unitPrice),
          quantity: item.quantity,
          totalPrice: new Prisma.Decimal(item.totalPrice),
          leadTimeDays: item.leadTimeDays ?? null,
          notes: item.notes ?? null,
          // null = herda a origem geral da proposta (igual a geral ou vazio)
          originPort: normalizeItemOriginPort(item.originPort, input.payload.originPort),
          incotermPrices: prices
            ? prices.map((p) => ({
                incoterm: p.incoterm,
                unitPrice: new Prisma.Decimal(p.unitPrice).toFixed(2),
                totalPrice: new Prisma.Decimal(p.unitPrice)
                  .times(item.quantity)
                  .toFixed(2),
              }))
            : Prisma.DbNull,
          isUnavailable: false,
          isDangerousGood: item.isDangerousGood,
        };
      },
    );

    return client.$transaction(async (tx) => {
      const existing = await tx.supplierPortalResponse.findUnique({
        where: { portalTokenId: input.tokenId },
        include: { items: true },
      });

      let response;
      if (existing) {
        // Revisao: fotografa a versao atual no historico (read-only) e
        // sobrescreve a resposta corrente com a nova versao. Permitido enquanto
        // o link nao expirou (a validacao de token ja garante isso na rota).
        await tx.supplierPortalResponseRevision.create({
          data: {
            portalTokenId: input.tokenId,
            version: existing.version,
            currency: existing.currency,
            incoterm: existing.incoterm,
            paymentTermsDays: existing.paymentTermsDays,
            totalPrice: existing.totalPrice,
            totalPriceCurrency: existing.totalPriceCurrency,
            validityDays: existing.validityDays,
            notes: existing.notes,
            originPort: existing.originPort,
            submittedAt: existing.submittedAt,
            items: existing.items.map((it) => ({
              quoteRequestItemId: it.quoteRequestItemId,
              unitPrice: it.unitPrice.toString(),
              quantity: it.quantity,
              totalPrice: it.totalPrice.toString(),
              leadTimeDays: it.leadTimeDays,
              notes: it.notes,
              incotermPrices: it.incotermPrices ?? null,
              originPort: it.originPort ?? null,
              isUnavailable: it.isUnavailable,
              isDangerousGood: it.isDangerousGood,
            })),
          },
        });

        await tx.supplierPortalResponseItem.deleteMany({
          where: { responseId: existing.id },
        });

        response = await tx.supplierPortalResponse.update({
          where: { id: existing.id },
          data: {
            supplierContactId: input.supplierContactId,
            ...scalarData,
            version: existing.version + 1,
            submittedAt: new Date(),
            items: { create: itemsCreate },
          },
          include: { items: true },
        });
      } else {
        response = await tx.supplierPortalResponse.create({
          data: {
            portalTokenId: input.tokenId,
            quoteRequestId: input.quoteRequestId,
            supplierId: input.supplierId,
            supplierContactId: input.supplierContactId,
            ...scalarData,
            items: { create: itemsCreate },
          },
          include: { items: true },
        });
      }

      const quoteResponse = await syncQuoteResponseFromPortal(tx, {
        quoteRequestId: input.quoteRequestId,
        supplierId: input.supplierId,
        portalResponse: response,
        providedExchangeRate: input.payload.exchangeRate ?? null,
      });

      await tx.supplierPortalToken.update({
        where: {
          id: input.tokenId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          quoteRequest: { deletedAt: null, status: { not: 'closed' } },
        },
        data: {
          respondedAt: new Date(),
          responseId: response.id,
        },
      });

      return { portalResponse: response, quoteResponse, revised: Boolean(existing) };
    });
  }

  static async getHistoryByTokenId(tokenId: number, client: PrismaClient = prisma) {
    return client.supplierPortalResponseRevision.findMany({
      where: { portalTokenId: tokenId },
      orderBy: { version: 'asc' },
    });
  }
}

async function syncQuoteResponseFromPortal(
  tx: Prisma.TransactionClient,
  input: {
    quoteRequestId: number;
    supplierId: number;
    portalResponse: Prisma.SupplierPortalResponseGetPayload<{ include: { items: true } }>;
    providedExchangeRate?: number | null;
  },
) {
  const items = [...input.portalResponse.items].sort(
    (a, b) => a.quoteRequestItemId - b.quoteRequestItemId,
  );
  // Itens indisponiveis (valores 0) ficam fora de preco e prazo medio.
  const availableItems = items.filter((item) => !item.isUnavailable);
  const offeredPrice = sumQuoteItems(availableItems);
  const currency = (input.portalResponse.currency ?? 'USD').toUpperCase();
  const providedRate = input.providedExchangeRate ?? null;
  const exchangeRate =
    currency === 'BRL'
      ? 1
      : providedRate && providedRate > 0
        ? providedRate
        : await resolveExchangeRate(
            tx,
            input.quoteRequestId,
            currency,
          );
  if (currency !== 'BRL' && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
    throw new HttpError(
      400,
      'Exchange rate unavailable for this currency. Please contact the buyer.',
    );
  }

  const landedCost = QuoteComparisonService.calculateLandedCost({
    offeredPrice,
    currency,
    exchangeRate,
    freightCost: 0,
    insuranceCost: 0,
    otherFees: 0,
    importDutyRate: 0,
    ipiRate: 0,
    pisRate: 0,
    cofinsRate: 0,
  });

  const submittedAt = input.portalResponse.submittedAt;
  const leadTimeDays = computeAverageLeadTime(availableItems);

  const data = {
    quoteRequestId: input.quoteRequestId,
    supplierId: input.supplierId,
    offeredPrice: new Prisma.Decimal(offeredPrice),
    currency,
    exchangeRate: landedCost.exchangeRate,
    freightCost: landedCost.freightCost,
    insuranceCost: landedCost.insuranceCost,
    otherFees: landedCost.otherFees,
    importDuty: landedCost.importDutyRate,
    ipi: landedCost.ipiRate,
    pis: landedCost.pisRate,
    cofins: landedCost.cofinsRate,
    totalLandedCost: landedCost.totalLandedCost,
    offeredIncoterm: input.portalResponse.incoterm,
    paymentTermsDays: input.portalResponse.paymentTermsDays,
    leadTimeDays,
    notes: input.portalResponse.notes ?? null,
    originPort: input.portalResponse.originPort ?? null,
    submittedAt,
  } satisfies Partial<Prisma.QuoteResponseUncheckedCreateInput>;

  const itemsToCreate = items.map((item) => ({
    quoteRequestItemId: item.quoteRequestItemId,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    totalPrice: item.totalPrice,
    leadTimeDays: item.leadTimeDays,
    notes: item.notes,
    originPort: item.originPort ?? null,
    isUnavailable: item.isUnavailable,
    isDangerousGood: item.isUnavailable ? false : item.isDangerousGood,
    incotermPrices: (item.incotermPrices as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
  }));

  return tx.quoteResponse.upsert({
    where: {
      quoteRequestId_supplierId: {
        quoteRequestId: input.quoteRequestId,
        supplierId: input.supplierId,
      },
    },
    create: {
      ...data,
      version: 1,
      isWinner: false,
      items: { create: itemsToCreate },
    },
    update: {
      ...data,
      deletedAt: null,
      isWinner: false,
      version: { increment: 1 },
      items: {
        updateMany: { where: { deletedAt: null }, data: { deletedAt: new Date() } },
        create: itemsToCreate,
      },
    },
  });
}

type NormalizedIncotermPrice = { incoterm: string; unitPrice: number };

/**
 * Valida e normaliza os precos por incoterm de cada item.
 * Retorna, por item, a lista normalizada ou null (cotacao sem incoterms / legado).
 */
function normalizeIncotermPrices(
  quoteIncoterms: string[],
  mainIncoterm: string,
  items: SupplierPortalResponseItemInput[],
): (NormalizedIncotermPrice[] | null)[] {
  if (quoteIncoterms.length === 0) {
    if (items.some((item) => !item.isUnavailable && item.incotermPrices !== undefined)) {
      throw new HttpError(400, 'This quote has no incoterms. Please send a single price per item.');
    }
    return items.map(() => null);
  }
  const allowed = new Set(quoteIncoterms);
  if (!allowed.has(mainIncoterm)) {
    throw new HttpError(400, `Incoterm ${mainIncoterm} is not part of this quote. If a field is missing, reload the page.`);
  }
  return items.map((item) => {
    // Item indisponivel nao tem preco: nada a validar nem a gravar por incoterm.
    if (!isAvailablePortalItem(item)) return null;
    if (!item.incotermPrices) {
      if (quoteIncoterms.length >= 2) {
        throw new HttpError(
          400,
          `This page was updated. Please reload it (Ctrl+F5) to quote a price for each incoterm: ${quoteIncoterms.join(', ')}.`,
          'PORTAL_OUTDATED',
        );
      }
      return [{ incoterm: quoteIncoterms[0], unitPrice: Number(item.unitPrice) }];
    }
    const seen = new Set<string>();
    for (const entry of item.incotermPrices) {
      if (!allowed.has(entry.incoterm)) {
        throw new HttpError(400, `Incoterm ${entry.incoterm} is not part of this quote. If a field is missing, reload the page.`);
      }
      if (seen.has(entry.incoterm)) {
        throw new HttpError(400, 'Provide a single price per incoterm.');
      }
      seen.add(entry.incoterm);
    }
    if (seen.size !== allowed.size) {
      throw new HttpError(
        400,
        `Provide a price for every incoterm of this quote: ${quoteIncoterms.join(', ')}. If a field is missing, reload the page.`,
      );
    }
    const main = item.incotermPrices.find((entry) => entry.incoterm === mainIncoterm);
    if (!main || Math.abs(Number(main.unitPrice) - Number(item.unitPrice)) > 0.0001) {
      throw new HttpError(
        400,
        'The main incoterm price must match the item unit price.',
      );
    }
    return item.incotermPrices.map((entry) => ({
      incoterm: entry.incoterm as string,
      unitPrice: Number(entry.unitPrice),
    }));
  });
}

async function resolveExchangeRate(
  tx: Prisma.TransactionClient,
  quoteRequestId: number,
  currency: string,
): Promise<number> {
  const existing = await tx.quoteResponse.findFirst({
    where: { quoteRequestId, deletedAt: null, currency: { equals: currency, mode: 'insensitive' } },
    orderBy: { updatedAt: 'desc' },
    select: { exchangeRate: true },
  });
  const candidate = existing ? Number(existing.exchangeRate) : 0;
  if (candidate > 0) {
    return candidate;
  }
  // Uma taxa de outra moeda nao pode servir de fallback (ex.: USD para EUR).
  // Tenta usar o cache local de PTAX (BCB). So considera o valor atual
  // (mesma data ou anterior) para nao misturar taxas de dias muito antigos.
  const cached = await ExchangeRateService.getRateToBrl(currency, tx as PrismaClient);
  if (cached && cached.rateToBrl > 0) {
    return cached.rateToBrl;
  }
  throw new HttpError(
    400,
    'Exchange rate unavailable for this currency. Please contact the buyer.',
  );
}

function computeAverageLeadTime(
  items: Prisma.SupplierPortalResponseItemGetPayload<Record<string, never>>[],
): number | null {
  const leadTimes = items
    .map((item) => (item.leadTimeDays == null ? null : Number(item.leadTimeDays)))
    .filter((value): value is number => value !== null);
  if (leadTimes.length === 0) {
    return null;
  }
  const sum = leadTimes.reduce((acc, value) => acc + value, 0);
  return Math.round(sum / leadTimes.length);
}
