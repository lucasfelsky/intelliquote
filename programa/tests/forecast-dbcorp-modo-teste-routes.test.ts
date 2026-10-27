import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

// O arquivo faz varios logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    forecastSource: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    forecastProduct: { findMany: vi.fn() },
    forecastSnapshot: { findMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock; findUnique: Mock; update: Mock; updateMany: Mock };
  auditLog: { create: Mock };
  forecastSource: { findMany: Mock; findUnique: Mock; update: Mock };
  forecastProduct: { findMany: Mock };
  forecastSnapshot: { findMany: Mock; findFirst: Mock };
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

// Quinzena DBCorp: os arquivos sao lixo de proposito (so interessa o que roda antes da leitura).
const fakeFile = (name: string) => ({
  fileName: name,
  contentBase64: Buffer.from('conteudo qualquer').toString('base64'),
});
const validDbcorpBody = {
  label: '10-2',
  baseDate: '2026-10-15',
  files: {
    saldo: fakeFile('saldo.xlsx'),
    vendasMes: fakeFile('vendas-mes.xlsx'),
    vendasAtual: fakeFile('vendas-atual.xlsx'),
    vendasAnual: fakeFile('vendas-anual.xlsx'),
    programacao: fakeFile('programacao.xlsx'),
    fup: fakeFile('fup.xlsx'),
  },
};

const CONFIRM = '/api/v1/forecast/import/dbcorp/confirm';
const PREVIEW = '/api/v1/forecast/import/dbcorp/preview';

describe('Forecast DBCorp modo teste - rotas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.forecastSource.findMany.mockResolvedValue([]);
    prismaMock.forecastProduct.findMany.mockResolvedValue([]);
    prismaMock.forecastSnapshot.findMany.mockResolvedValue([]);
  });

  it.each(['comercial', 'viewer', 'gestor'] as const)(
    '%s: confirm com modoTeste -> 403 (sem tocar no banco)',
    async (role) => {
      const cookies = await loginAs(role);
      const response = await request(app)
        .post(CONFIRM)
        .set('Cookie', cookies)
        .send({ ...validDbcorpBody, modoTeste: true });
      expect(response.status).toBe(403);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['admin', 'comprador'] as const)(
    '%s: confirm com modoTeste passa do RBAC e do Zod (400 so na leitura do arquivo)',
    async (role) => {
      const cookies = await loginAs(role);
      const response = await request(app)
        .post(CONFIRM)
        .set('Cookie', cookies)
        .send({ ...validDbcorpBody, modoTeste: true });
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/invalido \(envie \.xlsx\)/);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it('confirm com modoTeste nao booleano -> 400 de validacao, sem abrir transacao', async () => {
    const cookies = await loginAs('admin');
    for (const modoTeste of ['true', 1]) {
      const response = await request(app)
        .post(CONFIRM)
        .set('Cookie', cookies)
        .send({ ...validDbcorpBody, modoTeste });
      expect(response.status, String(modoTeste)).toBe(400);
      expect(response.body.message, String(modoTeste)).not.toMatch(/invalido \(envie \.xlsx\)/);
    }
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('preview com modoTeste: a chave e ignorada (mesmo 400 de leitura do lixo, nao erro de Zod)', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .post(PREVIEW)
      .set('Cookie', cookies)
      .send({ ...validDbcorpBody, modoTeste: true });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/invalido \(envie \.xlsx\)/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

async function loginAs(role: Role) {
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
    .send({ email: `${role}@intelliquote.local`, password: 'ChangeMe123!' });

  return loginResponse.headers['set-cookie'];
}
