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
    quoteRequest: { count: vi.fn() },
    quoteResponse: { count: vi.fn(), findMany: vi.fn() },
    quoteComparison: { count: vi.fn(), findMany: vi.fn() },
    quoteComparisonResult: { count: vi.fn() },
    supplier: { count: vi.fn() },
    supplierPortalToken: { findMany: vi.fn() },
    supplierPortalResponseItem: { findMany: vi.fn() },
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
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  quoteRequest: { count: ReturnType<typeof vi.fn> };
  quoteResponse: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  quoteComparison: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  quoteComparisonResult: { count: ReturnType<typeof vi.fn> };
  supplier: { count: ReturnType<typeof vi.fn> };
  supplierPortalToken: { findMany: ReturnType<typeof vi.fn> };
  supplierPortalResponseItem: { findMany: ReturnType<typeof vi.fn> };
};

describe('Reports and help routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna summary para viewer', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.quoteRequest.count.mockResolvedValue(0);
    prismaMock.quoteResponse.count.mockResolvedValue(0);
    prismaMock.quoteComparison.count.mockResolvedValue(0);
    prismaMock.supplier.count.mockResolvedValue(0);
    prismaMock.quoteComparisonResult.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/v1/reports/summary')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('totals');
    expect(response.body).toHaveProperty('awardRate');
  });

  it('lista artigos de ajuda', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app)
      .get('/api/v1/help/articles')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('filtra artigos por categoria', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app)
      .get('/api/v1/help/articles?category=fornecedor')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    response.body.forEach((article: { category: string }) => {
      expect(article.category).toBe('fornecedor');
    });
  });

  it('calcula savings sem comparacoes', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.quoteComparison.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/reports/savings')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.comparisons).toBe(0);
  });

  it('calcula lead-time medio', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.quoteResponse.findMany.mockResolvedValue([
      { leadTimeDays: 10, supplierId: 1, submittedAt: new Date(), supplier: { name: 'A' } },
      { leadTimeDays: 20, supplierId: 1, submittedAt: new Date(), supplier: { name: 'A' } },
    ] as never);

    const response = await request(app)
      .get('/api/v1/reports/lead-time')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.averageLeadTimeDays).toBe(15);
  });

  it('bloqueia relatorios para usuario nao autenticado', async () => {
    const response = await request(app).get('/api/v1/reports/summary');
    expect(response.status).toBe(401);
  });

  // F7 (backlog 2026-07-12): engajamento de fornecedores.
  it('supplier-engagement: agrega taxa e tempo medio de resposta por fornecedor', async () => {
    const cookies = await loginAs('viewer');
    const base = new Date('2026-07-01T09:00:00Z');
    prismaMock.supplierPortalToken.findMany.mockResolvedValue([
      // Fornecedor 1: 2 enviados, 1 respondido em 24h -> rate 50%, avg 24h
      {
        supplierId: 1,
        createdAt: base,
        respondedAt: new Date(base.getTime() + 24 * 60 * 60 * 1000),
        supplier: { name: 'Alpha' },
      },
      { supplierId: 1, createdAt: base, respondedAt: null, supplier: { name: 'Alpha' } },
      // Fornecedor 2: 1 enviado, 0 respondido -> rate 0%, avg null
      { supplierId: 2, createdAt: base, respondedAt: null, supplier: { name: 'Beta' } },
    ] as never);

    const response = await request(app)
      .get('/api/v1/reports/supplier-engagement')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    const alpha = response.body.items.find((i: { supplierId: number }) => i.supplierId === 1);
    expect(alpha).toMatchObject({
      tokensSent: 2,
      tokensResponded: 1,
      responseRate: 50,
      avgResponseHours: 24,
    });
    const beta = response.body.items.find((i: { supplierId: number }) => i.supplierId === 2);
    expect(beta.responseRate).toBe(0);
    expect(beta.avgResponseHours).toBeNull();
    // Ordenado por responseRate desc: Alpha antes de Beta.
    expect(response.body.items[0].supplierId).toBe(1);
  });

  it('supplier-engagement: sem tokens -> lista vazia', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.supplierPortalToken.findMany.mockResolvedValue([] as never);

    const response = await request(app)
      .get('/api/v1/reports/supplier-engagement')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });

  // F7: historico de preco por item de catalogo.
  it('price-history: agrupa unitPrice por mes com min/avg/max e melhor fornecedor', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.supplierPortalResponseItem.findMany.mockResolvedValue([
      {
        unitPrice: 10,
        response: {
          submittedAt: new Date('2026-06-10T00:00:00Z'),
          currency: 'USD',
          supplierId: 1,
          supplier: { name: 'Alpha' },
        },
      },
      {
        unitPrice: 8,
        response: {
          submittedAt: new Date('2026-06-20T00:00:00Z'),
          currency: 'USD',
          supplierId: 2,
          supplier: { name: 'Beta' },
        },
      },
      {
        unitPrice: 12,
        response: {
          submittedAt: new Date('2026-07-05T00:00:00Z'),
          currency: 'USD',
          supplierId: 1,
          supplier: { name: 'Alpha' },
        },
      },
    ] as never);

    const response = await request(app)
      .get('/api/v1/reports/price-history?catalogItemId=42')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.catalogItemId).toBe(42);
    expect(response.body.series).toHaveLength(2);
    const june = response.body.series[0];
    expect(june.month).toBe('2026-06');
    expect(june.min).toBe(8);
    expect(june.max).toBe(10);
    expect(june.avg).toBe(9);
    expect(june.bestSupplier.supplierId).toBe(2); // Beta = menor preco
  });

  it('price-history: catalogItemId invalido -> 400', async () => {
    const cookies = await loginAs('viewer');
    const response = await request(app)
      .get('/api/v1/reports/price-history')
      .set('Cookie', cookies);
    expect(response.status).toBe(400);
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
    .send({
      email: `${role}@intelliquote.local`,
      password: 'ChangeMe123!',
    });

  return loginResponse.headers['set-cookie'];
}
