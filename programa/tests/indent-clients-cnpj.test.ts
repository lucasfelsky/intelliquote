import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

// IQ Indent H0: CNPJ do cliente anulavel ("CNPJ pendente"). Mock do prisma enxuto: so o que /clients e o login usam.
vi.mock('../src/lib/prisma', () => {
  const tx = {
    indentClient: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    indentClient: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    __tx: tx,
  };
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Mock = ReturnType<typeof vi.fn>;

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
  indentClient: { findMany: Mock; count: Mock };
  __tx: {
    indentClient: { findUnique: Mock; findMany: Mock; create: Mock; update: Mock };
    auditLog: { create: Mock };
  };
};

const tx = prismaMock.__tx;
const now = new Date('2026-11-13T12:00:00.000Z');
const VALID_CNPJ = '11.222.333/0001-81';

function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    name: 'Cliente Exemplo Ltda',
    cnpj: '11222333000181',
    city: null,
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

// O login tem rate limit: 1 login real por papel, cookie reaproveitado.
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
  const cookie = ((res.headers['set-cookie'] as string[]) ?? []).map((c) => c.split(';')[0]).join('; ');
  cookieCache.set(role, cookie);
  return cookie;
}

function get(path: string, cookie: string) {
  return request(app).get(`/api/v1/indent${path}`).set('Cookie', cookie);
}

function post(path: string, cookie: string, body: unknown) {
  return request(app)
    .post(`/api/v1/indent${path}`)
    .set('Cookie', cookie)
    .send(body as object);
}

function put(path: string, cookie: string, body: unknown) {
  return request(app)
    .put(`/api/v1/indent${path}`)
    .set('Cookie', cookie)
    .send(body as object);
}

function uniqueError(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  tx.auditLog.create.mockResolvedValue({});
  tx.indentClient.findUnique.mockResolvedValue(clientRow());
  tx.indentClient.findMany.mockResolvedValue([]);
  tx.indentClient.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(clientRow(data)),
  );
  tx.indentClient.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(clientRow(data)),
  );
  prismaMock.indentClient.findMany.mockResolvedValue([clientRow()]);
  prismaMock.indentClient.count.mockResolvedValue(1);
});

describe('IQ Indent H0 - criar cliente sem CNPJ', () => {
  it.each([
    ['sem a chave', { name: 'Cliente Pendente' }],
    ['string vazia', { name: 'Cliente Pendente', cnpj: '' }],
    ['so espacos', { name: 'Cliente Pendente', cnpj: '   ' }],
    ['null', { name: 'Cliente Pendente', cnpj: null }],
  ])('POST /clients %s -> 201 com cnpj null, audita e confere duplicidade entre os sem CNPJ', async (_caso, body) => {
    const cookie = await loginAs('comprador');

    const res = await post('/clients', cookie, body);

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

    const res = await post('/clients', cookie, { name: 'Cliente Pendente' });

    expect(res.status).toBe(201);
    expect(tx.indentClient.create).toHaveBeenCalledTimes(1);
  });

  it.each(['Cliente Pendente', '  CLIENTE   pendente ', 'Cliente Pêndente'])(
    'mesmo nome (%s, ignorando caixa, acento e espacos) entre os sem CNPJ -> 409 sem gravar',
    async (nome) => {
      const cookie = await loginAs('gestor');
      tx.indentClient.findMany.mockResolvedValue([{ name: 'Cliente Pendente' }]);

      const res = await post('/clients', cookie, { name: nome });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Já existe um cliente sem CNPJ com este nome.');
      expect(tx.indentClient.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('com CNPJ informado a consulta por nome nao roda; o mesmo nome de um cliente com CNPJ nao conta', async () => {
    const cookie = await loginAs('comprador');

    const res = await post('/clients', cookie, { name: 'Cliente Pendente', cnpj: VALID_CNPJ });

    expect(res.status).toBe(201);
    expect(res.body.cnpj).toBe('11222333000181');
    expect(tx.indentClient.findMany).not.toHaveBeenCalled();
  });

  it('CNPJ informado duplicado -> 409 (indice unico) e CNPJ invalido -> 400', async () => {
    const cookie = await loginAs('comprador');

    tx.indentClient.create.mockRejectedValueOnce(uniqueError(['cnpj']));
    const duplicado = await post('/clients', cookie, { name: 'X', cnpj: VALID_CNPJ });
    expect(duplicado.status).toBe(409);
    expect(duplicado.body.message).toBe('Já existe um cliente com este CNPJ.');

    for (const cnpj of ['11.222.333/0001-82', 'abc', 1122233300018, '1122']) {
      const res = await post('/clients', cookie, { name: 'X', cnpj });
      expect(res.status, String(cnpj)).toBe(400);
      expect(res.body.message).toBe('CNPJ inválido.');
    }
    expect(tx.indentClient.create).toHaveBeenCalledTimes(1);
  });

  it('comercial continua 403 e viewer nao escreve', async () => {
    const comercial = await loginAs('comercial');
    expect((await post('/clients', comercial, { name: 'X' })).status).toBe(403);
    expect((await get('/clients?semCnpj=1', comercial)).status).toBe(403);

    const viewer = await loginAs('viewer');
    expect((await post('/clients', viewer, { name: 'X' })).status).toBe(403);
    expect(tx.indentClient.create).not.toHaveBeenCalled();
  });
});

describe('IQ Indent H0 - listar (semCnpj e counts)', () => {
  it('padrao: sem filtro de CNPJ e counts { todos, semCnpj } so de ativos', async () => {
    prismaMock.indentClient.count.mockResolvedValueOnce(9).mockResolvedValueOnce(9).mockResolvedValueOnce(4);
    const cookie = await loginAs('viewer');

    const res = await get('/clients', cookie);

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ todos: 9, semCnpj: 4 });
    expect(prismaMock.indentClient.findMany.mock.calls[0][0].where).toEqual({ isActive: true });
    const wheres = prismaMock.indentClient.count.mock.calls.map((c) => c[0].where);
    expect(wheres).toEqual([{ isActive: true }, { isActive: true }, { isActive: true, cnpj: null }]);
  });

  it.each(['1', 'true'])('semCnpj=%s filtra cnpj null; as contagens ignoram o chip e a busca', async (valor) => {
    const cookie = await loginAs('viewer');

    const res = await get(`/clients?semCnpj=${valor}&q=ana`, cookie);

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

    await get('/clients?semCnpj=0&inativos=1', cookie);

    expect(prismaMock.indentClient.findMany.mock.calls[0][0].where).toEqual({});
    const wheres = prismaMock.indentClient.count.mock.calls.map((c) => c[0].where);
    expect(wheres).toEqual([{}, {}, { cnpj: null }]);
  });

  it('cliente sem CNPJ volta na lista com cnpj null', async () => {
    prismaMock.indentClient.findMany.mockResolvedValue([clientRow({ cnpj: null })]);
    const cookie = await loginAs('viewer');

    const res = await get('/clients', cookie);

    expect(res.body.data[0].cnpj).toBeNull();
  });
});

describe('IQ Indent H0 - atualizar CNPJ', () => {
  it.each([null, '', '   '])('remover CNPJ gravado (%j) -> 400 sem gravar', async (cnpj) => {
    const cookie = await loginAs('comprador');

    const res = await put('/clients/3', cookie, { cnpj });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('O CNPJ não pode ser removido.');
    expect(tx.indentClient.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('completar o CNPJ de cliente pendente -> 200 grava so digitos e audita antes/depois', async () => {
    const cookie = await loginAs('gestor');
    tx.indentClient.findUnique.mockResolvedValue(clientRow({ cnpj: null }));

    const res = await put('/clients/3', cookie, { cnpj: VALID_CNPJ, city: 'Itajaí' });

    expect(res.status).toBe(200);
    expect(tx.indentClient.update.mock.calls[0][0].data).toEqual({ cnpj: '11222333000181', city: 'Itajaí' });
    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit.beforeData).toMatchObject({ cnpj: null });
    expect(audit.afterData).toMatchObject({ cnpj: '11222333000181' });
  });

  it('cnpj null em cliente que ja esta pendente nao e erro e nao escreve a coluna', async () => {
    const cookie = await loginAs('comprador');
    tx.indentClient.findUnique.mockResolvedValue(clientRow({ cnpj: null }));

    const res = await put('/clients/3', cookie, { cnpj: null, city: 'Joinville' });

    expect(res.status).toBe(200);
    expect(tx.indentClient.update.mock.calls[0][0].data).toEqual({ city: 'Joinville' });
  });

  it('sem a chave cnpj o CNPJ gravado fica intacto; CNPJ novo duplicado -> 409; invalido -> 400', async () => {
    const cookie = await loginAs('comprador');

    await put('/clients/3', cookie, { city: 'Y' });
    expect(tx.indentClient.update.mock.calls[0][0].data).toEqual({ city: 'Y' });

    tx.indentClient.update.mockRejectedValueOnce(uniqueError(['cnpj']));
    const dup = await put('/clients/3', cookie, { cnpj: '45.997.418/0001-53' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('Já existe um cliente com este CNPJ.');

    const invalido = await put('/clients/3', cookie, { cnpj: '11.222.333/0001-82' });
    expect(invalido.status).toBe(400);
    expect(invalido.body.message).toBe('CNPJ inválido.');
  });
});
