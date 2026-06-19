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
    passwordResetToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
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
  passwordResetToken: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
};

describe('Password recovery routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gera token para e-mail cadastrado', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      isActive: true,
    });
    prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.passwordResetToken.create.mockResolvedValue({ id: 1 });

    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'user@intelliquote.local' });

    expect(response.status).toBe(200);
    expect(prismaMock.passwordResetToken.create).toHaveBeenCalled();
  });

  it('retorna mensagem generica para e-mail inexistente', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@intelliquote.local' });

    expect(response.status).toBe(200);
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('bloqueia reset com token invalido', async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'a'.repeat(40), password: 'NewPass123!' });

    expect(response.status).toBe(400);
  });

  it('admin pode listar tokens ativos', async () => {
    const cookies = await loginAs('admin');
    prismaMock.passwordResetToken.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/auth/password-recovery/tokens')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(prismaMock.passwordResetToken.findMany).toHaveBeenCalled();
  });

  it('bloqueia listagem de tokens para viewer', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app)
      .get('/api/v1/auth/password-recovery/tokens')
      .set('Cookie', cookies);

    expect(response.status).toBe(403);
    expect(prismaMock.passwordResetToken.findMany).not.toHaveBeenCalled();
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
