import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());

import type { PipedriveEnv } from '../src/config/env';
import {
  normalizeNote,
  PipedriveNotFoundError,
  type PdDeal,
  type PdOrganization,
  type PipedriveClient,
} from '../src/lib/pipedriveClient';
import { IndentPipedriveSyncService } from '../src/services/IndentPipedriveSyncService';
import { auditActions, fake, installFakeDb, resetFakeDb, resetIndentMocks } from './helpers/indentRoutesMock';

// Titulo, revisao (R<n>), numero/referencia e casamento de cliente da sincronizacao Pipedrive (PR 5a.2).
// Dados 100% ficticios; banco em memoria (helper) e cliente do Pipedrive falso.

const NOW = new Date('2026-11-16T15:00:00.000Z');
const LATER = new Date(NOW.getTime() + 600_000);
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

const ORG: PdOrganization = { id: 900101, name: 'Cliente Exemplo Ltda', cnpjRaw: '11.222.333/0001-81', city: 'Santos, SP' };
const OTHER_ORG: PdOrganization = { id: 900102, name: 'Outra Empresa Exemplo SA', cnpjRaw: '11.444.777/0001-61', city: 'Itajaí, SC' };

function makeDeal(title: string, overrides: Partial<PdDeal> = {}): PdDeal {
  return {
    id: 900001,
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

/** Mesmo negocio com outro titulo e `update_time` mais novo (uma edicao no Pipedrive). */
const edited = (deal: PdDeal, title: string, minutes = 60): PdDeal => ({
  ...deal,
  title,
  updateTime: new Date(deal.updateTime.getTime() + minutes * 60_000),
});

function makeClient(
  deals: PdDeal[],
  setup: { orgs?: Record<number, PdOrganization | undefined>; personOrgId?: number | null } = {},
) {
  const orgs = setup.orgs ?? { 900101: ORG, 900102: OTHER_ORG };
  const notes = (JSON.parse(readFileSync(join(__dirname, 'fixtures', 'pipedrive', 'notes-v1.json'), 'utf8')) as { data: unknown[] }).data.map(normalizeNote);
  const client = {
    getStage: vi.fn(async () => ({ id: 9020, name: 'Proposta Exemplo a Enviar', pipelineId: 9010 })),
    listPipelines: vi.fn(async () => [{ id: 9010, name: 'Funil Exemplo de Indent' }]),
    listDealsInStage: vi.fn(async () => ({ deals, truncated: false, skipped: 0 })),
    getDeal: vi.fn(async () => {
      throw new PipedriveNotFoundError(404);
    }),
    getOrganization: vi.fn(async (id: number) => {
      const org = orgs[id];
      if (!org) throw new PipedriveNotFoundError(404);
      return org;
    }),
    getPerson: vi.fn(async () => ({ id: 900201, orgId: setup.personOrgId ?? null })),
    getUser: vi.fn(async () => ({ id: 900301, name: 'Vendedora Exemplo' })),
    listDealNotes: vi.fn(async () => notes),
    listDealFields: vi.fn(async () => []),
    getRateLimitState: () => ({ dailyTokensRemaining: 2_000_000, dailyTokensLimit: 2_160_000 }),
  };
  return Object.assign(client as unknown as PipedriveClient, { spies: client });
}

function sweep(client: PipedriveClient, now = NOW) {
  return IndentPipedriveSyncService.runSweep({ source: 'SWEEP', budgetMs: 240_000, client, env: ENV, now });
}

/** Solicitacao ja existente (lancada a mao no IQ ou vinda de outro negocio). */
function seedRequest(number: string | null, overrides: Record<string, unknown> = {}) {
  const row = {
    id: 50,
    processNumber: number,
    processYear: number ? 2026 : null,
    processSeq: number ? Number(number.slice(0, 3)) : null,
    origin: 'IQ_INDENT',
    pipedriveDealId: null,
    dealTitle: null,
    ownerName: 'Compradora Exemplo',
    status: 'NOVA',
    clientId: 3,
    ...overrides,
  };
  fake.requests.push(row);
  fake.ids.request = 51;
  return row;
}

const eventsOf = (result: string) => fake.events.filter((event) => event.result === result);

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetIndentMocks();
  resetFakeDb();
  installFakeDb();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('revisao: o MESMO negocio e renomeado com "R<n> -"', () => {
  it('R2 alerta: renomear 274/26 para "R2 - 274/26" = 1 solicitacao, currentRevision 2, historico +1 e alerta de revisao', async () => {
    const deal = makeDeal('274/26 INDENT - CLIENTE EXEMPLO');
    await sweep(makeClient([deal]));
    const itemsBefore = JSON.stringify(fake.items);

    await sweep(makeClient([edited(deal, 'R2 - 274/26 INDENT - CLIENTE EXEMPLO')]), LATER);

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ processNumber: '274/26', status: 'NOVA', revisionAlertAt: LATER, referenceAlert: null });
    expect(fake.mirrors[0]).toMatchObject({ currentRevision: 2 });
    expect(fake.mirrors[0]?.revisionHistory).toEqual([
      { revision: 2, title: 'R2 - 274/26 INDENT - CLIENTE EXEMPLO', detectedAt: LATER.toISOString() },
    ]);
    expect(JSON.stringify(fake.items)).toBe(itemsBefore);
    expect(eventsOf('revision_detected')).toHaveLength(1);
    expect(auditActions()).toContain('indent_request.pipedrive_revision');
  });

  it('R2 -> R3 acrescenta ao historico; titulo igual nao duplica; R2 que some mantem a revisao atual', async () => {
    const deal = makeDeal('274/26 INDENT - CLIENTE EXEMPLO');
    await sweep(makeClient([deal]));
    const r2 = edited(deal, 'R2 - 274/26 INDENT - CLIENTE EXEMPLO', 60);
    await sweep(makeClient([r2]), LATER);
    const r3 = edited(r2, 'R3 - 274/26 INDENT - CLIENTE EXEMPLO', 60);
    await sweep(makeClient([r3]), new Date(LATER.getTime() + 600_000));

    expect(fake.mirrors[0]?.currentRevision).toBe(3);
    expect((fake.mirrors[0]?.revisionHistory as unknown[]).length).toBe(2);

    const same = edited(r3, 'R3 - 274/26 INDENT - CLIENTE EXEMPLO', 60); // so mudou o update_time
    await sweep(makeClient([same]), new Date(LATER.getTime() + 1_200_000));
    expect((fake.mirrors[0]?.revisionHistory as unknown[]).length).toBe(2);

    const gone = edited(same, '274/26 INDENT - CLIENTE EXEMPLO', 60);
    await sweep(makeClient([gone]), new Date(LATER.getTime() + 1_800_000));
    expect(fake.mirrors[0]).toMatchObject({ currentRevision: 3, parsedNumber: '274/26' });
    expect(fake.requests).toHaveLength(1);
    expect(eventsOf('revision_detected')).toHaveLength(2);
  });

  it('negocio desconhecido "R2 - 263/26" com solicitacao base existente: liga sem criar (revision_linked)', async () => {
    seedRequest('263/26');
    fake.items.push({ id: 90, requestId: 50, confirmed: true, source: 'MANUAL', position: 0, description: 'PRODUTO MANUAL EXEMPLO' });
    fake.ids.item = 91;
    const result = await sweep(makeClient([makeDeal('R2 - 263/26 INDENT CLIENTE EXEMPLO')]));

    expect(result).toMatchObject({ processed: 1, created: 0 });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ id: 50, pipedriveDealId: 900001, revisionAlertAt: NOW, ownerName: 'Compradora Exemplo' });
    expect(fake.mirrors[0]).toMatchObject({ requestId: 50, currentRevision: 2 });
    expect(fake.items.map((item) => item.description)).toEqual(['PRODUTO MANUAL EXEMPLO']); // item confirmado nao e trocado
    expect(eventsOf('revision_linked')).toHaveLength(1);
    expect(auditActions()).toContain('indent_request.pipedrive_revision_linked');
  });

  it('negocio desconhecido "R2 - 263/26" SEM base: cria em "Referencia pendente" com o alerta de revisao sem base', async () => {
    await sweep(makeClient([makeDeal('R2 - 263/26 INDENT CLIENTE EXEMPLO')]));

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      processNumber: null,
      processYear: null,
      processSeq: null,
      origin: 'PIPEDRIVE',
      referenceAlert: 'Revisão R2 sem solicitação base no IQ Indent (título: 263/26).',
      revisionAlertAt: NOW,
    });
    expect(fake.mirrors[0]).toMatchObject({ currentRevision: 2 });
    expect(fake.sequence.has(2026)).toBe(false);
  });

  it('"R2 - 263/26 e 270/26" (dois numeros) mantem o alerta de multiple_numbers, nao o de "sem numero"', async () => {
    await sweep(makeClient([makeDeal('R2 - 263/26 e 270/26 INDENT CLIENTE EXEMPLO')]));

    expect(fake.requests[0]).toMatchObject({
      processNumber: null,
      referenceAlert: 'O título do negócio tem mais de um número NNN/AA.',
    });
  });

  it('"R2 - INDENT CLIENTE" sem numero: referencia pendente com alerta "sem numero no titulo"', async () => {
    await sweep(makeClient([makeDeal('R2 - INDENT CLIENTE EXEMPLO')]));
    expect(fake.requests[0]).toMatchObject({
      processNumber: null,
      referenceAlert: 'Revisão R2 sem solicitação base no IQ Indent (sem número no título).',
    });
  });
});

describe('numero e referencia', () => {
  it('numero duplicado alerta: igual ao de solicitacao lancada a mao vira "Referencia pendente" e NAO liga sozinho', async () => {
    seedRequest('274/26');
    const result = await sweep(makeClient([makeDeal('274/26 INDENT - CLIENTE EXEMPLO')]));

    expect(result).toMatchObject({ created: 1 });
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]).toMatchObject({
      processNumber: null,
      pipedriveDealId: 900001,
      referenceAlert: 'O número 274/26 já pertence à solicitação 274/26.',
    });
    expect(fake.requests[0]).toMatchObject({ pipedriveDealId: null, ownerName: 'Compradora Exemplo' });
    expect(eventsOf('duplicate_number')).toHaveLength(1);
    expect(fake.sequence.get(2026)).toBe(274);
  });

  it('numero duplicado alerta: tambem quando a existente veio de outro negocio do Pipedrive', async () => {
    const first = makeDeal('274/26 INDENT - A', { id: 900001 });
    const second = makeDeal('274/26 INDENT - B', { id: 900002 });
    await sweep(makeClient([first, second]));

    expect(fake.requests.map((row) => row.processNumber)).toEqual(['274/26', null]);
    expect(fake.requests[1]?.referenceAlert).toBe('O número 274/26 já pertence à solicitação 274/26.');
  });

  it('sem numero (ou so uma data): "Referencia pendente"; varias sem numero convivem (NULL nao colide)', async () => {
    await sweep(
      makeClient([
        makeDeal('INDENT - CLIENTE EXEMPLO', { id: 900001 }),
        makeDeal('INDENT 12/11/26 - OUTRO', { id: 900002 }),
      ]),
    );

    expect(fake.requests.map((row) => [row.processNumber, row.referenceAlert])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('dois numeros no titulo ou ano fora da faixa: pendente com alerta', async () => {
    await sweep(
      makeClient([
        makeDeal('274/26 e 275/26 INDENT', { id: 900001 }),
        makeDeal('274/19 INDENT', { id: 900002 }),
      ]),
    );

    expect(fake.requests[0]?.referenceAlert).toBe('O título do negócio tem mais de um número NNN/AA.');
    expect(fake.requests[1]?.referenceAlert).toBe('O ano do número no título do negócio está fora do esperado.');
    expect(fake.requests.every((row) => row.processNumber === null)).toBe(true);
  });

  it('pendente que ganha numero LIVRE no titulo: grava a referencia (reference_filled) e sobe a sequencia', async () => {
    const deal = makeDeal('INDENT - CLIENTE EXEMPLO');
    await sweep(makeClient([deal]));
    await sweep(makeClient([edited(deal, '280/26 INDENT - CLIENTE EXEMPLO')]), LATER);

    expect(fake.requests[0]).toMatchObject({ processNumber: '280/26', processYear: 2026, processSeq: 280, referenceAlert: null });
    expect(fake.sequence.get(2026)).toBe(280);
    expect(eventsOf('reference_filled')).toHaveLength(1);
    expect(auditActions()).toContain('indent_request.pipedrive_updated');
  });

  it('pendente que ganha numero USADO: continua pendente com alerta', async () => {
    seedRequest('281/26');
    const deal = makeDeal('INDENT - CLIENTE EXEMPLO');
    await sweep(makeClient([deal]));
    await sweep(makeClient([edited(deal, '281/26 INDENT - CLIENTE EXEMPLO')]), LATER);

    expect(fake.requests[1]).toMatchObject({
      processNumber: null,
      referenceAlert: 'O número 281/26 já pertence à solicitação 281/26.',
    });
    expect(eventsOf('duplicate_number')).toHaveLength(1);
  });

  it('conhecido cujo titulo aponta para OUTRO numero: mantem o numero e alerta; volta a bater e o alerta some', async () => {
    const deal = makeDeal('274/26 INDENT - CLIENTE EXEMPLO');
    await sweep(makeClient([deal]));
    const other = edited(deal, '275/26 INDENT - CLIENTE EXEMPLO');
    await sweep(makeClient([other]), LATER);

    expect(fake.requests[0]).toMatchObject({
      processNumber: '274/26',
      referenceAlert: 'O título do negócio aponta para 275/26, diferente da solicitação 274/26.',
    });
    expect(fake.requests).toHaveLength(1);

    await sweep(makeClient([edited(other, '274/26 INDENT - CLIENTE EXEMPLO')]), new Date(LATER.getTime() + 600_000));
    expect(fake.requests[0]?.referenceAlert).toBeNull();
  });

  it('sequencia: numero do Pipedrive maior que lastNumber sobe; menor nao desce', async () => {
    fake.sequence.set(2026, 276);
    await sweep(makeClient([makeDeal('300/26 INDENT - A', { id: 900001 })]));
    expect(fake.sequence.get(2026)).toBe(300);

    await sweep(makeClient([makeDeal('100/26 INDENT - B', { id: 900002 })]), LATER);
    expect(fake.sequence.get(2026)).toBe(300);
    expect(fake.requests.map((row) => row.processNumber)).toEqual(['300/26', '100/26']);
  });
});

describe('cliente: organizacao do negocio e da pessoa de contato (nunca por nome)', () => {
  const pendingCandidates = () => fake.pendings.map((row) => row.candidates);

  it('casa pelo pipedriveOrgId, inclusive cliente SEM CNPJ', async () => {
    fake.clients.push({ id: 3, name: 'Qualquer Nome', cnpj: null, pipedriveOrgId: 900101, isActive: true });
    await sweep(makeClient([makeDeal('274/26 INDENT - A')]));

    expect(fake.requests[0]).toMatchObject({ clientId: 3 });
    expect(fake.pendings).toHaveLength(0);
  });

  it('casa pelo CNPJ da organizacao (com mascara) e grava o pipedriveOrgId do cliente', async () => {
    fake.clients.push({ id: 3, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', pipedriveOrgId: null, isActive: true });
    await sweep(makeClient([makeDeal('274/26 INDENT - A')]));

    expect(fake.requests[0]).toMatchObject({ clientId: 3 });
    expect(fake.clients[0]).toMatchObject({ pipedriveOrgId: 900101 });
    expect(auditActions()).toContain('indent_client.pipedrive_org_linked');
  });

  it('cliente casado por CNPJ que ja tem OUTRA organizacao: liga, nao sobrescreve e avisa so com ids', async () => {
    fake.clients.push({ id: 3, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', pipedriveOrgId: 900999, isActive: true });
    await sweep(makeClient([makeDeal('274/26 INDENT - A')]));

    expect(fake.requests[0]).toMatchObject({ clientId: 3 });
    expect(fake.clients[0]).toMatchObject({ pipedriveOrgId: 900999 });
    const line = JSON.parse(String(warnSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ clientId: 3, orgId: 900101, dealId: 900001 });
    expect(Object.keys(line).sort()).toEqual(['clientId', 'dealId', 'level', 'msg', 'orgId', 'time']);
    expect(JSON.stringify(line)).not.toContain('11222333000181');
  });

  it('cliente INATIVO com o pipedriveOrgId da organizacao NAO casa: vai para a fila de vinculo', async () => {
    fake.clients.push({ id: 3, name: 'Qualquer Nome', cnpj: null, pipedriveOrgId: 900101, isActive: false });
    await sweep(makeClient([makeDeal('274/26 INDENT - A')]));

    expect(fake.requests[0]).toMatchObject({ clientId: null });
    expect(fake.pendings).toHaveLength(1);
  });

  it('cliente inativo nao casa: vai para a fila de vinculo', async () => {
    fake.clients.push({ id: 3, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', pipedriveOrgId: null, isActive: false });
    await sweep(makeClient([makeDeal('274/26 INDENT - A')]));

    expect(fake.requests[0]).toMatchObject({ clientId: null });
    expect(fake.pendings).toHaveLength(1);
  });

  it('cliente sem CNPJ e com o MESMO nome da organizacao NAO casa por nome: pendencia com os dados da organizacao', async () => {
    fake.clients.push({ id: 3, name: 'Cliente Exemplo Ltda', cnpj: null, pipedriveOrgId: null, isActive: true });
    await sweep(makeClient([makeDeal('274/26 INDENT - A')]));

    expect(fake.requests[0]).toMatchObject({ clientId: null });
    expect(pendingCandidates()).toEqual([[{ orgId: 900101, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', city: 'Santos, SP' }]]);
    expect(fake.pendings[0]).toMatchObject({ requestId: 1, dealId: 900001, status: 'OPEN' });
  });

  it('organizacao sem CNPJ ou com CNPJ invalido: pendencia com cnpj nulo', async () => {
    const noCnpj = { ...ORG, cnpjRaw: null };
    const invalid = { ...OTHER_ORG, cnpjRaw: '11.222.333/0001-82' };
    await sweep(
      makeClient([makeDeal('274/26 INDENT - A', { id: 900001 }), makeDeal('275/26 INDENT - B', { id: 900002, orgId: 900102 })], {
        orgs: { 900101: noCnpj, 900102: invalid },
      }),
    );

    expect(pendingCandidates()).toEqual([
      [{ orgId: 900101, name: 'Cliente Exemplo Ltda', cnpj: null, city: 'Santos, SP' }],
      [{ orgId: 900102, name: 'Outra Empresa Exemplo SA', cnpj: null, city: 'Itajaí, SC' }],
    ]);
  });

  it('negocio sem organizacao: pendencia sem candidatas (so "vincular" sem orgId)', async () => {
    await sweep(makeClient([makeDeal('274/26 INDENT - A', { orgId: null })]));

    expect(fake.requests[0]).toMatchObject({ clientId: null });
    expect(pendingCandidates()).toEqual([[]]);
  });

  it('pessoa de contato de OUTRA organizacao: 2 candidatas e quem decide e a fila (mesmo que a do negocio case)', async () => {
    fake.clients.push({ id: 3, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', pipedriveOrgId: null, isActive: true });
    await sweep(makeClient([makeDeal('274/26 INDENT - A', { personId: 900201 })], { personOrgId: 900102 }));

    expect(fake.requests[0]).toMatchObject({ clientId: null });
    expect(pendingCandidates()[0]).toEqual([
      expect.objectContaining({ orgId: 900101 }),
      expect.objectContaining({ orgId: 900102 }),
    ]);
    expect(fake.clients[0]?.pipedriveOrgId).toBeNull();
  });

  it('pessoa da MESMA organizacao nao cria 2a candidata', async () => {
    fake.clients.push({ id: 3, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', pipedriveOrgId: null, isActive: true });
    await sweep(makeClient([makeDeal('274/26 INDENT - A', { personId: 900201 })], { personOrgId: 900101 }));
    expect(fake.requests[0]).toMatchObject({ clientId: 3 });
  });

  it('solicitacao ja vinculada nunca troca de cliente e a organizacao nem e relida', async () => {
    fake.clients.push({ id: 3, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', pipedriveOrgId: null, isActive: true });
    const deal = makeDeal('274/26 INDENT - A');
    const first = makeClient([deal]);
    await sweep(first);
    fake.clients.push({ id: 4, name: 'Outro Cliente Exemplo', cnpj: '11444777000161', pipedriveOrgId: 900101, isActive: true });

    const second = makeClient([edited(deal, '274/26 INDENT - A RENOMEADO')]);
    await sweep(second, LATER);

    expect(fake.requests[0]).toMatchObject({ clientId: 3, dealTitle: '274/26 INDENT - A RENOMEADO' });
    expect(second.spies.getOrganization).not.toHaveBeenCalled();
  });

  it('pendente e reprocessado: continua com UMA pendencia aberta so', async () => {
    const deal = makeDeal('274/26 INDENT - A');
    await sweep(makeClient([deal]));
    await sweep(makeClient([edited(deal, '274/26 INDENT - A BIS')]), LATER);

    expect(fake.pendings.filter((row) => row.status === 'OPEN')).toHaveLength(1);
    expect(fake.requests).toHaveLength(1);
  });
});
