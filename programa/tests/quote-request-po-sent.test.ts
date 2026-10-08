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
    quoteRequest: {
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
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
    userEmailSignature: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  };
  return { prisma };
});

type Fn = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Fn; findFirst: Fn };
  session: { create: Fn };
  quoteRequest: { findMany: Fn; count: Fn; update: Fn };
  quoteResponse: { findFirst: Fn };
  supplierContact: { findFirst: Fn };
  companyProfile: { findUnique: Fn; create: Fn };
  emailTemplate: { findUnique: Fn };
  userEmailSignature: { findUnique: Fn };
  auditLog: { create: Fn };
  $transaction: Fn;
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

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.emailTemplate.findUnique.mockResolvedValue(null);
  prismaMock.userEmailSignature.findUnique.mockResolvedValue(null);
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.companyProfile.findUnique.mockResolvedValue({
    id: 1,
    companyName: 'SQ Quimica',
    dispatchCc: JSON.stringify(['cc1@sqquimica.com']),
  });
  prismaMock.quoteRequest.findMany.mockResolvedValue([]);
  prismaMock.quoteRequest.count.mockResolvedValue(0);
  prismaMock.quoteRequest.update.mockResolvedValue({});
  prismaMock.$transaction.mockImplementation((ops: unknown) =>
    Promise.all(ops as Promise<unknown>[]),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/quote-requests?poSent (filtro PO enviada)', () => {
  it('poSent=true filtra purchaseOrderSentAt not null e mantem deletedAt null', async () => {
    const cookieHeader = await loginAsComprador();

    const res = await request(app)
      .get('/api/v1/quote-requests?poSent=true')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(200);
    expect(prismaMock.quoteRequest.findMany).toHaveBeenCalledTimes(1);
    const { where } = prismaMock.quoteRequest.findMany.mock.calls[0][0];
    expect(where.purchaseOrderSentAt).toEqual({ not: null });
    expect(where.deletedAt).toBeNull();
  });

  it('poSent=false filtra purchaseOrderSentAt null', async () => {
    const cookieHeader = await loginAsComprador();

    const res = await request(app)
      .get('/api/v1/quote-requests?poSent=false')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(200);
    const { where } = prismaMock.quoteRequest.findMany.mock.calls[0][0];
    expect('purchaseOrderSentAt' in where).toBe(true);
    expect(where.purchaseOrderSentAt).toBeNull();
    expect(where.deletedAt).toBeNull();
  });

  it('poSent invalido retorna 400 e nao consulta o banco', async () => {
    const cookieHeader = await loginAsComprador();

    const res = await request(app)
      .get('/api/v1/quote-requests?poSent=talvez')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(400);
    expect(prismaMock.quoteRequest.findMany).not.toHaveBeenCalled();
  });

  it('sem poSent nao filtra por purchaseOrderSentAt', async () => {
    const cookieHeader = await loginAsComprador();

    const res = await request(app)
      .get('/api/v1/quote-requests?status=open')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(200);
    const { where } = prismaMock.quoteRequest.findMany.mock.calls[0][0];
    expect('purchaseOrderSentAt' in where).toBe(false);
  });
});

describe('POST /api/v1/quote-responses/:id/purchase-order grava purchaseOrderSentAt', () => {
  function arrangeSend(): void {
    prismaMock.quoteResponse.findFirst.mockResolvedValue(winnerQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
  }

  it('envio com sucesso marca a cotacao como PO enviada', async () => {
    const cookieHeader = await loginAsComprador();
    arrangeSend();
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-po-1' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send(basePoBody);

    expect(res.status).toBe(200);
    expect(prismaMock.quoteRequest.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.quoteRequest.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { purchaseOrderSentAt: expect.any(Date) },
    });
  });

  it('envio com falha (502) nao marca a cotacao', async () => {
    const cookieHeader = await loginAsComprador();
    arrangeSend();
    sendAndLogMock.mockResolvedValue({ status: 'failed', error: 'smtp down' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send(basePoBody);

    expect(res.status).toBe(502);
    expect(prismaMock.quoteRequest.update).not.toHaveBeenCalled();
  });

  it('falha ao marcar nao derruba a resposta (e-mail ja enviado)', async () => {
    const cookieHeader = await loginAsComprador();
    arrangeSend();
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-po-2' });
    prismaMock.quoteRequest.update.mockRejectedValue(new Error('db indisponivel'));

    const res = await request(app)
      .post('/api/v1/quote-responses/77/purchase-order')
      .set('Cookie', cookieHeader)
      .send(basePoBody);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sent');
    expect(prismaMock.quoteRequest.update).toHaveBeenCalledTimes(1);
  });
});
