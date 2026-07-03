import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    session: {
      create: vi.fn(),
    },
    emailTemplate: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
    },
    quoteRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    companyProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return { prisma };
});

import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  emailTemplate: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  quoteRequest: { findFirst: ReturnType<typeof vi.fn> };
};

async function loginAsAdmin(): Promise<string> {
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
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

describe('Email template routes — quote_reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preview do quote_reply sem customizacao usa o template padrao (arquivo) em vez de vazio', async () => {
    const cookieHeader = await loginAsAdmin();
    prismaMock.emailTemplate.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/email-templates/preview')
      .query({ key: 'quote_reply', locale: 'en' })
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fallback');
    expect(res.body.html).toContain('Quote Reply');
    expect(res.body.html).toContain('PHOTOINIATOR');
    expect(res.body.subject).toContain('SQ QUIMICA');
  });

  it('preview do quote_reply usa o template salvo no banco quando existe', async () => {
    const cookieHeader = await loginAsAdmin();
    prismaMock.emailTemplate.findUnique.mockResolvedValue({
      id: 1,
      key: 'quote_reply',
      locale: 'en',
      subject: 'Custom subject {{requestCode}}',
      htmlBody: '<p>Custom body for {{supplierName}}: {{itemsRows}}</p>',
      textBody: 'Custom text for {{supplierName}}',
      isActive: true,
      updatedAt: new Date(),
      updatedById: 1,
    });

    const res = await request(app)
      .get('/api/v1/email-templates/preview')
      .query({ key: 'quote_reply', locale: 'en' })
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('database');
    expect(res.body.subject).toContain('Custom subject');
    expect(res.body.html).toContain('Custom body for Acme Chemicals');
  });

  it('admin consegue salvar uma customizacao do quote_reply', async () => {
    const cookieHeader = await loginAsAdmin();
    prismaMock.emailTemplate.upsert.mockResolvedValue({
      id: 2,
      key: 'quote_reply',
      locale: 'en',
      subject: 'Nova resposta {{requestCode}}',
      htmlBody: '<p>{{itemsRows}}</p>',
      textBody: 'texto',
      isActive: true,
      updatedAt: new Date(),
      updatedById: 1,
    });

    const res = await request(app)
      .put('/api/v1/email-templates/quote_reply/en')
      .set('Cookie', cookieHeader)
      .send({
        subject: 'Nova resposta {{requestCode}}',
        htmlBody: '<p>{{itemsRows}}</p>',
        textBody: 'texto',
        isActive: true,
      });

    expect(res.status).toBe(200);
    expect(prismaMock.emailTemplate.upsert).toHaveBeenCalledTimes(1);
    const args = prismaMock.emailTemplate.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ key_locale: { key: 'quote_reply', locale: 'en' } });
  });
});
