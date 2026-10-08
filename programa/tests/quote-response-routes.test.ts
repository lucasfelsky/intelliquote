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
    quoteResponseItem: {
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

import { Prisma } from '@prisma/client';
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
  quoteResponseItem: { findMany: ReturnType<typeof vi.fn> };
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

  // R5 - edicao manual preserva/ajusta incotermPrices ao recriar itens
  describe('PUT com items preserva incotermPrices (R5)', () => {
    const previousPrices = [
      { incoterm: 'FOB', unitPrice: '10.00', totalPrice: '100.00' },
      { incoterm: 'CIF', unitPrice: '12.50', totalPrice: '125.00' },
    ];

    function mockExistingResponse() {
      prismaMock.quoteResponse.findUnique.mockResolvedValue({
        id: 55,
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
        offeredIncoterm: 'FOB',
        quoteRequest: { status: 'open' },
        supplier: { status: 'active', acceptedIncoterms: ['FOB', 'CIF', 'DDP'] },
      });
      prismaMock.quoteResponse.update.mockResolvedValue({ id: 55 });
    }

    async function putItems(
      items: Array<Record<string, unknown>>,
      extra: Record<string, unknown> = {},
    ) {
      const cookies = await loginAs('comprador');
      const response = await request(app)
        .put('/api/v1/quote-responses/55')
        .set('Cookie', cookies)
        .send({ items, ...extra });
      expect(response.status).toBe(200);
      return prismaMock.quoteResponse.update.mock.calls[0][0].data;
    }

    beforeEach(() => {
      mockExistingResponse();
      prismaMock.quoteResponseItem.findMany.mockResolvedValue([
        { quoteRequestItemId: 11, incotermPrices: previousPrices },
      ]);
    });

    it('mantem o array identico quando preco, quantidade e incoterm nao mudam', async () => {
      const data = await putItems([{ quoteRequestItemId: 11, unitPrice: 10, quantity: 10 }]);
      expect(prismaMock.quoteResponseItem.findMany).toHaveBeenCalledWith({
        where: { quoteResponseId: 55, deletedAt: null },
        select: { quoteRequestItemId: true, incotermPrices: true, originPort: true },
      });
      expect(data.items.create[0].incotermPrices).toEqual(previousPrices);
    });

    it('atualiza o incoterm principal quando o unitPrice muda', async () => {
      const data = await putItems([{ quoteRequestItemId: 11, unitPrice: 11, quantity: 10 }]);
      expect(data.items.create[0].incotermPrices).toEqual([
        { incoterm: 'FOB', unitPrice: '11.00', totalPrice: '110.00' },
        { incoterm: 'CIF', unitPrice: '12.50', totalPrice: '125.00' },
      ]);
    });

    it('recalcula o totalPrice de todas as entradas quando a quantidade muda', async () => {
      const data = await putItems([{ quoteRequestItemId: 11, unitPrice: 10, quantity: 20 }]);
      expect(data.items.create[0].incotermPrices).toEqual([
        { incoterm: 'FOB', unitPrice: '10.00', totalPrice: '200.00' },
        { incoterm: 'CIF', unitPrice: '12.50', totalPrice: '250.00' },
      ]);
    });

    it('ajusta a entrada CIF quando o incoterm principal muda para CIF', async () => {
      const data = await putItems([{ quoteRequestItemId: 11, unitPrice: 13, quantity: 10 }], {
        offeredIncoterm: 'CIF',
      });
      expect(data.items.create[0].incotermPrices).toEqual([
        { incoterm: 'FOB', unitPrice: '10.00', totalPrice: '100.00' },
        { incoterm: 'CIF', unitPrice: '13.00', totalPrice: '130.00' },
      ]);
    });

    it('acrescenta a entrada quando o novo incoterm principal nao estava na lista', async () => {
      const data = await putItems([{ quoteRequestItemId: 11, unitPrice: 15, quantity: 10 }], {
        offeredIncoterm: 'DDP',
      });
      expect(data.items.create[0].incotermPrices).toEqual([
        { incoterm: 'FOB', unitPrice: '10.00', totalPrice: '100.00' },
        { incoterm: 'CIF', unitPrice: '12.50', totalPrice: '125.00' },
        { incoterm: 'DDP', unitPrice: '15.00', totalPrice: '150.00' },
      ]);
    });

    it('nao inventa incotermPrices quando o item anterior era legado (null)', async () => {
      prismaMock.quoteResponseItem.findMany.mockResolvedValue([
        { quoteRequestItemId: 11, incotermPrices: null },
      ]);
      const data = await putItems([{ quoteRequestItemId: 11, unitPrice: 10, quantity: 10 }]);
      expect(Array.isArray(data.items.create[0].incotermPrices)).toBe(false);
    });

    it('nao inventa incotermPrices para item sem historico', async () => {
      const data = await putItems([{ quoteRequestItemId: 12, unitPrice: 10, quantity: 10 }]);
      expect(Array.isArray(data.items.create[0].incotermPrices)).toBe(false);
    });

    it('grava DbNull em todos os itens quando a currency muda (USD -> BRL)', async () => {
      const data = await putItems(
        [
          { quoteRequestItemId: 11, unitPrice: 10, quantity: 10 },
          { quoteRequestItemId: 12, unitPrice: 5, quantity: 2 },
        ],
        { currency: 'BRL' },
      );
      expect(data.items.create).toHaveLength(2);
      for (const created of data.items.create) {
        expect(created.incotermPrices).toBe(Prisma.DbNull);
      }
      expect(data.currency).toBe('BRL');
    });

    it('preserva incotermPrices quando a currency enviada e igual a atual', async () => {
      const data = await putItems([{ quoteRequestItemId: 11, unitPrice: 10, quantity: 10 }], {
        currency: 'USD',
      });
      expect(data.items.create[0].incotermPrices).toEqual(previousPrices);
    });

    it('preserva incotermPrices quando o PUT nao envia currency', async () => {
      const data = await putItems([{ quoteRequestItemId: 11, unitPrice: 10, quantity: 10 }]);
      expect(data.items.create[0].incotermPrices).toEqual(previousPrices);
    });

    describe('porto de origem por item (informativo)', () => {
      beforeEach(() => {
        prismaMock.quoteResponse.update.mockResolvedValue({ id: 55 });
        prismaMock.quoteResponse.findUnique.mockResolvedValue({
          id: 55,
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
          offeredIncoterm: 'FOB',
          originPort: 'Shanghai',
          quoteRequest: { status: 'open' },
          supplier: { status: 'active', acceptedIncoterms: ['FOB', 'CIF', 'DDP'] },
        });
        prismaMock.quoteResponseItem.findMany.mockResolvedValue([
          { quoteRequestItemId: 11, incotermPrices: previousPrices, originPort: 'Ningbo' },
        ]);
      });

      it('PUT com item sem originPort preserva a origem anterior (Ningbo)', async () => {
        const data = await putItems([{ quoteRequestItemId: 11, unitPrice: 10, quantity: 10 }]);
        expect(data.items.create[0].originPort).toBe('Ningbo');
        expect(data.originPort).toBeUndefined();
      });

      it('PUT com originPort null no item limpa (herda a geral)', async () => {
        const data = await putItems([
          { quoteRequestItemId: 11, unitPrice: 10, quantity: 10, originPort: null },
        ]);
        expect(data.items.create[0].originPort).toBeNull();
      });

      it('PUT com originPort igual a geral grava null no item', async () => {
        const data = await putItems([
          { quoteRequestItemId: 11, unitPrice: 10, quantity: 10, originPort: ' shanghai ' },
        ]);
        expect(data.items.create[0].originPort).toBeNull();
      });

      it('PUT mudando a geral para Ningbo normaliza o item Ningbo preservado para null', async () => {
        const data = await putItems([{ quoteRequestItemId: 11, unitPrice: 10, quantity: 10 }], {
          originPort: 'Ningbo',
        });
        expect(data.originPort).toBe('Ningbo');
        expect(data.items.create[0].originPort).toBeNull();
      });

      it('PUT com currency BRL mantem originPort do item e continua DbNull em incotermPrices', async () => {
        const data = await putItems([{ quoteRequestItemId: 11, unitPrice: 10, quantity: 10 }], {
          currency: 'BRL',
        });
        expect(data.items.create[0].originPort).toBe('Ningbo');
        expect(data.items.create[0].incotermPrices).toBe(Prisma.DbNull);
      });

      it('PUT so com originPort geral incrementa a versao', async () => {
        const cookies = await loginAs('comprador');
        const response = await request(app)
          .put('/api/v1/quote-responses/55')
          .set('Cookie', cookies)
          .send({ originPort: 'Busan' });
        expect(response.status).toBe(200);
        const data = prismaMock.quoteResponse.update.mock.calls[0][0].data;
        expect(data.originPort).toBe('Busan');
        expect(data.version).toEqual({ increment: 1 });
        expect(data.items).toBeUndefined();
      });

      it('PUT com originPort de 121 caracteres retorna 400', async () => {
        const cookies = await loginAs('comprador');
        const response = await request(app)
          .put('/api/v1/quote-responses/55')
          .set('Cookie', cookies)
          .send({ originPort: 'x'.repeat(121) });
        expect(response.status).toBe(400);
      });

      it('POST create normaliza a origem dos itens contra a geral', async () => {
        const cookies = await loginAs('comprador');
        prismaMock.quoteResponse.create.mockResolvedValue({ id: 105 });
        prismaMock.quoteResponse.findUnique.mockResolvedValue(null);
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
            originPort: 'Shanghai',
            items: [
              { quoteRequestItemId: 11, unitPrice: 2, quantity: 50 },
              { quoteRequestItemId: 12, unitPrice: 2, quantity: 50, originPort: 'shanghai' },
              { quoteRequestItemId: 13, unitPrice: 2, quantity: 50, originPort: 'Ningbo' },
            ],
          });

        expect(response.status).toBe(201);
        const createData = prismaMock.quoteResponse.create.mock.calls[0][0].data;
        expect(createData.originPort).toBe('Shanghai');
        expect(
          createData.items.create.map((item: { originPort: string | null }) => item.originPort),
        ).toEqual([null, null, 'Ningbo']);
      });
    });

    it('PUT sem items nao consulta itens anteriores nem recria itens', async () => {
      const cookies = await loginAs('comprador');
      const response = await request(app)
        .put('/api/v1/quote-responses/55')
        .set('Cookie', cookies)
        .send({ notes: 'ajuste' });
      expect(response.status).toBe(200);
      expect(prismaMock.quoteResponseItem.findMany).not.toHaveBeenCalled();
      expect(prismaMock.quoteResponse.update.mock.calls[0][0].data.items).toBeUndefined();
    });

    it('POST create com itens continua sem incotermPrices (NULL)', async () => {
      const cookies = await loginAs('comprador');
      prismaMock.quoteResponse.create.mockResolvedValue({ id: 104 });
      prismaMock.quoteResponse.findUnique.mockResolvedValue(null);
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
          items: [{ quoteRequestItemId: 11, unitPrice: 2, quantity: 50, totalPrice: 100 }],
        });

      expect(response.status).toBe(201);
      const createData = prismaMock.quoteResponse.create.mock.calls[0][0].data;
      expect(Array.isArray(createData.items.create[0].incotermPrices)).toBe(false);
    });
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

  const cached = cookieCache.get(role);
  if (cached) {
    return cached;
  }

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: `${role}@intelliquote.local`,
      password: 'ChangeMe123!',
    });

  const cookies = loginResponse.headers['set-cookie'];
  if (cookies) {
    cookieCache.set(role, cookies as unknown as string[]);
  }
  return cookies;
}
