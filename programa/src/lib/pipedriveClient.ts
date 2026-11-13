// Cliente do Pipedrive (CRM) para o IQ Indent: SO LEITURA, UM unico ponto de chamada (`request`, sempre GET).
// O token e pessoal (permissoes da dona), entao nada aqui escreve no CRM: a interface so tem get*/list*.
// O token vai SO no header e nunca em query string, log, erro ou resposta. Este e o unico arquivo de `src/` que
// conhece o dominio do CRM e o nome do header (guarda estatica nos testes e nos criterios do PR).
// Ritmo: chamadas sequenciais; `x-ratelimit-remaining` baixo faz pausa curta; 429 espera uma vez se for curto;
// o orcamento diario (da CONTA, compartilhado) fica exposto em `getRateLimitState()` para a varredura parar em 10%.
import { pipedriveEnv } from '../config/env';

// ---------- caminhos (v2 para negocio/organizacao/pessoa; v1 para notas, usuarios, funis, colunas e campos) ----------

const PATH_DEALS_V2 = '/api/v2/deals';
const PATH_ORGANIZATIONS_V2 = '/api/v2/organizations';
const PATH_PERSONS_V2 = '/api/v2/persons';
const PATH_ORGANIZATIONS_V1 = '/api/v1/organizations'; // fallback so se o v2 responder 404/410
const PATH_NOTES_V1 = '/api/v1/notes';
const PATH_USERS_V1 = '/api/v1/users';
const PATH_PIPELINES_V1 = '/api/v1/pipelines';
const PATH_STAGES_V1 = '/api/v1/stages';
const PATH_ORGANIZATION_FIELDS_V1 = '/api/v1/organizationFields';
const PATH_DEAL_FIELDS_V1 = '/api/v1/dealFields';

const HOST_SUFFIX = '.pipedrive.com';
const DOMAIN_PATTERN = /^[a-z0-9-]{1,63}$/;
const USER_AGENT = 'IntelliQuote-Backend/1.0';
const HEADER_NAME_TOKEN = 'x-api-token';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PAGE_LIMIT = 100;
export const MAX_DEAL_PAGES = 20;
const MAX_NOTE_PAGES = 5;
const LOW_REMAINING_THRESHOLD = 5;
const MAX_PACING_SLEEP_SECONDS = 2;
const MAX_RETRY_AFTER_SECONDS = 5;

// ---------- tipos normalizados ----------

export interface PdDeal {
  id: number;
  title: string;
  pipelineId: number | null;
  stageId: number | null;
  status: string;
  orgId: number | null;
  personId: number | null;
  ownerId: number | null;
  addTime: Date;
  updateTime: Date;
  stageChangeTime: Date | null;
  isDeleted: boolean;
  customFields: Record<string, unknown>;
}
export interface PdOrganization {
  id: number;
  name: string;
  cnpjRaw: string | null;
  city: string | null;
}
export interface PdPerson {
  id: number;
  orgId: number | null;
}
export interface PdNote {
  id: number;
  authorId: number | null;
  addTime: Date;
  updateTime: Date;
  html: string;
}
export interface PdUser {
  id: number;
  name: string;
}
export interface PdStage {
  id: number;
  name: string;
  pipelineId: number | null;
}
export interface PdPipeline {
  id: number;
  name: string;
}
export interface PdFieldOption {
  id: number;
  label: string;
}
export interface PdField {
  id: number;
  key: string;
  name: string;
  fieldType: string;
  options: PdFieldOption[];
}

// ---------- erros (nunca carregam token nem corpo da resposta) ----------

export class PipedriveError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
/** 401/403: token trocado, revogado ou sem acesso. */
export class PipedriveAuthError extends PipedriveError {
  constructor(status: number) {
    super(`O Pipedrive recusou as credenciais (HTTP ${status}).`, 'auth_failed', status);
  }
}
/** 404/410. */
export class PipedriveNotFoundError extends PipedriveError {
  constructor(status: number) {
    super(`Registro nao encontrado no Pipedrive (HTTP ${status}).`, 'not_found', status);
  }
}
/** 429: `retryAfterSeconds` vem de `Retry-After` ou `x-ratelimit-reset` (null se nenhum veio). */
export class PipedriveRateLimitError extends PipedriveError {
  constructor(readonly retryAfterSeconds: number | null) {
    super('Limite de chamadas do Pipedrive atingido (HTTP 429).', 'rate_limited', 429);
  }
}
/** 5xx, timeout (10 s) ou falha de rede. */
export class PipedriveUnavailableError extends PipedriveError {
  constructor(reason: string, status?: number) {
    super(`Pipedrive indisponivel (${reason}).`, 'unavailable', status);
  }
}

// ---------- normalizacao (um lugar so; aceita v1 e v2) ----------

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Numero, string numerica ou objeto `{ value }`/`{ id }` (v1 devolve org/pessoa/usuario como objeto). */
function toId(value: unknown, depth = 0): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value === 'string') {
    return /^\d{1,15}$/.test(value.trim()) ? Number(value.trim()) : null;
  }
  if (isDict(value) && depth < 2) {
    return toId(value.value, depth + 1) ?? toId(value.id, depth + 1);
  }
  return null;
}

const NAIVE_DATE_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/** ISO com fuso (v2) ou "YYYY-MM-DD HH:mm:ss" sem fuso (v1; vale como UTC). */
function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const text = value.trim();
  const date = new Date(NAIVE_DATE_TIME.test(text) ? `${text.replace(' ', 'T')}Z` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function invalidResponse(what: string): PipedriveError {
  return new PipedriveError(`Resposta do Pipedrive em formato inesperado (${what}).`, 'invalid_response');
}

const HEX_KEY = /^[0-9a-f]{40}$/;

/** Custom fields: v2 = objeto `custom_fields`; v1 = chaves de 40 hex na raiz. */
function readCustomFields(raw: Dict): Record<string, unknown> {
  if (isDict(raw.custom_fields)) {
    return { ...raw.custom_fields };
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (HEX_KEY.test(key)) {
      result[key] = value;
    }
  }
  return result;
}

/** Valor de um custom field como texto: direto, string numerica ou objeto `{ value }`; ausente/vazio -> null. */
export function readCustomFieldText(customFields: Record<string, unknown>, key: string | null | undefined): string | null {
  if (!key) {
    return null;
  }
  let value: unknown = customFields[key];
  if (isDict(value)) {
    value = value.value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text === '' ? null : text;
}

export function normalizeDeal(raw: unknown): PdDeal {
  if (!isDict(raw)) {
    throw invalidResponse('negocio');
  }
  const id = toId(raw.id);
  const addTime = toDate(raw.add_time);
  if (id === null || addTime === null) {
    throw invalidResponse('negocio');
  }
  return {
    id,
    title: toText(raw.title),
    pipelineId: toId(raw.pipeline_id),
    stageId: toId(raw.stage_id),
    status: toText(raw.status),
    orgId: toId(raw.org_id),
    personId: toId(raw.person_id),
    ownerId: toId(raw.owner_id) ?? toId(raw.user_id),
    addTime,
    updateTime: toDate(raw.update_time) ?? addTime,
    stageChangeTime: toDate(raw.stage_change_time),
    isDeleted: raw.is_deleted === true || raw.deleted === true,
    customFields: readCustomFields(raw),
  };
}

/** Entrada na coluna: `stage_change_time` (vem nulo em parte dos negocios) ou, sem ele, `add_time`. */
export function dealStageEnteredAt(deal: PdDeal): Date {
  return deal.stageChangeTime ?? deal.addTime;
}

export function normalizeOrganization(raw: unknown, cnpjFieldKey: string | null = null): PdOrganization {
  if (!isDict(raw)) {
    throw invalidResponse('organizacao');
  }
  const id = toId(raw.id);
  if (id === null) {
    throw invalidResponse('organizacao');
  }
  // v2: `address` e objeto; v1: `address_locality`/`address_admin_area_level_1` na raiz.
  const address = isDict(raw.address) ? raw.address : {};
  const locality = toText(address.locality ?? raw.address_locality).trim();
  const state = toText(address.admin_area_level_1 ?? raw.address_admin_area_level_1).trim();
  return {
    id,
    name: toText(raw.name),
    cnpjRaw: readCustomFieldText(readCustomFields(raw), cnpjFieldKey),
    city: locality === '' ? null : state === '' ? locality : `${locality}, ${state}`,
  };
}

export function normalizePerson(raw: unknown): PdPerson {
  const id = isDict(raw) ? toId(raw.id) : null;
  if (!isDict(raw) || id === null) {
    throw invalidResponse('pessoa');
  }
  return { id, orgId: toId(raw.org_id) };
}

export function normalizeNote(raw: unknown): PdNote {
  const id = isDict(raw) ? toId(raw.id) : null;
  if (!isDict(raw) || id === null) {
    throw invalidResponse('nota');
  }
  const addTime = toDate(raw.add_time) ?? new Date(0);
  return {
    id,
    authorId: toId(raw.user_id),
    addTime,
    updateTime: toDate(raw.update_time) ?? addTime,
    html: toText(raw.content),
  };
}

function normalizeUser(raw: unknown): PdUser {
  const id = isDict(raw) ? toId(raw.id) : null;
  if (!isDict(raw) || id === null) {
    throw invalidResponse('usuario');
  }
  return { id, name: toText(raw.name) };
}

function normalizeStage(raw: unknown): PdStage {
  const id = isDict(raw) ? toId(raw.id) : null;
  if (!isDict(raw) || id === null) {
    throw invalidResponse('coluna');
  }
  return { id, name: toText(raw.name), pipelineId: toId(raw.pipeline_id) };
}

function normalizePipeline(raw: unknown): PdPipeline {
  const id = isDict(raw) ? toId(raw.id) : null;
  if (!isDict(raw) || id === null) {
    throw invalidResponse('funil');
  }
  return { id, name: toText(raw.name) };
}

function normalizeField(raw: unknown): PdField {
  const id = isDict(raw) ? toId(raw.id) : null;
  if (!isDict(raw) || id === null) {
    throw invalidResponse('campo');
  }
  const options: PdFieldOption[] = [];
  if (Array.isArray(raw.options)) {
    for (const option of raw.options) {
      const optionId = isDict(option) ? toId(option.id) : null;
      if (isDict(option) && optionId !== null) {
        options.push({ id: optionId, label: toText(option.label) });
      }
    }
  }
  return { id, key: toText(raw.key), name: toText(raw.name), fieldType: toText(raw.field_type), options };
}

/** Opcoes de um campo (por chave) na lista de campos; chave ausente -> `[]`. */
export function findFieldOptions(fields: PdField[], key: string): PdFieldOption[] {
  return fields.find((field) => field.key === key)?.options ?? [];
}

// ---------- cliente ----------

export interface PipedriveRateLimitState {
  dailyTokensRemaining: number | null;
  dailyTokensLimit: number | null;
}

export interface PipedriveClient {
  getDeal(dealId: number): Promise<PdDeal>;
  listDealsPage(params: {
    pipelineId: number;
    stageId: number;
    status?: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<{ deals: PdDeal[]; nextCursor: string | null }>;
  /** Todos os negocios da coluna, por cursor, com teto de 20 paginas (`truncated` quando o teto cortou). */
  listDealsInStage(params: {
    pipelineId: number;
    stageId: number;
    status?: string;
    limit?: number;
  }): Promise<{ deals: PdDeal[]; truncated: boolean }>;
  getOrganization(orgId: number, cnpjFieldKey?: string | null): Promise<PdOrganization>;
  getPerson(personId: number): Promise<PdPerson>;
  listDealNotes(dealId: number): Promise<PdNote[]>;
  getUser(userId: number): Promise<PdUser>;
  listPipelines(): Promise<PdPipeline[]>;
  listStages(pipelineId: number): Promise<PdStage[]>;
  getStage(stageId: number): Promise<PdStage>;
  listDealFields(): Promise<PdField[]>;
  listOrganizationFields(): Promise<PdField[]>;
  /** Ultimo orcamento diario visto nos headers (sem chamar a API). */
  getRateLimitState(): PipedriveRateLimitState;
}

export interface PipedriveHttpClientOptions {
  domain: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Chamado antes de esperar um 429 curto: `false` (sem tempo na varredura) vira `PipedriveRateLimitError`. */
  hasTimeBudget?: (waitMs: number) => boolean;
}

type QueryValue = string | number | undefined | null;

function parseNumberHeader(response: Response, name: string): number | null {
  const raw = response.headers.get(name);
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function createPipedriveHttpClient(options: PipedriveHttpClientOptions): PipedriveClient {
  if (!DOMAIN_PATTERN.test(options.domain)) {
    throw new PipedriveError('Dominio do Pipedrive invalido.', 'invalid_domain');
  }
  if (!options.apiToken || /\s/.test(options.apiToken)) {
    throw new PipedriveError('Token do Pipedrive ausente ou invalido.', 'invalid_token');
  }
  const baseUrl = `https://${options.domain}${HOST_SUFFIX}`;
  const apiToken = options.apiToken;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hasTimeBudget = options.hasTimeBudget ?? (() => true);
  const rateLimit: PipedriveRateLimitState = { dailyTokensRemaining: null, dailyTokensLimit: null };

  function rememberDailyBudget(response: Response): void {
    const remaining = parseNumberHeader(response, 'x-daily-ratelimit-token-remaining');
    const limit = parseNumberHeader(response, 'x-daily-ratelimit-token-limit');
    if (remaining !== null) rateLimit.dailyTokensRemaining = remaining;
    if (limit !== null) rateLimit.dailyTokensLimit = limit;
  }

  /** UNICO ponto de chamada ao Pipedrive. Sempre GET; o token vai so no header. */
  async function request(path: string, query: Record<string, QueryValue> = {}): Promise<unknown> {
    const url = new URL(path, baseUrl);
    // encodeURIComponent: espaco sai como %20 (URLSearchParams usaria "+"; a sonda real usou %20, ex.: add_time%20ASC).
    url.search = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          method: 'GET',
          redirect: 'error', // o header do token nao pode seguir redirecionamento para outra origem
          headers: { [HEADER_NAME_TOKEN]: apiToken, Accept: 'application/json', 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // So o nome do erro (TimeoutError, TypeError...): a mensagem original pode trazer a URL.
        throw new PipedriveUnavailableError(error instanceof Error ? error.name : 'network');
      }
      rememberDailyBudget(response);
      const status = response.status;

      if (status === 429) {
        const retryAfter = parseNumberHeader(response, 'retry-after') ?? parseNumberHeader(response, 'x-ratelimit-reset');
        const waitSeconds = retryAfter === null ? null : Math.max(0, retryAfter);
        if (attempt === 0 && waitSeconds !== null && waitSeconds <= MAX_RETRY_AFTER_SECONDS && hasTimeBudget(waitSeconds * 1000)) {
          await sleep(waitSeconds * 1000);
          continue;
        }
        throw new PipedriveRateLimitError(waitSeconds);
      }
      if (status === 401 || status === 403) {
        throw new PipedriveAuthError(status);
      }
      if (status === 404 || status === 410) {
        throw new PipedriveNotFoundError(status);
      }
      if (status >= 500) {
        throw new PipedriveUnavailableError(`HTTP ${status}`, status);
      }
      if (!response.ok) {
        throw new PipedriveError(`O Pipedrive recusou a consulta (HTTP ${status}).`, 'unexpected_status', status);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw invalidResponse('JSON');
      }
      if (!isDict(body) || body.success === false) {
        throw invalidResponse('envelope');
      }

      const remaining = parseNumberHeader(response, 'x-ratelimit-remaining');
      if (remaining !== null && remaining <= LOW_REMAINING_THRESHOLD) {
        const reset = parseNumberHeader(response, 'x-ratelimit-reset') ?? 1;
        const pauseMs = Math.min(Math.max(reset, 0), MAX_PACING_SLEEP_SECONDS) * 1000;
        if (pauseMs > 0) {
          await sleep(pauseMs);
        }
      }
      return body;
    }
    // Inalcancavel: a 2a tentativa sempre retorna ou lanca.
    throw new PipedriveRateLimitError(null);
  }

  async function getData(path: string, query?: Record<string, QueryValue>): Promise<unknown> {
    return (await request(path, query) as Dict).data;
  }

  async function getList(path: string, query?: Record<string, QueryValue>): Promise<unknown[]> {
    const data = await getData(path, query);
    return Array.isArray(data) ? data : [];
  }

  async function listDealsPage(params: {
    pipelineId: number;
    stageId: number;
    status?: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<{ deals: PdDeal[]; nextCursor: string | null }> {
    const body = (await request(PATH_DEALS_V2, {
      pipeline_id: params.pipelineId,
      stage_id: params.stageId,
      status: params.status ?? 'open',
      limit: params.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: params.cursor ?? undefined,
    })) as Dict;
    const rawDeals = Array.isArray(body.data) ? body.data : [];
    const cursor = isDict(body.additional_data) ? body.additional_data.next_cursor : null;
    return {
      deals: rawDeals.map(normalizeDeal),
      nextCursor: typeof cursor === 'string' && cursor !== '' ? cursor : null,
    };
  }

  return {
    getDeal: async (dealId) => normalizeDeal(await getData(`${PATH_DEALS_V2}/${dealId}`)),

    listDealsPage,

    async listDealsInStage(params) {
      const deals: PdDeal[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_DEAL_PAGES; page += 1) {
        const result: { deals: PdDeal[]; nextCursor: string | null } = await listDealsPage({ ...params, cursor });
        deals.push(...result.deals);
        if (result.nextCursor === null) {
          return { deals, truncated: false };
        }
        cursor = result.nextCursor;
      }
      return { deals, truncated: true };
    },

    async getOrganization(orgId, cnpjFieldKey = null) {
      try {
        return normalizeOrganization(await getData(`${PATH_ORGANIZATIONS_V2}/${orgId}`), cnpjFieldKey);
      } catch (error) {
        if (!(error instanceof PipedriveNotFoundError)) {
          throw error;
        }
        // Fallback v1 (formato confirmado no spike): so quando o v2 nao encontra.
        return normalizeOrganization(await getData(`${PATH_ORGANIZATIONS_V1}/${orgId}`), cnpjFieldKey);
      }
    },

    getPerson: async (personId) => normalizePerson(await getData(`${PATH_PERSONS_V2}/${personId}`)),

    async listDealNotes(dealId) {
      const notes: PdNote[] = [];
      let start = 0;
      for (let page = 0; page < MAX_NOTE_PAGES; page += 1) {
        const body = (await request(PATH_NOTES_V1, {
          deal_id: dealId,
          sort: 'add_time ASC',
          limit: 100,
          start: start === 0 ? undefined : start,
        })) as Dict;
        if (Array.isArray(body.data)) {
          notes.push(...body.data.map(normalizeNote));
        }
        const pagination = isDict(body.additional_data) && isDict(body.additional_data.pagination) ? body.additional_data.pagination : {};
        const nextStart = toId(pagination.next_start);
        if (pagination.more_items_in_collection !== true || nextStart === null) {
          break;
        }
        start = nextStart;
      }
      return notes;
    },

    getUser: async (userId) => normalizeUser(await getData(`${PATH_USERS_V1}/${userId}`)),

    listPipelines: async () => (await getList(PATH_PIPELINES_V1)).map(normalizePipeline),

    listStages: async (pipelineId) => (await getList(PATH_STAGES_V1, { pipeline_id: pipelineId })).map(normalizeStage),

    getStage: async (stageId) => normalizeStage(await getData(`${PATH_STAGES_V1}/${stageId}`)),

    listDealFields: async () => (await getList(PATH_DEAL_FIELDS_V1, { limit: 500 })).map(normalizeField),

    listOrganizationFields: async () => (await getList(PATH_ORGANIZATION_FIELDS_V1, { limit: 500 })).map(normalizeField),

    getRateLimitState: () => ({ ...rateLimit }),
  };
}

// ---------- singleton ----------

let cachedClient: PipedriveClient | null = null;
let testClient: PipedriveClient | null = null;

/** Cliente real a partir das envs; sem configuracao valida lanca `PipedriveError` (code `not_configured`). */
export function getPipedriveClient(): PipedriveClient {
  if (testClient) {
    return testClient;
  }
  if (!pipedriveEnv.configured || !pipedriveEnv.domain || !pipedriveEnv.apiToken) {
    throw new PipedriveError('Integracao com o Pipedrive nao configurada.', 'not_configured');
  }
  cachedClient ??= createPipedriveHttpClient({ domain: pipedriveEnv.domain, apiToken: pipedriveEnv.apiToken });
  return cachedClient;
}

/** So para testes: injeta um cliente falso (`null` volta ao real). */
export function setPipedriveClientForTests(client: PipedriveClient | null): void {
  testClient = client;
}
