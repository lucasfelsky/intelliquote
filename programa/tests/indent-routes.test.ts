import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());

import { app } from '../src/app';
import {
  auditActions,
  auditCall,
  call,
  clientRow,
  expectNoWrites,
  loginAs,
  prismaMock,
  resetIndentMocks,
  tx,
  uniqueError,
  type Method,
} from './helpers/indentRoutesMock';

const VALID_CNPJ = '11.222.333/0001-81';

// Os 18 endpoints do PR 1. `leitura` = GET de cadastro (inclusive options); os GET de importacao
// sao restritos a quem escreve.
const ENDPOINTS: Array<{ method: Method; path: string; body?: unknown; leitura: boolean }> = [
  { method: 'get', path: '/clients', leitura: true },
  { method: 'post', path: '/clients', body: { name: 'X', cnpj: VALID_CNPJ }, leitura: false },
  { method: 'put', path: '/clients/3', body: { city: 'Y' }, leitura: false },
  {
    method: 'put',
    path: '/clients/3/supplier-rule',
    body: { mode: 'LIVRE', supplierIds: [] },
    leitura: false,
  },
  { method: 'get', path: '/suppliers', leitura: true },
  { method: 'get', path: '/suppliers/options', leitura: true },
  { method: 'post', path: '/suppliers', body: { name: 'X' }, leitura: false },
  { method: 'put', path: '/suppliers/5', body: { country: 'Y' }, leitura: false },
  { method: 'put', path: '/suppliers/5/products', body: { productIds: [1] }, leitura: false },
  { method: 'get', path: '/products', leitura: true },
  { method: 'get', path: '/products/options', leitura: true },
  { method: 'post', path: '/products', body: { name: 'X' }, leitura: false },
  { method: 'put', path: '/products/2', body: { notes: 'Y' }, leitura: false },
  { method: 'post', path: '/products/2/promote', leitura: false },
  { method: 'get', path: '/import/suppliers', leitura: false },
  { method: 'post', path: '/import/suppliers', body: { ids: [1] }, leitura: false },
  { method: 'get', path: '/import/products', leitura: false },
  { method: 'post', path: '/import/products', body: { ids: [1] }, leitura: false },
];

beforeEach(resetIndentMocks);

describe('/api/v1/indent - autenticacao e papeis', () => {
  it('sem login retorna 401 em todos os 18 endpoints', async () => {
    for (const endpoint of ENDPOINTS) {
      const req = request(app)[endpoint.method](`/api/v1/indent${endpoint.path}`);
      const res = endpoint.method === 'get' ? await req : await req.send((endpoint.body ?? {}) as object);
      expect(res.status, `${endpoint.method} ${endpoint.path}`).toBe(401);
    }
  });

  describe('comercial recebe 403 em toda rota Indent (inclusive GET)', () => {
    it.each(ENDPOINTS)('comercial: $method $path -> 403', async ({ method, path, body }) => {
      const cookie = await loginAs('comercial');
      const res = await call(method, path, cookie, body);
      expect(res.status).toBe(403);
      expectNoWrites();
    });
  });

  it('viewer le os cadastros e os options (200), mas nao escreve nem importa (403)', async () => {
    const cookie = await loginAs('viewer');

    for (const endpoint of ENDPOINTS) {
      const res = await call(endpoint.method, endpoint.path, cookie, endpoint.body);
      expect(res.status, `${endpoint.method} ${endpoint.path}`).toBe(endpoint.leitura ? 200 : 403);
    }

    expectNoWrites();
  });

  it.each(['admin', 'comprador', 'gestor'])('%s escreve e consulta candidatos de importacao', async (role) => {
    const cookie = await loginAs(role);

    expect((await call('post', '/clients', cookie, { name: 'X', cnpj: VALID_CNPJ })).status).toBe(201);
    expect((await call('post', '/products', cookie, { name: 'Produto X' })).status).toBe(201);
    expect((await call('get', '/import/suppliers', cookie)).status).toBe(200);
    expect((await call('get', '/import/products', cookie)).status).toBe(200);
  });
});

describe('/api/v1/indent - clientes', () => {
  it('GET /clients filtra ativos por padrao e traz as regras com o nome do fornecedor', async () => {
    prismaMock.indentClient.findMany.mockResolvedValue([
      clientRow({
        supplierRuleMode: 'APROVADOS',
        ruleReason: 'Auditoria',
        supplierRules: [{ supplierId: 5, supplier: { name: 'Acme Chemicals' } }],
      }),
    ]);
    const cookie = await loginAs('viewer');

    const res = await call('get', '/clients', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data[0].supplierRules).toEqual([
      { supplierId: 5, supplier: { name: 'Acme Chemicals' } },
    ]);
    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 20, totalItems: 1 });
    expect(prismaMock.indentClient.findMany.mock.calls[0][0].where).toEqual({ isActive: true });

    await call('get', '/clients?inativos=1&q=11.222', cookie);
    const where = prismaMock.indentClient.findMany.mock.calls[1][0].where;
    expect(where.isActive).toBeUndefined();
    expect(where.OR).toEqual(
      expect.arrayContaining([{ cnpj: { contains: '11222' } }]),
    );
  });

  it('POST /clients normaliza o CNPJ para so digitos, grava e audita', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/clients', cookie, {
      name: '  Cliente Exemplo Ltda ',
      cnpj: VALID_CNPJ,
      city: 'Itajaí',
    });

    expect(res.status).toBe(201);
    const data = tx.indentClient.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: 'Cliente Exemplo Ltda', cnpj: '11222333000181', city: 'Itajaí' });
    expect(auditActions()).toEqual(['indent_client.created']);
    expect(auditCall('indent_client.created')).toMatchObject({
      entityType: 'indent_client',
      entityId: '3',
      performedById: 7,
    });
  });

  it.each([
    ['digito verificador errado', '11.222.333/0001-82'],
    ['14 zeros', '00000000000000'],
    ['14 uns', '11111111111111'],
    ['13 digitos', '1122233300018'],
    ['15 digitos', '112223330001811'],
  ])('POST /clients rejeita CNPJ invalido (%s) com 400', async (_motivo, cnpj) => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/clients', cookie, { name: 'X', cnpj });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('CNPJ inválido.');
    expect(tx.indentClient.create).not.toHaveBeenCalled();
  });

  it('P2002 em cnpj vira 409 e em pipedriveOrgId vira 409 com a mensagem propria', async () => {
    const cookie = await loginAs('comprador');

    tx.indentClient.create.mockRejectedValueOnce(uniqueError(['cnpj']));
    const dupCnpj = await call('post', '/clients', cookie, { name: 'X', cnpj: VALID_CNPJ });
    expect(dupCnpj.status).toBe(409);
    expect(dupCnpj.body.message).toBe('Já existe um cliente com este CNPJ.');

    tx.indentClient.create.mockRejectedValueOnce(uniqueError(['pipedriveOrgId']));
    const dupOrg = await call('post', '/clients', cookie, {
      name: 'X',
      cnpj: VALID_CNPJ,
      pipedriveOrgId: 5521,
    });
    expect(dupOrg.status).toBe(409);
    expect(dupOrg.body.message).toBe('Organização do Pipedrive já vinculada a outro cliente.');
  });

  it('PUT /clients/:id atualiza, audita before/after e devolve 404 para cliente inexistente', async () => {
    const cookie = await loginAs('gestor');
    tx.indentClient.update.mockResolvedValue(clientRow({ city: 'Joinville' }));

    const ok = await call('put', '/clients/3', cookie, { city: 'Joinville', ownerName: ' Maria ' });
    expect(ok.status).toBe(200);
    expect(tx.indentClient.update.mock.calls[0][0].data).toEqual({ city: 'Joinville', ownerName: 'Maria' });
    expect(auditCall('indent_client.updated')).toMatchObject({
      beforeData: expect.objectContaining({ city: 'Itajaí' }),
      afterData: expect.objectContaining({ city: 'Joinville' }),
    });

    tx.indentClient.findUnique.mockResolvedValue(null);
    const missing = await call('put', '/clients/99', cookie, { city: 'X' });
    expect(missing.status).toBe(404);

    const badId = await call('put', '/clients/abc', cookie, { city: 'X' });
    expect(badId.status).toBe(400);
  });
});

describe('/api/v1/indent - regra de restricao do cliente', () => {
  it('modo restrito sem fornecedor -> 400 e sem motivo -> 400 (nada e gravado)', async () => {
    const cookie = await loginAs('comprador');

    const semLista = await call('put', '/clients/3/supplier-rule', cookie, {
      mode: 'APROVADOS',
      supplierIds: [],
      reason: 'Motivo',
    });
    expect(semLista.status).toBe(400);
    expect(semLista.body.message).toBe('Escolha ao menos um fornecedor na lista');

    const semMotivo = await call('put', '/clients/3/supplier-rule', cookie, {
      mode: 'BLOQUEIO',
      supplierIds: [5],
    });
    expect(semMotivo.status).toBe(400);
    expect(semMotivo.body.message).toBe('Informe o motivo da restrição.');

    const motivoEmBranco = await call('put', '/clients/3/supplier-rule', cookie, {
      mode: 'BLOQUEIO',
      supplierIds: [5],
      reason: '   ',
    });
    expect(motivoEmBranco.status).toBe(400);
    expect(motivoEmBranco.body.message).toBe('Informe o motivo da restrição.');

    expect(tx.indentClientSupplierRule.deleteMany).not.toHaveBeenCalled();
    expect(tx.indentClient.update).not.toHaveBeenCalled();
  });

  it('fornecedor inexistente na lista -> 400 sem apagar nem criar regras', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplier.count.mockResolvedValue(1);

    const res = await call('put', '/clients/3/supplier-rule', cookie, {
      mode: 'APROVADOS',
      supplierIds: [5, 6],
      reason: 'Auditoria',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Fornecedor inexistente na lista.');
    expect(tx.indentClientSupplierRule.deleteMany).not.toHaveBeenCalled();
    expect(tx.indentClientSupplierRule.createMany).not.toHaveBeenCalled();
  });

  it('troca APROVADOS -> BLOQUEIO substitui a lista (dedup) e audita before/after', async () => {
    const cookie = await loginAs('comprador');
    tx.indentClient.findUnique.mockResolvedValue(
      clientRow({
        supplierRuleMode: 'APROVADOS',
        ruleReason: 'Antigo',
        supplierRules: [
          { supplierId: 2, supplier: { name: 'B' } },
          { supplierId: 1, supplier: { name: 'A' } },
        ],
      }),
    );
    tx.indentSupplier.count.mockResolvedValue(2);
    tx.indentClient.update.mockResolvedValue(
      clientRow({
        supplierRuleMode: 'BLOQUEIO',
        ruleReason: 'Reprovacao de lote',
        supplierRules: [
          { supplierId: 9, supplier: { name: 'Z' } },
          { supplierId: 4, supplier: { name: 'D' } },
        ],
      }),
    );

    const res = await call('put', '/clients/3/supplier-rule', cookie, {
      mode: 'BLOQUEIO',
      supplierIds: [9, 4, 9],
      reason: '  Reprovacao de lote ',
    });

    expect(res.status).toBe(200);
    expect(tx.indentSupplier.count.mock.calls[0][0].where).toEqual({ id: { in: [9, 4] } });
    expect(tx.indentClientSupplierRule.deleteMany).toHaveBeenCalledWith({ where: { clientId: 3 } });
    expect(tx.indentClientSupplierRule.createMany).toHaveBeenCalledWith({
      data: [
        { clientId: 3, supplierId: 9 },
        { clientId: 3, supplierId: 4 },
      ],
    });
    expect(tx.indentClient.update.mock.calls[0][0].data).toEqual({
      supplierRuleMode: 'BLOQUEIO',
      ruleReason: 'Reprovacao de lote',
    });
    expect(auditActions()).toEqual(['indent_client.rule_updated']);
    expect(auditCall('indent_client.rule_updated')).toMatchObject({
      entityType: 'indent_client',
      entityId: '3',
      performedById: 7,
      beforeData: { mode: 'APROVADOS', supplierIds: [1, 2], reason: 'Antigo' },
      afterData: { mode: 'BLOQUEIO', supplierIds: [4, 9], reason: 'Reprovacao de lote' },
    });
  });

  it('LIVRE zera: deleteMany chamado, createMany nao, ruleReason null (mesmo com lista e motivo)', async () => {
    const cookie = await loginAs('comprador');
    tx.indentClient.findUnique.mockResolvedValue(
      clientRow({
        supplierRuleMode: 'APROVADOS',
        ruleReason: 'Antigo',
        supplierRules: [{ supplierId: 1, supplier: { name: 'A' } }],
      }),
    );

    const res = await call('put', '/clients/3/supplier-rule', cookie, {
      mode: 'LIVRE',
      supplierIds: [1, 2],
      reason: 'ignorado',
    });

    expect(res.status).toBe(200);
    expect(tx.indentClientSupplierRule.deleteMany).toHaveBeenCalledWith({ where: { clientId: 3 } });
    expect(tx.indentClientSupplierRule.createMany).not.toHaveBeenCalled();
    expect(tx.indentSupplier.count).not.toHaveBeenCalled();
    expect(tx.indentClient.update.mock.calls[0][0].data).toEqual({
      supplierRuleMode: 'LIVRE',
      ruleReason: null,
    });
  });

  it('cliente inexistente -> 404', async () => {
    const cookie = await loginAs('comprador');
    tx.indentClient.findUnique.mockResolvedValue(null);

    const res = await call('put', '/clients/99/supplier-rule', cookie, { mode: 'LIVRE', supplierIds: [] });

    expect(res.status).toBe(404);
    expect(tx.indentClientSupplierRule.deleteMany).not.toHaveBeenCalled();
  });
});

// ---- IQ Indent H0: CNPJ do cliente anulavel ("CNPJ pendente") ----
describe('IQ Indent H0 - CNPJ pendente (rotas de clientes)', () => {
  beforeEach(() => {
    tx.indentClient.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(clientRow(data)));
    tx.indentClient.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(clientRow(data)));
  });

  describe('IQ Indent H0 - criar cliente sem CNPJ', () => {
    it.each([
      ['sem a chave', { name: 'Cliente Pendente' }],
      ['string vazia', { name: 'Cliente Pendente', cnpj: '' }],
      ['so espacos', { name: 'Cliente Pendente', cnpj: '   ' }],
      ['null', { name: 'Cliente Pendente', cnpj: null }],
    ])('POST /clients %s -> 201 com cnpj null, audita e confere duplicidade entre os sem CNPJ', async (_caso, body) => {
      const cookie = await loginAs('comprador');

      const res = await call('post', '/clients', cookie, body);

      expect(res.status).toBe(201);
      expect(res.body.cnpj).toBeNull();
      expect(tx.indentClient.create.mock.calls[0][0].data).toMatchObject({ name: 'Cliente Pendente', cnpj: null });
      expect(tx.indentClient.findMany).toHaveBeenCalledWith({ where: { cnpj: null }, select: { name: true } });
      const audit = tx.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe('indent_client.created');
      expect(audit.afterData).toMatchObject({ cnpj: null });
    });

    it('dois clientes sem CNPJ com nomes diferentes convivem (201)', async () => {
      const cookie = await loginAs('comprador');
      tx.indentClient.findMany.mockResolvedValue([{ name: 'Outro Cliente' }]);

      const res = await call('post', '/clients', cookie, { name: 'Cliente Pendente' });

      expect(res.status).toBe(201);
      expect(tx.indentClient.create).toHaveBeenCalledTimes(1);
    });

    it.each(['Cliente Pendente', '  CLIENTE   pendente ', 'Cliente Pêndente'])(
      'mesmo nome (%s, ignorando caixa, acento e espacos) entre os sem CNPJ -> 409 sem gravar',
      async (nome) => {
        const cookie = await loginAs('gestor');
        tx.indentClient.findMany.mockResolvedValue([{ name: 'Cliente Pendente' }]);

        const res = await call('post', '/clients', cookie, { name: nome });

        expect(res.status).toBe(409);
        expect(res.body.message).toBe('Já existe um cliente sem CNPJ com este nome.');
        expect(tx.indentClient.create).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
      },
    );

    it('com CNPJ informado a consulta por nome nao roda; o mesmo nome de um cliente com CNPJ nao conta', async () => {
      const cookie = await loginAs('comprador');

      const res = await call('post', '/clients', cookie, { name: 'Cliente Pendente', cnpj: VALID_CNPJ });

      expect(res.status).toBe(201);
      expect(res.body.cnpj).toBe('11222333000181');
      expect(tx.indentClient.findMany).not.toHaveBeenCalled();
    });

    it('CNPJ informado duplicado -> 409 (indice unico) e CNPJ invalido -> 400', async () => {
      const cookie = await loginAs('comprador');

      tx.indentClient.create.mockRejectedValueOnce(uniqueError(['cnpj']));
      const duplicado = await call('post', '/clients', cookie, { name: 'X', cnpj: VALID_CNPJ });
      expect(duplicado.status).toBe(409);
      expect(duplicado.body.message).toBe('Já existe um cliente com este CNPJ.');

      for (const cnpj of ['11.222.333/0001-82', 'abc', 1122233300018, '1122']) {
        const res = await call('post', '/clients', cookie, { name: 'X', cnpj });
        expect(res.status, String(cnpj)).toBe(400);
        expect(res.body.message).toBe('CNPJ inválido.');
      }
      expect(tx.indentClient.create).toHaveBeenCalledTimes(1);
    });

    it('comercial continua 403 e viewer nao escreve', async () => {
      const comercial = await loginAs('comercial');
      expect((await call('post', '/clients', comercial, { name: 'X' })).status).toBe(403);
      expect((await call('get', '/clients?semCnpj=1', comercial)).status).toBe(403);

      const viewer = await loginAs('viewer');
      expect((await call('post', '/clients', viewer, { name: 'X' })).status).toBe(403);
      expect(tx.indentClient.create).not.toHaveBeenCalled();
    });
  });

  describe('IQ Indent H0 - listar (semCnpj e counts)', () => {
    it('padrao: sem filtro de CNPJ e counts { todos, semCnpj } so de ativos', async () => {
      prismaMock.indentClient.count.mockResolvedValueOnce(9).mockResolvedValueOnce(9).mockResolvedValueOnce(4);
      const cookie = await loginAs('viewer');

      const res = await call('get', '/clients', cookie);

      expect(res.status).toBe(200);
      expect(res.body.counts).toEqual({ todos: 9, semCnpj: 4 });
      expect(prismaMock.indentClient.findMany.mock.calls[0][0].where).toEqual({ isActive: true });
      const wheres = prismaMock.indentClient.count.mock.calls.map((c) => c[0].where);
      expect(wheres).toEqual([{ isActive: true }, { isActive: true }, { isActive: true, cnpj: null }]);
    });

    it.each(['1', 'true'])('semCnpj=%s filtra cnpj null; as contagens ignoram o chip e a busca', async (valor) => {
      const cookie = await loginAs('viewer');

      const res = await call('get', `/clients?semCnpj=${valor}&q=ana`, cookie);

      expect(res.status).toBe(200);
      const where = prismaMock.indentClient.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ isActive: true, cnpj: null });
      expect(where.OR).toBeDefined();
      const wheres = prismaMock.indentClient.count.mock.calls.map((c) => c[0].where);
      expect(wheres[1]).toEqual({ isActive: true });
      expect(wheres[2]).toEqual({ isActive: true, cnpj: null });
    });

    it('semCnpj=0 nao filtra e inativos=1 remove isActive das contagens', async () => {
      const cookie = await loginAs('viewer');

      await call('get', '/clients?semCnpj=0&inativos=1', cookie);

      expect(prismaMock.indentClient.findMany.mock.calls[0][0].where).toEqual({});
      const wheres = prismaMock.indentClient.count.mock.calls.map((c) => c[0].where);
      expect(wheres).toEqual([{}, {}, { cnpj: null }]);
    });

    it('cliente sem CNPJ volta na lista com cnpj null', async () => {
      prismaMock.indentClient.findMany.mockResolvedValue([clientRow({ cnpj: null })]);
      const cookie = await loginAs('viewer');

      const res = await call('get', '/clients', cookie);

      expect(res.body.data[0].cnpj).toBeNull();
    });
  });

  describe('IQ Indent H0 - atualizar CNPJ', () => {
    it.each([null, '', '   '])('remover CNPJ gravado (%j) -> 400 sem gravar', async (cnpj) => {
      const cookie = await loginAs('comprador');

      const res = await call('put', '/clients/3', cookie, { cnpj });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('O CNPJ não pode ser removido.');
      expect(tx.indentClient.update).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('completar o CNPJ de cliente pendente -> 200 grava so digitos e audita antes/depois', async () => {
      const cookie = await loginAs('gestor');
      tx.indentClient.findUnique.mockResolvedValue(clientRow({ cnpj: null }));

      const res = await call('put', '/clients/3', cookie, { cnpj: VALID_CNPJ, city: 'Itajaí' });

      expect(res.status).toBe(200);
      expect(tx.indentClient.update.mock.calls[0][0].data).toEqual({ cnpj: '11222333000181', city: 'Itajaí' });
      const audit = tx.auditLog.create.mock.calls[0][0].data;
      expect(audit.beforeData).toMatchObject({ cnpj: null });
      expect(audit.afterData).toMatchObject({ cnpj: '11222333000181' });
    });

    it('cnpj null em cliente que ja esta pendente nao e erro e nao escreve a coluna', async () => {
      const cookie = await loginAs('comprador');
      tx.indentClient.findUnique.mockResolvedValue(clientRow({ cnpj: null }));

      const res = await call('put', '/clients/3', cookie, { cnpj: null, city: 'Joinville' });

      expect(res.status).toBe(200);
      expect(tx.indentClient.update.mock.calls[0][0].data).toEqual({ city: 'Joinville' });
    });

    it('sem a chave cnpj o CNPJ gravado fica intacto; CNPJ novo duplicado -> 409; invalido -> 400', async () => {
      const cookie = await loginAs('comprador');

      await call('put', '/clients/3', cookie, { city: 'Y' });
      expect(tx.indentClient.update.mock.calls[0][0].data).toEqual({ city: 'Y' });

      tx.indentClient.update.mockRejectedValueOnce(uniqueError(['cnpj']));
      const dup = await call('put', '/clients/3', cookie, { cnpj: '45.997.418/0001-53' });
      expect(dup.status).toBe(409);
      expect(dup.body.message).toBe('Já existe um cliente com este CNPJ.');

      const invalido = await call('put', '/clients/3', cookie, { cnpj: '11.222.333/0001-82' });
      expect(invalido.status).toBe(400);
      expect(invalido.body.message).toBe('CNPJ inválido.');
    });
  });

  describe('trava e checagem de nome (create e renomeacao sem CNPJ)', () => {
    const lockKey = (call: unknown[]) => call[1];

    it('create sem CNPJ: a trava advisory (chave = nome normalizado) e a 1a instrucao, antes da consulta e do insert', async () => {
      const cookie = await loginAs('comprador');

      const res = await call('post', '/clients', cookie, { name: '  Cliente   PÊNDENTE ' });

      expect(res.status).toBe(201);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const [strings, key] = tx.$executeRaw.mock.calls[0] as [string[], string];
      expect(strings.join('?')).toContain('pg_advisory_xact_lock(hashtext(');
      expect(key).toBe('indent_client_sem_cnpj:cliente pendente');
      const ordem = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0] as number;
      expect(ordem(tx.$executeRaw)).toBeLessThan(ordem(tx.indentClient.findMany));
      expect(ordem(tx.indentClient.findMany)).toBeLessThan(ordem(tx.indentClient.create));
    });

    it('create com CNPJ nao toma a trava nem consulta nomes', async () => {
      const cookie = await loginAs('comprador');

      await call('post', '/clients', cookie, { name: 'Cliente Pendente', cnpj: VALID_CNPJ });

      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.indentClient.findMany).not.toHaveBeenCalled();
    });

    it('renomear cliente sem CNPJ para o nome de OUTRO sem CNPJ -> 409 (compara fora o proprio id), sem gravar', async () => {
      const cookie = await loginAs('comprador');
      tx.indentClient.findUnique.mockResolvedValue(clientRow({ cnpj: null }));
      tx.indentClient.findMany.mockResolvedValue([{ name: 'Outro Pendente' }]);

      const res = await call('put', '/clients/3', cookie, { name: ' OUTRO  pêndente ' });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Já existe um cliente sem CNPJ com este nome.');
      expect(tx.indentClient.findMany).toHaveBeenCalledWith({ where: { cnpj: null, id: { not: 3 } }, select: { name: true } });
      expect(lockKey(tx.$executeRaw.mock.calls[0] as unknown[])).toBe('indent_client_sem_cnpj:outro pendente');
      expect(tx.indentClient.update).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('renomear cliente sem CNPJ para nome livre -> 200 e toma a trava', async () => {
      const cookie = await loginAs('gestor');
      tx.indentClient.findUnique.mockResolvedValue(clientRow({ cnpj: null }));

      const res = await call('put', '/clients/3', cookie, { name: 'Nome Novo' });

      expect(res.status).toBe(200);
      expect(tx.indentClient.update.mock.calls[0][0].data).toEqual({ name: 'Nome Novo' });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['cliente que ja tem CNPJ', { cnpj: '11222333000181' }, { name: 'Nome Novo' }],
      ['renomear e completar o CNPJ no mesmo PUT', { cnpj: null }, { name: 'Nome Novo', cnpj: VALID_CNPJ }],
      ['PUT sem nome', { cnpj: null }, { city: 'Joinville' }],
    ])('%s: sem trava e sem consulta de nome', async (_caso, before, body) => {
      const cookie = await loginAs('gestor');
      tx.indentClient.findUnique.mockResolvedValue(clientRow(before));

      const res = await call('put', '/clients/3', cookie, body);

      expect(res.status).toBe(200);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.indentClient.findMany).not.toHaveBeenCalled();
    });
  });
});
