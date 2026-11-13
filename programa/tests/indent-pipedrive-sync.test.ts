import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());

import type { PipedriveEnv } from '../src/config/env';
import {
  normalizeNote,
  PipedriveAuthError,
  PipedriveNotFoundError,
  PipedriveRateLimitError,
  type PdDeal,
  type PdNote,
  type PdOrganization,
  type PipedriveClient,
} from '../src/lib/pipedriveClient';
import { IndentPipedriveSyncService, type SweepOptions } from '../src/services/IndentPipedriveSyncService';
import {
  auditActions,
  fake,
  installFakeDb,
  resetFakeDb,
  resetIndentMocks,
  tx,
} from './helpers/indentRoutesMock';

// Varredura do Pipedrive -> IQ Indent (PR 5a.2): estados, idempotencia, concorrencia, coluna, corte e nota.
// Dados 100% ficticios (ids 9xxxxx, "Cliente Exemplo"). Banco em memoria (helper) e cliente do Pipedrive SEMPRE falso.

const NOW = new Date('2026-11-16T15:00:00.000Z');
const COMEX_USER = 900302;
const TOKEN = 'token-ficticio-do-teste';

function fixtureNotes(): PdNote[] {
  const file = join(__dirname, 'fixtures', 'pipedrive', 'notes-v1.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { data: unknown[] }).data.map(normalizeNote);
}

function makeEnv(overrides: Partial<PipedriveEnv> = {}): PipedriveEnv {
  return {
    configured: true,
    configErrors: [],
    apiToken: TOKEN,
    domain: 'exemplo',
    pipelineId: 9010,
    stageId: 9020,
    stageName: 'Proposta Exemplo a Enviar',
    orgCnpjFieldKey: '0123456789abcdef0123456789abcdef01234567',
    dealTypeFieldKey: 'abcdef0123456789abcdef0123456789abcdef01',
    comexUserId: COMEX_USER,
    syncSince: undefined,
    ...overrides,
  };
}

function makeDeal(id: number, title: string, overrides: Partial<PdDeal> = {}): PdDeal {
  return {
    id,
    title,
    pipelineId: 9010,
    stageId: 9020,
    status: 'open',
    orgId: 900101,
    personId: null,
    ownerId: 900301,
    addTime: new Date('2026-11-05T13:20:00.000Z'),
    updateTime: new Date('2026-11-10T14:05:30.000Z'),
    stageChangeTime: new Date('2026-11-09T10:00:00.000Z'),
    isDeleted: false,
    customFields: { abcdef0123456789abcdef0123456789abcdef01: 9261 },
    ...overrides,
  };
}

const ORG: PdOrganization = { id: 900101, name: 'Cliente Exemplo Ltda', cnpjRaw: '11.222.333/0001-81', city: 'Santos, SP' };

interface ClientSetup {
  deals?: PdDeal[];
  skipped?: number;
  stage?: { name: string; pipelineId: number };
  dealById?: Record<number, PdDeal | 'not_found'>;
  notes?: PdNote[];
  failStage?: Error;
  failList?: Error;
  failUser?: Error;
  rate?: { remaining: number | null; limit: number | null };
}

// Cliente falso com os mesmos metodos da interface; mede quantas chamadas ficam em voo ao mesmo tempo (deve ser 1).
function makeClient(setup: ClientSetup = {}) {
  const state = { inFlight: 0, maxInFlight: 0 };
  const track = <T>(value: () => T | Promise<T>) =>
    vi.fn(async () => {
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await Promise.resolve();
      try {
        return await value();
      } finally {
        state.inFlight -= 1;
      }
    });
  const client = {
    getStage: track(() => {
      if (setup.failStage) throw setup.failStage;
      return { id: 9020, ...(setup.stage ?? { name: 'Proposta Exemplo a Enviar', pipelineId: 9010 }) };
    }),
    listPipelines: track(() => [{ id: 9010, name: 'Funil Exemplo de Indent' }]),
    listDealsInStage: track(() => {
      if (setup.failList) throw setup.failList;
      return { deals: setup.deals ?? [], truncated: false, skipped: setup.skipped ?? 0 };
    }),
    getDeal: vi.fn(async (id: number) => {
      const found = setup.dealById?.[id];
      if (found === undefined || found === 'not_found') throw new PipedriveNotFoundError(404);
      return found;
    }),
    getOrganization: track(() => ORG),
    getPerson: track(() => ({ id: 900201, orgId: null })),
    getUser: track(() => {
      if (setup.failUser) throw setup.failUser;
      return { id: 900301, name: 'Vendedora Exemplo' };
    }),
    listDealNotes: track(() => setup.notes ?? fixtureNotes()),
    listDealFields: track(() => [
      { id: 1, key: 'abcdef0123456789abcdef0123456789abcdef01', name: 'Tipo', fieldType: 'enum', options: [{ id: 9261, label: 'Contratipo Exemplo' }] },
    ]),
    getRateLimitState: () => ({ dailyTokensRemaining: setup.rate?.remaining ?? 2_000_000, dailyTokensLimit: setup.rate?.limit ?? 2_160_000 }),
    listStages: vi.fn(),
    listDealsPage: vi.fn(),
    listOrganizationFields: vi.fn(),
  };
  return Object.assign(client as unknown as PipedriveClient, { spies: client, state });
}

type TestClient = ReturnType<typeof makeClient>;

function sweep(client: TestClient, overrides: Partial<SweepOptions> = {}) {
  return IndentPipedriveSyncService.runSweep({ source: 'SWEEP', budgetMs: 240_000, client, env: makeEnv(), now: NOW, ...overrides });
}

const eventsOf = (result: string) => fake.events.filter((event) => event.result === result);

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetIndentMocks();
  resetFakeDb();
  installFakeDb();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('varredura: negocio novo e idempotencia', () => {
  it('cria 1 solicitacao PIPEDRIVE com numero, itens da nota (so a nota da vendedora) e espelho', async () => {
    const result = await sweep(makeClient({ deals: [makeDeal(900001, '274/26 INDENT - CLIENTE EXEMPLO')] }));

    expect(result).toMatchObject({ outcome: 'run_ok', processed: 1, created: 1, errors: 0 });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      processNumber: '274/26',
      processYear: 2026,
      processSeq: 274,
      origin: 'PIPEDRIVE',
      pipedriveDealId: 900001,
      status: 'NOVA',
      ownerName: 'Vendedora Exemplo',
      dealType: 'Contratipo Exemplo',
      noteIncoterm: 'CFR',
      noteDestination: 'Santos',
      noteSupplierHint: 'Fabricante Exemplo',
      referenceAlert: null,
    });
    expect(fake.items.map((item) => [item.description, item.quantityKg, item.confirmed, item.source])).toEqual([
      ['RESINA EXEMPLO 223 (RXE)', 2000, false, 'NOTE'],
      ['SOLVENTE TESTE 99%', 25000, false, 'NOTE'],
    ]);
    expect(fake.mirrors[0]).toMatchObject({ dealId: 900001, requestId: 1, inSourceStage: true, parsedNumber: '274/26', currentRevision: null });
    expect(fake.sequence.get(2026)).toBe(274);
    expect(auditActions()).toContain('indent_request.pipedrive_created');
    expect(fake.config).toMatchObject({ connectionStatus: 'ok', lastSyncNewDeals: 1, lastSyncSource: 'SWEEP', pipelineName: 'Funil Exemplo de Indent' });
  });

  it('idempotencia: varrer 2x o mesmo negocio = 1 solicitacao e a 2a varredura nao processa nada', async () => {
    const client = makeClient({ deals: [makeDeal(900001, '274/26 INDENT - CLIENTE EXEMPLO')] });
    await sweep(client);
    const second = await sweep(client, { now: new Date(NOW.getTime() + 60_000) });

    expect(second).toMatchObject({ outcome: 'run_ok', processed: 0, created: 0 });
    expect(fake.requests).toHaveLength(1);
    expect(fake.items).toHaveLength(2);
    expect(client.spies.listDealNotes).toHaveBeenCalledTimes(1);
    expect(fake.mirrors[0]?.lastSeenAt).toEqual(new Date(NOW.getTime() + 60_000));
  });

  it('idempotencia: processDeal 2x com o mesmo negocio nao duplica e a 2a nao gera evento nem auditoria', async () => {
    const client = makeClient();
    const ctx = {
      source: 'SWEEP' as const,
      client,
      env: makeEnv(),
      now: NOW,
      pipelineId: 9010,
      stageId: 9020,
      cache: { owners: new Map(), orgs: new Map(), dealTypeLabels: null, catalog: null },
    };
    const deal = makeDeal(900001, '274/26 INDENT - CLIENTE EXEMPLO');

    const first = await IndentPipedriveSyncService.processDeal(deal, ctx);
    const eventsBefore = fake.events.length;
    const auditBefore = tx.auditLog.create.mock.calls.length;
    const second = await IndentPipedriveSyncService.processDeal(deal, ctx);

    expect(first).toMatchObject({ result: 'created', created: true });
    expect(second).toMatchObject({ result: 'unchanged', created: false });
    expect(fake.requests).toHaveLength(1);
    expect(fake.events).toHaveLength(eventsBefore);
    expect(tx.auditLog.create.mock.calls.length).toBe(auditBefore);
  });

  it('concorrencia 1: duas varreduras ao mesmo tempo = 1 executa, a outra recebe in_progress (claim) e nada duplica', async () => {
    const client = makeClient({ deals: [makeDeal(900001, '274/26 INDENT - CLIENTE EXEMPLO')] });
    const results = await Promise.all([sweep(client), sweep(client)]);

    expect(results.map((entry) => entry.outcome).sort()).toEqual(['in_progress', 'run_ok']);
    expect(fake.requests).toHaveLength(1);
    expect(eventsOf('in_progress')).toHaveLength(1);
    expect(fake.claimTaken).toBe(false); // o claim e liberado no finally
  });

  it('concorrencia 1: as chamadas ao Pipedrive sao sequenciais (nunca 2 em voo)', async () => {
    const client = makeClient({
      deals: [makeDeal(900001, '274/26 INDENT - A'), makeDeal(900002, '275/26 INDENT - B'), makeDeal(900003, '276/26 INDENT - C')],
    });
    await sweep(client);

    expect(fake.requests).toHaveLength(3);
    expect(client.state.maxInFlight).toBe(1);
  });

  it('claim ocupado por outra execucao: nao chama o Pipedrive e nao libera o claim alheio', async () => {
    fake.claimTaken = true;
    const client = makeClient({ deals: [makeDeal(900001, '274/26 INDENT - A')] });
    const result = await sweep(client);

    expect(result.outcome).toBe('in_progress');
    expect(client.spies.getStage).not.toHaveBeenCalled();
    expect(fake.claimTaken).toBe(true);
  });

  it('nao configurado: sem env e sem cliente injetado devolve not_configured sem tocar no banco', async () => {
    const result = await IndentPipedriveSyncService.runSweep({
      source: 'SWEEP',
      budgetMs: 1000,
      env: makeEnv({ configured: false }),
      now: NOW,
    });

    expect(result.outcome).toBe('not_configured');
    expect(fake.config).toBeNull();
  });
});

describe('varredura: funil e coluna (config_mismatch)', () => {
  it('config_mismatch: nome da coluna diferente -> nenhum negocio processado e estado gravado', async () => {
    const client = makeClient({ deals: [makeDeal(900001, '274/26 INDENT - A')], stage: { name: 'Outra Coluna Exemplo', pipelineId: 9010 } });
    const result = await sweep(client);

    expect(result.outcome).toBe('config_mismatch');
    expect(client.spies.listDealsInStage).not.toHaveBeenCalled();
    expect(fake.requests).toHaveLength(0);
    expect(fake.config).toMatchObject({ connectionStatus: 'config_mismatch' });
    expect(eventsOf('config_mismatch')).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('config_mismatch: coluna de outro funil -> idem', async () => {
    const client = makeClient({ deals: [makeDeal(900001, '274/26 INDENT - A')], stage: { name: 'Proposta Exemplo a Enviar', pipelineId: 9999 } });
    const result = await sweep(client);

    expect(result.outcome).toBe('config_mismatch');
    expect(fake.requests).toHaveLength(0);
  });

  it('o nome da coluna e comparado sem acento, caixa e espacos extras', async () => {
    const client = makeClient({ deals: [], stage: { name: '  PROPOSTA   exemplo a ENVIAR ', pipelineId: 9010 } });
    expect((await sweep(client)).outcome).toBe('run_ok');
  });
});

describe('varredura: janela de 14 dias (corte)', () => {
  const since = '2026-11-02'; // 14 dias antes de NOW (2026-11-16)

  it('janela de 14 dias: negocio que entrou antes do corte e sem espelho vira ignored_before_cutoff, 1 evento so', async () => {
    const old = makeDeal(900001, '274/26 INDENT - ANTIGO', { stageChangeTime: new Date('2026-10-20T12:00:00.000Z') });
    const recent = makeDeal(900002, '275/26 INDENT - RECENTE', { stageChangeTime: new Date('2026-11-10T12:00:00.000Z') });
    const client = makeClient({ deals: [old, recent] });

    await sweep(client, { env: makeEnv({ syncSince: since }) });
    await sweep(client, { env: makeEnv({ syncSince: since }), now: new Date(NOW.getTime() + 600_000) });

    expect(fake.requests.map((row) => row.pipedriveDealId)).toEqual([900002]);
    expect(fake.mirrors.map((row) => row.dealId)).toEqual([900002]);
    expect(eventsOf('ignored_before_cutoff')).toHaveLength(1);
    expect(client.spies.listDealNotes).toHaveBeenCalledTimes(1); // o antigo nem chega a ler organizacao/nota
  });

  it('sem stage_change_time vale add_time para o corte', async () => {
    const deal = makeDeal(900001, '274/26 INDENT - A', { stageChangeTime: null, addTime: new Date('2026-10-01T10:00:00.000Z') });
    await sweep(makeClient({ deals: [deal] }), { env: makeEnv({ syncSince: since }) });

    expect(fake.requests).toHaveLength(0);
    expect(eventsOf('ignored_before_cutoff')).toHaveLength(1);
  });

  it('com espelho ja existente o negocio antigo e processado normalmente', async () => {
    const old = makeDeal(900001, '274/26 INDENT - ANTIGO', { stageChangeTime: new Date('2026-10-20T12:00:00.000Z') });
    await sweep(makeClient({ deals: [old] })); // sem corte: importa e cria o espelho

    const renamed = { ...old, title: '274/26 INDENT - ANTIGO RENOMEADO', updateTime: new Date('2026-11-12T10:00:00.000Z') };
    await sweep(makeClient({ deals: [renamed] }), { env: makeEnv({ syncSince: since }), now: new Date(NOW.getTime() + 600_000) });

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.dealTitle).toBe('274/26 INDENT - ANTIGO RENOMEADO');
    expect(eventsOf('ignored_before_cutoff')).toHaveLength(0);
  });

  it('sem PIPEDRIVE_SYNC_SINCE importa todos os abertos da coluna', async () => {
    const old = makeDeal(900001, '274/26 INDENT - ANTIGO', { stageChangeTime: new Date('2025-01-02T12:00:00.000Z') });
    await sweep(makeClient({ deals: [old] }));
    expect(fake.requests).toHaveLength(1);
  });
});

describe('varredura: paradas e limites', () => {
  it('auth_failed: para, grava o estado, libera o claim e NENHUM log carrega o token', async () => {
    const client = makeClient({ failStage: new PipedriveAuthError(401), deals: [makeDeal(900001, '274/26 INDENT - A')] });
    const result = await sweep(client);

    expect(result.outcome).toBe('auth_failed');
    expect(fake.config).toMatchObject({ connectionStatus: 'auth_failed' });
    expect(fake.requests).toHaveLength(0);
    expect(fake.claimTaken).toBe(false);
    expect(eventsOf('auth_failed')).toHaveLength(1);
    const logged = JSON.stringify([logSpy.mock.calls, warnSpy.mock.calls, errorSpy.mock.calls]);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain('x-api-token');
  });

  it('rate_limited na lista: para com rate_limited', async () => {
    const result = await sweep(makeClient({ failList: new PipedriveRateLimitError(30) }));

    expect(result.outcome).toBe('rate_limited');
    expect(fake.config).toMatchObject({ connectionStatus: 'rate_limited' });
  });

  it('rate_limited no meio da varredura: para no 1o negocio e o resto fica para a proxima', async () => {
    const result = await sweep(
      makeClient({ failUser: new PipedriveRateLimitError(30), deals: [makeDeal(900001, '274/26 INDENT - A'), makeDeal(900002, '275/26 INDENT - B')] }),
    );

    expect(result.outcome).toBe('rate_limited');
    expect(fake.requests).toHaveLength(0);
  });

  it('budget_low: orcamento diario abaixo de 10% para antes de processar e grava os tokens restantes', async () => {
    const client = makeClient({
      deals: [makeDeal(900001, '274/26 INDENT - A'), makeDeal(900002, '275/26 INDENT - B')],
      rate: { remaining: 100_000, limit: 2_160_000 },
    });
    const result = await sweep(client);

    expect(result).toMatchObject({ outcome: 'budget_low', processed: 0, missed: 2 });
    expect(fake.requests).toHaveLength(0);
    expect(fake.config).toMatchObject({ connectionStatus: 'budget_low', dailyTokensRemaining: 100_000, dailyTokensLimit: 2_160_000 });
  });

  it('orcamento de tempo: para sem erro e conta os negocios que ficaram', async () => {
    let tick = 0;
    const clock = () => {
      const value = tick;
      tick += 1000;
      return value;
    };
    const deals = [1, 2, 3, 4].map((n) => makeDeal(900000 + n, `${270 + n}/26 INDENT - NEGOCIO ${n}`));
    const result = await sweep(makeClient({ deals }), { budgetMs: 2500, clock });

    expect(result).toMatchObject({ outcome: 'run_ok', processed: 2, missed: 2, stoppedBy: 'time_budget' });
    expect(fake.requests).toHaveLength(2);
    expect(fake.config).toMatchObject({ lastSyncMissed: 2 });
  });

  it('negocio malformado na lista (sem id/add_time): pula, conta e processa os demais', async () => {
    const result = await sweep(makeClient({ deals: [makeDeal(900001, '274/26 INDENT - A')], skipped: 1 }));

    expect(result).toMatchObject({ outcome: 'run_ok', processed: 1, skipped: 1 });
    expect(fake.config).toMatchObject({ lastSyncErrors: 1 });
    expect(fake.requests).toHaveLength(1);
  });

  it('erro em UM negocio nao derruba os outros: conta o erro e grava o evento com o codigo', async () => {
    const client = makeClient({ deals: [makeDeal(900001, '274/26 INDENT - A'), makeDeal(900002, '275/26 INDENT - B')] });
    client.spies.listDealNotes.mockRejectedValueOnce(new Error('falha de rede qualquer'));
    const result = await sweep(client);

    expect(result).toMatchObject({ outcome: 'run_ok', processed: 1, errors: 1 });
    expect(fake.requests).toHaveLength(1);
    expect(eventsOf('error')).toEqual([expect.objectContaining({ dealId: 900001, errorCode: 'unexpected' })]);
  });

  it('3 falhas seguidas encerram a varredura com error', async () => {
    const client = makeClient({ deals: [1, 2, 3, 4].map((n) => makeDeal(900000 + n, `${270 + n}/26 INDENT - ${n}`)) });
    client.spies.listDealNotes.mockRejectedValue(new Error('falha'));
    const result = await sweep(client);

    expect(result).toMatchObject({ outcome: 'error', errors: 3, missed: 1 });
    expect(fake.config).toMatchObject({ connectionStatus: 'error' });
  });
});

describe('varredura: negocio que sai da coluna, volta ou some', () => {
  async function seedTwo() {
    const a = makeDeal(900001, '274/26 INDENT - A');
    const b = makeDeal(900002, '275/26 INDENT - B');
    await sweep(makeClient({ deals: [a, b] }));
    return { a, b };
  }
  const later = new Date(NOW.getTime() + 600_000);

  it('saiu da coluna: marca o espelho e deixa a solicitacao intacta (left_stage)', async () => {
    const { a, b } = await seedTwo();
    const moved = { ...b, stageId: 9021, updateTime: new Date('2026-11-12T10:00:00.000Z') };
    const result = await sweep(makeClient({ deals: [a], dealById: { 900002: moved } }), { now: later });

    expect(result.processed).toBe(1);
    expect(fake.mirrors[1]).toMatchObject({ inSourceStage: false, leftStageAt: later });
    expect(fake.requests[1]).toMatchObject({ status: 'NOVA', dealTitle: '275/26 INDENT - B' });
    expect(eventsOf('left_stage')).toHaveLength(1);
  });

  it('ganho ou perdido: tambem sai da coluna (status != open)', async () => {
    const { a, b } = await seedTwo();
    await sweep(makeClient({ deals: [a], dealById: { 900002: { ...b, status: 'won', updateTime: new Date('2026-11-12T10:00:00.000Z') } } }), { now: later });

    expect(fake.mirrors[1]).toMatchObject({ inSourceStage: false });
    expect(eventsOf('left_stage')).toHaveLength(1);
  });

  it('404 do negocio: notFoundAt e solicitacao intacta (not_found)', async () => {
    const { a } = await seedTwo();
    await sweep(makeClient({ deals: [a], dealById: { 900002: 'not_found' } }), { now: later });

    expect(fake.mirrors[1]).toMatchObject({ inSourceStage: false, notFoundAt: later });
    expect(fake.requests[1]).toMatchObject({ status: 'NOVA' });
    expect(eventsOf('not_found')).toHaveLength(1);
  });

  it('is_deleted tambem vira not_found', async () => {
    const { a, b } = await seedTwo();
    await sweep(makeClient({ deals: [a], dealById: { 900002: { ...b, isDeleted: true } } }), { now: later });
    expect(fake.mirrors[1]?.notFoundAt).toEqual(later);
  });

  it('volta para a coluna: stage_reentered atualiza a entrada e NAO muda o status da solicitacao', async () => {
    const { a, b } = await seedTwo();
    await sweep(makeClient({ deals: [a], dealById: { 900002: { ...b, stageId: 9021, updateTime: new Date('2026-11-12T10:00:00.000Z') } } }), { now: later });

    const back = { ...b, stageChangeTime: new Date('2026-11-14T09:00:00.000Z'), updateTime: new Date('2026-11-14T09:00:01.000Z') };
    fake.requests[1]!.status = 'COTACAO';
    await sweep(makeClient({ deals: [a, back] }), { now: new Date(later.getTime() + 600_000) });

    expect(fake.mirrors[1]).toMatchObject({ inSourceStage: true, leftStageAt: null, stageEnteredAt: back.stageChangeTime });
    expect(fake.requests[1]).toMatchObject({ status: 'COTACAO', stageEnteredAt: back.stageChangeTime });
    expect(eventsOf('stage_reentered')).toHaveLength(1);
    expect(fake.requests).toHaveLength(2);
  });

  it('ordem trocada: negocio com update_time anterior ao do espelho vira ignored_stale e nao reverte nada', async () => {
    const deal = makeDeal(900001, '274/26 INDENT - NOVO TITULO', { updateTime: new Date('2026-11-12T10:00:00.000Z') });
    await sweep(makeClient({ deals: [deal] }));
    const stale = { ...deal, title: '274/26 INDENT - TITULO ANTIGO', updateTime: new Date('2026-11-11T10:00:00.000Z') };
    await sweep(makeClient({ deals: [stale] }), { now: later });

    expect(fake.requests[0]?.dealTitle).toBe('274/26 INDENT - NOVO TITULO');
    expect(eventsOf('ignored_stale')).toHaveLength(1);
  });
});

describe('varredura: responsavel e tipo de negocio', () => {
  it('responsavel sem nome no Pipedrive vira "Proprietario #id" e tipo sem rotulo fica nulo', async () => {
    const deal = makeDeal(900001, '274/26 INDENT - A', { customFields: { abcdef0123456789abcdef0123456789abcdef01: 99999 } });
    await sweep(makeClient({ deals: [deal], failUser: new PipedriveNotFoundError(404) }));

    expect(fake.requests[0]).toMatchObject({ ownerName: 'Proprietário #900301', dealType: null });
  });

  it('sem a env do tipo de negocio o campo nao e lido nem sobrescrito', async () => {
    const client = makeClient({ deals: [makeDeal(900001, '274/26 INDENT - A')] });
    await sweep(client, { env: makeEnv({ dealTypeFieldKey: undefined }) });

    expect(client.spies.listDealFields).not.toHaveBeenCalled();
    expect(fake.requests[0]?.dealType).toBeNull();
  });
});

describe('varredura: nota do negocio', () => {
  const later = new Date(NOW.getTime() + 600_000);
  const tableNote = (html: string, id = 900500): PdNote => ({
    id,
    authorId: 900301,
    addTime: new Date('2026-11-12T10:00:00.000Z'),
    updateTime: new Date('2026-11-12T10:00:00.000Z'),
    html,
  });
  const NEW_LIST = '<div>@Equipe Compras</div><table><tbody><tr><td>PRODUTO NOVO EXEMPLO</td><td>1.500</td></tr></tbody></table>';

  async function seed() {
    const deal = makeDeal(900001, '274/26 INDENT - A');
    await sweep(makeClient({ deals: [deal] }));
    return { ...deal, updateTime: new Date('2026-11-12T10:00:00.000Z') };
  }

  it('nota alterada ANTES da confirmacao substitui os itens da nota (note_replaced)', async () => {
    const changed = await seed();
    await sweep(makeClient({ deals: [changed], notes: [tableNote(NEW_LIST)] }), { now: later });

    expect(fake.items.map((item) => [item.description, item.quantityKg])).toEqual([['PRODUTO NOVO EXEMPLO', 1500]]);
    expect(fake.requests[0]).toMatchObject({ noteChangedAt: null });
    expect(eventsOf('note_replaced')).toHaveLength(1);
    expect(auditActions()).toContain('indent_request.note_replaced');
  });

  it('nota alterada DEPOIS da confirmacao: itens intactos e alerta noteChangedAt (note_changed)', async () => {
    const changed = await seed();
    fake.items.forEach((item) => (item.confirmed = true));
    await sweep(makeClient({ deals: [changed], notes: [tableNote(NEW_LIST)] }), { now: later });

    expect(fake.items.map((item) => item.description)).toEqual(['RESINA EXEMPLO 223 (RXE)', 'SOLVENTE TESTE 99%']);
    expect(fake.requests[0]?.noteChangedAt).toEqual(later);
    expect(fake.requests[0]?.rawNote).toContain('PRODUTO NOVO EXEMPLO');
    expect(eventsOf('note_changed')).toHaveLength(1);
  });

  it('depois de NOVA (cotacao gerada) so alerta, mesmo sem item confirmado', async () => {
    const changed = await seed();
    fake.requests[0]!.status = 'COTACAO';
    await sweep(makeClient({ deals: [changed], notes: [tableNote(NEW_LIST)] }), { now: later });

    expect(fake.items).toHaveLength(2);
    expect(fake.requests[0]?.noteChangedAt).toEqual(later);
  });

  it('refresh de 60 min: so em NOVA, sem mudanca de update_time', async () => {
    const deal = makeDeal(900001, '274/26 INDENT - A');
    const client = makeClient({ deals: [deal] });
    await sweep(client);
    await sweep(client, { now: new Date(NOW.getTime() + 30 * 60_000) });
    expect(client.spies.listDealNotes).toHaveBeenCalledTimes(1);

    await sweep(client, { now: new Date(NOW.getTime() + 61 * 60_000) });
    expect(client.spies.listDealNotes).toHaveBeenCalledTimes(2);

    fake.requests[0]!.status = 'COTACAO';
    await sweep(client, { now: new Date(NOW.getTime() + 130 * 60_000) });
    expect(client.spies.listDealNotes).toHaveBeenCalledTimes(2);
  });

  it('nenhuma nota parseavel: solicitacao criada com 0 itens e a nota bruta guardada ("Itens a digitar")', async () => {
    const note = tableNote('<div><a data-mentions="900301:900302">@Equipe Compras</a> bom dia, podem cotar?</div>');
    await sweep(makeClient({ deals: [makeDeal(900001, '274/26 INDENT - A')], notes: [note] }));

    expect(fake.requests[0]).toMatchObject({ processNumber: '274/26', noteHash: expect.any(String) });
    expect(fake.requests[0]?.rawNote).toContain('podem cotar');
    expect(fake.items).toHaveLength(0);
  });

  it('negocio sem nenhuma nota: cria sem itens, sem nota e sem hash; a nota que chega depois preenche os itens', async () => {
    const deal = makeDeal(900001, '274/26 INDENT - A');
    await sweep(makeClient({ deals: [deal], notes: [] }));
    expect(fake.requests[0]).toMatchObject({ rawNote: null, noteHash: null });
    expect(fake.items).toHaveLength(0);

    await sweep(makeClient({ deals: [{ ...deal, updateTime: new Date('2026-11-12T10:00:00.000Z') }], notes: [tableNote(NEW_LIST)] }), { now: later });
    expect(fake.items.map((item) => item.description)).toEqual(['PRODUTO NOVO EXEMPLO']);
    expect(fake.requests[0]?.noteChangedAt ?? null).toBeNull();
  });

  it('a resposta da equipe Compras e descartada: so a nota da vendedora vira itens', async () => {
    await sweep(makeClient({ deals: [makeDeal(900001, '274/26 INDENT - A')] }));
    expect(fake.items).toHaveLength(2);
    expect(String(fake.requests[0]?.rawNote)).not.toContain('retornamos com os precos');
  });

  it('nao grava nota, CNPJ nem nome de pessoa no AuditLog nem nos logs', async () => {
    await sweep(makeClient({ deals: [makeDeal(900001, '274/26 INDENT - A')] }));

    const audited = JSON.stringify(tx.auditLog.create.mock.calls);
    const logged = JSON.stringify([logSpy.mock.calls, warnSpy.mock.calls, errorSpy.mock.calls]);
    for (const text of [audited, logged]) {
      expect(text).not.toContain('RESINA EXEMPLO');
      expect(text).not.toContain('11222333000181');
      expect(text).not.toContain('Vendedora Exemplo');
    }
  });
});
