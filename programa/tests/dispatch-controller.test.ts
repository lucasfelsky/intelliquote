import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mailer/MailerService', () => ({
  sendAndLog: vi.fn(),
  getComexCcList: vi.fn(() => [{ email: 'comex@intelliquote.local' }]),
  getMailer: vi.fn(),
}));

import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { getComexCcList, sendAndLog } from '../src/mailer/MailerService';
import { hashPassword } from '../src/utils/password';
import {
  renderDispatchFromTemplate,
  type QuoteDispatchVars,
} from '../src/mailer/renderQuoteDispatch';

const sendAndLogMock = sendAndLog as unknown as ReturnType<typeof vi.fn>;

vi.mock('../src/lib/prisma', () => {
  const tx = {
    supplierPortalResponse: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    supplierPortalToken: {
      update: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    quoteRequest: {
      findFirst: vi.fn(),
    },
    supplier: {
      findUnique: vi.fn(),
    },
    supplierContact: {
      findUnique: vi.fn(),
    },
    dispatchEvent: {
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };
  const supplierPortalToken = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
  };
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
    quoteRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    quoteRequestItem: {
      findMany: vi.fn(),
    },
    supplier: {
      findMany: vi.fn(),
    },
    supplierContact: {
      findMany: vi.fn(),
    },
    supplierPortalToken,
    dispatchEvent: {
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 123, ...data, createdAt: new Date() }),
      ),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 123, ...data })),
    },
    mailLog: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue({ id: 1 }),
    },
    auditLog: {
      create: vi.fn(),
    },
    supplierPortalTokenLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    companyProfile: {
      findUnique: vi.fn().mockResolvedValue({
        id: 1,
        companyName: 'SQ Quimica',
        purchasingEmail: 'comex@intelliquote.local',
        purchasingPhone: null,
        tradeName: null,
        taxId: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        logoUrl: null,
        signatureName: null,
        signatureTitle: null,
        signatureImageUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      create: vi.fn(),
      update: vi.fn(),
    },
    emailTemplate: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => cb(tx)),
    __tx: tx,
  };
  return { prisma };
});

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  quoteRequest: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  supplier: { findMany: ReturnType<typeof vi.fn> };
  supplierContact: { findMany: ReturnType<typeof vi.fn> };
  supplierPortalToken: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  dispatchEvent: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  mailLog: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  emailTemplate: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};

async function loginAdmin() {
  const passwordHash = await hashPassword('ChangeMe123!');
  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    name: 'Admin',
    email: 'admin@intelliquote.local',
    passwordHash,
    isActive: true,
    role: { name: 'admin' },
  });
  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: 'Admin',
    email: 'admin@intelliquote.local',
    isActive: true,
    role: { name: 'admin' },
  });
  prismaMock.session.create.mockImplementation(({ data }) => Promise.resolve({ id: data.id }));
  const res = await request(app).post('/api/v1/auth/login').send({
    email: 'admin@intelliquote.local',
    password: 'ChangeMe123!',
  });
  if (res.status !== 200) {
    throw new Error(`login admin failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function setupAuthMocks() {
  const passwordHash = await hashPassword('ChangeMe123!');
  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    name: 'Admin',
    email: 'admin@intelliquote.local',
    passwordHash,
    isActive: true,
    role: { name: 'admin' },
  });
  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: 'Admin',
    email: 'admin@intelliquote.local',
    isActive: true,
    role: { name: 'admin' },
  });
  prismaMock.session.create.mockImplementation(({ data }) => Promise.resolve({ id: data.id }));
}

describe('Dispatch controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.dispatchEvent.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 123, ...data, createdAt: new Date() }),
    );
    prismaMock.dispatchEvent.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 123, ...data }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function loginAndGetCookie(): Promise<string> {
    const passwordHash = await hashPassword('ChangeMe123!');
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      name: 'Admin',
      email: 'admin@intelliquote.local',
      passwordHash,
      isActive: true,
      role: { name: 'admin' },
    });
    prismaMock.user.findFirst.mockResolvedValue({
      id: 1,
      name: 'Admin',
      email: 'admin@intelliquote.local',
      isActive: true,
      role: { name: 'admin' },
    });
    prismaMock.session.create.mockImplementation(({ data }) => Promise.resolve({ id: data.id }));
    const authRes = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@intelliquote.local',
      password: 'ChangeMe123!',
    });
    if (authRes.status !== 200) {
      throw new Error(`login failed: ${authRes.status} ${JSON.stringify(authRes.body)}`);
    }
    const cookies = (authRes.headers['set-cookie'] as string[] | undefined) ?? [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  it('dispara e-mail para cada destinatario e loga em MailLog', async () => {
    const cookieHeader = await loginAndGetCookie();
    prismaMock.user.findFirst.mockResolvedValue({
      id: 1,
      name: 'Admin',
      email: 'admin@intelliquote.local',
      isActive: true,
      role: { name: 'admin' },
    });
    prismaMock.dispatchEvent.create.mockClear();
    prismaMock.dispatchEvent.update.mockClear();
    prismaMock.dispatchEvent.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 123, ...data, createdAt: new Date() }),
    );
    prismaMock.dispatchEvent.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 123, ...data }),
    );

    prismaMock.quoteRequest.findFirst.mockResolvedValue({
      id: 5,
      requestCode: 'QR-2026-001',
      productName: 'Acido sulfurico',
      desiredIncoterm: ['FOB'],
      currency: 'USD',
      deadlineAt: null,
      status: 'open',
      items: [
        { id: 11, itemCode: 'A1', productName: 'Acido sulfurico', quantity: 1, unit: 'UN', targetPrice: null, createdAt: new Date() },
      ],
    });
    prismaMock.supplierContact.findMany.mockImplementation(async (args: { where?: { id?: { in?: number[] } } } = {}) => {
      const ids = args?.where?.id?.in ?? [];
      const all = [
        {
          id: 9,
          name: 'John',
          email: 'john@acme.com',
          supplierId: 2,
          isActive: true,
          supplier: { id: 2, name: 'Acme' },
        },
      ];
      if (ids.length === 0) return all;
      return all.filter((c) => ids.includes(c.id));
    });
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue({
      id: 42,
      rawTokenHash: 'h',
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      revokedAt: null,
      firstSeenAt: null,
      lastSeenAt: null,
      accessCount: 0,
      respondedAt: null,
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
      dispatchEventId: 123,
      createdById: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prismaMock.supplierPortalToken.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.supplierPortalToken.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 42, ...data }),
    );
    sendAndLogMock.mockResolvedValue({ providerMessageId: 'msg-1', status: 'sent' });

    const res = await request(app)
      .post('/api/v1/quote-requests/5/dispatch')
      .set('Cookie', cookieHeader)
      .send({ recipientContactIds: [9], expiresInDays: 7 });

    expect(res.status).toBe(201);
    expect(res.body.sentCount).toBe(1);
    expect(res.body.failedCount).toBe(0);
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const call = sendAndLogMock.mock.calls[0][0];
    expect(call.to.email).toBe('john@acme.com');
    expect(call.cc[0].email).toBe('comex@intelliquote.local');
  });

  it('adiciona contatos secundarios do mesmo fornecedor como CC automatico', async () => {
    const cookieHeader = await loginAndGetCookie();
    prismaMock.user.findFirst.mockResolvedValue({
      id: 1,
      name: 'Admin',
      email: 'admin@intelliquote.local',
      isActive: true,
      role: { name: 'admin' },
    });
    prismaMock.dispatchEvent.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 124, ...data, createdAt: new Date() }),
    );
    prismaMock.dispatchEvent.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 124, ...data }),
    );

    prismaMock.quoteRequest.findFirst.mockResolvedValue({
      id: 8,
      requestCode: 'QR-2026-004',
      productName: 'Produto',
      desiredIncoterm: ['FOB'],
      currency: 'USD',
      deadlineAt: null,
      status: 'open',
      items: [
        { id: 21, itemCode: 'B1', productName: 'Produto', quantity: 1, unit: 'UN', targetPrice: null, createdAt: new Date() },
      ],
    });

    // 1a chamada: recipientsByContactIds (id in [10])
    // 2a chamada: loadSiblingContactsForCc (id notIn [10])
    prismaMock.supplierContact.findMany.mockImplementation(async (args: { where?: { id?: { in?: number[]; notIn?: number[] } } } = {}) => {
      const all = [
        { id: 10, name: 'John Primary', email: 'john@acme.com', supplierId: 2, isActive: true, supplier: { id: 2, name: 'Acme' } },
        { id: 11, name: 'Mary Secondary', email: 'mary@acme.com', supplierId: 2, isActive: true, supplier: { id: 2, name: 'Acme' } },
        { id: 12, name: 'Bob Secondary', email: 'bob@acme.com', supplierId: 2, isActive: true, supplier: { id: 2, name: 'Acme' } },
        { id: 20, name: 'Other Supplier', email: 'other@other.com', supplierId: 3, isActive: true, supplier: { id: 3, name: 'Other' } },
      ];
      const inFilter = args?.where?.id?.in;
      const notInFilter = args?.where?.id?.notIn;
      if (inFilter) return all.filter((c) => inFilter.includes(c.id));
      if (notInFilter) return all.filter((c) => !notInFilter.includes(c.id));
      return all;
    });

    prismaMock.supplierPortalToken.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 43, ...data }),
    );
    sendAndLogMock.mockResolvedValue({ providerMessageId: 'msg-2', status: 'sent' });

    const res = await request(app)
      .post('/api/v1/quote-requests/8/dispatch')
      .set('Cookie', cookieHeader)
      .send({ recipientContactIds: [10], expiresInDays: 7 });

    expect(res.status).toBe(201);
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const call = sendAndLogMock.mock.calls[0][0];
    const ccEmails = (call.cc ?? []).map((c: { email: string }) => c.email);
    // globalComexCc (comex@intelliquote.local) + 2 siblings
    expect(ccEmails).toEqual(
      expect.arrayContaining(['comex@intelliquote.local', 'mary@acme.com', 'bob@acme.com']),
    );
    expect(ccEmails).not.toContain('other@other.com');
    // ccCount in result reflects merged CC list
    expect(res.body.results[0].ccCount).toBe(3);
  });

  it('retorna 400 quando a cotacao esta fechada', async () => {
    const cookieHeader = await loginAndGetCookie();
    prismaMock.user.findFirst.mockResolvedValue({
      id: 1,
      name: 'Admin',
      email: 'admin@intelliquote.local',
      isActive: true,
      role: { name: 'admin' },
    });
    prismaMock.quoteRequest.findFirst.mockResolvedValue({
      id: 6,
      requestCode: 'QR-2026-002',
      productName: 'X',
      desiredIncoterm: ['FOB'],
      currency: 'USD',
      deadlineAt: null,
      status: 'closed',
      items: [],
    });
    const res = await request(app)
      .post('/api/v1/quote-requests/6/dispatch')
      .set('Cookie', cookieHeader)
      .send({ recipientContactIds: [1] });
    expect(res.status).toBe(400);
  });

  it('gera preview com HTML e lista de destinatarios', async () => {
    const cookieHeader = await loginAndGetCookie();
    prismaMock.user.findFirst.mockResolvedValue({
      id: 1,
      name: 'Admin',
      email: 'admin@intelliquote.local',
      isActive: true,
      role: { name: 'admin' },
    });
    prismaMock.quoteRequest.findFirst.mockResolvedValue({
      id: 7,
      requestCode: 'QR-2026-003',
      productName: 'X',
      desiredIncoterm: ['CIF'],
      currency: 'USD',
      deadlineAt: null,
      items: [],
    });
    prismaMock.supplierContact.findMany.mockResolvedValue([
      { id: 1, name: 'A', email: 'a@a.com', supplierId: 1, supplier: { id: 1, name: 'S1' } },
    ]);
    const res = await request(app)
      .post('/api/v1/quote-requests/7/dispatch/preview')
      .set('Cookie', cookieHeader)
      .send({ recipientContactIds: [1] });
    expect(res.status).toBe(200);
    expect(res.body.recipientCount).toBe(1);
    expect(res.body.preview.subject).toContain('QR-2026-003');
    expect(res.body.preview.subject).toContain('QR-2026-003');
  });

  describe('preview acompanha assunto/mensagem/validade do modal', () => {
    const formatEnGb = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);

    function mockPreviewData(overrides: Record<string, unknown> = {}) {
      prismaMock.quoteRequest.findFirst.mockResolvedValue({
        id: 7,
        requestCode: 'QR-2026-003',
        productName: 'X',
        desiredIncoterm: ['CIF'],
        currency: 'USD',
        deadlineAt: null,
        status: 'open',
        items: [
          { id: 31, itemCode: 'C1', productName: 'X', quantity: 1, unit: 'UN', targetPrice: null, createdAt: new Date() },
        ],
        ...overrides,
      });
      prismaMock.supplierContact.findMany.mockResolvedValue([
        { id: 1, name: 'A', email: 'a@a.com', supplierId: 1, isActive: true, supplier: { id: 1, name: 'S1' } },
      ]);
    }

    async function postPreview(cookieHeader: string, body: Record<string, unknown>) {
      return request(app)
        .post('/api/v1/quote-requests/7/dispatch/preview')
        .set('Cookie', cookieHeader)
        .send(body);
    }

    it('aplica assunto custom e injeta a mensagem (html escapado + prefixo no texto)', async () => {
      const cookieHeader = await loginAndGetCookie();
      mockPreviewData();
      const res = await postPreview(cookieHeader, {
        recipientContactIds: [1],
        subject: 'Assunto custom',
        message: 'Linha 1\n<b>x</b>',
      });
      expect(res.status).toBe(200);
      expect(res.body.preview.subject).toBe('Assunto custom');
      expect(res.body.preview.html).toContain('Additional message from the buyer');
      expect(res.body.preview.html).toContain('&lt;b&gt;x&lt;/b&gt;');
      expect(res.body.preview.text.startsWith('Linha 1\n<b>x</b>\n\n')).toBe(true);
    });

    it('subject vazio cai no assunto padrao com o requestCode', async () => {
      const cookieHeader = await loginAndGetCookie();
      mockPreviewData();
      const res = await postPreview(cookieHeader, { recipientContactIds: [1], subject: '' });
      expect(res.status).toBe(200);
      expect(res.body.preview.subject).toContain('QR-2026-003');
    });

    it('valida os mesmos limites do create (expiresInDays > 60 e subject so com espacos => 400)', async () => {
      const cookieHeader = await loginAndGetCookie();
      mockPreviewData();
      const tooLong = await postPreview(cookieHeader, { recipientContactIds: [1], expiresInDays: 61 });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.field).toBe('expiresInDays');
      const blank = await postPreview(cookieHeader, { recipientContactIds: [1], subject: '   ' });
      expect(blank.status).toBe(400);
      expect(blank.body.field).toBe('subject');
    });

    it('a data "Link expires on" do preview segue expiresInDays', async () => {
      const cookieHeader = await loginAndGetCookie();
      mockPreviewData();
      const today = new Date();
      const in30 = new Date(today.getTime() + 30 * 86_400_000);
      const res = await postPreview(cookieHeader, { recipientContactIds: [1], expiresInDays: 30 });
      expect(res.status).toBe(200);
      expect(res.body.preview.text).toContain(`Link expires on: ${formatEnGb(in30)}`);
      expect(res.body.preview.text).not.toContain(`Link expires on: ${formatEnGb(today)}`);
    });

    it('paridade: preview e envio geram o mesmo assunto, html e texto', async () => {
      const cookieHeader = await loginAndGetCookie();
      mockPreviewData({ id: 7 });
      prismaMock.supplierPortalToken.findUnique.mockResolvedValue({
        id: 44,
        rawTokenHash: 'h',
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        revokedAt: null,
        firstSeenAt: null,
        lastSeenAt: null,
        accessCount: 0,
        respondedAt: null,
        quoteRequestId: 7,
        supplierId: 1,
        supplierContactId: 1,
        dispatchEventId: 123,
        createdById: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prismaMock.supplierPortalToken.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.supplierPortalToken.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 44, ...data }),
      );
      sendAndLogMock.mockResolvedValue({ providerMessageId: 'msg-p', status: 'sent' });
      const payload = {
        recipientContactIds: [1],
        subject: 'Assunto paridade',
        message: 'Mensagem & detalhes\nsegunda linha',
        expiresInDays: 7,
      };

      const previewRes = await postPreview(cookieHeader, payload);
      expect(previewRes.status).toBe(200);
      const sendRes = await request(app)
        .post('/api/v1/quote-requests/7/dispatch')
        .set('Cookie', cookieHeader)
        .send(payload);
      expect(sendRes.status).toBe(201);
      expect(sendAndLogMock).toHaveBeenCalledTimes(1);

      const sent = sendAndLogMock.mock.calls[0][0] as { subject: string; html: string; text: string };
      const normalizeLink = (value: string) =>
        value.replace(/https?:\/\/[^\s"<]*portal[^\s"<]*/g, '<LINK>');
      expect(previewRes.body.preview.subject).toBe(sent.subject);
      expect(normalizeLink(previewRes.body.preview.html)).toBe(normalizeLink(sent.html));
      expect(normalizeLink(previewRes.body.preview.text)).toBe(normalizeLink(sent.text));
    });
  });

  it('injeta a mensagem do comprador ANTES da saudacao "Dear" no html enviado', async () => {
    const cookieHeader = await loginAndGetCookie();
    prismaMock.user.findFirst.mockResolvedValue({
      id: 1,
      name: 'Admin',
      email: 'admin@intelliquote.local',
      isActive: true,
      role: { name: 'admin' },
    });
    prismaMock.dispatchEvent.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 125, ...data, createdAt: new Date() }),
    );
    prismaMock.dispatchEvent.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 125, ...data }),
    );

    prismaMock.quoteRequest.findFirst.mockResolvedValue({
      id: 9,
      requestCode: 'QR-2026-005',
      productName: 'Soda caustica',
      desiredIncoterm: ['FOB'],
      currency: 'USD',
      deadlineAt: null,
      status: 'open',
      items: [
        { id: 31, itemCode: 'C1', productName: 'Soda caustica', quantity: 1, unit: 'UN', targetPrice: null, createdAt: new Date() },
      ],
    });
    prismaMock.supplierContact.findMany.mockImplementation(async (args: { where?: { id?: { in?: number[] } } } = {}) => {
      const ids = args?.where?.id?.in ?? [];
      const all = [
        {
          id: 13,
          name: 'Carla',
          email: 'carla@acme.com',
          supplierId: 4,
          isActive: true,
          supplier: { id: 4, name: 'Acme2' },
        },
      ];
      if (ids.length === 0) return all;
      return all.filter((c) => ids.includes(c.id));
    });
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue({
      id: 44,
      rawTokenHash: 'h',
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      revokedAt: null,
      firstSeenAt: null,
      lastSeenAt: null,
      accessCount: 0,
      respondedAt: null,
      quoteRequestId: 9,
      supplierId: 4,
      supplierContactId: 13,
      dispatchEventId: 125,
      createdById: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prismaMock.supplierPortalToken.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.supplierPortalToken.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 44, ...data }),
    );
    sendAndLogMock.mockResolvedValue({ providerMessageId: 'msg-3', status: 'sent' });

    const res = await request(app)
      .post('/api/v1/quote-requests/9/dispatch')
      .set('Cookie', cookieHeader)
      .send({
        recipientContactIds: [13],
        expiresInDays: 7,
        message: 'Precisamos da proposta ate sexta-feira.',
      });

    expect(res.status).toBe(201);
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const call = sendAndLogMock.mock.calls[0][0];
    expect(call.html).toContain('Additional message from the buyer');
    expect(call.html.indexOf('Additional message from the buyer')).toBeLessThan(
      call.html.indexOf('Dear'),
    );
    expect(call.html).toContain('padding:18px 32px 0 32px');
    expect(call.html).not.toContain('margin:0 32px');
  });
});

describe('comexCcFirstOnly - equipe COMEX so no primeiro e-mail', () => {
  const COMEX = 'comex@intelliquote.local';
  const FIXO = 'fixo@empresa.com';
  const auditLogMock = (prisma as unknown as { auditLog: { create: ReturnType<typeof vi.fn> } })
    .auditLog;

  const baseProfile = {
    id: 1,
    companyName: 'SQ Quimica',
    purchasingEmail: 'comex@intelliquote.local',
    purchasingPhone: null,
    tradeName: null,
    taxId: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    logoUrl: null,
    signatureName: null,
    signatureTitle: null,
    signatureImageUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const contacts = [
    { id: 10, name: 'Um', email: 'um@a.com', supplierId: 2, isActive: true, supplier: { id: 2, name: 'A' } },
    { id: 11, name: 'Irmao A', email: 'irmao-a@a.com', supplierId: 2, isActive: true, supplier: { id: 2, name: 'A' } },
    { id: 20, name: 'Dois', email: 'dois@b.com', supplierId: 3, isActive: true, supplier: { id: 3, name: 'B' } },
    { id: 30, name: 'Tres', email: 'tres@c.com', supplierId: 4, isActive: true, supplier: { id: 4, name: 'C' } },
    { id: 31, name: 'Irmao C', email: 'irmao-c@c.com', supplierId: 4, isActive: true, supplier: { id: 4, name: 'C' } },
  ];

  let cachedCookie = '';

  async function setup(withFixo = true): Promise<string> {
    const passwordHash = await hashPassword('ChangeMe123!');
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      name: 'Admin',
      email: 'admin@intelliquote.local',
      passwordHash,
      isActive: true,
      role: { name: 'admin' },
    });
    prismaMock.user.findFirst.mockResolvedValue({
      id: 1,
      name: 'Admin',
      email: 'admin@intelliquote.local',
      isActive: true,
      role: { name: 'admin' },
    });
    prismaMock.session.create.mockImplementation(({ data }) => Promise.resolve({ id: data.id }));
    // Um unico login para o describe inteiro (rate limit do /auth/login).
    if (!cachedCookie) {
      const authRes = await request(app).post('/api/v1/auth/login').send({
        email: 'admin@intelliquote.local',
        password: 'ChangeMe123!',
      });
      if (authRes.status !== 200) {
        throw new Error(`login failed: ${authRes.status}`);
      }
      const cookies = (authRes.headers['set-cookie'] as string[] | undefined) ?? [];
      cachedCookie = cookies.map((c) => c.split(';')[0]).join('; ');
    }
    const cookieHeader = cachedCookie;

    prismaMock.quoteRequest.findFirst.mockResolvedValue({
      id: 9,
      requestCode: 'QR-2026-009',
      productName: 'Produto',
      desiredIncoterm: ['FOB'],
      currency: 'USD',
      deadlineAt: null,
      status: 'open',
      items: [
        { id: 91, itemCode: 'Z1', productName: 'Produto', quantity: 1, unit: 'UN', targetPrice: null, createdAt: new Date() },
      ],
    });
    prismaMock.supplierContact.findMany.mockImplementation(
      async (args: { where?: { id?: { in?: number[]; notIn?: number[] } } } = {}) => {
        const inFilter = args?.where?.id?.in;
        const notInFilter = args?.where?.id?.notIn;
        if (inFilter) return contacts.filter((c) => inFilter.includes(c.id));
        if (notInFilter) return contacts.filter((c) => !notInFilter.includes(c.id));
        return contacts;
      },
    );
    prismaMock.supplierPortalToken.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 50, ...data }),
    );
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue({
      id: 50,
      rawTokenHash: 'h',
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      revokedAt: null,
    });
    prismaMock.supplierPortalToken.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.dispatchEvent.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 125, ...data, createdAt: new Date() }),
    );
    prismaMock.dispatchEvent.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 125, ...data }),
    );
    const companyProfileFind = (
      prisma as unknown as { companyProfile: { findUnique: ReturnType<typeof vi.fn> } }
    ).companyProfile.findUnique;
    companyProfileFind.mockResolvedValueOnce(
      withFixo ? { ...baseProfile, dispatchCc: JSON.stringify([FIXO]) } : { ...baseProfile },
    );
    sendAndLogMock.mockResolvedValue({ providerMessageId: 'msg', status: 'sent' });
    return cookieHeader;
  }

  const ccOf = (callIndex: number): string[] =>
    ((sendAndLogMock.mock.calls[callIndex][0].cc ?? []) as Array<{ email: string }>).map(
      (c) => c.email,
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('a) ligado: so o 1o e-mail enviado leva COMEX + CC fixo; siblings em todos; auditoria registra', async () => {
    const cookie = await setup();
    const res = await request(app)
      .post('/api/v1/quote-requests/9/dispatch')
      .set('Cookie', cookie)
      .send({ recipientContactIds: [10, 20, 30], expiresInDays: 7, comexCcFirstOnly: true });

    expect(res.status).toBe(201);
    expect(sendAndLogMock).toHaveBeenCalledTimes(3);
    expect(ccOf(0)).toEqual(expect.arrayContaining([COMEX, FIXO, 'irmao-a@a.com']));
    expect(ccOf(1)).not.toContain(COMEX);
    expect(ccOf(1)).not.toContain(FIXO);
    expect(ccOf(2)).not.toContain(COMEX);
    expect(ccOf(2)).not.toContain(FIXO);
    expect(ccOf(2)).toContain('irmao-c@c.com');
    expect(res.body.results.map((r: { comexCc: boolean }) => r.comexCc)).toEqual([
      true,
      false,
      false,
    ]);

    const dispatchAudit = auditLogMock.create.mock.calls
      .map((c: Array<{ data: { action: string; metadata: Record<string, unknown> } }>) => c[0].data)
      .find((d: { action: string }) => d.action === 'dispatch');
    expect(dispatchAudit).toBeDefined();
    expect(dispatchAudit.metadata).toMatchObject({
      comexCcFirstOnly: true,
      comexCcContactId: 10,
    });
  });

  it('b) 1o envio falha (status failed): a copia passa para o proximo', async () => {
    const cookie = await setup();
    sendAndLogMock.mockResolvedValueOnce({ status: 'failed', error: 'x' });
    const res = await request(app)
      .post('/api/v1/quote-requests/9/dispatch')
      .set('Cookie', cookie)
      .send({ recipientContactIds: [10, 20, 30], comexCcFirstOnly: true });

    expect(res.status).toBe(201);
    expect(sendAndLogMock).toHaveBeenCalledTimes(3);
    expect(ccOf(1)).toEqual(expect.arrayContaining([COMEX, FIXO]));
    expect(ccOf(2)).not.toContain(COMEX);
    expect(ccOf(2)).not.toContain(FIXO);
    expect(res.body.results[0].comexCc).toBe(false);
    expect(res.body.results[1].comexCc).toBe(true);
    expect(res.body.results[2].comexCc).toBe(false);
  });

  it("b3) 1o envio 'queued' (provedor aceitou): conta como enviado e a copia NAO passa para o proximo", async () => {
    const cookie = await setup();
    sendAndLogMock.mockResolvedValueOnce({ providerMessageId: 'q', status: 'queued' });
    const res = await request(app)
      .post('/api/v1/quote-requests/9/dispatch')
      .set('Cookie', cookie)
      .send({ recipientContactIds: [10, 20, 30], comexCcFirstOnly: true });

    expect(res.status).toBe(201);
    expect(sendAndLogMock).toHaveBeenCalledTimes(3);
    expect(ccOf(0)).toEqual(expect.arrayContaining([COMEX, FIXO]));
    expect(ccOf(1)).not.toContain(COMEX);
    expect(ccOf(1)).not.toContain(FIXO);
    expect(ccOf(2)).not.toContain(COMEX);
    expect(res.body.sentCount).toBe(3);
    expect(res.body.failedCount).toBe(0);
    expect(res.body.results.map((r: { comexCc: boolean }) => r.comexCc)).toEqual([true, false, false]);
  });

  it('b2) 1o envio falha por excecao: a copia passa para o proximo', async () => {
    const cookie = await setup();
    sendAndLogMock.mockRejectedValueOnce(new Error('smtp'));
    const res = await request(app)
      .post('/api/v1/quote-requests/9/dispatch')
      .set('Cookie', cookie)
      .send({ recipientContactIds: [10, 20, 30], comexCcFirstOnly: true });

    expect(res.status).toBe(201);
    expect(ccOf(1)).toEqual(expect.arrayContaining([COMEX, FIXO]));
    expect(ccOf(2)).not.toContain(COMEX);
    expect(res.body.results[0].comexCc).toBe(false);
    expect(res.body.results[1].comexCc).toBe(true);
  });

  it.each([
    ['false explicito', { comexCcFirstOnly: false }],
    ['campo ausente', {}],
  ])('c) %s: todos os e-mails levam COMEX + CC fixo', async (_label, extra) => {
    const cookie = await setup();
    const res = await request(app)
      .post('/api/v1/quote-requests/9/dispatch')
      .set('Cookie', cookie)
      .send({ recipientContactIds: [10, 20, 30], ...extra });

    expect(res.status).toBe(201);
    expect(sendAndLogMock).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i += 1) {
      expect(ccOf(i)).toEqual(expect.arrayContaining([COMEX, FIXO]));
    }
    expect(res.body.results.every((r: { comexCc: boolean }) => r.comexCc === true)).toBe(true);
  });

  it('d) lista COMEX vazia: segue normal, siblings em cc e nenhum comexCc', async () => {
    const cookie = await setup(false);
    vi.mocked(getComexCcList).mockReturnValueOnce([]);
    const res = await request(app)
      .post('/api/v1/quote-requests/9/dispatch')
      .set('Cookie', cookie)
      .send({ recipientContactIds: [10, 20, 30], comexCcFirstOnly: true });

    expect(res.status).toBe(201);
    expect(res.body.sentCount).toBe(3);
    expect(ccOf(0)).toContain('irmao-a@a.com');
    expect(ccOf(2)).toContain('irmao-c@c.com');
    expect(res.body.results.some((r: { comexCc: boolean }) => r.comexCc === true)).toBe(false);
    const dispatchAudit = auditLogMock.create.mock.calls
      .map((c: Array<{ data: { action: string; metadata: Record<string, unknown> } }>) => c[0].data)
      .find((d: { action: string }) => d.action === 'dispatch');
    expect(dispatchAudit.metadata).toMatchObject({
      comexCcFirstOnly: true,
      comexCcContactId: null,
    });
  });
});

// Abordagem A (unit): renderDispatchFromTemplate mockando a fonte de dados da
// template (prisma.emailTemplate, ja mockado no topo deste arquivo, e a
// dependencia real de EmailTemplateService.get). Cobre a precedencia do
// subjectOverride sobre o subject persistido no banco.
describe('renderDispatchFromTemplate - subject override do modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseVars: QuoteDispatchVars = {
    subject: 'Fallback Subject',
    supplierContactName: 'John Doe',
    requestCode: 'QR-2026-099',
    productName: 'Acido sulfurico',
    quantity: 10,
    unit: 'UN',
    desiredIncoterm: 'FOB',
    currency: 'USD',
    deadlineAt: '01 Jan 2026',
    expiresAt: '15 Jan 2026',
    portalLink: 'https://portal.example.com/portal?token=abc',
    companyName: 'SQ Quimica',
    purchasingEmail: 'comex@intelliquote.local',
    items: [],
  };

  function mockDbTemplate() {
    prismaMock.emailTemplate.findUnique.mockResolvedValue({
      id: 1,
      key: 'quote_dispatch',
      locale: 'en',
      subject: 'Sourcing request {{requestCode}} - {{productName}}',
      htmlBody: '<div>{{subject}}</div>',
      textBody: '{{subject}}',
      isActive: true,
      updatedAt: new Date(),
      updatedById: null,
    });
  }

  it('COM override: assunto do modal vence o subject da template do banco', async () => {
    mockDbTemplate();

    const result = await renderDispatchFromTemplate(baseVars, 'en', 'Assunto Do Modal 123');

    expect(result.subject).toBe('Assunto Do Modal 123');
    expect(result.html).toContain('Assunto Do Modal 123');
    expect(result.html).not.toContain('Sourcing request QR-2026-099 - Acido sulfurico');
  });

  it('SEM override: mantem o comportamento atual (subject renderizado da template do banco)', async () => {
    mockDbTemplate();

    const result = await renderDispatchFromTemplate(baseVars, 'en');

    expect(result.subject).toBe('Sourcing request QR-2026-099 - Acido sulfurico');
    expect(result.html).toContain('Sourcing request QR-2026-099 - Acido sulfurico');
  });
});

describe('Portal tokens - listagem sem hash e "Gerar novo link"', () => {
  const tx = (prisma as unknown as { __tx: any }).__tx;

  async function loginAs(role: string): Promise<string> {
    const passwordHash = await hashPassword('ChangeMe123!');
    const user = {
      id: 1,
      name: 'U',
      email: 'u@intelliquote.local',
      passwordHash,
      isActive: true,
      role: { name: role },
    };
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.user.findFirst.mockResolvedValue(user);
    prismaMock.session.create.mockImplementation(({ data }) => Promise.resolve({ id: data.id }));
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'u@intelliquote.local',
      password: 'ChangeMe123!',
    });
    if (res.status !== 200) throw new Error('login failed: ' + res.status);
    const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  const previousToken = {
    id: 99,
    quoteRequestId: 1,
    supplierId: 5,
    supplierContactId: 10,
    tokenHash: 'hash-secreto-do-fixture',
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    respondedAt: null,
    dispatchEventId: 7,
    createdById: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tx.supplierPortalToken.findUnique.mockResolvedValue(previousToken);
    tx.quoteRequest.findFirst.mockResolvedValue({ id: 1 });
    tx.supplierPortalToken.updateMany.mockResolvedValue({ count: 1 });
    tx.supplierPortalToken.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 100,
        ...data,
        revokedAt: null,
        respondedAt: null,
        accessCount: 0,
      }),
    );
    tx.supplier.findUnique.mockResolvedValue({ id: 5, name: 'ACME Ltda' });
    tx.supplierContact.findUnique.mockResolvedValue({ id: 10, name: 'Contato', email: 'c@acme.com' });
    tx.auditLog.create.mockResolvedValue({});
  });

  it('GET portal-tokens nao expoe tokenHash nem campo token', async () => {
    const cookie = await loginAs('admin');
    prismaMock.supplierPortalToken.findMany = vi.fn().mockResolvedValue([
      {
        ...previousToken,
        supplier: { name: 'ACME Ltda' },
        supplierContact: { name: 'Contato', email: 'c@acme.com' },
        response: null,
        firstSeenAt: null,
        lastSeenAt: null,
        accessCount: 0,
        createdAt: new Date(),
      },
    ]);

    const res = await request(app).get('/api/v1/quote-requests/1/portal-tokens').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(Object.keys(res.body[0])).not.toContain('token');
    expect(JSON.stringify(res.body)).not.toContain('hash-secreto-do-fixture');
  });

  it('POST regenerate revoga o anterior, cria novo, devolve portalUrl e audita 2x sem segredos', async () => {
    const cookie = await loginAs('comprador');

    const res = await request(app).post('/api/v1/portal-tokens/99/regenerate').set('Cookie', cookie).send({});

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(100);
    expect(res.body.portalUrl).toContain('/portal?token=');
    expect(res.body.supplier).toEqual({ id: 5, name: 'ACME Ltda' });
    expect(tx.supplierPortalToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ quoteRequestId: 1, supplierContactId: 10, revokedAt: null }),
        data: { revokedAt: expect.any(Date) },
      }),
    );
    expect(tx.supplierPortalToken.create).toHaveBeenCalledTimes(1);
    expect(tx.supplierPortalToken.create.mock.calls[0][0].data).toMatchObject({
      quoteRequestId: 1,
      supplierContactId: 10,
      dispatchEventId: 7,
    });
    const actions = tx.auditLog.create.mock.calls.map((c: any[]) => c[0].data.action);
    expect(actions).toEqual(['revoke', 'generate']);
    const rawToken = new URL(res.body.portalUrl).searchParams.get('token') as string;
    const auditDump = JSON.stringify(tx.auditLog.create.mock.calls);
    expect(auditDump).not.toContain(rawToken);
    expect(auditDump).not.toContain('hash-secreto-do-fixture');
    expect(auditDump).not.toContain('tokenHash');
  });

  it('POST regenerate com token ja respondido retorna 409 sem criar token', async () => {
    const cookie = await loginAs('admin');
    tx.supplierPortalToken.findUnique.mockResolvedValue({ ...previousToken, respondedAt: new Date() });

    const res = await request(app).post('/api/v1/portal-tokens/99/regenerate').set('Cookie', cookie).send({});

    expect(res.status).toBe(409);
    expect(tx.supplierPortalToken.create).not.toHaveBeenCalled();
    expect(tx.supplierPortalToken.updateMany).not.toHaveBeenCalled();
  });

  it('POST regenerate com token inexistente retorna 404', async () => {
    const cookie = await loginAs('admin');
    tx.supplierPortalToken.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/v1/portal-tokens/99/regenerate').set('Cookie', cookie).send({});

    expect(res.status).toBe(404);
  });

  it('POST regenerate com expiresInDays invalido retorna 400', async () => {
    const cookie = await loginAs('admin');

    const res = await request(app)
      .post('/api/v1/portal-tokens/99/regenerate')
      .set('Cookie', cookie)
      .send({ expiresInDays: 90 });

    expect(res.status).toBe(400);
  });

  it('POST regenerate permite gestor (201) e audita revoke+generate', async () => {
    const cookie = await loginAs('gestor');

    const res = await request(app).post('/api/v1/portal-tokens/99/regenerate').set('Cookie', cookie).send({});

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(100);
    expect(tx.supplierPortalToken.create).toHaveBeenCalledTimes(1);
    const actions = tx.auditLog.create.mock.calls.map((c: any[]) => c[0].data.action);
    expect(actions).toEqual(['revoke', 'generate']);
  });

  it('POST regenerate retorna 403 para viewer', async () => {
    const cookie = await loginAs('viewer');

    const res = await request(app).post('/api/v1/portal-tokens/99/regenerate').set('Cookie', cookie).send({});

    expect(res.status).toBe(403);
    expect(tx.supplierPortalToken.create).not.toHaveBeenCalled();
  });
});
