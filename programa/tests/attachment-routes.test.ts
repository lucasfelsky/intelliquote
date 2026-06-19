import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

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
    attachment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  session: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  attachment: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
};

describe('Attachment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lista anexos para viewer', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.attachment.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/attachments')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(prismaMock.attachment.findMany).toHaveBeenCalled();
  });

  it('bloqueia escrita de anexo para viewer', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app)
      .post('/api/v1/attachments')
      .set('Cookie', cookies)
      .send({
        fileName: 'cotacao.pdf',
        contentBase64: Buffer.from('pdf-content').toString('base64'),
        fileType: 'application/pdf',
        fileSize: 11,
        entityType: 'quote_request',
        entityId: '1',
      });

    expect(response.status).toBe(403);
    expect(prismaMock.attachment.create).not.toHaveBeenCalled();
  });

  it('rejeita anexo invalido para comprador', async () => {
    const cookies = await loginAs('comprador');

    const response = await request(app)
      .post('/api/v1/attachments')
      .set('Cookie', cookies)
      .send({
        fileName: '',
        contentBase64: '',
        fileType: '',
        fileSize: -1,
        entityType: 'invalid',
        entityId: '',
      });

    expect(response.status).toBe(400);
    expect(prismaMock.attachment.create).not.toHaveBeenCalled();
  });
});

async function loginAs(role: 'admin' | 'comprador' | 'gestor' | 'viewer') {
  const passwordHash = await hashPassword('ChangeMe123!');

  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  });

  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: { name: role },
  });

  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: `${role}@intelliquote.local`,
      password: 'ChangeMe123!',
    });

  return loginResponse.headers['set-cookie'];
}
