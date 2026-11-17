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
    forecastSnapshot: { findFirst: vi.fn(), update: vi.fn() },
    forecastProduct: { updateMany: vi.fn() },
    $executeRaw: vi.fn(),
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
  forecastSnapshot: { findFirst: Mock; update: Mock };
  forecastProduct: { updateMany: Mock };
  $executeRaw: Mock;
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const PATH = '/api/v1/forecast/snapshots/7/observacoes/42';

// Dados SINTETICOS (repo publico).
const produtos = [
  { linha: 3, n: 1, item: 'PRODUTO A', productId: 41, obs: '' },
  { linha: 4, n: 2, item: 'PRODUTO B', productId: 42, obs: 'texto antigo' },
];

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.forecastSnapshot.update.mockResolvedValue({});
  prismaMock.forecastProduct.updateMany.mockResolvedValue({ count: 1 });
  // 1a chamada: a quinzena editada; 2a: a quinzena mais recente (a mesma por padrao).
  prismaMock.forecastSnapshot.findFirst
    .mockResolvedValueOnce({ id: 7, label: '10-2', products: produtos })
    .mockResolvedValueOnce({ id: 7 });
});

describe('PUT /forecast/snapshots/:id/observacoes/:productId - papeis', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).put(PATH).send({ observacao: 'x' })).status).toBe(401);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each(['gestor', 'viewer', 'comercial'] as Role[])('%s -> 403 sem gravar', async (role) => {
    const cookies = await loginAs(role);
    const res = await request(app).put(PATH).set('Cookie', cookies).send({ observacao: 'x' });
    expect(res.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.forecastSnapshot.update).not.toHaveBeenCalled();
  });
});

describe('PUT /forecast/snapshots/:id/observacoes/:productId - validacao', () => {
  it.each([
    ['campo extra', { observacao: 'x', outro: 1 }],
    ['sem observacao', {}],
    ['nao e texto', { observacao: 5 }],
    ['acima de 1000 caracteres', { observacao: 'a'.repeat(1001) }],
  ])('%s -> 400 sem abrir transacao', async (_nome, corpo) => {
    const cookies = await loginAs('admin');
    const res = await request(app).put(PATH).set('Cookie', cookies).send(corpo);
    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('produto invalido -> 400', async () => {
    const cookies = await loginAs('admin');
    const res = await request(app)
      .put('/api/v1/forecast/snapshots/7/observacoes/abc')
      .set('Cookie', cookies)
      .send({ observacao: 'x' });
    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('PUT /forecast/snapshots/:id/observacoes/:productId - gravacao', () => {
  it.each(['admin', 'comprador'] as Role[])('%s grava na quinzena e, sendo a mais recente, no cadastro', async (role) => {
    const cookies = await loginAs(role);
    const res = await request(app).put(PATH).set('Cookie', cookies).send({ observacao: '  Aguardar o contrato  ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { productId: 42, observacao: 'Aguardar o contrato', cadastroAtualizado: true } });

    const { data } = prismaMock.forecastSnapshot.update.mock.calls[0]![0] as { data: { products: typeof produtos } };
    expect(data.products.find((p) => p.productId === 42)?.obs).toBe('Aguardar o contrato');
    // O outro item da quinzena segue como estava.
    expect(data.products.find((p) => p.productId === 41)).toEqual(produtos[0]);
    expect(prismaMock.forecastProduct.updateMany).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { notes: 'Aguardar o contrato' },
    });
  });

  it('texto vazio apaga: obs vazia na quinzena e notes nulo no cadastro', async () => {
    const cookies = await loginAs('admin');
    const res = await request(app).put(PATH).set('Cookie', cookies).send({ observacao: '   ' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ productId: 42, observacao: '', cadastroAtualizado: true });
    expect(prismaMock.forecastProduct.updateMany).toHaveBeenCalledWith({ where: { id: 42 }, data: { notes: null } });
  });

  it('quinzena antiga: grava so nela e NAO mexe no cadastro (a atual manda)', async () => {
    prismaMock.forecastSnapshot.findFirst.mockReset();
    prismaMock.forecastSnapshot.findFirst
      .mockResolvedValueOnce({ id: 7, label: '10-2', products: produtos })
      .mockResolvedValueOnce({ id: 9 });
    const cookies = await loginAs('comprador');
    const res = await request(app).put(PATH).set('Cookie', cookies).send({ observacao: 'so nesta' });

    expect(res.status).toBe(200);
    expect(res.body.data.cadastroAtualizado).toBe(false);
    expect(prismaMock.forecastSnapshot.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.forecastProduct.updateMany).not.toHaveBeenCalled();
  });

  it('audita sem o texto da observacao', async () => {
    const cookies = await loginAs('admin');
    await request(app).put(PATH).set('Cookie', cookies).send({ observacao: 'segredo comercial' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    const registro = JSON.stringify(prismaMock.auditLog.create.mock.calls[0]![0]);
    expect(registro).not.toContain('segredo comercial');
    expect(registro).toContain('caracteresDepois');
  });

  it('quinzena inexistente -> 404 sem gravar', async () => {
    prismaMock.forecastSnapshot.findFirst.mockReset();
    prismaMock.forecastSnapshot.findFirst.mockResolvedValueOnce(null);
    const cookies = await loginAs('admin');
    const res = await request(app).put(PATH).set('Cookie', cookies).send({ observacao: 'x' });

    expect(res.status).toBe(404);
    expect(prismaMock.forecastSnapshot.update).not.toHaveBeenCalled();
  });

  it('item fora da quinzena -> 404 sem gravar', async () => {
    const cookies = await loginAs('admin');
    const res = await request(app)
      .put('/api/v1/forecast/snapshots/7/observacoes/999')
      .set('Cookie', cookies)
      .send({ observacao: 'x' });

    expect(res.status).toBe(404);
    expect(prismaMock.forecastSnapshot.update).not.toHaveBeenCalled();
    expect(prismaMock.forecastProduct.updateMany).not.toHaveBeenCalled();
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
