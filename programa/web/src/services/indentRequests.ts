import { api } from '@/api/client';
import type { IndentRuleMode, IndentSupplierType, Paginated } from '@/services/indent';

// IQ Indent (PR 2: solicitacoes). Todas as chamadas vao por api/client.ts, no caminho COMPLETO /api/v1/indent/requests...
// A restricao do cliente, a cobertura e o "Na fila ha" sao calculados no BACKEND: aqui so se exibe.

const BASE = '/api/v1/indent/requests';

export type IndentRequestStatus = 'NOVA' | 'COTACAO' | 'RESPONDIDA' | 'CONVERTIDA' | 'PERDIDA';
export type IndentRequestOrigin = 'PIPEDRIVE' | 'IQ_INDENT';
export type IndentRequestFilter = 'todas' | 'pipedrive' | 'iq' | 'nova' | 'pendente';

export interface IndentRequestRow {
  id: number;
  processNumber: string;
  createdAt: string;
  origin: IndentRequestOrigin;
  pipedriveDealId: number | null;
  ownerName: string;
  status: IndentRequestStatus;
  clientPending: boolean;
  client: { id: number; name: string; city: string | null; supplierRuleMode: IndentRuleMode } | null;
  itemsSummary: { firstName: string | null; count: number; totalKg: number };
  quotes: { total: number; answered: number };
  /** Dias uteis na fila; null fora de NOVA/pendente/COTACAO. */
  queueBusinessDays: number | null;
}

export interface IndentRequestCounts {
  todas: number;
  pipedrive: number;
  iq: number;
  nova: number;
  pendente: number;
}

export interface IndentRequestKpis {
  novas: number;
  emCotacao: number;
  respondidas: number;
  convertidasNoMes: number;
}

export interface IndentRequestList extends Paginated<IndentRequestRow> {
  counts: IndentRequestCounts;
  kpis: IndentRequestKpis;
}

export interface IndentRequestListParams {
  q?: string;
  filter?: IndentRequestFilter;
  page?: number;
  pageSize?: number;
}

export interface IndentRequestClientOption {
  id: number;
  name: string;
  city: string | null;
}

export interface IndentRequestItem {
  id: number;
  position: number;
  description: string;
  name: string;
  quantityKg: number;
  confirmed: boolean;
  productId: number | null;
  product: { id: number; name: string; cas: string | null; origin: 'CADASTRADO' | 'LIVRE' } | null;
  /** Item livre = sem produto ou produto LIVRE. */
  isFree: boolean;
}

export interface IndentRequestQuote {
  id: number;
  status: 'RASCUNHO' | 'ENVIADA' | 'RESPONDIDA' | 'ACEITA' | 'RECUSADA' | 'REVISADA';
  revision: number;
  supplier: { id: number; name: string };
  exception: { reason: string; byName: string | null; at: string | null } | null;
}

export interface IndentRequestDetail {
  id: number;
  processNumber: string;
  origin: IndentRequestOrigin;
  pipedriveDealId: number | null;
  dealTitle: string | null;
  dealType: string | null;
  rawNote: string | null;
  ownerName: string;
  createdByName: string | null;
  status: IndentRequestStatus;
  clientPending: boolean;
  createdAt: string;
  stageEnteredAt: string;
  queueBusinessDays: number | null;
  client: {
    id: number;
    name: string;
    /** So digitos; null = "CNPJ pendente". */
    cnpj: string | null;
    city: string | null;
    pipedriveOrgId: number | null;
    supplierRuleMode: IndentRuleMode;
    ruleReason: string | null;
    supplierRules: Array<{ supplierId: number; name: string }>;
  } | null;
  items: IndentRequestItem[];
  quotes: IndentRequestQuote[];
}

export interface IndentRequestSupplierOption {
  id: number;
  name: string;
  country: string | null;
  type: IndentSupplierType;
  hasPartnership: boolean;
  defaultCurrency: string;
  defaultIncoterm: string;
  allowed: boolean;
  blockedReason: string | null;
  approvedByClient: boolean;
  coverage: { covered: number; total: number };
}

export interface IndentRequestSupplierOptions {
  clientRuleMode: IndentRuleMode;
  suppliers: IndentRequestSupplierOption[];
}

export interface IndentRequestCreateInput {
  clientId: number;
  items: Array<{ productId?: number; description: string; quantityKg: number }>;
}

export interface IndentGenerateInput {
  suppliers: Array<{ supplierId: number; exceptionReason?: string }>;
}

export interface IndentGenerateResult {
  processNumber: string;
  quotes: Array<{
    id: number;
    supplierId: number;
    supplierName: string;
    exception: { reason: string; byName: string; at: string } | null;
  }>;
}

export function listIndentRequests(params: IndentRequestListParams = {}): Promise<IndentRequestList> {
  return api.get<IndentRequestList>(BASE, {
    q: params.q?.trim() ? params.q.trim() : undefined,
    filter: params.filter && params.filter !== 'todas' ? params.filter : undefined,
    page: params.page,
    pageSize: params.pageSize,
  });
}

export function getIndentRequestsNewCount(): Promise<{ count: number }> {
  return api.get<{ count: number }>(`${BASE}/new-count`);
}

export function getIndentRequestClientOptions(): Promise<IndentRequestClientOption[]> {
  return api.get<IndentRequestClientOption[]>(`${BASE}/client-options`);
}

export function getIndentRequest(id: number): Promise<IndentRequestDetail> {
  return api.get<IndentRequestDetail>(`${BASE}/${id}`);
}

export function getIndentRequestSupplierOptions(id: number): Promise<IndentRequestSupplierOptions> {
  return api.get<IndentRequestSupplierOptions>(`${BASE}/${id}/supplier-options`);
}

export function createIndentRequest(input: IndentRequestCreateInput): Promise<IndentRequestDetail> {
  return api.post<IndentRequestDetail>(BASE, input as unknown as Record<string, unknown>);
}

export function confirmIndentRequestItems(id: number, itemIds: number[]): Promise<IndentRequestDetail> {
  return api.post<IndentRequestDetail>(`${BASE}/${id}/items/confirm`, { itemIds });
}

export function generateIndentQuotes(id: number, input: IndentGenerateInput): Promise<IndentGenerateResult> {
  return api.post<IndentGenerateResult>(`${BASE}/${id}/quotes`, input as unknown as Record<string, unknown>);
}
