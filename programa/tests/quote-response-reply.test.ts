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
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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

const baseQuoteResponse = {
  id: 77,
  supplierId: 2,
  supplier: { id: 2, name: 'Acme Chemicals' },
  offeredPrice: 4.99,
  currency: 'USD',
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
        catalogItem: { commercialName: 'PI-TPO' },
      },
    ],
  },
};

describe('POST /api/v1/quote-responses/:id/reply', () => {
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

  it('envia o e-mail para o contato principal do fornecedor com CC da empresa', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(baseQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-1' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply')
      .set('Cookie', cookieHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sent');
    expect(res.body.to).toBe('john@acme.com');
    expect(res.body.cc).toEqual(['cc1@sqquimica.com', 'cc2@sqquimica.com']);

    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const call = sendAndLogMock.mock.calls[0][0];
    expect(call.to).toEqual({ email: 'john@acme.com', name: 'John Supplier' });
    expect(call.cc).toEqual([
      { email: 'cc1@sqquimica.com', name: '' },
      { email: 'cc2@sqquimica.com', name: '' },
    ]);
    expect(call.subject).toBe('Photoiniator - SQ QUIMICA - Acme Chemicals');
    expect(call.html).toContain('PI-TPO');
    // Preco ofertado pelo fornecedor (QuoteResponse.offeredPrice) tem que
    // aparecer na tabela em vez do placeholder "-" (bug relatado pelo
    // usuario: "so ali no email de resposta que o unit price informado
    // pelo fornecedor nao esta indo na tabela").
    expect(call.html).toContain('4.99 USD');
    // Total = unitPrice * quantity (500 KG * 4.99)
    expect(call.html).toContain('2,495.00 USD');
    expect(call.text).toContain('4.99 USD');

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    const auditArgs = prismaMock.auditLog.create.mock.calls[0][0];
    expect(auditArgs.data.action).toBe('reply');
    expect(auditArgs.data.entityType).toBe('quote_response');
  });

  it('retorna 404 quando a proposta nao existe', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/quote-responses/999/reply')
      .set('Cookie', cookieHeader)
      .send({});

    expect(res.status).toBe(404);
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando o fornecedor nao possui contato cadastrado', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(baseQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply')
      .set('Cookie', cookieHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('retorna 502 quando o envio de e-mail falha', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(baseQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    sendAndLogMock.mockResolvedValue({ status: 'failed', error: 'SMTP indisponivel' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply')
      .set('Cookie', cookieHeader)
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.message).toBe('SMTP indisponivel');
  });

  it('aceita subject e message editados na hora, e injeta a mensagem no HTML/texto', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(baseQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-2' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply')
      .set('Cookie', cookieHeader)
      .send({
        subject: 'Contraproposta - PI-TPO',
        message: 'Nosso preco alvo e US$ 4.20/KG. Podemos fechar nessas condicoes.',
      });

    expect(res.status).toBe(200);
    const call = sendAndLogMock.mock.calls[0][0];
    expect(call.subject).toBe('Contraproposta - PI-TPO');
    expect(call.html).toContain('Nosso preco alvo e US$ 4.20/KG.');
    expect(call.text).toContain('Nosso preco alvo e US$ 4.20/KG.');
  });

  it('preview nao envia e-mail, so retorna o render com subject/message aplicados', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(baseQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply/preview')
      .set('Cookie', cookieHeader)
      .send({ message: 'Fechado, favor providenciar o embarque.' });

    expect(res.status).toBe(200);
    expect(res.body.to).toBe('john@acme.com');
    expect(res.body.cc).toEqual(['cc1@sqquimica.com', 'cc2@sqquimica.com']);
    expect(res.body.html).toContain('Fechado, favor providenciar o embarque.');
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('preview retorna 404/400 nos mesmos casos que o envio', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/quote-responses/999/reply/preview')
      .set('Cookie', cookieHeader)
      .send({});

    expect(res.status).toBe(404);
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });
});
