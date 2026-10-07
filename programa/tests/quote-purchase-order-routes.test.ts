import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const tx = {
    quoteRequestPurchaseOrder: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    quoteRequestItem: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
  };

  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    quoteRequest: { findFirst: vi.fn(), findUnique: vi.fn() },
    quoteRequestPurchaseOrder: { findUnique: vi.fn() },
    quoteRequestItem: { findUnique: vi.fn() },
    $transaction: vi.fn(async (callback) => callback(tx)),
    __tx: tx,
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

const p = prisma as any;
const tx = p.__tx;

describe('Rotas de PO da cotacao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    p.$transaction.mockImplementation(async (cb: any) => cb(tx));
  });

  it('R1 cria PO com label default e sem mover itens', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequest.findFirst.mockResolvedValue({ id: 5, status: 'open' });
    tx.quoteRequestPurchaseOrder.findMany.mockResolvedValue([]);
    tx.quoteRequestPurchaseOrder.create.mockResolvedValue({
      id: 1, quoteRequestId: 5, label: 'PO 1', position: 1,
    });

    const res = await request(app)
      .post('/api/v1/quote-requests/5/purchase-orders')
      .set('Cookie', cookies)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.purchaseOrder.label).toBe('PO 1');
    expect(res.body.movedItemIds).toEqual([]);
    expect(tx.quoteRequestPurchaseOrder.create).toHaveBeenCalledWith({
      data: { quoteRequestId: 5, label: 'PO 1', position: 1 },
    });
    expect(tx.quoteRequestItem.updateMany).not.toHaveBeenCalled();
  });

  it('R1 usa rotulo padrao unico quando PO 2 ja existe', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequest.findFirst.mockResolvedValue({ id: 5, status: 'open' });
    tx.quoteRequestPurchaseOrder.findMany.mockResolvedValue([{ position: 1, label: 'PO 2' }]);
    tx.quoteRequestPurchaseOrder.create.mockResolvedValue({
      id: 2, quoteRequestId: 5, label: 'PO 3', position: 2,
    });

    const res = await request(app)
      .post('/api/v1/quote-requests/5/purchase-orders')
      .set('Cookie', cookies)
      .send({});

    expect(res.status).toBe(201);
    expect(tx.quoteRequestPurchaseOrder.create).toHaveBeenCalledWith({
      data: { quoteRequestId: 5, label: 'PO 3', position: 2 },
    });
  });

  it('R1 com adoptUnassigned move itens sem PO para a nova PO', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequest.findFirst.mockResolvedValue({ id: 5, status: 'open' });
    tx.quoteRequestPurchaseOrder.findMany.mockResolvedValue([]);
    tx.quoteRequestPurchaseOrder.create.mockResolvedValue({
      id: 1, quoteRequestId: 5, label: 'PO 1', position: 1,
    });
    tx.quoteRequestItem.findMany.mockResolvedValue([{ id: 11 }, { id: 12 }]);

    const res = await request(app)
      .post('/api/v1/quote-requests/5/purchase-orders')
      .set('Cookie', cookies)
      .send({ adoptUnassigned: true });

    expect(res.status).toBe(201);
    expect(res.body.movedItemIds).toEqual([11, 12]);
    expect(tx.quoteRequestItem.updateMany).toHaveBeenCalledWith({
      where: { quoteRequestId: 5, purchaseOrderId: null },
      data: { purchaseOrderId: 1 },
    });
  });

  it('R1 trava a linha QuoteRequest (FOR NO KEY UPDATE parametrizado) antes de ler posicoes', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequest.findFirst.mockResolvedValue({ id: 5, status: 'open' });
    tx.quoteRequestPurchaseOrder.findMany.mockResolvedValue([]);
    tx.quoteRequestPurchaseOrder.create.mockResolvedValue({
      id: 1, quoteRequestId: 5, label: 'PO 1', position: 1,
    });

    const res = await request(app)
      .post('/api/v1/quote-requests/5/purchase-orders')
      .set('Cookie', cookies)
      .send({});

    expect(res.status).toBe(201);
    expectLockOf(5);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.quoteRequestPurchaseOrder.findMany.mock.invocationCallOrder[0],
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.quoteRequestPurchaseOrder.create.mock.invocationCallOrder[0],
    );
  });

  it('R1 com adoptUnassigned trava a cotacao antes de adotar os itens sem PO', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequest.findFirst.mockResolvedValue({ id: 5, status: 'open' });
    tx.quoteRequestPurchaseOrder.findMany.mockResolvedValue([]);
    tx.quoteRequestPurchaseOrder.create.mockResolvedValue({
      id: 1, quoteRequestId: 5, label: 'PO 1', position: 1,
    });
    tx.quoteRequestItem.findMany.mockResolvedValue([{ id: 11 }]);

    const res = await request(app)
      .post('/api/v1/quote-requests/5/purchase-orders')
      .set('Cookie', cookies)
      .send({ adoptUnassigned: true });

    expect(res.status).toBe(201);
    expectLockOf(5);
    const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(tx.quoteRequestPurchaseOrder.create.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(tx.quoteRequestItem.updateMany.mock.invocationCallOrder[0]);
  });

  it('R1 retorna 400 em cotacao fechada', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequest.findFirst.mockResolvedValue({ id: 5, status: 'closed' });

    const res = await request(app)
      .post('/api/v1/quote-requests/5/purchase-orders')
      .set('Cookie', cookies)
      .send({});

    expect(res.status).toBe(400);
    expect(tx.quoteRequestPurchaseOrder.create).not.toHaveBeenCalled();
  });

  it('R2 retorna 400 com label vazio', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequestPurchaseOrder.findUnique.mockResolvedValue({
      id: 1, quoteRequestId: 5, label: 'PO 1', position: 1,
      quoteRequest: { id: 5, status: 'open', deletedAt: null },
    });

    const res = await request(app)
      .patch('/api/v1/quote-request-purchase-orders/1')
      .set('Cookie', cookies)
      .send({ label: '   ' });

    expect(res.status).toBe(400);
    expect(tx.quoteRequestPurchaseOrder.update).not.toHaveBeenCalled();
  });

  it('R3 retorna 400 com permutacao incompleta', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequest.findFirst.mockResolvedValue({ id: 5, status: 'open' });
    tx.quoteRequestPurchaseOrder.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const res = await request(app)
      .put('/api/v1/quote-requests/5/purchase-orders/order')
      .set('Cookie', cookies)
      .send({ orderedIds: [1] });

    expect(res.status).toBe(400);
    expect(tx.quoteRequestPurchaseOrder.update).not.toHaveBeenCalled();
  });

  it('R3 trava a linha QuoteRequest antes dos updates de posicao no reorder', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequest.findFirst.mockResolvedValue({ id: 5, status: 'open' });
    tx.quoteRequestPurchaseOrder.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    tx.quoteRequestPurchaseOrder.update
      .mockResolvedValueOnce({ id: 2, position: 1 })
      .mockResolvedValueOnce({ id: 1, position: 2 });

    const res = await request(app)
      .put('/api/v1/quote-requests/5/purchase-orders/order')
      .set('Cookie', cookies)
      .send({ orderedIds: [2, 1] });

    expect(res.status).toBe(200);
    expectLockOf(5);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.quoteRequestPurchaseOrder.findMany.mock.invocationCallOrder[0],
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.quoteRequestPurchaseOrder.update.mock.invocationCallOrder[0],
    );
  });

  it('R4 trava a linha QuoteRequest antes de realocar e excluir a PO', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequestPurchaseOrder.findUnique.mockResolvedValue({
      id: 2, quoteRequestId: 5, label: 'PO 2', position: 2,
      quoteRequest: { id: 5, status: 'open', deletedAt: null },
    });
    tx.quoteRequestPurchaseOrder.findMany
      .mockResolvedValueOnce([{ id: 1, position: 1 }, { id: 2, position: 2 }])
      .mockResolvedValueOnce([{ id: 1, position: 1 }]);
    tx.quoteRequestItem.findMany.mockResolvedValue([]);

    const res = await request(app)
      .delete('/api/v1/quote-request-purchase-orders/2')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expectLockOf(5);
    const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(tx.quoteRequestPurchaseOrder.findMany.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(tx.quoteRequestItem.updateMany.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(tx.quoteRequestPurchaseOrder.delete.mock.invocationCallOrder[0]);
  });

  it('R4 exclui a PO realocando itens para a anterior sem apagar itens', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequestPurchaseOrder.findUnique.mockResolvedValue({
      id: 2, quoteRequestId: 5, label: 'PO 2', position: 2,
      quoteRequest: { id: 5, status: 'open', deletedAt: null },
    });
    tx.quoteRequestPurchaseOrder.findMany
      .mockResolvedValueOnce([{ id: 1, position: 1 }, { id: 2, position: 2 }])
      .mockResolvedValueOnce([{ id: 1, position: 1 }]);
    tx.quoteRequestItem.findMany.mockResolvedValue([{ id: 21 }, { id: 22 }]);

    const res = await request(app)
      .delete('/api/v1/quote-request-purchase-orders/2')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      deletedId: 2,
      reassignedToPurchaseOrderId: 1,
      movedItemIds: [21, 22],
    });
    expect(tx.quoteRequestItem.updateMany).toHaveBeenCalledWith({
      where: { purchaseOrderId: 2 },
      data: { purchaseOrderId: 1 },
    });
    expect(tx.quoteRequestPurchaseOrder.delete).toHaveBeenCalledWith({ where: { id: 2 } });
  });

  it('R5 retorna 400 com PO de outra cotacao', async () => {
    const cookies = await loginAs('comprador');
    tx.quoteRequestItem.findUnique.mockResolvedValue({
      id: 9, quoteRequestId: 5, purchaseOrderId: null,
      quoteRequest: { id: 5, status: 'open' },
    });
    tx.quoteRequestPurchaseOrder.findUnique.mockResolvedValue({ id: 3, quoteRequestId: 6 });

    const res = await request(app)
      .patch('/api/v1/quote-request-items/9/purchase-order')
      .set('Cookie', cookies)
      .send({ purchaseOrderId: 3 });

    expect(res.status).toBe(400);
    expect(tx.quoteRequestItem.update).not.toHaveBeenCalled();
  });

  it('R5 trava a linha QuoteRequest do item entre a pre-leitura e a leitura completa', async () => {
    const cookies = await loginAs('comprador');
    tx.quoteRequestItem.findUnique.mockResolvedValue({
      id: 9, quoteRequestId: 5, purchaseOrderId: null,
      quoteRequest: { id: 5, status: 'open', deletedAt: null },
    });
    tx.quoteRequestPurchaseOrder.findUnique.mockResolvedValue({ id: 3, quoteRequestId: 5 });
    tx.quoteRequestItem.update.mockResolvedValue({ id: 9, purchaseOrderId: 3 });

    const res = await request(app)
      .patch('/api/v1/quote-request-items/9/purchase-order')
      .set('Cookie', cookies)
      .send({ purchaseOrderId: 3 });

    expect(res.status).toBe(200);
    expectLockOf(5);
    // 1a leitura do item = pre-leitura (so quoteRequestId, sem trava); 2a = leitura completa pos-lock.
    expect(tx.quoteRequestItem.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.quoteRequestItem.findUnique.mock.calls[0][0]).toEqual({
      where: { id: 9 },
      select: { quoteRequestId: true },
    });
    const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    const itemReads = tx.quoteRequestItem.findUnique.mock.invocationCallOrder;
    expect(lockOrder).toBeGreaterThan(itemReads[0]);
    expect(lockOrder).toBeLessThan(itemReads[1]);
    expect(lockOrder).toBeLessThan(tx.quoteRequestPurchaseOrder.findUnique.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(tx.quoteRequestItem.update.mock.invocationCallOrder[0]);
  });

  it('R5 retorna 404 sem travar quando o item nao existe', async () => {
    const cookies = await loginAs('comprador');
    tx.quoteRequestItem.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v1/quote-request-items/9/purchase-order')
      .set('Cookie', cookies)
      .send({ purchaseOrderId: 3 });

    expect(res.status).toBe(404);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.quoteRequestItem.update).not.toHaveBeenCalled();
  });

  it('R5 aceita purchaseOrderId null', async () => {
    const cookies = await loginAs('comprador');
    tx.quoteRequestItem.findUnique.mockResolvedValue({
      id: 9, quoteRequestId: 5, purchaseOrderId: 3,
      quoteRequest: { id: 5, status: 'open' },
    });
    tx.quoteRequestItem.update.mockResolvedValue({ id: 9, purchaseOrderId: null });

    const res = await request(app)
      .patch('/api/v1/quote-request-items/9/purchase-order')
      .set('Cookie', cookies)
      .send({ purchaseOrderId: null });

    expect(res.status).toBe(200);
    expect(tx.quoteRequestItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9 }, data: { purchaseOrderId: null } }),
    );
  });

  it('R5 retorna 404 com PO inexistente', async () => {
    const cookies = await loginAs('comprador');
    tx.quoteRequestItem.findUnique.mockResolvedValue({
      id: 9, quoteRequestId: 5, purchaseOrderId: null,
      quoteRequest: { id: 5, status: 'open', deletedAt: null },
    });
    tx.quoteRequestPurchaseOrder.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v1/quote-request-items/9/purchase-order')
      .set('Cookie', cookies)
      .send({ purchaseOrderId: 99 });

    expect(res.status).toBe(404);
    expect(tx.quoteRequestItem.update).not.toHaveBeenCalled();
  });

  it('R5 retorna 404 com cotacao excluida', async () => {
    const cookies = await loginAs('comprador');
    tx.quoteRequestItem.findUnique.mockResolvedValue({
      id: 9, quoteRequestId: 5, purchaseOrderId: null,
      quoteRequest: { id: 5, status: 'open', deletedAt: new Date() },
    });

    const res = await request(app)
      .patch('/api/v1/quote-request-items/9/purchase-order')
      .set('Cookie', cookies)
      .send({ purchaseOrderId: 3 });

    expect(res.status).toBe(404);
    expect(tx.quoteRequestItem.update).not.toHaveBeenCalled();
  });

  it('R5 retorna 400 com purchaseOrderId nao inteiro', async () => {
    const cookies = await loginAs('comprador');

    const res = await request(app)
      .patch('/api/v1/quote-request-items/9/purchase-order')
      .set('Cookie', cookies)
      .send({ purchaseOrderId: 1.5 });

    expect(res.status).toBe(400);
  });

  it('R4 retorna 404 ao excluir PO inexistente', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequestPurchaseOrder.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/v1/quote-request-purchase-orders/99')
      .set('Cookie', cookies);

    expect(res.status).toBe(404);
    expect(tx.quoteRequestPurchaseOrder.delete).not.toHaveBeenCalled();
  });

  it('R6 retorna 400 ao criar item com PO de outra cotacao', async () => {
    const cookies = await loginAs('comprador');
    p.quoteRequest.findUnique.mockResolvedValue({ id: 5, status: 'open', destinationPort: null });
    p.quoteRequestPurchaseOrder.findUnique.mockResolvedValue({ id: 3, quoteRequestId: 6 });

    const res = await request(app)
      .post('/api/v1/quote-requests/5/items')
      .set('Cookie', cookies)
      .send({ productName: 'Item', quantity: 1, unit: 'kg', purchaseOrderId: 3 });

    expect(res.status).toBe(400);
  });

  it('viewer recebe 403 nas rotas de escrita', async () => {
    const cookies = await loginAs('viewer');

    const res = await request(app)
      .post('/api/v1/quote-requests/5/purchase-orders')
      .set('Cookie', cookies)
      .send({});

    expect(res.status).toBe(403);
  });
});

// O lock e uma tagged template: ($queryRaw`... ${id} FOR NO KEY UPDATE`) => (strings, id).
function expectLockOf(quoteRequestId: number) {
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  const [strings, ...values] = tx.$queryRaw.mock.calls[0];
  expect(strings.join('?')).toMatch(/SELECT id FROM "QuoteRequest" WHERE id = \? FOR NO KEY UPDATE/);
  expect(values).toEqual([quoteRequestId]);
}

// O login tem rate limit (20 por janela): reaproveita o cookie por papel em vez de logar a cada teste.
const cookieByRole = new Map<string, string[]>();

async function loginAs(role: 'admin' | 'comprador' | 'gestor' | 'viewer') {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  };
  p.user.findUnique.mockResolvedValue(user);
  p.user.findFirst.mockResolvedValue(user);
  p.session.create.mockResolvedValue({ id: 'session-1' });

  const cached = cookieByRole.get(role);
  if (cached) return cached;

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'ChangeMe123!' });

  const cookies = loginResponse.headers['set-cookie'];
  cookieByRole.set(role, cookies);
  return cookies;
}
