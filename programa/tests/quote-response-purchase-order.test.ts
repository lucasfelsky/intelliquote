import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mailer/MailerService', () => ({
  sendAndLog: vi.fn(),
  getMailer: vi.fn(),
}));

import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { sendAndLog } from '../src/mailer/MailerService';
import { hashPassword } from '../src/utils/password';

const sendAndLogMock = sendAndLog as unknown as ReturnType<typeof vi.fn>;

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    session: {
      create: vi.fn(),
    },
    quoteResponse: {
      findFirst: vi.fn(),
    },
    supplierContact: {
      findFirst: vi.fn(),
    },
    forwarder: {
      findFirst: vi.fn(),
    },
    companyProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    emailTemplate: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    userEmailSignature: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return { prisma };
});

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  quoteResponse: { findFirst: ReturnType<typeof vi.fn> };
  supplierContact: { findFirst: ReturnType<typeof vi.fn> };
  forwarder: { findFirst: ReturnType<typeof vi.fn> };
  companyProfile: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  emailTemplate: { findUnique: ReturnType<typeof vi.fn> };
  userEmailSignature: { findUnique: ReturnType<typeof vi.fn> };
  auditLog: { create: ReturnType<typeof vi.fn> };
};

async function loginAsComprador(): Promise<string> {
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
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

const PDF_BASE64 = Buffer.from('%PDF-1.4 fake purchase order content').toString('base64');

const winnerQuoteResponse = {
  id: 77,
  supplierId: 2,
  supplier: { id: 2, name: 'Acme Chemicals' },
  offeredPrice: 4.99,
  currency: 'USD',
  isWinner: true,
  quoteRequest: {
    id: 5,
    requestCode: 'QR-2026-005',
    productName: 'Photoiniator',
    desiredIncoterm: ['CIF'],
    items: [
      {
        id: 11,
        productName: 'PI-TPO',
        quantity: 500,
        unit: 'KG',
        desiredIncoterm: null,
        catalogItem: { commercialName: 'PI-TPO-INTERNAL', marketName: 'PI-TPO' },
      },
    ],
  },
};

const basePoBody = {
  forwarderInfo: 'Global Forwarders Ltda.\nmaria@globalforwarders.com',
  fileName: 'PO-2026-005.pdf',
  contentBase64: PDF_BASE64,
  fileType: 'application/pdf',
  fileSize: PDF_BASE64.length,
};

describe('POST /api/v1/quote-responses/:id/purchase-order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.emailTemplate.findUnique.mockResolvedValue(null);
    prismaMock.userEmailSignature.findUnique.mockResolvedValue(null);
    prismaMock.companyProfile.findUnique.mockResolvedValue({
      id: 1,
      companyName: 'SQ Quimica',
      dispatchCc: JSON.stringify(['cc1@sqquimica.com', 'cc2@sqquimica.com']),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('envia a Ordem de Compra com o PDF anexado quando a proposta e vencedora', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(winnerQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-po-1' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send(basePoBody);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sent');
    expect(res.body.to).toBe('john@acme.com');
    expect(res.body.cc).toEqual(['cc1@sqquimica.com', 'cc2@sqquimica.com']);

    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const call = sendAndLogMock.mock.calls[0][0];
    expect(call.to).toEqual({ email: 'john@acme.com', name: 'John Supplier' });
    expect(call.subject).toBe('Purchase Order - QR-2026-005');
    expect(call.html).toContain('Dear all,');
    expect(call.html).toContain('Global Forwarders Ltda.');
    expect(call.html).toContain('maria@globalforwarders.com');
    // PDF + logo da SQ inline (sem imagem de assinatura cadastrada).
    expect(call.attachments).toHaveLength(2);
    expect(call.attachments[0].filename).toBe('PO-2026-005.pdf');
    expect(call.attachments[0].contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(call.attachments[0].content)).toBe(true);
    expect(call.attachments[0].content.toString('utf-8')).toBe('%PDF-1.4 fake purchase order content');

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    const auditArgs = prismaMock.auditLog.create.mock.calls[0][0];
    expect(auditArgs.data.action).toBe('purchase_order');
    expect(auditArgs.data.entityType).toBe('quote_response');
    // O PDF nao entra no AuditLog -- so' fileName/fileSize no metadata.
    expect(auditArgs.data.metadata.fileName).toBe('PO-2026-005.pdf');
    expect(auditArgs.data.metadata.fileSize).toBeGreaterThan(0);
    expect(JSON.stringify(auditArgs.data)).not.toContain(PDF_BASE64);
  });

  it('retorna 400 quando a proposta nao e a vencedora', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue({ ...winnerQuoteResponse, isWinner: false });
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send(basePoBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Apenas o fornecedor vencedor pode receber a Ordem de Compra.');
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando o fileType nao e application/pdf', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(winnerQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send({ ...basePoBody, fileType: 'image/png' });

    expect(res.status).toBe(400);
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando o arquivo excede o limite de 10MB', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(winnerQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send({ ...basePoBody, fileSize: 11 * 1024 * 1024 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('O PDF excede o limite de 10MB.');
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('retorna 404 quando a proposta nao existe', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/quote-responses/999/purchase-order')
      .set('Cookie', cookieHeader)
      .send(basePoBody);

    expect(res.status).toBe(404);
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando o fornecedor nao possui contato cadastrado', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(winnerQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send(basePoBody);

    expect(res.status).toBe(400);
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('retorna 502 quando o envio de e-mail falha', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(winnerQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    sendAndLogMock.mockResolvedValue({ status: 'failed', error: 'SMTP indisponivel' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send(basePoBody);

    expect(res.status).toBe(502);
    expect(res.body.message).toBe('SMTP indisponivel');
  });

  it('injeta subject e message editados na hora', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(winnerQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-po-2' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send({
        ...basePoBody,
        subject: 'PO revisada - QR-2026-005',
        message: 'Favor confirmar recebimento.',
      });

    expect(res.status).toBe(200);
    const call = sendAndLogMock.mock.calls[0][0];
    expect(call.subject).toBe('PO revisada - QR-2026-005');
    expect(call.html).toContain('Favor confirmar recebimento.');
    expect(call.text).toContain('Favor confirmar recebimento.');
  });

  it('forwarderId valido vai para templateVars e para o metadata do audit', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(winnerQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    prismaMock.forwarder.findFirst.mockResolvedValue({ id: 7, companyName: 'Global' });
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-po-fw' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send({ ...basePoBody, forwarderId: 7 });

    expect(res.status).toBe(200);
    expect(prismaMock.forwarder.findFirst.mock.calls[0][0].where).toEqual({
      id: 7,
      deletedAt: null,
    });
    const call = sendAndLogMock.mock.calls[0][0];
    expect(call.templateVars.forwarderId).toBe(7);
    // O conteudo do e-mail continua sendo o texto editado, nao o cadastro.
    expect(call.html).toContain('Global Forwarders Ltda.');
    const auditArgs = prismaMock.auditLog.create.mock.calls[0][0];
    expect(auditArgs.data.metadata.forwarderId).toBe(7);
  });

  it('retorna 400 quando o forwarderId nao existe ou foi excluido', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(winnerQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    prismaMock.forwarder.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send({ ...basePoBody, forwarderId: 999 });

    expect(res.status).toBe(400);
    expect(sendAndLogMock).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('sem forwarderId nao consulta o cadastro e grava forwarderId null', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(winnerQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-po-nofw' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send(basePoBody);

    expect(res.status).toBe(200);
    expect(prismaMock.forwarder.findFirst).not.toHaveBeenCalled();
    expect(sendAndLogMock.mock.calls[0][0].templateVars.forwarderId).toBeNull();
  });

  describe('e-mail da PO: logo, assinatura, mensagem e assunto', () => {
    const SIGNATURE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

    function dbTemplate(overrides: { subject?: string; htmlBody: string; textBody: string }) {
      return {
        id: 1,
        key: 'quote_po',
        locale: 'en',
        subject: overrides.subject ?? 'Purchase Order - {{requestCode}}',
        htmlBody: overrides.htmlBody,
        textBody: overrides.textBody,
        isActive: true,
        updatedAt: new Date(),
        updatedById: null,
      };
    }

    async function arrangeSendable(): Promise<string> {
      const cookieHeader = await loginAsComprador();
      prismaMock.quoteResponse.findFirst.mockResolvedValue(winnerQuoteResponse);
      prismaMock.supplierContact.findFirst.mockResolvedValue({
        id: 9,
        name: 'John Supplier',
        email: 'john@acme.com',
        isPrimary: true,
      });
      sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-po-x' });
      return cookieHeader;
    }

    it('o assunto do modal vence o assunto do template do banco', async () => {
      const cookieHeader = await arrangeSendable();
      prismaMock.emailTemplate.findUnique.mockResolvedValue(
        dbTemplate({
          htmlBody: '<p>Dear all,</p>{{message}}<p>{{subject}}</p>{{senderSignature}}',
          textBody: 'Dear all,\r\n\r\n{{messageText}}{{senderSignatureText}}',
        }),
      );

      const res = await request(app)
        .post('/api/v1/quote-responses/77/purchase-order')
        .set('Cookie', cookieHeader)
        .send({ ...basePoBody, subject: 'PO revisada' });

      expect(res.status).toBe(200);
      const call = sendAndLogMock.mock.calls[0][0];
      expect(call.subject).toBe('PO revisada');
      expect(call.html).toContain('<p>PO revisada</p>');
    });

    it('sem assunto no modal vale o assunto do template do banco', async () => {
      const cookieHeader = await arrangeSendable();
      prismaMock.emailTemplate.findUnique.mockResolvedValue(
        dbTemplate({
          subject: 'DB subject {{requestCode}}',
          htmlBody: '<p>{{subject}}</p>{{senderSignature}}',
          textBody: '{{subject}}',
        }),
      );

      const res = await request(app)
        .post('/api/v1/quote-responses/77/purchase-order')
        .set('Cookie', cookieHeader)
        .send(basePoBody);

      expect(res.status).toBe(200);
      expect(sendAndLogMock.mock.calls[0][0].subject).toBe('DB subject QR-2026-005');
    });

    it('com imagem de assinatura: anexos = PDF + logo + assinatura (mime gravado)', async () => {
      const cookieHeader = await arrangeSendable();
      prismaMock.userEmailSignature.findUnique.mockResolvedValue({
        userId: 1,
        text: 'Maria Compradora\nSQ Quimica',
        imageData: SIGNATURE_BYTES,
        imageMimeType: 'image/jpeg',
        imageWidth: 300,
        imageHeight: 90,
        imageSize: SIGNATURE_BYTES.length,
      });

      const res = await request(app)
        .post('/api/v1/quote-responses/77/purchase-order')
        .set('Cookie', cookieHeader)
        .send({ ...basePoBody, message: 'Mensagem no topo' });

      expect(res.status).toBe(200);
      expect(prismaMock.userEmailSignature.findUnique).toHaveBeenCalledWith({ where: { userId: 1 } });
      const call = sendAndLogMock.mock.calls[0][0];
      expect(call.attachments).toHaveLength(3);
      expect(call.attachments[0].contentType).toBe('application/pdf');
      expect(call.attachments[1]).toMatchObject({
        cid: 'sq-logo@intelliquote',
        contentType: 'image/png',
        filename: 'sq-logo.png',
      });
      expect(call.attachments[2]).toMatchObject({
        cid: 'sender-signature@intelliquote',
        contentType: 'image/jpeg',
        filename: 'signature.jpg',
      });
      expect(Buffer.from(call.attachments[2].content).equals(SIGNATURE_BYTES)).toBe(true);
      expect(call.html).toContain('src="cid:sq-logo@intelliquote"');
      expect(call.html).toContain('src="cid:sender-signature@intelliquote"');
      expect(call.html).toContain('Maria Compradora<br />SQ Quimica');
      // Mensagem logo abaixo de "Dear all,".
      expect(call.html.indexOf('Mensagem no topo')).toBeGreaterThan(call.html.indexOf('Dear all,'));
      expect(call.html.indexOf('Mensagem no topo')).toBeLessThan(call.html.indexOf('Attached is our PO'));
      // Os bytes da imagem nao vao para o AuditLog.
      expect(JSON.stringify(prismaMock.auditLog.create.mock.calls[0][0])).not.toContain('iVBOR');
      expect(call.templateVars.hasSignatureImage).toBe(true);
    });

    it('sem assinatura: fallback "Best regards," + nome + e-mail; anexos = PDF + logo', async () => {
      const cookieHeader = await arrangeSendable();

      const res = await request(app)
        .post('/api/v1/quote-responses/77/purchase-order')
        .set('Cookie', cookieHeader)
        .send(basePoBody);

      expect(res.status).toBe(200);
      const call = sendAndLogMock.mock.calls[0][0];
      expect(call.html).toContain('Best regards,<br />Comprador<br />comprador@intelliquote.local');
      expect(call.text).toContain('Best regards,\r\nComprador\r\ncomprador@intelliquote.local');
      expect(call.attachments).toHaveLength(2);
      expect(call.attachments[1].cid).toBe('sq-logo@intelliquote');
      expect(call.html).not.toContain('sender-signature@intelliquote');
    });

    it('template do banco sem {{companyLogo}}: o logo nao e anexado', async () => {
      const cookieHeader = await arrangeSendable();
      prismaMock.emailTemplate.findUnique.mockResolvedValue(
        dbTemplate({
          htmlBody: '<p>Dear all,</p>{{message}}{{senderSignature}}',
          textBody: 'Dear all,',
        }),
      );

      const res = await request(app)
        .post('/api/v1/quote-responses/77/purchase-order')
        .set('Cookie', cookieHeader)
        .send(basePoBody);

      expect(res.status).toBe(200);
      const call = sendAndLogMock.mock.calls[0][0];
      expect(call.attachments).toHaveLength(1);
      expect(call.html).not.toContain('cid:sq-logo@intelliquote');
    });
  });
});
