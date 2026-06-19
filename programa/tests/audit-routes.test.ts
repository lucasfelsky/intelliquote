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
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    quoteRequest: {},
    quoteRequestItem: {},
    quoteResponse: {},
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
    create: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

describe('Audit routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registra audit log ao criar fornecedor', async () => {
    const cookies = await loginAs('admin');

    prismaMock.supplier.create.mockResolvedValue({
      id: 77,
      name: 'Audit Supplier',
      email: 'audit@supplier.com',
      website: null,
      status: 'active',
      country: null,
      notes: null,
      createdById: 1,
      acceptedIncoterms: ['FOB'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prismaMock.auditLog.create.mockResolvedValue({
      id: 999,
    });

    const response = await request(app)
      .post('/api/v1/suppliers')
      .set('Cookie', cookies)
      .send({
        name: 'Audit Supplier',
        email: 'audit@supplier.com',
        acceptedIncoterms: ['FOB'],
      });

    expect(response.status).toBe(201);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'supplier',
          entityId: '77',
          action: 'create',
          performedById: 1,
        }),
      }),
    );
  });

  it('retorna audit logs filtrados para perfis autorizados', async () => {
    const cookies = await loginAs('gestor');

    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 1,
        entityType: 'quote_request',
        entityId: '5',
        action: 'compare',
        createdAt: new Date('2026-03-25T18:10:00.000Z'),
        performedBy: {
          id: 1,
          name: 'Comprador',
          email: 'comprador@intelliquote.local',
          role: {
            name: 'comprador',
          },
        },
      },
    ]);

    const response = await request(app)
      .get('/api/v1/audit?entityType=quote_request&entityId=5&limit=10')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityType: 'quote_request',
          entityId: '5',
        }),
        take: 10,
      }),
    );
    expect(response.body).toHaveLength(1);
    expect(response.body[0].action).toBe('compare');
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
