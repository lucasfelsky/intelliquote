import { api } from '@/api/client';

// IQ Indent (PR 5a.4): integracao com o Pipedrive. Todas as chamadas vao por api/client.ts, no caminho COMPLETO /api/v1/indent/...
// O IQ so LE o Pipedrive: nada aqui escreve no CRM (o "Sincronizar agora" so dispara a leitura no backend). Estado, opcoes, regra de
// conexao e a fila de vinculo sao calculados no BACKEND; aqui so se exibe.

const BASE = '/api/v1/indent';

export type IndentPipedriveConnection =
  | 'not_configured'
  | 'ok'
  | 'auth_failed'
  | 'rate_limited'
  | 'budget_low'
  | 'config_mismatch'
  | 'error';

export interface IndentPipedriveStatus {
  /** Env valido e funil/coluna definidos. */
  configured: boolean;
  connection: IndentPipedriveConnection;
  mode: 'polling' | 'webhook';
  webhook: 'not_configured' | 'active' | 'no_signal';
  connectionCheckedAt: string | null;
  lastSyncAt: string | null;
  lastSyncNewDeals: number;
  lastSyncErrors: number;
  pipelineId: number | null;
  pipelineName: string | null;
  stageId: number | null;
  stageName: string | null;
  /** Prazo interno de resposta (1 a 3 dias uteis). */
  slaBusinessDays: number;
  pendingCount: number;
  dailyTokensRemaining: number | null;
  dailyTokensLimit: number | null;
  /** So exibicao: o intervalo real e o do Cloud Scheduler. */
  intervalMinutes: number;
}

export interface IndentPipedriveOptions {
  pipelines: Array<{ id: number; name: string }>;
  stages: Array<{ id: number; name: string; pipelineId: number }>;
  slaOptions: number[];
  current: { pipelineId: number | null; stageId: number | null; slaBusinessDays: number };
}

export interface IndentPipedriveConfigInput {
  pipelineId: number;
  stageId: number;
  slaBusinessDays?: number;
}

/** 200 de `POST /pipedrive/sync` (falhas voltam como erro HTTP 409/429/502, com `message` e `outcome` no corpo). */
export interface IndentPipedriveSyncResult {
  outcome: string;
  processed: number;
  created: number;
  errors: number;
  missed: number;
  durationMs: number;
}

export interface IndentPendingOrgCandidate {
  orgId: number;
  name: string;
  /** 14 digitos (CNPJ valido da organizacao) ou null. */
  cnpj: string | null;
  city: string | null;
}

export interface IndentPendingOrg {
  id: number;
  requestId: number;
  /** null = "Referencia pendente" (titulo do negocio sem numero). */
  processNumber: string | null;
  dealId: number;
  candidates: IndentPendingOrgCandidate[];
  createdAt: string;
}

export interface IndentPendingOrgList {
  data: IndentPendingOrg[];
  total: number;
}

export interface IndentPendingOrgClient {
  id: number;
  name: string;
  /** So digitos; null = "CNPJ pendente". */
  cnpj: string | null;
  city: string | null;
  pipedriveOrgId: number | null;
}

export interface IndentPendingOrgResolved {
  id: number;
  requestId: number;
}

export interface IndentPendingOrgCreateClientInput {
  orgId: number;
  name?: string;
  /** So digitos (CNPJ valido). Vazio/ausente = usa o da organizacao ou fica "CNPJ pendente". */
  cnpj?: string;
  city?: string;
}

export interface IndentPendingOrgCreateClientResult {
  client: IndentPendingOrgClient;
  resolved: IndentPendingOrgResolved[];
}

export interface IndentPendingOrgLinkInput {
  /** Dispensado quando o negocio nao tem organizacao. */
  orgId?: number;
  clientId: number;
}

export interface IndentPendingOrgLinkResult {
  client: IndentPendingOrgClient;
  /** O cliente nao tinha CNPJ e recebeu o da organizacao (P5). */
  cnpjCompleted: boolean;
  /** Aviso (nao bloqueia): o CNPJ do cliente difere do da organizacao. */
  cnpjDivergente: boolean;
  resolved: IndentPendingOrgResolved[];
}

export function getIndentPipedriveStatus(): Promise<IndentPipedriveStatus> {
  return api.get<IndentPipedriveStatus>(`${BASE}/pipedrive/status`);
}

/** So admin (403 para os demais). Sem `pipelineId`, as colunas sao as do funil configurado. */
export function getIndentPipedriveOptions(pipelineId?: number): Promise<IndentPipedriveOptions> {
  return api.get<IndentPipedriveOptions>(`${BASE}/pipedrive/options`, { pipelineId });
}

/** So admin. Devolve o estado ja atualizado. */
export function saveIndentPipedriveConfig(input: IndentPipedriveConfigInput): Promise<IndentPipedriveStatus> {
  return api.put<IndentPipedriveStatus>(`${BASE}/pipedrive/config`, input as unknown as Record<string, unknown>);
}

/** Pode passar de 60 s (o rewrite do Hosting corta): quem chama trata o timeout reconsultando o estado. */
export function syncIndentPipedrive(): Promise<IndentPipedriveSyncResult> {
  return api.post<IndentPipedriveSyncResult>(`${BASE}/pipedrive/sync`);
}

export function listIndentPendingOrgs(): Promise<IndentPendingOrgList> {
  return api.get<IndentPendingOrgList>(`${BASE}/pending-orgs`);
}

export function createIndentPendingOrgClient(id: number, input: IndentPendingOrgCreateClientInput): Promise<IndentPendingOrgCreateClientResult> {
  return api.post<IndentPendingOrgCreateClientResult>(`${BASE}/pending-orgs/${id}/create-client`, input as unknown as Record<string, unknown>);
}

export function linkIndentPendingOrg(id: number, input: IndentPendingOrgLinkInput): Promise<IndentPendingOrgLinkResult> {
  return api.post<IndentPendingOrgLinkResult>(`${BASE}/pending-orgs/${id}/link`, input as unknown as Record<string, unknown>);
}
