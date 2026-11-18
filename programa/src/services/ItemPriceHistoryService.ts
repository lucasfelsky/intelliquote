import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  buildSnapshotItems,
  type PriceSnapshotIncotermPrice,
  type PriceSnapshotItem,
} from './QuoteResponsePriceHistoryService';

/**
 * Historico de preco COMPLETO de um item, cruzando todas as cotacoes ligadas ao mesmo
 * CatalogItem (QuoteRequestItem.catalogItemId). Fonte: QuoteResponsePriceSnapshot
 * (append-only, manual + portal); resposta sem nenhum snapshot (anterior a 2026-10-12)
 * cai no estado atual do QuoteResponseItem, com origem 'legado'.
 *
 * Preco ofertado puro, na moeda do fornecedor: sem landed cost e sem cambio.
 */

export const ITEM_PRICE_HISTORY_MAX_ENTRIES = 300;

export type ItemPriceHistorySource = 'portal' | 'manual' | 'legado';

export interface ItemPriceHistoryEntry {
  recordedAt: Date;
  quoteRequestId: number;
  requestCode: string;
  isCurrentQuote: boolean;
  supplierId: number;
  supplierName: string;
  source: ItemPriceHistorySource;
  incoterm: string;
  currency: string;
  unit: string;
  quantity: number;
  unitPrice: string;
  incotermPrices: PriceSnapshotIncotermPrice[];
  variationPct: number | null;
}

export interface ItemPriceHistoryResult {
  item: {
    id: number;
    catalogItemId: number | null;
    name: string;
    marketName: string | null;
    unit: string;
  };
  linkedBy: 'catalogItemId' | 'quoteRequestItem';
  entries: ItemPriceHistoryEntry[];
  truncated: boolean;
}

export interface ItemPriceHistoryTarget {
  id: number;
  quoteRequestId: number;
  unit: string;
}

export interface ItemPriceHistoryResponseInput {
  id: number;
  quoteRequestId: number;
  requestCode: string;
  supplierId: number;
  supplierName: string;
  submittedAt: Date;
  currency: string;
  offeredIncoterm: string;
  snapshots: Array<{
    id: number;
    recordedAt: Date;
    source: string;
    currency: string;
    offeredIncoterm: string;
    items: unknown;
  }>;
  items: Array<{
    quoteRequestItemId: number;
    unitPrice: unknown;
    quantity: number;
    isUnavailable: boolean;
    incotermPrices: unknown;
  }>;
}

interface RawEntry extends Omit<ItemPriceHistoryEntry, 'variationPct'> {
  order: number;
}

function priceKey(currency: string, incoterm: string, item: PriceSnapshotItem): string {
  const alternatives = item.incotermPrices
    ? item.incotermPrices.map((entry) => `${entry.incoterm}=${entry.unitPrice}`).join(',')
    : '-';
  return `${currency}|${incoterm}|${item.unitPrice}|${item.isUnavailable ? 1 : 0}|${alternatives}`;
}

function alternativesOf(item: PriceSnapshotItem, mainIncoterm: string): PriceSnapshotIncotermPrice[] {
  return (item.incotermPrices ?? []).filter((entry) => entry.incoterm !== mainIncoterm);
}

function variation(current: number, previous: number | undefined): number | null {
  if (previous === undefined || !Number.isFinite(previous) || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return Math.round(pct * 100) / 100;
}

/**
 * Funcao pura: transforma respostas (com snapshots) em linhas de historico do item.
 * - uma linha por (resposta, snapshot) em que o preco DESTE item mudou;
 * - item indisponivel fica fora; resposta sem snapshot usa o estado atual ('legado');
 * - variacao vs a linha anterior da mesma serie fornecedor+moeda+incoterm+unidade;
 * - ordem de saida: mais recente primeiro, teto de 300 linhas.
 */
export function buildItemPriceHistoryEntries(input: {
  currentQuoteRequestId: number;
  targets: ItemPriceHistoryTarget[];
  responses: ItemPriceHistoryResponseInput[];
}): { entries: ItemPriceHistoryEntry[]; truncated: boolean } {
  const targetById = new Map(input.targets.map((target) => [target.id, target]));
  const raw: RawEntry[] = [];
  let order = 0;

  for (const response of input.responses) {
    const base = {
      quoteRequestId: response.quoteRequestId,
      requestCode: response.requestCode,
      isCurrentQuote: response.quoteRequestId === input.currentQuoteRequestId,
      supplierId: response.supplierId,
      supplierName: response.supplierName,
    };

    if (response.snapshots.length === 0) {
      for (const item of buildSnapshotItems(response.items)) {
        const target = targetById.get(item.quoteRequestItemId);
        if (!target || item.isUnavailable) continue;
        raw.push({
          ...base,
          recordedAt: response.submittedAt,
          source: 'legado',
          incoterm: response.offeredIncoterm,
          currency: response.currency,
          unit: target.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          incotermPrices: alternativesOf(item, response.offeredIncoterm),
          order: order++,
        });
      }
      continue;
    }

    const snapshots = [...response.snapshots].sort(
      (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || a.id - b.id,
    );
    const lastKeyByItem = new Map<number, string>();
    for (const snapshot of snapshots) {
      for (const item of buildSnapshotItems(snapshot.items)) {
        const target = targetById.get(item.quoteRequestItemId);
        if (!target) continue;
        const key = priceKey(snapshot.currency, snapshot.offeredIncoterm, item);
        if (lastKeyByItem.get(item.quoteRequestItemId) === key) continue;
        lastKeyByItem.set(item.quoteRequestItemId, key);
        if (item.isUnavailable) continue;
        raw.push({
          ...base,
          recordedAt: snapshot.recordedAt,
          source: snapshot.source === 'portal' ? 'portal' : 'manual',
          incoterm: snapshot.offeredIncoterm,
          currency: snapshot.currency,
          unit: target.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          incotermPrices: alternativesOf(item, snapshot.offeredIncoterm),
          order: order++,
        });
      }
    }
  }

  const chronological = [...raw].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || a.order - b.order,
  );
  const lastPriceBySeries = new Map<string, number>();
  const withVariation: ItemPriceHistoryEntry[] = chronological.map((entry) => {
    const { order: _order, ...rest } = entry;
    const series = `${entry.supplierId}|${entry.currency}|${entry.incoterm}|${entry.unit}`;
    const price = Number(entry.unitPrice);
    const variationPct = variation(price, lastPriceBySeries.get(series));
    lastPriceBySeries.set(series, price);
    return { ...rest, variationPct };
  });

  const descending = withVariation.reverse();
  const truncated = descending.length > ITEM_PRICE_HISTORY_MAX_ENTRIES;
  return {
    entries: truncated ? descending.slice(0, ITEM_PRICE_HISTORY_MAX_ENTRIES) : descending,
    truncated,
  };
}

export class ItemPriceHistoryService {
  /** null = item (ou cotacao) inexistente/apagado. */
  static async listByQuoteRequestItem(
    quoteRequestItemId: number,
    client: PrismaClient | Prisma.TransactionClient = prisma,
  ): Promise<ItemPriceHistoryResult | null> {
    const item = await client.quoteRequestItem.findFirst({
      where: { id: quoteRequestItemId, deletedAt: null, quoteRequest: { deletedAt: null } },
      select: {
        id: true,
        quoteRequestId: true,
        catalogItemId: true,
        productName: true,
        itemCode: true,
        unit: true,
        catalogItem: { select: { commercialName: true, marketName: true } },
      },
    });
    if (!item) return null;

    const targets: ItemPriceHistoryTarget[] =
      item.catalogItemId !== null
        ? await client.quoteRequestItem.findMany({
            where: {
              catalogItemId: item.catalogItemId,
              deletedAt: null,
              quoteRequest: { deletedAt: null },
            },
            select: { id: true, quoteRequestId: true, unit: true },
          })
        : [{ id: item.id, quoteRequestId: item.quoteRequestId, unit: item.unit }];

    const responses = targets.length
      ? await client.quoteResponse.findMany({
          where: {
            deletedAt: null,
            quoteRequestId: { in: Array.from(new Set(targets.map((target) => target.quoteRequestId))) },
            supplier: { deletedAt: null },
          },
          select: {
            id: true,
            quoteRequestId: true,
            supplierId: true,
            submittedAt: true,
            currency: true,
            offeredIncoterm: true,
            supplier: { select: { name: true } },
            quoteRequest: { select: { requestCode: true } },
            priceSnapshots: {
              orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                recordedAt: true,
                source: true,
                currency: true,
                offeredIncoterm: true,
                items: true,
              },
            },
            items: {
              where: { deletedAt: null, quoteRequestItemId: { in: targets.map((target) => target.id) } },
              select: {
                quoteRequestItemId: true,
                unitPrice: true,
                quantity: true,
                isUnavailable: true,
                incotermPrices: true,
              },
            },
          },
        })
      : [];

    const { entries, truncated } = buildItemPriceHistoryEntries({
      currentQuoteRequestId: item.quoteRequestId,
      targets,
      responses: responses.map((response) => ({
        id: response.id,
        quoteRequestId: response.quoteRequestId,
        requestCode: response.quoteRequest.requestCode,
        supplierId: response.supplierId,
        supplierName: response.supplier.name,
        submittedAt: response.submittedAt,
        currency: response.currency,
        offeredIncoterm: response.offeredIncoterm,
        snapshots: response.priceSnapshots,
        items: response.items,
      })),
    });

    return {
      item: {
        id: item.id,
        catalogItemId: item.catalogItemId,
        name: item.catalogItem?.commercialName ?? item.productName,
        marketName: item.catalogItem?.marketName ?? null,
        unit: item.unit,
      },
      linkedBy: item.catalogItemId !== null ? 'catalogItemId' : 'quoteRequestItem',
      entries,
      truncated,
    };
  }
}
