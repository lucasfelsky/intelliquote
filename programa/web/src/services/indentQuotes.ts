import { api } from '@/api/client';
import type { IndentRuleMode, IndentSupplierType } from '@/services/indent';

// IQ Indent (PR 3: cotacoes). Todas as chamadas vao por api/client.ts, no caminho COMPLETO /api/v1/indent/quotes...
// Maquina de estados, total (Decimal) e `allowedActions` sao do BACKEND: aqui so se exibe. Preco vai e volta como STRING decimal.

const BASE = '/api/v1/indent/quotes';

export type IndentQuoteStatus = 'RASCUNHO' | 'ENVIADA' | 'RESPONDIDA' | 'ACEITA' | 'RECUSADA' | 'REVISADA';
export type IndentQuoteAction = 'mark-sent' | 'items' | 'response' | 'accept' | 'refuse' | 'revision';

export interface IndentQuoteRow {
  id: number;
  /** Referencia de processo: numero da solicitacao (R1) ou "R<n> - numero". */
  ref: string;
  revision: number;
  status: IndentQuoteStatus;
  requestId: number;
  processNumber: string;
  requestStatus: 'NOVA' | 'COTACAO' | 'RESPONDIDA' | 'CONVERTIDA' | 'PERDIDA';
  client: { id: number; name: string; city: string | null } | null;
  supplier: { id: number; name: string; country: string | null; contactName: string | null; hasPartnership: boolean };
  itemsSummary: { firstName: string | null; count: number };
  currency: string;
  /** Decimal em string com 2 casas; null quando nenhum item tem CFR. */
  total: string | null;
  /** YYYY-MM-DD */
  validUntil: string | null;
  exception: { reason: string } | null;
  createdAt: string;
}

export interface IndentQuoteList {
  data: IndentQuoteRow[];
  truncated: boolean;
}

export interface IndentQuoteItem {
  id: number;
  requestItemId: number;
  name: string;
  cas: string | null;
  productOrigin: 'CADASTRADO' | 'LIVRE' | null;
  isFree: boolean;
  quantityKg: string;
  packaging: string | null;
  fobPricePerKg: string | null;
  cfrPricePerKg: string | null;
}

export interface IndentQuoteDetail extends Omit<IndentQuoteRow, 'exception' | 'client'> {
  destination: string | null;
  incoterm: string;
  sentAt: string | null;
  respondedAt: string | null;
  decidedAt: string | null;
  productionLeadTimeDays: number | null;
  paymentTerms: string | null;
  manufacturer: string | null;
  notes: string | null;
  base: { id: number; ref: string } | null;
  /** A cotacao ACEITA da solicitacao quando e OUTRA (aviso de aceite unico). */
  acceptedQuote: { id: number; ref: string; supplierName: string } | null;
  client: { id: number; name: string; city: string | null; supplierRuleMode: IndentRuleMode } | null;
  supplier: IndentQuoteRow['supplier'] & { type: IndentSupplierType };
  exception: { reason: string; byName: string | null; at: string | null } | null;
  items: IndentQuoteItem[];
  allowedActions: IndentQuoteAction[];
}

export interface IndentQuoteResponseInput {
  respondedOn: string;
  currency: string;
  validUntil: string;
  productionLeadTimeDays: number;
  paymentTerms: string;
  manufacturer?: string;
  notes?: string;
  destination?: string;
  items: Array<{ quoteItemId: number; packaging: string; fobPricePerKg: string; cfrPricePerKg: string }>;
}

export function listIndentQuotes(): Promise<IndentQuoteList> {
  return api.get<IndentQuoteList>(BASE);
}

export function getIndentQuote(id: number): Promise<IndentQuoteDetail> {
  return api.get<IndentQuoteDetail>(`${BASE}/${id}`);
}

export function markIndentQuoteSent(id: number, sentOn: string): Promise<IndentQuoteDetail> {
  return api.post<IndentQuoteDetail>(`${BASE}/${id}/mark-sent`, { sentOn });
}

export function addIndentQuoteFreeItem(id: number, input: { description: string; quantityKg: number }): Promise<IndentQuoteDetail> {
  return api.post<IndentQuoteDetail>(`${BASE}/${id}/items`, input);
}

export function recordIndentQuoteResponse(id: number, input: IndentQuoteResponseInput): Promise<IndentQuoteDetail> {
  return api.post<IndentQuoteDetail>(`${BASE}/${id}/response`, input as unknown as Record<string, unknown>);
}

export function acceptIndentQuote(id: number): Promise<IndentQuoteDetail> {
  return api.post<IndentQuoteDetail>(`${BASE}/${id}/accept`, {});
}

export function refuseIndentQuote(id: number): Promise<IndentQuoteDetail> {
  return api.post<IndentQuoteDetail>(`${BASE}/${id}/refuse`, {});
}

/** Devolve a cotacao NOVA (a revisao em rascunho). */
export function requestIndentQuoteRevision(id: number): Promise<IndentQuoteDetail> {
  return api.post<IndentQuoteDetail>(`${BASE}/${id}/revision`, {});
}
