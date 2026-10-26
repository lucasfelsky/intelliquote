import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

// O arquivo faz varios logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    forecastProduct: { findUnique: vi.fn(), updateMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock; findUnique: Mock; update: Mock; updateMany: Mock };
  auditLog: { create: Mock };
  forecastProduct: { findUnique: Mock; updateMany: Mock };
  $executeRaw: Mock;
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const PATH = '/api/v1/forecast/products/5/reativar';

// Dados SINTETICOS (repo publico).
const inativo = { id: 5, name: 'PRODUTO 905', isActive: false, origin: 'planilha' };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.forecastProduct.findUnique.mockResolvedValue(inativo);
  prismaMock.forecastProduct.updateMany.mockResolvedValue({ count: 1 });
});

describe('POST /forecast/products/:id/reativar - autenticacao e papeis', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).post(PATH).send({})).status).toBe(401);
  });

  it.each(['gestor', 'viewer', 'comercial'] as Role[])('%s -> 403 sem tocar no cadastro', async (role) => {
    const cookies = await loginAs(role);
    expect((await request(app).post(PATH).set('Cookie', cookies).send({})).status).toBe(403);
    expect(prismaMock.forecastProduct.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['admin', 'comprador'] as Role[])('%s -> 200', async (role) => {
    const cookies = await loginAs(role);
    const res = await request(app).post(PATH).set('Cookie', cookies).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 5, nome: 'PRODUTO 905', ativo: true, origem: 'planilha', alterado: true });
  });

  it('sem corpo tambem vale (200)', async () => {
    const cookies = await loginAs('admin');
    expect((await request(app).post(PATH).set('Cookie', cookies)).status).toBe(200);
  });
});

describe('POST /forecast/products/:id/reativar - validacao', () => {
  it('id invalido -> 400', async () => {
    const cookies = await loginAs('admin');
    const res = await request(app).post('/api/v1/forecast/products/abc/reativar').set('Cookie', cookies).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Produto inválido.');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('corpo com campo extra -> 400 sem gravar', async () => {
    const cookies = await loginAs('admin');
    const res = await request(app).post(PATH).set('Cookie', cookies).send({ origem: 'dbcorp' });
    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.forecastProduct.updateMany).not.toHaveBeenCalled();
  });

  it('produto inexistente -> 404 sem gravar nem auditar', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(null);
    const cookies = await loginAs('admin');
    const res = await request(app).post(PATH).set('Cookie', cookies).send({});
    expect(res.status).toBe(404);
    expect(prismaMock.forecastProduct.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('POST /forecast/products/:id/reativar - efeito', () => {
  it('ja ativo -> 200 alterado:false, sem updateMany nem AuditLog', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue({ ...inativo, isActive: true });
    const cookies = await loginAs('admin');
    const res = await request(app).post(PATH).set('Cookie', cookies).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.alterado).toBe(false);
    expect(prismaMock.forecastProduct.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('corrida (outra pessoa reativou entre a leitura e a gravacao) -> 200 alterado:false, sem AuditLog', async () => {
    prismaMock.forecastProduct.updateMany.mockResolvedValue({ count: 0 });
    const cookies = await loginAs('admin');
    const res = await request(app).post(PATH).set('Cookie', cookies).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.alterado).toBe(false);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('reativa: advisory lock ANTES do updateMany condicional; so o flag isActive', async () => {
    const cookies = await loginAs('admin');
    const res = await request(app).post(PATH).set('Cookie', cookies).send({});
    expect(res.status).toBe(200);
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.$executeRaw.mock.calls[0][0].join('?')).toContain('pg_advisory_xact_lock');
    expect(prismaMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.forecastProduct.updateMany.mock.invocationCallOrder[0],
    );
    expect(prismaMock.forecastProduct.updateMany).toHaveBeenCalledWith({
      where: { id: 5, isActive: false },
      data: { isActive: true },
    });
  });

  it('AuditLog reactivate com metadata exata e sem beforeData/afterData; origem dbcorp preservada', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue({ ...inativo, origin: 'dbcorp' });
    const cookies = await loginAs('comprador');
    const res = await request(app).post(PATH).set('Cookie', cookies).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.origem).toBe('dbcorp');
    const logs = prismaMock.auditLog.create.mock.calls
      .map((c) => c[0].data)
      .filter((d: { action: string }) => d.action === 'reactivate');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ entityType: 'forecast_product', entityId: '5' });
    expect(logs[0].metadata).toEqual({ source: 'manual', origem: 'dbcorp', antes: false, depois: true });
    expect(logs[0].beforeData ?? null).toBeNull();
    expect(logs[0].afterData ?? null).toBeNull();
    expect(JSON.stringify(logs[0])).not.toContain('PRODUTO 905');
  });

  it('P2028 (cadastro ocupado por importacao) -> 503 com a mensagem de ocupado', async () => {
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('timeout', { code: 'P2028', clientVersion: 'test' }),
    );
    const cookies = await loginAs('admin');
    const res = await request(app).post(PATH).set('Cookie', cookies).send({});
    expect(res.status).toBe(503);
    expect(res.body.message).toBe('O cadastro está ocupado por uma importação. Tente novamente em instantes.');
  });
});

async function loginAs(role: Role) {
  const passwordHash = await hashPassword('ChangeMe123!');

  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  });
  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: { name: role },
  });
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: `${role}@intelliquote.local`, password: 'ChangeMe123!' });

  return loginResponse.headers['set-cookie'];
}
