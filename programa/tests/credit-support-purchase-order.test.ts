import request from 'supertest';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/mailer/MailerService', () => ({
  sendAndLog: vi.fn(),
  getMailer: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn() },
    creditSupportRequest: { findFirst: vi.fn() },
    creditPartnerContact: { findFirst: vi.fn() },
    quoteResponse: { findFirst: vi.fn() },
    quoteRequest: { update: vi.fn() },
    forwarder: { findFirst: vi.fn() },
    companyProfile: { findUnique: vi.fn(), create: vi.fn() },
    emailTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
    userEmailSignature: { findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { sendAndLog } from '../src/mailer/MailerService';
import { CREDIT_OFFER_CHANGED_MESSAGE } from '../src/services/ComparisonCandidateService';

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
  creditSupportRequest: { findFirst: Mock };
  creditPartnerContact: { findFirst: Mock };
  quoteResponse: { findFirst: Mock };
  quoteRequest: { update: Mock };
  forwarder: { findFirst: Mock };
  companyProfile: { findUnique: Mock };
  emailTemplate: { findUnique: Mock };
  userEmailSignature: { findUnique: Mock };
  auditLog: { create: Mock };
};
const sendMock = sendAndLog as unknown as Mock;

async function loginAs(role: string): Promise<string> {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 7,
    name: role,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  };
  db.user.findUnique.mockResolvedValue(user);
  db.user.findFirst.mockResolvedValue(user);
  db.session.create.mockImplementation(({ data }: { data: { id: string } }) =>
    Promise.resolve({ id: data.id }),
  );
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'ChangeMe123!' });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

const URL = '/api/v1/credit-support-requests/5/purchase-order';
const PDF_BASE64 = Buffer.from('%PDF-1.4 fake purchase order content').toString('base64');
const baseBody = {
  forwarderInfo: 'Global Forwarders Ltda.\nmaria@globalforwarders.com',
  fileName: 'PO-2026-005.pdf',
  contentBase64: PDF_BASE64,
  fileType: 'application/pdf',
  fileSize: PDF_BASE64.length,
};

function winnerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    quoteRequestId: 3,
    quoteResponseId: 77,
    supplierId: 2,
    creditPartnerId: 4,
    creditPartnerContactId: 21,
    revokedAt: null,
    respondedAt: new Date('2026-10-10T12:00:00Z'),
    isWinner: true,
    currency: 'USD',
    offeredIncoterm: 'CIF',
    partnerTotalPrice: new Prisma.Decimal('5500'),
    quoteRequest: {
      id: 3,
      requestCode: 'QR-2026-003',
      destinationPort: null,
      deletedAt: null,
      items: [{ destinationPort: 'SANTOS, BRAZIL' }],
    },
    supplier: { id: 2, name: 'Acme Chemicals' },
    creditPartner: { id: 4, name: 'Banco Parceiro' },
    creditPartnerContact: { id: 21, name: 'Paula Parceira', email: 'paula@parceiro.com' },
    items: [
      {
        quoteRequestItemId: 11,
        position: 1,
        productName: 'PI-TPO',
        quantity: 500,
        originalUnitPrice: new Prisma.Decimal('4.99'),
        originalTotalPrice: new Prisma.Decimal('2495'),
        isUnavailable: false,
        partnerUnitPrice: new Prisma.Decimal('11'),
        partnerTotalPrice: new Prisma.Decimal('5500'),
      },
    ],
    ...overrides,
  };
}

function originResponse(unitPrice = '4.99') {
  return {
    id: 77,
    supplierId: 2,
    version: 1,
    currency: 'USD',
    offeredIncoterm: 'CIF',
    paymentTermsDays: 30,
    deletedAt: null,
    items: [
      {
        quoteRequestItemId: 11,
        quantity: 500,
        unitPrice: new Prisma.Decimal(unitPrice),
        totalPrice: new Prisma.Decimal(unitPrice).times(500),
        deletedAt: null,
        isDangerousGood: false,
        isUnavailable: false,
        quoteRequestItem: {
          productName: 'PI-TPO',
          unit: 'KG',
          quantity: 500,
          itemCode: null,
          deletedAt: null,
          catalogItem: null,
        },
      },
    ],
    supplier: { id: 2, name: 'Acme Chemicals', contacts: [] },
  };
}

describe('POST /api/v1/credit-support-requests/:id/purchase-order (PR4b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.emailTemplate.findUnique.mockResolvedValue(null);
    db.userEmailSignature.findUnique.mockResolvedValue(null);
    db.auditLog.create.mockResolvedValue({});
    db.quoteRequest.update.mockResolvedValue({});
    db.forwarder.findFirst.mockResolvedValue(null);
    db.companyProfile.findUnique.mockResolvedValue({
      id: 1,
      companyName: 'SQ Quimica',
      dispatchCc: JSON.stringify(['cc1@sqquimica.com', 'cc2@sqquimica.com']),
    });
    db.creditSupportRequest.findFirst.mockResolvedValue(winnerRow());
    db.quoteResponse.findFirst.mockResolvedValue(originResponse());
    db.creditPartnerContact.findFirst.mockResolvedValue(null);
    sendMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-po-partner' });
  });

  it('200: envia ao contato do encaminhamento, CC = dispatchCc, fornecedor ausente, audit e PO enviada', async () => {
    const cookie = await loginAs('comprador');
    const res = await request(app).post(URL).set('Cookie', cookie).send(baseBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'sent',
      to: 'paula@parceiro.com',
      cc: ['cc1@sqquimica.com', 'cc2@sqquimica.com'],
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toEqual({ email: 'paula@parceiro.com', name: 'Paula Parceira' });
    expect(call.cc).toEqual([
      { email: 'cc1@sqquimica.com', name: '' },
      { email: 'cc2@sqquimica.com', name: '' },
    ]);
    expect(JSON.stringify([call.to, call.cc])).not.toContain('acme');
    expect(call.templateId).toBe('quote-po');
    expect(call.relatedEntityType).toBe('credit_support_request');
    expect(call.relatedEntityId).toBe('5');
    expect(call.subject).toBe('Purchase Order - QR-2026-003');
    expect(call.templateVars).toMatchObject({
      quoteRequestId: 3,
      quoteResponseId: 77,
      supplierId: 2,
      creditSupportRequestId: 5,
      creditPartnerId: 4,
      creditPartnerContactId: 21,
      forwarderId: null,
    });
    // HTML cita o fornecedor de origem e o parceiro; destino vem do primeiro item da cotacao.
    expect(call.html).toContain('Dear all,');
    expect(call.html).toContain('supplied by Acme Chemicals, purchased through Banco Parceiro (credit support)');
    expect(call.html).toContain('SANTOS, BRAZIL');
    expect(call.text).toContain('supplied by Acme Chemicals, purchased through Banco Parceiro (credit support)');
    expect(call.attachments[0].filename).toBe('PO-2026-005.pdf');
    expect(call.attachments[0].content.toString('utf-8')).toBe('%PDF-1.4 fake purchase order content');

    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = db.auditLog.create.mock.calls[0][0].data;
    expect(audit.entityType).toBe('credit_support_request');
    expect(String(audit.entityId)).toBe('5');
    expect(audit.action).toBe('purchase_order');
    expect(audit.metadata.to).toBe('paula@parceiro.com');
    expect(audit.metadata.creditPartnerId).toBe(4);
    expect(JSON.stringify(audit)).not.toContain(PDF_BASE64);

    expect(db.quoteRequest.update).toHaveBeenCalledTimes(1);
    const updateArgs = db.quoteRequest.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 3 });
    expect(updateArgs.data.purchaseOrderSentAt).toBeInstanceOf(Date);
  });

  it('200: sem contato no encaminhamento, cai para o contato principal do parceiro', async () => {
    const cookie = await loginAs('admin');
    db.creditSupportRequest.findFirst.mockResolvedValue(
      winnerRow({ creditPartnerContactId: null, creditPartnerContact: null }),
    );
    db.creditPartnerContact.findFirst.mockResolvedValue({
      id: 30,
      name: 'Principal Parceiro',
      email: 'principal@parceiro.com',
    });

    const res = await request(app).post(URL).set('Cookie', cookie).send(baseBody);

    expect(res.status).toBe(200);
    expect(res.body.to).toBe('principal@parceiro.com');
    expect(db.creditPartnerContact.findFirst).toHaveBeenCalledWith({
      where: { creditPartnerId: 4 },
      orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
      select: { id: true, name: true, email: true },
    });
    expect(sendMock.mock.calls[0][0].templateVars.creditPartnerContactId).toBe(30);
  });

  it('400: parceiro sem nenhum contato', async () => {
    const cookie = await loginAs('comprador');
    db.creditSupportRequest.findFirst.mockResolvedValue(
      winnerRow({ creditPartnerContactId: null, creditPartnerContact: null }),
    );
    db.creditPartnerContact.findFirst.mockResolvedValue(null);

    const res = await request(app).post(URL).set('Cookie', cookie).send(baseBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('contato');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('404: encaminhamento inexistente ou de cotacao excluida (filtro deletedAt na query)', async () => {
    const cookie = await loginAs('comprador');
    db.creditSupportRequest.findFirst.mockResolvedValue(null);

    const res = await request(app).post(URL).set('Cookie', cookie).send(baseBody);

    expect(res.status).toBe(404);
    expect(db.creditSupportRequest.findFirst.mock.calls[0][0].where).toEqual({
      id: 5,
      quoteRequest: { deletedAt: null },
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('409: encaminhamento revogado', async () => {
    const cookie = await loginAs('comprador');
    db.creditSupportRequest.findFirst.mockResolvedValue(winnerRow({ revokedAt: new Date() }));

    const res = await request(app).post(URL).set('Cookie', cookie).send(baseBody);

    expect(res.status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('400: encaminhamento que nao e o vencedor', async () => {
    const cookie = await loginAs('comprador');
    db.creditSupportRequest.findFirst.mockResolvedValue(winnerRow({ isWinner: false }));

    const res = await request(app).post(URL).set('Cookie', cookie).send(baseBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Apenas a oferta vencedora do parceiro pode receber a Ordem de Compra.');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('409: proposta de origem mudou (stale) -> CREDIT_OFFER_CHANGED_MESSAGE', async () => {
    const cookie = await loginAs('comprador');
    db.quoteResponse.findFirst.mockResolvedValue(originResponse('5.50'));

    const res = await request(app).post(URL).set('Cookie', cookie).send(baseBody);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(CREDIT_OFFER_CHANGED_MESSAGE);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('409: proposta de origem excluida (stale)', async () => {
    const cookie = await loginAs('comprador');
    db.quoteResponse.findFirst.mockResolvedValue(null);

    const res = await request(app).post(URL).set('Cookie', cookie).send(baseBody);

    expect(res.status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('400: PDF acima de 10MB (fileSize)', async () => {
    const cookie = await loginAs('comprador');

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send({ ...baseBody, fileSize: 11 * 1024 * 1024 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('O PDF excede o limite de 10MB.');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('400: conteudo do PDF vazio', async () => {
    const cookie = await loginAs('comprador');

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send({ ...baseBody, contentBase64: 'data:application/pdf;base64,' });

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('400: fileType diferente de application/pdf', async () => {
    const cookie = await loginAs('comprador');

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send({ ...baseBody, fileType: 'image/png' });

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('400: forwarderId inexistente; forwarderId valido vai para templateVars e audit', async () => {
    const cookie = await loginAs('comprador');
    db.forwarder.findFirst.mockResolvedValueOnce(null);
    const missing = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send({ ...baseBody, forwarderId: 999 });
    expect(missing.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();

    db.forwarder.findFirst.mockResolvedValueOnce({ id: 7 });
    const ok = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send({ ...baseBody, forwarderId: 7 });
    expect(ok.status).toBe(200);
    expect(sendMock.mock.calls[0][0].templateVars.forwarderId).toBe(7);
    expect(db.auditLog.create.mock.calls[0][0].data.metadata.forwarderId).toBe(7);
  });

  it('PDF de ~2MB passa pelo parser (override de 10mb em app.ts; sem ele seria 413)', async () => {
    const cookie = await loginAs('comprador');
    const big = Buffer.alloc(2 * 1024 * 1024, 1).toString('base64');

    const res = await request(app)
      .post(URL)
      .set('Cookie', cookie)
      .send({ ...baseBody, contentBase64: big, fileSize: big.length });

    expect(res.status).toBe(200);
    expect(sendMock.mock.calls[0][0].attachments[0].content.length).toBe(2 * 1024 * 1024);
  });

  it('502: sendAndLog falha -> audit registrado, mas sem marcar purchaseOrderSentAt', async () => {
    const cookie = await loginAs('comprador');
    sendMock.mockResolvedValue({ status: 'failed', error: 'SMTP indisponivel' });

    const res = await request(app).post(URL).set('Cookie', cookie).send(baseBody);

    expect(res.status).toBe(502);
    expect(res.body.message).toBe('SMTP indisponivel');
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(db.quoteRequest.update).not.toHaveBeenCalled();
  });

  it('403: gestor e viewer nao enviam PO ao parceiro', async () => {
    for (const role of ['gestor', 'viewer']) {
      const cookie = await loginAs(role);
      const res = await request(app).post(URL).set('Cookie', cookie).send(baseBody);
      expect(res.status).toBe(403);
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('401: sem login', async () => {
    const res = await request(app).post(URL).send(baseBody);
    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
