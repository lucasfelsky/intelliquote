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
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    supplierPortalToken: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    supplier: {},
    quoteRequest: {},
    quoteComparison: {},
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
  quoteResponse: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  supplierPortalToken: { findMany: ReturnType<typeof vi.fn> };
};

describe('Quote response routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bloqueia a definicao manual de proposta vencedora fora da comparacao', async () => {
    const cookies = await loginAs('comprador');

    const response = await request(app)
      .put('/api/v1/quote-responses/55')
      .set('Cookie', cookies)
      .send({
        isWinner: true,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('endpoint de comparacao');
    expect(prismaMock.quoteResponse.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.quoteResponse.update).not.toHaveBeenCalled();
  });

  it('marca respostas vindas do portal com source=portal na listagem', async () => {
    const cookies = await loginAs('comprador');

    prismaMock.quoteResponse.findMany.mockResolvedValue([
      {
        id: 10,
        quoteRequestId: 1,
        supplierId: 2,
        offeredPrice: '100.00',
        currency: 'USD',
        exchangeRate: '5.00',
        freightCost: '0',
        insuranceCost: '0',
        otherFees: '0',
        importDuty: '0',
        ipi: '0',
        pis: '0',
        cofins: '0',
        totalLandedCost: '500.00',
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
        leadTimeDays: 15,
        notes: null,
        submittedAt: new Date(),
        version: 1,
        isWinner: false,
        createdById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        supplier: { id: 2, name: 'Acme', country: 'BR', status: 'active' },
        quoteRequest: { id: 1, requestCode: 'QR-1', productName: 'X', status: 'open', currency: 'USD' },
      },
    ]);
    prismaMock.supplierPortalToken.findMany.mockResolvedValue([{ responseId: 10 }]);

    const response = await request(app)
      .get('/api/v1/quote-responses')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0].source).toBe('portal');
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
    role: {
      name: role,
    },
  });

  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: {
      name: role,
    },
  });

  prismaMock.session.create.mockResolvedValue({
    id: 'session-1',
  });

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: `${role}@intelliquote.local`,
      password: 'ChangeMe123!',
    });

  return loginResponse.headers['set-cookie'];
}
