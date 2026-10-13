import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
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
    quoteResponse: {
      findUnique: vi.fn(),
    },
    quoteResponsePriceSnapshot: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    quoteRequestItem: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  quoteResponse: { findUnique: ReturnType<typeof vi.fn> };
  quoteResponsePriceSnapshot: { findMany: ReturnType<typeof vi.fn> };
  quoteRequestItem: { findMany: ReturnType<typeof vi.fn> };
};

const snapshot = (id: number, unitPrice: string, recordedAt: string) => ({
  id,
  quoteResponseId: 42,
  source: 'portal',
  actorName: 'Contato <c@forn.test>',
  performedById: null,
  supplierContactId: 9,
  currency: 'USD',
  offeredIncoterm: 'FOB',
  offeredPrice: (Number(unitPrice) * 5).toFixed(2),
  items: [{ quoteRequestItemId: 5, unitPrice, quantity: 5, totalPrice: (Number(unitPrice) * 5).toFixed(2), isUnavailable: false, incotermPrices: null }],
  recordedAt: new Date(recordedAt),
});

describe('GET /api/v1/quote-responses/:id/price-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.quoteResponsePriceSnapshot.findMany.mockResolvedValue([]);
    prismaMock.quoteRequestItem.findMany.mockResolvedValue([]);
  });

  it('401 sem sessao', async () => {
    const res = await request(app).get('/api/v1/quote-responses/42/price-history');
    expect(res.status).toBe(401);
  });

  it('200 como viewer com { columns, rows } (linhas em ordem e changedItemIds)', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.quoteResponse.findUnique.mockResolvedValue({ id: 42 });
    prismaMock.quoteResponsePriceSnapshot.findMany.mockResolvedValue([
      snapshot(1, '10.00', '2026-10-01T10:00:00Z'),
      snapshot(2, '12.00', '2026-10-02T10:00:00Z'),
    ]);
    prismaMock.quoteRequestItem.findMany.mockResolvedValue([{ id: 5, productName: 'Resina', itemCode: 'RES-01', unit: 'KG' }]);

    const res = await request(app).get('/api/v1/quote-responses/42/price-history').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.columns).toEqual([{ quoteRequestItemId: 5, productName: 'Resina', itemCode: 'RES-01', unit: 'KG' }]);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows[0]).toMatchObject({ id: 1, changedItemIds: [], changedFields: [], recordedAt: '2026-10-01T10:00:00.000Z' });
    expect(res.body.rows[1]).toMatchObject({ id: 2, changedItemIds: [5], changedFields: ['offeredPrice'], offeredPrice: '60.00' });
    expect(prismaMock.quoteResponse.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42, deletedAt: null } }),
    );
  });

  it('404 quando a proposta nao existe (ou foi excluida)', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.quoteResponse.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/quote-responses/999/price-history').set('Cookie', cookies);
    expect(res.status).toBe(404);
    expect(prismaMock.quoteResponsePriceSnapshot.findMany).not.toHaveBeenCalled();
  });

  it('400 com id invalido', async () => {
    const cookies = await loginAs('viewer');
    const res = await request(app).get('/api/v1/quote-responses/abc/price-history').set('Cookie', cookies);
    expect(res.status).toBe(400);
  });
});

// O login e' limitado por rate limit (por IP): reaproveita o cookie ja obtido por papel.
const cookieCache = new Map<string, string[]>();

async function loginAs(role: 'admin' | 'comprador' | 'gestor' | 'viewer') {
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

  const cached = cookieCache.get(role);
  if (cached) {
    return cached;
  }

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: `${role}@intelliquote.local`, password: 'ChangeMe123!' });

  const cookies = loginResponse.headers['set-cookie'];
  if (cookies) {
    cookieCache.set(role, cookies as unknown as string[]);
  }
  return cookies;
}
