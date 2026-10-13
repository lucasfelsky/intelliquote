import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    session: {
      create: vi.fn(),
    },
    quoteRequest: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  };
  return { prisma };
});

type Fn = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Fn; findFirst: Fn };
  session: { create: Fn };
  quoteRequest: { findMany: Fn; count: Fn };
  auditLog: { create: Fn };
  $transaction: Fn;
};

async function loginAsComprador(): Promise<string> {
  const passwordHash = await hashPassword('ChangeMe123!');
  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    name: 'Comprador',
    email: 'comprador@intelliquote.local',
    passwordHash,
    isActive: true,
    role: { name: 'comprador' },
  });
  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: 'Comprador',
    email: 'comprador@intelliquote.local',
    isActive: true,
    role: { name: 'comprador' },
  });
  prismaMock.session.create.mockImplementation(({ data }) => Promise.resolve({ id: data.id }));
  const res = await request(app).post('/api/v1/auth/login').send({
    email: 'comprador@intelliquote.local',
    password: 'ChangeMe123!',
  });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.quoteRequest.findMany.mockResolvedValue([]);
  prismaMock.quoteRequest.count.mockResolvedValue(0);
  prismaMock.$transaction.mockImplementation((ops: unknown) =>
    Promise.all(ops as Promise<unknown>[]),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/quote-requests?month (filtro mes de criacao, BRT)', () => {
  it('month=2026-10 filtra createdAt de 01/10 03:00Z ate 01/11 03:00Z (exclusivo)', async () => {
    const cookieHeader = await loginAsComprador();

    const res = await request(app)
      .get('/api/v1/quote-requests?month=2026-10&page=1&pageSize=50')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(200);
    const { where } = prismaMock.quoteRequest.findMany.mock.calls[0][0];
    expect(where.createdAt).toEqual({
      gte: new Date('2026-10-01T03:00:00.000Z'),
      lt: new Date('2026-11-01T03:00:00.000Z'),
    });
    expect(where.deletedAt).toBeNull();
    // contagem total usa o mesmo filtro
    expect(prismaMock.quoteRequest.count).toHaveBeenCalledWith({ where });
  });

  it('dezembro vira o ano: month=2026-12 vai ate 01/01/2027 03:00Z', async () => {
    const cookieHeader = await loginAsComprador();

    const res = await request(app)
      .get('/api/v1/quote-requests?month=2026-12')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(200);
    const { where } = prismaMock.quoteRequest.findMany.mock.calls[0][0];
    expect(where.createdAt).toEqual({
      gte: new Date('2026-12-01T03:00:00.000Z'),
      lt: new Date('2027-01-01T03:00:00.000Z'),
    });
  });

  it('combina com os outros filtros (AND)', async () => {
    const cookieHeader = await loginAsComprador();

    const res = await request(app)
      .get('/api/v1/quote-requests?month=2026-01&status=open&poSent=true')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(200);
    const { where } = prismaMock.quoteRequest.findMany.mock.calls[0][0];
    expect(where.createdAt).toEqual({
      gte: new Date('2026-01-01T03:00:00.000Z'),
      lt: new Date('2026-02-01T03:00:00.000Z'),
    });
    expect(where.status).toBe('open');
    expect(where.purchaseOrderSentAt).toEqual({ not: null });
  });

  it.each(['2026-13', '2026-1', '2026-00', '10-2026', 'outubro', '2026-10-01'])(
    'month invalido (%s) retorna 400 e nao consulta o banco',
    async (month) => {
      const cookieHeader = await loginAsComprador();

      const res = await request(app)
        .get('/api/v1/quote-requests')
        .query({ month })
        .set('Cookie', cookieHeader);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Informe o mes no formato AAAA-MM.');
      expect(prismaMock.quoteRequest.findMany).not.toHaveBeenCalled();
    },
  );

  it('sem month nao filtra por createdAt', async () => {
    const cookieHeader = await loginAsComprador();

    const res = await request(app)
      .get('/api/v1/quote-requests?status=open')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(200);
    const { where } = prismaMock.quoteRequest.findMany.mock.calls[0][0];
    expect('createdAt' in where).toBe(false);
  });
});
