import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';
import { hashToken } from '../src/utils/tokens';

const run = process.env.RUN_DB_TESTS === 'true';

describe.skipIf(!run)('Credit Support (DB) em Postgres isolado', () => {
  let prisma: any;
  let app: any;
  let cookies: string[] = [];
  let adminId = 0;
  let roleCreatedId: number | null = null;
  let supplierId = 0;
  let quoteId = 0;
  let responseId = 0;
  let responseItemIds: number[] = [];
  const partnerIds: number[] = [];
  const runId = `cs-db-${Date.now()}`;

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
        requestCode: `CS-${runId}`,
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
      include: { items: { orderBy: { id: 'asc' } } },
    });
    responseId = response.id;
    responseItemIds = response.items.map((i: any) => i.id);
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
        contacts: [
          { name: 'Ana', email: `ana.${label}.${runId}@banco.test` },
          { name: 'Beto', email: `beto.${label}.${runId}@banco.test` },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    partnerIds.push(res.body.id);
    return res.body as { id: number; contacts: Array<{ id: number; email: string }> };
  }

  it('ciclo completo: encaminhar, snapshot congelado, stale, reenviar, revogar, excluir parceiro e fechar cotacao', async () => {
    const partner = await createPartner('a');
    const contactIds = partner.contacts.map((c) => c.id);
    const forwardUrl = `/api/v1/quote-responses/${responseId}/credit-support`;
    const listUrl = `/api/v1/quote-requests/${quoteId}/credit-support`;

    // 1) Encaminhar
    const forward = await request(app)
      .post(forwardUrl)
      .set('Cookie', cookies)
      .send({ creditPartnerId: partner.id, contactIds, message: 'Mensagem de teste' });
    expect(forward.status, JSON.stringify(forward.body)).toBe(201);
    expect(forward.body.recipients).toHaveLength(2);
    expect(forward.body.recipients.every((r: any) => r.status === 'sent')).toBe(true);
    const requestId: number = forward.body.id;
    const firstToken = tokenOf(forward.body.portalUrl);

    const stored = await prisma.creditSupportRequest.findUnique({
      where: { id: requestId },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toBe(firstToken);
    expect(hashToken(firstToken)).toBe(stored.tokenHash);
    expect(stored.items).toHaveLength(2);
    expect(stored.items[0]).toMatchObject({ productName: 'Item A', quantity: 5, isUnavailable: false });
    expect(stored.items[0].originalUnitPrice.toFixed(2)).toBe('10.00');
    expect(stored.originalTotalPrice.toFixed(2)).toBe('80.00');
    expect(JSON.parse(stored.recipientEmails)).toHaveLength(2);

    // 2) Duplicado ativo
    const dup = await request(app).post(forwardUrl).set('Cookie', cookies).send({ creditPartnerId: partner.id });
    expect(dup.status).toBe(409);

    // 3) Listagem sem tokenHash, nao stale
    const list1 = await request(app).get(listUrl).set('Cookie', cookies);
    expect(list1.status).toBe(200);
    expect(list1.body).toHaveLength(1);
    expect(list1.body[0]).toMatchObject({ id: requestId, status: 'sent', isStale: false });
    expect(JSON.stringify(list1.body)).not.toContain(stored.tokenHash);
    expect(JSON.stringify(list1.body)).not.toContain('tokenHash');

    // 4) Alterar o preco original: stale, snapshot inalterado, reenviar bloqueado
    await prisma.quoteResponseItem.update({ where: { id: responseItemIds[0] }, data: { unitPrice: '12.00' } });
    const list2 = await request(app).get(listUrl).set('Cookie', cookies);
    expect(list2.body[0].isStale).toBe(true);
    expect(list2.body[0].items[0].originalUnitPrice).toBe('10.00');
    const staleResend = await request(app)
      .post(`/api/v1/credit-support-requests/${requestId}/resend`)
      .set('Cookie', cookies)
      .send({});
    expect(staleResend.status).toBe(409);

    // 5) Restaura o preco e reenvia: token gira no mesmo registro
    await prisma.quoteResponseItem.update({ where: { id: responseItemIds[0] }, data: { unitPrice: '10.00' } });
    const resend = await request(app)
      .post(`/api/v1/credit-support-requests/${requestId}/resend`)
      .set('Cookie', cookies)
      .send({ ttlDays: 7 });
    expect(resend.status, JSON.stringify(resend.body)).toBe(201);
    const secondToken = tokenOf(resend.body.portalUrl);
    expect(secondToken).not.toBe(firstToken);
    const rotated = await prisma.creditSupportRequest.findUnique({ where: { id: requestId } });
    expect(rotated.tokenHash).toBe(hashToken(secondToken));
    expect(rotated.tokenHash).not.toBe(stored.tokenHash);
    expect(await prisma.creditSupportRequest.count({ where: { tokenHash: stored.tokenHash } })).toBe(0);

    // 6) Revogar
    const revoke = await request(app)
      .post(`/api/v1/credit-support-requests/${requestId}/revoke`)
      .set('Cookie', cookies);
    expect(revoke.status).toBe(200);
    expect(revoke.body).toEqual({ id: requestId, status: 'revoked' });
    const again = await request(app)
      .post(`/api/v1/credit-support-requests/${requestId}/revoke`)
      .set('Cookie', cookies);
    expect(again.body).toEqual({ id: requestId, alreadyRevoked: true });
    const list3 = await request(app).get(listUrl).set('Cookie', cookies);
    expect(list3.body[0].status).toBe('revoked');
    const revokedResend = await request(app)
      .post(`/api/v1/credit-support-requests/${requestId}/resend`)
      .set('Cookie', cookies)
      .send({});
    expect(revokedResend.status).toBe(409);

    // 7) MailLog e AuditLog sem o token
    const mails = await prisma.mailLog.findMany({
      where: { relatedEntityType: 'credit_support_request', relatedEntityId: String(requestId) },
    });
    expect(mails.length).toBe(4); // 2 destinatarios x (encaminhar + reenviar)
    expect(mails.every((m: any) => m.templateId === 'credit-support-request')).toBe(true);
    const mailBlob = JSON.stringify(mails);
    for (const secret of [firstToken, secondToken, stored.tokenHash, rotated.tokenHash]) {
      expect(mailBlob).not.toContain(secret);
    }
    expect(mailBlob).not.toContain('portal/credit');

    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'credit_support_request', entityId: String(requestId) },
    });
    expect(audits.map((a: any) => a.action).sort()).toEqual(['forward', 'resend', 'revoke']);
    expect(audits.every((a: any) => a.performedById === adminId)).toBe(true);
    const auditBlob = JSON.stringify(audits);
    for (const secret of [firstToken, secondToken, stored.tokenHash, rotated.tokenHash]) {
      expect(auditBlob).not.toContain(secret);
    }
    expect(auditBlob).not.toContain('portal/credit');

    // 8) Novo encaminhamento (o anterior foi revogado) e exclusao do parceiro revoga o ativo
    const forwardB = await request(app).post(forwardUrl).set('Cookie', cookies).send({ creditPartnerId: partner.id });
    expect(forwardB.status, JSON.stringify(forwardB.body)).toBe(201);
    const activeId: number = forwardB.body.id;
    expect(activeId).not.toBe(requestId);

    const del = await request(app).delete(`/api/v1/credit-partners/${partner.id}`).set('Cookie', cookies);
    expect(del.status).toBe(200);
    const revokedByDelete = await prisma.creditSupportRequest.findUnique({ where: { id: activeId } });
    expect(revokedByDelete.revokedAt).toBeInstanceOf(Date);
    const delAudit = await prisma.auditLog.findFirst({
      where: { entityType: 'credit_partner', entityId: String(partner.id), action: 'delete' },
    });
    expect(delAudit.metadata).toEqual({ revokedCreditSupportRequests: 1 });

    // 9) Cotacao fechada: nao encaminha
    const partnerC = await createPartner('c');
    await prisma.quoteRequest.update({ where: { id: quoteId }, data: { status: 'closed', closedAt: new Date() } });
    const closed = await request(app).post(forwardUrl).set('Cookie', cookies).send({ creditPartnerId: partnerC.id });
    expect(closed.status).toBe(409);
    await prisma.quoteRequest.update({ where: { id: quoteId }, data: { status: 'open', closedAt: null } });
  });

  it('item indisponivel no snapshot: preco 0, quantidade pedida, fora do total', async () => {
    const partner = await createPartner('u');
    const items = await prisma.quoteResponseItem.findMany({ where: { quoteResponseId: responseId }, orderBy: { id: 'asc' } });
    await prisma.quoteResponseItem.update({
      where: { id: items[1].id },
      data: { isUnavailable: true, unitPrice: '0', quantity: 0, totalPrice: '0' },
    });
    try {
      const res = await request(app)
        .post(`/api/v1/quote-responses/${responseId}/credit-support`)
        .set('Cookie', cookies)
        .send({ creditPartnerId: partner.id, contactIds: [partner.contacts[0].id] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const stored = await prisma.creditSupportRequest.findUnique({
        where: { id: res.body.id },
        include: { items: { orderBy: { position: 'asc' } } },
      });
      expect(stored.originalTotalPrice.toFixed(2)).toBe('50.00');
      expect(stored.items[1]).toMatchObject({ isUnavailable: true, quantity: 3 });
      expect(stored.items[1].originalUnitPrice.toFixed(2)).toBe('0.00');
    } finally {
      await prisma.quoteResponseItem.update({
        where: { id: items[1].id },
        data: { isUnavailable: false, unitPrice: '10.00', quantity: 3, totalPrice: '30.00' },
      });
    }
  });
});
