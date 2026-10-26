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
    forecastProduct: { findUnique: vi.fn() },
    forecastProductCode: { update: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
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
  forecastProduct: { findUnique: Mock };
  forecastProductCode: { update: Mock; updateMany: Mock };
  $queryRaw: Mock;
  $executeRaw: Mock;
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const PATH = '/api/v1/forecast/products/5/embalagens';

interface CodigoMock {
  id: number;
  position: number;
  code: string;
  packagingQtyKg: Prisma.Decimal | null;
  packagingPalletKg: Prisma.Decimal | null;
  packagingPalletExtraKg: Prisma.Decimal[];
  packagingLabel: string | null;
  packagingIsPrimary: boolean;
  packagingSource: string | null;
  packagingUpdatedAt: Date | null;
}

const codigo = (id: number, extra: Partial<CodigoMock> = {}): CodigoMock => ({
  id,
  position: id - 10,
  code: `C000${id - 10}`,
  packagingQtyKg: null,
  packagingPalletKg: null,
  packagingPalletExtraKg: [],
  packagingLabel: null,
  packagingIsPrimary: false,
  packagingSource: null,
  packagingUpdatedAt: null,
  ...extra,
});

// Produto 5 com 3 codigos (ids 11..13, EMB.1..EMB.3).
const produto = (codes: CodigoMock[] = [codigo(11), codigo(12), codigo(13)]) => ({
  id: 5,
  name: 'PRODUTO 001',
  isActive: true,
  packaging: null,
  noFractioning: false,
  codes,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  // Advisory lock do import (1a instrucao) e trava FOR NO KEY UPDATE da linha do produto (2a).
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.$queryRaw.mockResolvedValue([{ id: 5, isActive: true }]);
  prismaMock.forecastProduct.findUnique.mockResolvedValue(produto());
  prismaMock.forecastProductCode.update.mockResolvedValue({});
  prismaMock.forecastProductCode.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.auditLog.create.mockResolvedValue({});
});

describe('Forecast embalagens - trava do import (L77)', () => {
  it('PATCH pega a advisory lock forecast:import antes da trava da linha e da leitura dos codigos', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 25 }] });
    expect(response.status).toBe(200);
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.$executeRaw.mock.calls[0][0].join('?')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(prismaMock.$executeRaw.mock.calls[0][1]).toBe('forecast:import');
    expect(prismaMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.$queryRaw.mock.invocationCallOrder[0],
    );
    expect(prismaMock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.forecastProduct.findUnique.mock.invocationCallOrder[0],
    );
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000, maxWait: 10_000 });
  });

  it('produto inexistente -> 404 com a lock como 1a instrucao e nada gravado', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 25 }] });
    expect(response.status).toBe(404);
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.$queryRaw.mock.invocationCallOrder[0],
    );
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('P2028 (import segurando a lock) -> 503 com a mensagem de ocupado', async () => {
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('timeout', { code: 'P2028', clientVersion: 'test' }),
    );
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 25 }] });
    expect(response.status).toBe(503);
    expect(response.body.message).toBe('O cadastro está ocupado por uma importação. Tente novamente em instantes.');
  });
});

describe('Forecast embalagens - palletKg junto com palletsKg (L79)', () => {
  it('palletKg + palletsKg vazio -> 400 e a transacao nem abre', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 25, palletKg: 1000, palletsKg: [] }] });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Informe palletKg ou palletsKg, não os dois.');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
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
