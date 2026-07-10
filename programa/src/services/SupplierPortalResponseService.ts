import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../utils/http';
import { QuoteComparisonService } from './QuoteComparisonService';
import { ExchangeRateService } from './ExchangeRateService';
import type {
  SupplierPortalResponseItemInput,
  SupplierPortalResponseSubmitInput,
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
    const totalItems = input.payload.items.length;
    const computedTotal = input.payload.items.reduce(
      (sum, item) => sum + Number(item.totalPrice),
      0,
    );
    if (Math.abs(computedTotal - Number(input.payload.totalPrice)) > 0.01) {
      throw new HttpError(
        400,
        'O total informado nao corresponde a soma dos itens.',
      );
    }

    const quoteRequestItems = await client.quoteRequestItem.findMany({
      where: { quoteRequestId: input.quoteRequestId },
      select: { id: true, productName: true, catalogItem: { select: { marketName: true } } },
    });
    const itemIdSet = new Set(quoteRequestItems.map((item) => item.id));
    for (const item of input.payload.items) {
      if (!itemIdSet.has(item.quoteRequestItemId)) {
        throw new HttpError(
          400,
          `Item invalido na resposta (id=${item.quoteRequestItemId}).`,
        );
      }
    }

    const currency = input.payload.currency ?? 'USD';
    const scalarData = {
      currency,
      incoterm: input.payload.incoterm,
      paymentTermsDays: input.payload.paymentTermsDays,
      totalPrice: new Prisma.Decimal(input.payload.totalPrice),
      totalPriceCurrency: input.payload.totalPriceCurrency ?? currency,
      validityDays: input.payload.validityDays,
      notes: input.payload.notes ?? null,
      submitterIp: input.meta?.ip ?? null,
      submitterUserAgent: input.meta?.userAgent ?? null,
    };
    const itemsCreate = input.payload.items.map(
      (item: SupplierPortalResponseItemInput) => ({
        quoteRequestItemId: item.quoteRequestItemId,
        unitPrice: new Prisma.Decimal(item.unitPrice),
        quantity: item.quantity,
        totalPrice: new Prisma.Decimal(item.totalPrice),
        leadTimeDays: item.leadTimeDays ?? null,
        notes: item.notes ?? null,
      }),
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
            submittedAt: existing.submittedAt,
            items: existing.items.map((it) => ({
              quoteRequestItemId: it.quoteRequestItemId,
              unitPrice: it.unitPrice.toString(),
              quantity: it.quantity,
              totalPrice: it.totalPrice.toString(),
              leadTimeDays: it.leadTimeDays,
              notes: it.notes,
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
        where: { id: input.tokenId },
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
  const firstItem = items[0];
  const offeredPrice = firstItem
    ? Number(firstItem.unitPrice)
    : Number(input.portalResponse.totalPrice);
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
      'Informe a taxa de cambio (exchangeRate) ao enviar respostas em moeda estrangeira.',
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
  const leadTimeDays = computeAverageLeadTime(items);

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
    submittedAt,
  } satisfies Partial<Prisma.QuoteResponseUncheckedCreateInput>;

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
    },
    update: {
      ...data,
      version: { increment: 1 },
    },
  });
}

async function resolveExchangeRate(
  tx: Prisma.TransactionClient,
  quoteRequestId: number,
  currency: string,
): Promise<number> {
  const existing = await tx.quoteResponse.findFirst({
    where: { quoteRequestId, currency: { equals: currency, mode: 'insensitive' } },
    orderBy: { updatedAt: 'desc' },
    select: { exchangeRate: true },
  });
  const candidate = existing ? Number(existing.exchangeRate) : 0;
  if (candidate > 0) {
    return candidate;
  }
  const fallback = await tx.quoteResponse.findFirst({
    where: { quoteRequestId },
    orderBy: { updatedAt: 'desc' },
    select: { exchangeRate: true },
  });
  const fallbackValue = fallback ? Number(fallback.exchangeRate) : 0;
  if (fallbackValue > 0) {
    return fallbackValue;
  }
  // Tenta usar o cache local de PTAX (BCB). So considera o valor atual
  // (mesma data ou anterior) para nao misturar taxas de dias muito antigos.
  const cached = await ExchangeRateService.getRateToBrl(currency, tx as PrismaClient);
  if (cached && cached.rateToBrl > 0) {
    return cached.rateToBrl;
  }
  throw new HttpError(
    400,
    'Informe a taxa de cambio (exchangeRate) ao enviar respostas em moeda estrangeira.',
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
