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
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    supplierPortalToken: {
      updateMany: vi.fn(),
    },
    quoteResponse: {
      findFirst: vi.fn(),
    },
    quoteRequest: {},
    quoteComparison: {},
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
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  supplierPortalToken: {
    updateMany: ReturnType<typeof vi.fn>;
  };
  quoteResponse: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

describe('Supplier routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bloqueia exclusao de fornecedor com propostas registadas', async () => {
    const cookies = await loginAs('admin');

    prismaMock.supplier.findFirst.mockResolvedValue({
      id: 9,
      name: 'Fornecedor Critico',
      email: 'fornecedor@teste.local',
    });
    prismaMock.quoteResponse.findFirst.mockResolvedValue({
      id: 44,
    });

    const response = await request(app)
      .delete('/api/v1/suppliers/9')
      .set('Cookie', cookies);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Inative ou bloqueie');
    expect(prismaMock.supplier.delete).not.toHaveBeenCalled();
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
