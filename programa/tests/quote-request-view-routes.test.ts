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
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    quoteRequestView: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      createMany: vi.fn(),
      upsert: vi.fn(),
    },
    quoteResponsePriceSnapshot: {
      findMany: vi.fn(),
    },
    supplierPortalResponse: {
      groupBy: vi.fn(),
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

type Fn = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Fn; findFirst: Fn };
  session: { create: Fn };
  quoteRequest: { findMany: Fn; findFirst: Fn; count: Fn };
  quoteRequestView: { findMany: Fn; findFirst: Fn; createMany: Fn; upsert: Fn };
  quoteResponsePriceSnapshot: { findMany: Fn };
  supplierPortalResponse: { groupBy: Fn };
  $transaction: Fn;
  __tx: unknown;
};

const USER_CREATED_AT = new Date('2026-09-01T00:00:00.000Z');

describe('POST /api/v1/quote-requests/:id/seen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.quoteRequest.findFirst.mockResolvedValue({ id: 4 });
    // Usuario que ja tem alguma view: o baseline preguicoso nao dispara.
    prismaMock.quoteRequestView.findFirst.mockResolvedValue({ id: 99 });
    prismaMock.quoteRequestView.upsert.mockResolvedValue({
      quoteRequestId: 4,
      lastSeenAt: new Date('2026-11-18T12:00:00.000Z'),
    });
  });

  it('400 com id invalido', async () => {
    const cookies = await loginAs('comprador');

    const response = await request(app).post('/api/v1/quote-requests/abc/seen').set('Cookie', cookies);

    expect(response.status).toBe(400);
    expect(prismaMock.quoteRequestView.upsert).not.toHaveBeenCalled();
  });

  it('404 quando a cotacao esta apagada ou nao existe', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteRequest.findFirst.mockResolvedValue(null);

    const response = await request(app).post('/api/v1/quote-requests/4/seen').set('Cookie', cookies);

    expect(response.status).toBe(404);
    expect(prismaMock.quoteRequest.findFirst.mock.calls[0][0].where).toEqual({ id: 4, deletedAt: null });
    expect(prismaMock.quoteRequestView.upsert).not.toHaveBeenCalled();
  });

  it('200 faz upsert com o userId da sessao e a unique composta', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app).post('/api/v1/quote-requests/4/seen').set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ quoteRequestId: 4, lastSeenAt: '2026-11-18T12:00:00.000Z' });
    const args = prismaMock.quoteRequestView.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId_quoteRequestId: { userId: 1, quoteRequestId: 4 } });
    expect(args.create).toMatchObject({ userId: 1, quoteRequestId: 4 });
  });

  it('comercial recebe 403', async () => {
    const cookies = await loginAs('comercial');

    const response = await request(app).post('/api/v1/quote-requests/4/seen').set('Cookie', cookies);

    expect(response.status).toBe(403);
    expect(prismaMock.quoteRequestView.upsert).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/quote-requests?withNewResponses=true', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (t: unknown) => unknown)(prismaMock.__tx),
    );
    prismaMock.quoteRequestView.findMany.mockResolvedValue([]);
    prismaMock.quoteRequestView.findFirst.mockResolvedValue({ id: 99 });
    prismaMock.quoteResponsePriceSnapshot.findMany.mockResolvedValue([]);
    prismaMock.supplierPortalResponse.groupBy.mockResolvedValue([]);
  });

  it('devolve hasNewResponse por linha (paginado)', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteRequest.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prismaMock.quoteRequest.count.mockResolvedValue(2);
    prismaMock.quoteResponsePriceSnapshot.findMany.mockResolvedValue([
      {
        recordedAt: new Date('2026-11-10T00:00:00.000Z'),
        source: 'portal',
        performedById: null,
        quoteResponse: { quoteRequestId: 2 },
      },
    ]);

    const response = await request(app)
      .get('/api/v1/quote-requests?page=1&pageSize=50&withNewResponses=true')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      { id: 1, hasNewResponse: false },
      { id: 2, hasNewResponse: true },
    ]);
    expect(prismaMock.quoteRequestView.findMany.mock.calls[0][0].where).toEqual({
      userId: 1,
      quoteRequestId: { in: [1, 2] },
    });
  });

  it('sem o parametro nao toca em quoteRequestView e a resposta fica inalterada', async () => {
    const cookies = await loginAs('comprador');
    const rows = [{ id: 1 }, { id: 2 }];
    prismaMock.quoteRequest.findMany.mockResolvedValue(rows);
    prismaMock.quoteRequest.count.mockResolvedValue(2);

    const response = await request(app).get('/api/v1/quote-requests?page=1').set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(rows);
    expect(prismaMock.quoteRequestView.findMany).not.toHaveBeenCalled();
    expect(prismaMock.quoteResponsePriceSnapshot.findMany).not.toHaveBeenCalled();
    expect(prismaMock.supplierPortalResponse.groupBy).not.toHaveBeenCalled();
  });

  it('valor invalido do parametro -> 400', async () => {
    const cookies = await loginAs('comprador');

    const response = await request(app)
      .get('/api/v1/quote-requests?withNewResponses=talvez')
      .set('Cookie', cookies);

    expect(response.status).toBe(400);
  });
});

async function loginAs(role: 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial') {
  const passwordHash = await hashPassword('ChangeMe123!');
  const userRow = {
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    createdAt: USER_CREATED_AT,
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
