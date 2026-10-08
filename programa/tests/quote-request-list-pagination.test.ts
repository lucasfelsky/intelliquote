import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const tx = {};

  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    quoteRequest: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (t: unknown) => unknown)(tx),
    ),
    __tx: tx,
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  session: {
    create: ReturnType<typeof vi.fn>;
  };
  quoteRequest: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  __tx: unknown;
};

describe('GET /api/v1/quote-requests - contrato de listagem e paginacao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (t: unknown) => unknown)(prismaMock.__tx),
    );
  });

  it('sem query string devolve array completo, sem skip/take e sem count', async () => {
    const cookies = await loginAs('comprador');
    const rows = [{ id: 1 }, { id: 2 }];
    prismaMock.quoteRequest.findMany.mockResolvedValue(rows);

    const response = await request(app).get('/api/v1/quote-requests').set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toEqual(rows);
    const args = prismaMock.quoteRequest.findMany.mock.calls[0][0];
    expect(args).not.toHaveProperty('skip');
    expect(args).not.toHaveProperty('take');
    expect(prismaMock.quoteRequest.count).not.toHaveBeenCalled();
  });

  it('filtro sem page usa defaults page 1 / pageSize 20 e devolve o total', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteRequest.findMany.mockResolvedValue([{ id: 1 }]);
    prismaMock.quoteRequest.count.mockResolvedValue(45);

    const response = await request(app)
      .get('/api/v1/quote-requests?status=open')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({
      page: 1,
      pageSize: 20,
      totalItems: 45,
      totalPages: 3,
    });
    const args = prismaMock.quoteRequest.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
    expect(args.where.status).toBe('open');
    expect(args.where.deletedAt).toBeNull();
  });

  it('combina search + status + incoterm + page/pageSize e conta com o mesmo where', async () => {
    const cookies = await loginAs('comprador');
    const rows = [{ id: 51 }, { id: 52 }];
    prismaMock.quoteRequest.findMany.mockResolvedValue(rows);
    prismaMock.quoteRequest.count.mockResolvedValue(120);

    const response = await request(app)
      .get('/api/v1/quote-requests?search=ABC&status=open&incoterm=FOB&page=2&pageSize=50')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    const args = prismaMock.quoteRequest.findMany.mock.calls[0][0];
    expect(args.skip).toBe(50);
    expect(args.take).toBe(50);
    expect(args.where.OR).toHaveLength(3);
    for (const cond of args.where.OR) {
      expect(Object.values(cond)[0]).toEqual(expect.objectContaining({ contains: 'ABC' }));
    }
    expect(args.where.status).toBe('open');
    expect(args.where.desiredIncoterm).toEqual({ has: 'FOB' });
    expect(args.where.deletedAt).toBeNull();
    expect(prismaMock.quoteRequest.count).toHaveBeenCalledWith({ where: args.where });
    expect(response.body.pagination).toEqual({
      page: 2,
      pageSize: 50,
      totalItems: 120,
      totalPages: 3,
    });
    expect(response.body.data).toEqual(rows);
  });

  it('limita pageSize ao teto de 100', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteRequest.findMany.mockResolvedValue([]);
    prismaMock.quoteRequest.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/v1/quote-requests?pageSize=500')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(prismaMock.quoteRequest.findMany.mock.calls[0][0].take).toBe(100);
    expect(response.body.pagination.pageSize).toBe(100);
  });

  it('page/pageSize invalidos caem nos defaults', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteRequest.findMany.mockResolvedValue([]);
    prismaMock.quoteRequest.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/v1/quote-requests?page=0&pageSize=abc')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    const args = prismaMock.quoteRequest.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
    expect(response.body.pagination.page).toBe(1);
  });
});

async function loginAs(role: 'admin' | 'comprador' | 'gestor' | 'viewer') {
  const passwordHash = await hashPassword('ChangeMe123!');
  const userRow = {
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: { name: role },
  };

  prismaMock.user.findUnique.mockResolvedValue({ ...userRow, passwordHash });
  prismaMock.user.findFirst.mockResolvedValue(userRow);
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: userRow.email, password: 'ChangeMe123!' });

  return loginResponse.headers['set-cookie'];
}
