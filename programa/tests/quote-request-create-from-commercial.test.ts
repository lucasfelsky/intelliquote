// POST /quote-requests com commercialRequestIds + items (PR2): cotacao, itens e vinculo
// na MESMA transacao; corrida vira 409 com rollback; caminho antigo intacto.
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

const { txMock, notifyMock, auditLogMock } = vi.hoisted(() => ({
  txMock: {
    $queryRaw: vi.fn(),
    commercialRequest: { findMany: vi.fn(), updateMany: vi.fn() },
    commercialRequestItem: { update: vi.fn() },
    quoteRequest: { create: vi.fn(), findUnique: vi.fn() },
    quoteRequestItem: { create: vi.fn() },
  },
  notifyMock: vi.fn(),
  auditLogMock: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    catalogItem: { findMany: vi.fn() },
    quoteRequest: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});

vi.mock('../src/services/AuditLogService', () => ({
  AuditLogService: { log: auditLogMock },
}));

vi.mock('../src/services/CommercialRequestNotificationService', () => ({
  CommercialRequestNotificationService: {
    notifyComexOfNewRequest: vi.fn(),
    notifyRequesterOfStatusChange: notifyMock,
  },
}));

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  catalogItem: { findMany: ReturnType<typeof vi.fn> };
  quoteRequest: { create: ReturnType<typeof vi.fn> };
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

const BODY = {
  desiredIncoterm: ['FOB'],
  currency: 'USD',
  commercialRequestIds: [7],
  items: [
    { catalogItemId: 10, quantity: 5, unit: 'KG', targetPrice: 12.5 },
    { catalogItemId: 11, quantity: 2, unit: 'TON' },
  ],
};

let cookies: string[];

beforeAll(async () => {
  cookies = await loginAs('comprador');
});

beforeEach(async () => {
  vi.clearAllMocks();
  cookies = await loginAs('comprador');
  notifyMock.mockResolvedValue(undefined);
  auditLogMock.mockResolvedValue(undefined);
  prismaMock.catalogItem.findMany.mockResolvedValue([
    { id: 10, commercialName: 'Resina X' },
    { id: 11, commercialName: 'Solvente Y' },
  ]);
  prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(txMock));

  txMock.$queryRaw.mockResolvedValue([]);
  // solicitacao 7 tem os itens 10 (casa) e 12 (o COMEX removeu da cotacao)
  txMock.commercialRequest.findMany.mockResolvedValue([
    {
      id: 7,
      status: 'pending',
      items: [
        { id: 701, catalogItemId: 10 },
        { id: 702, catalogItemId: 12 },
      ],
    },
  ]);
  txMock.commercialRequest.updateMany.mockResolvedValue({ count: 1 });
  txMock.commercialRequestItem.update.mockResolvedValue({});
  txMock.quoteRequest.create.mockResolvedValue({
    id: 50,
    requestCode: 'QR-1',
    destinationPort: null,
    desiredIncoterm: ['FOB'],
    currency: 'USD',
    deadlineAt: null,
    status: 'open',
  });
  txMock.quoteRequest.findUnique.mockResolvedValue({ id: 50, requestCode: 'QR-1', items: [] });
  let nextItemId = 500;
  txMock.quoteRequestItem.create.mockImplementation(async ({ data }: { data: { catalogItemId: number } }) => ({
    id: nextItemId++,
    catalogItemId: data.catalogItemId,
    productName: 'x',
    quantity: 1,
    unit: 'KG',
  }));
  prismaMock.quoteRequest.create.mockResolvedValue({ id: 99, requestCode: 'QR-OLD', items: [] });
});

const post = (body: unknown) =>
  request(app).post('/api/v1/quote-requests').set('Cookie', cookies).send(body as object);

describe('POST /quote-requests com solicitacoes do comercial', () => {
  it('(a) cria cotacao + itens + vinculo numa UNICA transacao e notifica depois do commit', async () => {
    const response = await post(BODY);

    expect(response.status).toBe(201);
    expect(response.body.id).toBe(50);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.quoteRequest.create).not.toHaveBeenCalled();
    expect(txMock.quoteRequest.create).toHaveBeenCalledTimes(1);
    expect(txMock.quoteRequestItem.create).toHaveBeenCalledTimes(2);

    expect(txMock.commercialRequest.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.commercialRequest.updateMany.mock.calls[0][0].where).toEqual({
      id: 7,
      status: 'pending',
    });
    expect(txMock.commercialRequest.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'quoting',
      quoteRequestId: 50,
      statusChangedById: SESSION_USER_ID,
    });
    expect(txMock.commercialRequest.updateMany.mock.calls[0][0].data.statusChangedAt).toBeInstanceOf(
      Date,
    );

    // so o item 701 (catalogItemId 10) casou; o 702 fica sem vinculo
    expect(txMock.commercialRequestItem.update).toHaveBeenCalledTimes(1);
    expect(txMock.commercialRequestItem.update.mock.calls[0][0]).toEqual({
      where: { id: 701 },
      data: { quoteRequestItemId: 500 },
    });

    const linkAudit = auditLogMock.mock.calls.find(([input]) => input.action === 'link_quote');
    expect(linkAudit?.[0]).toMatchObject({
      entityType: 'commercial_request',
      entityId: 7,
      performedById: SESSION_USER_ID,
      metadata: {
        quoteRequestId: 50,
        via: 'create',
        linkedItemIds: [701],
        unlinkedItemIds: [702],
      },
    });
    // todo audit dentro da transacao
    for (const [, client] of auditLogMock.mock.calls) expect(client).toBe(txMock);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(7, {
      status: 'quoting',
      quoteCode: 'QR-1',
      rejectionReason: null,
    });
  });

  it('R1: o audit da cotacao grava a cotacao inteira (incoterm, moeda, prazo)', async () => {
    await post(BODY);

    const audit = auditLogMock.mock.calls.find(([input]) => input.entityType === 'quote_request');
    expect(audit?.[0].action).toBe('create');
    expect(audit?.[0].afterData).toMatchObject({
      id: 50,
      requestCode: 'QR-1',
      desiredIncoterm: ['FOB'],
      currency: 'USD',
      status: 'open',
    });
    expect(audit?.[0].afterData).toHaveProperty('deadlineAt');
  });

  it('A6: transacao interativa com timeout de 15 s e maxWait', async () => {
    await post(BODY);

    const options = prismaMock.$transaction.mock.calls[0][1];
    expect(options).toMatchObject({ timeout: 15000 });
    expect(options.maxWait).toBeGreaterThan(2000);
  });

  it('A5: targetPrice com mais de 2 casas decimais -> 400', async () => {
    const response = await post({
      ...BODY,
      items: [{ catalogItemId: 10, quantity: 5, unit: 'KG', targetPrice: 1.234 }],
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('2 casas');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('A5: targetPrice com 2 casas e aceito', async () => {
    prismaMock.catalogItem.findMany.mockResolvedValue([{ id: 10, commercialName: 'Resina X' }]);
    const response = await post({
      ...BODY,
      items: [{ catalogItemId: 10, quantity: 5, unit: 'KG', targetPrice: 1.23 }],
    });
    expect(response.status).toBe(201);
  });

  it('A5: ids acima do Int do Postgres (solicitacao e item) -> 400', async () => {
    expect((await post({ ...BODY, commercialRequestIds: [2147483648] })).status).toBe(400);
    expect(
      (
        await post({
          ...BODY,
          items: [{ catalogItemId: 2147483648, quantity: 5, unit: 'KG' }],
        })
      ).status,
    ).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('item da cotacao nasce pela fabrica (nome comercial, unidade, alvo)', async () => {
    await post(BODY);

    const first = txMock.quoteRequestItem.create.mock.calls[0][0].data;
    expect(first).toMatchObject({
      quoteRequestId: 50,
      catalogItemId: 10,
      productName: 'Resina X',
      quantity: 5,
      unit: 'KG',
      targetPrice: 12.5,
    });
    const second = txMock.quoteRequestItem.create.mock.calls[1][0].data;
    expect(second).toMatchObject({ catalogItemId: 11, productName: 'Solvente Y', targetPrice: null });
  });

  it('(b) solicitacao ja em cotacao -> 409 e a cotacao NAO e criada', async () => {
    txMock.commercialRequest.findMany.mockResolvedValue([
      { id: 7, status: 'quoting', items: [{ id: 701, catalogItemId: 10 }] },
    ]);

    const response = await post(BODY);

    expect(response.status).toBe(409);
    expect(txMock.quoteRequest.create).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('(c) corrida: updateMany count 0 -> 409 (rollback) e sem notificacao', async () => {
    txMock.commercialRequest.updateMany.mockResolvedValue({ count: 0 });

    const response = await post(BODY);

    expect(response.status).toBe(409);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('(d) nenhum item casado -> 400 e nada criado', async () => {
    txMock.commercialRequest.findMany.mockResolvedValue([
      { id: 7, status: 'pending', items: [{ id: 702, catalogItemId: 12 }] },
    ]);

    const response = await post(BODY);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('#7');
    expect(txMock.quoteRequest.create).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('(e) items sem commercialRequestIds -> 400', async () => {
    const response = await post({ ...BODY, commercialRequestIds: undefined });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('juntos');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('(e) commercialRequestIds sem items -> 400', async () => {
    const response = await post({ ...BODY, items: undefined });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('juntos');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('(e) ids de solicitacao duplicados -> 400', async () => {
    const response = await post({ ...BODY, commercialRequestIds: [7, 7] });
    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('(e) catalogItemId duplicado nos itens -> 400', async () => {
    const response = await post({
      ...BODY,
      items: [
        { catalogItemId: 10, quantity: 1, unit: 'KG' },
        { catalogItemId: 10, quantity: 2, unit: 'KG' },
      ],
    });
    expect(response.status).toBe(400);
  });

  it('(e) unidade invalida / quantidade zero / mais de 20 solicitacoes -> 400', async () => {
    expect(
      (await post({ ...BODY, items: [{ catalogItemId: 10, quantity: 1, unit: 'XX' }] })).status,
    ).toBe(400);
    expect(
      (await post({ ...BODY, items: [{ catalogItemId: 10, quantity: 0, unit: 'KG' }] })).status,
    ).toBe(400);
    expect(
      (
        await post({
          ...BODY,
          commercialRequestIds: Array.from({ length: 21 }, (_, i) => i + 1),
        })
      ).status,
    ).toBe(400);
  });

  it('(f) solicitacao inexistente -> 404', async () => {
    txMock.commercialRequest.findMany.mockResolvedValue([]);

    const response = await post(BODY);

    expect(response.status).toBe(404);
    expect(txMock.quoteRequest.create).not.toHaveBeenCalled();
  });

  it('(g) sem os campos novos: caminho antigo, create fora de $transaction', async () => {
    const response = await post({ desiredIncoterm: ['FOB'], currency: 'USD' });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe(99);
    expect(prismaMock.quoteRequest.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('(g) caminho antigo com corpo invalido segue com a mensagem generica', async () => {
    const response = await post({ currency: 'USD' });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('desiredIncoterm');
  });

  it('(h) item de catalogo inativo -> 400', async () => {
    prismaMock.catalogItem.findMany.mockResolvedValue([{ id: 10, commercialName: 'Resina X' }]);

    const response = await post(BODY);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('inativo');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('(i) notificacao lancando -> 201 mesmo assim', async () => {
    notifyMock.mockRejectedValue(new Error('SMTP down'));

    const response = await post(BODY);

    expect(response.status).toBe(201);
  });

  it('varias solicitacoes: ids em ordem crescente e uma notificacao por solicitacao', async () => {
    txMock.commercialRequest.findMany.mockResolvedValue([
      { id: 9, status: 'pending', items: [{ id: 901, catalogItemId: 11 }] },
      { id: 7, status: 'pending', items: [{ id: 701, catalogItemId: 10 }] },
    ]);

    const response = await post({ ...BODY, commercialRequestIds: [9, 7] });

    expect(response.status).toBe(201);
    const order = txMock.commercialRequest.updateMany.mock.calls.map(([args]) => args.where.id);
    expect(order).toEqual([7, 9]);
    expect(notifyMock.mock.calls.map(([id]) => id)).toEqual([7, 9]);
  });

  it.each(['gestor', 'viewer', 'comercial'] as const)('(j) %s -> 403', async (role) => {
    const roleCookies = await loginAs(role);
    const response = await request(app)
      .post('/api/v1/quote-requests')
      .set('Cookie', roleCookies)
      .send(BODY);

    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
