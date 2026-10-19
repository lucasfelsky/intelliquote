// Acoes do COMEX sobre solicitacoes do comercial (PR2): link-quote, reject, fulfill.
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

const { txMock, notifyMock, auditLogMock } = vi.hoisted(() => ({
  txMock: {
    $queryRaw: vi.fn(),
    quoteRequest: { findFirst: vi.fn() },
    commercialRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
    commercialRequestItem: { update: vi.fn() },
    quoteRequestItem: { findMany: vi.fn(), create: vi.fn() },
    catalogItem: { findMany: vi.fn() },
    quoteResponse: { count: vi.fn(), findMany: vi.fn() },
    creditSupportRequest: { count: vi.fn(), findMany: vi.fn() },
  },
  notifyMock: vi.fn(),
  auditLogMock: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    commercialRequest: { findUnique: vi.fn() },
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
  commercialRequest: { findUnique: ReturnType<typeof vi.fn> };
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

function comexRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    status: 'quoting',
    customerName: 'ACME',
    notes: null,
    rejectionReason: null,
    fulfillmentNote: null,
    createdAt: new Date('2026-10-19T12:00:00Z'),
    statusChangedAt: new Date('2026-10-20T12:00:00Z'),
    requestedBy: { id: 3, name: 'Ana', email: 'ana@x.com' },
    statusChangedBy: { id: SESSION_USER_ID, name: 'COMEX' },
    quoteRequest: { id: 50, requestCode: 'QR-1', status: 'open', deletedAt: null },
    items: [
      {
        id: 91,
        catalogItemId: 10,
        quantity: 5,
        unit: 'KG',
        targetPrice: null,
        targetCurrency: null,
        quoteRequestItemId: 501,
        catalogItem: { commercialName: 'Resina X', marketName: 'Mkt X', dbcorpCode: 'D1' },
      },
    ],
    ...overrides,
  };
}

// O mock de usuario e global: a sessao e resolvida pelo ULTIMO loginAs; cada chamada refaz o login do papel.
const post = async (role: Role, path: string, body: unknown = {}) => {
  const cookies = await loginAs(role);
  return request(app)
    .post(`/api/v1/commercial-requests/${path}`)
    .set('Cookie', cookies)
    .send(body as object);
};

beforeAll(async () => {
  await loginAs('admin');
  await loginAs('comprador');
});

beforeEach(async () => {
  vi.clearAllMocks();
  notifyMock.mockResolvedValue(undefined);
  auditLogMock.mockResolvedValue(undefined);
  prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(txMock));
  prismaMock.commercialRequest.findUnique.mockResolvedValue(comexRow());

  txMock.$queryRaw.mockResolvedValue([]);
  txMock.quoteRequest.findFirst.mockResolvedValue({
    id: 50,
    status: 'open',
    currency: 'USD',
    destinationPort: 'Santos',
    requestCode: 'QR-50',
  });
  txMock.commercialRequest.findUnique.mockResolvedValue({
    id: 9,
    status: 'pending',
    quoteRequestId: null,
    quoteRequest: null,
    items: [
      {
        id: 91,
        catalogItemId: 10,
        quantity: 5,
        unit: 'KG',
        targetPrice: { toString: () => '12.50' },
        targetCurrency: 'USD',
      },
    ],
  });
  txMock.commercialRequest.updateMany.mockResolvedValue({ count: 1 });
  txMock.commercialRequestItem.update.mockResolvedValue({});
  txMock.quoteRequestItem.findMany.mockResolvedValue([]);
  txMock.quoteRequestItem.create.mockResolvedValue({
    id: 600,
    catalogItemId: 10,
    productName: 'Resina X',
    quantity: 5,
    unit: 'KG',
  });
  txMock.catalogItem.findMany.mockResolvedValue([{ id: 10, commercialName: 'Resina X' }]);
  txMock.quoteResponse.count.mockResolvedValue(0);
  txMock.creditSupportRequest.count.mockResolvedValue(0);
  txMock.quoteResponse.findMany.mockResolvedValue([]);
  txMock.creditSupportRequest.findMany.mockResolvedValue([]);
});

describe('permissoes das acoes', () => {
  const routes: Array<[string, unknown]> = [
    ['9/link-quote', { quoteRequestId: 50 }],
    ['9/reject', { reason: 'Fora do portfolio' }],
    ['9/fulfill', {}],
  ];

  for (const [route, body] of routes) {
    it.each(['gestor', 'viewer', 'comercial'] as const)(`${route}: %s -> 403`, async (role) => {
      const response = await post(role, route, body);
      expect(response.status).toBe(403);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it(`${route}: sem sessao -> 401`, async () => {
      const response = await request(app)
        .post(`/api/v1/commercial-requests/${route}`)
        .send(body as object);
      expect(response.status).toBe(401);
    });
  }

  it('admin e comprador alcancam o handler', async () => {
    txMock.commercialRequest.findUnique.mockResolvedValue({
      id: 9,
      status: 'pending',
      items: [],
    });
    for (const role of ['admin', 'comprador'] as const) {
      const response = await post(role, '9/reject', { reason: 'Fora do portfolio' });
      expect(response.status).toBe(200);
    }
  });

  it('id invalido -> 400', async () => {
    const response = await post('admin', 'abc/reject', { reason: 'Fora do portfolio' });
    expect(response.status).toBe(400);
  });
});

describe('POST /commercial-requests/:id/link-quote', () => {
  it('trava a cotacao ANTES de mudar a solicitacao e responde com a projecao COMEX', async () => {
    const response = await post('comprador', '9/link-quote', { quoteRequestId: 50 });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(9);
    expect(response.body.items[0].quoteRequestItemId).toBe(501);
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(txMock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.commercialRequest.updateMany.mock.invocationCallOrder[0],
    );
    expect(txMock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.quoteRequest.findFirst.mock.invocationCallOrder[0],
    );
    expect(txMock.commercialRequest.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 9, status: 'pending' },
      data: { status: 'quoting', quoteRequestId: 50, statusChangedById: SESSION_USER_ID },
    });
    expect(notifyMock).toHaveBeenCalledWith(9, {
      status: 'quoting',
      quoteCode: 'QR-50',
      rejectionReason: null,
    });
    // transacao interativa com lock: timeout maior que o padrao de 5 s
    expect(prismaMock.$transaction.mock.calls[0][1]).toMatchObject({ timeout: 15000 });
    expect(prismaMock.$transaction.mock.calls[0][1].maxWait).toBeGreaterThan(2000);
  });

  it('cotacao fechada -> 409', async () => {
    txMock.quoteRequest.findFirst.mockResolvedValue({
      id: 50,
      status: 'closed',
      currency: 'USD',
      destinationPort: null,
    });
    const response = await post('admin', '9/link-quote', { quoteRequestId: 50 });
    expect(response.status).toBe(409);
    expect(txMock.commercialRequest.updateMany).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('cotacao excluida/inexistente -> 404 e filtra deletedAt', async () => {
    txMock.quoteRequest.findFirst.mockResolvedValue(null);
    const response = await post('admin', '9/link-quote', { quoteRequestId: 50 });
    expect(response.status).toBe(404);
    expect(txMock.quoteRequest.findFirst.mock.calls[0][0].where).toEqual({
      id: 50,
      deletedAt: null,
    });
  });

  it('solicitacao inexistente -> 404', async () => {
    prismaMock.commercialRequest.findUnique.mockResolvedValueOnce(null);
    const response = await post('admin', '9/link-quote', { quoteRequestId: 50 });
    expect(response.status).toBe(404);
  });

  it('solicitacao fora de pending -> 409', async () => {
    txMock.commercialRequest.findUnique.mockResolvedValue({ id: 9, status: 'quoting', items: [] });
    const response = await post('admin', '9/link-quote', { quoteRequestId: 50 });
    expect(response.status).toBe(409);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('corrida: updateMany count 0 -> 409 sem criar item nem notificar', async () => {
    txMock.commercialRequest.updateMany.mockResolvedValue({ count: 0 });
    const response = await post('admin', '9/link-quote', { quoteRequestId: 50 });
    expect(response.status).toBe(409);
    expect(txMock.quoteRequestItem.create).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('cotacao ja tem o item (mesmo catalogItemId): reaproveita sem criar nem alterar', async () => {
    txMock.quoteRequestItem.findMany.mockResolvedValue([{ id: 77, catalogItemId: 10 }]);

    const response = await post('admin', '9/link-quote', { quoteRequestId: 50 });

    expect(response.status).toBe(200);
    expect(txMock.quoteRequestItem.create).not.toHaveBeenCalled();
    expect(txMock.commercialRequestItem.update).toHaveBeenCalledWith({
      where: { id: 91 },
      data: { quoteRequestItemId: 77 },
    });
    expect(txMock.quoteRequestItem.findMany.mock.calls[0][0].where).toMatchObject({
      quoteRequestId: 50,
      deletedAt: null,
    });
    const audit = auditLogMock.mock.calls.find(([input]) => input.action === 'link_quote');
    expect(audit?.[0].metadata).toMatchObject({ via: 'link', reusedItemIds: [77], createdItemIds: [] });
  });

  it('sem item igual: cria pela fabrica, sem PO, e vincula', async () => {
    const response = await post('admin', '9/link-quote', { quoteRequestId: 50 });

    expect(response.status).toBe(200);
    expect(txMock.quoteRequestItem.create).toHaveBeenCalledTimes(1);
    expect(txMock.quoteRequestItem.create.mock.calls[0][0].data).toMatchObject({
      quoteRequestId: 50,
      catalogItemId: 10,
      productName: 'Resina X',
      quantity: 5,
      unit: 'KG',
      destinationPort: 'Santos',
      purchaseOrderId: null,
    });
    expect(txMock.commercialRequestItem.update).toHaveBeenCalledWith({
      where: { id: 91 },
      data: { quoteRequestItemId: 600 },
    });
  });

  it('targetPrice so e copiado com a mesma moeda da cotacao', async () => {
    await post('admin', '9/link-quote', { quoteRequestId: 50 });
    expect(txMock.quoteRequestItem.create.mock.calls[0][0].data.targetPrice).toBe(12.5);

    vi.clearAllMocks();
    txMock.quoteRequest.findFirst.mockResolvedValue({
      id: 50,
      status: 'open',
      currency: 'EUR',
      destinationPort: null,
    });
    txMock.quoteRequestItem.findMany.mockResolvedValue([]);
    txMock.quoteRequestItem.create.mockResolvedValue({ id: 601, catalogItemId: 10 });
    txMock.catalogItem.findMany.mockResolvedValue([{ id: 10, commercialName: 'Resina X' }]);
    txMock.commercialRequest.findUnique.mockResolvedValue({
      id: 9,
      status: 'pending',
      items: [
        {
          id: 91,
          catalogItemId: 10,
          quantity: 5,
          unit: 'KG',
          targetPrice: { toString: () => '12.50' },
          targetCurrency: 'USD',
        },
      ],
    });
    txMock.commercialRequest.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(txMock));
    prismaMock.commercialRequest.findUnique.mockResolvedValue(comexRow());
    auditLogMock.mockResolvedValue(undefined);
    notifyMock.mockResolvedValue(undefined);

    await post('admin', '9/link-quote', { quoteRequestId: 50 });
    expect(txMock.quoteRequestItem.create.mock.calls[0][0].data.targetPrice).toBeNull();
  });

  it('item de catalogo inativo -> 400 e nada gravado', async () => {
    txMock.catalogItem.findMany.mockResolvedValue([]);
    const response = await post('admin', '9/link-quote', { quoteRequestId: 50 });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('inativo');
    expect(txMock.commercialRequest.updateMany).not.toHaveBeenCalled();
    expect(txMock.quoteRequestItem.create).not.toHaveBeenCalled();
  });

  it('corpo sem quoteRequestId -> 400', async () => {
    const response = await post('admin', '9/link-quote', {});
    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('audit link_quote recebe o tx como 2o argumento', async () => {
    await post('admin', '9/link-quote', { quoteRequestId: 50 });
    expect(auditLogMock.mock.calls.length).toBeGreaterThan(0);
    for (const [, client] of auditLogMock.mock.calls) expect(client).toBe(txMock);
  });
});

describe('POST /commercial-requests/:id/reject', () => {
  it.each(['', 'ab', 'x'.repeat(501)])('motivo invalido (%#) -> 400', async (reason) => {
    const response = await post('admin', '9/reject', { reason });
    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('sem motivo -> 400', async () => {
    const response = await post('admin', '9/reject', {});
    expect(response.status).toBe(400);
  });

  it.each(['pending', 'quoting'])('%s -> rejected com motivo e auditoria', async (status) => {
    txMock.commercialRequest.findUnique.mockResolvedValue({ id: 9, status });
    prismaMock.commercialRequest.findUnique.mockResolvedValue(
      comexRow({ status: 'rejected', rejectionReason: 'Fora do portfolio' }),
    );

    const response = await post('admin', '9/reject', { reason: '  Fora do portfolio  ' });

    expect(response.status).toBe(200);
    expect(response.body.rejectionReason).toBe('Fora do portfolio');
    expect(response.body.status).toBe('rejected');
    const args = txMock.commercialRequest.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: 9, status: { in: ['pending', 'quoting'] } });
    expect(args.data).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Fora do portfolio',
      statusChangedById: SESSION_USER_ID,
    });
    expect(args.data.statusChangedAt).toBeInstanceOf(Date);
    const [input, client] = auditLogMock.mock.calls[0];
    expect(input).toMatchObject({ entityType: 'commercial_request', action: 'reject', entityId: 9 });
    expect(client).toBe(txMock);
    expect(notifyMock).toHaveBeenCalledWith(9, {
      status: 'rejected',
      quoteCode: null,
      rejectionReason: 'Fora do portfolio',
    });
  });

  it('fulfilled -> 409', async () => {
    txMock.commercialRequest.findUnique.mockResolvedValue({ id: 9, status: 'fulfilled' });
    txMock.commercialRequest.updateMany.mockResolvedValue({ count: 0 });
    const response = await post('admin', '9/reject', { reason: 'Fora do portfolio' });
    expect(response.status).toBe(409);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('corrida (count 0) -> 409', async () => {
    txMock.commercialRequest.findUnique.mockResolvedValue({ id: 9, status: 'pending' });
    txMock.commercialRequest.updateMany.mockResolvedValue({ count: 0 });
    const response = await post('admin', '9/reject', { reason: 'Fora do portfolio' });
    expect(response.status).toBe(409);
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it('inexistente -> 404', async () => {
    txMock.commercialRequest.findUnique.mockResolvedValue(null);
    const response = await post('admin', '9/reject', { reason: 'Fora do portfolio' });
    expect(response.status).toBe(404);
  });

  it('notificacao lancando -> 200 mesmo assim', async () => {
    txMock.commercialRequest.findUnique.mockResolvedValue({ id: 9, status: 'pending' });
    notifyMock.mockRejectedValue(new Error('SMTP down'));
    const response = await post('admin', '9/reject', { reason: 'Fora do portfolio' });
    expect(response.status).toBe(200);
  });
});

describe('POST /commercial-requests/:id/fulfill', () => {
  function quotingRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 9,
      status: 'quoting',
      quoteRequestId: 50,
      quoteRequest: { requestCode: 'QR-50', deletedAt: null },
      items: [{ id: 91, quoteRequestItemId: 501 }],
      ...overrides,
    };
  }

  // Resposta vencedora com preco efetivo para o item vinculado 501.
  function pricedWinner(overrides: Record<string, unknown> = {}) {
    return {
      quoteRequestId: 50,
      currency: 'USD',
      offeredIncoterm: 'FOB',
      items: [
        {
          quoteRequestItemId: 501,
          unitPrice: 2,
          isUnavailable: false,
          quoteRequestItem: { unit: 'KG' },
        },
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    txMock.commercialRequest.findUnique.mockResolvedValue(quotingRow());
  });

  it('pending -> 409', async () => {
    txMock.commercialRequest.findUnique.mockResolvedValue(quotingRow({ status: 'pending' }));
    const response = await post('admin', '9/fulfill', {});
    expect(response.status).toBe(409);
  });

  it('comprador sem vencedor -> 409 pedindo o vencedor', async () => {
    const response = await post('comprador', '9/fulfill', {});
    expect(response.status).toBe(409);
    expect(response.body.message).toContain('vencedor');
    expect(txMock.commercialRequest.updateMany).not.toHaveBeenCalled();
  });

  it('comprador com force -> 403', async () => {
    const response = await post('comprador', '9/fulfill', { force: true, note: 'sem preco mesmo' });
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('comprador com force e sem nota -> 403 (nao 400)', async () => {
    const response = await post('comprador', '9/fulfill', { force: true });
    expect(response.status).toBe(403);
  });

  it('admin sem vencedor e sem force -> 409', async () => {
    const response = await post('admin', '9/fulfill', {});
    expect(response.status).toBe(409);
    expect(response.body.message).toContain('vencedor');
  });

  it('admin force sem nota -> 400', async () => {
    const response = await post('admin', '9/fulfill', { force: true });
    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('nota sem force -> 400', async () => {
    const response = await post('admin', '9/fulfill', { note: 'qualquer motivo' });
    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('admin force + nota -> 200 gravando fulfillmentNote', async () => {
    prismaMock.commercialRequest.findUnique.mockResolvedValue(
      comexRow({ status: 'fulfilled', fulfillmentNote: 'Cliente fechou por fora' }),
    );

    const response = await post('admin', '9/fulfill', {
      force: true,
      note: '  Cliente fechou por fora ',
    });

    expect(response.status).toBe(200);
    expect(response.body.fulfillmentNote).toBe('Cliente fechou por fora');
    const args = txMock.commercialRequest.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: 9, status: 'quoting' });
    expect(args.data).toMatchObject({
      status: 'fulfilled',
      fulfillmentNote: 'Cliente fechou por fora',
      statusChangedById: SESSION_USER_ID,
    });
    expect(notifyMock).toHaveBeenCalledWith(9, {
      status: 'fulfilled',
      quoteCode: 'QR-50',
      rejectionReason: null,
    });
  });

  it('admin force + nota com vencedor SEM preco para os itens vinculados -> 200', async () => {
    txMock.quoteResponse.count.mockResolvedValue(1);
    txMock.quoteResponse.findMany.mockResolvedValue([pricedWinner({ items: [] })]);
    prismaMock.commercialRequest.findUnique.mockResolvedValue(comexRow({ status: 'fulfilled' }));

    const response = await post('admin', '9/fulfill', { force: true, note: 'Cliente fechou por fora' });

    expect(response.status).toBe(200);
    expect(txMock.quoteResponse.findMany).not.toHaveBeenCalled();
  });

  it('vencedor normal -> 200, sem nota', async () => {
    txMock.quoteResponse.count.mockResolvedValue(1);
    txMock.quoteResponse.findMany.mockResolvedValue([pricedWinner()]);
    prismaMock.commercialRequest.findUnique.mockResolvedValue(comexRow({ status: 'fulfilled' }));

    const response = await post('comprador', '9/fulfill', {});

    expect(response.status).toBe(200);
    const args = txMock.commercialRequest.updateMany.mock.calls[0][0];
    expect(args.data).toMatchObject({ status: 'fulfilled', fulfillmentNote: null });
    expect(args.data.statusChangedAt).toBeInstanceOf(Date);
    expect(txMock.quoteResponse.count.mock.calls[0][0].where).toMatchObject({
      quoteRequestId: 50,
      isWinner: true,
      deletedAt: null,
    });
  });

  it('vencedor parceiro (credit support) -> 200', async () => {
    txMock.creditSupportRequest.count.mockResolvedValue(1);
    txMock.creditSupportRequest.findMany.mockResolvedValue([
      {
        quoteRequestId: 50,
        currency: 'USD',
        offeredIncoterm: 'DAP',
        items: [
          { quoteRequestItemId: 501, partnerUnitPrice: 3, isUnavailable: false, unit: 'KG' },
        ],
      },
    ]);
    prismaMock.commercialRequest.findUnique.mockResolvedValue(comexRow({ status: 'fulfilled' }));

    const response = await post('comprador', '9/fulfill', {});

    expect(response.status).toBe(200);
    const [input] = auditLogMock.mock.calls[0];
    expect(input).toMatchObject({ action: 'fulfill', metadata: { force: false, winnerKind: 'credit' } });
  });

  it('A2: comprador com vencedor mas SEM item vinculado com preco -> 409', async () => {
    txMock.quoteResponse.count.mockResolvedValue(1);
    for (const winner of [
      pricedWinner({ items: [] }),
      pricedWinner({
        items: [
          { quoteRequestItemId: 501, unitPrice: 0, isUnavailable: true, quoteRequestItem: { unit: 'KG' } },
        ],
      }),
    ]) {
      txMock.quoteResponse.findMany.mockResolvedValue([winner]);
      txMock.commercialRequest.updateMany.mockClear();
      const response = await post('comprador', '9/fulfill', {});
      expect(response.status).toBe(409);
      expect(response.body.message).toContain('nenhum item desta solicitacao');
      expect(txMock.commercialRequest.updateMany).not.toHaveBeenCalled();
    }
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('A2: admin sem force tambem recebe 409 quando o vencedor nao tem preco', async () => {
    txMock.quoteResponse.count.mockResolvedValue(1);
    txMock.quoteResponse.findMany.mockResolvedValue([pricedWinner({ items: [] })]);
    const response = await post('admin', '9/fulfill', {});
    expect(response.status).toBe(409);
  });

  it('A2: item NAO vinculado (quoteRequestItemId null) nao conta como preco', async () => {
    txMock.quoteResponse.count.mockResolvedValue(1);
    txMock.quoteResponse.findMany.mockResolvedValue([pricedWinner()]);
    txMock.commercialRequest.findUnique.mockResolvedValue(
      quotingRow({ items: [{ id: 91, quoteRequestItemId: null }] }),
    );
    const response = await post('comprador', '9/fulfill', {});
    expect(response.status).toBe(409);
  });

  it('A2: com 1 item com preco e outro sem -> 200', async () => {
    txMock.quoteResponse.count.mockResolvedValue(1);
    txMock.quoteResponse.findMany.mockResolvedValue([pricedWinner()]);
    txMock.commercialRequest.findUnique.mockResolvedValue(
      quotingRow({
        items: [
          { id: 91, quoteRequestItemId: 501 },
          { id: 92, quoteRequestItemId: 502 },
        ],
      }),
    );
    prismaMock.commercialRequest.findUnique.mockResolvedValue(comexRow({ status: 'fulfilled' }));
    const response = await post('comprador', '9/fulfill', {});
    expect(response.status).toBe(200);
  });

  it('cotacao excluida conta como sem vencedor', async () => {
    txMock.commercialRequest.findUnique.mockResolvedValue(
      quotingRow({ quoteRequest: { deletedAt: new Date() } }),
    );
    txMock.quoteResponse.count.mockResolvedValue(1);
    const response = await post('comprador', '9/fulfill', {});
    expect(response.status).toBe(409);
    expect(txMock.quoteResponse.count).not.toHaveBeenCalled();
  });

  it('solicitacao sem cotacao vinculada conta como sem vencedor', async () => {
    txMock.commercialRequest.findUnique.mockResolvedValue(
      quotingRow({ quoteRequestId: null, quoteRequest: null }),
    );
    const response = await post('comprador', '9/fulfill', {});
    expect(response.status).toBe(409);
  });

  it('corrida (count 0) -> 409', async () => {
    txMock.quoteResponse.count.mockResolvedValue(1);
    txMock.quoteResponse.findMany.mockResolvedValue([pricedWinner()]);
    txMock.commercialRequest.updateMany.mockResolvedValue({ count: 0 });
    const response = await post('comprador', '9/fulfill', {});
    expect(response.status).toBe(409);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('toda mutacao chama AuditLogService.log com o tx como 2o argumento', async () => {
    txMock.quoteResponse.count.mockResolvedValue(1);
    txMock.quoteResponse.findMany.mockResolvedValue([pricedWinner()]);
    await post('comprador', '9/fulfill', {});
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(auditLogMock.mock.calls[0][0]).toMatchObject({
      entityType: 'commercial_request',
      action: 'fulfill',
      performedById: SESSION_USER_ID,
    });
    expect(auditLogMock.mock.calls[0][1]).toBe(txMock);
  });
});

describe('A5 limites de id e R2 notificacao antes da releitura', () => {
  const TOO_BIG = 2147483648;

  it('id no path acima do Int do Postgres -> 400 (nao 500) nas 3 rotas', async () => {
    for (const [route, body] of [
      [TOO_BIG + '/link-quote', { quoteRequestId: 50 }],
      [TOO_BIG + '/reject', { reason: 'Fora do portfolio' }],
      [TOO_BIG + '/fulfill', {}],
    ] as Array<[string, unknown]>) {
      const response = await post('admin', route, body);
      expect(response.status).toBe(400);
    }
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('quoteRequestId acima do Int do Postgres -> 400', async () => {
    const response = await post('admin', '9/link-quote', { quoteRequestId: TOO_BIG });
    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('R2: releitura pos-commit falhando nao perde o aviso ao solicitante', async () => {
    txMock.commercialRequest.findUnique.mockResolvedValue({ id: 9, status: 'pending' });
    prismaMock.commercialRequest.findUnique.mockRejectedValue(new Error('db down'));

    const response = await post('admin', '9/reject', { reason: 'Fora do portfolio' });

    expect(response.status).toBe(500);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toBe(9);
  });
});
