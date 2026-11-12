import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  // Delegates de ORIGEM do IntelliQuote (Supplier/SupplierContact/CatalogItem): so leitura. As fns de
  // escrita existem apenas como espioes para provar que a importacao nunca escreve neles.
  const readOnlySource = () => ({
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  });
  const tx = {
    indentClient: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    indentClientSupplierRule: { deleteMany: vi.fn(), createMany: vi.fn() },
    indentSupplier: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      createManyAndReturn: vi.fn(),
    },
    indentProduct: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      createManyAndReturn: vi.fn(),
    },
    indentSupplierProduct: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    supplier: readOnlySource(),
    supplierContact: readOnlySource(),
    catalogItem: readOnlySource(),
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    indentClient: { findMany: vi.fn(), count: vi.fn() },
    indentSupplier: { findMany: vi.fn(), count: vi.fn() },
    indentProduct: { findMany: vi.fn(), count: vi.fn() },
    indentClientSupplierRule: { findMany: vi.fn() },
    supplier: readOnlySource(),
    supplierContact: readOnlySource(),
    catalogItem: readOnlySource(),
    quoteRequest: {},
    quoteResponse: {},
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    __tx: tx,
  };
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Mock = ReturnType<typeof vi.fn>;

interface SourceMock {
  findMany: Mock;
  count: Mock;
  create: Mock;
  createMany: Mock;
  update: Mock;
  updateMany: Mock;
  delete: Mock;
  deleteMany: Mock;
  upsert: Mock;
}

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
  indentClient: { findMany: Mock; count: Mock };
  indentSupplier: { findMany: Mock; count: Mock };
  indentProduct: { findMany: Mock; count: Mock };
  indentClientSupplierRule: { findMany: Mock };
  supplier: SourceMock;
  supplierContact: SourceMock;
  catalogItem: SourceMock;
  __tx: {
    indentClient: { findUnique: Mock; create: Mock; update: Mock };
    indentClientSupplierRule: { deleteMany: Mock; createMany: Mock };
    indentSupplier: {
      findUnique: Mock;
      findMany: Mock;
      count: Mock;
      create: Mock;
      update: Mock;
      createManyAndReturn: Mock;
    };
    indentProduct: {
      findUnique: Mock;
      findMany: Mock;
      count: Mock;
      create: Mock;
      update: Mock;
      createManyAndReturn: Mock;
    };
    indentSupplierProduct: { findMany: Mock; deleteMany: Mock; createMany: Mock };
    supplier: SourceMock;
    supplierContact: SourceMock;
    catalogItem: SourceMock;
    auditLog: { create: Mock };
  };
};

const tx = prismaMock.__tx;
const now = new Date('2026-11-12T12:00:00.000Z');

function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    name: 'Cliente Exemplo Ltda',
    cnpj: '11222333000181',
    city: 'Itajaí',
    ownerName: null,
    pipedriveOrgId: null,
    supplierRuleMode: 'LIVRE',
    ruleReason: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    supplierRules: [] as Array<{ supplierId: number; supplier: { name: string } }>,
    ...overrides,
  };
}

function supplierRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    name: 'Acme Chemicals',
    nameKey: 'acme chemicals',
    country: 'China',
    contactName: null,
    type: 'TRADING',
    defaultCurrency: 'USD',
    defaultIncoterm: 'CFR',
    hasPartnership: false,
    importedFromIq: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    products: [
      { product: { id: 2, name: 'Zinco', isActive: true } },
      { product: { id: 1, name: 'Ácido cítrico', isActive: false } },
    ],
    ...overrides,
  };
}

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    name: 'Zinco',
    nameKey: 'zinco',
    acronym: null,
    manufacturer: null,
    cas: null,
    unit: 'kg',
    synonyms: [] as string[],
    notes: null,
    origin: 'LIVRE',
    sourceRequestNumber: '270/26',
    importedFromIq: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// O login tem rate limit: faz 1 login real por papel e reaproveita o cookie nos demais testes.
const cookieCache = new Map<string, string>();

async function loginAs(role: string): Promise<string> {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 7,
    name: role,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  };
  prismaMock.user.findUnique.mockResolvedValue(user);
  prismaMock.user.findFirst.mockResolvedValue(user);
  prismaMock.session.create.mockImplementation(({ data }: { data: { id: string } }) =>
    Promise.resolve({ id: data.id }),
  );
  const cached = cookieCache.get(role);
  if (cached) return cached;
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'ChangeMe123!' });
  if (res.status !== 200) throw new Error(`login ${role} falhou: ${res.status}`);
  const cookie = ((res.headers['set-cookie'] as string[]) ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  cookieCache.set(role, cookie);
  return cookie;
}

type Method = 'get' | 'post' | 'put';

function call(method: Method, path: string, cookie: string, body?: unknown) {
  const req = request(app)[method](`/api/v1/indent${path}`).set('Cookie', cookie);
  return method === 'get' ? req : req.send((body ?? {}) as object);
}

function auditActions(): string[] {
  return tx.auditLog.create.mock.calls.map(
    (c) => (c[0] as { data: { action: string } }).data.action,
  );
}

function auditCall(action: string) {
  const found = tx.auditLog.create.mock.calls.find(
    (c) => (c[0] as { data: { action: string } }).data.action === action,
  );
  return (found?.[0] as { data: Record<string, unknown> } | undefined)?.data;
}

function uniqueError(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

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

function expectNoWrites() {
  expect(tx.auditLog.create).not.toHaveBeenCalled();
  expect(tx.indentClient.create).not.toHaveBeenCalled();
  expect(tx.indentClient.update).not.toHaveBeenCalled();
  expect(tx.indentSupplier.create).not.toHaveBeenCalled();
  expect(tx.indentSupplier.update).not.toHaveBeenCalled();
  expect(tx.indentProduct.create).not.toHaveBeenCalled();
  expect(tx.indentProduct.update).not.toHaveBeenCalled();
  expect(tx.indentClientSupplierRule.deleteMany).not.toHaveBeenCalled();
  expect(tx.indentSupplierProduct.deleteMany).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();

  tx.auditLog.create.mockResolvedValue({});
  tx.indentClient.findUnique.mockResolvedValue(clientRow());
  tx.indentClient.create.mockResolvedValue(clientRow());
  tx.indentClient.update.mockResolvedValue(clientRow());
  tx.indentClientSupplierRule.deleteMany.mockResolvedValue({ count: 0 });
  tx.indentClientSupplierRule.createMany.mockResolvedValue({ count: 0 });
  tx.indentSupplier.findUnique.mockResolvedValue(supplierRow());
  tx.indentSupplier.findMany.mockResolvedValue([]);
  tx.indentSupplier.count.mockResolvedValue(0);
  tx.indentSupplier.create.mockResolvedValue(supplierRow());
  tx.indentSupplier.update.mockResolvedValue(supplierRow());
  tx.indentSupplier.createManyAndReturn.mockResolvedValue([]);
  tx.indentProduct.findUnique.mockResolvedValue(productRow());
  tx.indentProduct.findMany.mockResolvedValue([]);
  tx.indentProduct.count.mockResolvedValue(0);
  tx.indentProduct.create.mockResolvedValue(productRow({ origin: 'CADASTRADO' }));
  tx.indentProduct.update.mockResolvedValue(productRow());
  tx.indentProduct.createManyAndReturn.mockResolvedValue([]);
  tx.indentSupplierProduct.findMany.mockResolvedValue([]);
  tx.indentSupplierProduct.deleteMany.mockResolvedValue({ count: 0 });
  tx.indentSupplierProduct.createMany.mockResolvedValue({ count: 0 });
  tx.supplier.findMany.mockResolvedValue([]);
  tx.catalogItem.findMany.mockResolvedValue([]);

  prismaMock.indentClient.findMany.mockResolvedValue([clientRow()]);
  prismaMock.indentClient.count.mockResolvedValue(1);
  prismaMock.indentSupplier.findMany.mockResolvedValue([supplierRow()]);
  prismaMock.indentSupplier.count.mockResolvedValue(1);
  prismaMock.indentProduct.findMany.mockResolvedValue([]);
  prismaMock.indentProduct.count.mockResolvedValue(0);
  prismaMock.indentClientSupplierRule.findMany.mockResolvedValue([]);
  prismaMock.supplier.findMany.mockResolvedValue([]);
  prismaMock.supplier.count.mockResolvedValue(0);
  prismaMock.catalogItem.findMany.mockResolvedValue([]);
  prismaMock.catalogItem.count.mockResolvedValue(0);
});

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

describe('/api/v1/indent - fornecedores', () => {
  it('GET /suppliers traz products [{id, name, isActive}] (inclusive inativos, por nome) e os contadores de clientes', async () => {
    prismaMock.indentClientSupplierRule.findMany.mockResolvedValue([
      { supplierId: 5, client: { supplierRuleMode: 'APROVADOS' } },
      { supplierId: 5, client: { supplierRuleMode: 'APROVADOS' } },
      { supplierId: 5, client: { supplierRuleMode: 'BLOQUEIO' } },
    ]);
    const cookie = await loginAs('viewer');

    const res = await call('get', '/suppliers', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data[0].products).toEqual([
      { id: 1, name: 'Ácido cítrico', isActive: false },
      { id: 2, name: 'Zinco', isActive: true },
    ]);
    expect(res.body.data[0]).toMatchObject({ approvedBy: 2, blockedBy: 1 });
    expect(prismaMock.indentSupplier.findMany.mock.calls[0][0].where).toEqual({ isActive: true });
    expect(prismaMock.indentClientSupplierRule.findMany.mock.calls[0][0].where).toMatchObject({
      client: { isActive: true, supplierRuleMode: { in: ['APROVADOS', 'BLOQUEIO'] } },
    });
  });

  it('GET /suppliers/options lista so ativos (id, name, country)', async () => {
    prismaMock.indentSupplier.findMany.mockResolvedValue([{ id: 5, name: 'Acme', country: 'China' }]);
    const cookie = await loginAs('viewer');

    const res = await call('get', '/suppliers/options', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 5, name: 'Acme', country: 'China' }]);
    expect(prismaMock.indentSupplier.findMany.mock.calls[0][0]).toMatchObject({
      where: { isActive: true },
      take: 1000,
    });
  });

  it('POST /suppliers calcula nameKey, usa os padroes do mock e audita', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/suppliers', cookie, { name: '  Acme   Chemicals ', country: 'China' });

    expect(res.status).toBe(201);
    expect(tx.indentSupplier.create.mock.calls[0][0].data).toMatchObject({
      name: 'Acme Chemicals',
      nameKey: 'acme chemicals',
      country: 'China',
      type: 'TRADING',
      defaultCurrency: 'USD',
      defaultIncoterm: 'CFR',
      hasPartnership: false,
    });
    expect(auditActions()).toEqual(['indent_supplier.created']);
    expect(tx.indentSupplierProduct.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ['sem razao social', {}, 'Informe a razão social.'],
    ['razao social em branco', { name: '   ' }, 'Informe a razão social.'],
    ['moeda invalida', { name: 'X', defaultCurrency: 'BRL' }, 'Moeda inválida.'],
    ['incoterm invalido', { name: 'X', defaultIncoterm: 'EXW' }, 'Incoterm inválido.'],
    ['tipo invalido', { name: 'X', type: 'OUTRO' }, 'Tipo de fornecedor inválido.'],
  ])('POST /suppliers: %s -> 400', async (_motivo, body, message) => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/suppliers', cookie, body);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
    expect(tx.indentSupplier.create).not.toHaveBeenCalled();
  });

  it('P2002 no fornecedor (nameKey) -> 409', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplier.create.mockRejectedValueOnce(uniqueError(['nameKey']));

    const res = await call('post', '/suppliers', cookie, { name: 'Acme Chemicals' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe um fornecedor com este nome no Indent.');
  });

  it('PUT /suppliers/:id recalcula nameKey quando o nome muda e devolve 404 se nao existe', async () => {
    const cookie = await loginAs('gestor');

    const ok = await call('put', '/suppliers/5', cookie, { name: 'Ácido  Cítrico Trading' });
    expect(ok.status).toBe(200);
    expect(tx.indentSupplier.update.mock.calls[0][0].data).toMatchObject({
      name: 'Ácido Cítrico Trading',
      nameKey: 'acido citrico trading',
    });

    tx.indentSupplier.findUnique.mockResolvedValue(null);
    const missing = await call('put', '/suppliers/99', cookie, { country: 'X' });
    expect(missing.status).toBe(404);
  });

  it('parceria: log partnership_changed so quando o flag muda', async () => {
    const cookie = await loginAs('comprador');

    tx.indentSupplier.update.mockResolvedValue(supplierRow({ hasPartnership: true }));
    const muda = await call('put', '/suppliers/5', cookie, { hasPartnership: true });
    expect(muda.status).toBe(200);
    expect(auditActions()).toEqual(['indent_supplier.updated', 'indent_supplier.partnership_changed']);
    expect(auditCall('indent_supplier.partnership_changed')).toMatchObject({
      beforeData: { hasPartnership: false },
      afterData: { hasPartnership: true },
    });

    vi.clearAllMocks();
    tx.auditLog.create.mockResolvedValue({});
    tx.indentSupplier.findUnique.mockResolvedValue(supplierRow());
    tx.indentSupplier.update.mockResolvedValue(supplierRow());
    const igual = await call('put', '/suppliers/5', cookie, { hasPartnership: false, country: 'Índia' });
    expect(igual.status).toBe(200);
    expect(auditActions()).toEqual(['indent_supplier.updated']);
  });
});

describe('/api/v1/indent - vinculo fornecedor x produtos', () => {
  it('PUT /suppliers/:id/products substitui o conjunto na mesma transacao e loga before/after ordenados', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(2);
    tx.indentSupplierProduct.findMany.mockResolvedValue([{ productId: 1 }]);

    const res = await call('put', '/suppliers/5/products', cookie, { productIds: [3, 1, 3] });

    expect(res.status).toBe(200);
    expect(tx.indentProduct.count.mock.calls[0][0].where).toEqual({ id: { in: [3, 1] } });
    expect(tx.indentSupplierProduct.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 5 } });
    expect(tx.indentSupplierProduct.createMany).toHaveBeenCalledWith({
      data: [
        { supplierId: 5, productId: 1 },
        { supplierId: 5, productId: 3 },
      ],
      skipDuplicates: true,
    });
    expect(
      tx.indentSupplierProduct.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.indentSupplierProduct.createMany.mock.invocationCallOrder[0] as number);
    expect(auditActions()).toEqual(['indent_supplier.products_updated']);
    expect(auditCall('indent_supplier.products_updated')).toMatchObject({
      entityType: 'indent_supplier',
      entityId: '5',
      performedById: 7,
      beforeData: { productIds: [1] },
      afterData: { productIds: [1, 3] },
    });
    expect(res.body.products).toEqual([
      { id: 1, name: 'Ácido cítrico', isActive: false },
      { id: 2, name: 'Zinco', isActive: true },
    ]);
  });

  it('conjunto igual ao atual: nenhuma escrita e nenhum log', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(2);
    tx.indentSupplierProduct.findMany.mockResolvedValue([{ productId: 3 }, { productId: 1 }]);

    const res = await call('put', '/suppliers/5/products', cookie, { productIds: [1, 3] });

    expect(res.status).toBe(200);
    expect(tx.indentSupplierProduct.deleteMany).not.toHaveBeenCalled();
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('lista vazia remove todos os vinculos (valido), sem createMany', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplierProduct.findMany.mockResolvedValue([{ productId: 1 }]);

    const res = await call('put', '/suppliers/5/products', cookie, { productIds: [] });

    expect(res.status).toBe(200);
    expect(tx.indentProduct.count).not.toHaveBeenCalled();
    expect(tx.indentSupplierProduct.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 5 } });
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
    expect(auditCall('indent_supplier.products_updated')).toMatchObject({
      beforeData: { productIds: [1] },
      afterData: { productIds: [] },
    });
  });

  it('produto inexistente -> 400 e NADA e gravado', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(1);

    const res = await call('put', '/suppliers/5/products', cookie, { productIds: [1, 999] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Produto inexistente na lista.');
    expect(tx.indentSupplierProduct.deleteMany).not.toHaveBeenCalled();
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('1001 produtos -> 400; productIds obrigatorio na rota dedicada; fornecedor inexistente -> 404', async () => {
    const cookie = await loginAs('comprador');

    const demais = await call('put', '/suppliers/5/products', cookie, {
      productIds: Array.from({ length: 1001 }, (_, i) => i + 1),
    });
    expect(demais.status).toBe(400);

    const semCampo = await call('put', '/suppliers/5/products', cookie, {});
    expect(semCampo.status).toBe(400);

    tx.indentSupplier.findUnique.mockResolvedValue(null);
    const missing = await call('put', '/suppliers/99/products', cookie, { productIds: [1] });
    expect(missing.status).toBe(404);
    expect(tx.indentSupplierProduct.deleteMany).not.toHaveBeenCalled();
  });

  it('POST /suppliers com productIds cria fornecedor e vinculos na MESMA transacao', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(2);

    const res = await call('post', '/suppliers', cookie, { name: 'Acme Chemicals', productIds: [1, 2] });

    expect(res.status).toBe(201);
    expect(prismaMock.__tx).toBe(tx);
    expect(tx.indentSupplier.create).toHaveBeenCalledTimes(1);
    expect(tx.indentSupplierProduct.createMany).toHaveBeenCalledWith({
      data: [
        { supplierId: 5, productId: 1 },
        { supplierId: 5, productId: 2 },
      ],
      skipDuplicates: true,
    });
    expect(tx.indentSupplier.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.indentSupplierProduct.createMany.mock.invocationCallOrder[0] as number,
    );
    expect(auditActions()).toEqual(['indent_supplier.created', 'indent_supplier.products_updated']);
  });

  it('POST /suppliers com produto inexistente falha na mesma transacao (400, sem vinculo)', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(0);

    const res = await call('post', '/suppliers', cookie, { name: 'Acme Chemicals', productIds: [999] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Produto inexistente na lista.');
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
  });

  it('PUT /suppliers/:id SEM productIds nao toca em indentSupplierProduct', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('put', '/suppliers/5', cookie, { country: 'Índia' });

    expect(res.status).toBe(200);
    expect(tx.indentSupplierProduct.findMany).not.toHaveBeenCalled();
    expect(tx.indentSupplierProduct.deleteMany).not.toHaveBeenCalled();
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
    expect(tx.indentProduct.count).not.toHaveBeenCalled();
  });

  it('PUT /suppliers/:id COM productIds aplica o vinculo na mesma transacao', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(1);

    const res = await call('put', '/suppliers/5', cookie, { country: 'Índia', productIds: [4] });

    expect(res.status).toBe(200);
    expect(tx.indentSupplierProduct.createMany).toHaveBeenCalledWith({
      data: [{ supplierId: 5, productId: 4 }],
      skipDuplicates: true,
    });
    expect(auditActions()).toEqual(['indent_supplier.updated', 'indent_supplier.products_updated']);
  });
});

describe('/api/v1/indent - produtos do catalogo', () => {
  it('GET /products traz supplierCount (so fornecedores ativos) e counts sobre os ativos', async () => {
    prismaMock.indentProduct.findMany.mockResolvedValue([{ ...productRow(), _count: { suppliers: 2 } }]);
    prismaMock.indentProduct.count.mockImplementation(({ where }: { where: { origin?: string } }) =>
      Promise.resolve(where.origin === 'LIVRE' ? 1 : where.origin === 'CADASTRADO' ? 4 : 5),
    );
    const cookie = await loginAs('viewer');

    const res = await call('get', '/products?origin=LIVRE&q=zin', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data[0].supplierCount).toBe(2);
    expect(res.body.data[0]).not.toHaveProperty('_count');
    expect(res.body.counts).toEqual({ total: 5, cadastrado: 4, livre: 1 });
    const args = prismaMock.indentProduct.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ isActive: true, origin: 'LIVRE' });
    expect(args.select._count).toEqual({
      select: { suppliers: { where: { supplier: { isActive: true } } } },
    });

    const bad = await call('get', '/products?origin=OUTRO', cookie);
    expect(bad.status).toBe(400);
  });

  it('GET /products/options traz so ativos com id, name, cas e isActive', async () => {
    prismaMock.indentProduct.findMany.mockResolvedValue([{ id: 1, name: 'Zinco', cas: null, isActive: true }]);
    const cookie = await loginAs('viewer');

    const res = await call('get', '/products/options', cookie);

    expect(res.status).toBe(200);
    expect(prismaMock.indentProduct.findMany.mock.calls[0][0]).toMatchObject({
      where: { isActive: true },
      take: 2000,
    });
  });

  it('POST /products cria CADASTRADO com nameKey, valida CAS e audita', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/products', cookie, {
      name: 'Ácido  Cítrico',
      cas: '77-92-9',
      synonyms: [' citric acid '],
    });

    expect(res.status).toBe(201);
    expect(tx.indentProduct.create.mock.calls[0][0].data).toMatchObject({
      name: 'Ácido Cítrico',
      nameKey: 'acido citrico',
      cas: '77-92-9',
      unit: 'kg',
      synonyms: ['citric acid'],
      origin: 'CADASTRADO',
    });
    expect(auditActions()).toEqual(['indent_product.created']);

    const origem = await call('post', '/products', cookie, { name: 'Outro', origin: 'LIVRE' });
    expect(origem.status).toBe(201);
    expect(tx.indentProduct.create.mock.calls[1][0].data.origin).toBe('CADASTRADO');

    const cas = await call('post', '/products', cookie, { name: 'X', cas: '7792-9' });
    expect(cas.status).toBe(400);
    expect(cas.body.message).toBe('CAS inválido.');
  });

  it('P2002 no produto (nameKey) -> 409', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.create.mockRejectedValueOnce(uniqueError(['nameKey']));

    const res = await call('post', '/products', cookie, { name: 'Zinco' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe um produto com este nome no Indent.');
  });

  it('PUT /products/:id atualiza e audita; inexistente -> 404', async () => {
    const cookie = await loginAs('gestor');
    tx.indentProduct.update.mockResolvedValue(productRow({ cas: '7440-66-6' }));

    const ok = await call('put', '/products/2', cookie, { cas: '7440-66-6', isActive: true });
    expect(ok.status).toBe(200);
    expect(auditCall('indent_product.updated')).toMatchObject({
      beforeData: expect.objectContaining({ cas: null }),
      afterData: expect.objectContaining({ cas: '7440-66-6' }),
    });

    tx.indentProduct.findUnique.mockResolvedValue(null);
    expect((await call('put', '/products/99', cookie, { notes: 'x' })).status).toBe(404);
  });

  it('POST /products/:id/promote: LIVRE -> CADASTRADO com a nota padrao so se notes era null', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.update.mockResolvedValue(productRow({ origin: 'CADASTRADO' }));

    const semNota = await call('post', '/products/2/promote', cookie);
    expect(semNota.status).toBe(200);
    expect(tx.indentProduct.update.mock.calls[0][0].data).toEqual({
      origin: 'CADASTRADO',
      notes: 'Promovido do item livre. Completar CAS e sinônimos',
    });
    expect(auditActions()).toEqual(['indent_product.promoted']);

    tx.indentProduct.findUnique.mockResolvedValue(productRow({ notes: 'Nota existente' }));
    const comNota = await call('post', '/products/2/promote', cookie);
    expect(comNota.status).toBe(200);
    expect(tx.indentProduct.update.mock.calls[1][0].data).toEqual({ origin: 'CADASTRADO' });
  });

  it('promover produto ja CADASTRADO -> 409; inexistente -> 404', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.findUnique.mockResolvedValue(productRow({ origin: 'CADASTRADO' }));

    const jaCadastrado = await call('post', '/products/2/promote', cookie);
    expect(jaCadastrado.status).toBe(409);
    expect(jaCadastrado.body.message).toBe('O produto já está no catálogo.');
    expect(tx.indentProduct.update).not.toHaveBeenCalled();

    tx.indentProduct.findUnique.mockResolvedValue(null);
    expect((await call('post', '/products/99/promote', cookie)).status).toBe(404);
  });
});

describe('/api/v1/indent - importacao do IntelliQuote (somente leitura)', () => {
  function expectSourcesUntouched() {
    for (const source of [
      prismaMock.supplier,
      prismaMock.supplierContact,
      prismaMock.catalogItem,
      tx.supplier,
      tx.supplierContact,
      tx.catalogItem,
    ]) {
      expect(source.create).not.toHaveBeenCalled();
      expect(source.createMany).not.toHaveBeenCalled();
      expect(source.update).not.toHaveBeenCalled();
      expect(source.updateMany).not.toHaveBeenCalled();
      expect(source.delete).not.toHaveBeenCalled();
      expect(source.deleteMany).not.toHaveBeenCalled();
      expect(source.upsert).not.toHaveBeenCalled();
    }
  }

  it('GET /import/suppliers filtra deletedAt null e marca alreadyInIndent pelo nameKey', async () => {
    prismaMock.supplier.findMany.mockResolvedValue([
      { id: 1, name: 'Acme Chemicals', country: 'China' },
      { id: 2, name: 'Nordic Solvents AB', country: 'Suécia' },
    ]);
    prismaMock.supplier.count.mockResolvedValue(2);
    prismaMock.indentSupplier.findMany.mockResolvedValue([{ nameKey: 'acme chemicals' }]);
    const cookie = await loginAs('comprador');

    const res = await call('get', '/import/suppliers?q=ac', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 1, name: 'Acme Chemicals', country: 'China', alreadyInIndent: true },
      { id: 2, name: 'Nordic Solvents AB', country: 'Suécia', alreadyInIndent: false },
    ]);
    expect(prismaMock.supplier.findMany.mock.calls[0][0].where).toMatchObject({ deletedAt: null });
    expectSourcesUntouched();
  });

  it('GET /import/products le so itens ativos do catalogo e marca os que ja estao no Indent', async () => {
    prismaMock.catalogItem.findMany.mockResolvedValue([
      { id: 1, commercialName: 'Ácido cítrico', marketName: 'Citric acid' },
    ]);
    prismaMock.catalogItem.count.mockResolvedValue(1);
    prismaMock.indentProduct.findMany.mockResolvedValue([{ nameKey: 'acido citrico' }]);
    const cookie = await loginAs('comprador');

    const res = await call('get', '/import/products', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 1, name: 'Ácido cítrico', marketName: 'Citric acid', alreadyInIndent: true },
    ]);
    expect(prismaMock.catalogItem.findMany.mock.calls[0][0].where).toMatchObject({ isActive: true });
    expectSourcesUntouched();
  });

  it('POST /import/suppliers copia (importedFromIq, IMPORTADO, USD, CFR), deduplica por nameKey e audita', async () => {
    tx.supplier.findMany.mockResolvedValue([
      { id: 1, name: 'Acme Chemicals', country: 'China', contacts: [{ name: 'Wei Zhang' }] },
      { id: 2, name: 'ACME  chemicals', country: null, contacts: [] },
    ]);
    tx.indentSupplier.createManyAndReturn.mockResolvedValue([{ id: 10, nameKey: 'acme chemicals' }]);
    const cookie = await loginAs('comprador');

    const res = await call('post', '/import/suppliers', cookie, { ids: [1, 2, 3, 1] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      created: 1,
      skipped: [
        { sourceId: 2, reason: 'duplicado' },
        { sourceId: 3, reason: 'nao_encontrado' },
      ],
    });
    expect(tx.supplier.findMany.mock.calls[0][0].where).toEqual({ id: { in: [1, 2, 3] }, deletedAt: null });
    expect(tx.indentSupplier.createManyAndReturn.mock.calls[0][0]).toMatchObject({
      skipDuplicates: true,
      data: [
        {
          name: 'Acme Chemicals',
          nameKey: 'acme chemicals',
          country: 'China',
          contactName: 'Wei Zhang',
          type: 'IMPORTADO',
          defaultCurrency: 'USD',
          defaultIncoterm: 'CFR',
          importedFromIq: true,
        },
      ],
    });
    expect(auditCall('indent_import.suppliers')).toMatchObject({
      entityType: 'indent_import',
      performedById: 7,
      metadata: {
        sourceIds: [1, 2, 3],
        createdIds: [10],
        skipped: [
          { sourceId: 2, reason: 'duplicado' },
          { sourceId: 3, reason: 'nao_encontrado' },
        ],
      },
    });
    expectSourcesUntouched();
  });

  it('POST /import/suppliers: ja existente no Indent -> duplicado; corrida (skipDuplicates) -> duplicado', async () => {
    tx.supplier.findMany.mockResolvedValue([
      { id: 1, name: 'Acme Chemicals', country: 'China', contacts: [] },
      { id: 2, name: 'Nordic Solvents AB', country: null, contacts: [] },
    ]);
    tx.indentSupplier.findMany.mockResolvedValue([{ nameKey: 'acme chemicals' }]);
    tx.indentSupplier.createManyAndReturn.mockResolvedValue([]);
    const cookie = await loginAs('comprador');

    const res = await call('post', '/import/suppliers', cookie, { ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      created: 0,
      skipped: [
        { sourceId: 1, reason: 'duplicado' },
        { sourceId: 2, reason: 'duplicado' },
      ],
    });
  });

  it('POST /import/products copia o nome comercial; nome de mercado diferente vira sinonimo; sem vinculo', async () => {
    tx.catalogItem.findMany.mockResolvedValue([
      { id: 1, commercialName: 'Ácido cítrico', marketName: 'Citric Acid' },
      { id: 2, commercialName: 'Soda cáustica', marketName: 'SODA CAUSTICA' },
    ]);
    tx.indentProduct.createManyAndReturn.mockResolvedValue([
      { id: 20, nameKey: 'acido citrico' },
      { id: 21, nameKey: 'soda caustica' },
    ]);
    const cookie = await loginAs('gestor');

    const res = await call('post', '/import/products', cookie, { ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: 2, skipped: [] });
    expect(tx.catalogItem.findMany.mock.calls[0][0].where).toEqual({ id: { in: [1, 2] }, isActive: true });
    expect(tx.indentProduct.createManyAndReturn.mock.calls[0][0].data).toEqual([
      {
        name: 'Ácido cítrico',
        nameKey: 'acido citrico',
        synonyms: ['Citric Acid'],
        notes: 'Copiado do IntelliQuote, sem vínculo',
        origin: 'CADASTRADO',
        importedFromIq: true,
      },
      {
        name: 'Soda cáustica',
        nameKey: 'soda caustica',
        synonyms: [],
        notes: 'Copiado do IntelliQuote, sem vínculo',
        origin: 'CADASTRADO',
        importedFromIq: true,
      },
    ]);
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(['indent_import.products']);
    expectSourcesUntouched();
  });

  it('ids vazio ou com 101 itens -> 400 e nada e lido ou gravado', async () => {
    const cookie = await loginAs('comprador');

    const vazio = await call('post', '/import/suppliers', cookie, { ids: [] });
    expect(vazio.status).toBe(400);

    const demais = await call('post', '/import/products', cookie, {
      ids: Array.from({ length: 101 }, (_, i) => i + 1),
    });
    expect(demais.status).toBe(400);

    const cem = await call('post', '/import/products', cookie, {
      ids: Array.from({ length: 100 }, (_, i) => i + 1),
    });
    expect(cem.status).toBe(200);

    expect(tx.supplier.findMany).not.toHaveBeenCalled();
  });
});
