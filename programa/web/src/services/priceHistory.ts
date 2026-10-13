import { api } from '@/api/client';

// Historico de preco por resposta do fornecedor (GET /quote-responses/:id/price-history).
// Modulo separado de quoteResponses/dispatch para nao mexer nas factories mockadas nos testes.

export interface PriceHistoryColumn {
  quoteRequestItemId: number;
  productName: string;
  itemCode: string | null;
  unit: string;
}

export interface PriceHistoryIncotermPrice {
  incoterm: string;
  unitPrice: string;
  totalPrice: string | null;
}

export interface PriceHistoryItem {
  quoteRequestItemId: number;
  unitPrice: string;
  quantity: number;
  totalPrice: string;
  isUnavailable: boolean;
  incotermPrices: PriceHistoryIncotermPrice[] | null;
}

export type PriceHistoryChangedField = 'currency' | 'offeredIncoterm' | 'offeredPrice';

export interface PriceHistoryRow {
  id: number;
  recordedAt: string;
  source: 'portal' | 'manual' | string;
  actorName: string | null;
  performedById: number | null;
  supplierContactId: number | null;
  currency: string;
  offeredIncoterm: string;
  offeredPrice: string;
  items: PriceHistoryItem[];
  changedItemIds: number[];
  changedFields: PriceHistoryChangedField[];
}

export interface PriceHistoryResult {
  columns: PriceHistoryColumn[];
  rows: PriceHistoryRow[];
}

export function priceHistoryQueryKey(quoteResponseId: number) {
  return ['quote-responses', quoteResponseId, 'price-history'] as const;
}

export async function getPriceHistory(quoteResponseId: number): Promise<PriceHistoryResult> {
  return api.get<PriceHistoryResult>(`/v1/quote-responses/${quoteResponseId}/price-history`);
}
