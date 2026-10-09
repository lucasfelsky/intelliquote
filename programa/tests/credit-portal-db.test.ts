import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';
import { hashToken } from '../src/utils/tokens';

const run = process.env.RUN_DB_TESTS === 'true';

const PORTAL_INVALID_LINK_MESSAGE =
  'This link is invalid or has expired. Please contact your buyer to request a new one.';

describe.skipIf(!run)('Credit Portal (DB) em Postgres isolado', () => {
  let prisma: any;
  let app: any;
  let cookies: string[] = [];
  let adminId = 0;
  let roleCreatedId: number | null = null;
  let supplierId = 0;
  let quoteId = 0;
  let responseId = 0;
  let quoteItemIds: number[] = [];
  const partnerIds: number[] = [];
  const runId = `cp-db-${Date.now()}`;
  let uaSeq = 0;
  const nextUa = () => `${runId}-${(uaSeq += 1)}`;

  const tokenOf = (portalUrl: string) => new URL(portalUrl).searchParams.get('token') as string;

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
        contacts: { create: { name: 'Contato', email: `${runId}.forn@local.test`, isPrimary: true } },
      },
    });
    supplierId = supplier.id;

    const quote = await prisma.quoteRequest.create({
      data: {
        requestCode: `CP-${runId}`,
        desiredIncoterm: ['FOB'],
        currency: 'USD',
        items: {
          create: [
            { productName: 'Item A', quantity: 5, unit: 'KG' },
            { productName: 'Item B', quantity: 3, unit: 'KG' },
          ],
        },
      },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    quoteId = quote.id;
    quoteItemIds = quote.items.map((item: any) => item.id);

    const response = await prisma.quoteResponse.create({
      data: {
        quoteRequestId: quote.id,
        supplierId,
        offeredPrice: '10.00',
        currency: 'USD',
        offeredIncoterm: 'FOB',
        paymentTermsDays: 45,
        items: {
          create: quote.items.map((item: any) => ({
            quoteRequestItemId: item.id,
            unitPrice: '10.00',
            quantity: item.quantity,
            totalPrice: (10 * item.quantity).toFixed(2),
          })),
        },
      },
    });
    responseId = response.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.mailLog.deleteMany({ where: { relatedEntityType: 'credit_support_request' } });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { performedById: adminId },
            { entityType: { in: ['credit_support_request', 'credit_partner'] } },
          ],
        },
      });
      await prisma.supplierPortalTokenLog.deleteMany({
        where: { creditSupportRequestId: null, userAgent: { startsWith: runId } },
      });
      await prisma.creditSupportRequest.deleteMany({ where: { quoteRequestId: quoteId } });
      await prisma.quoteRequest.deleteMany({ where: { id: quoteId } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.creditPartner.deleteMany({ where: { id: { in: partnerIds } } });
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.deleteMany({ where: { id: adminId } });
      if (roleCreatedId) {
        await prisma.role.deleteMany({ where: { id: roleCreatedId, users: { none: {} } } });
      }
    }
    await prisma?.$disconnect();
  });

  async function createPartner(label: string) {
    const res = await request(app)
      .post('/api/v1/credit-partners')
      .set('Cookie', cookies)
      .send({
        name: `Banco ${label} ${runId}`,
        contacts: [{ name: 'Ana', email: `ana.${label}.${runId}@banco.test` }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    partnerIds.push(res.body.id);
    return res.body as { id: number; contacts: Array<{ id: number; email: string }> };
  }

  it('fluxo do parceiro: ver, responder, revisar, cotacao fechada, revogar e pagina estatica', async () => {
    const partner = await createPartner('p');
    const forward = await request(app)
      .post(`/api/v1/quote-responses/${responseId}/credit-support`)
      .set('Cookie', cookies)
      .send({ creditPartnerId: partner.id, contactIds: partner.contacts.map((c) => c.id), message: 'Teste' });
    expect(forward.status, JSON.stringify(forward.body)).toBe(201);
    const requestId: number = forward.body.id;
    const token = tokenOf(forward.body.portalUrl);
    const tokenHash = hashToken(token);

    // 1) GET do parceiro: payload publico, contador e log VIEW
    const viewUa = nextUa();
    const view = await request(app).get(`/api/credit-portal/${token}`).set('User-Agent', viewUa);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(Object.keys(view.body).sort()).toEqual(['items', 'partner', 'request', 'response', 'supplier', 'totals']);
    expect(view.body.items).toHaveLength(2);
    expect(view.body.response).toBeNull();
    expect(view.body.request).toMatchObject({ requestCode: `CP-${runId}`, currency: 'USD', incoterm: 'FOB', closed: false, readOnly: false });
    expect(view.body.supplier).toEqual({ name: `Fornecedor ${runId}`, country: 'CN' });
    expect(view.body.totals).toEqual({ original: '80.00', partner: null, markupPercent: null });
    const viewBlob = JSON.stringify(view.body);
    expect(viewBlob).not.toContain('tokenHash');
    expect(viewBlob).not.toContain(tokenHash);
    expect(viewBlob).not.toContain(token);
    expect(viewBlob).not.toContain('@');

    const afterView = await prisma.creditSupportRequest.findUnique({ where: { id: requestId } });
    expect(afterView.accessCount).toBe(1);
    expect(afterView.firstSeenAt).toBeInstanceOf(Date);
    expect(afterView.lastSeenAt).toBeInstanceOf(Date);
    const viewLog = await prisma.supplierPortalTokenLog.findFirst({
      where: { creditSupportRequestId: requestId, kind: 'VIEW' },
    });
    expect(viewLog).not.toBeNull();
    expect(viewLog.tokenId).toBeNull();
    expect(viewLog.userAgent).toBe(viewUa);
    expect(viewLog.meta).toEqual({ portal: 'credit' });

    // 2) POST: precos por item, totais e auditoria
    const submitUa = nextUa();
    const payload = {
      paymentTermsDays: 90,
      validityDays: 30,
      notes: 'Partner notes',
      items: [
        { quoteRequestItemId: quoteItemIds[0], unitPrice: 11 },
        { quoteRequestItemId: quoteItemIds[1], unitPrice: 9.5 },
      ],
    };
    const submit = await request(app)
      .post(`/api/credit-portal/${token}/respond`)
      .set('User-Agent', submitUa)
      .send(payload);
    expect(submit.status, JSON.stringify(submit.body)).toBe(201);
    expect(submit.body.version).toBe(1);
    expect(submit.body.totals).toEqual({ original: '80.00', partner: '83.50', markupPercent: '4.38' });

    const stored = await prisma.creditSupportRequest.findUnique({
      where: { id: requestId },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    expect(stored.items[0].partnerUnitPrice.toFixed(2)).toBe('11.00');
    expect(stored.items[0].partnerTotalPrice.toFixed(2)).toBe('55.00');
    expect(stored.items[1].partnerUnitPrice.toFixed(2)).toBe('9.50');
    expect(stored.items[1].partnerTotalPrice.toFixed(2)).toBe('28.50');
    expect(stored.partnerTotalPrice.toFixed(2)).toBe('83.50');
    expect(stored.partnerPaymentTermsDays).toBe(90);
    expect(stored.partnerValidityDays).toBe(30);
    expect(stored.partnerNotes).toBe('Partner notes');
    expect(stored.responseVersion).toBe(1);
    expect(stored.respondedAt).toBeInstanceOf(Date);
    expect(stored.submitterUserAgent).toBe(submitUa);
    expect(stored.tokenHash).toBe(tokenHash);

    const submitAudit = await prisma.auditLog.findFirst({
      where: { entityType: 'credit_support_request', entityId: String(requestId), action: 'partner_submit' },
    });
    expect(submitAudit).not.toBeNull();
    expect(submitAudit.performedById).toBeNull();
    expect(submitAudit.metadata).toEqual({ portal: 'credit' });
    const submitLog = await prisma.supplierPortalTokenLog.findFirst({
      where: { creditSupportRequestId: requestId, kind: 'SUBMIT' },
    });
    expect(submitLog).not.toBeNull();
    expect(submitLog.userAgent).toBe(submitUa);

    // 3) Revisao: versao 2, respondedAt inalterado, audit partner_revise
    const revise = await request(app)
      .post(`/api/credit-portal/${token}/respond`)
      .set('User-Agent', nextUa())
      .send({ ...payload, paymentTermsDays: 60, notes: '' });
    expect(revise.status, JSON.stringify(revise.body)).toBe(201);
    expect(revise.body.version).toBe(2);
    const revised = await prisma.creditSupportRequest.findUnique({ where: { id: requestId } });
    expect(revised.responseVersion).toBe(2);
    expect(revised.respondedAt.getTime()).toBe(stored.respondedAt.getTime());
    expect(revised.partnerPaymentTermsDays).toBe(60);
    expect(revised.partnerNotes).toBeNull();
    const reviseAudit = await prisma.auditLog.findFirst({
      where: { entityType: 'credit_support_request', entityId: String(requestId), action: 'partner_revise' },
    });
    expect(reviseAudit).not.toBeNull();
    expect(reviseAudit.performedById).toBeNull();

    // GET apos resposta: formulario pre-preenchido e contador segue contando
    const again = await request(app).get(`/api/credit-portal/${token}`).set('User-Agent', nextUa());
    expect(again.status).toBe(200);
    expect(again.body.response).toMatchObject({ paymentTermsDays: 60, validityDays: 30, notes: null, version: 2 });
    expect(again.body.items[0].partnerUnitPrice).toBe('11.00');
    expect((await prisma.creditSupportRequest.findUnique({ where: { id: requestId } })).accessCount).toBe(2);

    // 4) Lado do comprador: status responded e totais
    const buyer = await request(app).get(`/api/v1/quote-requests/${quoteId}/credit-support`).set('Cookie', cookies);
    expect(buyer.status).toBe(200);
    const mine = buyer.body.find((row: any) => row.id === requestId);
    expect(mine).toMatchObject({ status: 'responded', responseVersion: 2 });
    expect(mine.totals).toEqual({ original: '80.00', partner: '83.50', markupPercent: '4.38' });

    // 5) Cotacao fechada: so leitura + 409 (reabre no finally)
    await prisma.quoteRequest.update({ where: { id: quoteId }, data: { status: 'closed', closedAt: new Date() } });
    try {
      const closedView = await request(app).get(`/api/credit-portal/${token}`).set('User-Agent', nextUa());
      expect(closedView.status).toBe(200);
      expect(closedView.body.request).toMatchObject({ closed: true, readOnly: true });
      const closedPost = await request(app)
        .post(`/api/credit-portal/${token}/respond`)
        .set('User-Agent', nextUa())
        .send(payload);
      expect(closedPost.status).toBe(409);
      expect(closedPost.body.code).toBe('QUOTE_CLOSED');
    } finally {
      await prisma.quoteRequest.update({ where: { id: quoteId }, data: { status: 'open', closedAt: null } });
    }
    expect((await prisma.creditSupportRequest.findUnique({ where: { id: requestId } })).responseVersion).toBe(2);

    // 6) Revogar via API: 404 + log INVALID revoked
    const revoke = await request(app)
      .post(`/api/v1/credit-support-requests/${requestId}/revoke`)
      .set('Cookie', cookies);
    expect(revoke.status).toBe(200);
    const revokedView = await request(app).get(`/api/credit-portal/${token}`).set('User-Agent', nextUa());
    expect(revokedView.status).toBe(404);
    expect(revokedView.body).toEqual({ message: PORTAL_INVALID_LINK_MESSAGE });
    const invalidLog = await prisma.supplierPortalTokenLog.findFirst({
      where: { creditSupportRequestId: requestId, kind: 'INVALID' },
    });
    expect(invalidLog).not.toBeNull();
    expect(invalidLog.meta).toEqual({ portal: 'credit', reason: 'revoked' });

    // 7) Pagina estatica
    const page = await request(app).get('/portal/credit');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.text).toContain('data-portal-version');

    // 8) Nada persistido contem o token bruto
    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'credit_support_request', entityId: String(requestId) },
    });
    expect(audits.map((a: any) => a.action).sort()).toEqual(['forward', 'partner_revise', 'partner_submit', 'revoke']);
    const logs = await prisma.supplierPortalTokenLog.findMany({ where: { creditSupportRequestId: requestId } });
    expect(logs.map((l: any) => l.kind).sort()).toEqual(['INVALID', 'SUBMIT', 'SUBMIT', 'VIEW', 'VIEW', 'VIEW']);
    const blob = JSON.stringify([audits, logs]);
    expect(blob).not.toContain(token);
    expect(blob).not.toContain(tokenHash);
    expect(blob).not.toContain('portal/credit');
  });

  it('token inexistente: 404 e log INVALID sem encaminhamento', async () => {
    const ua = nextUa();
    const res = await request(app).get('/api/credit-portal/nao-existe-1234567890123456789012345678901234').set('User-Agent', ua);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: PORTAL_INVALID_LINK_MESSAGE });
    const log = await prisma.supplierPortalTokenLog.findFirst({ where: { userAgent: ua } });
    expect(log).not.toBeNull();
    expect(log.creditSupportRequestId).toBeNull();
    expect(log.tokenId).toBeNull();
    expect(log.meta).toEqual({ portal: 'credit', reason: 'not_found' });
  });
});
