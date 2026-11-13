import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_DEAL_PAGES,
  PipedriveAuthError,
  PipedriveError,
  PipedriveNotFoundError,
  PipedriveRateLimitError,
  PipedriveUnavailableError,
  createPipedriveHttpClient,
  dealStageEnteredAt,
  findFieldOptions,
  getPipedriveClient,
  normalizeDeal,
  normalizeNote,
  normalizeOrganization,
  readCustomFieldText,
  setPipedriveClientForTests,
  type PipedriveClient,
} from '../src/lib/pipedriveClient';

// Tudo FICTICIO (repositorio publico): dominio "exemplo", token inventado, ids 9000xx e chaves de campo de teste.
const FIXTURES = resolve(__dirname, 'fixtures', 'pipedrive');
const SRC = resolve(__dirname, '..', 'src');
const TOKEN = 'tok-exemplo-0000-aaaa-bbbb';
const CNPJ_KEY = '0123456789abcdef0123456789abcdef01234567';
const TYPE_KEY = 'abcdef0123456789abcdef0123456789abcdef01';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function emptyResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response('{"success":false,"error":"x"}', { status, headers });
}

type FetchCall = { url: URL; init: RequestInit };

/** fetch falso: devolve a fixture do caminho e registra as chamadas. */
function routedFetch(routes: Record<string, () => Response>): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    const handler = routes[url.pathname];
    if (!handler) {
      throw new Error(`rota nao prevista no teste: ${url.pathname}`);
    }
    return handler();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ALL_ROUTES: Record<string, () => Response> = {
  '/api/v2/deals/900001': () => jsonResponse(fixture('deal-v2')),
  '/api/v2/deals': () => jsonResponse(fixture('deals-stage-p2')),
  '/api/v2/organizations/900101': () => jsonResponse(fixture('organization-v2')),
  '/api/v2/persons/900201': () => jsonResponse(fixture('person-v2')),
  '/api/v1/notes': () => jsonResponse(fixture('notes-v1')),
  '/api/v1/users/900301': () => jsonResponse(fixture('user-v1')),
  '/api/v1/pipelines': () => jsonResponse(fixture('pipelines-v1')),
  '/api/v1/stages': () => jsonResponse(fixture('stages-v1')),
  '/api/v1/stages/9020': () => jsonResponse(fixture('stage-v1')),
  '/api/v1/dealFields': () => jsonResponse(fixture('deal-fields-v1')),
  '/api/v1/organizationFields': () => jsonResponse(fixture('organization-fields-v1')),
};

function makeClient(
  fetchImpl: typeof fetch,
  extra: { sleep?: (ms: number) => Promise<void>; hasTimeBudget?: (ms: number) => boolean } = {},
): PipedriveClient {
  return createPipedriveHttpClient({
    domain: 'exemplo',
    apiToken: TOKEN,
    fetchImpl,
    sleep: extra.sleep ?? (async () => undefined),
    hasTimeBudget: extra.hasTimeBudget,
  });
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listSourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

afterEach(() => {
  setPipedriveClientForTests(null);
  vi.restoreAllMocks();
});

describe('somente GET', () => {
  it('todos os metodos da interface chamam o fetch so com GET', async () => {
    const { fetchImpl, calls } = routedFetch(ALL_ROUTES);
    const client = makeClient(fetchImpl);

    const invocations: Record<keyof PipedriveClient, () => Promise<unknown>> = {
      getDeal: () => client.getDeal(900001),
      listDealsPage: () => client.listDealsPage({ pipelineId: 9010, stageId: 9020 }),
      listDealsInStage: () => client.listDealsInStage({ pipelineId: 9010, stageId: 9020 }),
      getOrganization: () => client.getOrganization(900101, CNPJ_KEY),
      getPerson: () => client.getPerson(900201),
      listDealNotes: () => client.listDealNotes(900001),
      getUser: () => client.getUser(900301),
      listPipelines: () => client.listPipelines(),
      listStages: () => client.listStages(9010),
      getStage: () => client.getStage(9020),
      listDealFields: () => client.listDealFields(),
      listOrganizationFields: () => client.listOrganizationFields(),
      getRateLimitState: async () => client.getRateLimitState(),
    };

    // Metodo novo na interface sem entrada acima faz este teste falhar (nao fica sem cobertura).
    expect(Object.keys(invocations).sort()).toEqual(Object.keys(client).sort());

    for (const call of Object.values(invocations)) {
      await call();
    }
    expect(calls.length).toBeGreaterThanOrEqual(11);
    for (const { init } of calls) {
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
    }
  });

  it('guarda estatica: o arquivo-fonte do cliente nao contem metodo de escrita', () => {
    const source = readFileSync(join(SRC, 'lib', 'pipedriveClient.ts'), 'utf8');
    expect(source).not.toMatch(/POST|PUT|PATCH|DELETE/);
    expect(source.match(/method: 'GET'/g)).toHaveLength(1);
    expect(source.match(/fetchImpl\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\.method\s*=|method:\s*[a-z]/);
  });

  it('nenhum outro arquivo de src contem o dominio do CRM, o header do token ou o parametro de token', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      const isClient = file.endsWith(join('lib', 'pipedriveClient.ts'));
      if (!isClient && /x-api-token|pipedrive\.com/i.test(text)) {
        offenders.push(`dominio/header em ${file}`);
      }
      if (/api_token/.test(text)) {
        offenders.push(`parametro de token em ${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('cliente: requisicao e token', () => {
  it('envia o token so no header, com Accept e User-Agent, para o dominio configurado', async () => {
    const { fetchImpl, calls } = routedFetch(ALL_ROUTES);
    await makeClient(fetchImpl).getDeal(900001);

    const { url, init } = calls[0] as FetchCall;
    expect(url.origin).toBe('https://exemplo.pipedrive.com');
    expect(url.pathname).toBe('/api/v2/deals/900001');
    expect(init.headers).toMatchObject({ 'x-api-token': TOKEN, Accept: 'application/json', 'User-Agent': 'IntelliQuote-Backend/1.0' });
    expect(url.toString()).not.toContain(TOKEN);
    expect([...url.searchParams.keys()].map((key) => key.toLowerCase())).not.toContain('api_token');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('error');
  });

  it('monta a query com %20 (nao +): a ordem das notas sai como add_time%20ASC', async () => {
    const { fetchImpl, calls } = routedFetch(ALL_ROUTES);
    await makeClient(fetchImpl).listDealNotes(900001);
    const search = (calls[0] as FetchCall).url.search;
    expect(search).toContain('sort=add_time%20ASC');
    expect(search).not.toContain('+');
    expect(search).toBe('?deal_id=900001&sort=add_time%20ASC&limit=100');
  });

  it('rejeita dominio invalido e token ausente ou com espaco', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    for (const domain of ['', 'Exemplo', 'a.b', 'a/b', 'exemplo.pipedrive.com', 'a'.repeat(64), 'exemplo:443']) {
      expect(() => createPipedriveHttpClient({ domain, apiToken: TOKEN, fetchImpl })).toThrow(PipedriveError);
    }
    expect(() => createPipedriveHttpClient({ domain: 'exemplo', apiToken: '', fetchImpl })).toThrow(PipedriveError);
    expect(() => createPipedriveHttpClient({ domain: 'exemplo', apiToken: 'a b', fetchImpl })).toThrow(PipedriveError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('o token nunca aparece em erro (HTTP, rede ou timeout)', async () => {
    const failures: Array<() => Response | never> = [
      () => emptyResponse(401),
      () => emptyResponse(500),
      () => {
        throw new TypeError(`fetch failed https://exemplo.pipedrive.com/x?token=${TOKEN}`);
      },
      () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
    ];
    for (const failure of failures) {
      const fetchImpl = vi.fn(async () => failure()) as unknown as typeof fetch;
      const error = await makeClient(fetchImpl)
        .getDeal(900001)
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      expect(error).toBeInstanceOf(PipedriveError);
      const dump = `${(error as Error).message} ${JSON.stringify(error)} ${(error as Error).stack ?? ''}`;
      expect(dump).not.toContain(TOKEN);
      expect(dump).not.toContain('exemplo.pipedrive.com/x');
    }
  });
});

describe('cliente: erros por status', () => {
  const cases: Array<[number, new (...args: never[]) => Error]> = [
    [401, PipedriveAuthError],
    [403, PipedriveAuthError],
    [404, PipedriveNotFoundError],
    [410, PipedriveNotFoundError],
    [500, PipedriveUnavailableError],
    [503, PipedriveUnavailableError],
  ];
  it.each(cases)('HTTP %i vira o erro tipado', async (status, ErrorClass) => {
    const fetchImpl = vi.fn(async () => emptyResponse(status)) as unknown as typeof fetch;
    await expect(makeClient(fetchImpl).getDeal(900001)).rejects.toBeInstanceOf(ErrorClass);
  });

  it('timeout e falha de rede viram PipedriveUnavailableError', async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException('timeout', 'TimeoutError');
    }) as unknown as typeof fetch;
    await expect(makeClient(timeout).getDeal(900001)).rejects.toBeInstanceOf(PipedriveUnavailableError);
    const network = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(makeClient(network).getDeal(900001)).rejects.toBeInstanceOf(PipedriveUnavailableError);
  });

  it('status inesperado, envelope com success=false e JSON invalido viram PipedriveError sem tipo especifico', async () => {
    const teapot = vi.fn(async () => emptyResponse(400)) as unknown as typeof fetch;
    await expect(makeClient(teapot).getDeal(900001)).rejects.toMatchObject({ code: 'unexpected_status' });
    const refused = vi.fn(async () => jsonResponse({ success: false })) as unknown as typeof fetch;
    await expect(makeClient(refused).getDeal(900001)).rejects.toMatchObject({ code: 'invalid_response' });
    const broken = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(makeClient(broken).getDeal(900001)).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('cliente: ritmo, 429 e orcamento diario', () => {
  it('429 com Retry-After: 2 espera 2 s e repete uma unica vez', async () => {
    const sleep = vi.fn(async () => undefined);
    const responses = [emptyResponse(429, { 'retry-after': '2' }), jsonResponse(fixture('deal-v2'))];
    const fetchImpl = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch;
    const deal = await makeClient(fetchImpl, { sleep }).getDeal(900001);
    expect(deal.id).toBe(900001);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('429 repetido apos a espera para com PipedriveRateLimitError (sem 3a chamada)', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(429, { 'retry-after': '2' })) as unknown as typeof fetch;
    const error = await makeClient(fetchImpl).getDeal(900001).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PipedriveRateLimitError);
    expect((error as PipedriveRateLimitError).retryAfterSeconds).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('429 com Retry-After: 30 para sem esperar (rate_limited)', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => emptyResponse(429, { 'retry-after': '30' })) as unknown as typeof fetch;
    const error = await makeClient(fetchImpl, { sleep }).getDeal(900001).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PipedriveRateLimitError);
    expect((error as PipedriveRateLimitError).retryAfterSeconds).toBe(30);
    expect((error as PipedriveRateLimitError).code).toBe('rate_limited');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('429 sem tempo no orcamento da varredura nao espera; sem Retry-After usa x-ratelimit-reset', async () => {
    const sleep = vi.fn(async () => undefined);
    const noBudget = vi.fn(async () => emptyResponse(429, { 'retry-after': '1' })) as unknown as typeof fetch;
    await expect(makeClient(noBudget, { sleep, hasTimeBudget: () => false }).getDeal(900001)).rejects.toBeInstanceOf(
      PipedriveRateLimitError,
    );
    expect(noBudget).toHaveBeenCalledTimes(1);

    const viaReset = [emptyResponse(429, { 'x-ratelimit-reset': '1' }), jsonResponse(fixture('deal-v2'))];
    const fetchImpl = vi.fn(async () => viaReset.shift() as Response) as unknown as typeof fetch;
    await makeClient(fetchImpl, { sleep }).getDeal(900001);
    expect(sleep).toHaveBeenCalledWith(1000);

    const unknownWait = vi.fn(async () => emptyResponse(429)) as unknown as typeof fetch;
    const error = await makeClient(unknownWait, { sleep }).getDeal(900001).catch((caught: unknown) => caught);
    expect((error as PipedriveRateLimitError).retryAfterSeconds).toBeNull();
    expect(unknownWait).toHaveBeenCalledTimes(1);
  });

  it('x-ratelimit-remaining baixo dorme x-ratelimit-reset (maximo 2 s); folgado nao dorme', async () => {
    const sleep = vi.fn(async () => undefined);
    const low = vi.fn(async () =>
      jsonResponse(fixture('deal-v2'), { headers: { 'x-ratelimit-remaining': '3', 'x-ratelimit-reset': '1' } }),
    ) as unknown as typeof fetch;
    await makeClient(low, { sleep }).getDeal(900001);
    expect(sleep).toHaveBeenLastCalledWith(1000);

    const veryLow = vi.fn(async () =>
      jsonResponse(fixture('deal-v2'), { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '10' } }),
    ) as unknown as typeof fetch;
    await makeClient(veryLow, { sleep }).getDeal(900001);
    expect(sleep).toHaveBeenLastCalledWith(2000);

    sleep.mockClear();
    const roomy = vi.fn(async () =>
      jsonResponse(fixture('deal-v2'), { headers: { 'x-ratelimit-remaining': '70', 'x-ratelimit-reset': '2' } }),
    ) as unknown as typeof fetch;
    await makeClient(roomy, { sleep }).getDeal(900001);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('expoe o ultimo orcamento diario dos headers sem chamar a API', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(fixture('deal-v2'), {
        headers: { 'x-daily-ratelimit-token-remaining': '2148290', 'x-daily-ratelimit-token-limit': '2160000' },
      }),
    ) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);
    expect(client.getRateLimitState()).toEqual({ dailyTokensRemaining: null, dailyTokensLimit: null });
    await client.getDeal(900001);
    expect(client.getRateLimitState()).toEqual({ dailyTokensRemaining: 2148290, dailyTokensLimit: 2160000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('cliente: paginacao por cursor', () => {
  it('listDealsPage envia funil, coluna, status e limite e devolve o cursor seguinte', async () => {
    const { fetchImpl, calls } = routedFetch({ '/api/v2/deals': () => jsonResponse(fixture('deals-stage-p1')) });
    const page = await makeClient(fetchImpl).listDealsPage({ pipelineId: 9010, stageId: 9020, limit: 2 });

    const params = (calls[0] as FetchCall).url.searchParams;
    expect(Object.fromEntries(params)).toEqual({ pipeline_id: '9010', stage_id: '9020', status: 'open', limit: '2' });
    expect(page.deals.map((deal) => deal.id)).toEqual([900001, 900002]);
    expect(page.nextCursor).toBe('cursor-pagina-2-exemplo');
  });

  it('listDealsInStage junta 2 paginas pelo cursor e encerra quando o cursor some', async () => {
    const pages = [fixture('deals-stage-p1'), fixture('deals-stage-p2')];
    const calls: URL[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      calls.push(new URL(String(input)));
      return jsonResponse(pages.shift());
    }) as unknown as typeof fetch;

    const result = await makeClient(fetchImpl).listDealsInStage({ pipelineId: 9010, stageId: 9020 });
    expect(result.deals.map((deal) => deal.id)).toEqual([900001, 900002, 900003]);
    expect(result.truncated).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.searchParams.has('cursor')).toBe(false);
    expect(calls[1]?.searchParams.get('cursor')).toBe('cursor-pagina-2-exemplo');
  });

  it(`para no teto de ${MAX_DEAL_PAGES} paginas e avisa que cortou`, async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(fixture('deals-stage-p1'))) as unknown as typeof fetch;
    const result = await makeClient(fetchImpl).listDealsInStage({ pipelineId: 9010, stageId: 9020 });
    expect(MAX_DEAL_PAGES).toBe(20);
    expect(fetchImpl).toHaveBeenCalledTimes(20);
    expect(result.truncated).toBe(true);
    expect(result.deals).toHaveLength(40);
  });
});

describe('adapter: normalizacao v1 e v2', () => {
  it('negocio v1 e v2 normalizam para o mesmo PdDeal', () => {
    const v2 = normalizeDeal((fixture('deal-v2') as { data: unknown }).data);
    const v1 = normalizeDeal((fixture('deal-v1') as { data: unknown }).data);
    const { customFields: customV1, ...restV1 } = v1;
    const { customFields: customV2, ...restV2 } = v2;

    expect(restV1).toEqual(restV2);
    expect(restV2).toMatchObject({
      id: 900001,
      title: 'R2 - 263/26 INDENT CLIENTE EXEMPLO',
      pipelineId: 9010,
      stageId: 9020,
      status: 'open',
      orgId: 900101,
      personId: 900201,
      ownerId: 900301,
      stageChangeTime: null,
      isDeleted: false,
    });
    // v2 devolve o id da opcao como numero e v1 como string; o texto e o mesmo.
    expect(customV2[TYPE_KEY]).toBe(9261);
    expect(customV1[TYPE_KEY]).toBe('9261');
    expect(readCustomFieldText(customV1, TYPE_KEY)).toBe(readCustomFieldText(customV2, TYPE_KEY));
  });

  it('datas: v1 sem fuso vale como UTC e v2 aceita ISO com Z', () => {
    const v1 = normalizeDeal((fixture('deal-v1') as { data: unknown }).data);
    expect(v1.addTime.toISOString()).toBe('2026-11-05T13:20:00.000Z');
    expect(v1.updateTime.toISOString()).toBe('2026-11-10T14:05:30.000Z');
    const v2 = normalizeDeal((fixture('deal-v2') as { data: unknown }).data);
    expect(v2.updateTime.toISOString()).toBe('2026-11-10T14:05:30.000Z');
  });

  it('org_id, person_id e owner_id aceitam numero, string numerica e objeto', () => {
    const base = { id: 1, add_time: '2026-11-05 10:00:00', title: 'x', status: 'open' };
    expect(normalizeDeal({ ...base, org_id: 7, person_id: '8', owner_id: { value: 9 } })).toMatchObject({ orgId: 7, personId: 8, ownerId: 9 });
    expect(normalizeDeal({ ...base, org_id: { value: 7, name: 'x' }, user_id: { id: 5 } })).toMatchObject({ orgId: 7, ownerId: 5 });
    expect(normalizeDeal({ ...base, org_id: null, person_id: undefined })).toMatchObject({ orgId: null, personId: null, ownerId: null });
  });

  it('stage_change_time nulo -> a entrada na coluna e add_time; preenchido vale', () => {
    const nullable = normalizeDeal((fixture('deal-v2') as { data: unknown }).data);
    expect(nullable.stageChangeTime).toBeNull();
    expect(dealStageEnteredAt(nullable).toISOString()).toBe('2026-11-05T13:20:00.000Z');

    const filled = normalizeDeal({ id: 2, add_time: '2026-11-05T10:00:00Z', stage_change_time: '2026-11-06T10:30:00Z' });
    expect(dealStageEnteredAt(filled).toISOString()).toBe('2026-11-06T10:30:00.000Z');
  });

  it('negocio sem id ou sem add_time e resposta invalida', () => {
    expect(() => normalizeDeal({ add_time: '2026-11-05 10:00:00' })).toThrow(PipedriveError);
    expect(() => normalizeDeal({ id: 1 })).toThrow(PipedriveError);
    expect(() => normalizeDeal(null)).toThrow(PipedriveError);
  });

  it('custom field: valor direto, string numerica, objeto { value }, vazio e ausente', () => {
    const bag = { a: 9261, b: '9261', c: { value: 9261 }, d: '', e: null, f: { value: null }, g: '  texto  ' };
    expect(readCustomFieldText(bag, 'a')).toBe('9261');
    expect(readCustomFieldText(bag, 'b')).toBe('9261');
    expect(readCustomFieldText(bag, 'c')).toBe('9261');
    expect(readCustomFieldText(bag, 'd')).toBeNull();
    expect(readCustomFieldText(bag, 'e')).toBeNull();
    expect(readCustomFieldText(bag, 'f')).toBeNull();
    expect(readCustomFieldText(bag, 'g')).toBe('texto');
    expect(readCustomFieldText(bag, 'ausente')).toBeNull();
    expect(readCustomFieldText(bag, null)).toBeNull();
  });

  it('organizacao v2 e v1 normalizam igual (CNPJ do campo configurado; cidade = localidade + UF)', () => {
    const v2 = normalizeOrganization((fixture('organization-v2') as { data: unknown }).data, CNPJ_KEY);
    const v1 = normalizeOrganization((fixture('organization-v1') as { data: unknown }).data, CNPJ_KEY);
    expect(v2).toEqual({ id: 900101, name: 'Cliente Exemplo Ltda', cnpjRaw: '11.222.333/0001-81', city: 'Santos, SP' });
    expect(v1).toEqual(v2);
  });

  it('organizacao sem chave de CNPJ, sem localidade ou so com localidade', () => {
    const raw = (fixture('organization-v2') as { data: Record<string, unknown> }).data;
    expect(normalizeOrganization(raw, null).cnpjRaw).toBeNull();
    expect(normalizeOrganization(raw, 'ffffffffffffffffffffffffffffffffffffffff').cnpjRaw).toBeNull();
    expect(normalizeOrganization({ id: 1, name: 'x', address: {} }, CNPJ_KEY).city).toBeNull();
    expect(normalizeOrganization({ id: 1, name: 'x', address: { locality: 'Santos' } }, CNPJ_KEY).city).toBe('Santos');
  });

  it('notas v1: autor, datas em UTC e HTML; data nula vira lista vazia', async () => {
    const notes = (fixture('notes-v1') as { data: unknown[] }).data.map(normalizeNote);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ id: 900401, authorId: 900301 });
    expect(notes[0]?.addTime.toISOString()).toBe('2026-11-05T13:25:10.000Z');
    expect(notes[0]?.updateTime.toISOString()).toBe('2026-11-05T13:25:10.000Z');
    expect(notes[0]?.html).toContain('<table>');
    expect(notes[1]?.authorId).toBe(900302);

    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: null })) as unknown as typeof fetch;
    await expect(makeClient(fetchImpl).listDealNotes(900001)).resolves.toEqual([]);
  });
});

describe('cliente: endpoints e fallback', () => {
  it('notas: pede deal_id, ordem add_time ASC e limite 100', async () => {
    const { fetchImpl, calls } = routedFetch(ALL_ROUTES);
    const notes = await makeClient(fetchImpl).listDealNotes(900001);
    expect(notes.map((note) => note.id)).toEqual([900401, 900402]);
    const params = (calls[0] as FetchCall).url.searchParams;
    expect(Object.fromEntries(params)).toEqual({ deal_id: '900001', sort: 'add_time ASC', limit: '100' });
  });

  it('notas: segue a paginacao por start', async () => {
    const first = { success: true, data: [(fixture('notes-v1') as { data: unknown[] }).data[0]], additional_data: { pagination: { more_items_in_collection: true, next_start: 100 } } };
    const second = { success: true, data: [(fixture('notes-v1') as { data: unknown[] }).data[1]], additional_data: { pagination: { more_items_in_collection: false } } };
    const pages = [first, second];
    const starts: Array<string | null> = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      starts.push(new URL(String(input)).searchParams.get('start'));
      return jsonResponse(pages.shift());
    }) as unknown as typeof fetch;
    const notes = await makeClient(fetchImpl).listDealNotes(900001);
    expect(notes).toHaveLength(2);
    expect(starts).toEqual([null, '100']);
  });

  it('organizacao: so cai para o v1 quando o v2 responde 404/410', async () => {
    const v1Calls: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      const path = new URL(String(input)).pathname;
      v1Calls.push(path);
      return path.startsWith('/api/v2/') ? emptyResponse(410) : jsonResponse(fixture('organization-v1'));
    }) as unknown as typeof fetch;
    const org = await makeClient(fetchImpl).getOrganization(900101, CNPJ_KEY);
    expect(org.cnpjRaw).toBe('11.222.333/0001-81');
    expect(v1Calls).toEqual(['/api/v2/organizations/900101', '/api/v1/organizations/900101']);

    const serverError = vi.fn(async () => emptyResponse(500)) as unknown as typeof fetch;
    await expect(makeClient(serverError).getOrganization(900101)).rejects.toBeInstanceOf(PipedriveUnavailableError);
    expect(serverError).toHaveBeenCalledTimes(1);

    const gone = vi.fn(async () => emptyResponse(404)) as unknown as typeof fetch;
    await expect(makeClient(gone).getOrganization(900101)).rejects.toBeInstanceOf(PipedriveNotFoundError);
    expect(gone).toHaveBeenCalledTimes(2);
  });

  it('pessoa, usuario, funis, colunas e campos normalizam as fixtures', async () => {
    const { fetchImpl, calls } = routedFetch(ALL_ROUTES);
    const client = makeClient(fetchImpl);

    expect(await client.getPerson(900201)).toEqual({ id: 900201, orgId: 900102 });
    expect(await client.getUser(900301)).toEqual({ id: 900301, name: 'Vendedora Exemplo' });
    expect(await client.getStage(9020)).toEqual({ id: 9020, name: 'Proposta Exemplo a Enviar', pipelineId: 9010 });
    expect((await client.listPipelines()).map((pipeline) => pipeline.id)).toEqual([9010, 9011]);
    expect((await client.listStages(9010)).map((stage) => stage.name)).toEqual([
      'Qualificacao Exemplo',
      'Proposta Exemplo a Enviar',
      'Proposta Exemplo Enviada',
    ]);
    const stagesCall = calls.find((call) => call.url.pathname === '/api/v1/stages');
    expect(stagesCall?.url.searchParams.get('pipeline_id')).toBe('9010');

    const dealFields = await client.listDealFields();
    expect(findFieldOptions(dealFields, TYPE_KEY)).toEqual([
      { id: 9260, label: 'Regular Exemplo' },
      { id: 9261, label: 'Contratipo Exemplo' },
      { id: 9262, label: 'Spot Exemplo' },
    ]);
    expect(findFieldOptions(dealFields, 'title')).toEqual([]);
    expect(findFieldOptions(dealFields, 'inexistente')).toEqual([]);
    const orgFields = await client.listOrganizationFields();
    expect(orgFields.find((field) => field.key === CNPJ_KEY)?.name).toBe('CNPJ');
  });
});

describe('cliente unico', () => {
  it('sem configuracao valida getPipedriveClient lanca not_configured e nao chama o Pipedrive', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(() => getPipedriveClient()).toThrow(expect.objectContaining({ code: 'not_configured' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('setPipedriveClientForTests injeta e remove o cliente falso', () => {
    const fake = {} as PipedriveClient;
    setPipedriveClientForTests(fake);
    expect(getPipedriveClient()).toBe(fake);
    setPipedriveClientForTests(null);
    expect(() => getPipedriveClient()).toThrow(PipedriveError);
  });
});
