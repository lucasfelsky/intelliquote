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
    supplierContact: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    supplier: {
      findUnique: vi.fn(),
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
  supplierContact: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  supplier: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

describe('Supplier contact routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lista contatos para viewer', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.supplierContact.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/supplier-contacts')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(prismaMock.supplierContact.findMany).toHaveBeenCalled();
  });

  it('bloqueia escrita para viewer', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app)
      .post('/api/v1/supplier-contacts')
      .set('Cookie', cookies)
      .send({
        supplierId: 1,
        name: 'Contato',
        email: 'contato@supplier.com',
      });

    expect(response.status).toBe(403);
    expect(prismaMock.supplierContact.create).not.toHaveBeenCalled();
  });

  it('cria contato para comprador', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.supplier.findUnique.mockResolvedValue({ id: 1, name: 'Fornecedor' });
    prismaMock.supplierContact.findFirst.mockResolvedValue(null);
    prismaMock.supplierContact.create.mockResolvedValue({
      id: 1,
      supplierId: 1,
      name: 'Contato',
      email: 'contato@supplier.com',
      phone: null,
      role: 'Comercial',
      isPrimary: false,
    });

    const response = await request(app)
      .post('/api/v1/supplier-contacts')
      .set('Cookie', cookies)
      .send({
        supplierId: 1,
        name: 'Contato',
        email: 'contato@supplier.com',
      });

    expect(response.status).toBe(201);
    expect(prismaMock.supplierContact.create).toHaveBeenCalled();
  });

  it('rejeita dados invalidos', async () => {
    const cookies = await loginAs('comprador');

    const response = await request(app)
      .post('/api/v1/supplier-contacts')
      .set('Cookie', cookies)
      .send({});

    expect(response.status).toBe(400);
    expect(prismaMock.supplierContact.create).not.toHaveBeenCalled();
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
