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
    companyProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    emailTemplate: {
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
  companyProfile: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  emailTemplate: { findUnique: ReturnType<typeof vi.fn> };
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
    expect(call.attachments).toHaveLength(1);
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
});
