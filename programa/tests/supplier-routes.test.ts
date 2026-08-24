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
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    supplierPortalToken: {
      updateMany: vi.fn(),
    },
    supplierReview: {
      groupBy: vi.fn(),
    },
    itemFamily: {
      findMany: vi.fn(),
    },
    quoteResponse: {
      findFirst: vi.fn(),
    },
    quoteRequest: {},
    quoteComparison: {},
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
      supplierPortalToken: prisma.supplierPortalToken,
      supplier: prisma.supplier,
    })),
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
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  supplierPortalToken: {
    updateMany: ReturnType<typeof vi.fn>;
  };
  supplierReview: {
    groupBy: ReturnType<typeof vi.fn>;
  };
  itemFamily: {
    findMany: ReturnType<typeof vi.fn>;
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

  it('permite que comprador tambem delete fornecedores sem propostas', async () => {
    const cookies = await loginAs('comprador');

    prismaMock.supplier.findFirst.mockResolvedValue({
      id: 11,
      name: 'Fornecedor Limpo',
    });
    prismaMock.quoteResponse.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .delete('/api/v1/suppliers/11')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('bloqueia delete de fornecedor para gestor e viewer', async () => {
    for (const role of ['gestor', 'viewer'] as const) {
      const cookies = await loginAs(role);
      const response = await request(app)
        .delete('/api/v1/suppliers/12')
        .set('Cookie', cookies);
      expect(response.status).toBe(403);
    }
  });

  it('create com familyIds conecta as familias e retorna o vinculo', async () => {
    const cookies = await loginAs('admin');

    prismaMock.supplier.create.mockResolvedValue({
      id: 20,
      name: 'Fornecedor Novo',
      acceptedIncoterms: ['FOB'],
      tags: [],
      families: [
        { id: 1, name: 'Silano' },
        { id: 2, name: 'Resina' },
      ],
    });

    const response = await request(app)
      .post('/api/v1/suppliers')
      .set('Cookie', cookies)
      .send({
        name: 'Fornecedor Novo',
        acceptedIncoterms: ['FOB'],
        familyIds: [1, 2],
      });

    expect(response.status).toBe(201);
    expect(response.body.families).toEqual([
      { id: 1, name: 'Silano' },
      { id: 2, name: 'Resina' },
    ]);
    expect(prismaMock.supplier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          families: { connect: [{ id: 1 }, { id: 2 }] },
        }),
        include: expect.objectContaining({
          families: expect.objectContaining({ select: { id: true, name: true } }),
        }),
      }),
    );
  });

  it('update com familyIds substitui (set) as familias vinculadas', async () => {
    const cookies = await loginAs('admin');

    prismaMock.supplier.findFirst.mockResolvedValue({
      id: 21,
      name: 'Fornecedor Existente',
    });
    prismaMock.supplier.update.mockResolvedValue({
      id: 21,
      name: 'Fornecedor Existente',
      acceptedIncoterms: ['FOB'],
      tags: [],
      families: [{ id: 3, name: 'Aditivo' }],
    });

    const response = await request(app)
      .put('/api/v1/suppliers/21')
      .set('Cookie', cookies)
      .send({
        familyIds: [3],
      });

    expect(response.status).toBe(200);
    expect(response.body.families).toEqual([{ id: 3, name: 'Aditivo' }]);
    expect(prismaMock.supplier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 21 },
        data: expect.objectContaining({
          families: { set: [{ id: 3 }] },
        }),
        include: expect.objectContaining({
          families: expect.objectContaining({ select: { id: true, name: true } }),
        }),
      }),
    );
  });

  it('update sem familyIds nao toca no vinculo de familias', async () => {
    const cookies = await loginAs('admin');

    prismaMock.supplier.findFirst.mockResolvedValue({
      id: 22,
      name: 'Fornecedor Sem Mudanca',
    });
    prismaMock.supplier.update.mockResolvedValue({
      id: 22,
      name: 'Fornecedor Sem Mudanca',
      acceptedIncoterms: ['FOB'],
      tags: [],
      families: [{ id: 3, name: 'Aditivo' }],
    });

    const response = await request(app)
      .put('/api/v1/suppliers/22')
      .set('Cookie', cookies)
      .send({
        name: 'Fornecedor Sem Mudanca',
      });

    expect(response.status).toBe(200);
    expect(prismaMock.supplier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ families: expect.anything() }),
      }),
    );
  });

  it('getById retorna families no shape enxuto', async () => {
    const cookies = await loginAs('admin');

    prismaMock.supplier.findFirst.mockResolvedValue({
      id: 23,
      name: 'Fornecedor Consultado',
      families: [{ id: 4, name: 'Monomero' }],
    });
    prismaMock.supplierReview.groupBy.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/suppliers/23')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.families).toEqual([{ id: 4, name: 'Monomero' }]);
    expect(prismaMock.supplier.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          families: expect.objectContaining({ select: { id: true, name: true } }),
        }),
      }),
    );
  });

  it('getAll (sem query de listagem) retorna families em cada fornecedor', async () => {
    const cookies = await loginAs('admin');

    prismaMock.supplier.findMany.mockResolvedValue([
      { id: 24, name: 'Fornecedor A', families: [{ id: 5, name: 'Fotoiniciador' }] },
    ]);
    prismaMock.supplierReview.groupBy.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/suppliers')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body[0].families).toEqual([{ id: 5, name: 'Fotoiniciador' }]);
    expect(prismaMock.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          families: expect.objectContaining({ select: { id: true, name: true } }),
        }),
      }),
    );
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
