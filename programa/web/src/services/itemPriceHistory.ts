import { api } from '@/api/client';

// Histórico de preço de um item da cotação, cruzando as cotações ligadas ao mesmo item do
// catálogo (GET /quote-request-items/:id/price-history). Preço ofertado puro, na moeda do fornecedor.

export interface ItemPriceHistoryIncotermPrice {
  incoterm: string;
  unitPrice: string;
  totalPrice: string | null;
}

export type ItemPriceHistorySource = 'portal' | 'manual' | 'legado';

export interface ItemPriceHistoryEntry {
  recordedAt: string;
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
  incotermPrices: ItemPriceHistoryIncotermPrice[];
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

export function itemPriceHistoryQueryKey(quoteRequestItemId: number) {
  return ['quote-request-items', quoteRequestItemId, 'price-history'] as const;
}

export async function getItemPriceHistory(quoteRequestItemId: number): Promise<ItemPriceHistoryResult> {
  return api.get<ItemPriceHistoryResult>(`/v1/quote-request-items/${quoteRequestItemId}/price-history`);
}
