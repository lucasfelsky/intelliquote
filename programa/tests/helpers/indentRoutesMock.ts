import { Prisma } from '@prisma/client';
import request from 'supertest';
import { expect, vi } from 'vitest';
import { hashPassword } from '../../src/utils/password';
import { todayKeyInSaoPaulo } from '../../src/utils/supplierDocumentDates';

// Mock compartilhado dos testes de rota do IQ Indent (clientes, fornecedores, produtos, importacao e solicitacoes).
// Cada arquivo de teste declara, no topo:
//   vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
// e chama `beforeEach(resetIndentMocks)`.
// ATENCAO: este modulo NAO importa `src/app` nem `src/lib/prisma` de forma estatica (o vi.mock carrega este arquivo
// enquanto resolve o prisma: um import estatico viraria ciclo). O `app` entra por import dinamico em `call`/`loginAs`.

export type Mock = ReturnType<typeof vi.fn>;

export interface SourceMock {
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

// Delegates de ORIGEM do IntelliQuote (Supplier/SupplierContact/CatalogItem): so leitura. As fns de
// escrita existem apenas como espioes para provar que a importacao nunca escreve neles.
const readOnlySource = (): SourceMock => ({
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
  indentSequence: { findUnique: vi.fn() },
  indentRequest: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  indentRequestItem: { updateMany: vi.fn() },
  indentQuote: { create: vi.fn(), createMany: vi.fn() },
  indentQuoteItem: { createMany: vi.fn() },
  supplier: readOnlySource(),
  supplierContact: readOnlySource(),
  catalogItem: readOnlySource(),
  auditLog: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
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
  indentRequest: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  supplier: readOnlySource(),
  supplierContact: readOnlySource(),
  catalogItem: readOnlySource(),
  quoteRequest: {},
  quoteResponse: {},
  $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  __tx: tx,
};

export const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
  indentClient: { findMany: Mock; count: Mock };
  indentSupplier: { findMany: Mock; count: Mock };
  indentProduct: { findMany: Mock; count: Mock };
  indentClientSupplierRule: { findMany: Mock };
  indentRequest: { findUnique: Mock; findMany: Mock; count: Mock };
  supplier: SourceMock;
  supplierContact: SourceMock;
  catalogItem: SourceMock;
  $transaction: Mock;
  $queryRaw: Mock;
  $executeRaw: Mock;
  __tx: typeof tx;
};

export { tx };

/** Fabrica do `vi.mock('../src/lib/prisma', ...)`. */
export function createIndentPrismaModule() {
  return { prisma };
}

export const now = new Date('2026-11-12T12:00:00.000Z');

export function clientRow(overrides: Record<string, unknown> = {}) {
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

export function supplierRow(overrides: Record<string, unknown> = {}) {
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

export function productRow(overrides: Record<string, unknown> = {}) {
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

export async function getApp() {
  return (await import('../../src/app')).app;
}

export async function loginAs(role: string): Promise<string> {
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
  const app = await getApp();
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

export type Method = 'get' | 'post' | 'put';

export async function call(method: Method, path: string, cookie: string, body?: unknown) {
  const app = await getApp();
  const req = request(app)[method](`/api/v1/indent${path}`).set('Cookie', cookie);
  return method === 'get' ? req : req.send((body ?? {}) as object);
}

export function auditActions(): string[] {
  return tx.auditLog.create.mock.calls.map(
    (c) => (c[0] as { data: { action: string } }).data.action,
  );
}

export function auditCall(action: string) {
  const found = tx.auditLog.create.mock.calls.find(
    (c) => (c[0] as { data: { action: string } }).data.action === action,
  );
  return (found?.[0] as { data: Record<string, unknown> } | undefined)?.data;
}

export function uniqueError(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

export function expectNoWrites() {
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

/** `beforeEach` comum a todos os arquivos de teste de rota do Indent. */
export function resetIndentMocks() {
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
}

// ---- Solicitacoes do Indent (PR 2): fixtures e defaults dos mocks novos ----
export const YEAR = Number(todayKeyInSaoPaulo(new Date()).slice(0, 4));
export const YY = String(YEAR % 100).padStart(2, '0');
export const NUMBER_277 = `277/${YY}`;

export function itemRow(id: number, productId: number | null, overrides: Record<string, unknown> = {}) {
  return {
    id,
    requestId: 11,
    position: id - 21,
    description: productId === 2 ? 'Zinco' : 'Ácido cítrico',
    productId,
    quantityKg: '25000',
    confirmed: true,
    product:
      productId === null
        ? null
        : { id: productId, name: productId === 2 ? 'Zinco' : 'Ácido cítrico', cas: '7440-66-6', origin: 'CADASTRADO' },
    ...overrides,
  };
}

// Serve o detalhe, as opcoes de fornecedor e o `generate` (todos leem o mesmo formato basico).
export function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    processNumber: NUMBER_277,
    processYear: YEAR,
    processSeq: 277,
    origin: 'IQ_INDENT',
    pipedriveDealId: null,
    dealTitle: null,
    dealType: null,
    rawNote: null,
    ownerName: 'comprador',
    createdByName: 'comprador',
    status: 'NOVA',
    clientId: 3,
    createdAt: now,
    stageEnteredAt: now,
    statusChangedAt: now,
    client: {
      id: 3,
      name: 'Cliente Exemplo Ltda',
      cnpj: '11222333000181',
      city: 'Itajaí',
      pipedriveOrgId: null,
      supplierRuleMode: 'LIVRE',
      ruleReason: null,
      supplierRules: [] as Array<{ supplierId: number; supplier: { name: string } }>,
    },
    items: [itemRow(21, 2), itemRow(22, 4)],
    quotes: [] as Array<Record<string, unknown>>,
    ...overrides,
  };
}

export function restrictedClient(mode: 'APROVADOS' | 'BLOQUEIO', supplierIds: number[]) {
  return {
    id: 3,
    name: 'Cliente Exemplo Ltda',
    cnpj: '11222333000181',
    city: 'Itajaí',
    pipedriveOrgId: null,
    supplierRuleMode: mode,
    ruleReason: 'Política interna',
    supplierRules: supplierIds.map((supplierId) => ({ supplierId, supplier: { name: `Fornecedor ${supplierId}` } })),
  };
}

export function genSupplier(id: number, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    isActive: true,
    defaultCurrency: 'USD',
    defaultIncoterm: 'CFR',
    ...overrides,
  };
}

export function optionSupplier(id: number, name: string, productIds: number[], overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    country: 'China',
    type: 'TRADING',
    hasPartnership: false,
    defaultCurrency: 'USD',
    defaultIncoterm: 'CFR',
    products: productIds.map((productId) => ({ productId })),
    ...overrides,
  };
}

export function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    processNumber: NUMBER_277,
    createdAt: now,
    stageEnteredAt: now,
    origin: 'IQ_INDENT',
    pipedriveDealId: null,
    ownerName: 'comprador',
    status: 'NOVA',
    clientId: 3,
    client: { id: 3, name: 'Cliente Exemplo Ltda', city: 'Itajaí', supplierRuleMode: 'LIVRE' },
    items: [
      { description: 'zinco', quantityKg: '25000', product: { name: 'Zinco' } },
      { description: 'Item livre X', quantityKg: '500.5', product: null },
    ],
    quotes: [] as Array<{ status: string }>,
    ...overrides,
  };
}

/** `beforeEach` dos testes de solicitacao: os defaults do Indent + os dos delegates novos. */
export function resetRequestMocks() {
  resetIndentMocks();

  resetIndentMocks();

  prismaMock.indentRequest.findMany.mockResolvedValue([]);
  prismaMock.indentRequest.count.mockResolvedValue(0);
  prismaMock.indentRequest.findUnique.mockResolvedValue(requestRow());
  prismaMock.indentSupplier.findMany.mockResolvedValue([optionSupplier(5, 'Acme Chemicals', [2])]);

  tx.$queryRaw.mockResolvedValue([{ lastNumber: 276 }]);
  tx.$executeRaw.mockResolvedValue(1);
  tx.indentRequest.aggregate.mockResolvedValue({ _max: { processSeq: null } });
  tx.indentRequest.create.mockResolvedValue(requestRow());
  tx.indentRequest.update.mockResolvedValue({});
  tx.indentRequest.findUnique.mockResolvedValue(requestRow());
  tx.indentRequestItem.updateMany.mockResolvedValue({ count: 1 });
  tx.indentClient.findUnique.mockResolvedValue(clientRow());
  tx.indentProduct.findMany.mockResolvedValue([{ id: 2, isActive: true }]);
  tx.indentProduct.create.mockResolvedValue(productRow({ id: 31, origin: 'LIVRE' }));
  tx.indentSupplier.findMany.mockResolvedValue([genSupplier(5, 'Acme Chemicals'), genSupplier(6, 'Beta Corp')]);
  tx.indentQuote.create.mockImplementation(({ data }: { data: { supplierId: number } }) =>
    Promise.resolve({ id: 100 + data.supplierId }),
  );
}

// ---- Casos compartilhados dos testes de solicitacao ----
export const VALID_BODY = { clientId: 3, items: [{ productId: 2, description: 'Zinco', quantityKg: 25000 }] };

export const ENDPOINTS: Array<{ method: Method; path: string; body?: unknown; leitura: boolean }> = [
  { method: 'get', path: '/requests', leitura: true },
  { method: 'get', path: '/requests/new-count', leitura: true },
  { method: 'get', path: '/requests/client-options', leitura: true },
  { method: 'get', path: '/requests/11', leitura: true },
  { method: 'get', path: '/requests/11/supplier-options', leitura: true },
  { method: 'post', path: '/requests', body: VALID_BODY, leitura: false },
  { method: 'post', path: '/requests/11/items/confirm', body: { itemIds: [21] }, leitura: false },
  { method: 'post', path: '/requests/11/quotes', body: { suppliers: [{ supplierId: 5 }] }, leitura: false },
];

export function expectNoRequestWrites() {
  expect(tx.auditLog.create).not.toHaveBeenCalled();
  expect(tx.indentRequest.create).not.toHaveBeenCalled();
  expect(tx.indentRequest.update).not.toHaveBeenCalled();
  expect(tx.indentRequestItem.updateMany).not.toHaveBeenCalled();
  expect(tx.indentQuote.create).not.toHaveBeenCalled();
  expect(tx.indentProduct.create).not.toHaveBeenCalled();
}
