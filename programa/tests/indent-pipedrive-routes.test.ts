import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    configured: true,
    configErrors: [] as string[],
    apiToken: 'token-ficticio-do-teste' as string | undefined,
    domain: 'exemplo' as string | undefined,
    pipelineId: 9010 as number | undefined,
    stageId: 9020 as number | undefined,
    stageName: 'Proposta Exemplo a Enviar' as string | undefined,
    orgCnpjFieldKey: '0123456789abcdef0123456789abcdef01234567' as string | undefined,
    dealTypeFieldKey: undefined as string | undefined,
    comexUserId: 900302 as number | undefined,
    syncSince: undefined as string | undefined,
  },
}));

vi.mock('../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env')>();
  return { ...actual, pipedriveEnv: mocks.env };
});
vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste

import {
  PipedriveAuthError,
  PipedriveNotFoundError,
  setPipedriveClientForTests,
  type PipedriveClient,
} from '../src/lib/pipedriveClient';
import { IndentPipedriveSyncService } from '../src/services/IndentPipedriveSyncService';
import { indentRoutes } from '../src/routes/IndentRoutes';
import {
  auditActions,
  auditCall,
  call,
  expectNoRequestWrites,
  getApp,
  loginAs,
  listRow,
  now,
  prismaMock,
  requestRow,
  resetRequestMocks,
  tx,
  uniqueError,
} from './helpers/indentRoutesMock';

// Rotas da integracao Pipedrive do IQ Indent (PR 5a.2): papeis, estado, opcoes, configuracao, sincronizacao e guarda de referencia.

const SUMMARY = { processed: 3, created: 1, errors: 0, skipped: 0, missed: 0, stoppedBy: null, durationMs: 120 };
const CONFIG = {
  id: 1,
  pipelineId: 9010,
  pipelineName: 'Funil Exemplo de Indent',
  stageId: 9020,
  stageName: 'Proposta Exemplo a Enviar',
  slaBusinessDays: 2,
  connectionStatus: 'ok',
  connectionCheckedAt: now,
  lastSyncAt: now,
  lastSyncNewDeals: 2,
  lastSyncErrors: 0,
  dailyTokensRemaining: 2_100_000,
  dailyTokensLimit: 2_160_000,
};

function fakeClient(overrides: Partial<Record<keyof PipedriveClient, unknown>> = {}) {
  const client = {
    getStage: vi.fn(async () => ({ id: 9020, name: 'Proposta Exemplo a Enviar', pipelineId: 9010 })),
    listPipelines: vi.fn(async () => [
      { id: 9010, name: 'Funil Exemplo de Indent' },
      { id: 9011, name: 'Outro Funil Exemplo' },
    ]),
    listStages: vi.fn(async () => [{ id: 9020, name: 'Proposta Exemplo a Enviar', pipelineId: 9010 }]),
    ...overrides,
  };
  setPipedriveClientForTests(client as unknown as PipedriveClient);
  return client;
}

// Todas as rotas novas da integracao/solicitacao do Pipedrive, derivadas do router (rota nova nao escapa da tabela).
const NEW_ROUTE_PATTERN = /pipedrive|pending-orgs|reference|note-items/;
const NEW_ROUTES = (indentRoutes.stack as Array<{ route?: { path: string; methods: Record<string, boolean> } }>)
  .filter((layer) => layer.route && NEW_ROUTE_PATTERN.test(layer.route.path))
  .flatMap((layer) =>
    Object.keys(layer.route!.methods).map((method) => ({
      method: method as 'get' | 'post' | 'put',
      path: layer.route!.path.replace(':id', '11'),
    })),
  );

beforeEach(() => {
  resetRequestMocks();
  setPipedriveClientForTests(null);
  Object.assign(mocks.env, {
    configured: true,
    apiToken: 'token-ficticio-do-teste',
    domain: 'exemplo',
    pipelineId: 9010,
    stageId: 9020,
    stageName: 'Proposta Exemplo a Enviar',
  });
  prismaMock.indentIntegrationConfig.findUnique.mockResolvedValue(CONFIG);
  prismaMock.indentIntegrationConfig.upsert.mockResolvedValue(CONFIG);
  prismaMock.indentIntegrationConfig.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.indentPendingOrg.count.mockResolvedValue(2);
  tx.indentIntegrationConfig.findUnique.mockResolvedValue(CONFIG);
  tx.indentIntegrationConfig.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...CONFIG, ...data }));
});

describe('rotas novas: papeis', () => {
  it('a tabela cobre as 4 rotas de /pipedrive e nenhuma rota DELETE existe no router do Indent', () => {
    expect(NEW_ROUTES.filter((route) => route.path.startsWith('/pipedrive/'))).toHaveLength(4);
    const methods = (indentRoutes.stack as Array<{ route?: { methods: Record<string, boolean> } }>).flatMap((layer) =>
      layer.route ? Object.keys(layer.route.methods) : [],
    );
    expect(methods).not.toContain('delete');
  });

  it('sem login retorna 401 em todas as rotas novas', async () => {
    const app = await getApp();

    for (const route of NEW_ROUTES) {
      const req = request(app)[route.method](`/api/v1/indent${route.path}`);
      const res = route.method === 'get' ? await req : await req.send({});
      expect(res.status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  describe('comercial', () => {
    it.each(NEW_ROUTES)('comercial: $method $path -> 403', async ({ method, path }) => {
      const runSweep = vi.spyOn(IndentPipedriveSyncService, 'runSweep');
      const cookie = await loginAs('comercial');
      const res = await call(method, path, cookie, { pipelineId: 9010, stageId: 9020 });

      expect(res.status).toBe(403);
      expect(runSweep).not.toHaveBeenCalled();
      expectNoRequestWrites();
      expect(tx.indentIntegrationConfig.update).not.toHaveBeenCalled();
      runSweep.mockRestore();
    });
  });

  it('viewer le o estado (200) e recebe 403 em opcoes, configuracao e sincronizacao', async () => {
    const cookie = await loginAs('viewer');

    expect((await call('get', '/pipedrive/status', cookie)).status).toBe(200);
    expect((await call('get', '/pipedrive/options', cookie)).status).toBe(403);
    expect((await call('put', '/pipedrive/config', cookie, { pipelineId: 9010, stageId: 9020 })).status).toBe(403);
    expect((await call('post', '/pipedrive/sync', cookie)).status).toBe(403);
  });

  it.each(['comprador', 'gestor'])('%s sincroniza (200) mas nao ve opcoes nem altera a configuracao (403)', async (role) => {
    const runSweep = vi.spyOn(IndentPipedriveSyncService, 'runSweep').mockResolvedValue({ outcome: 'run_ok', ...SUMMARY });
    const cookie = await loginAs(role);

    expect((await call('post', '/pipedrive/sync', cookie)).status).toBe(200);
    expect((await call('get', '/pipedrive/options', cookie)).status).toBe(403);
    expect((await call('put', '/pipedrive/config', cookie, { pipelineId: 9010, stageId: 9020 })).status).toBe(403);
    expect(runSweep).toHaveBeenCalledTimes(1);
    runSweep.mockRestore();
  });
});

describe('GET /pipedrive/status', () => {
  it('devolve o estado gravado SEM chamar o Pipedrive e sem token', async () => {
    const client = fakeClient();
    const cookie = await loginAs('viewer');
    const res = await call('get', '/pipedrive/status', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      connection: 'ok',
      mode: 'polling',
      webhook: 'not_configured',
      pipelineName: 'Funil Exemplo de Indent',
      stageName: 'Proposta Exemplo a Enviar',
      slaBusinessDays: 2,
      pendingCount: 2,
      lastSyncNewDeals: 2,
      lastSyncErrors: 0,
      dailyTokensRemaining: 2_100_000,
      dailyTokensLimit: 2_160_000,
      intervalMinutes: 10,
    });
    expect(Object.values(client).every((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('token-ficticio');
  });

  it('env nao configurada: connection not_configured', async () => {
    mocks.env.configured = false;
    const res = await call('get', '/pipedrive/status', await loginAs('admin'));

    expect(res.body).toMatchObject({ configured: false, connection: 'not_configured' });
  });

  it('estados gravados pela varredura aparecem como estao (auth_failed, config_mismatch)', async () => {
    prismaMock.indentIntegrationConfig.findUnique.mockResolvedValue({ ...CONFIG, connectionStatus: 'auth_failed' });
    expect((await call('get', '/pipedrive/status', await loginAs('admin'))).body.connection).toBe('auth_failed');
    prismaMock.indentIntegrationConfig.findUnique.mockResolvedValue({ ...CONFIG, connectionStatus: 'config_mismatch' });
    expect((await call('get', '/pipedrive/status', await loginAs('admin'))).body.connection).toBe('config_mismatch');
  });

  it('1a leitura concorrente: o P2002 do upsert nao vira erro, a linha criada pela outra requisicao e relida', async () => {
    prismaMock.indentIntegrationConfig.findUnique.mockResolvedValue(null);
    prismaMock.indentIntegrationConfig.upsert.mockRejectedValue(uniqueError(['id']));
    prismaMock.indentIntegrationConfig.findUniqueOrThrow.mockResolvedValue(CONFIG);
    const res = await call('get', '/pipedrive/status', await loginAs('admin'));

    expect(res.status).toBe(200);
    expect(res.body.connection).toBe('ok');
    expect(prismaMock.indentIntegrationConfig.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('linha semeada ANTES do env: campos ainda vazios sao completados a partir do env valido e o conectado volta a ok', async () => {
    const empty = { ...CONFIG, pipelineId: null, pipelineName: null, stageId: null, stageName: null, connectionStatus: 'not_configured' };
    prismaMock.indentIntegrationConfig.findUnique.mockResolvedValue(empty);
    prismaMock.indentIntegrationConfig.update.mockResolvedValue({ ...empty, pipelineId: 9010, stageId: 9020, stageName: 'Proposta Exemplo a Enviar', connectionStatus: 'ok' });
    const res = await call('get', '/pipedrive/status', await loginAs('admin'));

    expect(prismaMock.indentIntegrationConfig.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { pipelineId: 9010, stageId: 9020, stageName: 'Proposta Exemplo a Enviar', connectionStatus: 'ok' },
    });
    expect(res.body).toMatchObject({ configured: true, connection: 'ok', pipelineId: 9010, stageId: 9020 });
  });

  it('o que ja esta no banco (salvo pelo admin) NUNCA e sobrescrito pelo env', async () => {
    prismaMock.indentIntegrationConfig.findUnique.mockResolvedValue({ ...CONFIG, pipelineId: 9011, stageId: 9030, stageName: 'Outra Coluna Exemplo' });
    const res = await call('get', '/pipedrive/status', await loginAs('admin'));

    expect(prismaMock.indentIntegrationConfig.update).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ pipelineId: 9011, stageId: 9030, stageName: 'Outra Coluna Exemplo' });
  });

  it('env invalido (configured=false) nao semeia nada', async () => {
    mocks.env.configured = false;
    prismaMock.indentIntegrationConfig.findUnique.mockResolvedValue({ ...CONFIG, pipelineId: null, stageId: null, stageName: null });
    await call('get', '/pipedrive/status', await loginAs('admin'));

    expect(prismaMock.indentIntegrationConfig.update).not.toHaveBeenCalled();
  });

  it('cria a linha de configuracao na 1a leitura com os valores do env', async () => {
    prismaMock.indentIntegrationConfig.findUnique.mockResolvedValue(null);
    await call('get', '/pipedrive/status', await loginAs('admin'));

    expect(prismaMock.indentIntegrationConfig.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: {},
      create: { id: 1, pipelineId: 9010, stageId: 9020, stageName: 'Proposta Exemplo a Enviar', connectionStatus: 'ok' },
    });
  });
});

describe('GET /pipedrive/options', () => {
  it('admin recebe funis, colunas do funil configurado e as opcoes de prazo', async () => {
    const client = fakeClient();
    const res = await call('get', '/pipedrive/options', await loginAs('admin'));

    expect(res.status).toBe(200);
    expect(res.body.pipelines).toHaveLength(2);
    expect(res.body.stages).toEqual([{ id: 9020, name: 'Proposta Exemplo a Enviar', pipelineId: 9010 }]);
    expect(res.body.slaOptions).toEqual([1, 2, 3]);
    expect(client.listStages).toHaveBeenCalledWith(9010);
  });

  it('?pipelineId= escolhe as colunas de outro funil; valor invalido -> 400', async () => {
    const client = fakeClient();
    const cookie = await loginAs('admin');

    await call('get', '/pipedrive/options?pipelineId=9011', cookie);
    expect(client.listStages).toHaveBeenCalledWith(9011);
    expect((await call('get', '/pipedrive/options?pipelineId=abc', cookie)).status).toBe(400);
  });

  it('nao configurado -> 409; token recusado -> 502 e estado auth_failed', async () => {
    const cookie = await loginAs('admin');
    mocks.env.configured = false;
    expect((await call('get', '/pipedrive/options', cookie)).status).toBe(409);

    mocks.env.configured = true;
    fakeClient({ listPipelines: vi.fn(async () => { throw new PipedriveAuthError(401); }) });
    const res = await call('get', '/pipedrive/options', cookie);
    expect(res.status).toBe(502);
    expect(res.body.message).toContain('Falha de autenticação no Pipedrive');
    expect(prismaMock.indentIntegrationConfig.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ connectionStatus: 'auth_failed' }) }),
    );
  });
});

describe('PUT /pipedrive/config', () => {
  const VALID = { pipelineId: 9010, stageId: 9020, slaBusinessDays: 3 };

  it('admin salva funil, coluna e prazo; os nomes vem do Pipedrive e a auditoria nao leva token', async () => {
    fakeClient();
    const res = await call('put', '/pipedrive/config', await loginAs('admin'), VALID);

    expect(res.status).toBe(200);
    expect(tx.indentIntegrationConfig.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        pipelineId: 9010,
        pipelineName: 'Funil Exemplo de Indent',
        stageId: 9020,
        stageName: 'Proposta Exemplo a Enviar',
        slaBusinessDays: 3,
        connectionStatus: 'ok',
        updatedById: 7,
      }),
    });
    expect(auditActions()).toEqual(['indent_integration_config.updated']);
    expect(auditCall('indent_integration_config.updated')).toMatchObject({
      performedById: 7,
      beforeData: { pipelineId: 9010, stageId: 9020, slaBusinessDays: 2 },
      afterData: { pipelineId: 9010, stageId: 9020, slaBusinessDays: 3 },
    });
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain('token-ficticio');
  });

  it('prazo e opcional: sem ele o prazo gravado nao muda', async () => {
    fakeClient();
    await call('put', '/pipedrive/config', await loginAs('admin'), { pipelineId: 9010, stageId: 9020 });
    const data = tx.indentIntegrationConfig.update.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect('slaBusinessDays' in data).toBe(false);
  });

  it.each([
    ['sem coluna', { pipelineId: 9010 }],
    ['sem funil', { stageId: 9020 }],
    ['prazo 4', { pipelineId: 9010, stageId: 9020, slaBusinessDays: 4 }],
    ['prazo 0', { pipelineId: 9010, stageId: 9020, slaBusinessDays: 0 }],
    ['prazo fracionado', { pipelineId: 9010, stageId: 9020, slaBusinessDays: 1.5 }],
    ['id em texto', { pipelineId: '9010', stageId: 9020 }],
    ['campo extra (nome vem do Pipedrive)', { pipelineId: 9010, stageId: 9020, stageName: 'Qualquer' }],
    ['campo extra (chave de campo so no env)', { pipelineId: 9010, stageId: 9020, orgCnpjFieldKey: 'x' }],
  ])('validacao no backend: %s -> 400 e nada gravado', async (_name, body) => {
    fakeClient();
    const res = await call('put', '/pipedrive/config', await loginAs('admin'), body);

    expect(res.status).toBe(400);
    expect(tx.indentIntegrationConfig.update).not.toHaveBeenCalled();
  });

  it('coluna de outro funil -> 400; funil inexistente -> 400; coluna inexistente -> 400', async () => {
    const cookie = await loginAs('admin');
    fakeClient({ getStage: vi.fn(async () => ({ id: 9020, name: 'X', pipelineId: 9011 })) });
    expect((await call('put', '/pipedrive/config', cookie, VALID)).status).toBe(400);

    fakeClient({ listPipelines: vi.fn(async () => [{ id: 1, name: 'Outro' }]) });
    expect((await call('put', '/pipedrive/config', cookie, VALID)).status).toBe(400);

    fakeClient({ getStage: vi.fn(async () => { throw new PipedriveNotFoundError(404); }) });
    expect((await call('put', '/pipedrive/config', cookie, VALID)).status).toBe(400);
    expect(tx.indentIntegrationConfig.update).not.toHaveBeenCalled();
  });

  it('nao configurado -> 409', async () => {
    mocks.env.configured = false;
    expect((await call('put', '/pipedrive/config', await loginAs('admin'), VALID)).status).toBe(409);
  });
});

describe('POST /pipedrive/sync', () => {
  const run = (outcome: string) =>
    vi.spyOn(IndentPipedriveSyncService, 'runSweep').mockResolvedValue({ outcome, ...SUMMARY } as never);

  it('sincroniza com origem MANUAL e orcamento de 50 s; devolve o resumo', async () => {
    const spy = run('run_ok');
    const res = await call('post', '/pipedrive/sync', await loginAs('comprador'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'run_ok', processed: 3, created: 1, errors: 0, missed: 0, durationMs: 120 });
    expect(spy).toHaveBeenCalledWith({ source: 'MANUAL', budgetMs: 50_000 });
    spy.mockRestore();
  });

  it.each([
    ['not_configured', 409, 'Integração com o Pipedrive não configurada.'],
    ['in_progress', 409, 'Sincronização em andamento. Tente de novo em instantes.'],
    ['rate_limited', 429, 'Limite de chamadas do Pipedrive atingido. Tente de novo em alguns minutos.'],
    ['budget_low', 429, 'O orçamento diário de chamadas do Pipedrive está quase no fim. Tente de novo amanhã.'],
    ['config_mismatch', 409, 'Funil ou coluna não conferem com o Pipedrive. Revise a configuração da integração.'],
    ['auth_failed', 502, 'Falha de autenticação no Pipedrive. O token pode ter sido trocado ou revogado. Avise o administrador.'],
    ['error', 502, 'O Pipedrive não respondeu como esperado. Tente de novo em alguns minutos.'],
  ])('%s -> %i', async (outcome, status, message) => {
    const spy = run(outcome);
    const res = await call('post', '/pipedrive/sync', await loginAs('gestor'));

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ message, outcome });
    spy.mockRestore();
  });

  it('sem configuracao no env o botao recebe 409 (nenhuma chamada ao Pipedrive)', async () => {
    mocks.env.configured = false;
    const client = fakeClient();
    const res = await call('post', '/pipedrive/sync', await loginAs('admin'));

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Integração com o Pipedrive não configurada.');
    expect(client.getStage).not.toHaveBeenCalled();
  });

  it('erro inesperado vira 500 sem vazar detalhes', async () => {
    const spy = vi.spyOn(IndentPipedriveSyncService, 'runSweep').mockRejectedValue(new Error('segredo-interno'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call('post', '/pipedrive/sync', await loginAs('admin'));

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('segredo-interno');
    spy.mockRestore();
  });
});

describe('Referencia pendente (processNumber nulo)', () => {
  const pending = (overrides: Record<string, unknown> = {}) => requestRow({ processNumber: null, processYear: null, processSeq: null, ...overrides });

  it('gerar cotacoes: 409 "Digite a referencia" e nada e gravado', async () => {
    tx.indentRequest.findUnique.mockResolvedValue(pending());
    const res = await call('post', '/requests/11/quotes', await loginAs('comprador'), { suppliers: [{ supplierId: 5 }] });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Digite a referência da solicitação antes de gerar cotações.');
    expect(tx.indentQuote.create).not.toHaveBeenCalled();
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
  });

  it('opcoes de fornecedor: 409 com a mesma mensagem', async () => {
    prismaMock.indentRequest.findUnique.mockResolvedValue(pending());
    const res = await call('get', '/requests/11/supplier-options', await loginAs('comprador'));

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Digite a referência da solicitação antes de gerar cotações.');
  });

  it('cliente pendente continua tendo prioridade na mensagem', async () => {
    tx.indentRequest.findUnique.mockResolvedValue(pending({ clientId: null, client: null }));
    const res = await call('post', '/requests/11/quotes', await loginAs('comprador'), { suppliers: [{ supplierId: 5 }] });

    expect(res.body.message).toBe('Vincule o cliente antes de gerar cotações.');
  });
});

describe('solicitacoes: campos novos do Pipedrive', () => {
  it('GET /requests/:id devolve revisao, alertas, nota, pendencia de vinculo e a origem dos itens', async () => {
    prismaMock.indentRequest.findUnique.mockResolvedValue(
      requestRow({
        origin: 'PIPEDRIVE',
        processNumber: null,
        clientId: null,
        client: null,
        referenceAlert: 'Revisão R2 sem solicitação base no IQ Indent (sem número no título).',
        revisionAlertAt: now,
        noteChangedAt: now,
        noteIncoterm: 'CFR',
        noteDestination: 'Santos',
        noteSupplierHint: 'Fabricante Exemplo',
        pipedriveDeals: [{ currentRevision: 2 }],
        pendingOrgs: [{ id: 4, candidates: [{ orgId: 900101, name: 'Cliente Exemplo Ltda', cnpj: null, city: null }] }],
        items: [{ id: 21, requestId: 11, position: 0, description: 'RESINA EXEMPLO', productId: null, quantityKg: '0', confirmed: false, source: 'NOTE', noteLine: 3, product: null }],
      }),
    );
    prismaMock.indentIntegrationConfig.findUnique.mockResolvedValue({ ...CONFIG, slaBusinessDays: 3 });
    const res = await call('get', '/requests/11', await loginAs('viewer'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      processNumber: null,
      slaBusinessDays: 3,
      currentRevision: 2,
      referenceAlert: 'Revisão R2 sem solicitação base no IQ Indent (sem número no título).',
      noteIncoterm: 'CFR',
      noteDestination: 'Santos',
      noteSupplierHint: 'Fabricante Exemplo',
      pendingOrg: { id: 4, candidates: [{ orgId: 900101, name: 'Cliente Exemplo Ltda', cnpj: null, city: null }] },
      quotes: [],
    });
    expect(res.body.items[0]).toMatchObject({ source: 'NOTE', noteLine: 3, quantityKg: 0, confirmed: false });
  });

  it('detalhe sem dados do Pipedrive: campos nulos e prazo padrao 2', async () => {
    prismaMock.indentIntegrationConfig.findUnique.mockResolvedValue(null);
    const res = await call('get', '/requests/11', await loginAs('viewer'));

    expect(res.body).toMatchObject({ slaBusinessDays: 2, currentRevision: null, pendingOrg: null, referenceAlert: null });
  });

  it('GET /requests marca referencePending e devolve o prazo interno', async () => {
    prismaMock.indentRequest.findMany.mockResolvedValue([listRow(), listRow({ id: 12, processNumber: null })]);
    prismaMock.indentRequest.count.mockResolvedValue(2);
    prismaMock.indentIntegrationConfig.findUnique.mockResolvedValue({ ...CONFIG, slaBusinessDays: 1 });
    const res = await call('get', '/requests', await loginAs('viewer'));

    expect(res.status).toBe(200);
    expect(res.body.slaBusinessDays).toBe(1);
    expect(res.body.data.map((row: { referencePending: boolean }) => row.referencePending)).toEqual([false, true]);
    expect(res.body.data[1].processNumber).toBeNull();
  });
});
