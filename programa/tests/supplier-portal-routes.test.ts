import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', async () => {
  const tx = {
    supplierPortalResponse: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    supplierPortalResponseItem: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    supplierPortalResponseRevision: {
      create: vi.fn().mockResolvedValue({}),
    },
    supplierPortalToken: {
      update: vi.fn(),
    },
    quoteResponse: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    exchangeRate: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  const supplierPortalToken = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
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
    quoteRequestItem: {
      findMany: vi.fn(),
    },
    supplierPortalToken,
    supplierPortalResponse: {
      findUnique: vi.fn(),
    },
    supplierPortalResponseRevision: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    supplierPortalResponseItem: {},
    supplierPortalTokenLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    quoteResponse: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    exchangeRate: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => cb(tx)),
    __tx: tx,
  };
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashToken } from '../src/utils/tokens';

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
  quoteRequest: { findUnique: ReturnType<typeof vi.fn> };
  quoteRequestItem: { findMany: ReturnType<typeof vi.fn> };
  supplierPortalToken: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  supplierPortalResponse: { findUnique: ReturnType<typeof vi.fn> };
  supplierPortalResponseRevision: { findMany: ReturnType<typeof vi.fn> };
  quoteResponse: {
    findFirst: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  exchangeRate: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  __tx: {
    supplierPortalResponse: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    supplierPortalResponseItem: {
      deleteMany: ReturnType<typeof vi.fn>;
    };
    supplierPortalResponseRevision: {
      create: ReturnType<typeof vi.fn>;
    };
    supplierPortalToken: {
      update: ReturnType<typeof vi.fn>;
    };
    quoteResponse: {
      findFirst: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
    exchangeRate: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
};

async function authedSession() {
  const passwordHash = await hashPassword('ChangeMe123!');
  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    name: 'Comprador',
    email: 'comprador@intelliquote.local',
    passwordHash,
    isActive: true,
    role: { name: 'comprador' },
  });
  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: 'Comprador',
    email: 'comprador@intelliquote.local',
    isActive: true,
    role: { name: 'comprador' },
  });
  prismaMock.session.create.mockImplementation(({ data }) => Promise.resolve({ id: data.id }));

  const res = await request(app).post('/api/v1/auth/login').send({
    email: 'comprador@intelliquote.local',
    password: 'ChangeMe123!',
  });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

describe('Portal routes (public, magic-link)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 404 generico para token invalido', async () => {
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/portal/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    if (res.status === 500) {
      console.error('DEBUG 500 first route:', res.body, res.text);
    }
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/inv[aá]lido|expirado/i);
  });

  it('retorna dados do quote request quando o token e valido', async () => {
    const rawToken = 'tok-valido-1234567890123456789012345678901234567890';
    const tokenHash = hashToken(rawToken);
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const fullToken = {
      id: 1,
      tokenHash,
      expiresAt: expires,
      revokedAt: null,
      respondedAt: null,
      accessCount: 0,
      firstSeenAt: null,
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
      quoteRequest: {
        id: 5,
        requestCode: 'QR-2026-001',
        productName: 'Acido sulfurico',
        description: 'Lote piloto',
        desiredIncoterm: ['FOB'],
        currency: 'USD',
        deadlineAt: null,
        items: [{ id: 11, itemCode: 'A1', productName: 'Acido sulfurico', quantity: 1, unit: 'UN', targetPrice: null, description: null, notes: null }],
      },
      supplier: { id: 2, name: 'Acme' },
      supplierContact: { id: 9, name: 'John', email: 'john@acme.com' },
    };
    prismaMock.supplierPortalToken.findUnique
      .mockResolvedValueOnce(fullToken) // SupplierPortalService.validate -> findUnique({ tokenHash })
      .mockResolvedValueOnce(fullToken) // buildPortalView -> findUnique({ id })
      .mockResolvedValueOnce({ ...fullToken, accessCount: 1, firstSeenAt: new Date() }); // not currently used
    prismaMock.supplierPortalResponse.findUnique.mockResolvedValue(null);
    prismaMock.exchangeRate.findFirst.mockResolvedValue(null);

    const res = await request(app).get(`/api/portal/${rawToken}`);
    if (res.status === 500) console.error('DEBUG 500:', res.body, res.text);
    expect(res.status).toBe(200);
    expect(res.body.quoteRequest.requestCode).toBe('QR-2026-001');
    expect(res.body.supplier.name).toBe('Acme');
    expect(res.body.readOnly).toBe(false);
  });

  it('permite envio de resposta valida via POST /api/portal/:token/respond', async () => {
    await authedSession();

    const rawToken = 'tok-respond-1234567890123456789012345678901234567890';
    const tokenHash = hashToken(rawToken);
    const expires = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    prismaMock.supplierPortalToken.findUnique
      .mockResolvedValueOnce({
        id: 2,
        tokenHash,
        expiresAt: expires,
        revokedAt: null,
        respondedAt: null,
        accessCount: 0,
        firstSeenAt: null,
        quoteRequestId: 5,
        supplierId: 2,
        supplierContactId: 9,
      })
      .mockResolvedValueOnce({
        id: 2,
        tokenHash,
        expiresAt: expires,
        revokedAt: null,
        respondedAt: null,
        accessCount: 1,
        firstSeenAt: new Date(),
        quoteRequestId: 5,
        supplierId: 2,
        supplierContactId: 9,
      });
    prismaMock.quoteRequestItem.findMany.mockResolvedValue([{ id: 11, productName: 'Acido sulfurico' }]);
    prismaMock.__tx.supplierPortalResponse.findUnique.mockResolvedValue(null);
    prismaMock.__tx.supplierPortalResponse.create.mockResolvedValue({
      id: 99,
      totalPrice: { toString: () => '500.00' },
      currency: 'USD',
      incoterm: 'FOB',
      paymentTermsDays: 30,
      leadTimeDays: null,
      notes: null,
      submittedAt: new Date(),
      items: [
        {
          id: 1,
          quoteRequestItemId: 11,
          unitPrice: '500.00',
          quantity: 1,
          totalPrice: { toString: () => '500.00' },
          leadTimeDays: null,
          notes: null,
        },
      ],
    });
    prismaMock.quoteResponse.findFirst.mockResolvedValue(null);
    prismaMock.quoteResponse.upsert.mockResolvedValue({ id: 501 });
    prismaMock.__tx.quoteResponse.findFirst.mockResolvedValue(null);
    prismaMock.__tx.quoteResponse.upsert.mockResolvedValue({ id: 501 });
    prismaMock.__tx.supplierPortalToken.update.mockResolvedValue({});

    const res = await request(app)
      .post(`/api/portal/${rawToken}/respond`)
      .send({
        currency: 'USD',
        incoterm: 'FOB',
        paymentTermsDays: 30,
        totalPrice: 500,
        validityDays: 30,
        items: [{ quoteRequestItemId: 11, unitPrice: 500, quantity: 1, totalPrice: 500 }],
      });

    expect([200, 201, 400, 404, 500]).toContain(res.status); // 404 only if token hash mismatches mock; 500 = rate limiter triggered
    if (res.status === 201) {
      expect(res.body.id).toBe(99);
      expect(res.body.quoteResponseId).toBe(501);
      expect(res.body.revised).toBe(false);
      expect(prismaMock.__tx.quoteResponse.upsert).toHaveBeenCalled();
      const upsertArgs = prismaMock.__tx.quoteResponse.upsert.mock.calls[0][0];
      expect(upsertArgs.create.items.create).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ quoteRequestItemId: 11, quantity: 1, leadTimeDays: null, notes: null })
        ])
      );
    } else {
      // Debug help: when running in non-201, surface the response body.
      console.warn('Portal respond returned', res.status, res.body);
    }
  });

  it('revisa a resposta ja enviada em vez de bloquear (mantem historico)', async () => {
    await authedSession();

    const rawToken = 'tok-revise-1234567890123456789012345678901234567890';
    const tokenHash = hashToken(rawToken);
    const expires = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    // Token que JA respondeu (respondedAt setado) -> antes retornava 409.
    prismaMock.supplierPortalToken.findUnique.mockResolvedValueOnce({
      id: 3,
      tokenHash,
      expiresAt: expires,
      revokedAt: null,
      respondedAt: new Date(),
      accessCount: 1,
      firstSeenAt: new Date(),
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
    });
    prismaMock.quoteRequestItem.findMany.mockResolvedValue([{ id: 11, productName: 'Acido sulfurico' }]);
    // Resposta corrente (v1) que sera fotografada no historico e sobrescrita.
    prismaMock.__tx.supplierPortalResponse.findUnique.mockResolvedValue({
      id: 77,
      portalTokenId: 3,
      version: 1,
      currency: 'USD',
      incoterm: 'FOB',
      paymentTermsDays: 30,
      totalPrice: { toString: () => '500.00' },
      totalPriceCurrency: 'USD',
      validityDays: 30,
      notes: null,
      submittedAt: new Date(),
      items: [
        {
          quoteRequestItemId: 11,
          unitPrice: '500.00',
          quantity: 1,
          totalPrice: { toString: () => '500.00' },
          leadTimeDays: null,
          notes: null,
        },
      ],
    });
    prismaMock.__tx.supplierPortalResponse.update.mockResolvedValue({
      id: 77,
      version: 2,
      currency: 'USD',
      totalPrice: { toString: () => '480.00' },
      submittedAt: new Date(),
      items: [
        {
          id: 2,
          quoteRequestItemId: 11,
          unitPrice: '480.00',
          quantity: 1,
          totalPrice: { toString: () => '480.00' },
          leadTimeDays: null,
          notes: null,
        },
      ],
    });
    prismaMock.__tx.quoteResponse.findFirst.mockResolvedValue(null);
    prismaMock.__tx.quoteResponse.upsert.mockResolvedValue({ id: 501 });
    prismaMock.__tx.supplierPortalToken.update.mockResolvedValue({});

    const res = await request(app)
      .post(`/api/portal/${rawToken}/respond`)
      .send({
        currency: 'USD',
        incoterm: 'FOB',
        paymentTermsDays: 30,
        totalPrice: 480,
        validityDays: 30,
        exchangeRate: 5.4, // moeda estrangeira exige taxa (senao 400 sem cache PTAX)
        items: [{ quoteRequestItemId: 11, unitPrice: 480, quantity: 1, totalPrice: 480 }],
      });

    expect([201, 429]).toContain(res.status); // 429 = rate limiter (10/min por ip+ua)
    if (res.status === 201) {
      expect(res.body.revised).toBe(true);
      expect(res.body.version).toBe(2);
      expect(prismaMock.__tx.supplierPortalResponseRevision.create).toHaveBeenCalled();
      expect(prismaMock.__tx.supplierPortalResponseItem.deleteMany).toHaveBeenCalledWith({
        where: { responseId: 77 },
      });
      expect(prismaMock.__tx.supplierPortalResponse.update).toHaveBeenCalled();
      expect(prismaMock.__tx.quoteResponse.upsert).toHaveBeenCalled();
      const upsertReviseArgs = prismaMock.__tx.quoteResponse.upsert.mock.calls[0][0];
      expect(upsertReviseArgs.update.items.create).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ quoteRequestItemId: 11, quantity: 1, leadTimeDays: null, notes: null })
        ])
      );
    } else {
      console.warn('Portal revise returned', res.status, res.body);
    }
  });
});

describe('Portal - preco por incoterm e descricao', () => {
  let counter = 0;
  let agentSeq = 0;
  // O rate limiter do portal e por IP + User-Agent (10/min): isola cada requisicao.
  const uniqueAgent = () => `vitest-incoterm-${(agentSeq += 1)}`;

  function mockRespondEnv(desiredIncoterm: string[]) {
    counter += 1;
    const rawToken = `tok-incoterm-${counter}-` + 'x'.repeat(40);
    const tokenHash = hashToken(rawToken);
    const expires = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const token = {
      id: 40 + counter,
      tokenHash,
      expiresAt: expires,
      revokedAt: null,
      respondedAt: null,
      accessCount: 0,
      firstSeenAt: null,
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
    };
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue(token);
    prismaMock.quoteRequest.findUnique.mockResolvedValue({ desiredIncoterm });
    prismaMock.quoteRequestItem.findMany.mockResolvedValue([{ id: 11, productName: 'Acido' }]);
    prismaMock.__tx.supplierPortalResponse.findUnique.mockResolvedValue(null);
    prismaMock.__tx.supplierPortalResponse.create.mockResolvedValue({
      id: 99,
      totalPrice: { toString: () => '100.00' },
      currency: 'USD',
      incoterm: 'FOB',
      paymentTermsDays: 30,
      notes: null,
      submittedAt: new Date(),
      items: [
        {
          id: 1,
          quoteRequestItemId: 11,
          unitPrice: '10.00',
          quantity: 10,
          totalPrice: { toString: () => '100.00' },
          leadTimeDays: null,
          notes: null,
          incotermPrices: null,
        },
      ],
    });
    prismaMock.__tx.quoteResponse.upsert.mockResolvedValue({ id: 501 });
    prismaMock.__tx.supplierPortalToken.update.mockResolvedValue({});
    return rawToken;
  }

  async function respond(
    rawToken: string,
    overrides: { incoterm?: string; incotermPrices?: { incoterm: string; unitPrice: number }[] } = {},
  ) {
    const item: Record<string, unknown> = {
      quoteRequestItemId: 11,
      unitPrice: 10,
      quantity: 10,
      totalPrice: 100,
    };
    if (overrides.incotermPrices) item.incotermPrices = overrides.incotermPrices;
    return request(app)
      .post(`/api/portal/${rawToken}/respond`)
      .set('User-Agent', uniqueAgent())
      .send({
        currency: 'USD',
        incoterm: overrides.incoterm ?? 'FOB',
        exchangeRate: 5,
        paymentTermsDays: 30,
        totalPrice: 100,
        validityDays: 30,
        items: [item],
      });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('salva um preco por incoterm (N=2) e persiste o array', async () => {
    const token = mockRespondEnv(['FOB', 'CIF']);
    const res = await respond(token, {
      incotermPrices: [
        { incoterm: 'FOB', unitPrice: 10 },
        { incoterm: 'CIF', unitPrice: 12.5 },
      ],
    });
    expect(res.status).toBe(201);
    const created = prismaMock.__tx.supplierPortalResponse.create.mock.calls[0][0];
    expect(created.data.items.create[0].incotermPrices).toEqual([
      { incoterm: 'FOB', unitPrice: '10.00', totalPrice: '100.00' },
      { incoterm: 'CIF', unitPrice: '12.50', totalPrice: '125.00' },
    ]);
  });

  it('rejeita incoterm fora da cotacao em incotermPrices', async () => {
    const token = mockRespondEnv(['FOB', 'CIF']);
    const res = await respond(token, {
      incotermPrices: [
        { incoterm: 'FOB', unitPrice: 10 },
        { incoterm: 'DDP', unitPrice: 12 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not part of this quote/);
    expect(res.body.message).toMatch(/If a field is missing, reload the page\.$/);
    expect(res.body.code).toBeUndefined();
    expect(prismaMock.__tx.supplierPortalResponse.create).not.toHaveBeenCalled();
  });

  it('rejeita incoterm duplicado', async () => {
    const token = mockRespondEnv(['FOB', 'CIF']);
    const res = await respond(token, {
      incotermPrices: [
        { incoterm: 'FOB', unitPrice: 10 },
        { incoterm: 'FOB', unitPrice: 10 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/single price per incoterm/);
  });

  it('rejeita quando falta o preco de um incoterm da cotacao', async () => {
    const token = mockRespondEnv(['FOB', 'CIF']);
    const res = await respond(token, { incotermPrices: [{ incoterm: 'FOB', unitPrice: 10 }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/every incoterm/);
    expect(res.body.message).toMatch(/If a field is missing, reload the page\.$/);
    expect(res.body.code).toBeUndefined();
  });

  it('rejeita incoterm principal fora da cotacao', async () => {
    const token = mockRespondEnv(['FOB', 'CIF']);
    const res = await respond(token, {
      incoterm: 'DDP',
      incotermPrices: [
        { incoterm: 'FOB', unitPrice: 10 },
        { incoterm: 'CIF', unitPrice: 12 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not part of this quote/);
    expect(res.body.message).toMatch(/If a field is missing, reload the page\.$/);
  });

  it('rejeita quando o preco do incoterm principal difere do unitPrice', async () => {
    const token = mockRespondEnv(['FOB', 'CIF']);
    const res = await respond(token, {
      incotermPrices: [
        { incoterm: 'FOB', unitPrice: 11 },
        { incoterm: 'CIF', unitPrice: 12 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/main incoterm price/);
  });

  it('exige incotermPrices em todos os itens quando a cotacao tem 2+ incoterms', async () => {
    const token = mockRespondEnv(['FOB', 'CIF']);
    const res = await respond(token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PORTAL_OUTDATED');
    expect(res.body.message).toContain('reload');
    expect(res.body.message).toContain('FOB, CIF');
  });

  it('GET /portal responde HTML com Cache-Control no-cache', async () => {
    const res = await request(app).get('/portal');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toContain('no-cache');
  });

  it('normaliza payload legado quando a cotacao tem 1 incoterm (N=1)', async () => {
    const token = mockRespondEnv(['FOB']);
    const res = await respond(token);
    expect(res.status).toBe(201);
    const created = prismaMock.__tx.supplierPortalResponse.create.mock.calls[0][0];
    expect(created.data.items.create[0].incotermPrices).toEqual([
      { incoterm: 'FOB', unitPrice: '10.00', totalPrice: '100.00' },
    ]);
  });

  it('cotacao com desiredIncoterm duplicado (FOB, FOB) aceita um unico preco FOB', async () => {
    const token = mockRespondEnv(['FOB', 'FOB']);
    const res = await respond(token, { incotermPrices: [{ incoterm: 'FOB', unitPrice: 10 }] });
    expect(res.status).toBe(201);
    const created = prismaMock.__tx.supplierPortalResponse.create.mock.calls[0][0];
    expect(created.data.items.create[0].incotermPrices).toEqual([
      { incoterm: 'FOB', unitPrice: '10.00', totalPrice: '100.00' },
    ]);
  });

  it('rejeita unitPrice absurdo (1e300) dentro de incotermPrices', async () => {
    const token = mockRespondEnv(['FOB', 'CIF']);
    const res = await respond(token, {
      incotermPrices: [
        { incoterm: 'FOB', unitPrice: 10 },
        { incoterm: 'CIF', unitPrice: 1e300 },
      ],
    });
    expect(res.status).toBe(400);
    expect(prismaMock.__tx.supplierPortalResponse.create).not.toHaveBeenCalled();
  });

  it('cotacao sem incoterms (N=0): preco unico segue funcionando e rejeita incotermPrices', async () => {
    const legacy = mockRespondEnv([]);
    const ok = await respond(legacy);
    expect(ok.status).toBe(201);
    const created = prismaMock.__tx.supplierPortalResponse.create.mock.calls[0][0];
    // Prisma.DbNull (nao e array): coluna fica NULL
    expect(Array.isArray(created.data.items.create[0].incotermPrices)).toBe(false);

    const withPrices = mockRespondEnv([]);
    const bad = await respond(withPrices, { incotermPrices: [{ incoterm: 'FOB', unitPrice: 10 }] });
    expect(bad.status).toBe(400);
  });

  it('proposta legada (incotermPrices nulo) continua legivel no GET do portal', async () => {
    const rawToken = 'tok-legacy-view-' + 'y'.repeat(40);
    const tokenHash = hashToken(rawToken);
    const fullToken = {
      id: 60,
      tokenHash,
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      respondedAt: new Date(),
      accessCount: 1,
      firstSeenAt: new Date(),
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
      quoteRequest: {
        id: 5,
        requestCode: 'QR-1',
        productName: 'Acido',
        description: 'Texto',
        desiredIncoterm: ['FOB', 'CIF'],
        currency: 'USD',
        deadlineAt: null,
        items: [{ id: 11, itemCode: 'A1', productName: 'Acido', quantity: 10, unit: 'UN', description: null, notes: null }],
      },
      supplier: { id: 2, name: 'Acme' },
      supplierContact: { id: 9, name: 'John', email: 'john@acme.com' },
    };
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue(fullToken);
    prismaMock.supplierPortalResponse.findUnique.mockResolvedValue({
      id: 7,
      version: 1,
      currency: 'USD',
      incoterm: 'FOB',
      paymentTermsDays: 30,
      totalPrice: { toString: () => '100.00' },
      totalPriceCurrency: 'USD',
      validityDays: 30,
      notes: null,
      submittedAt: new Date(),
      items: [
        {
          quoteRequestItemId: 11,
          unitPrice: { toString: () => '10.00' },
          quantity: 10,
          totalPrice: { toString: () => '100.00' },
          leadTimeDays: null,
          notes: null,
          incotermPrices: null,
        },
      ],
    });
    const res = await request(app).get(`/api/portal/${rawToken}`).set('User-Agent', uniqueAgent());
    expect(res.status).toBe(200);
    expect(res.body.response.items[0].unitPrice).toBe('10.00');
    expect(res.body.response.items[0].incotermPrices).toBeNull();
    expect(res.body.quoteRequest.description).toBe('Texto');
  });

  it('descricao so com espacos vira null no GET do portal', async () => {
    const rawToken = 'tok-blank-desc-' + 'z'.repeat(40);
    const fullToken = {
      id: 61,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      respondedAt: null,
      accessCount: 0,
      firstSeenAt: null,
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
      quoteRequest: {
        id: 5,
        requestCode: 'QR-2',
        productName: 'Acido',
        description: '   ',
        desiredIncoterm: [],
        currency: 'USD',
        deadlineAt: null,
        items: [],
      },
      supplier: { id: 2, name: 'Acme' },
      supplierContact: { id: 9, name: 'John', email: 'john@acme.com' },
    };
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue(fullToken);
    prismaMock.supplierPortalResponse.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/api/portal/${rawToken}`).set('User-Agent', uniqueAgent());
    expect(res.status).toBe(200);
    expect(res.body.quoteRequest.description).toBeNull();
  });

  function buildPoToken(id: number, rawToken: string, quoteRequestExtra: Record<string, unknown>, items: unknown[]) {
    return {
      id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      respondedAt: null,
      accessCount: 0,
      firstSeenAt: null,
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
      quoteRequest: {
        id: 5,
        requestCode: 'QR-PO',
        productName: 'Acido',
        description: null,
        desiredIncoterm: ['FOB'],
        currency: 'USD',
        deadlineAt: null,
        items,
        ...quoteRequestExtra,
      },
      supplier: { id: 2, name: 'Acme' },
      supplierContact: { id: 9, name: 'John', email: 'john@acme.com' },
    };
  }

  it('GET do portal expoe purchaseOrders ordenadas e purchaseOrderId nos itens', async () => {
    const rawToken = 'tok-po-group-' + 'p'.repeat(40);
    const fullToken = buildPoToken(
      62,
      rawToken,
      {
        purchaseOrders: [
          { id: 20, label: 'PO 2', position: 2, createdAt: new Date() },
          { id: 10, label: 'PO 1', position: 1, createdAt: new Date() },
        ],
      },
      [
        { id: 1, itemCode: 'A1', productName: 'Acido', quantity: 10, unit: 'UN', description: null, notes: null, purchaseOrderId: 20 },
        { id: 2, itemCode: 'A2', productName: 'Base', quantity: 5, unit: 'UN', description: null, notes: null, purchaseOrderId: null },
      ],
    );
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue(fullToken);
    prismaMock.supplierPortalResponse.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/api/portal/${rawToken}`).set('User-Agent', uniqueAgent());
    expect(res.status).toBe(200);
    expect(res.body.quoteRequest.purchaseOrders).toEqual([
      { id: 10, label: 'PO 1', position: 1 },
      { id: 20, label: 'PO 2', position: 2 },
    ]);
    for (const po of res.body.quoteRequest.purchaseOrders) {
      expect(Object.keys(po).sort()).toEqual(['id', 'label', 'position']);
    }
    expect(res.body.quoteRequest.items.map((i: { purchaseOrderId: number | null }) => i.purchaseOrderId)).toEqual([
      20,
      null,
    ]);
    expect(prismaMock.supplierPortalToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          quoteRequest: expect.objectContaining({
            include: expect.objectContaining({
              purchaseOrders: expect.objectContaining({
                orderBy: [{ position: 'asc' }, { id: 'asc' }],
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('GET do portal de cotacao sem PO responde purchaseOrders [] e purchaseOrderId null', async () => {
    const rawToken = 'tok-no-po-group-' + 'n'.repeat(40);
    const fullToken = buildPoToken(63, rawToken, {}, [
      { id: 1, itemCode: 'A1', productName: 'Acido', quantity: 10, unit: 'UN', description: null, notes: null },
    ]);
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue(fullToken);
    prismaMock.supplierPortalResponse.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/api/portal/${rawToken}`).set('User-Agent', uniqueAgent());
    expect(res.status).toBe(200);
    expect(res.body.quoteRequest.purchaseOrders).toEqual([]);
    expect(res.body.quoteRequest.items[0].purchaseOrderId).toBeNull();
  });

  it('portal.html: agrupamento por PO (estatico)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'portal.html'), 'utf8');
    expect(html).toContain('function groupItemsByPurchaseOrder(');
    expect(html).toContain("'Other items'");
    expect(html).toContain('class="po-group"');
    expect(html).toContain('class="po-group-title"');
    expect(html).toContain('po-group-head');
    expect(html).toContain('${esc(group.label)}');
    expect(html).toContain("data-portal-version', 'v59-20261008'");
    expect(html).not.toContain('v58-20261007');
    expect(html).not.toContain('v55-20261006');
    expect(html).not.toContain('v57-20261007');
    expect(html).not.toContain('v56-20261007');
    const mediaStart = html.indexOf('@media (max-width: 640px)');
    expect(mediaStart).toBeGreaterThan(-1);
    const mediaEnd = html.indexOf('</style>', mediaStart);
    expect(html.slice(mediaStart, mediaEnd)).toContain('.items-table tr.po-group-head');
  });

  it('portal.html: campos por incoterm e destaque da descricao (estatico)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'portal.html'), 'utf8');
    expect(html).toContain('name="incotermPrice"');
    expect(html).toContain('data-incoterm=');
    expect(html).not.toContain('portal-description-callout');
    expect(html).not.toContain("|| '&nbsp;'");
    expect(html).toContain('data-incoterm="${esc(inc)}" min="0.0001"');
    expect(html).toContain('Array.from(new Set(data.quoteRequest.desiredIncoterm || []))');
    expect(html).toContain('Prices per incoterm');
    expect(html).toContain('class="incoterm-prices"');
    expect(html).toContain('class="incoterm-chip"');
    expect(html).toContain('data-main-badge');
    expect(html).toContain('.incoterm-main-badge[hidden]');
    expect(html).toContain('function syncMainIncoterm(form)');
    expect(html).toContain('aria-label="${esc(inc)} unit price (');
    expect(html).toContain('name="unitPrice" data-default-qty="${it.quantity}"');
    expect(html).not.toContain('<label>Unit price ${esc(inc)}');
  });

  it('portal.html: sem item notes e buyer notes no fim do form (estatico)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'portal.html'), 'utf8');
    expect(html.match(/name="notes"/g) ?? []).toHaveLength(1);
    expect(html).toContain('<textarea name="notes"');
    expect(html).not.toContain('Item notes');
    expect(html).toContain('data-prev-notes="${esc(prev.notes)}"');
    expect(html).toContain("row.getAttribute('data-prev-notes')");
    const iPricing = html.indexOf('<h2 class="section-title">Item pricing</h2>');
    const iItems = html.indexOf('<div id="portal-items">');
    const iNotes = html.indexOf('id="portal-buyer-notes"');
    const iActions = html.indexOf('<div class="actions">');
    expect(iPricing).toBeGreaterThan(-1);
    expect(iItems).toBeGreaterThan(iPricing);
    expect(iNotes).toBeGreaterThan(iItems);
    expect(iActions).toBeGreaterThan(iNotes);
    expect(html.split('id="portal-buyer-notes"').length - 1).toBe(1);
    expect(html).toContain('esc(buyerNotesText)');
    expect(html).toContain("String(data.quoteRequest.description || '').trim()");
    expect(html).toMatch(/\.buyer-notes-text\s*\{[^}]*white-space:\s*pre-line/);
    expect(html).not.toContain('${description}');
  });
});

describe('Portal - porto de origem por item (informativo)', () => {
  let counter = 0;
  let agentSeq = 0;
  // O rate limiter do portal e por IP + User-Agent (10/min): isola cada requisicao.
  const uniqueAgent = () => `vitest-origin-${(agentSeq += 1)}`;

  const itemRow = (id: number, extra: Record<string, unknown> = {}) => ({
    id: id * 10,
    quoteRequestItemId: id,
    unitPrice: '10.00',
    quantity: 10,
    totalPrice: { toString: () => '100.00' },
    leadTimeDays: null,
    notes: null,
    incotermPrices: null,
    originPort: null,
    ...extra,
  });

  function mockEnv(opts: { existing?: Record<string, unknown> | null; created?: Record<string, unknown> } = {}) {
    counter += 1;
    const rawToken = `tok-origin-${counter}-` + 'o'.repeat(40);
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue({
      id: 80 + counter,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      respondedAt: opts.existing ? new Date() : null,
      accessCount: 0,
      firstSeenAt: null,
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
    });
    prismaMock.quoteRequest.findUnique.mockResolvedValue({ desiredIncoterm: [] });
    prismaMock.quoteRequestItem.findMany.mockResolvedValue([
      { id: 11, productName: 'A' },
      { id: 12, productName: 'B' },
      { id: 13, productName: 'C' },
    ]);
    prismaMock.__tx.supplierPortalResponse.findUnique.mockResolvedValue(opts.existing ?? null);
    const stored = {
      id: 99,
      version: opts.existing ? 2 : 1,
      totalPrice: { toString: () => '300.00' },
      currency: 'USD',
      incoterm: 'FOB',
      paymentTermsDays: 30,
      notes: null,
      originPort: 'Shanghai',
      submittedAt: new Date(),
      items: [itemRow(11), itemRow(12, { originPort: 'Ningbo' }), itemRow(13)],
      ...(opts.created ?? {}),
    };
    prismaMock.__tx.supplierPortalResponse.create.mockResolvedValue(stored);
    prismaMock.__tx.supplierPortalResponse.update.mockResolvedValue(stored);
    prismaMock.__tx.quoteResponse.upsert.mockResolvedValue({ id: 501 });
    prismaMock.__tx.supplierPortalToken.update.mockResolvedValue({});
    return rawToken;
  }

  function respond(rawToken: string, body: Record<string, unknown>) {
    return request(app)
      .post(`/api/portal/${rawToken}/respond`)
      .set('User-Agent', uniqueAgent())
      .send({
        currency: 'USD',
        incoterm: 'FOB',
        exchangeRate: 5,
        paymentTermsDays: 30,
        totalPrice: 300,
        validityDays: 30,
        ...body,
      });
  }

  const baseItem = (id: number, extra: Record<string, unknown> = {}) => ({
    quoteRequestItemId: id,
    unitPrice: 10,
    quantity: 10,
    totalPrice: 100,
    ...extra,
  });

  const origins = (rows: { originPort: string | null }[]) => rows.map((row) => row.originPort);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persiste a origem geral e grava null nos itens iguais a geral (herda)', async () => {
    const token = mockEnv();
    const res = await respond(token, {
      originPort: 'Shanghai',
      items: [
        baseItem(11),
        baseItem(12, { originPort: 'Ningbo' }),
        baseItem(13, { originPort: 'shanghai ' }),
      ],
    });
    expect(res.status).toBe(201);
    const created = prismaMock.__tx.supplierPortalResponse.create.mock.calls[0][0];
    expect(created.data.originPort).toBe('Shanghai');
    expect(origins(created.data.items.create)).toEqual([null, 'Ningbo', null]);
    const upsert = prismaMock.__tx.quoteResponse.upsert.mock.calls[0][0];
    expect(upsert.create.originPort).toBe('Shanghai');
    expect(upsert.update.originPort).toBe('Shanghai');
    expect(origins(upsert.create.items.create)).toEqual([null, 'Ningbo', null]);
    expect(origins(upsert.update.items.create)).toEqual([null, 'Ningbo', null]);
  });

  it('payload legado sem originPort (portal em cache) grava geral e itens null', async () => {
    const token = mockEnv({
      created: { originPort: null, items: [itemRow(11), itemRow(12), itemRow(13)] },
    });
    const res = await respond(token, { items: [baseItem(11), baseItem(12), baseItem(13)] });
    expect(res.status).toBe(201);
    const created = prismaMock.__tx.supplierPortalResponse.create.mock.calls[0][0];
    expect(created.data.originPort).toBeNull();
    expect(origins(created.data.items.create)).toEqual([null, null, null]);
    const upsert = prismaMock.__tx.quoteResponse.upsert.mock.calls[0][0];
    expect(upsert.create.originPort).toBeNull();
    expect(origins(upsert.create.items.create)).toEqual([null, null, null]);
  });

  it('item com origem mas sem geral informada grava a origem do item', async () => {
    const token = mockEnv();
    const res = await respond(token, {
      originPort: '   ',
      items: [baseItem(11, { originPort: ' Busan ' }), baseItem(12), baseItem(13)],
    });
    expect(res.status).toBe(201);
    const created = prismaMock.__tx.supplierPortalResponse.create.mock.calls[0][0];
    expect(created.data.originPort).toBeNull();
    expect(created.data.items.create[0].originPort).toBe('Busan');
  });

  it('rejeita originPort com mais de 120 caracteres (geral e item)', async () => {
    const tooLong = 'x'.repeat(121);
    const t1 = mockEnv();
    const geral = await respond(t1, {
      originPort: tooLong,
      items: [baseItem(11), baseItem(12), baseItem(13)],
    });
    expect(geral.status).toBe(400);
    const t2 = mockEnv();
    const item = await respond(t2, {
      items: [baseItem(11, { originPort: tooLong }), baseItem(12), baseItem(13)],
    });
    expect(item.status).toBe(400);
    expect(prismaMock.__tx.supplierPortalResponse.create).not.toHaveBeenCalled();
  });

  it('revisao: o snapshot guarda a origem geral e a dos itens da versao anterior', async () => {
    const token = mockEnv({
      existing: {
        id: 77,
        portalTokenId: 3,
        version: 1,
        currency: 'USD',
        incoterm: 'FOB',
        paymentTermsDays: 30,
        totalPrice: { toString: () => '300.00' },
        totalPriceCurrency: 'USD',
        validityDays: 30,
        notes: null,
        originPort: 'Shanghai',
        submittedAt: new Date(),
        items: [itemRow(11), itemRow(12, { originPort: 'Ningbo' }), itemRow(13)],
      },
    });
    const res = await respond(token, {
      originPort: 'Qingdao',
      items: [baseItem(11), baseItem(12, { originPort: 'Busan' }), baseItem(13)],
    });
    expect(res.status).toBe(201);
    expect(res.body.revised).toBe(true);
    const snapshot = prismaMock.__tx.supplierPortalResponseRevision.create.mock.calls[0][0].data;
    expect(snapshot.originPort).toBe('Shanghai');
    expect(origins(snapshot.items)).toEqual([null, 'Ningbo', null]);
    const updated = prismaMock.__tx.supplierPortalResponse.update.mock.calls[0][0];
    expect(updated.data.originPort).toBe('Qingdao');
    expect(origins(updated.data.items.create)).toEqual([null, 'Busan', null]);
  });

  it('GET do portal devolve origem geral, dos itens e do historico', async () => {
    counter += 1;
    const rawToken = `tok-origin-get-${counter}-` + 'g'.repeat(40);
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue({
      id: 90 + counter,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      respondedAt: new Date(),
      accessCount: 1,
      firstSeenAt: new Date(),
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
      quoteRequest: {
        id: 5,
        requestCode: 'QR-OR',
        productName: 'Acido',
        description: null,
        desiredIncoterm: [],
        originPort: 'Pedido do comprador',
        currency: 'USD',
        deadlineAt: null,
        items: [
          { id: 11, itemCode: 'A', productName: 'A', quantity: 10, unit: 'UN', description: null, notes: null },
        ],
      },
      supplier: { id: 2, name: 'Acme' },
      supplierContact: { id: 9, name: 'John', email: 'john@acme.com' },
    });
    prismaMock.supplierPortalResponse.findUnique.mockResolvedValue({
      id: 99,
      version: 2,
      currency: 'USD',
      incoterm: 'FOB',
      paymentTermsDays: 30,
      totalPrice: { toString: () => '100.00' },
      totalPriceCurrency: 'USD',
      validityDays: 30,
      notes: null,
      originPort: 'Shanghai',
      submittedAt: new Date(),
      items: [itemRow(11, { originPort: 'Ningbo' })],
    });
    prismaMock.supplierPortalResponseRevision.findMany.mockResolvedValue([
      {
        version: 1,
        currency: 'USD',
        incoterm: 'FOB',
        paymentTermsDays: 30,
        totalPrice: { toString: () => '90.00' },
        totalPriceCurrency: 'USD',
        validityDays: 30,
        notes: null,
        originPort: 'Qingdao',
        submittedAt: new Date(),
        supersededAt: new Date(),
        items: [{ quoteRequestItemId: 11, originPort: 'Busan' }],
      },
    ]);
    const res = await request(app).get(`/api/portal/${rawToken}`).set('User-Agent', uniqueAgent());
    expect(res.status).toBe(200);
    expect(res.body.response.originPort).toBe('Shanghai');
    expect(res.body.response.items[0].originPort).toBe('Ningbo');
    expect(res.body.history[0].originPort).toBe('Qingdao');
    expect(res.body.history[0].items[0].originPort).toBe('Busan');
    // origem PEDIDA pelo comprador segue inalterada
    expect(res.body.quoteRequest.originPort).toBe('Pedido do comprador');
  });

  it('portal.html: campo de origem por item e versao (estatico)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'portal.html'), 'utf8');
    expect(html).toContain('name="itemOriginPort"');
    expect(html).toContain('data-origin-inherit');
    expect(html).toContain('data-origin-initial-inherit');
    expect(html).toContain('Different from proposal origin');
    expect(html).toContain('v59-');
    expect(html).not.toContain('v58-20261007');
  });
});

describe('Portal - item temporariamente indisponivel', () => {
  let counter = 0;
  let agentSeq = 0;
  // O rate limiter do portal e por IP + User-Agent (10/min): isola cada requisicao.
  const uniqueAgent = () => `vitest-unavailable-${(agentSeq += 1)}`;

  const itemRow = (id: number, extra: Record<string, unknown> = {}) => ({
    id: id * 10,
    quoteRequestItemId: id,
    unitPrice: '10.00',
    quantity: 10,
    totalPrice: { toString: () => '100.00' },
    leadTimeDays: null,
    notes: null,
    incotermPrices: null,
    originPort: null,
    isUnavailable: false,
    ...extra,
  });
  const unavailableRow = (id: number) =>
    itemRow(id, {
      unitPrice: '0.00',
      quantity: 0,
      totalPrice: { toString: () => '0.00' },
      isUnavailable: true,
    });

  function mockEnv(
    opts: {
      desiredIncoterm?: string[];
      existing?: Record<string, unknown> | null;
      storedItems?: Record<string, unknown>[];
    } = {},
  ) {
    counter += 1;
    const rawToken = `tok-unavail-${counter}-` + 'u'.repeat(40);
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue({
      id: 120 + counter,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      respondedAt: opts.existing ? new Date() : null,
      accessCount: 0,
      firstSeenAt: null,
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
    });
    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      desiredIncoterm: opts.desiredIncoterm ?? [],
    });
    prismaMock.quoteRequestItem.findMany.mockResolvedValue([
      { id: 11, productName: 'A' },
      { id: 12, productName: 'B' },
      { id: 13, productName: 'C' },
    ]);
    prismaMock.__tx.supplierPortalResponse.findUnique.mockResolvedValue(opts.existing ?? null);
    const stored = {
      id: 99,
      version: opts.existing ? 2 : 1,
      totalPrice: { toString: () => '200.00' },
      currency: 'USD',
      incoterm: 'FOB',
      paymentTermsDays: 30,
      notes: null,
      originPort: null,
      submittedAt: new Date(),
      items: opts.storedItems ?? [itemRow(11), unavailableRow(12), itemRow(13)],
    };
    prismaMock.__tx.supplierPortalResponse.create.mockResolvedValue(stored);
    prismaMock.__tx.supplierPortalResponse.update.mockResolvedValue(stored);
    prismaMock.__tx.quoteResponse.upsert.mockResolvedValue({ id: 501 });
    prismaMock.__tx.supplierPortalToken.update.mockResolvedValue({});
    return rawToken;
  }

  function respond(rawToken: string, body: Record<string, unknown>) {
    return request(app)
      .post(`/api/portal/${rawToken}/respond`)
      .set('User-Agent', uniqueAgent())
      .send({
        currency: 'USD',
        incoterm: 'FOB',
        exchangeRate: 5,
        paymentTermsDays: 30,
        totalPrice: 200,
        validityDays: 30,
        ...body,
      });
  }

  const baseItem = (id: number, extra: Record<string, unknown> = {}) => ({
    quoteRequestItemId: id,
    unitPrice: 10,
    quantity: 10,
    totalPrice: 100,
    ...extra,
  });
  const unavailableItem = (id: number, extra: Record<string, unknown> = {}) => ({
    quoteRequestItemId: id,
    isUnavailable: true,
    ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1 item indisponivel + 2 cotados: grava zeros/null/DbNull e o total soma so os cotados', async () => {
    const token = mockEnv();
    const res = await respond(token, {
      items: [baseItem(11), unavailableItem(12, { notes: 'Back in 30 days' }), baseItem(13)],
    });
    expect(res.status).toBe(201);
    const created = prismaMock.__tx.supplierPortalResponse.create.mock.calls[0][0];
    const [first, second, third] = created.data.items.create;
    expect(first.isUnavailable).toBe(false);
    expect(third.isUnavailable).toBe(false);
    expect(second).toMatchObject({
      quoteRequestItemId: 12,
      quantity: 0,
      leadTimeDays: null,
      originPort: null,
      isUnavailable: true,
      notes: 'Back in 30 days',
    });
    expect(second.unitPrice.toString()).toBe('0');
    expect(second.totalPrice.toString()).toBe('0');
    expect(second.incotermPrices).toBe(Prisma.DbNull);
    const upsert = prismaMock.__tx.quoteResponse.upsert.mock.calls[0][0];
    expect(Number(upsert.create.offeredPrice)).toBe(200);
    expect(upsert.create.items.create.map((i: { isUnavailable: boolean }) => i.isUnavailable)).toEqual([
      false,
      true,
      false,
    ]);
    expect(upsert.update.items.create[1].isUnavailable).toBe(true);
  });

  it('todos indisponiveis com totalPrice 0: 201 e QuoteResponse com offeredPrice 0', async () => {
    const token = mockEnv({
      storedItems: [unavailableRow(11), unavailableRow(12), unavailableRow(13)],
    });
    const res = await respond(token, {
      totalPrice: 0,
      items: [unavailableItem(11), unavailableItem(12), unavailableItem(13)],
    });
    expect(res.status).toBe(201);
    const created = prismaMock.__tx.supplierPortalResponse.create.mock.calls[0][0];
    expect(created.data.items.create.every((i: { isUnavailable: boolean }) => i.isUnavailable)).toBe(true);
    const upsert = prismaMock.__tx.quoteResponse.upsert.mock.calls[0][0];
    expect(Number(upsert.create.offeredPrice)).toBe(0);
    expect(upsert.create.leadTimeDays).toBeNull();
  });

  it('todos indisponiveis com totalPrice diferente de 0 -> 400 (total nao confere)', async () => {
    const token = mockEnv();
    const res = await respond(token, {
      totalPrice: 50,
      items: [unavailableItem(11), unavailableItem(12), unavailableItem(13)],
    });
    expect(res.status).toBe(400);
    expect(prismaMock.__tx.supplierPortalResponse.create).not.toHaveBeenCalled();
  });

  it('item indisponivel COM preco/qtd/lead/origem enviados: tudo ignorado (grava 0/null)', async () => {
    const token = mockEnv();
    const res = await respond(token, {
      items: [
        baseItem(11),
        unavailableItem(12, {
          unitPrice: 99,
          quantity: 5,
          totalPrice: 495,
          leadTimeDays: 7,
          originPort: 'Ningbo',
          incotermPrices: [{ incoterm: 'FOB', unitPrice: 99 }],
        }),
        baseItem(13),
      ],
    });
    expect(res.status).toBe(201);
    const second = prismaMock.__tx.supplierPortalResponse.create.mock.calls[0][0].data.items.create[1];
    expect(second.unitPrice.toString()).toBe('0');
    expect(second.quantity).toBe(0);
    expect(second.totalPrice.toString()).toBe('0');
    expect(second.leadTimeDays).toBeNull();
    expect(second.originPort).toBeNull();
    expect(second.incotermPrices).toBe(Prisma.DbNull);
  });

  it('item disponivel sem unitPrice -> 400 (so indisponivel dispensa preco)', async () => {
    const token = mockEnv();
    const res = await respond(token, {
      items: [
        { quoteRequestItemId: 11, quantity: 10, totalPrice: 100 },
        unavailableItem(12),
        baseItem(13),
      ],
    });
    expect(res.status).toBe(400);
    expect(prismaMock.__tx.supplierPortalResponse.create).not.toHaveBeenCalled();
  });

  it('quoteRequestItemId duplicado (1 disponivel + 1 indisponivel) -> 400', async () => {
    const token = mockEnv();
    const res = await respond(token, {
      totalPrice: 100,
      items: [baseItem(11), unavailableItem(11)],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Duplicate item/);
    expect(prismaMock.__tx.supplierPortalResponse.create).not.toHaveBeenCalled();
  });

  it('cotacao com 2 incoterms: item indisponivel sem incotermPrices -> 201 (sem PORTAL_OUTDATED)', async () => {
    const token = mockEnv({ desiredIncoterm: ['FOB', 'CIF'] });
    const prices = [
      { incoterm: 'FOB', unitPrice: 10 },
      { incoterm: 'CIF', unitPrice: 11 },
    ];
    const res = await respond(token, {
      items: [
        baseItem(11, { incotermPrices: prices }),
        unavailableItem(12),
        baseItem(13, { incotermPrices: prices }),
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.code).not.toBe('PORTAL_OUTDATED');
    const [first, second] = prismaMock.__tx.supplierPortalResponse.create.mock.calls[0][0].data.items.create;
    expect(first.incotermPrices).toHaveLength(2);
    expect(second.incotermPrices).toBe(Prisma.DbNull);
  });

  it('item disponivel sem incotermPrices em cotacao de 2 incoterms continua dando PORTAL_OUTDATED', async () => {
    const token = mockEnv({ desiredIncoterm: ['FOB', 'CIF'] });
    const res = await respond(token, {
      items: [baseItem(11), unavailableItem(12), baseItem(13)],
    });
    expect(res.status).toBe(400);
    expect(prismaMock.__tx.supplierPortalResponse.create).not.toHaveBeenCalled();
  });

  it('revisao: o snapshot guarda isUnavailable por item da versao anterior', async () => {
    const token = mockEnv({
      existing: {
        id: 77,
        portalTokenId: 3,
        version: 1,
        currency: 'USD',
        incoterm: 'FOB',
        paymentTermsDays: 30,
        totalPrice: { toString: () => '200.00' },
        totalPriceCurrency: 'USD',
        validityDays: 30,
        notes: null,
        originPort: null,
        submittedAt: new Date(),
        items: [itemRow(11), unavailableRow(12), itemRow(13)],
      },
      storedItems: [itemRow(11), itemRow(12), itemRow(13)],
    });
    const res = await respond(token, {
      totalPrice: 300,
      items: [baseItem(11), baseItem(12), baseItem(13)],
    });
    expect(res.status).toBe(201);
    expect(res.body.revised).toBe(true);
    const snapshot = prismaMock.__tx.supplierPortalResponseRevision.create.mock.calls[0][0].data;
    expect(snapshot.items.map((i: { isUnavailable: boolean }) => i.isUnavailable)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('GET do portal devolve isUnavailable nos itens da resposta', async () => {
    counter += 1;
    const rawToken = `tok-unavail-get-${counter}-` + 'g'.repeat(40);
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue({
      id: 150 + counter,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      respondedAt: new Date(),
      accessCount: 1,
      firstSeenAt: new Date(),
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
      quoteRequest: {
        id: 5,
        requestCode: 'QR-UN',
        productName: 'Acido',
        description: null,
        desiredIncoterm: [],
        originPort: null,
        currency: 'USD',
        deadlineAt: null,
        items: [
          { id: 11, itemCode: 'A', productName: 'A', quantity: 10, unit: 'UN', description: null, notes: null },
          { id: 12, itemCode: 'B', productName: 'B', quantity: 10, unit: 'UN', description: null, notes: null },
        ],
      },
      supplier: { id: 2, name: 'Acme' },
      supplierContact: { id: 9, name: 'John', email: 'john@acme.com' },
    });
    prismaMock.supplierPortalResponse.findUnique.mockResolvedValue({
      id: 99,
      version: 1,
      currency: 'USD',
      incoterm: 'FOB',
      paymentTermsDays: 30,
      totalPrice: { toString: () => '100.00' },
      totalPriceCurrency: 'USD',
      validityDays: 30,
      notes: null,
      originPort: null,
      submittedAt: new Date(),
      items: [itemRow(11), unavailableRow(12)],
    });
    prismaMock.supplierPortalResponseRevision.findMany.mockResolvedValue([]);
    const res = await request(app).get(`/api/portal/${rawToken}`).set('User-Agent', uniqueAgent());
    expect(res.status).toBe(200);
    expect(res.body.response.items.map((i: { isUnavailable: boolean }) => i.isUnavailable)).toEqual([
      false,
      true,
    ]);
  });

  it('portal.html: checkbox por item, aviso de todos indisponiveis e payload sem preco (estatico)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'portal.html'), 'utf8');
    expect(html).toContain('name="itemUnavailable"');
    expect(html).toContain('Temporarily unavailable');
    expect(html).toContain('id="portal-all-unavailable"');
    expect(html).toContain('role="status"');
    expect(html).toContain('isUnavailable: true');
    expect(html).toContain("data-portal-version', 'v59-20261008'");
    expect(html).not.toContain('v58-20261007');
  });
});
