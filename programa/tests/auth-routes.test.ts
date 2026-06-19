import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { hashToken } from '../src/utils/tokens';

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
};

describe('Auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('realiza login, consulta me e faz logout com cookies de auth', async () => {
    const passwordHash = await hashPassword('ChangeMe123!');
    const mockedUser = {
      id: 1,
      name: 'Administrador IntelliQuote',
      email: 'admin@intelliquote.local',
      passwordHash,
      isActive: true,
      role: {
        name: 'admin',
      },
    };

    prismaMock.user.findUnique.mockResolvedValue(mockedUser);
    prismaMock.user.findFirst.mockResolvedValue({
      id: 1,
      name: 'Administrador IntelliQuote',
      email: 'admin@intelliquote.local',
      isActive: true,
      role: {
        name: 'admin',
      },
    });
    prismaMock.session.create.mockResolvedValue({
      id: 'session-1',
    });
    prismaMock.session.updateMany.mockResolvedValue({
      count: 1,
    });

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@intelliquote.local',
        password: 'ChangeMe123!',
      });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user).toMatchObject({
      id: 1,
      email: 'admin@intelliquote.local',
      role: 'admin',
    });
    expect(loginResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('intelliquote_access_token='),
        expect.stringContaining('intelliquote_refresh_token='),
      ]),
    );

    const cookies = loginResponse.headers['set-cookie'];

    const meResponse = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user.email).toBe('admin@intelliquote.local');

    const logoutResponse = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies);

    expect(logoutResponse.status).toBe(204);
    expect(prismaMock.session.updateMany).toHaveBeenCalledTimes(1);
  });

  it('retorna 401 para login com credenciais invalidas', async () => {
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
    expect(response.body.message).toBe('Credenciais invalidas.');
  });

  it('retorna 401 para me sem autenticacao', async () => {
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
  });

  it('renova a sessao com refresh token valido', async () => {
    const passwordHash = await hashPassword('ChangeMe123!');
    const mockedUser = {
      id: 1,
      name: 'Administrador IntelliQuote',
      email: 'admin@intelliquote.local',
      passwordHash,
      isActive: true,
      role: {
        name: 'admin',
      },
    };

    prismaMock.user.findUnique.mockResolvedValue(mockedUser);
    prismaMock.session.create.mockResolvedValue({
      id: 'session-1',
    });

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@intelliquote.local',
        password: 'ChangeMe123!',
      });

    const cookies = loginResponse.headers['set-cookie'];
    const refreshCookie = extractCookieValue(
      cookies,
      'intelliquote_refresh_token',
    );

    prismaMock.session.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 1,
      refreshTokenHash: hashToken(refreshCookie),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        id: 1,
        name: 'Administrador IntelliQuote',
        email: 'admin@intelliquote.local',
        isActive: true,
        role: {
          name: 'admin',
        },
      },
    });
    prismaMock.session.update.mockResolvedValue({
      id: 'session-1',
    });

    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies);

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.user.email).toBe('admin@intelliquote.local');
    expect(prismaMock.session.update).toHaveBeenCalledTimes(1);
  });
});

function extractCookieValue(cookies: string[], name: string): string {
  const targetCookie = cookies.find((cookie) => cookie.startsWith(`${name}=`));

  if (!targetCookie) {
    throw new Error(`Cookie ${name} nao encontrado nos testes.`);
  }

  return targetCookie.split(';')[0].slice(`${name}=`.length);
}
