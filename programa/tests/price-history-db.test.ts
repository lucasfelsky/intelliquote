import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';
import { hashToken } from '../src/utils/tokens';

const run = process.env.RUN_DB_TESTS === 'true';

// Fluxo real (portal -> revisao -> edicao manual) contra Postgres descartavel:
// snapshots so' quando algo de preco muda; GET devolve colunas/linhas com o diff.
describe.skipIf(!run)('Historico de preco por resposta (DB) em Postgres isolado', () => {
  let prisma: any;
  let app: any;
  let cookies: string[] = [];
  let adminId = 0;
  let roleCreatedId: number | null = null;
  let supplierId = 0;
  let contactId = 0;
  let quoteId = 0;
  let itemA = 0;
  let itemB = 0;
  let tokenId = 0;
  let responseId = 0;
  const runId = `ph-db-${Date.now()}`;
  const rawToken = `ph-token-${runId}-0123456789012345678901234567890123456789`;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/iq_critical_test') {
      throw new Error('Execute scripts/test-critical-local.mjs para usar um banco descartavel.');
    }
    ({ prisma } = await import('../src/lib/prisma'));
    ({ app } = await import('../src/app'));

    const existing = await prisma.role.findUnique({ where: { name: 'admin' } });
    const role = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    if (!existing) roleCreatedId = role.id;
    const user = await prisma.user.create({
      data: {
        name: `Admin ${runId}`,
        email: `${runId}@local.test`,
        passwordHash: await hashPassword('Test12345!'),
        roleId: role.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test12345!' });
    expect(login.status).toBe(200);
    cookies = login.headers['set-cookie'];

    const supplier = await prisma.supplier.create({
      data: {
        name: `Fornecedor ${runId}`,
        country: 'CN',
        acceptedIncoterms: ['FOB'],
        contacts: { create: { name: 'Contato Portal', email: `${runId}.forn@local.test`, isPrimary: true } },
      },
      include: { contacts: true },
    });
    supplierId = supplier.id;
    contactId = supplier.contacts[0].id;

    const quote = await prisma.quoteRequest.create({
      data: {
        requestCode: `PH-${runId}`,
        desiredIncoterm: ['FOB'],
        currency: 'USD',
        items: {
          create: [
            { productName: 'Item A', itemCode: 'A-01', quantity: 5, unit: 'KG' },
            { productName: 'Item B', quantity: 3, unit: 'KG' },
          ],
        },
      },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    quoteId = quote.id;
    itemA = quote.items[0].id;
    itemB = quote.items[1].id;

    const token = await prisma.supplierPortalToken.create({
      data: {
        quoteRequestId: quoteId,
        supplierId,
        supplierContactId: contactId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdById: adminId,
      },
    });
    tokenId = token.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.mailLog.deleteMany({ where: { toEmail: { contains: runId } } });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { performedById: adminId },
            { entityType: 'quote_response', entityId: String(responseId || -1) },
            { entityType: 'supplier_portal_token', entityId: String(tokenId || -1) },
          ],
        },
      });
      // QuoteResponse, itens, snapshots, token, logs e respostas do portal caem em cascata.
      await prisma.quoteRequest.deleteMany({ where: { id: quoteId } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.deleteMany({ where: { id: adminId } });
      if (roleCreatedId) {
        await prisma.role.deleteMany({ where: { id: roleCreatedId, users: { none: {} } } });
      }
    }
    await prisma?.$disconnect();
  });

  const portalPayload = (unitA: number, unitB: number) => ({
    currency: 'USD',
    incoterm: 'FOB',
    paymentTermsDays: 30,
    exchangeRate: 5,
    totalPrice: unitA * 5 + unitB * 3,
    validityDays: 30,
    items: [
      { quoteRequestItemId: itemA, unitPrice: unitA, quantity: 5, totalPrice: unitA * 5 },
      { quoteRequestItemId: itemB, unitPrice: unitB, quantity: 3, totalPrice: unitB * 3 },
    ],
  });

  const snapshots = () =>
    prisma.quoteResponsePriceSnapshot.findMany({
      where: { quoteResponseId: responseId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });

  it('sem backfill: a tabela comeca vazia', async () => {
    expect(await prisma.quoteResponsePriceSnapshot.count()).toBe(0);
  });

  it('submit no portal grava 1 snapshot (portal, contato como autor)', async () => {
    const res = await request(app).post(`/api/portal/${rawToken}/respond`).send(portalPayload(10, 10));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    responseId = res.body.quoteResponseId;
    expect(responseId).toBeGreaterThan(0);

    const rows = await snapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'portal',
      supplierContactId: contactId,
      performedById: null,
      actorName: `Contato Portal <${runId}.forn@local.test>`,
      currency: 'USD',
      offeredIncoterm: 'FOB',
    });
    expect(String(rows[0].offeredPrice)).toBe('80');
    expect(rows[0].items).toEqual([
      expect.objectContaining({ quoteRequestItemId: itemA, unitPrice: '10.00', quantity: 5, totalPrice: '50.00', isUnavailable: false }),
      expect.objectContaining({ quoteRequestItemId: itemB, unitPrice: '10.00', quantity: 3, totalPrice: '30.00', isUnavailable: false }),
    ]);
  });

  it('revisao no portal com preco diferente grava o 2o snapshot', async () => {
    const res = await request(app).post(`/api/portal/${rawToken}/respond`).send(portalPayload(12, 10));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.revised).toBe(true);
    const rows = await snapshots();
    expect(rows).toHaveLength(2);
    expect(rows[1].items[0]).toMatchObject({ quoteRequestItemId: itemA, unitPrice: '12.00' });
  });

  it('PUT manual com os mesmos valores nao gera linha', async () => {
    const res = await request(app)
      .put(`/api/v1/quote-responses/${responseId}`)
      .set('Cookie', cookies)
      .send({
        paymentTermsDays: 30,
        items: [
          { quoteRequestItemId: itemA, unitPrice: 12, quantity: 5 },
          { quoteRequestItemId: itemB, unitPrice: 10, quantity: 3 },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await snapshots()).toHaveLength(2);
  });

  it('PUT manual mudando 1 item grava o 3o snapshot (manual, nome do admin)', async () => {
    const res = await request(app)
      .put(`/api/v1/quote-responses/${responseId}`)
      .set('Cookie', cookies)
      .send({
        paymentTermsDays: 30,
        items: [
          { quoteRequestItemId: itemA, unitPrice: 12, quantity: 5 },
          { quoteRequestItemId: itemB, unitPrice: 11, quantity: 3 },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = await snapshots();
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({
      source: 'manual',
      performedById: adminId,
      supplierContactId: null,
      actorName: `Admin ${runId}`,
    });
    expect(String(rows[2].offeredPrice)).toBe('93');
  });

  it('GET price-history devolve 3 linhas em ordem, colunas dos itens e changedItemIds so do item alterado', async () => {
    const res = await request(app).get(`/api/v1/quote-responses/${responseId}/price-history`).set('Cookie', cookies);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.columns).toEqual([
      { quoteRequestItemId: itemA, productName: 'Item A', itemCode: 'A-01', unit: 'KG' },
      { quoteRequestItemId: itemB, productName: 'Item B', itemCode: null, unit: 'KG' },
    ]);
    expect(res.body.rows).toHaveLength(3);
    const [r1, r2, r3] = res.body.rows;
    expect(new Date(r1.recordedAt).getTime()).toBeLessThanOrEqual(new Date(r2.recordedAt).getTime());
    expect(new Date(r2.recordedAt).getTime()).toBeLessThanOrEqual(new Date(r3.recordedAt).getTime());
    expect(r1).toMatchObject({ source: 'portal', changedItemIds: [], changedFields: [], offeredPrice: '80.00' });
    expect(r2).toMatchObject({ source: 'portal', changedItemIds: [itemA], changedFields: ['offeredPrice'], offeredPrice: '90.00' });
    expect(r3).toMatchObject({ source: 'manual', changedItemIds: [itemB], changedFields: ['offeredPrice'], offeredPrice: '93.00' });
  });

  it('resposta excluida (soft-delete): GET price-history responde 404', async () => {
    const del = await request(app).delete(`/api/v1/quote-responses/${responseId}`).set('Cookie', cookies);
    expect(del.status, JSON.stringify(del.body)).toBe(204);
    const res = await request(app).get(`/api/v1/quote-responses/${responseId}/price-history`).set('Cookie', cookies);
    expect(res.status).toBe(404);
    // Snapshots continuam no banco (append-only, sem soft-delete).
    expect(await snapshots()).toHaveLength(3);
  });
});
