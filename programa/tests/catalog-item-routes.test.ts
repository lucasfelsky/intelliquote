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
    catalogItem: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    quoteRequestItem: {
      count: vi.fn(),
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
  catalogItem: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  quoteRequestItem: {
    count: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
};

describe('CatalogItem routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /catalog-items', () => {
    it('lista apenas itens ativos por padrao', async () => {
      const cookies = await loginAs('comprador');
      prismaMock.catalogItem.count.mockResolvedValue(2);
      prismaMock.catalogItem.findMany.mockResolvedValue([
        {
          id: 1,
          commercialName: 'Acetona PA',
          marketName: 'ACETONA PA 1L',
          ncm: '29141100',
          dbcorpCode: 'DB-001',
          isDangerousGood: true,
          notes: null,
          isActive: true,
        },
      ]);

      const response = await request(app)
        .get('/api/v1/catalog-items')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(prismaMock.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination.totalItems).toBe(2);
    });

    it('admin pode incluir inativos', async () => {
      const cookies = await loginAs('admin');
      prismaMock.catalogItem.count.mockResolvedValue(0);
      prismaMock.catalogItem.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/catalog-items?includeInactive=true&onlyDg=true&search=ACET')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(prismaMock.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDangerousGood: true,
            OR: expect.arrayContaining([
              { commercialName: { contains: 'ACET', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });

    it('bloqueia viewer de criar item', async () => {
      const cookies = await loginAs('viewer');

      const response = await request(app)
        .post('/api/v1/catalog-items')
        .set('Cookie', cookies)
        .send({
          commercialName: 'Teste',
          marketName: 'TESTE UNIT',
        });

      expect(response.status).toBe(403);
      expect(prismaMock.catalogItem.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /catalog-items', () => {
    it('cria item com NCM valido e dedupe por marketName', async () => {
      const cookies = await loginAs('comprador');
      prismaMock.catalogItem.findUnique.mockResolvedValue(null);
      prismaMock.catalogItem.create.mockResolvedValue({
        id: 10,
        commercialName: 'Solvente X',
        marketName: 'SOLVENTE X 5L',
        ncm: '38140000',
        dbcorpCode: 'DB-100',
        isDangerousGood: false,
        notes: null,
        isActive: true,
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

      const response = await request(app)
        .post('/api/v1/catalog-items')
        .set('Cookie', cookies)
        .send({
          commercialName: '  Solvente X  ',
          marketName: 'SOLVENTE X 5L',
          ncm: '38140000',
          dbcorpCode: 'db-100',
          isDangerousGood: false,
        });

      expect(response.status).toBe(201);
      expect(prismaMock.catalogItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            commercialName: 'Solvente X',
            dbcorpCode: 'DB-100',
            ncm: '38140000',
          }),
        }),
      );
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'catalog_item',
            action: 'create',
          }),
        }),
      );
    });

    it('rejeita NCM com tamanho invalido', async () => {
      const cookies = await loginAs('comprador');

      const response = await request(app)
        .post('/api/v1/catalog-items')
        .set('Cookie', cookies)
        .send({
          commercialName: 'Solvente X',
          marketName: 'SOLVENTE X 5L',
          ncm: '1234',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('NCM invalido');
      expect(prismaMock.catalogItem.create).not.toHaveBeenCalled();
    });

    it('rejeita duplicata por marketName', async () => {
      const cookies = await loginAs('admin');
      prismaMock.catalogItem.findUnique.mockResolvedValue({
        id: 99,
        marketName: 'ACETONA PA 1L',
      });

      const response = await request(app)
        .post('/api/v1/catalog-items')
        .set('Cookie', cookies)
        .send({
          commercialName: 'Acetona PA',
          marketName: 'ACETONA PA 1L',
        });

      expect(response.status).toBe(409);
      expect(prismaMock.catalogItem.create).not.toHaveBeenCalled();
    });

    it('rejeita quando faltam campos obrigatorios', async () => {
      const cookies = await loginAs('comprador');

      const response = await request(app)
        .post('/api/v1/catalog-items')
        .set('Cookie', cookies)
        .send({ marketName: 'SEM COMERCIAL' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('nome comercial');
    });
  });

  describe('PUT /catalog-items/:id', () => {
    it('atualiza parcialmente e detecta conflito de marketName', async () => {
      const cookies = await loginAs('comprador');
      prismaMock.catalogItem.findUnique
        .mockResolvedValueOnce({
          id: 7,
          commercialName: 'Solvente',
          marketName: 'SOLVENTE A',
          ncm: null,
          dbcorpCode: null,
          isDangerousGood: false,
          notes: null,
          isActive: true,
        })
        .mockResolvedValueOnce({
          id: 8,
          marketName: 'SOLVENTE B',
        });
      prismaMock.catalogItem.update.mockResolvedValue({
        id: 7,
        commercialName: 'Solvente',
        marketName: 'SOLVENTE B',
        ncm: null,
        dbcorpCode: null,
        isDangerousGood: true,
        notes: null,
        isActive: true,
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

      const response = await request(app)
        .put('/api/v1/catalog-items/7')
        .set('Cookie', cookies)
        .send({
          marketName: 'SOLVENTE B',
          isDangerousGood: true,
        });

      expect(response.status).toBe(409);
      expect(prismaMock.catalogItem.update).not.toHaveBeenCalled();
    });

    it('limpa NCM quando enviado como string vazia', async () => {
      const cookies = await loginAs('admin');
      prismaMock.catalogItem.findUnique.mockResolvedValueOnce({
        id: 7,
        commercialName: 'Solvente',
        marketName: 'SOLVENTE A',
        ncm: '38140000',
        dbcorpCode: null,
        isDangerousGood: false,
        notes: null,
        isActive: true,
      });
      prismaMock.catalogItem.update.mockResolvedValue({});
      prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

      const response = await request(app)
        .put('/api/v1/catalog-items/7')
        .set('Cookie', cookies)
        .send({ ncm: '' });

      expect(response.status).toBe(200);
      expect(prismaMock.catalogItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ncm: null }),
        }),
      );
    });
  });

  describe('DELETE /catalog-items/:id', () => {
    it('faz soft-delete quando nao ha cotacoes vinculadas', async () => {
      const cookies = await loginAs('admin');
      prismaMock.catalogItem.findUnique.mockResolvedValue({
        id: 5,
        commercialName: 'X',
        marketName: 'X',
        ncm: null,
        dbcorpCode: null,
        isDangerousGood: false,
        notes: null,
        isActive: true,
      });
      prismaMock.quoteRequestItem.count.mockResolvedValue(0);
      prismaMock.catalogItem.update.mockResolvedValue({});
      prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

      const response = await request(app)
        .delete('/api/v1/catalog-items/5')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(prismaMock.catalogItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isActive: false },
        }),
      );
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'soft_delete' }),
        }),
      );
    });

    it('bloqueia soft-delete quando ha cotacoes vinculadas', async () => {
      const cookies = await loginAs('comprador');
      prismaMock.catalogItem.findUnique.mockResolvedValue({
        id: 5,
        commercialName: 'X',
        marketName: 'X',
        ncm: null,
        dbcorpCode: null,
        isDangerousGood: false,
        notes: null,
        isActive: true,
      });
      prismaMock.quoteRequestItem.count.mockResolvedValue(3);

      const response = await request(app)
        .delete('/api/v1/catalog-items/5')
        .set('Cookie', cookies);

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('vinculado');
      expect(prismaMock.catalogItem.update).not.toHaveBeenCalled();
    });
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
