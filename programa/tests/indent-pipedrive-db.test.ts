import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PipedriveEnv } from '../src/config/env';
import { normalizeNote, PipedriveNotFoundError, type PdDeal, type PipedriveClient } from '../src/lib/pipedriveClient';
import { prisma } from '../src/lib/prisma';
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

function makeClient(deals: PdDeal[]): PipedriveClient {
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
    getOrganization: vi.fn(async () => ({ id: 900101, name: `Cliente Exemplo ${runId}`, cnpjRaw: '11.222.333/0001-81', city: 'Santos, SP' })),
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
    await prisma.indentClient.deleteMany({ where: { id: iqClientId } });
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
