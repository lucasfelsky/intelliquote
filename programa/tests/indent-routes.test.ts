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
