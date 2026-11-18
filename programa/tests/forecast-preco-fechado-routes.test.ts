import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/utils/http';
import { hashPassword } from '../src/utils/password';

vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return { prisma };
});

vi.mock('../src/services/ForecastPrecoFechadoService', () => ({
  ForecastPrecoFechadoService: { listar: vi.fn(), gravar: vi.fn() },
}));

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastPrecoFechadoService } from '../src/services/ForecastPrecoFechadoService';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as { user: { findUnique: Mock; findFirst: Mock }; session: { create: Mock } };
const listar = ForecastPrecoFechadoService.listar as unknown as Mock;
const gravar = ForecastPrecoFechadoService.gravar as unknown as Mock;

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const LISTA = '/api/v1/forecast/snapshots/7/precos-fechados';
const PRODUTO = '/api/v1/forecast/products/42/preco-fechado';

// Dados SINTETICOS (repo publico).
const corpo = (over: Record<string, unknown> = {}) => ({ valorPorKg: 1.8425, moeda: 'USD', incoterm: 'CFR', validoAte: '2026-12-31', ...over });
const estado = { productId: 42, estado: 'ok', valorPorKg: 1.8425, moeda: 'USD', incoterm: 'CFR', validoAte: '2026-12-31' };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });
  listar.mockResolvedValue({ hoje: '2026-11-17', itens: [estado] });
  gravar.mockResolvedValue(estado);
});

describe('GET /forecast/snapshots/:id/precos-fechados (o unico GET que devolve o valor)', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).get(LISTA)).status).toBe(401);
    expect(listar).not.toHaveBeenCalled();
  });

  it.each(['gestor', 'viewer', 'comercial'] as Role[])('%s -> 403 sem consultar', async (role) => {
    const cookies = await loginAs(role);
    expect((await request(app).get(LISTA).set('Cookie', cookies)).status).toBe(403);
    expect(listar).not.toHaveBeenCalled();
  });

  it.each(['admin', 'comprador'] as Role[])('%s le a lista', async (role) => {
    const cookies = await loginAs(role);
    const res = await request(app).get(LISTA).set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.data.itens[0]).toMatchObject({ productId: 42, estado: 'ok', valorPorKg: 1.8425 });
    expect(listar).toHaveBeenCalledWith(7);
  });

  it('quinzena invalida na URL -> 400; quinzena inexistente -> 404', async () => {
    const cookies = await loginAs('comprador');
    expect((await request(app).get('/api/v1/forecast/snapshots/abc/precos-fechados').set('Cookie', cookies)).status).toBe(400);
    listar.mockRejectedValue(new HttpError(404, 'Quinzena não encontrada.'));
    expect((await request(app).get(LISTA).set('Cookie', cookies)).status).toBe(404);
  });
});

describe('PUT /forecast/products/:id/preco-fechado', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).put(PRODUTO).send(corpo())).status).toBe(401);
    expect(gravar).not.toHaveBeenCalled();
  });

  it.each(['gestor', 'viewer', 'comercial'] as Role[])('%s -> 403 sem gravar', async (role) => {
    const cookies = await loginAs(role);
    expect((await request(app).put(PRODUTO).set('Cookie', cookies).send(corpo())).status).toBe(403);
    expect(gravar).not.toHaveBeenCalled();
  });

  it.each(['admin', 'comprador'] as Role[])('%s grava e recebe o estado novo', async (role) => {
    const cookies = await loginAs(role);
    const res = await request(app).put(PRODUTO).set('Cookie', cookies).send(corpo());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ productId: 42, estado: 'ok' });
    expect(gravar).toHaveBeenCalledTimes(1);
    const [productId, input, userId] = gravar.mock.calls[0]!;
    expect(productId).toBe(42);
    expect(input).toMatchObject({ valorPorKg: 1.8425, moeda: 'USD', incoterm: 'CFR', validoAte: '2026-12-31' });
    expect(userId).toBe(1);
  });

  it('{ limpar: true } remove o preco', async () => {
    const cookies = await loginAs('comprador');
    expect((await request(app).put(PRODUTO).set('Cookie', cookies).send({ limpar: true })).status).toBe(200);
    expect(gravar.mock.calls[0]![1]).toEqual({ limpar: true });
  });

  it.each([
    ['sem valor', { valorPorKg: undefined }],
    ['valor zero', { valorPorKg: 0 }],
    ['valor com 5 casas', { valorPorKg: 1.23456 }],
    ['moeda invalida', { moeda: 'JPY' }],
    ['sem incoterm', { incoterm: undefined }],
    ['data invalida', { validoAte: '2026-02-30' }],
    ['chave desconhecida (fixedPrice)', { fixedPrice: 3 }],
    ['limpar com termos', { limpar: true }],
  ])('%s -> 400 sem gravar', async (_nome, over) => {
    const cookies = await loginAs('comprador');
    const res = await request(app).put(PRODUTO).set('Cookie', cookies).send(corpo(over));
    expect(res.status).toBe(400);
    expect(typeof res.body.message).toBe('string');
    expect(gravar).not.toHaveBeenCalled();
  });

  it('id de produto invalido -> 400', async () => {
    const cookies = await loginAs('comprador');
    expect((await request(app).put('/api/v1/forecast/products/abc/preco-fechado').set('Cookie', cookies).send(corpo())).status).toBe(400);
    expect(gravar).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'Produto não encontrado.'],
    [409, 'O item não está marcado como preço fechado na planilha (coluna AV).'],
  ])('erro %s do servico vira o mesmo status e a mensagem', async (status, message) => {
    gravar.mockRejectedValue(new HttpError(status, message));
    const cookies = await loginAs('comprador');
    const res = await request(app).put(PRODUTO).set('Cookie', cookies).send(corpo());
    expect(res.status).toBe(status);
    expect(res.body.message).toBe(message);
  });
});

async function loginAs(role: Role) {
  const passwordHash = await hashPassword('ChangeMe123!');
  const usuario = { id: 1, name: `${role} user`, email: `${role}@intelliquote.local`, isActive: true, role: { name: role } };
  prismaMock.user.findUnique.mockResolvedValue({ ...usuario, passwordHash });
  prismaMock.user.findFirst.mockResolvedValue(usuario);
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });
  const login = await request(app).post('/api/v1/auth/login').send({ email: usuario.email, password: 'ChangeMe123!' });
  return login.headers['set-cookie'];
}
