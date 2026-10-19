import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

// So roda com RUN_DB_TESTS=true (scripts/test-critical-local.mjs: Postgres embutido com TODAS as migrations).
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `commercial-actions-db-${Date.now()}`;

describe('Solicitacoes do comercial - acoes do COMEX (DB)', () => {
  const userIds: number[] = [];
  const catalogItemIds: number[] = [];
  const quoteIds: number[] = [];
  const supplierIds: number[] = [];
  let comercialCookies: string[] = [];
  let compradorCookies: string[] = [];
  let adminCookies: string[] = [];
  let itemId: number;
  let otherItemId: number;
  let supplierId: number;

  async function createUser(roleName: string, label: string) {
    const role =
      roleName === 'comercial'
        ? await prisma.role.findUniqueOrThrow({ where: { name: roleName } })
        : await prisma.role.upsert({ where: { name: roleName }, update: {}, create: { name: roleName } });
    const user = await prisma.user.create({
      data: {
        name: `${label} ${runId}`,
        email: `${label}-${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: role.id,
      },
    });
    userIds.push(user.id);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Test1234!' });
    return { user, cookies: login.headers['set-cookie'] as unknown as string[] };
  }

  async function newCommercialRequest(items: Array<{ catalogItemId: number; quantity: number }>) {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', comercialCookies)
      .send({
        customerName: 'ACME',
        items: items.map((item) => ({ ...item, unit: 'KG', targetPrice: 9.9 })),
      });
    expect(response.status).toBe(201);
    return response.body.id as number;
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    comercialCookies = (await createUser('comercial', 'comercial')).cookies;
    compradorCookies = (await createUser('comprador', 'comprador')).cookies;
    adminCookies = (await createUser('admin', 'admin')).cookies;

    const item = await prisma.catalogItem.create({
      data: { commercialName: `Resina ${runId}`, marketName: `RES-${runId}`, dbcorpCode: 'DB-SECRET' },
    });
    const other = await prisma.catalogItem.create({
      data: { commercialName: `Solvente ${runId}`, marketName: `SOL-${runId}` },
    });
    itemId = item.id;
    otherItemId = other.id;
    catalogItemIds.push(item.id, other.id);

    const supplier = await prisma.supplier.create({ data: { name: `Fornecedor Secreto ${runId}` } });
    supplierId = supplier.id;
    supplierIds.push(supplier.id);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: { in: ['commercial_request', 'quote_request', 'quote_request_item'] }, performedById: { in: userIds } },
          { performedById: { in: userIds } },
        ],
      },
    });
    await prisma.commercialRequest.deleteMany({ where: { requestedById: { in: userIds } } });
    // Itens e respostas da cotacao saem em cascata.
    await prisma.quoteRequest.deleteMany({ where: { id: { in: quoteIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.catalogItem.deleteMany({ where: { id: { in: catalogItemIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  testDbSkip('coluna fulfillmentNote existe apos as migrations', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'CommercialRequest' AND column_name = 'fulfillmentNote'`;
    expect(columns).toHaveLength(1);
  });

  testDbSkip('comprador cria cotacao com commercialRequestIds: solicitacao vira quoting e item fica vinculado', async () => {
    const requestId = await newCommercialRequest([
      { catalogItemId: itemId, quantity: 3 },
      { catalogItemId: otherItemId, quantity: 4 },
    ]);

    const create = await request(app)
      .post('/api/v1/quote-requests')
      .set('Cookie', compradorCookies)
      .send({
        desiredIncoterm: ['FOB'],
        commercialRequestIds: [requestId],
        // o COMEX removeu o 2o item da cotacao
        items: [{ catalogItemId: itemId, quantity: 3, unit: 'KG', targetPrice: 9.9 }],
      });
    expect(create.status).toBe(201);
    quoteIds.push(create.body.id);
    expect(create.body.items).toHaveLength(1);

    const row = await prisma.commercialRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    expect(row.status).toBe('quoting');
    expect(row.quoteRequestId).toBe(create.body.id);
    expect(row.statusChangedById).not.toBeNull();
    const linked = row.items.find((i) => i.catalogItemId === itemId);
    const unlinked = row.items.find((i) => i.catalogItemId === otherItemId);
    expect(linked?.quoteRequestItemId).toBe(create.body.items[0].id);
    expect(unlinked?.quoteRequestItemId).toBeNull();
  });

  testDbSkip('2 creates concorrentes para a MESMA solicitacao: 1x201 e 1x409, so 1 cotacao criada', async () => {
    const requestId = await newCommercialRequest([{ catalogItemId: itemId, quantity: 5 }]);
    const before = await prisma.quoteRequest.count();

    const body = {
      desiredIncoterm: ['FOB'],
      commercialRequestIds: [requestId],
      items: [{ catalogItemId: itemId, quantity: 5, unit: 'KG' }],
    };
    const [first, second] = await Promise.all([
      request(app).post('/api/v1/quote-requests').set('Cookie', compradorCookies).send(body),
      request(app).post('/api/v1/quote-requests').set('Cookie', adminCookies).send(body),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    for (const response of [first, second]) {
      if (response.status === 201) quoteIds.push(response.body.id);
    }
    expect(await prisma.quoteRequest.count()).toBe(before + 1);
  });

  testDbSkip('link-quote em cotacao aberta que ja tem o item: nenhum QuoteRequestItem novo', async () => {
    const quote = await prisma.quoteRequest.create({
      data: {
        requestCode: `QR-${runId}-LINK`,
        desiredIncoterm: ['FOB'],
        items: { create: [{ catalogItemId: itemId, productName: 'Resina', quantity: 10, unit: 'KG' }] },
      },
      include: { items: true },
    });
    quoteIds.push(quote.id);
    const requestId = await newCommercialRequest([{ catalogItemId: itemId, quantity: 3 }]);

    const response = await request(app)
      .post(`/api/v1/commercial-requests/${requestId}/link-quote`)
      .set('Cookie', compradorCookies)
      .send({ quoteRequestId: quote.id });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('quoting');
    expect(await prisma.quoteRequestItem.count({ where: { quoteRequestId: quote.id } })).toBe(1);
    const item = await prisma.commercialRequestItem.findFirstOrThrow({
      where: { commercialRequestId: requestId },
    });
    expect(item.quoteRequestItemId).toBe(quote.items[0].id);
    // quantidade do item da cotacao nao foi alterada
    const quoteItem = await prisma.quoteRequestItem.findUniqueOrThrow({ where: { id: quote.items[0].id } });
    expect(quoteItem.quantity).toBe(10);
  });

  testDbSkip('link-quote cria o item quando a cotacao nao o tem e recusa cotacao fechada', async () => {
    const open = await prisma.quoteRequest.create({
      data: { requestCode: `QR-${runId}-OPEN`, desiredIncoterm: ['FOB'], currency: 'USD' },
    });
    const closed = await prisma.quoteRequest.create({
      data: { requestCode: `QR-${runId}-CLOSED`, desiredIncoterm: ['FOB'], status: 'closed' },
    });
    quoteIds.push(open.id, closed.id);
    const requestId = await newCommercialRequest([{ catalogItemId: otherItemId, quantity: 7 }]);

    const onClosed = await request(app)
      .post(`/api/v1/commercial-requests/${requestId}/link-quote`)
      .set('Cookie', compradorCookies)
      .send({ quoteRequestId: closed.id });
    expect(onClosed.status).toBe(409);

    const onOpen = await request(app)
      .post(`/api/v1/commercial-requests/${requestId}/link-quote`)
      .set('Cookie', compradorCookies)
      .send({ quoteRequestId: open.id });
    expect(onOpen.status).toBe(200);

    const items = await prisma.quoteRequestItem.findMany({ where: { quoteRequestId: open.id } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ catalogItemId: otherItemId, quantity: 7, unit: 'KG', purchaseOrderId: null });
    // alvo (USD) = moeda da cotacao -> copiado
    expect(Number(items[0].targetPrice)).toBe(9.9);
  });

  testDbSkip('vencedor normal: fulfill 200 e o comercial ve o preco final sem chaves de fornecedor', async () => {
    const quote = await prisma.quoteRequest.create({
      data: {
        requestCode: `QR-${runId}-WIN`,
        desiredIncoterm: ['CIF'],
        items: { create: [{ catalogItemId: itemId, productName: 'Resina', quantity: 10, unit: 'KG' }] },
      },
      include: { items: true },
    });
    quoteIds.push(quote.id);
    const requestId = await newCommercialRequest([{ catalogItemId: itemId, quantity: 10 }]);

    const link = await request(app)
      .post(`/api/v1/commercial-requests/${requestId}/link-quote`)
      .set('Cookie', compradorCookies)
      .send({ quoteRequestId: quote.id });
    expect(link.status).toBe(200);

    // sem vencedor: comprador nao atende
    const early = await request(app)
      .post(`/api/v1/commercial-requests/${requestId}/fulfill`)
      .set('Cookie', compradorCookies)
      .send({});
    expect(early.status).toBe(409);

    const winner = await prisma.quoteResponse.create({
      data: {
        quoteRequestId: quote.id,
        supplierId,
        offeredPrice: 1.85,
        currency: 'EUR',
        offeredIncoterm: 'CIF',
        paymentTermsDays: 30,
        isWinner: true,
        items: {
          create: [
            { quoteRequestItemId: quote.items[0].id, unitPrice: 1.85, quantity: 10, totalPrice: 18.5 },
          ],
        },
      },
    });
    expect(winner.isWinner).toBe(true);

    const fulfill = await request(app)
      .post(`/api/v1/commercial-requests/${requestId}/fulfill`)
      .set('Cookie', compradorCookies)
      .send({});
    expect(fulfill.status).toBe(200);
    expect(fulfill.body.status).toBe('fulfilled');

    const mine = await request(app).get('/api/v1/commercial-requests/mine').set('Cookie', comercialCookies);
    expect(mine.status).toBe(200);
    const row = mine.body.data.find((r: { id: number }) => r.id === requestId);
    expect(row.status).toBe('fulfilled');
    expect(row.items[0].finalPrice).toEqual({
      unitPrice: '1.85',
      currency: 'EUR',
      incoterm: 'CIF',
      unit: 'KG',
    });
    const json = JSON.stringify(row);
    expect(json).not.toContain('supplier');
    expect(json).not.toContain('Secreto');
    expect(json).not.toContain('Partner');
    expect(json).not.toContain('quoteRequestItemId');
    expect(json).not.toContain('quoteRequestId');

    // reject de fulfilled -> 409
    const reject = await request(app)
      .post(`/api/v1/commercial-requests/${requestId}/reject`)
      .set('Cookie', compradorCookies)
      .send({ reason: 'Tarde demais' });
    expect(reject.status).toBe(409);
  });

  testDbSkip('reject grava motivo e o comercial ve; admin atende sem preco com force + nota', async () => {
    const rejectedId = await newCommercialRequest([{ catalogItemId: itemId, quantity: 1 }]);
    const reject = await request(app)
      .post(`/api/v1/commercial-requests/${rejectedId}/reject`)
      .set('Cookie', compradorCookies)
      .send({ reason: 'Fora do portfolio' });
    expect(reject.status).toBe(200);
    expect(reject.body.rejectionReason).toBe('Fora do portfolio');

    const quote = await prisma.quoteRequest.create({
      data: { requestCode: `QR-${runId}-FORCE`, desiredIncoterm: ['FOB'] },
    });
    quoteIds.push(quote.id);
    const forceId = await newCommercialRequest([{ catalogItemId: itemId, quantity: 2 }]);
    await request(app)
      .post(`/api/v1/commercial-requests/${forceId}/link-quote`)
      .set('Cookie', compradorCookies)
      .send({ quoteRequestId: quote.id });

    const byComprador = await request(app)
      .post(`/api/v1/commercial-requests/${forceId}/fulfill`)
      .set('Cookie', compradorCookies)
      .send({ force: true, note: 'Cliente fechou por fora' });
    expect(byComprador.status).toBe(403);

    const byAdmin = await request(app)
      .post(`/api/v1/commercial-requests/${forceId}/fulfill`)
      .set('Cookie', adminCookies)
      .send({ force: true, note: 'Cliente fechou por fora' });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.fulfillmentNote).toBe('Cliente fechou por fora');

    const mine = await request(app).get('/api/v1/commercial-requests/mine').set('Cookie', comercialCookies);
    const rejectedRow = mine.body.data.find((r: { id: number }) => r.id === rejectedId);
    const forceRow = mine.body.data.find((r: { id: number }) => r.id === forceId);
    expect(rejectedRow.rejectionReason).toBe('Fora do portfolio');
    expect(forceRow.fulfillmentNote).toBe('Cliente fechou por fora');
    expect(forceRow.items[0].finalPrice).toBeNull();
  });
});
