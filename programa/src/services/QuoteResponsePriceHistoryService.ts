import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Historico append-only de preco por resposta do fornecedor (QuoteResponsePriceSnapshot).
 *
 * `record` fotografa o estado atual da resposta (moeda, incoterm principal, total e itens
 * ativos) na MESMA transacao da escrita; se nada de preco mudou em relacao ao ultimo
 * snapshot, nao grava (reenvio identico nao gera linha). `listByQuoteResponse` devolve
 * colunas (itens) e linhas (versoes) com o que mudou vs a linha anterior ja calculado.
 */

export type PriceSnapshotSource = 'portal' | 'manual';

export interface PriceSnapshotIncotermPrice {
  incoterm: string;
  unitPrice: string;
  totalPrice: string | null;
}

export interface PriceSnapshotItem {
  quoteRequestItemId: number;
  unitPrice: string;
  quantity: number;
  totalPrice: string;
  isUnavailable: boolean;
  incotermPrices: PriceSnapshotIncotermPrice[] | null;
}

export interface PriceSnapshotState {
  currency: string;
  offeredIncoterm: string;
  offeredPrice: string | number | Prisma.Decimal;
  items: PriceSnapshotItem[];
}

export interface PriceSnapshotActor {
  source: PriceSnapshotSource;
  performedById?: number | null;
  supplierContactId?: number | null;
}

export interface PriceHistoryColumn {
  quoteRequestItemId: number;
  productName: string;
  itemCode: string | null;
  unit: string;
}

export type PriceHistoryChangedField = 'currency' | 'offeredIncoterm' | 'offeredPrice';

export interface PriceHistoryRow {
  id: number;
  recordedAt: Date;
  source: string;
  actorName: string | null;
  performedById: number | null;
  supplierContactId: number | null;
  currency: string;
  offeredIncoterm: string;
  offeredPrice: string;
  items: PriceSnapshotItem[];
  changedItemIds: number[];
  changedFields: PriceHistoryChangedField[];
}

export interface PriceHistoryResult {
  columns: PriceHistoryColumn[];
  rows: PriceHistoryRow[];
}

function money(value: unknown): string {
  if (value === null || value === undefined || value === '') return '0.00';
  const num = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

function normalizeIncotermPrices(raw: unknown): PriceSnapshotIncotermPrice[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: PriceSnapshotIncotermPrice[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.incoterm !== 'string') continue;
    entries.push({
      incoterm: obj.incoterm,
      unitPrice: money(obj.unitPrice),
      totalPrice: obj.totalPrice === null || obj.totalPrice === undefined ? null : money(obj.totalPrice),
    });
  }
  entries.sort((a, b) => a.incoterm.localeCompare(b.incoterm));
  return entries;
}

/** Converte itens de QuoteResponseItem (ou JSON de snapshot) no formato gravado. */
export function buildSnapshotItems(items: unknown): PriceSnapshotItem[] {
  if (!Array.isArray(items)) return [];
  const normalized: PriceSnapshotItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const quoteRequestItemId = Number(obj.quoteRequestItemId);
    if (!Number.isInteger(quoteRequestItemId) || quoteRequestItemId <= 0) continue;
    normalized.push({
      quoteRequestItemId,
      unitPrice: money(obj.unitPrice),
      quantity: Number.isFinite(Number(obj.quantity)) ? Number(obj.quantity) : 0,
      totalPrice: money(obj.totalPrice),
      isUnavailable: Boolean(obj.isUnavailable),
      incotermPrices: normalizeIncotermPrices(obj.incotermPrices),
    });
  }
  normalized.sort((a, b) => a.quoteRequestItemId - b.quoteRequestItemId);
  return normalized;
}

function itemKey(item: PriceSnapshotItem): string {
  const incoterms = item.incotermPrices
    ? item.incotermPrices.map((entry) => `${entry.incoterm}=${entry.unitPrice}`).join(',')
    : '-';
  return `${item.quoteRequestItemId}:${item.unitPrice}:${item.quantity}:${item.isUnavailable ? 1 : 0}:${incoterms}`;
}

/** Chave deterministica do estado de preco; dois estados com a mesma chave nao geram linha nova. */
export function buildSnapshotKey(state: PriceSnapshotState): string {
  const items = buildSnapshotItems(state.items);
  return [
    state.currency,
    state.offeredIncoterm,
    money(state.offeredPrice),
    items.map(itemKey).join(';'),
  ].join('|');
}

async function resolveActorName(
  tx: Prisma.TransactionClient,
  actor: PriceSnapshotActor,
): Promise<string | null> {
  try {
    if (actor.source === 'manual' && actor.performedById) {
      const user = await tx.user.findUnique({
        where: { id: actor.performedById },
        select: { name: true },
      });
      return user?.name ?? null;
    }
    if (actor.source === 'portal' && actor.supplierContactId) {
      const contact = await tx.supplierContact.findUnique({
        where: { id: actor.supplierContactId },
        select: { name: true, email: true },
      });
      if (!contact) return null;
      return contact.email ? `${contact.name} <${contact.email}>` : contact.name;
    }
  } catch (error) {
    logger.warn({ err: error, actor }, 'price-history: falha ao resolver o autor do snapshot');
  }
  return null;
}

export class QuoteResponsePriceHistoryService {
  /**
   * Grava um snapshot do estado atual da resposta se algo de preco mudou desde o ultimo.
   * Deve rodar dentro da transacao que escreveu a resposta. Retorna null quando nao grava
   * (resposta inexistente ou estado identico ao ultimo snapshot).
   */
  static async record(
    tx: Prisma.TransactionClient,
    quoteResponseId: number,
    actor: PriceSnapshotActor,
  ) {
    const response = await tx.quoteResponse.findUnique({
      where: { id: quoteResponseId },
      include: { items: { where: { deletedAt: null } } },
    });
    if (!response) return null;

    const items = buildSnapshotItems(response.items);
    const state: PriceSnapshotState = {
      currency: response.currency,
      offeredIncoterm: response.offeredIncoterm,
      offeredPrice: response.offeredPrice,
      items,
    };
    const key = buildSnapshotKey(state);

    const last = await tx.quoteResponsePriceSnapshot.findFirst({
      where: { quoteResponseId },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    });
    if (last) {
      const lastKey = buildSnapshotKey({
        currency: last.currency,
        offeredIncoterm: last.offeredIncoterm,
        offeredPrice: last.offeredPrice,
        items: buildSnapshotItems(last.items),
      });
      if (lastKey === key) return null;
    }

    const actorName = await resolveActorName(tx, actor);

    return tx.quoteResponsePriceSnapshot.create({
      data: {
        quoteResponseId,
        source: actor.source,
        performedById: actor.performedById ?? null,
        supplierContactId: actor.supplierContactId ?? null,
        actorName,
        currency: response.currency,
        offeredIncoterm: response.offeredIncoterm,
        offeredPrice: money(response.offeredPrice),
        items: items as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Historico completo de uma resposta: colunas = itens citados em qualquer versao; linhas em ordem cronologica. */
  static async listByQuoteResponse(
    quoteResponseId: number,
    client: PrismaClient | Prisma.TransactionClient = prisma,
  ): Promise<PriceHistoryResult> {
    const snapshots = await client.quoteResponsePriceSnapshot.findMany({
      where: { quoteResponseId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });

    const parsed = snapshots.map((snapshot) => ({
      snapshot,
      items: buildSnapshotItems(snapshot.items),
    }));

    const itemIds = new Set<number>();
    for (const entry of parsed) {
      for (const item of entry.items) itemIds.add(item.quoteRequestItemId);
    }

    // Sem filtro de deletedAt de proposito: item removido da cotacao continua
    // aparecendo nas versoes antigas do historico.
    const quoteRequestItems = itemIds.size
      ? await client.quoteRequestItem.findMany({
          where: { id: { in: Array.from(itemIds) } },
          orderBy: { id: 'asc' },
          select: { id: true, productName: true, itemCode: true, unit: true },
        })
      : [];
    const byId = new Map(quoteRequestItems.map((item) => [item.id, item]));
    const columns: PriceHistoryColumn[] = Array.from(itemIds)
      .sort((a, b) => a - b)
      .map((id) => {
        const item = byId.get(id);
        return {
          quoteRequestItemId: id,
          productName: item?.productName ?? `Item #${id}`,
          itemCode: item?.itemCode ?? null,
          unit: item?.unit ?? 'UN',
        };
      });

    const rows: PriceHistoryRow[] = [];
    let previous: { snapshot: (typeof snapshots)[number]; items: PriceSnapshotItem[] } | null = null;
    for (const entry of parsed) {
      const changedFields: PriceHistoryChangedField[] = [];
      const changedItemIds: number[] = [];
      if (previous) {
        if (previous.snapshot.currency !== entry.snapshot.currency) changedFields.push('currency');
        if (previous.snapshot.offeredIncoterm !== entry.snapshot.offeredIncoterm) changedFields.push('offeredIncoterm');
        if (money(previous.snapshot.offeredPrice) !== money(entry.snapshot.offeredPrice)) changedFields.push('offeredPrice');
        const previousKeys = new Map(previous.items.map((item) => [item.quoteRequestItemId, itemKey(item)]));
        const currentKeys = new Map(entry.items.map((item) => [item.quoteRequestItemId, itemKey(item)]));
        for (const id of itemIds) {
          const before = previousKeys.get(id);
          const after = currentKeys.get(id);
          if (before !== after) changedItemIds.push(id);
        }
        changedItemIds.sort((a, b) => a - b);
      }
      rows.push({
        id: entry.snapshot.id,
        recordedAt: entry.snapshot.recordedAt,
        source: entry.snapshot.source,
        actorName: entry.snapshot.actorName,
        performedById: entry.snapshot.performedById,
        supplierContactId: entry.snapshot.supplierContactId,
        currency: entry.snapshot.currency,
        offeredIncoterm: entry.snapshot.offeredIncoterm,
        offeredPrice: money(entry.snapshot.offeredPrice),
        items: entry.items,
        changedItemIds,
        changedFields,
      });
      previous = entry;
    }

    return { columns, rows };
  }
}
