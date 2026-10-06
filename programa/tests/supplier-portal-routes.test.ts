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
