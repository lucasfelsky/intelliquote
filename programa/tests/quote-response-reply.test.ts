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
import { hashToken } from '../src/utils/tokens';

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
    quoteResponseItem: {
      updateMany: vi.fn(),
    },
    supplierContact: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    mailLog: {
      findMany: vi.fn().mockResolvedValue([]),
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
    supplierPortalToken: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    supplierPortalResponse: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    supplierPortalResponseRevision: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  // Mesmo padrao de dispatch-controller.test.ts: a "transacao" roda o callback com o proprio mock.
  prisma.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
  return { prisma };
});

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  quoteResponse: { findFirst: ReturnType<typeof vi.fn> };
  quoteResponseItem: { updateMany: ReturnType<typeof vi.fn> };
  supplierContact: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  mailLog: { findMany: ReturnType<typeof vi.fn> };
  companyProfile: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  emailTemplate: { findUnique: ReturnType<typeof vi.fn> };
  auditLog: { create: ReturnType<typeof vi.fn> };
  supplierPortalToken: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  supplierPortalResponse: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  supplierPortalResponseRevision: { updateMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

// Id do token NOVO criado em cada envio (mock de supplierPortalToken.create).
const CREATED_TOKEN_ID = 501;

// Defaults do portal: nenhum token ativo anterior; create devolve a linha com
// o que foi gravado (tokenHash incluso); update ecoa o `data`.
function resetPortalTokenMocks() {
  // Sem SupplierPortalResponse existente: o previous vem do token ativo (findFirst).
  prismaMock.supplierPortalResponse.findFirst.mockResolvedValue(null);
  prismaMock.supplierPortalToken.findUnique.mockResolvedValue(null);
  prismaMock.supplierPortalToken.findFirst.mockResolvedValue(null);
  prismaMock.supplierPortalToken.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.supplierPortalToken.create.mockImplementation(({ data }) =>
    Promise.resolve({
      id: CREATED_TOKEN_ID,
      ...data,
      revokedAt: null,
      respondedAt: null,
      responseId: null,
      createdAt: new Date(),
    }),
  );
  prismaMock.supplierPortalToken.update.mockImplementation(({ where, data }) =>
    Promise.resolve({ id: where.id, ...data }),
  );
  prismaMock.supplierPortalResponse.update.mockResolvedValue({});
  prismaMock.supplierPortalResponseRevision.updateMany.mockResolvedValue({ count: 0 });
}

// O rate limit de /auth/login do app (20 tentativas por janela) estoura com tantos
// testes neste arquivo: faz o login HTTP uma vez e reaproveita o cookie.
let cachedLoginCookie: string | null = null;

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
  if (cachedLoginCookie) return cachedLoginCookie;
  const res = await request(app).post('/api/v1/auth/login').send({
    email: 'comprador@intelliquote.local',
    password: 'ChangeMe123!',
  });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  cachedLoginCookie = cookies.map((c) => c.split(';')[0]).join('; ');
  return cachedLoginCookie;
}

const baseQuoteResponse = {
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

// Cotacao multi-item (2 QuoteResponseItem) -- usada nos testes de target
// price POR ITEM. `id`s de QuoteResponseItem (201/202) sao os
// `quoteResponseItemId` esperados no payload `itemTargets`.
const multiItemQuoteResponse = {
  id: 88,
  supplierId: 2,
  supplier: { id: 2, name: 'Acme Chemicals' },
  offeredPrice: 4.99,
  currency: 'USD',
  isWinner: false,
  targetPrice: null,
  quoteRequest: {
    id: 6,
    requestCode: 'QR-2026-006',
    productName: 'Multi Item Blend',
    desiredIncoterm: ['CIF'],
    items: [
      {
        id: 21,
        productName: 'PI-TPO',
        quantity: 500,
        unit: 'KG',
        desiredIncoterm: null,
        catalogItem: { commercialName: 'PI-TPO-INTERNAL', marketName: 'PI-TPO' },
      },
      {
        id: 22,
        productName: 'Resin X',
        quantity: 200,
        unit: 'KG',
        desiredIncoterm: null,
        catalogItem: null,
      },
    ],
  },
  items: [
    { id: 201, quoteRequestItemId: 21, unitPrice: 3.5, quantity: 500, totalPrice: 1750, leadTimeDays: null, notes: null, targetPrice: null },
    { id: 202, quoteRequestItemId: 22, unitPrice: 2.0, quantity: 200, totalPrice: 400, leadTimeDays: null, notes: null, targetPrice: null },
  ],
};

// Copias intactas das fixtures: reply() muta o objeto da proposta e os testes
// antigos deixam alvos gravados nas fixtures compartilhadas.
const pristineBaseQuoteResponse = structuredClone(baseQuoteResponse);
const pristineMultiItemQuoteResponse = structuredClone(multiItemQuoteResponse);

// Linha `quote_reply` do banco (EmailTemplateService.get serializa estes campos).
function dbReplyTemplate(overrides: { subject?: string; htmlBody?: string; textBody?: string }) {
  return {
    id: 1,
    key: 'quote_reply',
    locale: 'en',
    subject: overrides.subject ?? 'Banco',
    htmlBody: overrides.htmlBody ?? '<p>Dear {{supplierContactName}},</p><table><tbody>{{itemsRows}}</tbody></table>',
    textBody: overrides.textBody ?? 'Dear {{supplierContactName}},',
    isActive: true,
    updatedAt: new Date(),
    updatedById: null,
  };
}

describe('POST /api/v1/quote-responses/:id/reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.mailLog.findMany.mockResolvedValue([]);
    prismaMock.supplierContact.findMany.mockResolvedValue([]);
    prismaMock.emailTemplate.findUnique.mockResolvedValue(null);
    prismaMock.companyProfile.findUnique.mockResolvedValue({
      id: 1,
      companyName: 'SQ Quimica',
      dispatchCc: JSON.stringify(['cc1@sqquimica.com', 'cc2@sqquimica.com']),
    });
    resetPortalTokenMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Teste B - fallback explícito: documentando a cobertura que já existe
  // O baseQuoteResponse não tem `items` no nível da resposta, logo simula uma
  // "resposta legada sem QuoteResponseItem".
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
    expect(call.html).toContain('Dear John Supplier,');
    expect(call.html).not.toContain('Dear Acme Chemicals,');
    expect(call.html).toContain('PI-TPO');
    expect(call.html).not.toContain('PI-TPO-INTERNAL');
    // Preco ofertado pelo fornecedor (QuoteResponse.offeredPrice) tem que
    // aparecer na tabela em vez do placeholder "-" (bug relatado pelo
    // usuario: "so ali no email de resposta que o unit price informado
    // pelo fornecedor nao esta indo na tabela").
    expect(call.html).toContain('4.99 USD');
    // Total = unitPrice * quantity (500 KG * 4.99)
    expect(call.html).toContain('2,495.00 USD');
    expect(call.text).toContain('4.99 USD');
    
    // itemsIntroText
    expect(call.html).toContain('Please find the accepted items below:');

    // Teste D - bloco Target Price ausente quando não preenchido
    expect(call.html).not.toContain('Target Price');
    expect(call.html).not.toContain('TARGET PRICE');
    
    // Token do portal gerado no envio (sem anterior = sem 'revoke') + auditoria do reply.
    expect(prismaMock.auditLog.create.mock.calls.map((c) => c[0].data.action)).toEqual(['generate', 'reply']);
    const auditArgs = prismaMock.auditLog.create.mock.calls[1][0];
    expect(auditArgs.data.action).toBe('reply');
    expect(auditArgs.data.entityType).toBe('quote_response');
  });

  // Teste A - preço real por item vence o agregado
  it('preço real por item vence o agregado na tabela do email', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue({
      ...baseQuoteResponse,
      items: [{ quoteRequestItemId: 11, unitPrice: 3.50, quantity: 500, totalPrice: 1750, leadTimeDays: null, notes: null }]
    });
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
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const call = sendAndLogMock.mock.calls[0][0];
    
    // O preço do item real (3.50 USD) deve ser renderizado e o fallback agregado (4.99 USD) não.
    expect(call.html).toContain('3.50 USD');
    expect(call.html).not.toContain('4.99 USD');
    expect(call.html).toContain('1,750.00 USD'); // Total formatado (3.50 * 500 = 1750)
  });

  // Teste C - bloco Target Price aparece quando preenchido
  it('adiciona o bloco Target Price no HTML e no texto quando preenchido', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue({
      ...baseQuoteResponse,
      targetPrice: 4.50
    });
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
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const call = sendAndLogMock.mock.calls[0][0];
    
    // Proposta legada (0 itens): o alvo agregado vira a coluna TARGET PRICE em todas as linhas.
    expect(call.html).toContain('TARGET PRICE');
    expect(call.html).toContain('4.50 USD');
    expect(call.html).not.toContain('Target Price:');
    expect(call.text).toContain('Unit Price\tTarget Price\tTotal');
    expect(call.text).toContain('4.50 USD');

    // Scenario 1: Target Price overrides winning text
    expect(call.html).toContain('we would like to discuss adjusting the price towards our target below');
    expect(call.html).not.toContain('selected as the winning offer');
    expect(call.html).toContain('Please find the items under discussion below:');
    expect(call.html).not.toContain('accepted items');
  });

  it('renderiza texto neutro quando isWinner é false e não há Target Price', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue({
      ...baseQuoteResponse,
      isWinner: false
    });
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-neutral' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply')
      .set('Cookie', cookieHeader)
      .send({});

    expect(res.status).toBe(200);
    const call = sendAndLogMock.mock.calls[0][0];
    expect(call.html).toContain('reviewing your proposal along with other offers received');
    expect(call.html).not.toContain('selected as the winning offer');
    expect(call.html).toContain('Please find your submitted items below:');
    expect(call.html).not.toContain('accepted items');
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

  it('nao deixa "requestCode — " sobrando quando productName esta vazio', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue({
      ...baseQuoteResponse,
      quoteRequest: { ...baseQuoteResponse.quoteRequest, productName: '' },
    });
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply/preview')
      .set('Cookie', cookieHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.html).not.toContain('QR-2026-005 — )');
    expect(res.body.html).not.toContain('QR-2026-005 —)');
    expect(res.body.text).not.toContain('QR-2026-005 — )');
  });

  it('adiciona em CC quem for @mencionado na mensagem', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(baseQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-3' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply')
      .set('Cookie', cookieHeader)
      .send({ message: '@comex2@sqquimica.com Please issue the PO' });

    expect(res.status).toBe(200);
    expect(res.body.cc).toEqual(
      expect.arrayContaining(['cc1@sqquimica.com', 'cc2@sqquimica.com', 'comex2@sqquimica.com']),
    );
    const call = sendAndLogMock.mock.calls[0][0];
    const ccEmails = call.cc.map((c) => c.email);
    expect(ccEmails).toEqual(expect.arrayContaining(['comex2@sqquimica.com']));
    // texto da mensagem continua exatamente como digitado
    expect(call.html).toContain('@comex2@sqquimica.com Please issue the PO');
  });
  it('atualiza o targetPrice se enviado na resposta', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(baseQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    prismaMock.quoteResponse.update = vi.fn().mockResolvedValue({});
    prismaMock.quoteResponseTargetPriceHistory = { create: vi.fn().mockResolvedValue({}) } as any;
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-target' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply')
      .set('Cookie', cookieHeader)
      .send({ targetPrice: 3.5 });

    expect(res.status).toBe(200);
    expect(prismaMock.quoteResponse.update).toHaveBeenCalledWith({
      where: { id: 77, deletedAt: null },
      data: { targetPrice: 3.5 },
    });
    expect(prismaMock.quoteResponseTargetPriceHistory.create).toHaveBeenCalledWith({
      data: {
        quoteResponseId: 77,
        targetPrice: 3.5,
        sentById: expect.any(Number),
      },
    });
    const call = sendAndLogMock.mock.calls[0][0];
    expect(call.html).toContain('TARGET PRICE');
  });

  it('não atualiza o targetPrice no preview', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(baseQuoteResponse);
    prismaMock.quoteResponse.update = vi.fn();
    prismaMock.quoteResponseTargetPriceHistory = { create: vi.fn() } as any;

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply/preview')
      .set('Cookie', cookieHeader)
      .send({ targetPrice: 3.5 });

    expect(res.status).toBe(200);
    expect(prismaMock.quoteResponse.update).not.toHaveBeenCalled();
    expect(prismaMock.quoteResponseTargetPriceHistory.create).not.toHaveBeenCalled();
    expect(res.body.html).toContain('TARGET PRICE');
  });

  it('remove targetPrice se enviado null e não renderiza no email', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue({ ...baseQuoteResponse, targetPrice: 4.0 });
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    prismaMock.quoteResponse.update = vi.fn().mockResolvedValue({});
    prismaMock.quoteResponseTargetPriceHistory = { create: vi.fn() } as any;
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-target-null' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply')
      .set('Cookie', cookieHeader)
      .send({ targetPrice: null });

    expect(res.status).toBe(200);
    expect(prismaMock.quoteResponse.update).toHaveBeenCalledWith({
      where: { id: 77, deletedAt: null },
      data: { targetPrice: null },
    });
    expect(prismaMock.quoteResponseTargetPriceHistory.create).not.toHaveBeenCalled();
    const call = sendAndLogMock.mock.calls[0][0];
    expect(call.html).not.toContain('Target Price');
    expect(call.html).not.toContain('TARGET PRICE');
  });

  // Target price POR ITEM (multi-item)
  it('grava QuoteResponseItem.targetPrice via updateMany quando vem itemTargets, e o email mostra Target por item', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(multiItemQuoteResponse);
    prismaMock.quoteResponse.update = vi.fn();
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    prismaMock.quoteResponseItem.updateMany.mockResolvedValue({ count: 1 });
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-item-target' });

    const res = await request(app)
      .post('/api/v1/quote-responses/88/reply')
      .set('Cookie', cookieHeader)
      .send({
        itemTargets: [
          { quoteResponseItemId: 201, targetPrice: 3.2 },
          { quoteResponseItemId: 202, targetPrice: 1.8 },
        ],
      });

    expect(res.status).toBe(200);
    expect(prismaMock.quoteResponseItem.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.quoteResponseItem.updateMany).toHaveBeenCalledWith({
      where: { id: 201, quoteResponseId: 88, deletedAt: null, isUnavailable: false },
      data: { targetPrice: 3.2 },
    });
    expect(prismaMock.quoteResponseItem.updateMany).toHaveBeenCalledWith({
      where: { id: 202, quoteResponseId: 88, deletedAt: null, isUnavailable: false },
      data: { targetPrice: 1.8 },
    });
    // Multi-item NAO grava o bloco agregado (decisao de produto: usa so' os
    // targets por item).
    expect(prismaMock.quoteResponse.update).not.toHaveBeenCalled();

    const call = sendAndLogMock.mock.calls[0][0];
    // Alvo por item na coluna TARGET PRICE (nao mais como sub-linha "Target:").
    expect(call.html).toContain('TARGET PRICE');
    expect(call.html).toContain('3.20 USD');
    expect(call.html).toContain('1.80 USD');
    expect(call.html).not.toContain('Target: ');
  });

  it('preview com itemTargets NAO persiste (updateMany nao e chamado)', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(multiItemQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });

    const res = await request(app)
      .post('/api/v1/quote-responses/88/reply/preview')
      .set('Cookie', cookieHeader)
      .send({
        itemTargets: [{ quoteResponseItemId: 201, targetPrice: 3.2 }],
      });

    expect(res.status).toBe(200);
    expect(prismaMock.quoteResponseItem.updateMany).not.toHaveBeenCalled();
    expect(res.body.html).toContain('TARGET PRICE');
    expect(res.body.html).toContain('3.20 USD');
  });

  describe('item temporariamente indisponivel', () => {
    const responseWithUnavailableItem = {
      ...multiItemQuoteResponse,
      items: [
        multiItemQuoteResponse.items[0],
        {
          id: 202,
          quoteRequestItemId: 22,
          unitPrice: 0,
          quantity: 0,
          totalPrice: 0,
          leadTimeDays: null,
          notes: null,
          targetPrice: null,
          isUnavailable: true,
        },
      ],
    };

    it('e-mail (HTML e texto) mostra "Temporarily unavailable" sem preco/total do item', async () => {
      const cookieHeader = await loginAsComprador();
      prismaMock.quoteResponse.findFirst.mockResolvedValue(responseWithUnavailableItem);
      prismaMock.supplierContact.findFirst.mockResolvedValue({
        id: 9,
        name: 'John Supplier',
        email: 'john@acme.com',
        isPrimary: true,
      });
      sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-unavailable' });

      const res = await request(app)
        .post('/api/v1/quote-responses/88/reply')
        .set('Cookie', cookieHeader)
        .send({});

      expect(res.status).toBe(200);
      const call = sendAndLogMock.mock.calls[0][0];
      expect(call.html).toContain('Temporarily unavailable');
      expect(call.text).toContain('Temporarily unavailable');
      // item 22 (indisponivel): sem preco unitario/total (nem o 2.00 / 400.00 de antes)
      for (const body of [call.html, call.text]) {
        expect(body).not.toContain('2.00 USD');
        expect(body).not.toContain('400.00 USD');
        expect(body).not.toMatch(/(^|[^\d.,])0\.00 USD/);
      }
      // item 21 (disponivel) segue com preco normal
      expect(call.html).toContain('3.50 USD');
    });

    it('itemTargets de item indisponivel e ignorado (nao grava e nao aparece no e-mail)', async () => {
      const cookieHeader = await loginAsComprador();
      prismaMock.quoteResponse.findFirst.mockResolvedValue(responseWithUnavailableItem);
      prismaMock.supplierContact.findFirst.mockResolvedValue({
        id: 9,
        name: 'John Supplier',
        email: 'john@acme.com',
        isPrimary: true,
      });
      prismaMock.quoteResponseItem.updateMany.mockResolvedValue({ count: 1 });
      sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-unavailable-target' });

      const res = await request(app)
        .post('/api/v1/quote-responses/88/reply')
        .set('Cookie', cookieHeader)
        .send({
          itemTargets: [
            { quoteResponseItemId: 201, targetPrice: 3.2 },
            { quoteResponseItemId: 202, targetPrice: 1.8 },
          ],
        });

      expect(res.status).toBe(200);
      // o filtro isUnavailable: false no where impede a gravacao do alvo do item indisponivel
      for (const [arg] of prismaMock.quoteResponseItem.updateMany.mock.calls) {
        expect(arg.where.isUnavailable).toBe(false);
      }
      const call = sendAndLogMock.mock.calls[0][0];
      expect(call.html).toContain('TARGET PRICE');
      expect(call.html).toContain('3.20 USD');
      expect(call.html).not.toContain('1.80 USD');
      expect(call.text).not.toContain('1.80 USD');
    });
  });

  it('caminho de 1 item / targetPrice agregado continua funcionando quando nao vem itemTargets', async () => {
    const cookieHeader = await loginAsComprador();
    prismaMock.quoteResponse.findFirst.mockResolvedValue(baseQuoteResponse);
    prismaMock.supplierContact.findFirst.mockResolvedValue({
      id: 9,
      name: 'John Supplier',
      email: 'john@acme.com',
      isPrimary: true,
    });
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-legacy' });

    const res = await request(app)
      .post('/api/v1/quote-responses/77/reply')
      .set('Cookie', cookieHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(prismaMock.quoteResponseItem.updateMany).not.toHaveBeenCalled();
    const call = sendAndLogMock.mock.calls[0][0];
    expect(call.html).not.toContain('Target:');
  });

  // ---------------------------------------------------------------------
  // Assunto padrao = assunto do envio inicial (MailLog), mensagem no topo,
  // coluna TARGET PRICE
  // ---------------------------------------------------------------------
  describe('assunto do envio inicial, mensagem no topo e coluna TARGET PRICE', () => {
    const baseQuoteResponse = pristineBaseQuoteResponse;
    const multiItemQuoteResponse = pristineMultiItemQuoteResponse;
    const contact = { id: 9, name: 'John Supplier', email: 'john@acme.com', isPrimary: true };

    function dispatchLog(overrides: Record<string, unknown> = {}) {
      return {
        subject: 'Sourcing request QR-2026-005 - Photoiniator',
        toEmail: 'john@acme.com',
        templateVars: { supplierContactId: 9 },
        ...overrides,
      };
    }

    async function setup(quoteResponse: unknown) {
      const cookieHeader = await loginAsComprador();
      // reply() muta o objeto da proposta (alvos por item); clone evita vazar entre testes.
      prismaMock.quoteResponse.findFirst.mockResolvedValue(structuredClone(quoteResponse));
      prismaMock.supplierContact.findFirst.mockResolvedValue(contact);
      prismaMock.supplierContact.findMany.mockResolvedValue([
        { id: 9, email: 'john@acme.com' },
        { id: 10, email: 'Jane@Acme.com' },
      ]);
      sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-x' });
      return cookieHeader;
    }

    async function send(cookieHeader: string, id: number, body: Record<string, unknown> = {}) {
      const res = await request(app)
        .post(`/api/v1/quote-responses/${id}/reply`)
        .set('Cookie', cookieHeader)
        .send(body);
      expect(res.status).toBe(200);
      return sendAndLogMock.mock.calls[sendAndLogMock.mock.calls.length - 1][0];
    }

    async function preview(cookieHeader: string, id: number, body: Record<string, unknown> = {}) {
      const res = await request(app)
        .post(`/api/v1/quote-responses/${id}/reply/preview`)
        .set('Cookie', cookieHeader)
        .send(body);
      expect(res.status).toBe(200);
      return res.body as { subject: string; html: string; text: string };
    }

    const singleItemResponse = {
      ...baseQuoteResponse,
      targetPrice: null,
      items: [
        { id: 301, quoteRequestItemId: 11, unitPrice: 3.5, quantity: 500, totalPrice: 1750, leadTimeDays: null, notes: null, targetPrice: null },
      ],
    };

    // (a) assunto padrao = assunto do dispatch (sem "Re:")
    it('sem subject digitado usa o assunto do envio inicial (MailLog) no envio e no preview', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      prismaMock.mailLog.findMany.mockResolvedValue([dispatchLog()]);

      const call = await send(cookieHeader, 77);
      expect(call.subject).toBe('Sourcing request QR-2026-005 - Photoiniator');
      expect(call.subject).not.toMatch(/^Re:/i);

      const prev = await preview(cookieHeader, 77);
      expect(prev.subject).toBe('Sourcing request QR-2026-005 - Photoiniator');
      // (e) paridade preview x envio
      expect(prev.subject).toBe(call.subject);
    });

    it('consulta apenas logs quote-dispatch sent/queued desta cotacao', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      prismaMock.mailLog.findMany.mockResolvedValue([dispatchLog()]);

      await preview(cookieHeader, 77);

      expect(prismaMock.mailLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            templateId: 'quote-dispatch',
            relatedEntityType: 'quote_request',
            relatedEntityId: '5',
            status: { in: ['sent', 'queued'] },
          }),
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    // Regressao do reviewer: o filtro do fornecedor tem que ir no WHERE; senao, numa
    // cotacao enviada a muitos contatos, o log do fornecedor sai da janela do take.
    it('o filtro do fornecedor vai no where do MailLog (contatos do fornecedor, e-mail e supplierContactId)', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      prismaMock.mailLog.findMany.mockResolvedValue([dispatchLog()]);

      await preview(cookieHeader, 77);

      const args = prismaMock.mailLog.findMany.mock.calls[0][0];
      expect(args.where.OR).toEqual(
        expect.arrayContaining([
          { toEmail: { in: ['john@acme.com', 'jane@acme.com'], mode: 'insensitive' } },
          { templateVars: { path: ['supplierContactId'], equals: 9 } },
          { templateVars: { path: ['supplierContactId'], equals: '9' } },
          { templateVars: { path: ['supplierContactId'], equals: 10 } },
          { templateVars: { path: ['supplierContactId'], equals: '10' } },
        ]),
      );
      // take pequeno: so vale depois do filtro do fornecedor
      expect(args.take).toBeLessThanOrEqual(10);
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('fornecedor sem contatos nao consulta o MailLog (cai no padrao legado)', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      prismaMock.supplierContact.findMany.mockResolvedValue([]);

      const call = await send(cookieHeader, 77);
      expect(prismaMock.mailLog.findMany).not.toHaveBeenCalled();
      expect(call.subject).toBe('Photoiniator - SQ QUIMICA - Acme Chemicals');
    });

    // (b) log de outro contato ignorado; o mais recente valido vence
    it('ignora log de outro fornecedor e usa o mais recente do contato certo', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      prismaMock.mailLog.findMany.mockResolvedValue([
        dispatchLog({ subject: 'Assunto de OUTRO fornecedor', toEmail: 'x@other.com', templateVars: { supplierContactId: 99 } }),
        dispatchLog({ subject: 'Assunto valido mais recente', toEmail: 'jane@acme.com', templateVars: { supplierContactId: 10 } }),
        dispatchLog({ subject: 'Assunto antigo', templateVars: { supplierContactId: 9 } }),
      ]);

      const call = await send(cookieHeader, 77);
      expect(call.subject).toBe('Assunto valido mais recente');
    });

    it('casa pelo e-mail do destinatario (case-insensitive) quando o log nao tem supplierContactId', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      prismaMock.mailLog.findMany.mockResolvedValue([
        dispatchLog({ subject: 'Por e-mail', toEmail: 'JOHN@acme.com', templateVars: null }),
      ]);

      const call = await send(cookieHeader, 77);
      expect(call.subject).toBe('Por e-mail');
    });

    // (c) sem log -> padrao legado
    it('sem envio registrado cai no assunto padrao legado', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      prismaMock.mailLog.findMany.mockResolvedValue([]);

      const call = await send(cookieHeader, 77);
      expect(call.subject).toBe('Photoiniator - SQ QUIMICA - Acme Chemicals');
    });

    it('sem envio registrado usa o assunto do template do banco, se houver', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      prismaMock.mailLog.findMany.mockResolvedValue([]);
      prismaMock.emailTemplate.findUnique.mockResolvedValue(dbReplyTemplate({ subject: 'Banco - {{requestCode}}' }));

      const call = await send(cookieHeader, 77);
      expect(call.subject).toBe('Banco - QR-2026-005');
    });

    it('o assunto do envio inicial vence o assunto do template do banco', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      prismaMock.mailLog.findMany.mockResolvedValue([dispatchLog()]);
      prismaMock.emailTemplate.findUnique.mockResolvedValue(dbReplyTemplate({ subject: 'Banco - {{requestCode}}' }));

      const call = await send(cookieHeader, 77);
      expect(call.subject).toBe('Sourcing request QR-2026-005 - Photoiniator');
    });

    // (d) regressao: o assunto digitado vence MailLog E o template do banco
    it('o assunto digitado vence o MailLog e o template do banco com subject proprio', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      prismaMock.mailLog.findMany.mockResolvedValue([dispatchLog()]);
      prismaMock.emailTemplate.findUnique.mockResolvedValue(dbReplyTemplate({ subject: 'Banco - {{requestCode}}' }));

      const call = await send(cookieHeader, 77, { subject: '  Contraproposta - PI-TPO  ' });
      expect(call.subject).toBe('Contraproposta - PI-TPO');
      // digitado: nem precisa consultar o MailLog
      expect(prismaMock.mailLog.findMany).not.toHaveBeenCalled();

      const prev = await preview(cookieHeader, 77, { subject: 'Contraproposta - PI-TPO' });
      expect(prev.subject).toBe('Contraproposta - PI-TPO');
    });

    // (f) mensagem no topo, com destaque
    it('mensagem entra logo apos "Dear ...," com destaque e no topo do texto puro', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      const call = await send(cookieHeader, 77, { message: 'Linha 1 <b>x</b>\nLinha 2' });

      const msgHtml = 'Linha 1 &lt;b&gt;x&lt;/b&gt;<br />Linha 2';
      const idxMsg = call.html.indexOf(msgHtml);
      expect(idxMsg).toBeGreaterThan(call.html.indexOf('Dear John Supplier,'));
      expect(idxMsg).toBeLessThan(call.html.indexOf('Thank you for your quotation'));
      expect(call.html).toContain('border-left:4px solid #184054');
      expect(call.html).toContain('bgcolor="#EEF7F4"');
      // antes da tabela de itens
      expect(idxMsg).toBeLessThan(call.html.indexOf('ITEM'));
      expect(call.html).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');

      const idxText = call.text.indexOf('Linha 1 <b>x</b>');
      expect(idxText).toBeGreaterThan(call.text.indexOf('Dear John Supplier,'));
      expect(idxText).toBeLessThan(call.text.indexOf('Thank you for your quotation'));
      expect(call.text.startsWith('Dear John Supplier,')).toBe(true);
    });

    it('sem mensagem nao sobra bloco de destaque nem linha vazia a mais', async () => {
      const cookieHeader = await setup(baseQuoteResponse);
      const call = await send(cookieHeader, 77, {});
      expect(call.html).not.toContain('border-left:4px solid #184054');
      expect(call.text).toMatch(/^Dear John Supplier,\r\n\r\nThank you for your quotation/);
    });

    // (g) coluna TARGET PRICE
    it('multi-item com alvos por item: coluna TARGET PRICE cinza, sem linha solta nem sub-linha', async () => {
      const cookieHeader = await setup(multiItemQuoteResponse);
      prismaMock.quoteResponseItem.updateMany.mockResolvedValue({ count: 1 });

      const call = await send(cookieHeader, 88, {
        itemTargets: [
          { quoteResponseItemId: 201, targetPrice: 3.2 },
          { quoteResponseItemId: 202, targetPrice: null },
        ],
      });

      expect(call.html).toContain('TARGET PRICE');
      expect(call.html).toContain('#E5E7EB');
      expect(call.html).toContain('3.20 USD');
      expect(call.html).not.toContain('Target Price:');
      expect(call.html).not.toContain('Target: ');
      // header + 2 linhas = 3 celulas cinza; item sem alvo mostra o travessao
      expect(call.html.split('bgcolor="#E5E7EB"')).toHaveLength(4);
      expect(call.html).toContain('&#8212;');
      expect(call.text).toContain('Unit Price\tTarget Price\tTotal');
      expect(call.text).toContain('3.20 USD');
    });

    it('sem alvo nenhum nao ha coluna TARGET PRICE', async () => {
      const cookieHeader = await setup(multiItemQuoteResponse);
      const call = await send(cookieHeader, 88, {});
      expect(call.html).not.toContain('TARGET PRICE');
      expect(call.html).not.toContain('#E5E7EB');
      expect(call.text).not.toContain('Target Price');
    });

    it('1 item + targetPrice agregado: o alvo aparece na linha desse item (coluna)', async () => {
      const cookieHeader = await setup(singleItemResponse);
      prismaMock.quoteResponse.update = vi.fn().mockResolvedValue({});
      prismaMock.quoteResponseTargetPriceHistory = { create: vi.fn().mockResolvedValue({}) } as any;

      const call = await send(cookieHeader, 77, { targetPrice: 3.1 });
      expect(call.html).toContain('TARGET PRICE');
      expect(call.html).toContain('3.10 USD');
      expect(call.html).not.toContain('Target Price:');
      expect(call.html).toContain('we would like to discuss adjusting the price');
      // historico do agregado preservado
      expect(prismaMock.quoteResponseTargetPriceHistory.create).toHaveBeenCalledTimes(1);
    });

    it('1 item: o alvo proprio do item vence o agregado', async () => {
      const cookieHeader = await setup({
        ...singleItemResponse,
        targetPrice: 4.5,
        items: [{ ...singleItemResponse.items[0], targetPrice: 2.75 }],
      });

      const call = await send(cookieHeader, 77, {});
      expect(call.html).toContain('2.75 USD');
      expect(call.html).not.toContain('4.50 USD');
    });

    it('multi-item com agregado persistido e sem alvos por item nao mostra coluna nem linha solta', async () => {
      const cookieHeader = await setup({ ...multiItemQuoteResponse, targetPrice: 5 });

      const call = await send(cookieHeader, 88, {});
      expect(call.html).not.toContain('TARGET PRICE');
      expect(call.html).not.toContain('Target Price:');
      expect(call.html).not.toContain('5.00 USD');
      expect(call.html).toContain('reviewing your proposal along with other offers received');
    });

    it('item indisponivel no modo coluna tem a 6a celula (TARGET PRICE) com travessao', async () => {
      const cookieHeader = await setup({
        ...multiItemQuoteResponse,
        items: [
          multiItemQuoteResponse.items[0],
          { ...multiItemQuoteResponse.items[1], unitPrice: 0, quantity: 0, totalPrice: 0, isUnavailable: true },
        ],
      });

      const call = await send(cookieHeader, 88, {
        itemTargets: [{ quoteResponseItemId: 201, targetPrice: 3.2 }],
      });
      expect(call.html).toContain('TARGET PRICE');
      const rows = call.html.match(/<tr bgcolor="#[0-9A-Fa-f]{6}" style="background-color:#[0-9A-Fa-f]{6};">[\s\S]*?<\/tr>/g) ?? [];
      // 1 header + 2 linhas de item, todas com 6 celulas
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect((row.match(/<t[dh] /g) ?? []).length).toBe(6);
      }
      const unavailableRow = rows.find((row) => row.includes('Temporarily unavailable'))!;
      expect(unavailableRow).toContain('bgcolor="#E5E7EB"');
      expect(call.text).toMatch(/Resin X\t[^\t]*\t[^\t]*\tTemporarily unavailable\t—\t—/);
    });

    // (h) template legado no banco (thead fixo + slot, sem placeholders novos)
    it('template legado do banco: mensagem no slot, sub-linha "Target:" e sem coluna', async () => {
      const cookieHeader = await setup(multiItemQuoteResponse);
      prismaMock.quoteResponseItem.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.emailTemplate.findUnique.mockResolvedValue(
        dbReplyTemplate({
          htmlBody: [
            '<p>Dear {{supplierContactName}},</p>',
            '<table><thead><tr><th>ITEM</th><th>INCOTERM</th><th>QUANTITY</th><th>UNIT PRICE</th><th>TOTAL</th></tr></thead>',
            '<tbody>{{itemsRows}}</tbody></table>',
            '{{#targetPriceStr}}<p>Target Price: {{targetPriceStr}}</p>{{/targetPriceStr}}',
            '<!--CUSTOM_MESSAGE_SLOT-->',
          ].join('\n'),
          textBody: 'Dear {{supplierContactName}},\n\n{{itemsText}}\n\nBest regards,',
        }),
      );

      const call = await send(cookieHeader, 88, {
        message: 'Mensagem no slot',
        itemTargets: [{ quoteResponseItemId: 201, targetPrice: 3.2 }],
      });

      expect(call.html).not.toContain('TARGET PRICE');
      expect(call.html).toContain('Target: 3.20 USD');
      expect(call.html).not.toContain('Target Price:');
      expect(call.html).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');
      expect(call.html.indexOf('Mensagem no slot')).toBeGreaterThan(call.html.indexOf('</table>'));
      // texto: mensagem prefixada (formato antigo) e {{itemsText}} renderiza as linhas
      expect(call.text.startsWith('Mensagem no slot\n\nDear John Supplier,')).toBe(true);
      expect(call.text).toContain('PI-TPO');
      expect(call.text).toContain('(Target: 3.20 USD)');
    });

    it('template do banco com os placeholders novos: mensagem so no {{message}} e coluna gerada', async () => {
      const cookieHeader = await setup(multiItemQuoteResponse);
      prismaMock.quoteResponseItem.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.emailTemplate.findUnique.mockResolvedValue(
        dbReplyTemplate({
          htmlBody: [
            '<p>Dear {{supplierContactName}},</p>{{message}}',
            '<table><thead>{{itemsHeaderRow}}</thead><tbody>{{itemsRows}}</tbody></table>',
            '{{#targetPriceStr}}<p>Target Price: {{targetPriceStr}}</p>{{/targetPriceStr}}',
            '<!--CUSTOM_MESSAGE_SLOT-->',
          ].join('\n'),
          textBody: 'Dear {{supplierContactName}},\n\n{{messageText}}{{itemsTextTable}}',
        }),
      );

      const call = await send(cookieHeader, 88, {
        message: 'Mensagem unica',
        itemTargets: [{ quoteResponseItemId: 201, targetPrice: 3.2 }],
      });

      expect(call.html.split('Mensagem unica')).toHaveLength(2);
      expect(call.html).toContain('TARGET PRICE');
      expect(call.html).not.toContain('Target Price:');
      expect(call.html).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');
      expect(call.text.split('Mensagem unica')).toHaveLength(2);
      expect(call.text).toContain('Unit Price\tTarget Price\tTotal');
    });
  });

  describe('link do portal no e-mail de resposta', () => {
    const contact = { id: 9, name: 'John Supplier', email: 'john@acme.com', isPrimary: true };
    const future = new Date(Date.now() + 5 * 86_400_000);

    async function setup(quoteResponse: unknown) {
      const cookieHeader = await loginAsComprador();
      prismaMock.quoteResponse.findFirst.mockResolvedValue(structuredClone(quoteResponse));
      prismaMock.supplierContact.findFirst.mockResolvedValue(contact);
      sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'msg-p' });
      return cookieHeader;
    }

    async function send(cookieHeader: string, id: number, body: Record<string, unknown> = {}) {
      const res = await request(app)
        .post(`/api/v1/quote-responses/${id}/reply`)
        .set('Cookie', cookieHeader)
        .send(body);
      expect(res.status).toBe(200);
      return sendAndLogMock.mock.calls[sendAndLogMock.mock.calls.length - 1][0];
    }

    // Token cru = o que esta na URL do e-mail (unico lugar onde ele pode aparecer).
    function rawTokenFromHtml(html: string): string {
      const match = html.match(/\/portal\?token=([A-Za-z0-9_-]+)&amp;v=\d+/);
      expect(match).not.toBeNull();
      return match![1];
    }

    function previousToken(overrides: Record<string, unknown> = {}) {
      return {
        id: 400,
        quoteRequestId: 5,
        supplierId: 2,
        supplierContactId: 9,
        tokenHash: 'hash-antigo',
        expiresAt: future,
        revokedAt: null,
        respondedAt: new Date('2026-10-01T10:00:00Z'),
        responseId: 900,
        dispatchEventId: 77,
        createdById: 1,
        ...overrides,
      };
    }

    it('envio cria token novo (hash SHA-256 do token cru da URL) e o HTML/texto trazem o botao', async () => {
      const cookieHeader = await setup(pristineBaseQuoteResponse);

      const call = await send(cookieHeader, 77);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.supplierPortalToken.create).toHaveBeenCalledTimes(1);
      const createData = prismaMock.supplierPortalToken.create.mock.calls[0][0].data;
      expect(createData).toMatchObject({ quoteRequestId: 5, supplierId: 2, supplierContactId: 9, createdById: 1 });
      // Padrao do portal: so' o hash vai pro banco; o cru so' existe na URL do e-mail.
      const raw = rawTokenFromHtml(call.html);
      expect(raw.length).toBeGreaterThanOrEqual(40);
      expect(createData.tokenHash).toBe(hashToken(raw));
      expect(call.html).toContain('Review or adjust your proposal');
      expect(call.html).toContain('You can review or adjust your proposal using your secure link:');
      expect(call.html).not.toContain('{{');
      // Texto puro: URL crua (sem &amp;).
      expect(call.text).toContain(`Review or adjust your proposal: `);
      expect(call.text).toContain(`/portal?token=${raw}&v=`);
      expect(call.text).not.toContain('&amp;');
      expect(call.text.indexOf('Review or adjust your proposal')).toBeLessThan(call.text.indexOf('Best regards,'));
    });

    it('ZONA VERMELHA: token cru e portalLink nunca entram em templateVars nem na auditoria', async () => {
      const cookieHeader = await setup(pristineBaseQuoteResponse);

      const call = await send(cookieHeader, 77);
      const raw = rawTokenFromHtml(call.html);

      const templateVarsJson = JSON.stringify(call.templateVars);
      expect(templateVarsJson).not.toContain(raw);
      expect(templateVarsJson).not.toContain('portalLink');
      expect(call.templateVars.portalTokenId).toBe(CREATED_TOKEN_ID);

      const auditJson = JSON.stringify(prismaMock.auditLog.create.mock.calls);
      expect(auditJson).not.toContain(raw);
      expect(auditJson).not.toContain('portalLink');
      const generate = prismaMock.auditLog.create.mock.calls.find((c) => c[0].data.action === 'generate')![0].data;
      expect(generate.entityType).toBe('supplier_portal_token');
      expect(generate.entityId).toBe(String(CREATED_TOKEN_ID));
      expect(generate.metadata).toEqual({ quoteRequestId: 5, replacesTokenId: null, movedResponseId: null });
      const reply = prismaMock.auditLog.create.mock.calls.find((c) => c[0].data.action === 'reply')![0].data;
      expect(reply.metadata).toMatchObject({ portalTokenId: CREATED_TOKEN_ID, replacedTokenId: null });
    });

    it('token anterior respondido: resposta e revisoes migram pro token novo e o antigo e revogado', async () => {
      const cookieHeader = await setup(pristineBaseQuoteResponse);
      prismaMock.supplierPortalToken.findFirst.mockResolvedValue(previousToken());

      await send(cookieHeader, 77);

      // Revoga os ativos do destinatario e libera o responseId (@unique) do anterior ANTES do create.
      expect(prismaMock.supplierPortalToken.updateMany).toHaveBeenCalledWith({
        where: { quoteRequestId: 5, supplierContactId: 9, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      const updates = prismaMock.supplierPortalToken.update.mock.calls.map((c) => c[0]);
      expect(updates[0]).toEqual({ where: { id: 400 }, data: { revokedAt: expect.any(Date), responseId: null } });
      expect(prismaMock.supplierPortalToken.update.mock.invocationCallOrder[0]).toBeLessThan(
        prismaMock.supplierPortalToken.create.mock.invocationCallOrder[0],
      );
      // Resposta + historico migram; o novo token herda responseId/respondedAt e o dispatchEventId.
      expect(prismaMock.supplierPortalResponse.update).toHaveBeenCalledWith({
        where: { id: 900 },
        data: { portalTokenId: CREATED_TOKEN_ID },
      });
      expect(prismaMock.supplierPortalResponseRevision.updateMany).toHaveBeenCalledWith({
        where: { portalTokenId: 400 },
        data: { portalTokenId: CREATED_TOKEN_ID },
      });
      expect(updates[1]).toEqual({
        where: { id: CREATED_TOKEN_ID },
        data: { responseId: 900, respondedAt: new Date('2026-10-01T10:00:00Z') },
      });
      expect(prismaMock.supplierPortalToken.create.mock.calls[0][0].data.dispatchEventId).toBe(77);
      // Validade = max(expiresAt anterior, agora + 14d) -> aqui 14d (anterior vence em 5d).
      const expiresAt = prismaMock.supplierPortalToken.create.mock.calls[0][0].data.expiresAt as Date;
      expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(13.9 * 86_400_000);

      const actions = prismaMock.auditLog.create.mock.calls.map((c) => c[0].data);
      expect(actions.map((a) => a.action)).toEqual(['revoke', 'generate', 'reply']);
      expect(actions[0]).toMatchObject({
        entityType: 'supplier_portal_token',
        entityId: '400',
        metadata: { reason: 'reply', replacedById: CREATED_TOKEN_ID },
      });
      expect(actions[1].metadata).toEqual({ quoteRequestId: 5, replacesTokenId: 400, movedResponseId: 900 });
      expect(actions[2].metadata).toMatchObject({ portalTokenId: CREATED_TOKEN_ID, replacedTokenId: 400 });
    });

    it('resposta presa num token REVOGADO (cotacao reenviada): o revogado e o previous e a resposta migra', async () => {
      const cookieHeader = await setup(pristineBaseQuoteResponse);
      const revokedAt = new Date('2026-10-02T08:00:00Z');
      prismaMock.supplierPortalResponse.findFirst.mockResolvedValue({ portalTokenId: 300 });
      prismaMock.supplierPortalToken.findUnique.mockResolvedValue(previousToken({ id: 300, revokedAt }));
      prismaMock.supplierPortalToken.findFirst.mockResolvedValue(previousToken({ id: 400, respondedAt: null, responseId: null }));

      await send(cookieHeader, 77);

      expect(prismaMock.supplierPortalToken.findUnique).toHaveBeenCalledWith({ where: { id: 300 } });
      expect(prismaMock.supplierPortalToken.update.mock.calls[0][0]).toEqual({
        where: { id: 300 },
        data: { revokedAt, responseId: null },
      });
      expect(prismaMock.supplierPortalResponse.update).toHaveBeenCalledWith({
        where: { id: 900 },
        data: { portalTokenId: CREATED_TOKEN_ID },
      });
      const actions = prismaMock.auditLog.create.mock.calls.map((c) => c[0].data);
      expect(actions[0]).toMatchObject({ action: 'revoke', entityId: '300', metadata: { reason: 'reply' } });
      expect(actions[1].metadata).toEqual({ quoteRequestId: 5, replacesTokenId: 300, movedResponseId: 900 });
    });

    it('token anterior de OUTRO contato tambem e revogado e a resposta migra pro destinatario', async () => {
      const cookieHeader = await setup(pristineBaseQuoteResponse);
      prismaMock.supplierPortalToken.findFirst.mockResolvedValue(previousToken({ supplierContactId: 10 }));

      await send(cookieHeader, 77);

      expect(prismaMock.supplierPortalToken.update.mock.calls[0][0]).toEqual({
        where: { id: 400 },
        data: { revokedAt: expect.any(Date), responseId: null },
      });
      expect(prismaMock.supplierPortalToken.create.mock.calls[0][0].data.supplierContactId).toBe(9);
      expect(prismaMock.supplierPortalResponse.update).toHaveBeenCalledWith({
        where: { id: 900 },
        data: { portalTokenId: CREATED_TOKEN_ID },
      });
    });

    it('sem token anterior: cria sem mover resposta nem revogar', async () => {
      const cookieHeader = await setup(pristineBaseQuoteResponse);

      await send(cookieHeader, 77);

      expect(prismaMock.supplierPortalToken.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.supplierPortalToken.update).not.toHaveBeenCalled();
      expect(prismaMock.supplierPortalResponse.update).not.toHaveBeenCalled();
      expect(prismaMock.supplierPortalResponseRevision.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.supplierPortalToken.create.mock.calls[0][0].data.dispatchEventId).toBeNull();
      expect(prismaMock.auditLog.create.mock.calls.map((c) => c[0].data.action)).not.toContain('revoke');
    });

    it('cotacao fechada: nao emite token e o e-mail sai sem botao', async () => {
      const cookieHeader = await setup({
        ...pristineBaseQuoteResponse,
        quoteRequest: { ...pristineBaseQuoteResponse.quoteRequest, status: 'closed' },
      });

      const call = await send(cookieHeader, 77);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.supplierPortalToken.create).not.toHaveBeenCalled();
      expect(call.html).not.toContain('/portal?token=');
      expect(call.html).not.toContain('Review or adjust');
      expect(call.html).not.toContain('{{');
      expect(call.text).not.toContain('Review or adjust');
      expect(call.templateVars.portalTokenId).toBeNull();
      expect(prismaMock.auditLog.create.mock.calls.map((c) => c[0].data.action)).toEqual(['reply']);
    });

    it('preview nao toca em token e usa link ficticio', async () => {
      const cookieHeader = await setup(pristineBaseQuoteResponse);

      const res = await request(app)
        .post('/api/v1/quote-responses/77/reply/preview')
        .set('Cookie', cookieHeader)
        .send({});

      expect(res.status).toBe(200);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.supplierPortalToken.create).not.toHaveBeenCalled();
      expect(prismaMock.supplierPortalToken.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
      expect(res.body.html).toContain('/portal/preview?token=PREVIEW&amp;v=');
      expect(res.body.html).toContain('Review or adjust your proposal');
      expect(res.body.text).toContain('/portal/preview?token=PREVIEW&v=');
      expect(sendAndLogMock).not.toHaveBeenCalled();
    });

    it('template do banco sem {{portalLink}}: o botao e injetado antes de "Best regards" (uma vez)', async () => {
      const cookieHeader = await setup(pristineBaseQuoteResponse);
      prismaMock.emailTemplate.findUnique.mockResolvedValue(
        dbReplyTemplate({
          htmlBody: '<html><body><p>Dear {{supplierContactName}},</p>{{message}}<table><thead>{{itemsHeaderRow}}</thead><tbody>{{itemsRows}}</tbody></table><p style="margin:0;">Best regards,</p></body></html>',
          textBody: 'Dear {{supplierContactName}},\n\n{{messageText}}{{itemsTextTable}}\n\nBest regards,',
        }),
      );

      const call = await send(cookieHeader, 77);
      const raw = rawTokenFromHtml(call.html);

      expect(call.html.split('Review or adjust your proposal</a>')).toHaveLength(2);
      expect(call.html.indexOf('Review or adjust your proposal')).toBeGreaterThan(call.html.indexOf('</table>'));
      expect(call.html.indexOf('Review or adjust your proposal')).toBeLessThan(call.html.indexOf('Best regards,'));
      expect(call.html).not.toContain('{{');
      expect(call.text).toContain(`Review or adjust your proposal: `);
      expect(call.text).toContain(`token=${raw}&v=`);
      expect(call.text.indexOf('Review or adjust')).toBeLessThan(call.text.indexOf('Best regards,'));
    });

    it('falha de SMTP devolve 502 com o token ja rotacionado (reenviar rotaciona de novo)', async () => {
      const cookieHeader = await setup(pristineBaseQuoteResponse);
      sendAndLogMock.mockResolvedValue({ status: 'failed', error: 'SMTP indisponivel' });

      const res = await request(app)
        .post('/api/v1/quote-responses/77/reply')
        .set('Cookie', cookieHeader)
        .send({});

      expect(res.status).toBe(502);
      expect(prismaMock.supplierPortalToken.create).toHaveBeenCalledTimes(1);
      const reply = prismaMock.auditLog.create.mock.calls.find((c) => c[0].data.action === 'reply')![0].data;
      expect(reply.metadata).toMatchObject({ status: 'failed', portalTokenId: CREATED_TOKEN_ID });
    });
  });
});
