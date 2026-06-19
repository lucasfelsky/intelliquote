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
    supplier: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    quoteRequest: {},
    quoteResponse: {},
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
  supplier: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

describe('RBAC on business routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.supplier.findMany.mockResolvedValue([]);
  });

  it('bloqueia acesso sem autenticacao nas rotas de negocio', async () => {
    const response = await request(app).get('/api/v1/suppliers');

    expect(response.status).toBe(401);
  });

  it('permite leitura para viewer', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app)
      .get('/api/v1/suppliers')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(prismaMock.supplier.findMany).toHaveBeenCalledTimes(1);
  });

  it('mantem a rota versionada /api/v1 funcional para leitura', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app)
      .get('/api/v1/suppliers')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(prismaMock.supplier.findMany).toHaveBeenCalledTimes(1);
  });

  it('bloqueia escrita de fornecedor para viewer', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app)
      .post('/api/v1/suppliers')
      .set('Cookie', cookies)
      .send({
        name: 'Fornecedor Viewer',
        email: 'viewer@supplier.com',
        acceptedIncoterms: ['FOB'],
      });

    expect(response.status).toBe(403);
    expect(prismaMock.supplier.create).not.toHaveBeenCalled();
  });

  it('permite escrita de fornecedor para comprador', async () => {
    const cookies = await loginAs('comprador');

    prismaMock.supplier.create.mockResolvedValue({
      id: 10,
      name: 'Fornecedor Comprador',
      email: 'comprador@supplier.com',
      website: null,
      acceptedIncoterms: ['FOB'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .post('/api/v1/suppliers')
      .set('Cookie', cookies)
      .send({
        name: 'Fornecedor Comprador',
        email: 'comprador@supplier.com',
        acceptedIncoterms: ['FOB'],
      });

    expect(response.status).toBe(201);
    expect(prismaMock.supplier.create).toHaveBeenCalledTimes(1);
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
    role: {
      name: role,
    },
  });

  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: {
      name: role,
    },
  });

  prismaMock.session.create.mockResolvedValue({
    id: 'session-1',
  });

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: `${role}@intelliquote.local`,
      password: 'ChangeMe123!',
    });

  return loginResponse.headers['set-cookie'];
}
