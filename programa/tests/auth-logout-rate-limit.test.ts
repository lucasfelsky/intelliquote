import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.AUTH_LOGOUT_RATE_LIMIT_MAX = '3';
});

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
    supplier: {},
    quoteRequest: {},
    quoteResponse: {},
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

describe('Auth logout rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responde 429 no logout acima do limite', async () => {
    for (let i = 0; i < 3; i += 1) {
      const response = await request(app).post('/api/v1/auth/logout');
      expect(response.status).toBe(204);
    }

    const blocked = await request(app).post('/api/v1/auth/logout');
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe('Muitas tentativas. Tente novamente mais tarde.');
  });

  it('nao afeta o login depois de estourar o limite do logout', async () => {
    const passwordHash = await hashPassword('OutraSenha123!');

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      name: 'Administrador IntelliQuote',
      email: 'admin@intelliquote.local',
      passwordHash,
      isActive: true,
      role: {
        name: 'admin',
      },
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@intelliquote.local',
        password: 'SenhaInvalida',
      });

    expect(response.status).toBe(401);
  });
});
