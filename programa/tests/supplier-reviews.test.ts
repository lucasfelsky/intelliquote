// F12 (backlog 2026-07-12): testes do backend de rating/tags de fornecedor.
// - GET /suppliers anexa reviewStats (avgRating null sem review; media das 3
//   dimensoes quando ha reviews).
// - POST /suppliers normaliza tags.
// - POST /quote-requests/:id/close com review grava SupplierReview via tx e
//   valida que o fornecedor respondeu a cotacao.
// - GET /reports/top-suppliers junta avgRating.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const tx = {
    quoteRequest: { update: vi.fn() },
    supplierReview: { upsert: vi.fn() },
  };

  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    supplier: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    supplierReview: { groupBy: vi.fn() },
    quoteResponse: { findFirst: vi.fn(), findMany: vi.fn() },
    quoteRequest: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    __tx: tx,
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  supplier: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  supplierReview: { groupBy: ReturnType<typeof vi.fn> };
  quoteResponse: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  quoteRequest: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  __tx: {
    quoteRequest: { update: ReturnType<typeof vi.fn> };
    supplierReview: { upsert: ReturnType<typeof vi.fn> };
  };
};

describe('F12 — supplier reviews & tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) =>
      callback(prismaMock.__tx),
    );
  });

  describe('GET /suppliers reviewStats', () => {
    it('avgRating null quando o fornecedor nao tem review', async () => {
      const cookies = await loginAs('viewer');
      prismaMock.supplier.findMany.mockResolvedValue([{ id: 1, name: 'Acme', tags: [] }]);
      prismaMock.supplierReview.groupBy.mockResolvedValue([]);

      const response = await request(app).get('/api/v1/suppliers').set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(response.body[0].reviewStats).toEqual({
        count: 0,
        avgPrice: null,
        avgLeadTime: null,
        avgQuality: null,
        avgRating: null,
      });
    });

    it('computa avgRating como media das 3 dimensoes', async () => {
      const cookies = await loginAs('viewer');
      prismaMock.supplier.findMany.mockResolvedValue([{ id: 7, name: 'Bravo', tags: ['confiavel'] }]);
      prismaMock.supplierReview.groupBy.mockResolvedValue([
        {
          supplierId: 7,
          _avg: { priceRating: 4, leadTimeRating: 5, qualityRating: 3 },
          _count: { _all: 2 },
        },
      ]);

      const response = await request(app).get('/api/v1/suppliers').set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(response.body[0].reviewStats).toEqual({
        count: 2,
        avgPrice: 4,
        avgLeadTime: 5,
        avgQuality: 3,
        avgRating: 4, // (4+5+3)/3
      });
    });
  });

  describe('POST /suppliers tags', () => {
    it('normaliza tags (trim, dedup case-insensitive) ao criar', async () => {
      const cookies = await loginAs('admin');
      prismaMock.supplier.create.mockResolvedValue({ id: 3, name: 'Novo', tags: ['Rapido'] });

      const response = await request(app)
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({
          name: 'Novo',
          acceptedIncoterms: ['FOB'],
          tags: ['Rapido', ' rapido ', 'Confiavel'],
        });

      expect(response.status).toBe(201);
      const createArg = prismaMock.supplier.create.mock.calls[0][0];
      expect(createArg.data.tags).toEqual(['Rapido', 'Confiavel']);
    });
  });

  describe('POST /quote-requests/:id/close com review', () => {
    it('grava SupplierReview quando o fornecedor respondeu a cotacao', async () => {
      const cookies = await loginAs('gestor');
      prismaMock.quoteRequest.findUnique.mockResolvedValue({ id: 5, status: 'open' });
      prismaMock.quoteResponse.findFirst.mockResolvedValue({ id: 99 }); // fornecedor respondeu
      prismaMock.__tx.quoteRequest.update.mockResolvedValue({ id: 5, status: 'closed' });
      prismaMock.__tx.supplierReview.upsert.mockResolvedValue({ id: 1, supplierId: 8 });

      const response = await request(app)
        .post('/api/v1/quote-requests/5/close')
        .set('Cookie', cookies)
        .send({
          review: { supplierId: 8, priceRating: 5, leadTimeRating: 4, qualityRating: 5, comment: 'Otimo' },
        });

      expect(response.status).toBe(200);
      expect(prismaMock.__tx.supplierReview.upsert).toHaveBeenCalledTimes(1);
      const upsertArg = prismaMock.__tx.supplierReview.upsert.mock.calls[0][0];
      expect(upsertArg.where).toEqual({ quoteRequestId: 5 });
      expect(upsertArg.create).toMatchObject({
        supplierId: 8,
        quoteRequestId: 5,
        priceRating: 5,
        leadTimeRating: 4,
        qualityRating: 5,
        comment: 'Otimo',
      });
    });

    it('rejeita review de fornecedor que nao respondeu a cotacao', async () => {
      const cookies = await loginAs('gestor');
      prismaMock.quoteRequest.findUnique.mockResolvedValue({ id: 5, status: 'open' });
      prismaMock.quoteResponse.findFirst.mockResolvedValue(null); // nao respondeu

      const response = await request(app)
        .post('/api/v1/quote-requests/5/close')
        .set('Cookie', cookies)
        .send({
          review: { supplierId: 999, priceRating: 5, leadTimeRating: 4, qualityRating: 5 },
        });

      expect(response.status).toBe(400);
      expect(prismaMock.__tx.supplierReview.upsert).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteRequest.update).not.toHaveBeenCalled();
    });

    it('fecha normalmente sem review (retrocompat)', async () => {
      const cookies = await loginAs('gestor');
      prismaMock.quoteRequest.findUnique.mockResolvedValue({ id: 6, status: 'open' });
      prismaMock.__tx.quoteRequest.update.mockResolvedValue({ id: 6, status: 'closed' });

      const response = await request(app)
        .post('/api/v1/quote-requests/6/close')
        .set('Cookie', cookies)
        .send({});

      expect(response.status).toBe(200);
      expect(prismaMock.__tx.supplierReview.upsert).not.toHaveBeenCalled();
    });

    it('rejeita nota fora de 1..5', async () => {
      const cookies = await loginAs('gestor');
      prismaMock.quoteRequest.findUnique.mockResolvedValue({ id: 5, status: 'open' });

      const response = await request(app)
        .post('/api/v1/quote-requests/5/close')
        .set('Cookie', cookies)
        .send({
          review: { supplierId: 8, priceRating: 6, leadTimeRating: 4, qualityRating: 5 },
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /reports/top-suppliers avgRating', () => {
    it('junta avgRating por fornecedor', async () => {
      const cookies = await loginAs('gestor');
      prismaMock.quoteResponse.findMany.mockResolvedValue([
        {
          supplierId: 7,
          supplier: { id: 7, name: 'Bravo', country: 'BR' },
          wonComparisons: [],
        },
      ]);
      prismaMock.supplierReview.groupBy.mockResolvedValue([
        {
          supplierId: 7,
          _avg: { priceRating: 4, leadTimeRating: 4, qualityRating: 4 },
          _count: { _all: 3 },
        },
      ]);

      const response = await request(app).get('/api/v1/reports/top-suppliers').set('Cookie', cookies);

      expect(response.status).toBe(200);
      const bravo = response.body.items.find((item: { supplierId: number }) => item.supplierId === 7);
      expect(bravo.avgRating).toBe(4);
      expect(bravo.reviewCount).toBe(3);
    });
  });
});

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

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: `${role}@intelliquote.local`, password: 'ChangeMe123!' });

  return loginResponse.headers['set-cookie'];
}
