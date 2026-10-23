import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

// O arquivo faz dezenas de logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    forecastEquivalenceGroup: { findMany: vi.fn() },
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
  forecastEquivalenceGroup: { findMany: Mock };
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const BASE = '/api/v1/forecast/equivalence-groups';

// Cliente transacional distinto do `prisma`: prova que a gravacao e o AuditLog usam o `tx`.
const tx = {
  forecastProduct: { findMany: vi.fn(), updateMany: vi.fn() },
  forecastEquivalenceGroup: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  auditLog: { create: vi.fn() },
};

const membro = (id: number, nome: string, over: Record<string, unknown> = {}) => ({
  id,
  name: nome,
  isActive: true,
  purchaseOnDemand: false,
  source: { name: `FONTE 00${id}` },
  ...over,
});

// Grupo do banco (com o include dos membros), tudo sintetico.
const grupoDoBanco = (over: Record<string, unknown> = {}) => ({
  id: 7,
  name: 'GRUPO SINTETICO',
  normalizedName: 'GRUPO SINTETICO',
  notes: 'OBS SINTETICA',
  principalProductId: 1,
  createdById: 1,
  createdAt: new Date('2099-01-01T12:00:00.000Z'),
  updatedAt: new Date('2099-01-01T12:00:00.000Z'),
  members: [membro(1, 'PRODUTO 001'), membro(2, 'PRODUTO 002')],
  ...over,
});

// Produto no cadastro (resultado da conferencia `findMany`), livre ou em outro grupo.
const produtoCadastrado = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `PRODUTO 00${id}`,
  isActive: true,
  equivalenceGroupId: null,
  equivalenceGroup: null,
  ...over,
});

const corpo = (over: Record<string, unknown> = {}) => ({
  nome: 'GRUPO SINTETICO',
  produtoIds: [1, 2],
  principalProdutoId: 1,
  observacao: 'OBS SINTETICA',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(tx));
  tx.forecastProduct.findMany.mockResolvedValue([produtoCadastrado(1), produtoCadastrado(2)]);
  tx.forecastProduct.updateMany.mockImplementation(async (args: { where: { id: { in: number[] } } }) => ({
    count: args.where.id.in.length,
  }));
  tx.forecastEquivalenceGroup.create.mockResolvedValue({ id: 7 });
  tx.forecastEquivalenceGroup.findUnique.mockResolvedValue(grupoDoBanco());
  tx.forecastEquivalenceGroup.findUniqueOrThrow.mockResolvedValue(grupoDoBanco());
  tx.forecastEquivalenceGroup.update.mockResolvedValue({});
  tx.forecastEquivalenceGroup.delete.mockResolvedValue({});
  tx.auditLog.create.mockResolvedValue({});
  prismaMock.forecastEquivalenceGroup.findMany.mockResolvedValue([grupoDoBanco()]);
});

describe('GET /forecast/equivalence-groups', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it.each<Role>(['admin', 'comprador', 'gestor', 'viewer'])('%s le a lista (COMEX_ROLES)', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).get(BASE).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      {
        id: 7,
        nome: 'GRUPO SINTETICO',
        observacao: 'OBS SINTETICA',
        principalProdutoId: 1,
        membros: [
          { id: 1, nome: 'PRODUTO 001', fonte: 'FONTE 001', ativo: true, sobDemanda: false },
          { id: 2, nome: 'PRODUTO 002', fonte: 'FONTE 002', ativo: true, sobDemanda: false },
        ],
      },
    ]);
  });

  it('comercial -> 403 e nada e consultado', async () => {
    const cookies = await loginAs('comercial');
    const response = await request(app).get(BASE).set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(prismaMock.forecastEquivalenceGroup.findMany).not.toHaveBeenCalled();
  });

  it('ordena por nome e traz so os campos do contrato (sem normalizedName nem createdById)', async () => {
    const cookies = await loginAs('viewer');
    const response = await request(app).get(BASE).set('Cookie', cookies);
    expect(prismaMock.forecastEquivalenceGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    );
    expect(JSON.stringify(response.body)).not.toMatch(/normalizedName|createdById/);
  });
});

describe('POST /forecast/equivalence-groups - papeis, gravacao e auditoria', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).post(BASE).send(corpo())).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 e nada e gravado', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.forecastEquivalenceGroup.create).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s cria: 201, membros gravados no tx e AuditLog so com ids', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app)
      .post(BASE)
      .set('Cookie', cookies)
      .send(corpo({ nome: '  GRUPO SINTETICO  ', observacao: '  OBS SINTETICA  ' }));
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ id: 7, nome: 'GRUPO SINTETICO', principalProdutoId: 1 });

    expect(tx.forecastEquivalenceGroup.create).toHaveBeenCalledWith({
      data: {
        name: 'GRUPO SINTETICO',
        normalizedName: 'GRUPO SINTETICO',
        notes: 'OBS SINTETICA',
        principalProductId: 1,
        createdById: 1,
      },
    });
    expect(tx.forecastProduct.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] }, equivalenceGroupId: null, isActive: true },
      data: { equivalenceGroupId: 7 },
    });

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log).toMatchObject({ entityType: 'forecast_equivalence_group', entityId: '7', action: 'create' });
    expect(log.metadata).toEqual({ produtoIds: [1, 2], principalProdutoId: 1 });
    expect(JSON.stringify(log)).not.toMatch(/GRUPO|PRODUTO|OBS/);
  });

  it('principal e observacao sao opcionais', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .post(BASE)
      .set('Cookie', cookies)
      .send({ nome: 'GRUPO SINTETICO', produtoIds: [1, 2] });
    expect(response.status).toBe(201);
    const { data } = tx.forecastEquivalenceGroup.create.mock.calls[0][0];
    expect(data).toMatchObject({ notes: null, principalProductId: null });
  });

  it('produto de outro grupo -> 409 com o nome do produto e do grupo; nada e gravado', async () => {
    tx.forecastProduct.findMany.mockResolvedValue([
      produtoCadastrado(1),
      produtoCadastrado(2, { equivalenceGroupId: 3, equivalenceGroup: { name: 'OUTRO GRUPO SINTETICO' } }),
    ]);
    const cookies = await loginAs('admin');
    const response = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('O produto PRODUTO 002 já está no grupo OUTRO GRUPO SINTETICO.');
    expect(tx.forecastEquivalenceGroup.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('produto inexistente -> 400; produto inativo -> 400 pedindo para reativar', async () => {
    const cookies = await loginAs('admin');
    tx.forecastProduct.findMany.mockResolvedValue([produtoCadastrado(1)]);
    const inexistente = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(inexistente.status).toBe(400);
    expect(JSON.stringify(inexistente.body)).toContain('não existe mais no cadastro');

    tx.forecastProduct.findMany.mockResolvedValue([produtoCadastrado(1), produtoCadastrado(2, { isActive: false })]);
    const inativo = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(inativo.status).toBe(400);
    expect(JSON.stringify(inativo.body)).toContain('O produto PRODUTO 002 está inativo');
    expect(tx.forecastEquivalenceGroup.create).not.toHaveBeenCalled();
  });

  it('corrida: outro grupo pegou um produto entre a conferencia e a gravacao -> 409 e nenhum AuditLog', async () => {
    tx.forecastProduct.updateMany.mockResolvedValue({ count: 1 });
    const cookies = await loginAs('admin');
    const response = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('acabou de entrar em outro grupo');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('nome repetido (indice unico do nome normalizado) -> 409 em portugues', async () => {
    tx.forecastEquivalenceGroup.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
    );
    const cookies = await loginAs('admin');
    const response = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('Já existe um grupo de equivalência com esse nome.');
  });
});

describe('POST /forecast/equivalence-groups - validacao Zod em portugues', () => {
  const recusa = async (body: unknown, mensagem: string) => {
    const cookies = await loginAs('admin');
    const response = await request(app).post(BASE).set('Cookie', cookies).send(body as object);
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(mensagem);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  };

  it('nome obrigatorio e de ate 120 caracteres', async () => {
    await recusa(corpo({ nome: '   ' }), 'Informe o nome do grupo.');
    await recusa(corpo({ nome: 'A'.repeat(121) }), 'O nome do grupo aceita no máximo 120 caracteres.');
  });

  it('observacao de ate 300 caracteres', async () => {
    await recusa(corpo({ observacao: 'A'.repeat(301) }), 'A observação aceita no máximo 300 caracteres.');
  });

  it('de 2 a 20 produtos, sem repeticao e inteiros positivos', async () => {
    await recusa(corpo({ produtoIds: [1] }), 'Escolha ao menos 2 produtos para formar um grupo.');
    await recusa(corpo({ produtoIds: Array.from({ length: 21 }, (_, i) => i + 1) }), 'Um grupo aceita no máximo 20 produtos.');
    await recusa(corpo({ produtoIds: [1, 1] }), 'O mesmo produto aparece mais de uma vez no grupo.');
    await recusa(corpo({ produtoIds: [1, 0] }), 'Produto inválido.');
    await recusa(corpo({ produtoIds: [1, 1.5] }), 'Produto inválido.');
    await recusa({ nome: 'GRUPO SINTETICO' }, 'Informe os produtos do grupo.');
  });

  it('o principal precisa ser um dos produtos do grupo', async () => {
    await recusa(corpo({ principalProdutoId: 99 }), 'O produto principal precisa ser um dos produtos do grupo.');
  });
});

describe('PATCH /forecast/equivalence-groups/:id', () => {
  const patch = (cookies: string[], id: number | string, body: unknown) =>
    request(app).patch(`${BASE}/${id}`).set('Cookie', cookies).send(body as object);

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403', async (role) => {
    const cookies = await loginAs(role);
    expect((await patch(cookies, 7, { nome: 'NOVO NOME SINTETICO' })).status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('id invalido -> 400; corpo vazio -> 400; grupo inexistente -> 404', async () => {
    const cookies = await loginAs('admin');
    expect((await patch(cookies, 'abc', { nome: 'X' })).status).toBe(400);
    const vazio = await patch(cookies, 7, {});
    expect(vazio.status).toBe(400);
    expect(JSON.stringify(vazio.body)).toContain('Informe o que alterar no grupo.');
    tx.forecastEquivalenceGroup.findUnique.mockResolvedValue(null);
    expect((await patch(cookies, 7, { nome: 'NOVO NOME SINTETICO' })).status).toBe(404);
  });

  it('renomear: atualiza o grupo, nao mexe nos membros e audita so o nome do CAMPO', async () => {
    const cookies = await loginAs('comprador');
    const response = await patch(cookies, 7, { nome: 'NOVO NOME SINTETICO' });
    expect(response.status).toBe(200);
    expect(tx.forecastEquivalenceGroup.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        name: 'NOVO NOME SINTETICO',
        normalizedName: 'NOVO NOME SINTETICO',
        notes: 'OBS SINTETICA',
        principalProductId: 1,
      },
    });
    expect(tx.forecastProduct.updateMany).not.toHaveBeenCalled();
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log).toMatchObject({ entityType: 'forecast_equivalence_group', entityId: '7', action: 'update' });
    expect(log.metadata).toEqual({ produtoIds: [1, 2], principalProdutoId: 1, camposAlterados: ['nome'] });
    expect(JSON.stringify(log)).not.toMatch(/NOVO NOME|GRUPO SINTETICO|OBS/);
  });

  it('sem alteracao real: nao grava nem audita', async () => {
    const cookies = await loginAs('admin');
    const response = await patch(cookies, 7, { nome: 'GRUPO SINTETICO', produtoIds: [2, 1], principalProdutoId: 1 });
    expect(response.status).toBe(200);
    expect(tx.forecastEquivalenceGroup.update).not.toHaveBeenCalled();
    expect(tx.forecastProduct.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('trocar membros: o que sai fica avulso, o que entra e conferido e gravado; principal que saiu vira nulo', async () => {
    tx.forecastProduct.findMany.mockResolvedValue([produtoCadastrado(3)]);
    const cookies = await loginAs('admin');
    const response = await patch(cookies, 7, { produtoIds: [2, 3] });
    expect(response.status).toBe(200);
    expect(tx.forecastProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [3] } } }));
    expect(tx.forecastProduct.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: [1] }, equivalenceGroupId: 7 },
      data: { equivalenceGroupId: null },
    });
    expect(tx.forecastProduct.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: [3] }, equivalenceGroupId: null, isActive: true },
      data: { equivalenceGroupId: 7 },
    });
    expect(tx.forecastEquivalenceGroup.update.mock.calls[0][0].data.principalProductId).toBeNull();
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log.metadata).toEqual({
      produtoIds: [2, 3],
      principalProdutoId: null,
      camposAlterados: ['principalProdutoId', 'produtoIds'],
    });
  });

  it('principal fora dos membros atuais -> 400; null limpa o principal', async () => {
    const cookies = await loginAs('admin');
    const fora = await patch(cookies, 7, { principalProdutoId: 99 });
    expect(fora.status).toBe(400);
    expect(JSON.stringify(fora.body)).toContain('O produto principal precisa ser um dos produtos do grupo.');
    const limpo = await patch(cookies, 7, { principalProdutoId: null });
    expect(limpo.status).toBe(200);
    expect(tx.forecastEquivalenceGroup.update.mock.calls[0][0].data.principalProductId).toBeNull();
  });

  it('produto que entra e de outro grupo -> 409', async () => {
    tx.forecastProduct.findMany.mockResolvedValue([
      produtoCadastrado(3, { equivalenceGroupId: 4, equivalenceGroup: { name: 'OUTRO GRUPO SINTETICO' } }),
    ]);
    const cookies = await loginAs('admin');
    const response = await patch(cookies, 7, { produtoIds: [1, 2, 3] });
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('O produto PRODUTO 003 já está no grupo OUTRO GRUPO SINTETICO.');
    expect(tx.forecastEquivalenceGroup.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /forecast/equivalence-groups/:id', () => {
  it('sem login -> 401; gestor, viewer e comercial -> 403', async () => {
    expect((await request(app).delete(`${BASE}/7`)).status).toBe(401);
    for (const role of ['gestor', 'viewer', 'comercial'] as const) {
      const cookies = await loginAs(role);
      expect((await request(app).delete(`${BASE}/7`).set('Cookie', cookies)).status).toBe(403);
    }
    expect(tx.forecastEquivalenceGroup.delete).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s desfaz: DELETE no tx e AuditLog com os ids de antes', async (role) => {
    tx.forecastEquivalenceGroup.findUnique.mockResolvedValue({
      id: 7,
      principalProductId: 1,
      members: [{ id: 1 }, { id: 2 }],
    });
    const cookies = await loginAs(role);
    const response = await request(app).delete(`${BASE}/7`).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: 7 });
    expect(tx.forecastEquivalenceGroup.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log).toMatchObject({ entityType: 'forecast_equivalence_group', entityId: '7', action: 'delete' });
    expect(log.beforeData).toEqual({ produtoIds: [1, 2], principalProdutoId: 1 });
    expect(log.metadata).toEqual({ produtos: 2 });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('grupo inexistente -> 404; id invalido -> 400', async () => {
    const cookies = await loginAs('admin');
    tx.forecastEquivalenceGroup.findUnique.mockResolvedValue(null);
    expect((await request(app).delete(`${BASE}/7`).set('Cookie', cookies)).status).toBe(404);
    expect((await request(app).delete(`${BASE}/abc`).set('Cookie', cookies)).status).toBe(400);
    expect(tx.forecastEquivalenceGroup.delete).not.toHaveBeenCalled();
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
