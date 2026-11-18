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
    quoteRequestItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    quoteResponse: {
      findMany: vi.fn(),
    },
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Fn = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Fn; findFirst: Fn };
  session: { create: Fn };
  quoteRequestItem: { findFirst: Fn; findMany: Fn };
  quoteResponse: { findMany: Fn };
};

function itemRow(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    quoteRequestId: 1,
    catalogItemId: 55,
    productName: 'Citric acid (texto livre)',
    itemCode: 'CIT-1',
    unit: 'KG',
    catalogItem: { commercialName: 'Acido citrico', marketName: 'Citric Acid Anhydrous' },
    ...over,
  };
}

function responseRow() {
  return {
    id: 100,
    quoteRequestId: 1,
    supplierId: 9,
    submittedAt: new Date('2026-10-01T12:00:00.000Z'),
    currency: 'USD',
    offeredIncoterm: 'FOB',
    supplier: { name: 'Forn A' },
    quoteRequest: { requestCode: 'COT-1' },
    priceSnapshots: [
      {
        id: 1,
        recordedAt: new Date('2026-10-12T10:00:00.000Z'),
        source: 'portal',
        currency: 'USD',
        offeredIncoterm: 'FOB',
        items: [
          { quoteRequestItemId: 7, unitPrice: '5.00', quantity: 10, totalPrice: '50.00', isUnavailable: false, incotermPrices: null },
        ],
      },
    ],
    items: [],
  };
}

describe('GET /api/v1/quote-request-items/:id/price-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.quoteRequestItem.findFirst.mockResolvedValue(itemRow());
    prismaMock.quoteRequestItem.findMany.mockResolvedValue([
      { id: 7, quoteRequestId: 1, unit: 'KG' },
      { id: 8, quoteRequestId: 2, unit: 'KG' },
    ]);
    prismaMock.quoteResponse.findMany.mockResolvedValue([responseRow()]);
  });

  it('400 com id invalido', async () => {
    const cookies = await loginAs('comprador');

    const response = await request(app).get('/api/v1/quote-request-items/abc/price-history').set('Cookie', cookies);

    expect(response.status).toBe(400);
    expect(prismaMock.quoteRequestItem.findFirst).not.toHaveBeenCalled();
  });

  it('404 quando o item (ou a cotacao) esta apagado', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteRequestItem.findFirst.mockResolvedValue(null);

    const response = await request(app).get('/api/v1/quote-request-items/7/price-history').set('Cookie', cookies);

    expect(response.status).toBe(404);
    const args = prismaMock.quoteRequestItem.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({ id: 7, deletedAt: null, quoteRequest: { deletedAt: null } });
  });

  it('200 com catalogItemId: busca todas as linhas do mesmo catalogo com deletedAt null', async () => {
    const cookies = await loginAs('comprador');

    const response = await request(app).get('/api/v1/quote-request-items/7/price-history').set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.linkedBy).toBe('catalogItemId');
    expect(response.body.item).toEqual({
      id: 7,
      catalogItemId: 55,
      name: 'Acido citrico',
      marketName: 'Citric Acid Anhydrous',
      unit: 'KG',
    });
    expect(response.body.truncated).toBe(false);
    expect(response.body.entries).toHaveLength(1);
    expect(response.body.entries[0]).toMatchObject({
      requestCode: 'COT-1',
      supplierName: 'Forn A',
      source: 'portal',
      unitPrice: '5.00',
      isCurrentQuote: true,
      variationPct: null,
    });

    const findManyArgs = prismaMock.quoteRequestItem.findMany.mock.calls[0][0];
    expect(findManyArgs.where).toEqual({
      catalogItemId: 55,
      deletedAt: null,
      quoteRequest: { deletedAt: null },
    });
    const responsesArgs = prismaMock.quoteResponse.findMany.mock.calls[0][0];
    expect(responsesArgs.where).toEqual({
      deletedAt: null,
      quoteRequestId: { in: [1, 2] },
      supplier: { deletedAt: null },
    });
    expect(responsesArgs.select.items.where.deletedAt).toBeNull();
  });

  it('200 sem catalogo: so o proprio item, linkedBy quoteRequestItem', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteRequestItem.findFirst.mockResolvedValue(
      itemRow({ catalogItemId: null, catalogItem: null }),
    );

    const response = await request(app).get('/api/v1/quote-request-items/7/price-history').set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.linkedBy).toBe('quoteRequestItem');
    expect(response.body.item.name).toBe('Citric acid (texto livre)');
    expect(response.body.item.marketName).toBeNull();
    expect(prismaMock.quoteRequestItem.findMany).not.toHaveBeenCalled();
    const responsesArgs = prismaMock.quoteResponse.findMany.mock.calls[0][0];
    expect(responsesArgs.where.quoteRequestId).toEqual({ in: [1] });
    expect(responsesArgs.select.items.where.quoteRequestItemId).toEqual({ in: [7] });
  });

  it('viewer pode ler', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app).get('/api/v1/quote-request-items/7/price-history').set('Cookie', cookies);

    expect(response.status).toBe(200);
  });

  it('comercial recebe 403', async () => {
    const cookies = await loginAs('comercial');

    const response = await request(app).get('/api/v1/quote-request-items/7/price-history').set('Cookie', cookies);

    expect(response.status).toBe(403);
    expect(prismaMock.quoteRequestItem.findFirst).not.toHaveBeenCalled();
  });
});

async function loginAs(role: 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial') {
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
