import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mailer/MailerService', () => ({
  sendAndLog: vi.fn(),
  getComexCcList: vi.fn(() => [{ email: 'comex@intelliquote.local' }]),
  getMailer: vi.fn(),
}));

import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { sendAndLog } from '../src/mailer/MailerService';
import { hashPassword } from '../src/utils/password';

const sendAndLogMock = sendAndLog as unknown as ReturnType<typeof vi.fn>;

vi.mock('../src/lib/prisma', () => {
  const tx = {
    supplierPortalResponse: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    supplierPortalToken: {
      update: vi.fn(),
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
});
