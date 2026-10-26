import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';

// O arquivo faz varios logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    forecastSnapshot: { findFirst: vi.fn(), updateMany: vi.fn() },
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
  forecastSnapshot: { findFirst: Mock; updateMany: Mock };
  $executeRaw: Mock;
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const PATH = '/api/v1/forecast/snapshots/7';

// Dados SINTETICOS (repo publico).
const quinzena = {
  id: 7,
  label: '10-2',
  baseDate: dateKeyToDbDate('2026-10-15'),
  origin: 'planilha',
  half: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.forecastSnapshot.findFirst.mockResolvedValue(quinzena);
  prismaMock.forecastSnapshot.updateMany.mockResolvedValue({ count: 1 });
});

describe('DELETE /forecast/snapshots/:id - autenticacao e papeis', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).delete(PATH)).status).toBe(401);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each(['gestor', 'viewer', 'comercial'] as Role[])('%s -> 403 sem excluir nem auditar', async (role) => {
    const cookies = await loginAs(role);
    expect((await request(app).delete(PATH).set('Cookie', cookies)).status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['admin', 'comprador'] as Role[])('%s -> 200', async (role) => {
    const cookies = await loginAs(role);
    const res = await request(app).delete(PATH).set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: 7, label: '10-2', excluida: true } });
  });
});

describe('DELETE /forecast/snapshots/:id - validacao', () => {
  it.each(['abc', '0'])('id %s -> 400 sem abrir transacao', async (id) => {
    const cookies = await loginAs('admin');
    const res = await request(app).delete(`/api/v1/forecast/snapshots/${id}`).set('Cookie', cookies);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Quinzena invalida.');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('corpo com campo extra -> 400 sem abrir transacao', async () => {
    const cookies = await loginAs('admin');
    const res = await request(app).delete(PATH).set('Cookie', cookies).send({ forcar: true });
    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('corpo vazio e sem corpo -> 200', async () => {
    const cookies = await loginAs('admin');
    expect((await request(app).delete(PATH).set('Cookie', cookies).send({})).status).toBe(200);
    expect((await request(app).delete(PATH).set('Cookie', cookies)).status).toBe(200);
  });
});

describe('DELETE /forecast/snapshots/:id - efeito', () => {
  it('advisory lock ANTES da leitura; leitura e escrita condicionadas a nao excluida', async () => {
    const cookies = await loginAs('admin');
    const res = await request(app).delete(PATH).set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.$executeRaw.mock.calls[0][0].join('?')).toContain('pg_advisory_xact_lock');
    expect(prismaMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.forecastSnapshot.findFirst.mock.invocationCallOrder[0],
    );
    expect(prismaMock.forecastSnapshot.findFirst.mock.calls[0][0].where).toEqual({ id: 7, deletedAt: null });
    expect(prismaMock.forecastSnapshot.updateMany).toHaveBeenCalledTimes(1);
    const update = prismaMock.forecastSnapshot.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: 7, deletedAt: null });
    expect(update.data.deletedAt).toBeInstanceOf(Date);
    expect(Object.keys(update.data)).toEqual(['deletedAt']);
  });

  it('inexistente ou ja excluida -> 404 sem gravar nem auditar', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    const cookies = await loginAs('admin');
    const res = await request(app).delete(PATH).set('Cookie', cookies);
    expect(res.status).toBe(404);
    expect(prismaMock.forecastSnapshot.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('corrida (outra pessoa excluiu entre a leitura e a gravacao) -> 404 sem AuditLog', async () => {
    prismaMock.forecastSnapshot.updateMany.mockResolvedValue({ count: 0 });
    const cookies = await loginAs('admin');
    const res = await request(app).delete(PATH).set('Cookie', cookies);
    expect(res.status).toBe(404);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('AuditLog soft_delete so com rotulo, data base, origem e metade (sem beforeData/afterData)', async () => {
    const cookies = await loginAs('comprador');
    const res = await request(app).delete(PATH).set('Cookie', cookies);
    expect(res.status).toBe(200);
    const logs = prismaMock.auditLog.create.mock.calls
      .map((c) => c[0].data)
      .filter((d: { action: string }) => d.action === 'soft_delete');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ entityType: 'forecast_snapshot', entityId: '7' });
    expect(logs[0].metadata).toEqual({ label: '10-2', baseDate: '2026-10-15', origin: 'planilha', half: 2 });
    expect(logs[0].beforeData ?? null).toBeNull();
    expect(logs[0].afterData ?? null).toBeNull();
  });

  it('P2028 (importacao em andamento segura a lock) -> 503 com a mensagem de importacao', async () => {
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('timeout', { code: 'P2028', clientVersion: 'test' }),
    );
    const cookies = await loginAs('admin');
    const res = await request(app).delete(PATH).set('Cookie', cookies);
    expect(res.status).toBe(503);
    expect(res.body.message).toBe('Há uma importação do Forecast em andamento. Tente de novo em instantes.');
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
