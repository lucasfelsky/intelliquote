import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const tx = {
    quoteResponse: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    quoteComparison: {
      create: vi.fn(),
    },
    quoteRequest: {
      update: vi.fn(),
    },
  };

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
    supplier: {},
    quoteRequest: {
      findUnique: vi.fn(),
    },
    quoteResponse: {
      findMany: vi.fn(),
    },
    quoteComparison: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (callback) => callback(tx)),
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
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  quoteRequest: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  quoteResponse: {
    findMany: ReturnType<typeof vi.fn>;
  };
  quoteComparison: {
    findMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  __tx: {
    quoteResponse: {
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    quoteComparison: {
      create: ReturnType<typeof vi.fn>;
    };
    quoteRequest: {
      update: ReturnType<typeof vi.fn>;
    };
  };
};

describe('Comparison routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(prismaMock.__tx),
    );
  });

  it('persiste o historico da comparacao com pesos e executor', async () => {
    const cookies = await loginAs('comprador');

    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 1,
      requestCode: 'QR-20260325-DEMO01',
      status: 'open',
      currency: 'USD',
    });
    prismaMock.quoteResponse.findMany.mockResolvedValue([
      {
        id: 11,
        quoteRequestId: 1,
        supplierId: 101,
        offeredPrice: 100,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 40,
        insuranceCost: 10,
        otherFees: 20,
        importDuty: 14,
        ipi: 5,
        pis: 2.1,
        cofins: 9.65,
        offeredIncoterm: 'EXW',
        paymentTermsDays: 10,
        isWinner: false,
      },
      {
        id: 12,
        quoteRequestId: 1,
        supplierId: 102,
        offeredPrice: 120,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 0,
        insuranceCost: 0,
        otherFees: 10,
        importDuty: 10,
        ipi: 4,
        pis: 2.1,
        cofins: 9.65,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
        isWinner: false,
      },
    ]);
    prismaMock.__tx.quoteResponse.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.__tx.quoteResponse.update.mockResolvedValue({});
    prismaMock.__tx.quoteComparison.create.mockResolvedValue({ id: 999 });
    prismaMock.__tx.quoteRequest.update.mockResolvedValue({ id: 1, status: 'closed' });

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare')
      .set('Cookie', cookies)
      .send({
        priceWeight: 80,
        paymentTermsWeight: 10,
        incotermWeight: 10,
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.some((item: { isWinner: boolean }) => item.isWinner)).toBe(true);
    expect(prismaMock.__tx.quoteComparison.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quoteRequestId: 1,
          executedById: 1,
          priceWeight: 80,
          paymentTermsWeight: 10,
          incotermWeight: 10,
          results: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({
                exchangeRate: expect.any(Number),
                cifValue: expect.any(Number),
                totalLandedCost: expect.any(Number),
              }),
            ]),
          }),
        }),
      }),
    );
    expect(prismaMock.__tx.quoteRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'closed',
          closedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('retorna o historico auditavel por cotacao', async () => {
    const cookies = await loginAs('viewer');

    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 1,
      requestCode: 'QR-20260325-DEMO01',
    });
    prismaMock.quoteComparison.findMany.mockResolvedValue([
      {
        id: 501,
        quoteRequestId: 1,
        priceWeight: 50,
        paymentTermsWeight: 30,
        incotermWeight: 20,
        createdAt: new Date('2026-03-25T18:00:00.000Z'),
        executedBy: {
          id: 1,
          name: 'Comprador Teste',
          email: 'comprador@intelliquote.local',
        },
        results: [
          {
            id: 701,
            supplierId: 101,
            offeredPrice: '100.00',
            offeredIncoterm: 'CIF',
            paymentTermsDays: 30,
            priceScore: 48.2,
            paymentTermsScore: 30,
            incotermScore: 16,
            totalScore: 94.2,
            isWinner: true,
            quoteResponse: {
              supplier: {
                id: 101,
                name: 'Global Parts Ltd',
              },
            },
          },
        ],
      },
    ]);

    const response = await request(app)
      .get('/api/v1/quote-requests/1/comparisons')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.quoteRequestId).toBe(1);
    expect(response.body.comparisons).toHaveLength(1);
    expect(response.body.comparisons[0].results[0].isWinner).toBe(true);
  });

  it('bloqueia nova comparacao quando a cotacao ja esta fechada', async () => {
    const cookies = await loginAs('gestor');

    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 1,
      requestCode: 'QR-20260325-DEMO01',
      status: 'closed',
      currency: 'USD',
    });

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare')
      .set('Cookie', cookies)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Reabra');
    expect(prismaMock.quoteResponse.findMany).not.toHaveBeenCalled();
  });

  it('bloqueia comparacao sem exchangeRate valida para moeda estrangeira', async () => {
    const cookies = await loginAs('gestor');

    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 1,
      requestCode: 'QR-20260325-DEMO01',
      status: 'open',
      currency: 'USD',
    });
    prismaMock.quoteResponse.findMany.mockResolvedValue([
      {
        id: 11,
        quoteRequestId: 1,
        supplierId: 101,
        offeredPrice: 100,
        currency: 'USD',
        exchangeRate: 0,
        freightCost: 0,
        insuranceCost: 0,
        otherFees: 0,
        importDuty: 14,
        ipi: 5,
        pis: 2.1,
        cofins: 9.65,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
        isWinner: false,
      },
      {
        id: 12,
        quoteRequestId: 1,
        supplierId: 102,
        offeredPrice: 120,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 0,
        insuranceCost: 0,
        otherFees: 0,
        importDuty: 14,
        ipi: 5,
        pis: 2.1,
        cofins: 9.65,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 60,
        isWinner: false,
      },
    ]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare')
      .set('Cookie', cookies)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('exchangeRate');
    expect(prismaMock.__tx.quoteComparison.create).not.toHaveBeenCalled();
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
