import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';

const runDbTests = process.env.RUN_DB_TESTS === 'true';
const describeDb = runDbTests ? describe : describe.skip;
const runId = `db-${Date.now()}`;

describeDb('Critical flows on real database', () => {
  let app: any;
  let prisma: any;
  let authCookies: string[] = [];
  let userId: number | null = null;
  let supplierIds: number[] = [];
  let quoteRequestId: number | null = null;

  beforeAll(async () => {
    const appModule = await import('../src/app');
    const prismaModule = await import('../src/lib/prisma');

    app = appModule.app;
    prisma = prismaModule.prisma;

    const adminRole = await prisma.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: { name: 'admin' },
    });
    const passwordHash = await hashPassword('ChangeMe123!');
    const user = await prisma.user.create({
      data: {
        name: `DB Critical ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash,
        roleId: adminRole.id,
      },
    });

    userId = user.id;

    const loginResponse = await request(app).post('/api/v1/auth/login').send({
      email: user.email,
      password: 'ChangeMe123!',
    });

    expect(loginResponse.status).toBe(200);
    authCookies = loginResponse.headers['set-cookie'];
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    await cleanupCreatedRecords(prisma, quoteRequestId, supplierIds, userId);
    await prisma.$disconnect();
  });

  it('endurece exchange rate, fluxo de vencedora, persistencia de landed cost e delete de fornecedor', async () => {
    const supplierAResponse = await request(app)
      .post('/api/v1/suppliers')
      .set('Cookie', authCookies)
      .send({
        name: `${runId} Supplier A`,
        email: `${runId}-a@intelliquote.local`,
        acceptedIncoterms: ['FOB', 'CIF'],
      });
    const supplierBResponse = await request(app)
      .post('/api/v1/suppliers')
      .set('Cookie', authCookies)
      .send({
        name: `${runId} Supplier B`,
        email: `${runId}-b@intelliquote.local`,
        acceptedIncoterms: ['FOB', 'CIF'],
      });

    expect(supplierAResponse.status).toBe(201);
    expect(supplierBResponse.status).toBe(201);

    supplierIds = [supplierAResponse.body.id, supplierBResponse.body.id];

    const quoteRequestResponse = await request(app)
      .post('/api/v1/quote-requests')
      .set('Cookie', authCookies)
      .send({
        productName: `${runId} Bomba`,
        quantity: 20,
        desiredIncoterm: ['FOB'],
        currency: 'USD',
        description: 'Fluxo critico com Postgres real.',
      });

    expect(quoteRequestResponse.status).toBe(201);
    quoteRequestId = quoteRequestResponse.body.id;

    const invalidExchangeRateResponse = await request(app)
      .post('/api/v1/quote-responses')
      .set('Cookie', authCookies)
      .send({
        quoteRequestId,
        supplierId: supplierAResponse.body.id,
        offeredPrice: 1000,
        currency: 'USD',
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
      });

    expect(invalidExchangeRateResponse.status).toBe(400);
    expect(invalidExchangeRateResponse.body.message).toContain('exchangeRate');

    const quoteResponseA = await request(app)
      .post('/api/v1/quote-responses')
      .set('Cookie', authCookies)
      .send({
        quoteRequestId,
        supplierId: supplierAResponse.body.id,
        offeredPrice: 1000,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 100,
        insuranceCost: 10,
        otherFees: 20,
        importDuty: 14,
        ipi: 5,
        pis: 2.1,
        cofins: 9.65,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
      });

    expect(quoteResponseA.status).toBe(201);

    const forceWinnerResponse = await request(app)
      .put(`/api/v1/quote-responses/${quoteResponseA.body.id}`)
      .set('Cookie', authCookies)
      .send({
        isWinner: true,
      });

    expect(forceWinnerResponse.status).toBe(400);
    expect(forceWinnerResponse.body.message).toContain('endpoint de comparacao');

    const quoteResponseB = await request(app)
      .post('/api/v1/quote-responses')
      .set('Cookie', authCookies)
      .send({
        quoteRequestId,
        supplierId: supplierBResponse.body.id,
        offeredPrice: 1020,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 50,
        insuranceCost: 5,
        otherFees: 10,
        importDuty: 10,
        ipi: 4,
        pis: 2.1,
        cofins: 9.65,
        offeredIncoterm: 'CIF',
        paymentTermsDays: 45,
      });

    expect(quoteResponseB.status).toBe(201);

    const compareResponse = await request(app)
      .post(`/api/v1/quote-requests/${quoteRequestId}/compare`)
      .set('Cookie', authCookies)
      .send({});

    expect(compareResponse.status).toBe(200);
    expect(compareResponse.body).toHaveLength(2);

    const persistedComparison = await prisma.quoteComparison.findFirst({
      where: {
        quoteRequestId,
      },
      include: {
        results: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    expect(persistedComparison).not.toBeNull();

    const persistedResponseA = persistedComparison.results.find(
      (result: { quoteResponseId: number }) =>
        result.quoteResponseId === quoteResponseA.body.id,
    );

    expect(persistedResponseA).toBeDefined();
    expect(Number(persistedResponseA.importDutyRate)).toBeCloseTo(0.14, 4);
    expect(Number(persistedResponseA.ipiRate)).toBeCloseTo(0.05, 4);
    expect(Number(persistedResponseA.pisRate)).toBeCloseTo(0.021, 4);
    expect(Number(persistedResponseA.cofinsRate)).toBeCloseTo(0.0965, 4);

    const deleteSupplierResponse = await request(app)
      .delete(`/api/v1/suppliers/${supplierAResponse.body.id}`)
      .set('Cookie', authCookies);

    expect(deleteSupplierResponse.status).toBe(400);
    expect(deleteSupplierResponse.body.message).toContain('Inative ou bloqueie');
  });
});

async function cleanupCreatedRecords(
  prisma: any,
  quoteRequestId: number | null,
  supplierIds: number[],
  userId: number | null,
) {
  if (quoteRequestId) {
    const comparisons = await prisma.quoteComparison.findMany({
      where: {
        quoteRequestId,
      },
      select: {
        id: true,
      },
    });
    const comparisonIds = comparisons.map((comparison: { id: number }) => comparison.id);

    if (comparisonIds.length > 0) {
      await prisma.quoteComparisonResult.deleteMany({
        where: {
          comparisonId: {
            in: comparisonIds,
          },
        },
      });
    }

    await prisma.quoteComparison.deleteMany({
      where: {
        quoteRequestId,
      },
    });
    await prisma.quoteResponse.deleteMany({
      where: {
        quoteRequestId,
      },
    });
    await prisma.quoteRequestItem.deleteMany({
      where: {
        quoteRequestId,
      },
    });
    await prisma.quoteRequest.deleteMany({
      where: {
        id: quoteRequestId,
      },
    });
  }

  if (supplierIds.length > 0) {
    await prisma.supplier.deleteMany({
      where: {
        id: {
          in: supplierIds,
        },
      },
    });
  }

  if (userId) {
    await prisma.session.deleteMany({
      where: {
        userId,
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: userId,
      },
    });
  }
}
