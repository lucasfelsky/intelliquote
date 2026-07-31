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
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    supplierPortalToken: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    supplier: {
      findUnique: vi.fn(),
    },
    quoteRequest: {
      findUnique: vi.fn(),
    },
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
      create: ReturnType<typeof vi.fn>;
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

  // Teste E - criação com itens: offeredPrice = soma dos totalPrice
  it('cria proposta com itens e calcula o offeredPrice como a soma dos totais', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteResponse.create.mockResolvedValue({ id: 101 });
    prismaMock.quoteRequest.findUnique = vi.fn().mockResolvedValue({ id: 1, currency: 'USD', status: 'open' });
    prismaMock.supplier.findUnique = vi.fn().mockResolvedValue({ id: 2, status: 'active', acceptedIncoterms: ['FOB'] });

    const response = await request(app)
      .post('/api/v1/quote-responses')
      .set('Cookie', cookies)
      .send({
        quoteRequestId: 1,
        supplierId: 2,
        currency: 'USD',
        exchangeRate: 5.0,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
        items: [
          { quoteRequestItemId: 11, unitPrice: 2, quantity: 50, totalPrice: 100 },
          { quoteRequestItemId: 12, unitPrice: 5, quantity: 50, totalPrice: 250 }
        ]
      });

    expect(response.status).toBe(201);
    expect(prismaMock.quoteResponse.create).toHaveBeenCalledTimes(1);
    const createData = prismaMock.quoteResponse.create.mock.calls[0][0].data;
    
    // offeredPrice agregado deve ser a soma (100 + 250 = 350)
    expect(Number(createData.offeredPrice)).toBe(350);
    expect(createData.items.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ quoteRequestItemId: 11, unitPrice: 2, quantity: 50, totalPrice: 100 }),
        expect.objectContaining({ quoteRequestItemId: 12, unitPrice: 5, quantity: 50, totalPrice: 250 })
      ])
    );
  });

  // Teste F - targetPrice opcional persiste
  it('salva o targetPrice quando preenchido no POST e PUT', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteResponse.create.mockResolvedValue({ id: 102 });
    prismaMock.quoteRequest.findUnique = vi.fn().mockResolvedValue({ id: 1, currency: 'USD', status: 'open' });
    prismaMock.supplier.findUnique = vi.fn().mockResolvedValue({ id: 2, status: 'active', acceptedIncoterms: ['FOB'] });

    // Teste no CREATE
    const resCreate = await request(app)
      .post('/api/v1/quote-responses')
      .set('Cookie', cookies)
      .send({
        quoteRequestId: 1,
        supplierId: 2,
        currency: 'USD',
        exchangeRate: 5.0,
        offeredPrice: 100,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
        targetPrice: 12.50
      });

    expect(resCreate.status).toBe(201);
    const createData = prismaMock.quoteResponse.create.mock.calls[0][0].data;
    expect(Number(createData.targetPrice)).toBe(12.50);

    // Teste sem targetPrice não força valor
    await request(app)
      .post('/api/v1/quote-responses')
      .set('Cookie', cookies)
      .send({
        quoteRequestId: 1,
        supplierId: 2,
        currency: 'USD',
        exchangeRate: 5.0,
        offeredPrice: 100,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30
      });
    const createDataSemTarget = prismaMock.quoteResponse.create.mock.calls[1][0].data;
    expect(createDataSemTarget.targetPrice).toBeNull();
  });

  // Teste G - resposta sem itens continua funcionando (compatibilidade retroativa)
  it('usa o offeredPrice recebido no body caso não haja itens', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteResponse.create.mockResolvedValue({ id: 103 });
    prismaMock.quoteRequest.findUnique = vi.fn().mockResolvedValue({ id: 1, currency: 'USD', status: 'open' });
    prismaMock.supplier.findUnique = vi.fn().mockResolvedValue({ id: 2, status: 'active', acceptedIncoterms: ['FOB'] });

    const response = await request(app)
      .post('/api/v1/quote-responses')
      .set('Cookie', cookies)
      .send({
        quoteRequestId: 1,
        supplierId: 2,
        currency: 'USD',
        exchangeRate: 5.0,
        offeredPrice: 999.99,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30
      });

    expect(response.status).toBe(201);
    const createData = prismaMock.quoteResponse.create.mock.calls[0][0].data;
    expect(Number(createData.offeredPrice)).toBe(999.99);
    expect(createData.items).toEqual({ create: [] });
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
