import fs from 'fs';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTACHMENT_JSON_BODY_LIMIT_BYTES } from '../src/constants/attachments';
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
    create: ReturnType<typeof vi.fn>;
  };
};

const TEN_MB = 10 * 1024 * 1024;

describe('Autenticacao antes do parser de corpo grande', () => {
  // Evita gravar em uploads/ durante os testes.
  const mkdirSpy = vi.spyOn(fs.promises, 'mkdir');
  const writeFileSpy = vi.spyOn(fs.promises, 'writeFile');

  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSpy.mockResolvedValue(undefined);
    writeFileSpy.mockResolvedValue(undefined);
  });

  const unauthenticatedCases: Array<[string, number]> = [
    ['/api/v1/attachments', ATTACHMENT_JSON_BODY_LIMIT_BYTES],
    ['/api/v1/catalog-items/import', TEN_MB],
    ['/api/v1/suppliers/import', TEN_MB],
    ['/api/v1/quote-responses', TEN_MB],
  ];

  it.each(unauthenticatedCases)(
    'POST %s sem login devolve 401 JSON mesmo com corpo acima do limite (sem 413)',
    async (path, limit) => {
      const response = await request(app)
        .post(path)
        .send({ contentBase64: 'A'.repeat(limit + 1) });

      expect(response.status).toBe(401);
      expect(response.type).toBe('application/json');
      expect(response.body.message).toBe('Token de acesso ausente.');
    },
  );

  it('token invalido em /attachments com corpo acima do limite devolve 401, nao 413', async () => {
    const response = await request(app)
      .post('/api/v1/attachments')
      .set('Authorization', 'Bearer invalido')
      .send({ contentBase64: 'A'.repeat(ATTACHMENT_JSON_BODY_LIMIT_BYTES + 1) });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Token invalido.');
  });

  it('GET /quote-responses sem login devolve 401', async () => {
    const response = await request(app).get('/api/v1/quote-responses');

    expect(response.status).toBe(401);
  });

  it('com login o parser continua valendo: corpo acima de 10MB em /catalog-items/import devolve 413', async () => {
    const cookies = await loginAs('admin');

    const response = await request(app)
      .post('/api/v1/catalog-items/import')
      .set('Cookie', cookies)
      .send({ contentBase64: 'A'.repeat(TEN_MB + 1) });

    expect(response.status).toBe(413);
  });

  it('com login a request segue para o requireAuth/allowRoles da rota (viewer recebe 403)', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app)
      .post('/api/v1/attachments')
      .set('Cookie', cookies)
      .send({
        fileName: 'a.pdf',
        contentBase64: Buffer.from('x').toString('base64'),
        fileType: 'application/pdf',
        fileSize: 1,
        entityType: 'quote_request',
        entityId: '1',
      });

    expect(response.status).toBe(403);
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
