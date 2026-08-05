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
    auditLog: {
      create: vi.fn(),
    },
    itemFamily: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
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
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
  itemFamily: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

describe('ItemFamily routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PUT /item-families/:id', () => {
    it('inativa familia como admin', async () => {
      const cookies = await loginAs('admin');
      prismaMock.itemFamily.findUnique.mockResolvedValue({
        id: 1,
        name: 'Embalagens',
        isActive: true,
      });
      prismaMock.itemFamily.update.mockResolvedValue({
        id: 1,
        name: 'Embalagens',
        isActive: false,
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

      const response = await request(app)
        .put('/api/v1/item-families/1')
        .set('Cookie', cookies)
        .send({ isActive: false });

      expect(response.status).toBe(200);
      expect(prismaMock.itemFamily.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 }, data: { isActive: false } }),
      );
    });

    it('reativa familia como comprador', async () => {
      const cookies = await loginAs('comprador');
      prismaMock.itemFamily.findUnique.mockResolvedValue({
        id: 1,
        name: 'Embalagens',
        isActive: false,
      });
      prismaMock.itemFamily.update.mockResolvedValue({
        id: 1,
        name: 'Embalagens',
        isActive: true,
      });
      prismaMock.auditLog.create.mockResolvedValue({ id: 1 });

      const response = await request(app)
        .put('/api/v1/item-families/1')
        .set('Cookie', cookies)
        .send({ isActive: true });

      expect(response.status).toBe(200);
      expect(prismaMock.itemFamily.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 }, data: { isActive: true } }),
      );
    });

    it('bloqueia viewer', async () => {
      const cookies = await loginAs('viewer');

      const response = await request(app)
        .put('/api/v1/item-families/1')
        .set('Cookie', cookies)
        .send({ isActive: false });

      expect(response.status).toBe(403);
      expect(prismaMock.itemFamily.update).not.toHaveBeenCalled();
    });

    it('retorna 404 quando familia nao existe', async () => {
      const cookies = await loginAs('admin');
      prismaMock.itemFamily.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/v1/item-families/999')
        .set('Cookie', cookies)
        .send({ isActive: false });

      expect(response.status).toBe(404);
      expect(prismaMock.itemFamily.update).not.toHaveBeenCalled();
    });

    it('retorna 400 quando isActive nao e booleano', async () => {
      const cookies = await loginAs('admin');

      const response = await request(app)
        .put('/api/v1/item-families/1')
        .set('Cookie', cookies)
        .send({ isActive: 'sim' });

      expect(response.status).toBe(400);
      expect(prismaMock.itemFamily.update).not.toHaveBeenCalled();
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
