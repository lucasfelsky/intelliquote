// Rotas do comercial (PR1): busca de itens, criar, listar as proprias; e leitura do COMEX.
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

const { txMock, notifyMock, auditLogMock } = vi.hoisted(() => ({
  txMock: { commercialRequest: { create: vi.fn() } },
  notifyMock: vi.fn(),
  auditLogMock: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    catalogItem: { findMany: vi.fn() },
    commercialRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prisma };
});

vi.mock('../src/services/AuditLogService', () => ({
  AuditLogService: { log: auditLogMock },
}));

vi.mock('../src/services/CommercialRequestNotificationService', () => ({
  CommercialRequestNotificationService: { notifyComexOfNewRequest: notifyMock },
}));

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Role = 'comercial' | 'viewer' | 'comprador';

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  catalogItem: { findMany: ReturnType<typeof vi.fn> };
  commercialRequest: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

const SESSION_USER_ID = 42;
const cookieCache = new Map<Role, string[]>();

async function loginAs(role: Role) {
  const passwordHash = await hashPassword('ChangeMe123!');
  const base = {
    id: SESSION_USER_ID,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: { name: role },
  };
  prismaMock.user.findUnique.mockResolvedValue({ ...base, passwordHash });
  prismaMock.user.findFirst.mockResolvedValue(base);
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });

  const cached = cookieCache.get(role);
  if (cached) return cached;

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: base.email, password: 'ChangeMe123!' });
  const cookies = loginResponse.headers['set-cookie'] as unknown as string[];
  cookieCache.set(role, cookies);
  return cookies;
}

function createdRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    status: 'pending',
    customerName: 'ACME',
    notes: null,
    rejectionReason: null,
    createdAt: new Date('2026-10-19T12:00:00Z'),
    statusChangedAt: null,
    quoteRequest: null,
    items: [
      {
        id: 1,
        catalogItemId: 10,
        quantity: 5,
        unit: 'KG',
        targetPrice: null,
        targetCurrency: null,
        catalogItem: { commercialName: 'Resina X' },
      },
    ],
    ...overrides,
  };
}

const VALID_BODY = {
  customerName: 'ACME',
  items: [{ catalogItemId: 10, quantity: 5, unit: 'KG' }],
};

let cookies: string[];

beforeAll(async () => {
  cookies = await loginAs('comercial');
});

beforeEach(async () => {
  vi.clearAllMocks();
  cookies = await loginAs('comercial');
  notifyMock.mockResolvedValue(undefined);
  auditLogMock.mockResolvedValue(undefined);
  prismaMock.catalogItem.findMany.mockResolvedValue([{ id: 10 }]);
  txMock.commercialRequest.create.mockResolvedValue(createdRow());
  prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(txMock));
  prismaMock.commercialRequest.findMany.mockResolvedValue([]);
  prismaMock.commercialRequest.count.mockResolvedValue(0);
});

describe('GET /commercial-requests/catalog-items', () => {
  it('devolve somente {id, commercialName, familyName}', async () => {
    prismaMock.catalogItem.findMany.mockResolvedValue([
      { id: 1, commercialName: 'Resina X', family: { name: 'Resinas' } },
      { id: 2, commercialName: 'Solvente Y', family: null },
    ]);

    const response = await request(app)
      .get('/api/v1/commercial-requests/catalog-items?search=re')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 1, commercialName: 'Resina X', familyName: 'Resinas' },
      { id: 2, commercialName: 'Solvente Y', familyName: null },
    ]);
    for (const item of response.body) {
      expect(Object.keys(item).sort()).toEqual(['commercialName', 'familyName', 'id']);
    }
    const json = JSON.stringify(response.body);
    expect(json).not.toContain('marketName');
    expect(json).not.toContain('dbcorpCode');
    expect(json).not.toContain('ncm');
  });

  it('consulta so ativos, por commercialName, com select explicito sem campos internos', async () => {
    await request(app)
      .get('/api/v1/commercial-requests/catalog-items?search=re')
      .set('Cookie', cookies);

    const args = prismaMock.catalogItem.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      isActive: true,
      commercialName: { contains: 're', mode: 'insensitive' },
    });
    expect(args.select).toEqual({
      id: true,
      commercialName: true,
      family: { select: { name: true } },
    });
    expect(args.take).toBe(20);
  });
});

describe('POST /commercial-requests', () => {
  it('ignora requestedById do body: usa o id da sessao', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ ...VALID_BODY, requestedById: 999 });

    expect(response.status).toBe(201);
    const data = txMock.commercialRequest.create.mock.calls[0][0].data;
    expect(data.requestedById).toBe(SESSION_USER_ID);
    expect(data.status).toBe('pending');
  });

  it('sem items ou items vazio -> 400', async () => {
    const semItems = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ customerName: 'ACME' });
    const vazio = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ items: [] });

    expect(semItems.status).toBe(400);
    expect(vazio.status).toBe(400);
    expect(txMock.commercialRequest.create).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5])('quantidade %s -> 400', async (quantity) => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ items: [{ catalogItemId: 10, quantity, unit: 'KG' }] });

    expect(response.status).toBe(400);
    expect(txMock.commercialRequest.create).not.toHaveBeenCalled();
  });

  it('quantidade acima do Int4 (2147483648) -> 400, nao 500', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ items: [{ catalogItemId: 10, quantity: 2147483648, unit: 'KG' }] });

    expect(response.status).toBe(400);
    expect(txMock.commercialRequest.create).not.toHaveBeenCalled();
  });

  it('quantidade no limite do Int4 (2147483647) e aceita', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ items: [{ catalogItemId: 10, quantity: 2147483647, unit: 'KG' }] });

    expect(response.status).toBe(201);
  });

  it('preco-alvo acima de Decimal(12,2) (10000000000) -> 400, nao 500', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ items: [{ catalogItemId: 10, quantity: 1, unit: 'KG', targetPrice: 10000000000 }] });

    expect(response.status).toBe(400);
    expect(txMock.commercialRequest.create).not.toHaveBeenCalled();
  });

  it('preco-alvo no limite (9999999999.99) e aceito', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ items: [{ catalogItemId: 10, quantity: 1, unit: 'KG', targetPrice: 9999999999.99 }] });

    expect(response.status).toBe(201);
  });

  it('unidade fora da lista -> 400', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ items: [{ catalogItemId: 10, quantity: 1, unit: 'XYZ' }] });

    expect(response.status).toBe(400);
  });

  it('item duplicado -> 400', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({
        items: [
          { catalogItemId: 10, quantity: 1, unit: 'KG' },
          { catalogItemId: 10, quantity: 2, unit: 'UN' },
        ],
      });

    expect(response.status).toBe(400);
    expect(txMock.commercialRequest.create).not.toHaveBeenCalled();
  });

  it('item inativo/inexistente -> 400', async () => {
    prismaMock.catalogItem.findMany.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send(VALID_BODY);

    expect(response.status).toBe(400);
    expect(prismaMock.catalogItem.findMany.mock.calls[0][0].where).toEqual({
      id: { in: [10] },
      isActive: true,
    });
    expect(txMock.commercialRequest.create).not.toHaveBeenCalled();
  });

  it('sem targetPrice -> 201 com moeda null', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ items: [{ catalogItemId: 10, quantity: 5, unit: 'KG', targetCurrency: 'EUR' }] });

    expect(response.status).toBe(201);
    const item = txMock.commercialRequest.create.mock.calls[0][0].data.items.create[0];
    expect(item.targetPrice).toBeNull();
    expect(item.targetCurrency).toBeNull();
  });

  it('preco sem moeda -> USD', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ items: [{ catalogItemId: 10, quantity: 5, unit: 'KG', targetPrice: 12.5 }] });

    expect(response.status).toBe(201);
    const item = txMock.commercialRequest.create.mock.calls[0][0].data.items.create[0];
    expect(item.targetPrice).toBe(12.5);
    expect(item.targetCurrency).toBe('USD');
  });

  it('preco com moeda informada preserva a moeda', async () => {
    await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({
        items: [{ catalogItemId: 10, quantity: 5, unit: 'KG', targetPrice: 3, targetCurrency: 'eur' }],
      });

    const item = txMock.commercialRequest.create.mock.calls[0][0].data.items.create[0];
    expect(item.targetCurrency).toBe('EUR');
  });

  it('grava auditoria dentro da transacao e avisa o COMEX depois', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send(VALID_BODY);

    expect(response.status).toBe(201);
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    const [input, client] = auditLogMock.mock.calls[0];
    expect(input).toMatchObject({
      entityType: 'commercial_request',
      entityId: 7,
      action: 'create',
      performedById: SESSION_USER_ID,
    });
    expect(client).toBe(txMock);
    expect(notifyMock).toHaveBeenCalledWith(7);
  });

  it('notificacao rejeitando -> 201 mesmo assim', async () => {
    notifyMock.mockRejectedValue(new Error('SMTP down'));

    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send(VALID_BODY);

    expect(response.status).toBe(201);
    expect(response.body.id).toBe(7);
  });

  it('resposta usa a projecao do comercial (sem marketName/dbcorpCode/requestedBy)', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send(VALID_BODY);

    const json = JSON.stringify(response.body);
    expect(json).not.toContain('marketName');
    expect(json).not.toContain('dbcorpCode');
    expect(json).not.toContain('requestedBy');
    expect(response.body.items[0]).toEqual({
      id: 1,
      catalogItemId: 10,
      commercialName: 'Resina X',
      quantity: 5,
      unit: 'KG',
      targetPrice: null,
      targetCurrency: null,
    });
  });
});

describe('GET /commercial-requests/mine', () => {
  it('filtra pelo usuario da sessao e ignora requestedById da query', async () => {
    await request(app)
      .get('/api/v1/commercial-requests/mine?requestedById=999&status=pending')
      .set('Cookie', cookies);

    const args = prismaMock.commercialRequest.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ requestedById: SESSION_USER_ID, status: 'pending' });
    expect(prismaMock.commercialRequest.count.mock.calls[0][0].where.requestedById).toBe(
      SESSION_USER_ID,
    );
  });

  it('usa select explicito da projecao do comercial', async () => {
    prismaMock.commercialRequest.findMany.mockResolvedValue([
      createdRow({
        status: 'quoting',
        quoteRequest: { requestCode: 'QR-1', deletedAt: null },
        items: [
          {
            id: 1,
            catalogItemId: 10,
            quantity: 5,
            unit: 'KG',
            targetPrice: { toFixed: () => '10.50' },
            targetCurrency: 'USD',
            catalogItem: { commercialName: 'Resina X' },
          },
        ],
      }),
    ]);
    prismaMock.commercialRequest.count.mockResolvedValue(1);

    const response = await request(app)
      .get('/api/v1/commercial-requests/mine')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.pagination.totalItems).toBe(1);
    const row = response.body.data[0];
    expect(row.quote).toEqual({ requestCode: 'QR-1' });
    expect(row.items[0].targetPrice).toBe('10.50');
    const json = JSON.stringify(response.body);
    expect(json).not.toContain('marketName');
    expect(json).not.toContain('dbcorpCode');
    expect(json).not.toContain('requestedBy');
    const select = prismaMock.commercialRequest.findMany.mock.calls[0][0].select;
    expect(select.requestedBy).toBeUndefined();
    expect(select.items.select.catalogItem).toEqual({ select: { commercialName: true } });
  });

  it('cotacao excluida (soft-delete) nao aparece para o comercial', async () => {
    prismaMock.commercialRequest.findMany.mockResolvedValue([
      createdRow({ quoteRequest: { requestCode: 'QR-9', deletedAt: new Date() } }),
    ]);

    const response = await request(app)
      .get('/api/v1/commercial-requests/mine')
      .set('Cookie', cookies);

    expect(response.body.data[0].quote).toBeNull();
  });
});

describe('leitura do COMEX', () => {
  it('GET /:id inexistente -> 404', async () => {
    const viewerCookies = await loginAs('viewer');
    prismaMock.commercialRequest.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/commercial-requests/12345')
      .set('Cookie', viewerCookies);

    expect(response.status).toBe(404);
  });

  it('GET /:id devolve a projecao COMEX (solicitante, nome de mercado, codigo DBCorp)', async () => {
    const viewerCookies = await loginAs('viewer');
    prismaMock.commercialRequest.findUnique.mockResolvedValue({
      ...createdRow(),
      requestedBy: { id: 3, name: 'Ana', email: 'ana@x.com' },
      statusChangedBy: null,
      quoteRequest: null,
      items: [
        {
          id: 1,
          catalogItemId: 10,
          quantity: 5,
          unit: 'KG',
          targetPrice: null,
          targetCurrency: null,
          catalogItem: { commercialName: 'Resina X', marketName: 'RX-100', dbcorpCode: 'DB1' },
        },
      ],
    });

    const response = await request(app)
      .get('/api/v1/commercial-requests/7')
      .set('Cookie', viewerCookies);

    expect(response.status).toBe(200);
    expect(response.body.requestedBy).toEqual({ id: 3, name: 'Ana', email: 'ana@x.com' });
    expect(response.body.items[0]).toMatchObject({
      commercialName: 'Resina X',
      marketName: 'RX-100',
      dbcorpCode: 'DB1',
    });
  });

  it('GET lista repassa filtros status e requestedById', async () => {
    const viewerCookies = await loginAs('viewer');

    const response = await request(app)
      .get('/api/v1/commercial-requests?status=pending&requestedById=3')
      .set('Cookie', viewerCookies);

    expect(response.status).toBe(200);
    expect(prismaMock.commercialRequest.findMany.mock.calls[0][0].where).toEqual({
      status: 'pending',
      requestedById: 3,
    });
  });

  it('GET lista com status invalido -> 400', async () => {
    const viewerCookies = await loginAs('viewer');

    const response = await request(app)
      .get('/api/v1/commercial-requests?status=xyz')
      .set('Cookie', viewerCookies);

    expect(response.status).toBe(400);
  });

  it('pending-count conta so pendentes', async () => {
    const compradorCookies = await loginAs('comprador');
    prismaMock.commercialRequest.count.mockResolvedValue(4);

    const response = await request(app)
      .get('/api/v1/commercial-requests/pending-count')
      .set('Cookie', compradorCookies);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 4 });
    expect(prismaMock.commercialRequest.count.mock.calls[0][0]).toEqual({
      where: { status: 'pending' },
    });
  });

  it('requesters devolve [{id, name}] de quem tem solicitacao', async () => {
    const compradorCookies = await loginAs('comprador');
    prismaMock.user.findMany.mockResolvedValue([{ id: 3, name: 'Ana', email: 'ana@x.com' }]);

    const response = await request(app)
      .get('/api/v1/commercial-requests/requesters')
      .set('Cookie', compradorCookies);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 3, name: 'Ana' }]);
    expect(prismaMock.user.findMany.mock.calls[0][0].where).toEqual({
      commercialRequests: { some: {} },
    });
  });
});
