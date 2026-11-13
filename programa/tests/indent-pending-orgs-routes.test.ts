import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste

import {
  auditActions,
  auditCall,
  call,
  clientRow,
  loginAs,
  now,
  prismaMock,
  resetRequestMocks,
  tx,
  uniqueError,
} from './helpers/indentRoutesMock';

// Fila de vinculo do Pipedrive (PR 5a.3): listar, criar cliente e vincular a existente. Dados ficticios; usuario logado: id 7, nome = papel.

const ORG_A = { orgId: 900101, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', city: 'Santos, SP' };
const ORG_B = { orgId: 900102, name: 'Cliente Exemplo Filial Ltda', cnpj: null, city: null };

function pending(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    requestId: 11,
    dealId: 900001,
    status: 'OPEN',
    candidates: [ORG_A] as unknown,
    request: { clientId: null as number | null },
    ...overrides,
  };
}

function otherPending(id: number, requestId: number, candidates: unknown, clientId: number | null = null) {
  return { id, requestId, candidates, request: { clientId } };
}

const created = (overrides: Record<string, unknown> = {}) =>
  clientRow({ id: 31, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', city: 'Santos, SP', pipedriveOrgId: 900101, ...overrides });

beforeEach(() => {
  resetRequestMocks();
  tx.indentPendingOrg.findUnique.mockResolvedValue(pending());
  tx.indentPendingOrg.findMany.mockResolvedValue([]);
  tx.indentPendingOrg.update.mockResolvedValue({});
  tx.indentClient.create.mockResolvedValue(created());
});

describe('GET /pending-orgs', () => {
  it('lista as pendencias ABERTAS com numero da solicitacao, negocio e candidatas; viewer le', async () => {
    prismaMock.indentPendingOrg.findMany.mockResolvedValue([
      { id: 4, requestId: 11, dealId: 900001, candidates: [ORG_A], createdAt: now, request: { processNumber: '276/26' } },
      { id: 5, requestId: 12, dealId: 900002, candidates: [ORG_A, ORG_B], createdAt: now, request: { processNumber: null } },
    ]);
    prismaMock.indentPendingOrg.count.mockResolvedValue(2);
    const res = await call('get', '/pending-orgs', await loginAs('viewer'));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data[0]).toMatchObject({ id: 4, requestId: 11, processNumber: '276/26', dealId: 900001, candidates: [ORG_A] });
    expect(res.body.data[1]).toMatchObject({ processNumber: null, candidates: [ORG_A, ORG_B] });
    expect(prismaMock.indentPendingOrg.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'OPEN' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('candidatas fora do formato esperado sao descartadas; CNPJ que nao tem 14 digitos vira null', async () => {
    prismaMock.indentPendingOrg.findMany.mockResolvedValue([
      {
        id: 4,
        requestId: 11,
        dealId: 900001,
        candidates: [{ orgId: 'x' }, null, { orgId: 900101, name: 'Cliente Exemplo Ltda', cnpj: '123', city: '  ' }],
        createdAt: now,
        request: { processNumber: '276/26' },
      },
    ]);
    const res = await call('get', '/pending-orgs', await loginAs('comprador'));

    expect(res.body.data[0].candidates).toEqual([{ orgId: 900101, name: 'Cliente Exemplo Ltda', cnpj: null, city: null }]);
  });

  it('sem pendencia: lista vazia', async () => {
    prismaMock.indentPendingOrg.findMany.mockResolvedValue([]);
    prismaMock.indentPendingOrg.count.mockResolvedValue(0);
    const res = await call('get', '/pending-orgs', await loginAs('gestor'));

    expect(res.body).toEqual({ data: [], total: 0 });
  });
});

describe('papeis da fila', () => {
  it.each([
    ['post', '/pending-orgs/4/create-client', { orgId: 900101 }],
    ['post', '/pending-orgs/4/link', { orgId: 900101, clientId: 3 }],
  ] as const)('viewer e comercial recebem 403 em %s %s e nada e gravado', async (method, path, body) => {
    for (const role of ['viewer', 'comercial']) {
      const res = await call(method, path, await loginAs(role), body);
      expect(res.status, `${role} ${path}`).toBe(403);
    }
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    expect(tx.indentPendingOrg.update).not.toHaveBeenCalled();
    expect(tx.indentClient.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('comercial tambem nao le a fila (403)', async () => {
    expect((await call('get', '/pending-orgs', await loginAs('comercial'))).status).toBe(403);
  });

  it.each(['admin', 'comprador', 'gestor'])('%s cria cliente pela fila', async (role) => {
    const res = await call('post', '/pending-orgs/4/create-client', await loginAs(role), { orgId: 900101 });
    expect(res.status).toBe(201);
  });

  it('id invalido -> 400', async () => {
    const cookie = await loginAs('admin');
    expect((await call('post', '/pending-orgs/abc/create-client', cookie, { orgId: 900101 })).status).toBe(400);
    expect((await call('post', '/pending-orgs/0/link', cookie, { clientId: 3 })).status).toBe(400);
  });
});

describe('POST /pending-orgs/:id/create-client', () => {
  it('cria o cliente com nome, cidade e CNPJ da organizacao, regra LIVRE e organizacao gravada, liga a solicitacao e resolve a pendencia', async () => {
    const res = await call('post', '/pending-orgs/4/create-client', await loginAs('comprador'), { orgId: 900101 });

    expect(res.status).toBe(201);
    expect(res.body.client).toEqual({ id: 31, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', city: 'Santos, SP', pipedriveOrgId: 900101 });
    expect(res.body.resolved).toEqual([{ id: 4, requestId: 11 }]);
    expect(tx.indentClient.create.mock.calls[0]?.[0].data).toEqual({
      name: 'Cliente Exemplo Ltda',
      cnpj: '11222333000181',
      city: 'Santos, SP',
      ownerName: null,
      pipedriveOrgId: 900101,
    });
    expect(tx.indentRequest.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { clientId: 31 } });
    expect(tx.indentPendingOrg.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { status: 'RESOLVED', resolvedClientId: 31, resolvedOrgId: 900101, resolvedById: 7, resolvedAt: expect.any(Date) },
    });
    expect(auditActions()).toEqual(['indent_client.created_from_pipedrive', 'indent_pending_org.resolved_create']);
    expect(auditCall('indent_client.created_from_pipedrive')).toMatchObject({
      performedById: 7,
      metadata: { source: 'pipedrive', pendingOrgId: 4, orgId: 900101 },
    });
    expect(auditCall('indent_pending_org.resolved_create')).toMatchObject({
      entityType: 'indent_pending_org',
      entityId: '4',
      performedById: 7,
      metadata: { requestId: 11, propagated: false },
    });
  });

  it('o corpo edita nome e cidade (aparados); a solicitacao e travada FOR NO KEY UPDATE antes de ligar', async () => {
    await call('post', '/pending-orgs/4/create-client', await loginAs('admin'), { orgId: 900101, name: '  Razão Social Exemplo S/A  ', city: ' Itajaí ' });

    expect(tx.indentClient.create.mock.calls[0]?.[0].data).toMatchObject({ name: 'Razão Social Exemplo S/A', city: 'Itajaí' });
    const sql = tx.$queryRaw.mock.calls.map((call) => (call[0] as unknown as string[]).join('?'));
    expect(sql.some((text) => text.includes('FROM "IndentRequest"') && text.includes('FOR NO KEY UPDATE'))).toBe(true);
    const executeSql = tx.$executeRaw.mock.calls.map((call) => (call[0] as unknown as string[]).join('?'));
    expect(executeSql[0]).toContain('pg_advisory_xact_lock');
  });

  it('organizacao sem CNPJ valido: usa o CNPJ digitado (com mascara); sem os dois fica "CNPJ pendente" (nulo)', async () => {
    const noCnpj = { ...ORG_A, cnpj: null };
    tx.indentPendingOrg.findUnique.mockResolvedValue(pending({ candidates: [noCnpj] }));
    const cookie = await loginAs('admin');

    await call('post', '/pending-orgs/4/create-client', cookie, { orgId: 900101, cnpj: '11.444.777/0001-61' });
    expect(tx.indentClient.create.mock.calls[0]?.[0].data.cnpj).toBe('11444777000161');

    await call('post', '/pending-orgs/4/create-client', cookie, { orgId: 900101 });
    expect(tx.indentClient.create.mock.calls[1]?.[0].data.cnpj).toBeNull();
    // Sem CNPJ vale a trava de nome do H0 (advisory + checagem entre os clientes sem CNPJ).
    expect(tx.indentClient.findMany).toHaveBeenCalledWith({ where: { cnpj: null }, select: { name: true } });
  });

  it('o CNPJ valido da organizacao tem prioridade sobre o digitado', async () => {
    await call('post', '/pending-orgs/4/create-client', await loginAs('admin'), { orgId: 900101, cnpj: '11444777000161' });

    expect(tx.indentClient.create.mock.calls[0]?.[0].data.cnpj).toBe('11222333000181');
  });

  it('nome sem CNPJ repetido (H0) -> 409 e nada e ligado', async () => {
    tx.indentPendingOrg.findUnique.mockResolvedValue(pending({ candidates: [{ ...ORG_A, cnpj: null }] }));
    tx.indentClient.findMany.mockResolvedValue([{ name: 'cliente exemplo ltda' }]);
    const res = await call('post', '/pending-orgs/4/create-client', await loginAs('admin'), { orgId: 900101 });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe um cliente sem CNPJ com este nome.');
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    expect(tx.indentPendingOrg.update).not.toHaveBeenCalled();
  });

  it.each([
    [['cnpj'], 'Já existe um cliente com este CNPJ.'],
    [['pipedriveOrgId'], 'Organização do Pipedrive já vinculada a outro cliente.'],
  ])('P2002 em %s -> 409 traduzido', async (target, message) => {
    tx.indentClient.create.mockRejectedValue(uniqueError(target));
    const res = await call('post', '/pending-orgs/4/create-client', await loginAs('admin'), { orgId: 900101 });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(message);
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
  });

  it('orgId fora das candidatas do negocio -> 400 e nada e gravado', async () => {
    const res = await call('post', '/pending-orgs/4/create-client', await loginAs('admin'), { orgId: 999999 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Organização fora deste negócio.');
    expect(tx.indentClient.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('negocio sem organizacao nao tem o que criar: orgId e sempre "fora" (so o vinculo a existente serve)', async () => {
    tx.indentPendingOrg.findUnique.mockResolvedValue(pending({ candidates: [] }));
    const res = await call('post', '/pending-orgs/4/create-client', await loginAs('admin'), { orgId: 900101 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Organização fora deste negócio.');
  });

  it('negocio com 2 organizacoes: a escolhida vira o cliente e a outra nao e tocada', async () => {
    tx.indentPendingOrg.findUnique.mockResolvedValue(pending({ candidates: [ORG_A, ORG_B] }));
    tx.indentClient.create.mockResolvedValue(created({ id: 32, name: 'Cliente Exemplo Filial Ltda', cnpj: null, city: null, pipedriveOrgId: 900102 }));
    const res = await call('post', '/pending-orgs/4/create-client', await loginAs('admin'), { orgId: 900102 });

    expect(res.status).toBe(201);
    expect(tx.indentClient.create.mock.calls[0]?.[0].data).toMatchObject({ name: 'Cliente Exemplo Filial Ltda', pipedriveOrgId: 900102, cnpj: null });
    expect(tx.indentRequest.update).toHaveBeenCalledTimes(1);
  });

  it('pendencias irmas: resolve as ABERTAS cujo UNICO candidato e a mesma organizacao (e so elas)', async () => {
    tx.indentPendingOrg.findMany.mockResolvedValue([
      otherPending(5, 12, [ORG_A]), // mesma organizacao, unica -> resolve
      otherPending(6, 13, [ORG_A, ORG_B]), // 2 candidatas -> nao resolve sozinha
      otherPending(7, 14, [ORG_B]), // outra organizacao -> nao
      otherPending(8, 15, [ORG_A], 3), // solicitacao que ja tem cliente -> nunca troca
      otherPending(9, 16, [ORG_A]), // outra irma
    ]);
    const res = await call('post', '/pending-orgs/4/create-client', await loginAs('admin'), { orgId: 900101 });

    expect(res.status).toBe(201);
    expect(res.body.resolved).toEqual([
      { id: 4, requestId: 11 },
      { id: 5, requestId: 12 },
      { id: 9, requestId: 16 },
    ]);
    expect(tx.indentRequest.update.mock.calls.map((call) => (call[0] as { where: { id: number } }).where.id)).toEqual([11, 12, 16]);
    expect(tx.indentPendingOrg.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'OPEN', id: { not: 4 } } }),
    );
    expect(auditActions().filter((action) => action === 'indent_pending_org.resolved_create')).toHaveLength(3);
    expect(auditCall('indent_pending_org.resolved_create')).toMatchObject({ metadata: { requestId: 11, propagated: false } });
    const propagated = tx.auditLog.create.mock.calls
      .map((call) => (call[0] as { data: { entityId: string; metadata: { propagated: boolean } } }).data)
      .filter((data) => data.entityId === '5');
    expect(propagated[0]?.metadata.propagated).toBe(true);
  });

  it('pendencia resolvida -> 409; solicitacao que ja tem cliente -> 409; inexistente -> 404', async () => {
    const cookie = await loginAs('admin');

    tx.indentPendingOrg.findUnique.mockResolvedValue(pending({ status: 'RESOLVED' }));
    const resolved = await call('post', '/pending-orgs/4/create-client', cookie, { orgId: 900101 });
    expect(resolved.status).toBe(409);
    expect(resolved.body.message).toBe('Pendência já resolvida.');

    tx.indentPendingOrg.findUnique.mockResolvedValue(pending({ request: { clientId: 3 } }));
    expect((await call('post', '/pending-orgs/4/create-client', cookie, { orgId: 900101 })).status).toBe(409);

    tx.indentPendingOrg.findUnique.mockResolvedValue(null);
    const missing = await call('post', '/pending-orgs/4/create-client', cookie, { orgId: 900101 });
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Pendência não encontrada.');

    expect(tx.indentClient.create).not.toHaveBeenCalled();
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
  });

  it.each([
    ['sem orgId', {}, 'Escolha a organização do Pipedrive.'],
    ['orgId em texto', { orgId: '900101' }, 'Escolha a organização do Pipedrive.'],
    ['orgId zero', { orgId: 0 }, 'Escolha a organização do Pipedrive.'],
    ['CNPJ invalido', { orgId: 900101, cnpj: '11222333000182' }, 'CNPJ inválido.'],
    ['CNPJ em numero', { orgId: 900101, cnpj: 11222333000181 }, 'CNPJ inválido.'],
    ['nome longo', { orgId: 900101, name: 'x'.repeat(201) }, 'O texto deve ter no máximo 200 caracteres.'],
    ['campo extra (regra de fornecedores)', { orgId: 900101, supplierRuleMode: 'BLOQUEIO' }, null],
    ['campo extra (quem resolve vem do login)', { orgId: 900101, resolvedById: 1 }, null],
    ['campo extra (organizacao do cliente)', { orgId: 900101, pipedriveOrgId: 5 }, null],
  ])('validacao no backend: %s -> 400 e nada gravado', async (_name, body, message) => {
    const res = await call('post', '/pending-orgs/4/create-client', await loginAs('admin'), body);

    expect(res.status).toBe(400);
    if (message) expect(res.body.message).toBe(message);
    expect(tx.indentClient.create).not.toHaveBeenCalled();
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('CNPJ vazio e nome vazio no corpo contam como ausentes (usa os da organizacao)', async () => {
    await call('post', '/pending-orgs/4/create-client', await loginAs('admin'), { orgId: 900101, name: '  ', cnpj: '', city: null });

    expect(tx.indentClient.create.mock.calls[0]?.[0].data).toMatchObject({ name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', city: 'Santos, SP' });
  });

  it('nao grava CNPJ, nota ou nome no metadata nem no log do console', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    await call('post', '/pending-orgs/4/create-client', await loginAs('admin'), { orgId: 900101 });

    for (const entry of tx.auditLog.create.mock.calls) {
      const metadata = JSON.stringify((entry[0] as { data: { metadata: unknown } }).data.metadata ?? null);
      expect(metadata).not.toContain('11222333000181');
      expect(metadata).not.toContain('Cliente Exemplo');
    }
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('11222333000181');
      spy.mockRestore();
    }
  });
});

describe('POST /pending-orgs/:id/link', () => {
  const EXISTING = { id: 3, name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', city: 'Itajaí', pipedriveOrgId: null as number | null, isActive: true };

  // findUnique serve o cliente (por id) e o dono da organizacao (por pipedriveOrgId).
  function clients(client: Record<string, unknown> | null, holder: { id: number } | null = null) {
    tx.indentClient.findUnique.mockImplementation(async ({ where }: { where: { id?: number; pipedriveOrgId?: number } }) =>
      where.id !== undefined ? client : holder,
    );
    tx.indentClient.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...(client ?? {}), ...data }));
    tx.indentClient.findFirst.mockResolvedValue(null);
  }

  beforeEach(() => clients({ ...EXISTING }));

  it('liga a solicitacao ao cliente existente, grava a organizacao no cliente e resolve a pendencia', async () => {
    const res = await call('post', '/pending-orgs/4/link', await loginAs('gestor'), { orgId: 900101, clientId: 3 });

    expect(res.status).toBe(200);
    expect(res.body.client).toMatchObject({ id: 3, pipedriveOrgId: 900101 });
    expect(res.body.cnpjCompleted).toBe(false);
    expect(res.body.resolved).toEqual([{ id: 4, requestId: 11 }]);
    expect(tx.indentClient.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 }, data: { pipedriveOrgId: 900101 } }));
    expect(tx.indentRequest.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { clientId: 3 } });
    expect(tx.indentPendingOrg.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { status: 'RESOLVED', resolvedClientId: 3, resolvedOrgId: 900101, resolvedById: 7, resolvedAt: expect.any(Date) },
    });
    expect(auditActions()).toEqual(['indent_client.pipedrive_org_linked', 'indent_pending_org.resolved_link']);
  });

  it('P5: cliente SEM CNPJ recebe o CNPJ valido da organizacao; o audit nao leva os digitos', async () => {
    clients({ ...EXISTING, cnpj: null });
    const res = await call('post', '/pending-orgs/4/link', await loginAs('admin'), { orgId: 900101, clientId: 3 });

    expect(res.status).toBe(200);
    expect(res.body.cnpjCompleted).toBe(true);
    expect(res.body.client).toMatchObject({ cnpj: '11222333000181', pipedriveOrgId: 900101 });
    expect(tx.indentClient.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pipedriveOrgId: 900101, cnpj: '11222333000181' } }),
    );
    expect(auditActions()).toEqual([
      'indent_client.pipedrive_org_linked',
      'indent_client.cnpj_from_pipedrive',
      'indent_pending_org.resolved_link',
    ]);
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain('11222333000181');
  });

  it('P5: CNPJ da organizacao ja usado por outro cliente NAO e gravado (o vinculo segue)', async () => {
    clients({ ...EXISTING, cnpj: null });
    tx.indentClient.findFirst.mockResolvedValue({ id: 9 });
    const res = await call('post', '/pending-orgs/4/link', await loginAs('admin'), { orgId: 900101, clientId: 3 });

    expect(res.status).toBe(200);
    expect(res.body.cnpjCompleted).toBe(false);
    expect(tx.indentClient.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pipedriveOrgId: 900101 } }));
    expect(auditActions()).not.toContain('indent_client.cnpj_from_pipedrive');
  });

  it('P5: organizacao sem CNPJ valido nao completa; cliente que ja tem CNPJ nunca e alterado', async () => {
    const cookie = await loginAs('admin');

    clients({ ...EXISTING, cnpj: null });
    tx.indentPendingOrg.findUnique.mockResolvedValue(pending({ candidates: [{ ...ORG_A, cnpj: null }] }));
    await call('post', '/pending-orgs/4/link', cookie, { orgId: 900101, clientId: 3 });
    expect(tx.indentClient.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { pipedriveOrgId: 900101 } }));

    clients({ ...EXISTING, cnpj: '11444777000161' });
    tx.indentPendingOrg.findUnique.mockResolvedValue(pending());
    await call('post', '/pending-orgs/4/link', cookie, { orgId: 900101, clientId: 3 });
    expect(tx.indentClient.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { pipedriveOrgId: 900101 } }));
  });

  it('cliente que ja tem esta organizacao: so liga a solicitacao (nenhuma escrita no cliente)', async () => {
    clients({ ...EXISTING, pipedriveOrgId: 900101 });
    const res = await call('post', '/pending-orgs/4/link', await loginAs('admin'), { orgId: 900101, clientId: 3 });

    expect(res.status).toBe(200);
    expect(tx.indentClient.update).not.toHaveBeenCalled();
    expect(tx.indentRequest.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { clientId: 3 } });
  });

  it('organizacao ja vinculada a OUTRO cliente -> 409; cliente ja ligado a outra organizacao -> 409', async () => {
    const cookie = await loginAs('admin');

    clients({ ...EXISTING }, { id: 8 });
    const taken = await call('post', '/pending-orgs/4/link', cookie, { orgId: 900101, clientId: 3 });
    expect(taken.status).toBe(409);
    expect(taken.body.message).toBe('Organização do Pipedrive já vinculada a outro cliente.');

    clients({ ...EXISTING, pipedriveOrgId: 900555 });
    const other = await call('post', '/pending-orgs/4/link', cookie, { orgId: 900101, clientId: 3 });
    expect(other.status).toBe(409);
    expect(other.body.message).toBe('O cliente já está vinculado a outra organização do Pipedrive.');

    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    expect(tx.indentPendingOrg.update).not.toHaveBeenCalled();
  });

  it('corrida: P2002 ao gravar a organizacao/CNPJ vira 409 traduzido', async () => {
    tx.indentClient.update.mockRejectedValue(uniqueError(['pipedriveOrgId']));
    const res = await call('post', '/pending-orgs/4/link', await loginAs('admin'), { orgId: 900101, clientId: 3 });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Organização do Pipedrive já vinculada a outro cliente.');
  });

  it('cliente inexistente ou INATIVO -> 400', async () => {
    const cookie = await loginAs('admin');

    clients(null);
    expect((await call('post', '/pending-orgs/4/link', cookie, { orgId: 900101, clientId: 3 })).status).toBe(400);
    clients({ ...EXISTING, isActive: false });
    const inactive = await call('post', '/pending-orgs/4/link', cookie, { orgId: 900101, clientId: 3 });
    expect(inactive.status).toBe(400);
    expect(inactive.body.message).toBe('Cliente inexistente ou inativo.');
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
  });

  it('orgId fora das candidatas -> 400', async () => {
    const res = await call('post', '/pending-orgs/4/link', await loginAs('admin'), { orgId: 999999, clientId: 3 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Organização fora deste negócio.');
    expect(tx.indentClient.update).not.toHaveBeenCalled();
  });

  it('1 candidata sem orgId: usa a unica; 2 candidatas sem orgId -> 400; com orgId valido segue', async () => {
    const cookie = await loginAs('admin');

    const single = await call('post', '/pending-orgs/4/link', cookie, { clientId: 3 });
    expect(single.status).toBe(200);
    expect(tx.indentClient.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pipedriveOrgId: 900101 } }));

    vi.clearAllMocks();
    tx.indentPendingOrg.findUnique.mockResolvedValue(pending({ candidates: [ORG_A, ORG_B] }));
    tx.indentPendingOrg.findMany.mockResolvedValue([]);
    const ambiguous = await call('post', '/pending-orgs/4/link', cookie, { clientId: 3 });
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.message).toBe('Escolha a organização deste negócio.');
    expect(tx.indentRequest.update).not.toHaveBeenCalled();

    const chosen = await call('post', '/pending-orgs/4/link', cookie, { orgId: 900102, clientId: 3 });
    expect(chosen.status).toBe(200);
    expect(tx.indentClient.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pipedriveOrgId: 900102 } }));
  });

  it('negocio SEM organizacao: so "link" sem orgId; liga o cliente sem mexer no cadastro dele', async () => {
    tx.indentPendingOrg.findUnique.mockResolvedValue(pending({ candidates: [] }));
    const cookie = await loginAs('admin');
    const res = await call('post', '/pending-orgs/4/link', cookie, { clientId: 3 });

    expect(res.status).toBe(200);
    expect(tx.indentClient.update).not.toHaveBeenCalled();
    expect(tx.indentRequest.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { clientId: 3 } });
    expect(tx.indentPendingOrg.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resolvedOrgId: null }) }));
    expect(tx.indentPendingOrg.findMany).not.toHaveBeenCalled(); // sem organizacao nao ha irmas para resolver

    const withOrg = await call('post', '/pending-orgs/4/link', cookie, { orgId: 900101, clientId: 3 });
    expect(withOrg.status).toBe(400);
  });

  it('propaga para as pendencias irmas da mesma organizacao (unica candidata)', async () => {
    tx.indentPendingOrg.findMany.mockResolvedValue([otherPending(5, 12, [ORG_A]), otherPending(6, 13, [ORG_B])]);
    const res = await call('post', '/pending-orgs/4/link', await loginAs('admin'), { orgId: 900101, clientId: 3 });

    expect(res.body.resolved).toEqual([
      { id: 4, requestId: 11 },
      { id: 5, requestId: 12 },
    ]);
    expect(tx.indentRequest.update.mock.calls.map((call) => (call[0] as { where: { id: number } }).where.id)).toEqual([11, 12]);
  });

  it('pendencia resolvida -> 409 e nada muda', async () => {
    tx.indentPendingOrg.findUnique.mockResolvedValue(pending({ status: 'RESOLVED' }));
    const res = await call('post', '/pending-orgs/4/link', await loginAs('admin'), { orgId: 900101, clientId: 3 });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Pendência já resolvida.');
    expect(tx.indentClient.update).not.toHaveBeenCalled();
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
  });

  it.each([
    ['sem clientId', { orgId: 900101 }],
    ['clientId em texto', { orgId: 900101, clientId: '3' }],
    ['campo extra', { orgId: 900101, clientId: 3, cnpj: '11222333000181' }],
    ['orgId negativo', { orgId: -1, clientId: 3 }],
  ])('validacao no backend: %s -> 400 e nada gravado', async (_name, body) => {
    const res = await call('post', '/pending-orgs/4/link', await loginAs('admin'), body);

    expect(res.status).toBe(400);
    expect(tx.indentClient.update).not.toHaveBeenCalled();
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
