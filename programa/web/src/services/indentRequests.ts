import { api } from '@/api/client';
import type { IndentRuleMode, IndentSupplierType, Paginated } from '@/services/indent';
import type { IndentPendingOrgCandidate } from '@/services/indentPipedrive';

// IQ Indent (PR 2: solicitacoes). Todas as chamadas vao por api/client.ts, no caminho COMPLETO /api/v1/indent/requests...
// A restricao do cliente, a cobertura e o "Na fila ha" sao calculados no BACKEND: aqui so se exibe.

const BASE = '/api/v1/indent/requests';

export type IndentRequestStatus = 'NOVA' | 'COTACAO' | 'RESPONDIDA' | 'CONVERTIDA' | 'PERDIDA';
export type IndentRequestOrigin = 'PIPEDRIVE' | 'IQ_INDENT';
export type IndentRequestFilter = 'todas' | 'pipedrive' | 'iq' | 'nova' | 'pendente';

export interface IndentRequestRow {
  id: number;
  /** null = "Referencia pendente" (titulo do negocio do Pipedrive sem numero NNN/AA). */
  processNumber: string | null;
  referencePending: boolean;
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
  /** Prazo interno de resposta em dias uteis (1 a 3, configurado na Integracao; padrao 2): decide "no limite" x "atrasada". */
  slaBusinessDays: number;
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
  /** Item lido da nota do Pipedrive nasce NAO confirmado; so a pessoa confirma (modal "Revisar itens da nota"). */
  confirmed: boolean;
  /** 'NOTE' = lido da nota do Pipedrive; 'MANUAL' = digitado. */
  source: string;
  /** Linha original da nota (so para itens 'NOTE'). */
  noteLine: string | null;
  productId: number | null;
  product: { id: number; name: string; cas: string | null; origin: 'CADASTRADO' | 'LIVRE' } | null;
  /** Item livre = sem produto ou produto LIVRE. */
  isFree: boolean;
}

export interface IndentRequestQuote {
  id: number;
  /** Referencia de processo: numero da solicitacao (R1) ou "R<n> - numero". */
  ref: string;
  status: 'RASCUNHO' | 'ENVIADA' | 'RESPONDIDA' | 'ACEITA' | 'RECUSADA' | 'REVISADA';
  revision: number;
  currency: string;
  /** Decimal em string (2 casas); null sem CFR em nenhum item. */
  total: string | null;
  supplier: { id: number; name: string };
  exception: { reason: string; byName: string | null; at: string | null } | null;
}

export interface IndentRequestDetail {
  id: number;
  /** null = "Referencia pendente": nao gera cotacoes (409) ate alguem digitar o numero. */
  processNumber: string | null;
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
  slaBusinessDays: number;
  /** Aviso da sincronizacao sobre o numero (ex.: "O numero NNN/AA ja pertence a solicitacao NNN/AA."); some quando a referencia e resolvida. */
  referenceAlert: string | null;
  /** Revisao `R<n>` do negocio (mesmo negocio renomeado); null = sem revisao. */
  currentRevision: number | null;
  revisionAlertAt: string | null;
  /** A nota mudou no Pipedrive depois da confirmacao dos itens. */
  noteChangedAt: string | null;
  /** Incoterm, destino e fornecedor citados na nota (so informativos: nada vem pre-marcado). */
  noteIncoterm: string | null;
  noteDestination: string | null;
  noteSupplierHint: string | null;
  /** Fila de vinculo: organizacoes candidatas enquanto o cliente esta pendente. */
  pendingOrg: { id: number; candidates: IndentPendingOrgCandidate[] } | null;
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

/** `processNumber` ja normalizado (`NNN/AA`). Devolve o detalhe atualizado; 409 = numero usado ou solicitacao que ja tem referencia. */
export function setIndentRequestReference(id: number, processNumber: string): Promise<IndentRequestDetail> {
  return api.put<IndentRequestDetail>(`${BASE}/${id}/reference`, { processNumber });
}

/** Uma entrada do `PUT note-items`: item atual (`id`, editado ou `remove`) ou item novo (sem `id`). */
export interface IndentNoteItemInput {
  id?: number;
  productId?: number;
  description?: string;
  quantityKg?: number;
  remove?: boolean;
}

/**
 * Confirmacao humana dos itens lidos da nota. A lista tem de cobrir TODOS os itens atuais (por `id`); 400 "Os itens da solicitacao mudaram.
 * Recarregue e revise de novo." = a sincronizacao trocou os itens enquanto a tela estava aberta. So NOVA (senao 409).
 */
export function updateIndentNoteItems(id: number, items: IndentNoteItemInput[]): Promise<IndentRequestDetail> {
  return api.put<IndentRequestDetail>(`${BASE}/${id}/note-items`, { items } as unknown as Record<string, unknown>);
}

export function generateIndentQuotes(id: number, input: IndentGenerateInput): Promise<IndentGenerateResult> {
  return api.post<IndentGenerateResult>(`${BASE}/${id}/quotes`, input as unknown as Record<string, unknown>);
}
