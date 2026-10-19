// RBAC do papel `comercial` (PR1 "Solicitacoes do comercial"):
//  - comercial so alcanca as rotas do proprio fluxo; todo o resto do IntelliQuote devolve 403;
//  - rotas do COMEX sobre solicitacoes e as rotas do comercial sao mutuamente exclusivas;
//  - as duas brechas (item-families, users-directory) e o CC de envio ficam fechados.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    itemFamily: {
      findMany: vi.fn(),
    },
    commercialRequest: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    quoteRequest: {},
    quoteResponse: {},
  };
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  excludeComercialRecipients,
  normalizeDispatchCcWithUsers,
} from '../src/services/CompanyProfileService';

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  session: { create: ReturnType<typeof vi.fn> };
  itemFamily: { findMany: ReturnType<typeof vi.fn> };
  commercialRequest: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

// Cookies por papel: o login tem rate limit; o papel efetivo vem do mock de user a cada request.
const cookieCache = new Map<Role, string[]>();

async function loginAs(role: Role) {
  const passwordHash = await hashPassword('ChangeMe123!');
  const base = {
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: { name: role },
  };
  prismaMock.user.findUnique.mockResolvedValue({ ...base, passwordHash });
  prismaMock.user.findFirst.mockResolvedValue(base);
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });

  const cached = cookieCache.get(role);
  if (cached) return cached;

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: base.email, password: 'ChangeMe123!' });

  const cookies = loginResponse.headers['set-cookie'] as unknown as string[];
  cookieCache.set(role, cookies);
  return cookies;
}

let comercialCookies: string[];

beforeEach(async () => {
  vi.clearAllMocks();
  prismaMock.itemFamily.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.commercialRequest.findMany.mockResolvedValue([]);
  prismaMock.commercialRequest.count.mockResolvedValue(0);
  comercialCookies = await loginAs('comercial');
});

const FORBIDDEN_FOR_COMERCIAL = [
  '/api/v1/quote-requests',
  '/api/v1/quote-requests/1',
  '/api/v1/quote-request-items',
  '/api/v1/quote-responses',
  '/api/v1/suppliers',
  '/api/v1/supplier-contacts',
  '/api/v1/catalog-items',
  '/api/v1/item-families',
  '/api/v1/forwarders',
  '/api/v1/credit-partners',
  '/api/v1/reports/summary',
  '/api/v1/help/articles',
  '/api/v1/audit',
  '/api/v1/attachments',
  '/api/v1/users',
  '/api/v1/users-directory',
  '/api/v1/company-profile',
  '/api/v1/email-templates',
  // Rotas do COMEX sobre solicitacoes (leitura) tambem sao vedadas ao comercial.
  '/api/v1/commercial-requests',
  '/api/v1/commercial-requests/1',
  '/api/v1/commercial-requests/pending-count',
  '/api/v1/commercial-requests/requesters',
];

describe('comercial: rotas fora do proprio fluxo', () => {
  it.each(FORBIDDEN_FOR_COMERCIAL)('GET %s -> 403', async (url) => {
    const response = await request(app).get(url).set('Cookie', comercialCookies);

    expect(response.status).toBe(403);
  });
});

describe('papeis COMEX nao usam as rotas do comercial', () => {
  it.each(['comprador', 'viewer'] as const)('%s -> 403 no POST /commercial-requests', async (role) => {
    const cookies = await loginAs(role);

    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ items: [{ catalogItemId: 1, quantity: 1, unit: 'KG' }] });

    expect(response.status).toBe(403);
  });

  it.each(['comprador', 'viewer'] as const)('%s -> 403 no GET /commercial-requests/mine', async (role) => {
    const cookies = await loginAs(role);

    const response = await request(app).get('/api/v1/commercial-requests/mine').set('Cookie', cookies);

    expect(response.status).toBe(403);
  });

  it.each(['comprador', 'viewer'] as const)(
    '%s -> 403 no GET /commercial-requests/catalog-items',
    async (role) => {
      const cookies = await loginAs(role);

      const response = await request(app)
        .get('/api/v1/commercial-requests/catalog-items?search=ab')
        .set('Cookie', cookies);

      expect(response.status).toBe(403);
    },
  );
});

describe('brechas fechadas para o papel novo', () => {
  it('viewer continua lendo GET /item-families', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app).get('/api/v1/item-families').set('Cookie', cookies);

    expect(response.status).toBe(200);
  });

  it('viewer le GET /commercial-requests (somente leitura)', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app).get('/api/v1/commercial-requests').set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('users-directory exclui usuarios comercial na consulta', async () => {
    const cookies = await loginAs('comprador');

    const response = await request(app).get('/api/v1/users-directory').set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
    const args = prismaMock.user.findMany.mock.calls[0][0];
    expect(args.where.role).toEqual({ name: { not: 'comercial' } });
    expect(args.where.isActive).toBe(true);
  });

  it('excludeComercialRecipients remove e-mail de comercial (case-insensitive) e preserva o resto', async () => {
    const findMany = vi.fn().mockResolvedValue([{ email: 'Vendas@SQQuimica.com' }]);
    const fakeClient = { user: { findMany } };

    const kept = await excludeComercialRecipients(
      [
        { email: 'vendas@sqquimica.com', name: 'A' },
        { email: 'COMEX@sqquimica.com', name: 'B' },
      ],
      fakeClient as never,
    );

    expect(findMany.mock.calls[0][0].where).toEqual({ role: { name: 'comercial' } });
    expect(kept).toEqual([{ email: 'COMEX@sqquimica.com', name: 'B' }]);
  });

  it('excludeComercialRecipients com lista vazia nao consulta o banco', async () => {
    const findMany = vi.fn();

    await expect(
      excludeComercialRecipients([], { user: { findMany } } as never),
    ).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('normalizeDispatchCcWithUsers (CC de envio) nao puxa e-mail de comercial', async () => {
    const findMany = vi.fn().mockResolvedValue([{ email: 'Comprador@SQQuimica.com' }]);
    const fakeClient = { user: { findMany } };

    const emails = await normalizeDispatchCcWithUsers({
      extraEmails: ['financeiro@sqquimica.com'],
      client: fakeClient as never,
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      role: { name: { not: 'comercial' } },
    });
    expect(emails).toEqual(['comprador@sqquimica.com', 'financeiro@sqquimica.com']);
  });
});
