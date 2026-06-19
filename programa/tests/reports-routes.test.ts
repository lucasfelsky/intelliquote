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
