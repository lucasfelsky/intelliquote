import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PipedriveEnv } from '../src/config/env';
import { normalizeNote, PipedriveNotFoundError, type PdDeal, type PipedriveClient } from '../src/lib/pipedriveClient';
import { prisma } from '../src/lib/prisma';
import { IndentPendingOrgService } from '../src/services/IndentPendingOrgService';
import { IndentPipedriveSyncService, type ProcessContext } from '../src/services/IndentPipedriveSyncService';
import { IndentRequestService } from '../src/services/IndentRequestService';
import { formatProcessNumber } from '../src/utils/indentProcessNumber';
import { hashPassword } from '../src/utils/password';
import { todayKeyInSaoPaulo } from '../src/utils/supplierDocumentDates';

// Banco real descartavel (scripts/test-critical-local.mjs aplica todas as migrations, inclusive 20261116120000_indent_pipedrive).
// Sem RUN_DB_TESTS=true os testes sao pulados. Cliente do Pipedrive SEMPRE falso; dados 100% ficticios (ids 9xxxxx).
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `indent-pd-db-${Date.now()}`;
const YEAR = Number(todayKeyInSaoPaulo(new Date()).slice(0, 4));
const YY = String(YEAR % 100).padStart(2, '0');
const NOW = new Date();
const STARTED_AT = new Date(Date.now() - 1000);

const ENV: PipedriveEnv = {
  configured: true,
  configErrors: [],
  apiToken: 'token-ficticio-do-teste',
  domain: 'exemplo',
  pipelineId: 9010,
  stageId: 9020,
  stageName: 'Proposta Exemplo a Enviar',
  orgCnpjFieldKey: '0123456789abcdef0123456789abcdef01234567',
  dealTypeFieldKey: undefined,
  comexUserId: 900302,
  syncSince: undefined,
};

let nextDealId = 910_000 + (Date.now() % 50_000) * 10;
const dealIds: number[] = [];

function makeDeal(title: string, overrides: Partial<PdDeal> = {}): PdDeal {
  const id = nextDealId++;
  dealIds.push(id);
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
    customFields: {},
    ...overrides,
  };
}

interface FakeOrg {
  id: number;
  name: string;
  cnpjRaw: string | null;
  city: string | null;
}

function makeClient(deals: PdDeal[], orgs: FakeOrg[] = []): PipedriveClient {
  const notes = (JSON.parse(readFileSync(join(__dirname, 'fixtures', 'pipedrive', 'notes-v1.json'), 'utf8')) as { data: unknown[] }).data.map(
    normalizeNote,
  );
  return {
    getStage: vi.fn(async () => ({ id: 9020, name: 'Proposta Exemplo a Enviar', pipelineId: 9010 })),
    listPipelines: vi.fn(async () => [{ id: 9010, name: 'Funil Exemplo de Indent' }]),
    listDealsInStage: vi.fn(async () => ({ deals, truncated: false, skipped: 0 })),
    getDeal: vi.fn(async () => {
      throw new PipedriveNotFoundError(404);
    }),
    getOrganization: vi.fn(async (id: number) => orgs.find((org) => org.id === id) ?? { id: 900101, name: `Cliente Exemplo ${runId}`, cnpjRaw: '11.222.333/0001-81', city: 'Santos, SP' }),
    getPerson: vi.fn(async () => ({ id: 900201, orgId: null })),
    getUser: vi.fn(async () => ({ id: 900301, name: 'Vendedora Exemplo' })),
    listDealNotes: vi.fn(async () => notes),
    listDealFields: vi.fn(async () => []),
    getRateLimitState: () => ({ dailyTokensRemaining: 2_000_000, dailyTokensLimit: 2_160_000 }),
  } as unknown as PipedriveClient;
}

function contextFor(client: PipedriveClient): ProcessContext {
  return {
    source: 'SWEEP',
    client,
    env: ENV,
    now: NOW,
    pipelineId: 9010,
    stageId: 9020,
    cache: { owners: new Map(), orgs: new Map(), dealTypeLabels: null, catalog: null },
  };
}

const sweep = (client: PipedriveClient) =>
  IndentPipedriveSyncService.runSweep({ source: 'SWEEP', budgetMs: 60_000, client, env: ENV, now: NOW });

describe('IQ Indent - sincronizacao Pipedrive (DB)', () => {
  let iqClientId = 0;
  let userId = 0;
  const quiet = () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  };

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;
    quiet();
    // Usuario do IQ que cria solicitacoes pela API do IQ (concorrendo com o Pipedrive): o AuditLog exige usuario existente.
    const role = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    userId = (
      await prisma.user.create({
        data: { name: `Dono ${runId}`, email: `${runId}@intelliquote.local`, passwordHash: await hashPassword('Test1234!'), roleId: role.id },
      })
    ).id;
    iqClientId = (
      await prisma.indentClient.create({ data: { name: `Cliente IQ ${runId}`, cnpj: `7${Date.now()}`.slice(0, 14) } })
    ).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const requests = await prisma.indentRequest.findMany({
      where: { OR: [{ pipedriveDealId: { in: dealIds } }, { clientId: iqClientId }, { ownerName: `Dono ${runId}` }] },
      select: { id: true },
    });
    const ids = requests.map((request) => request.id);
    await prisma.auditLog.deleteMany({ where: { entityType: 'indent_request', entityId: { in: ids.map(String) } } });
    await prisma.indentPipedriveEvent.deleteMany({ where: { OR: [{ dealId: { in: dealIds } }, { dealId: null, receivedAt: { gte: STARTED_AT } }] } });
    await prisma.indentPipedriveDeal.deleteMany({ where: { dealId: { in: dealIds } } });
    await prisma.indentRequest.deleteMany({ where: { id: { in: ids } } });
    await prisma.indentIntegrationConfig.deleteMany({});
    await prisma.auditLog.deleteMany({ where: { performedById: userId } });
    await prisma.indentClient.deleteMany({ where: { OR: [{ id: iqClientId }, { name: { contains: runId } }] } });
    await prisma.indentProduct.deleteMany({ where: { nameKey: { contains: runId } } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  testDbSkip('migration: varias solicitacoes sem numero (NULL) convivem e o numero preenchido continua unico', async () => {
    const [a, b] = await Promise.all(
      [0, 1].map((n) =>
        prisma.indentRequest.create({
          data: { processNumber: null, processYear: null, processSeq: null, origin: 'PIPEDRIVE', pipedriveDealId: makeDeal(`x ${n}`).id, ownerName: `Dono ${runId}` },
        }),
      ),
    );
    expect(a.processNumber).toBeNull();
    expect(b.processNumber).toBeNull();

    const number = formatProcessNumber(YEAR, 8800);
    const created = await prisma.indentRequest.create({
      data: { processNumber: number, processYear: YEAR, processSeq: 8800, origin: 'IQ_INDENT', ownerName: `Dono ${runId}` },
    });
    await expect(
      prisma.indentRequest.create({
        data: { processNumber: number, processYear: YEAR, processSeq: 8801, origin: 'IQ_INDENT', ownerName: `Dono ${runId}` },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(created.processNumber).toBe(number);
  });

  testDbSkip('processDeal 2x = 1 solicitacao (idempotente) e a 2a vez nao muda nada', async () => {
    const deal = makeDeal(`${8810}/${YY} INDENT - CLIENTE EXEMPLO`);
    const ctx = contextFor(makeClient([deal]));

    await IndentPipedriveSyncService.processDeal(deal, ctx);
    const second = await IndentPipedriveSyncService.processDeal(deal, ctx);

    expect(second.result).toBe('unchanged');
    expect(await prisma.indentRequest.count({ where: { pipedriveDealId: deal.id } })).toBe(1);
    const request = await prisma.indentRequest.findFirstOrThrow({ where: { pipedriveDealId: deal.id }, include: { items: true } });
    expect(request).toMatchObject({ processNumber: `8810/${YY}`, origin: 'PIPEDRIVE', status: 'NOVA' });
    expect(request.items.map((item) => [item.description, Number(item.quantityKg), item.source, item.confirmed])).toEqual([
      ['RESINA EXEMPLO 223 (RXE)', 2000, 'NOTE', false],
      ['SOLVENTE TESTE 99%', 25000, 'NOTE', false],
    ]);
    expect(await prisma.indentPipedriveDeal.count({ where: { dealId: deal.id } })).toBe(1);
  });

  testDbSkip('processDeal concorrente do MESMO negocio (advisory lock): 1 solicitacao, 1 espelho', async () => {
    const deal = makeDeal(`8820/${YY} INDENT - CONCORRENTE`);
    const ctx = contextFor(makeClient([deal]));
    const results = await Promise.all([1, 2, 3, 4].map(() => IndentPipedriveSyncService.processDeal(deal, ctx)));

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await prisma.indentRequest.count({ where: { pipedriveDealId: deal.id } })).toBe(1);
    expect(await prisma.indentPipedriveDeal.count({ where: { dealId: deal.id } })).toBe(1);
    expect(await prisma.indentRequest.count({ where: { processNumber: `8820/${YY}` } })).toBe(1);
  });

  testDbSkip('renomear para "R2 - ..." = a mesma solicitacao, revisao 2 e historico +1', async () => {
    const deal = makeDeal(`8830/${YY} INDENT - CLIENTE EXEMPLO`);
    const ctx = contextFor(makeClient([deal]));
    await IndentPipedriveSyncService.processDeal(deal, ctx);
    const renamed = { ...deal, title: `R2 - 8830/${YY} INDENT - CLIENTE EXEMPLO`, updateTime: new Date(deal.updateTime.getTime() + 3_600_000) };
    const result = await IndentPipedriveSyncService.processDeal(renamed, ctx);

    expect(result.results).toContain('revision_detected');
    expect(await prisma.indentRequest.count({ where: { pipedriveDealId: deal.id } })).toBe(1);
    const mirror = await prisma.indentPipedriveDeal.findUniqueOrThrow({ where: { dealId: deal.id } });
    expect(mirror.currentRevision).toBe(2);
    expect(mirror.revisionHistory).toHaveLength(1);
    const request = await prisma.indentRequest.findFirstOrThrow({ where: { pipedriveDealId: deal.id } });
    expect(request.revisionAlertAt).not.toBeNull();
  });

  testDbSkip('numero do Pipedrive maior sobe a sequencia e criacao IQ concorrente gera numeros distintos', async () => {
    const sequence = await prisma.indentSequence.findUnique({ where: { year: YEAR } });
    const target = Math.min(9000, (sequence?.lastNumber ?? 0) + 60);
    const deal = makeDeal(`${target}/${YY} INDENT - SEQUENCIA`);
    const actor = { id: userId, name: `Dono ${runId}` };
    const createIq = () =>
      IndentRequestService.create({ clientId: iqClientId, items: [{ description: `Item livre ${runId}`, quantityKg: 10 }] }, actor);

    const [, ...iq] = await Promise.all([
      IndentPipedriveSyncService.processDeal(deal, contextFor(makeClient([deal]))),
      createIq(),
      createIq(),
      createIq(),
    ]);

    const numbers = [
      ...(await prisma.indentRequest.findMany({ where: { pipedriveDealId: deal.id }, select: { processNumber: true } })).map((row) => row.processNumber),
      ...iq.map((created) => created.processNumber),
    ];
    expect(numbers).toHaveLength(4);
    expect(new Set(numbers).size).toBe(4);
    expect((await prisma.indentSequence.findUniqueOrThrow({ where: { year: YEAR } })).lastNumber).toBeGreaterThanOrEqual(target);

    // Depois da subida, a proxima criacao do IQ segue o maior numero (nunca repete).
    const next = await createIq();
    expect(Number(next.processNumber?.split('/')[0])).toBeGreaterThan(target);
  });

  testDbSkip('numero MENOR depois de um maior nao faz a sequencia descer (GREATEST)', async () => {
    const base = (await prisma.indentSequence.findUnique({ where: { year: YEAR } }))?.lastNumber ?? 0;
    const high = makeDeal(`${base + 80}/${YY} INDENT - ALTO`);
    const low = makeDeal(`${base + 20}/${YY} INDENT - BAIXO`);
    await IndentPipedriveSyncService.processDeal(high, contextFor(makeClient([high])));
    await IndentPipedriveSyncService.processDeal(low, contextFor(makeClient([low])));

    expect((await prisma.indentSequence.findUniqueOrThrow({ where: { year: YEAR } })).lastNumber).toBeGreaterThanOrEqual(base + 80);
    expect(await prisma.indentRequest.count({ where: { pipedriveDealId: { in: [high.id, low.id] }, processNumber: { not: null } } })).toBe(2);
  });

  testDbSkip('varreduras concorrentes: o claim real deixa 1 rodar e a outra recebe in_progress; o claim e liberado', async () => {
    const deal = makeDeal(`8840/${YY} INDENT - CLAIM`);
    const client = makeClient([deal]);
    const results = await Promise.all([sweep(client), sweep(client), sweep(client)]);

    expect(results.filter((entry) => entry.outcome === 'run_ok')).toHaveLength(1);
    expect(results.filter((entry) => entry.outcome === 'in_progress')).toHaveLength(2);
    expect(await prisma.indentRequest.count({ where: { pipedriveDealId: deal.id } })).toBe(1);
    const config = await prisma.indentIntegrationConfig.findUniqueOrThrow({ where: { id: 1 } });
    expect(config).toMatchObject({ sweepLockedUntil: null, connectionStatus: 'ok', lastSyncSource: 'SWEEP', pipelineName: 'Funil Exemplo de Indent' });
  });

  testDbSkip('cliente sem correspondencia: solicitacao sem cliente e UMA pendencia aberta com a organizacao e o CNPJ', async () => {
    const deal = makeDeal(`8850/${YY} INDENT - PENDENCIA`);
    await IndentPipedriveSyncService.processDeal(deal, contextFor(makeClient([deal])));
    const request = await prisma.indentRequest.findFirstOrThrow({ where: { pipedriveDealId: deal.id } });
    const pendings = await prisma.indentPendingOrg.findMany({ where: { requestId: request.id } });

    expect(request.clientId).toBeNull();
    expect(pendings).toHaveLength(1);
    expect(pendings[0]).toMatchObject({ status: 'OPEN', dealId: deal.id });
    expect(pendings[0]?.candidates).toEqual([{ orgId: 900101, name: `Cliente Exemplo ${runId}`, cnpj: '11222333000181', city: 'Santos, SP' }]);
  });

  // ---- PR 5a.3: fila de vinculo, referencia pendente e itens da nota ----
  const org = (id: number, cnpjRaw: string | null, label: string): FakeOrg => ({ id, name: `Cliente Exemplo ${label} ${runId}`, cnpjRaw, city: 'Itajai, SC' });
  const actor = () => ({ id: userId, name: `Dono ${runId}` });
  const pendingOf = async (dealId: number) => prisma.indentPendingOrg.findFirstOrThrow({ where: { dealId } });
  const asDeal = (title: string, orgId: number) => makeDeal(title, { orgId });

  testDbSkip('fila: criar cliente liga a solicitacao, grava a organizacao e resolve as pendencias irmas (so as da mesma organizacao)', async () => {
    const orgB = org(900150, '11.444.777/0001-61', 'B');
    const orgC = org(900151, null, 'C');
    const [d1, d2, d3] = [asDeal(`9400/${YY} INDENT - FILA B1`, 900150), asDeal(`9401/${YY} INDENT - FILA B2`, 900150), asDeal(`9402/${YY} INDENT - FILA C`, 900151)];
    const client = makeClient([d1, d2, d3], [orgB, orgC]);

    for (const deal of [d1, d2, d3]) await IndentPipedriveSyncService.processDeal(deal, contextFor(client));
    const first = await pendingOf(d1.id);
    const result = await IndentPendingOrgService.createClient(first.id, { orgId: 900150 }, actor());

    expect(result.client).toMatchObject({ name: orgB.name, cnpj: '11444777000161', pipedriveOrgId: 900150 });
    expect(result.resolved).toHaveLength(2);
    const created = await prisma.indentClient.findUniqueOrThrow({ where: { id: result.client.id } });
    expect(created).toMatchObject({ supplierRuleMode: 'LIVRE', isActive: true, pipedriveOrgId: 900150 });
    const requests = await prisma.indentRequest.findMany({ where: { pipedriveDealId: { in: [d1.id, d2.id, d3.id] } }, orderBy: { pipedriveDealId: 'asc' } });
    expect(requests.map((request) => request.clientId)).toEqual([created.id, created.id, null]);
    expect((await pendingOf(d1.id)).status).toBe('RESOLVED');
    expect(await pendingOf(d2.id)).toMatchObject({ status: 'RESOLVED', resolvedClientId: created.id, resolvedOrgId: 900150, resolvedById: userId });
    expect((await pendingOf(d3.id)).status).toBe('OPEN');

    // A pendencia ja resolvida nao resolve de novo; e a proxima varredura casa pelo pipedriveOrgId (sem pendencia nova).
    await expect(IndentPendingOrgService.createClient(first.id, { orgId: 900150 }, actor())).rejects.toMatchObject({ status: 409 });
    const d4 = asDeal(`9403/${YY} INDENT - FILA B3`, 900150);
    await IndentPipedriveSyncService.processDeal(d4, contextFor(makeClient([d4], [orgB])));
    expect((await prisma.indentRequest.findFirstOrThrow({ where: { pipedriveDealId: d4.id } })).clientId).toBe(created.id);
    expect(await prisma.indentPendingOrg.count({ where: { dealId: d4.id } })).toBe(0);
  });

  testDbSkip('fila: duas pessoas resolvendo a MESMA pendencia ao mesmo tempo -> 1 cliente criado, a outra recebe 409', async () => {
    const orgD = org(900160, null, 'D');
    const deal = asDeal(`9410/${YY} INDENT - FILA CONCORRENTE`, 900160);
    await IndentPipedriveSyncService.processDeal(deal, contextFor(makeClient([deal], [orgD])));
    const pending = await pendingOf(deal.id);

    const results = await Promise.allSettled([1, 2, 3].map(() => IndentPendingOrgService.createClient(pending.id, { orgId: 900160 }, actor())));

    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((entry) => entry.status === 'rejected')).toHaveLength(2);
    expect(await prisma.indentClient.count({ where: { pipedriveOrgId: 900160 } })).toBe(1);
    // Sem CNPJ na organizacao nem no corpo: nasce "CNPJ pendente".
    expect((await prisma.indentClient.findFirstOrThrow({ where: { pipedriveOrgId: 900160 } })).cnpj).toBeNull();
  });

  testDbSkip('fila: vincular a cliente SEM CNPJ completa o CNPJ (P5); CNPJ ja usado por outro cliente nao completa', async () => {
    const orgE = org(900170, '11.222.333/0001-81', 'E');
    const orgF = org(900171, '11.222.333/0001-81', 'F');
    const [dE, dF] = [asDeal(`9420/${YY} INDENT - LINK E`, 900170), asDeal(`9421/${YY} INDENT - LINK F`, 900171)];
    const client = makeClient([dE, dF], [orgE, orgF]);
    await IndentPipedriveSyncService.processDeal(dE, contextFor(client));
    await IndentPipedriveSyncService.processDeal(dF, contextFor(client));
    const withoutCnpj = await prisma.indentClient.create({ data: { name: `Cliente Sem CNPJ E ${runId}` } });
    const other = await prisma.indentClient.create({ data: { name: `Cliente Sem CNPJ F ${runId}` } });

    const linked = await IndentPendingOrgService.link((await pendingOf(dE.id)).id, { orgId: 900170, clientId: withoutCnpj.id }, actor());
    expect(linked.cnpjCompleted).toBe(true);
    expect(await prisma.indentClient.findUniqueOrThrow({ where: { id: withoutCnpj.id } })).toMatchObject({ cnpj: '11222333000181', pipedriveOrgId: 900170 });

    // A organizacao F tem o mesmo CNPJ, agora de outro cliente: o vinculo segue, o CNPJ nao e copiado.
    const second = await IndentPendingOrgService.link((await pendingOf(dF.id)).id, { orgId: 900171, clientId: other.id }, actor());
    expect(second.cnpjCompleted).toBe(false);
    expect(await prisma.indentClient.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ cnpj: null, pipedriveOrgId: 900171 });
    expect((await prisma.indentRequest.findFirstOrThrow({ where: { pipedriveDealId: dF.id } })).clientId).toBe(other.id);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'indent_client', entityId: String(withoutCnpj.id), action: 'indent_client.cnpj_from_pipedrive' } });
    expect(log.performedById).toBe(userId);
    expect(JSON.stringify(log)).not.toContain('11222333000181');
  });

  testDbSkip('referencia: digitar o numero grava e sobe a sequencia; numero usado -> 409; duas digitacoes do mesmo numero -> 1 vence', async () => {
    const [a, b] = [makeDeal('INDENT - SEM NUMERO A'), makeDeal('INDENT - SEM NUMERO B')];
    const client = makeClient([a, b]);
    await IndentPipedriveSyncService.processDeal(a, contextFor(client));
    await IndentPipedriveSyncService.processDeal(b, contextFor(client));
    const [ra, rb] = await Promise.all([a, b].map((deal) => prisma.indentRequest.findFirstOrThrow({ where: { pipedriveDealId: deal.id } })));
    expect([ra.processNumber, rb.processNumber]).toEqual([null, null]);

    const results = await Promise.allSettled([
      IndentPipedriveSyncService.setReference(ra.id, `9500/${YY}`, actor()),
      IndentPipedriveSyncService.setReference(rb.id, `9500/${YY}`, actor()),
    ]);
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((entry) => entry.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, message: 'Já existe uma solicitação com este número.' });
    expect(await prisma.indentRequest.count({ where: { processNumber: `9500/${YY}` } })).toBe(1);
    expect((await prisma.indentSequence.findUniqueOrThrow({ where: { year: YEAR } })).lastNumber).toBeGreaterThanOrEqual(9500);

    const winner = [ra, rb].find((_, index) => results[index]?.status === 'fulfilled') as typeof ra;
    const loser = winner === ra ? rb : ra;
    const done = await prisma.indentRequest.findUniqueOrThrow({ where: { id: winner.id } });
    expect(done).toMatchObject({ processNumber: `9500/${YY}`, processYear: YEAR, processSeq: 9500, referenceAlert: null });
    await expect(IndentPipedriveSyncService.setReference(winner.id, `9501/${YY}`, actor())).rejects.toMatchObject({ status: 409, message: 'A solicitação já tem referência.' });
    expect((await prisma.indentRequest.findUniqueOrThrow({ where: { id: loser.id } })).processNumber).toBeNull();

    // Numero MENOR depois de um maior: a sequencia nao desce.
    await IndentPipedriveSyncService.setReference(loser.id, `9490/${YY}`, actor());
    expect((await prisma.indentSequence.findUniqueOrThrow({ where: { year: YEAR } })).lastNumber).toBeGreaterThanOrEqual(9500);
  });

  testDbSkip('itens da nota: a confirmacao humana vira item LIVRE (sem numero de origem na referencia pendente) e libera a nota alterada', async () => {
    const deal = makeDeal('INDENT - ITENS DA NOTA');
    await IndentPipedriveSyncService.processDeal(deal, contextFor(makeClient([deal])));
    const request = await prisma.indentRequest.findFirstOrThrow({ where: { pipedriveDealId: deal.id }, include: { items: { orderBy: { position: 'asc' } } } });
    expect(request.processNumber).toBeNull();
    expect(request.items.map((item) => item.confirmed)).toEqual([false, false]);
    await prisma.indentRequest.update({ where: { id: request.id }, data: { noteChangedAt: new Date() } });

    const description = `Item revisado ${runId}`;
    const [first, second] = request.items;
    const detail = await IndentRequestService.updateNoteItems(
      request.id,
      {
        items: [
          { id: first?.id, description, quantityKg: 2500.5 },
          { id: second?.id, remove: true },
          { description: `Item novo ${runId}`, quantityKg: 10 },
        ],
      },
      actor(),
    );

    expect(detail.items.map((item) => [item.confirmed, item.source, item.isFree])).toEqual([
      [true, 'NOTE', true],
      [true, 'MANUAL', true],
    ]);
    expect(detail.noteChangedAt).toBeNull();
    const product = await prisma.indentProduct.findFirstOrThrow({ where: { nameKey: description.toLowerCase() } });
    expect(product).toMatchObject({ origin: 'LIVRE', sourceRequestNumber: null });
    expect(await prisma.indentRequestItem.count({ where: { requestId: request.id } })).toBe(2);

    // Nota que muda depois da confirmacao: itens intactos, so o alerta (decisao 21).
    const changed = { ...deal, updateTime: new Date(deal.updateTime.getTime() + 3_600_000) };
    const notes = await makeClient([deal]).listDealNotes(deal.id);
    const edited = makeClient([changed]);
    (edited.listDealNotes as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(notes.map((note) => ({ ...note, html: `${note.html}<div>${runId} acrescentado</div>` })));
    await IndentPipedriveSyncService.processDeal(changed, contextFor(edited));
    const after = await prisma.indentRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.noteChangedAt).not.toBeNull();
    expect(await prisma.indentRequestItem.count({ where: { requestId: request.id, confirmed: true } })).toBe(2);
  });

  testDbSkip('referencia: sequencia acima de 9999 e recusada (400) e NAO sobe a IndentSequence; 9999 passa', async () => {
    const deal = makeDeal('INDENT - TETO DA SEQUENCIA');
    await IndentPipedriveSyncService.processDeal(deal, contextFor(makeClient([deal])));
    const request = await prisma.indentRequest.findFirstOrThrow({ where: { pipedriveDealId: deal.id } });
    const before = (await prisma.indentSequence.findUniqueOrThrow({ where: { year: YEAR } })).lastNumber;

    for (const number of [`274000/${YY}`, `10000/${YY}`, `99999999999/${YY}`]) {
      await expect(IndentPipedriveSyncService.setReference(request.id, number, actor()), number).rejects.toMatchObject({ status: 400 });
    }
    expect((await prisma.indentSequence.findUniqueOrThrow({ where: { year: YEAR } })).lastNumber).toBe(before);
    expect((await prisma.indentRequest.findUniqueOrThrow({ where: { id: request.id } })).processNumber).toBeNull();

    await IndentPipedriveSyncService.setReference(request.id, `9999/${YY}`, actor());
    expect((await prisma.indentSequence.findUniqueOrThrow({ where: { year: YEAR } })).lastNumber).toBeGreaterThanOrEqual(9999);
  });

  testDbSkip('itens da nota: transacao que trava a linha e vira COTACAO faz a confirmacao concorrente esperar e receber 409 (trava de linha)', async () => {
    const deal = makeDeal(`9600/${YY} INDENT - CORRIDA DOS ITENS`);
    await IndentPipedriveSyncService.processDeal(deal, contextFor(makeClient([deal])));
    const request = await prisma.indentRequest.findFirstOrThrow({ where: { pipedriveDealId: deal.id }, include: { items: { orderBy: { position: 'asc' } } } });
    const payload = { items: request.items.map((item) => ({ id: item.id, description: `Item corrida ${runId}`, quantityKg: 10 })) };
    let concurrent: Promise<unknown> = Promise.resolve();
    let finishedWhileLocked = true;

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "IndentRequest" WHERE id = ${request.id} FOR NO KEY UPDATE`;
      await tx.indentRequest.update({ where: { id: request.id }, data: { status: 'COTACAO' } });
      concurrent = IndentRequestService.updateNoteItems(request.id, payload, actor()).then(
        () => 'ok',
        (error: unknown) => error,
      );
      // Sem a trava de linha, a leitura (status NOVA, ainda nao commitado) passaria e a confirmacao terminaria aqui.
      finishedWhileLocked = await Promise.race([concurrent.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1200))]);
    });

    expect(finishedWhileLocked).toBe(false);
    expect(await concurrent).toMatchObject({ status: 409, message: 'Os itens desta solicitação já foram cotados.' });
    expect(await prisma.indentRequestItem.count({ where: { requestId: request.id, confirmed: true } })).toBe(0);
  });

  testDbSkip('fila: dois link paralelos da MESMA pendencia para clientes diferentes = 1 ok + 1 409, um unico dono da organizacao', async () => {
    const orgG = org(900190, null, 'G');
    const deal = asDeal(`9610/${YY} INDENT - LINK PARALELO`, 900190);
    await IndentPipedriveSyncService.processDeal(deal, contextFor(makeClient([deal], [orgG])));
    const pending = await pendingOf(deal.id);
    const [a, b] = await Promise.all(
      ['A', 'B'].map((label) => prisma.indentClient.create({ data: { name: `Cliente Link Paralelo ${label} ${runId}` } })),
    );

    const results = await Promise.allSettled(
      [a, b].map((client) => IndentPendingOrgService.link(pending.id, { orgId: 900190, clientId: client.id }, actor())),
    );

    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((entry) => entry.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, message: 'Pendência já resolvida.' });
    expect(await prisma.indentClient.count({ where: { pipedriveOrgId: 900190 } })).toBe(1);
    const request = await prisma.indentRequest.findFirstOrThrow({ where: { pipedriveDealId: deal.id } });
    expect((await pendingOf(deal.id)).resolvedClientId).toBe(request.clientId);
  });

  testDbSkip('fila: link a cliente com OUTRO CNPJ devolve cnpjDivergente e grava so a marca (sem digitos) no historico', async () => {
    const orgH = org(900195, '12.345.678/0001-95', 'H');
    const deal = asDeal(`9620/${YY} INDENT - LINK DIVERGENTE`, 900195);
    await IndentPipedriveSyncService.processDeal(deal, contextFor(makeClient([deal], [orgH])));
    const pending = await pendingOf(deal.id);
    const other = await prisma.indentClient.create({ data: { name: `Cliente Outro CNPJ ${runId}`, cnpj: '98765432000198' } });

    const result = await IndentPendingOrgService.link(pending.id, { orgId: 900195, clientId: other.id }, actor());

    expect(result).toMatchObject({ cnpjDivergente: true, cnpjCompleted: false });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'indent_pending_org', entityId: String(pending.id), action: 'indent_pending_org.resolved_link' } });
    expect(log.metadata).toMatchObject({ cnpjDivergente: true });
    expect(JSON.stringify(log)).not.toMatch(/12345678000195|98765432000198/);
  });

  testDbSkip('so escreve em tabelas Indent* (e AuditLog sem usuario): o IQ principal fica intacto', async () => {
    const before = await Promise.all([prisma.supplier.count(), prisma.supplierContact.count(), prisma.quoteRequest.count(), prisma.catalogItem.count(), prisma.user.count()]);
    const deal = makeDeal(`8860/${YY} INDENT - ESCOPO`);
    await IndentPipedriveSyncService.processDeal(deal, contextFor(makeClient([deal])));
    const after = await Promise.all([prisma.supplier.count(), prisma.supplierContact.count(), prisma.quoteRequest.count(), prisma.catalogItem.count(), prisma.user.count()]);
    const request = await prisma.indentRequest.findFirstOrThrow({ where: { pipedriveDealId: deal.id } });

    expect(after).toEqual(before);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'indent_request', entityId: String(request.id), action: 'indent_request.pipedrive_created' } });
    expect(log.performedById).toBeNull();
    expect(log.metadata).toMatchObject({ source: 'pipedrive', dealId: deal.id });
    expect(JSON.stringify(log)).not.toContain('RESINA EXEMPLO');
  });
});
