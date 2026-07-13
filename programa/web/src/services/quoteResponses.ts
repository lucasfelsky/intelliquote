// Helpers para a página de Respostas e Comparações.
// - Prisma Decimal chega como string (ou number) e precisa ser normalizado
//   para número antes de qualquer cálculo ou formatação.
// - Mantemos aqui tipos compartilhados para evitar divergência entre
//   as páginas que consomem esses endpoints.

import { api, ApiError } from '@/api/client';

export type Incoterm =
  | 'EXW' | 'FCA' | 'FAS' | 'FOB' | 'CFR' | 'CIF'
  | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP';

export const INCOTERMS: Incoterm[] = [
  'EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF',
  'CPT', 'CIP', 'DAP', 'DPU', 'DDP',
];

export interface QuoteResponse {
  id: number;
  quoteRequestId: number;
  supplierId: number;
  offeredPrice: number;
  currency: string;
  exchangeRate: number | null;
  freightCost: number;
  insuranceCost: number;
  otherFees: number;
  importDuty: number;
  ipi: number;
  pis: number;
  cofins: number;
  offeredIncoterm: Incoterm;
  paymentTermsDays: number;
  leadTimeDays: number | null;
  notes: string | null;
  isWinner: boolean;
  totalLandedCost: number;
  submittedAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  source?: 'manual' | 'portal';
  supplier?: {
    id: number;
    name: string;
    country?: string | null;
    status?: 'active' | 'inactive' | 'blocked';
  };
  quoteRequest?: {
    id: number;
    requestCode: string;
    productName: string;
    status: 'open' | 'closed';
    currency: string;
  };
}

export interface QuoteResponsePayload {
  quoteRequestId: number;
  supplierId: number;
  offeredPrice: number;
  currency: string;
  exchangeRate?: number | null;
  freightCost: number;
  insuranceCost: number;
  otherFees: number;
  importDuty: number;
  ipi: number;
  pis: number;
  cofins: number;
  offeredIncoterm: Incoterm;
  paymentTermsDays: number;
  notes?: string | null;
}

export interface ComparisonResult {
  id?: number;
  quoteResponseId?: number;
  supplierId: number;
  supplier?: { id: number; name: string };
  contact?: { id?: number; name: string; email: string } | null;
  offeredPrice: number;
  offeredIncoterm: Incoterm;
  paymentTermsDays: number;
  exchangeRate: number | null;
  freightCost: number;
  insuranceCost: number;
  otherFees: number;
  importDutyRate: number;
  ipiRate: number;
  pisRate: number;
  cofinsRate: number;
  cifValue: number;
  importDutyAmount: number;
  ipiAmount: number;
  pisCofinsAmount: number;
  totalLandedCost: number;
  priceScore: number;
  paymentTermsScore: number;
  incotermScore: number;
  totalScore: number;
  isWinner: boolean;
}

export interface ComparisonRecord {
  id: number;
  quoteRequestId: number;
  executedById: number | null;
  executedBy?: { id: number; name: string; email: string } | null;
  priceWeight: number;
  paymentTermsWeight: number;
  incotermWeight: number;
  winnerQuoteResponseId: number | null;
  createdAt: string;
  results: ComparisonResult[];
}

export interface ComparisonHistoryResponse {
  quoteRequestId: number;
  comparisons: ComparisonRecord[];
}

export interface ComparisonWeights {
  priceWeight: number;
  paymentTermsWeight: number;
  incotermWeight: number;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (value && typeof value === 'object' && 'toString' in value) {
    const n = Number(String(value));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asIncoterm(value: unknown): Incoterm {
  const v = String(value ?? '').toUpperCase();
  return (INCOTERMS as readonly string[]).includes(v) ? (v as Incoterm) : 'EXW';
}

export function normalizeResponse(raw: unknown): QuoteResponse {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Resposta inesperada do servidor.');
  }
  const obj = raw as Record<string, unknown>;
  const supplierRaw = obj.supplier as Record<string, unknown> | undefined;
  const qrRaw = obj.quoteRequest as Record<string, unknown> | undefined;
  const source =
    typeof obj.source === 'string' && obj.source === 'portal' ? 'portal' : 'manual';
  return {
    id: asNumber(obj.id),
    quoteRequestId: asNumber(obj.quoteRequestId),
    supplierId: asNumber(obj.supplierId),
    offeredPrice: asNumber(obj.offeredPrice),
    currency: String(obj.currency ?? 'USD').toUpperCase(),
    exchangeRate: obj.exchangeRate === null || obj.exchangeRate === undefined
      ? null
      : asNumber(obj.exchangeRate),
    freightCost: asNumber(obj.freightCost),
    insuranceCost: asNumber(obj.insuranceCost),
    otherFees: asNumber(obj.otherFees),
    importDuty: asNumber(obj.importDuty),
    ipi: asNumber(obj.ipi),
    pis: asNumber(obj.pis),
    cofins: asNumber(obj.cofins),
    offeredIncoterm: asIncoterm(obj.offeredIncoterm),
    paymentTermsDays: asNumber(obj.paymentTermsDays),
    leadTimeDays: obj.leadTimeDays === null || obj.leadTimeDays === undefined
      ? null
      : asNumber(obj.leadTimeDays),
    notes: (obj.notes as string | null) ?? null,
    isWinner: Boolean(obj.isWinner),
    totalLandedCost: asNumber(obj.totalLandedCost),
    submittedAt: String(obj.submittedAt ?? obj.createdAt ?? ''),
    version: asNumber(obj.version ?? 1) || 1,
    createdAt: String(obj.createdAt ?? ''),
    updatedAt: String(obj.updatedAt ?? ''),
    source,
    supplier: supplierRaw
      ? {
          id: asNumber(supplierRaw.id),
          name: String(supplierRaw.name ?? ''),
          country: (supplierRaw.country as string | null) ?? undefined,
          status: supplierRaw.status as 'active' | 'inactive' | 'blocked' | undefined,
        }
      : undefined,
    quoteRequest: qrRaw
      ? {
          id: asNumber(qrRaw.id),
          requestCode: String(qrRaw.requestCode ?? ''),
          productName: String(qrRaw.productName ?? ''),
          status: (qrRaw.status as 'open' | 'closed') ?? 'open',
          currency: String(qrRaw.currency ?? 'USD').toUpperCase(),
        }
      : undefined,
  };
}

export function normalizeComparisonResult(raw: unknown): ComparisonResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Resposta inesperada do servidor.');
  }
  const obj = raw as Record<string, unknown>;
  // O endpoint /compare devolve `supplier`/`contact` no nivel topo; o de
  // historico aninha o fornecedor em `quoteResponse.supplier` (com o contato
  // principal em `contacts[0]`). Lemos ambos os formatos.
  const quoteResponseRaw = obj.quoteResponse as Record<string, unknown> | undefined;
  const supplierRaw =
    (obj.supplier as Record<string, unknown> | undefined) ??
    (quoteResponseRaw?.supplier as Record<string, unknown> | undefined);
  const contactRaw =
    (obj.contact as Record<string, unknown> | null | undefined) ??
    (Array.isArray((supplierRaw as { contacts?: unknown })?.contacts)
      ? ((supplierRaw as { contacts?: Record<string, unknown>[] }).contacts?.[0] ?? null)
      : null);
  return {
    id: obj.id !== undefined && obj.id !== null ? asNumber(obj.id) : undefined,
    quoteResponseId: obj.quoteResponseId !== undefined && obj.quoteResponseId !== null
      ? asNumber(obj.quoteResponseId)
      : undefined,
    supplierId: asNumber(obj.supplierId),
    supplier: supplierRaw
      ? {
          id: asNumber(supplierRaw.id),
          name: String(supplierRaw.name ?? ''),
        }
      : undefined,
    contact: contactRaw
      ? {
          id: contactRaw.id !== undefined && contactRaw.id !== null ? asNumber(contactRaw.id) : undefined,
          name: String(contactRaw.name ?? ''),
          email: String(contactRaw.email ?? ''),
        }
      : null,
    offeredPrice: asNumber(obj.offeredPrice),
    offeredIncoterm: asIncoterm(obj.offeredIncoterm),
    paymentTermsDays: asNumber(obj.paymentTermsDays),
    exchangeRate: obj.exchangeRate === null || obj.exchangeRate === undefined
      ? null
      : asNumber(obj.exchangeRate),
    freightCost: asNumber(obj.freightCost),
    insuranceCost: asNumber(obj.insuranceCost),
    otherFees: asNumber(obj.otherFees),
    importDutyRate: asNumber(obj.importDutyRate),
    ipiRate: asNumber(obj.ipiRate),
    pisRate: asNumber(obj.pisRate),
    cofinsRate: asNumber(obj.cofinsRate),
    cifValue: asNumber(obj.cifValue),
    importDutyAmount: asNumber(obj.importDutyAmount),
    ipiAmount: asNumber(obj.ipiAmount),
    pisCofinsAmount: asNumber(obj.pisCofinsAmount),
    totalLandedCost: asNumber(obj.totalLandedCost),
    priceScore: asNumber(obj.priceScore),
    paymentTermsScore: asNumber(obj.paymentTermsScore),
    incotermScore: asNumber(obj.incotermScore),
    totalScore: asNumber(obj.totalScore),
    isWinner: Boolean(obj.isWinner),
  };
}

export function normalizeComparisonRecord(raw: unknown): ComparisonRecord {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Resposta inesperada do servidor.');
  }
  const obj = raw as Record<string, unknown>;
  const results = Array.isArray(obj.results) ? obj.results.map(normalizeComparisonResult) : [];
  const executedByRaw = obj.executedBy as Record<string, unknown> | null | undefined;
  return {
    id: asNumber(obj.id),
    quoteRequestId: asNumber(obj.quoteRequestId),
    executedById: obj.executedById === null || obj.executedById === undefined
      ? null
      : asNumber(obj.executedById),
    executedBy: executedByRaw
      ? {
          id: asNumber(executedByRaw.id),
          name: String(executedByRaw.name ?? ''),
          email: String(executedByRaw.email ?? ''),
        }
      : null,
    priceWeight: asNumber(obj.priceWeight),
    paymentTermsWeight: asNumber(obj.paymentTermsWeight),
    incotermWeight: asNumber(obj.incotermWeight),
    winnerQuoteResponseId: obj.winnerQuoteResponseId === null || obj.winnerQuoteResponseId === undefined
      ? null
      : asNumber(obj.winnerQuoteResponseId),
    createdAt: String(obj.createdAt ?? ''),
    results,
  };
}

export async function listQuoteResponses(): Promise<QuoteResponse[]> {
  const data = await api.get<unknown[]>('/v1/quote-responses');
  return Array.isArray(data) ? data.map(normalizeResponse) : [];
}

export async function createQuoteResponse(payload: QuoteResponsePayload): Promise<QuoteResponse> {
  const created = await api.post<unknown>('/v1/quote-responses', { ...payload });
  return normalizeResponse(created);
}

export async function updateQuoteResponse(
  id: number,
  payload: QuoteResponsePayload,
): Promise<QuoteResponse> {
  const updated = await api.put<unknown>(`/v1/quote-responses/${id}`, { ...payload });
  return normalizeResponse(updated);
}

export async function deleteQuoteResponse(id: number): Promise<void> {
  await api.del<void>(`/v1/quote-responses/${id}`);
}

export async function executeComparison(
  quoteRequestId: number,
  weights?: ComparisonWeights,
): Promise<ComparisonResult[]> {
  const body = weights ? { ...weights } : {};
  const data = await api.post<unknown[]>(
    `/v1/quote-requests/${quoteRequestId}/compare`,
    body,
  );
  return Array.isArray(data) ? data.map(normalizeComparisonResult) : [];
}

export async function closeQuoteRequest(
  quoteRequestId: number,
  options?: { notifyLosers?: boolean },
): Promise<void> {
  await api.post<unknown>(`/v1/quote-requests/${quoteRequestId}/close`, {
    notifyLosers: options?.notifyLosers ?? false,
  });
}

export async function listComparisons(quoteRequestId: number): Promise<ComparisonHistoryResponse> {
  const data = await api.get<unknown>(`/v1/quote-requests/${quoteRequestId}/comparisons`);
  if (typeof data !== 'object' || data === null) {
    return { quoteRequestId, comparisons: [] };
  }
  const obj = data as Record<string, unknown>;
  const list = Array.isArray(obj.comparisons) ? obj.comparisons.map(normalizeComparisonRecord) : [];
  return {
    quoteRequestId: asNumber(obj.quoteRequestId ?? quoteRequestId),
    comparisons: list,
  };
}

export function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}