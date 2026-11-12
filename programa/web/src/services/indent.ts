import { api } from '@/api/client';

// IQ Indent (PR 1: cadastros). Todas as chamadas vao por api/client.ts, no caminho COMPLETO /api/v1/indent/...
// (o buildUrl deixa intacto o que comeca por /api/v1).

const BASE = '/api/v1/indent';

export type IndentRuleMode = 'LIVRE' | 'APROVADOS' | 'BLOQUEIO';
export type IndentSupplierType = 'FABRICANTE' | 'TRADING' | 'IMPORTADO';
export type IndentProductOrigin = 'CADASTRADO' | 'LIVRE';
export type IndentCurrency = 'USD' | 'EUR';
export type IndentIncoterm = 'CFR' | 'CIF' | 'FOB';

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export interface IndentClient {
  id: number;
  name: string;
  /** So digitos. */
  cnpj: string;
  city: string | null;
  ownerName: string | null;
  pipedriveOrgId: number | null;
  supplierRuleMode: IndentRuleMode;
  ruleReason: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  supplierRules: Array<{ supplierId: number; supplier: { name: string } }>;
}

export interface IndentSupplierProductRef {
  id: number;
  name: string;
  isActive: boolean;
}

export interface IndentSupplier {
  id: number;
  name: string;
  country: string | null;
  contactName: string | null;
  type: IndentSupplierType;
  defaultCurrency: string;
  defaultIncoterm: string;
  hasPartnership: boolean;
  importedFromIq: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Clientes ativos que aprovam / bloqueiam o fornecedor (so na listagem). */
  approvedBy?: number;
  blockedBy?: number;
  /** Todos os produtos vinculados (inclusive inativos), em ordem alfabetica. */
  products: IndentSupplierProductRef[];
}

export interface IndentSupplierOption {
  id: number;
  name: string;
  country: string | null;
}

export interface IndentProduct {
  id: number;
  name: string;
  acronym: string | null;
  manufacturer: string | null;
  cas: string | null;
  unit: string;
  synonyms: string[];
  notes: string | null;
  origin: IndentProductOrigin;
  sourceRequestNumber: string | null;
  importedFromIq: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Fornecedores ATIVOS vinculados. */
  supplierCount: number;
}

export interface IndentProductList extends Paginated<IndentProduct> {
  counts: { total: number; cadastrado: number; livre: number };
}

export interface IndentProductOption {
  id: number;
  name: string;
  cas: string | null;
  isActive: boolean;
}

export interface IndentSupplierCandidate {
  id: number;
  name: string;
  country: string | null;
  alreadyInIndent: boolean;
}

export interface IndentProductCandidate {
  id: number;
  name: string;
  marketName: string;
  alreadyInIndent: boolean;
}

export interface IndentImportResult {
  created: number;
  skipped: Array<{ sourceId: number; reason: 'duplicado' | 'nao_encontrado' }>;
}

export interface IndentListParams {
  q?: string;
  page?: number;
  pageSize?: number;
  inativos?: boolean;
}

function listQuery(params: IndentListParams = {}) {
  return {
    q: params.q?.trim() ? params.q.trim() : undefined,
    page: params.page,
    pageSize: params.pageSize,
    inativos: params.inativos ? 1 : undefined,
  };
}

// ---- Clientes ----
export function listIndentClients(params?: IndentListParams): Promise<Paginated<IndentClient>> {
  return api.get<Paginated<IndentClient>>(`${BASE}/clients`, listQuery(params));
}

export interface IndentClientInput {
  name: string;
  cnpj: string;
  city?: string | null;
  ownerName?: string | null;
  pipedriveOrgId?: number | null;
}

export function createIndentClient(input: IndentClientInput): Promise<IndentClient> {
  return api.post<IndentClient>(`${BASE}/clients`, input as unknown as Record<string, unknown>);
}

export function updateIndentClient(id: number, input: Partial<IndentClientInput> & { isActive?: boolean }): Promise<IndentClient> {
  return api.put<IndentClient>(`${BASE}/clients/${id}`, input as unknown as Record<string, unknown>);
}

export interface IndentClientRuleInput {
  mode: IndentRuleMode;
  supplierIds: number[];
  reason?: string;
}

export function setIndentClientRule(id: number, input: IndentClientRuleInput): Promise<IndentClient> {
  return api.put<IndentClient>(`${BASE}/clients/${id}/supplier-rule`, input as unknown as Record<string, unknown>);
}

// ---- Fornecedores ----
export function listIndentSuppliers(params?: IndentListParams): Promise<Paginated<IndentSupplier>> {
  return api.get<Paginated<IndentSupplier>>(`${BASE}/suppliers`, listQuery(params));
}

export function listIndentSupplierOptions(): Promise<IndentSupplierOption[]> {
  return api.get<IndentSupplierOption[]>(`${BASE}/suppliers/options`);
}

export interface IndentSupplierInput {
  name: string;
  country?: string | null;
  contactName?: string | null;
  type?: IndentSupplierType;
  defaultCurrency?: IndentCurrency;
  defaultIncoterm?: IndentIncoterm;
  hasPartnership?: boolean;
  isActive?: boolean;
  /** Ausente = vinculos intocados; presente = conjunto FINAL de produtos do fornecedor. */
  productIds?: number[];
}

export function createIndentSupplier(input: IndentSupplierInput): Promise<IndentSupplier> {
  return api.post<IndentSupplier>(`${BASE}/suppliers`, input as unknown as Record<string, unknown>);
}

export function updateIndentSupplier(id: number, input: Partial<IndentSupplierInput>): Promise<IndentSupplier> {
  return api.put<IndentSupplier>(`${BASE}/suppliers/${id}`, input as unknown as Record<string, unknown>);
}

export function setIndentSupplierProducts(id: number, productIds: number[]): Promise<IndentSupplier> {
  return api.put<IndentSupplier>(`${BASE}/suppliers/${id}/products`, { productIds });
}

// ---- Produtos (catalogo) ----
export interface IndentProductListParams extends IndentListParams {
  origin?: IndentProductOrigin;
}

export function listIndentProducts(params?: IndentProductListParams): Promise<IndentProductList> {
  return api.get<IndentProductList>(`${BASE}/products`, { ...listQuery(params), origin: params?.origin });
}

export function listIndentProductOptions(): Promise<IndentProductOption[]> {
  return api.get<IndentProductOption[]>(`${BASE}/products/options`);
}

export interface IndentProductInput {
  name: string;
  acronym?: string | null;
  manufacturer?: string | null;
  cas?: string | null;
  unit?: string;
  synonyms?: string[];
  notes?: string | null;
}

export function createIndentProduct(input: IndentProductInput): Promise<IndentProduct> {
  return api.post<IndentProduct>(`${BASE}/products`, input as unknown as Record<string, unknown>);
}

export function updateIndentProduct(id: number, input: Partial<IndentProductInput> & { isActive?: boolean }): Promise<IndentProduct> {
  return api.put<IndentProduct>(`${BASE}/products/${id}`, input as unknown as Record<string, unknown>);
}

export function promoteIndentProduct(id: number): Promise<IndentProduct> {
  return api.post<IndentProduct>(`${BASE}/products/${id}/promote`);
}

// ---- Importacao do IntelliQuote (somente leitura na origem) ----
export function listIndentSupplierCandidates(params?: { q?: string; page?: number }): Promise<Paginated<IndentSupplierCandidate>> {
  return api.get<Paginated<IndentSupplierCandidate>>(`${BASE}/import/suppliers`, {
    q: params?.q?.trim() ? params.q.trim() : undefined,
    page: params?.page,
  });
}

export function listIndentProductCandidates(params?: { q?: string; page?: number }): Promise<Paginated<IndentProductCandidate>> {
  return api.get<Paginated<IndentProductCandidate>>(`${BASE}/import/products`, {
    q: params?.q?.trim() ? params.q.trim() : undefined,
    page: params?.page,
  });
}

export function importIndentSuppliers(ids: number[]): Promise<IndentImportResult> {
  return api.post<IndentImportResult>(`${BASE}/import/suppliers`, { ids });
}

export function importIndentProducts(ids: number[]): Promise<IndentImportResult> {
  return api.post<IndentImportResult>(`${BASE}/import/products`, { ids });
}
