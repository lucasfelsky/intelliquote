import { api } from '@/api/client';

export type CommercialRequestStatus = 'pending' | 'quoting' | 'fulfilled' | 'rejected';

export const COMMERCIAL_REQUEST_UNITS = ['KG', 'UN', 'M3', 'L', 'TON', 'BOX'] as const;
export type CommercialRequestUnit = (typeof COMMERCIAL_REQUEST_UNITS)[number];

export const COMMERCIAL_REQUEST_STATUS_LABELS: Record<CommercialRequestStatus, string> = {
  pending: 'Pendente',
  quoting: 'Em cotação',
  fulfilled: 'Atendida',
  rejected: 'Recusada',
};

export interface CommercialCatalogItem {
  id: number;
  commercialName: string;
  familyName: string | null;
}

export interface CommercialRequestItemForCommercial {
  id: number;
  catalogItemId: number;
  commercialName: string;
  quantity: number;
  unit: string;
  targetPrice: string | null;
  targetCurrency: string | null;
}

/** Projecao do comercial: sem nome de mercado, codigo DBCorp, fornecedor ou solicitante. */
export interface CommercialRequestForCommercial {
  id: number;
  status: CommercialRequestStatus;
  customerName: string | null;
  notes: string | null;
  rejectionReason: string | null;
  createdAt: string;
  statusChangedAt: string | null;
  quote: { requestCode: string } | null;
  items: CommercialRequestItemForCommercial[];
}

export interface CommercialRequestItemForComex extends CommercialRequestItemForCommercial {
  marketName: string;
  dbcorpCode: string | null;
}

export interface CommercialRequestForComex {
  id: number;
  status: CommercialRequestStatus;
  customerName: string | null;
  notes: string | null;
  rejectionReason: string | null;
  createdAt: string;
  statusChangedAt: string | null;
  requestedBy: { id: number; name: string; email: string };
  statusChangedBy: { id: number; name: string } | null;
  quoteRequest: { id: number; requestCode: string; status: string } | null;
  items: CommercialRequestItemForComex[];
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export interface CommercialRequestItemInput {
  catalogItemId: number;
  quantity: number;
  unit: CommercialRequestUnit;
  targetPrice?: number | null;
  targetCurrency?: string;
}

export interface CommercialRequestInput {
  customerName?: string | null;
  notes?: string | null;
  items: CommercialRequestItemInput[];
}

const QUANTITY_FORMAT = new Intl.NumberFormat('pt-BR');
const PRICE_FORMAT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12000 -> "12.000" (pt-BR). */
export function formatCommercialQuantity(quantity: number): string {
  return QUANTITY_FORMAT.format(quantity);
}

/** "1.85" + "USD" -> "1,85 USD" (pt-BR); sem preco -> "—". */
export function formatCommercialPrice(price: string | null, currency: string | null): string {
  if (price === null || price === '') return '—';
  const value = Number(price);
  const formatted = Number.isFinite(value) ? PRICE_FORMAT.format(value) : price;
  return `${formatted} ${currency ?? ''}`.trim();
}

export function searchCommercialCatalog(search: string): Promise<CommercialCatalogItem[]> {
  return api.get<CommercialCatalogItem[]>('/api/v1/commercial-requests/catalog-items', { search });
}

export function createCommercialRequest(
  input: CommercialRequestInput,
): Promise<CommercialRequestForCommercial> {
  return api.post<CommercialRequestForCommercial>(
    '/api/v1/commercial-requests',
    input as unknown as Record<string, unknown>,
  );
}

export function listMyCommercialRequests(params?: {
  page?: number;
  status?: CommercialRequestStatus;
}): Promise<PaginatedResult<CommercialRequestForCommercial>> {
  return api.get<PaginatedResult<CommercialRequestForCommercial>>(
    '/api/v1/commercial-requests/mine',
    { page: params?.page, status: params?.status },
  );
}

export function listCommercialRequests(params?: {
  page?: number;
  status?: CommercialRequestStatus | '';
  requestedById?: number | '';
}): Promise<PaginatedResult<CommercialRequestForComex>> {
  return api.get<PaginatedResult<CommercialRequestForComex>>('/api/v1/commercial-requests', {
    page: params?.page,
    status: params?.status || undefined,
    requestedById: params?.requestedById || undefined,
  });
}

export function getCommercialRequestsPendingCount(): Promise<{ count: number }> {
  return api.get<{ count: number }>('/api/v1/commercial-requests/pending-count');
}

export function listCommercialRequesters(): Promise<Array<{ id: number; name: string }>> {
  return api.get<Array<{ id: number; name: string }>>('/api/v1/commercial-requests/requesters');
}
