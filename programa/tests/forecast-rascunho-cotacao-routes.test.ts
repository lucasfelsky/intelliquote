import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    forecastSnapshot: { findFirst: vi.fn() },
    forecastQuoteDraft: { findUnique: vi.fn() },
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
  forecastSnapshot: { findFirst: Mock };
  forecastQuoteDraft: { findUnique: Mock };
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const URL = '/api/v1/forecast/snapshots/7/rascunho-cotacao';
const MSG_CORRIDA = 'O rascunho desta cotação acabou de ser alterado em outra aba ou sessão. Recarregue o rascunho e confira.';
const OBSERVACAO = 'OBSERVACAO SINTETICA SECRETA';

// Cliente transacional distinto do `prisma`: prova que a gravacao e o AuditLog usam o `tx`.
const tx = {
  forecastSnapshot: { findFirst: vi.fn() },
  forecastQuoteDraft: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditLog: { create: vi.fn() },
};

// Linha do banco (tudo sintetico).
const linha = (over: Record<string, unknown> = {}) => ({
  id: 9,
  snapshotId: 7,
  userId: 1,
  items: [{ productId: 42, quantidadeKg: 1500, observacao: null }],
  createdAt: new Date('2099-01-01T12:00:00.000Z'),
  updatedAt: new Date('2099-01-02T12:00:00.000Z'),
  ...over,
});

const auditoria = () => tx.auditLog.create.mock.calls.map((c) => c[0].data);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(tx));
  prismaMock.forecastSnapshot.findFirst.mockResolvedValue({
    id: 7,
    label: '10-2',
    products: [{ linha: 3, productId: 42 }, { linha: 4, productId: 43 }, { linha: 5 }],
  });
  prismaMock.forecastQuoteDraft.findUnique.mockResolvedValue(linha());
  tx.forecastSnapshot.findFirst.mockResolvedValue({ id: 7 });
  tx.forecastQuoteDraft.findUnique.mockResolvedValue(null);
  tx.forecastQuoteDraft.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    linha({ id: 10, ...data }),
  );
  tx.forecastQuoteDraft.updateMany.mockResolvedValue({ count: 1 });
  tx.forecastQuoteDraft.deleteMany.mockResolvedValue({ count: 1 });
  tx.auditLog.create.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /forecast/snapshots/:id/rascunho-cotacao', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).get(URL)).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 e nada e consultado', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).get(URL).set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(prismaMock.forecastQuoteDraft.findUnique).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s le o PROPRIO rascunho (busca por quinzena + usuario logado)', async (role) => {
    const cookies = await loginAs(role, 5);
    prismaMock.forecastQuoteDraft.findUnique.mockResolvedValue(
      linha({ userId: 5, items: [{ productId: 42, quantidadeKg: 12.5, observacao: 'NOTA' }] }),
    );
    const response = await request(app).get(URL).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      snapshotId: 7,
      itens: [{ productId: 42, quantidadeKg: 12.5, observacao: 'NOTA' }],
      criadoEm: '2099-01-01T12:00:00.000Z',
      atualizadoEm: '2099-01-02T12:00:00.000Z',
    });
    expect(prismaMock.forecastQuoteDraft.findUnique).toHaveBeenCalledWith({
      where: { snapshotId_userId: { snapshotId: 7, userId: 5 } },
    });
  });

  it('sem rascunho do usuario (o do colega e invisivel) -> data: null', async () => {
    prismaMock.forecastQuoteDraft.findUnique.mockResolvedValue(null);
    const cookies = await loginAs('comprador', 6);
    const response = await request(app).get(URL).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: null });
    expect(prismaMock.forecastQuoteDraft.findUnique).toHaveBeenCalledWith({
      where: { snapshotId_userId: { snapshotId: 7, userId: 6 } },
    });
  });

  it.each(['abc', '0'])('id %s -> 400', async (id) => {
    const cookies = await loginAs('admin');
    const response = await request(app).get(`/api/v1/forecast/snapshots/${id}/rascunho-cotacao`).set('Cookie', cookies);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Quinzena invalida.');
  });

  it('quinzena excluida/inexistente -> 404 (busca com deletedAt: null)', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    const cookies = await loginAs('admin');
    const response = await request(app).get(URL).set('Cookie', cookies);
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Quinzena nao encontrada.');
    expect(prismaMock.forecastSnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: 7, deletedAt: null },
      select: { id: true },
    });
    expect(prismaMock.forecastQuoteDraft.findUnique).not.toHaveBeenCalled();
  });
});

describe('PUT /forecast/snapshots/:id/rascunho-cotacao - papeis', () => {
  const corpo = { itens: [{ productId: 42, quantidadeKg: 10 }] };

  it('sem login -> 401', async () => {
    expect((await request(app).put(URL).send(corpo)).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 sem abrir transacao', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).put(URL).set('Cookie', cookies).send(corpo);
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s grava (200)', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).put(URL).set('Cookie', cookies).send(corpo);
    expect(response.status).toBe(200);
    expect(response.body.data.acao).toBe('create');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /forecast/snapshots/:id/rascunho-cotacao - validacao', () => {
  const item = { productId: 42, quantidadeKg: 10 };

  it.each<[string, unknown]>([
    ['corpo vazio', {}],
    ['itens que nao e lista', { itens: 'x' }],
    ['kg negativo', { itens: [{ ...item, quantidadeKg: -1 }] }],
    ['kg como string', { itens: [{ ...item, quantidadeKg: '10' }] }],
    ['kg acima do maximo', { itens: [{ ...item, quantidadeKg: 10_000_001 }] }],
    ['kg com 4 casas decimais', { itens: [{ ...item, quantidadeKg: 1.2345 }] }],
    ['observacao com 301 caracteres', { itens: [{ ...item, observacao: 'x'.repeat(301) }] }],
    ['produto nao inteiro', { itens: [{ ...item, productId: 1.5 }] }],
    ['produto zero', { itens: [{ ...item, productId: 0 }] }],
    ['item sem produto', { itens: [{ quantidadeKg: 10 }] }],
    ['item sem kg', { itens: [{ productId: 42 }] }],
    ['chave desconhecida no item', { itens: [{ ...item, extra: true }] }],
    ['chave desconhecida no corpo', { itens: [item], extra: true }],
    ['atualizadoEm que nao e data', { itens: [item], atualizadoEm: 'ontem' }],
    ['201 itens', { itens: Array.from({ length: 201 }, (_, i) => ({ productId: i + 1, quantidadeKg: 1 })) }],
    ['produto duplicado', { itens: [item, { productId: 43, quantidadeKg: 1 }, item] }],
  ])('%s -> 400 sem abrir transacao', async (_nome, corpo) => {
    const cookies = await loginAs('admin');
    const response = await request(app).put(URL).set('Cookie', cookies).send(corpo as object);
    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('produto duplicado devolve a mensagem do item repetido', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(URL)
      .set('Cookie', cookies)
      .send({ itens: [item, item] });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('O mesmo produto aparece mais de uma vez no rascunho.');
  });

  it('aceita 0, o maximo, 3 casas, 200 itens e lista vazia', async () => {
    const cookies = await loginAs('admin');
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue({
      id: 7,
      label: '10-2',
      products: Array.from({ length: 200 }, (_, i) => ({ linha: i + 3, productId: i + 1 })),
    });
    for (const itens of [
      [{ productId: 1, quantidadeKg: 0 }],
      [{ productId: 1, quantidadeKg: 10_000_000 }],
      [{ productId: 1, quantidadeKg: 12.345 }],
      Array.from({ length: 200 }, (_, i) => ({ productId: i + 1, quantidadeKg: 1 })),
      [],
    ]) {
      const response = await request(app).put(URL).set('Cookie', cookies).send({ itens });
      expect(response.status).toBe(200);
    }
  });

  it.each(['abc', '0'])('quinzena %s -> 400', async (id) => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(`/api/v1/forecast/snapshots/${id}/rascunho-cotacao`)
      .set('Cookie', cookies)
      .send({ itens: [item] });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Quinzena invalida.');
  });

  it('observacao vazia vira null e a com texto e aparada', async () => {
    const cookies = await loginAs('admin');
    await request(app)
      .put(URL)
      .set('Cookie', cookies)
      .send({ itens: [{ ...item, observacao: '   ' }] });
    expect(tx.forecastQuoteDraft.create.mock.calls[0][0].data.items).toEqual([
      { productId: 42, quantidadeKg: 10, observacao: null },
    ]);
    await request(app)
      .put(URL)
      .set('Cookie', cookies)
      .send({ itens: [{ ...item, observacao: '  texto  ' }] });
    expect(tx.forecastQuoteDraft.create.mock.calls[1][0].data.items[0].observacao).toBe('texto');
  });
});

describe('PUT /forecast/snapshots/:id/rascunho-cotacao - regras de negocio', () => {
  const corpo = { itens: [{ productId: 42, quantidadeKg: 10, observacao: OBSERVACAO }, { productId: 43, quantidadeKg: 0 }] };

  it('quinzena excluida -> 404 (busca com deletedAt: null) e nada e gravado', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    const cookies = await loginAs('admin');
    const response = await request(app).put(URL).set('Cookie', cookies).send(corpo);
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Quinzena nao encontrada.');
    expect(prismaMock.forecastSnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: 7, deletedAt: null },
      select: { id: true, label: true, products: true },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('quinzena excluida entre a leitura e a transacao -> 404 sem gravar', async () => {
    tx.forecastSnapshot.findFirst.mockResolvedValue(null);
    const cookies = await loginAs('admin');
    const response = await request(app).put(URL).set('Cookie', cookies).send(corpo);
    expect(response.status).toBe(404);
    expect(tx.forecastQuoteDraft.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('produto de outra quinzena -> 400 com o id e nada e gravado', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(URL)
      .set('Cookie', cookies)
      .send({ itens: [{ productId: 42, quantidadeKg: 1 }, { productId: 999, quantidadeKg: 1 }] });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Produto fora desta quinzena: 999.');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('create: grava com o usuario logado, devolve o rascunho e audita sem o texto da observacao', async () => {
    const cookies = await loginAs('comprador', 5);
    const response = await request(app).put(URL).set('Cookie', cookies).send(corpo);
    expect(response.status).toBe(200);
    expect(response.body.data.acao).toBe('create');
    expect(response.body.data.rascunho).toMatchObject({
      snapshotId: 7,
      itens: [
        { productId: 42, quantidadeKg: 10, observacao: OBSERVACAO },
        { productId: 43, quantidadeKg: 0, observacao: null },
      ],
    });
    expect(tx.forecastQuoteDraft.findUnique).toHaveBeenCalledWith({
      where: { snapshotId_userId: { snapshotId: 7, userId: 5 } },
    });
    expect(tx.forecastQuoteDraft.create.mock.calls[0][0].data.snapshotId).toBe(7);
    expect(tx.forecastQuoteDraft.create.mock.calls[0][0].data.userId).toBe(5);
    const [log] = auditoria();
    expect(log).toMatchObject({ entityType: 'forecast_quote_draft', entityId: '10', action: 'create', performedById: 5 });
    expect(log.metadata).toMatchObject({ snapshotId: 7, label: '10-2', totalItens: 2, comObservacao: true });
    expect(JSON.stringify(log)).not.toContain(OBSERVACAO);
  });

  it('update: troca os itens com guarda por updatedAt e audita contagens', async () => {
    tx.forecastQuoteDraft.findUnique
      .mockResolvedValueOnce(linha())
      .mockResolvedValueOnce(linha({ items: corpo.itens.map((i) => ({ observacao: null, ...i })), updatedAt: new Date('2099-01-03T12:00:00.000Z') }));
    const cookies = await loginAs('admin');
    const response = await request(app).put(URL).set('Cookie', cookies).send(corpo);
    expect(response.status).toBe(200);
    expect(response.body.data.acao).toBe('update');
    expect(response.body.data.rascunho.atualizadoEm).toBe('2099-01-03T12:00:00.000Z');
    const args = tx.forecastQuoteDraft.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: 9, updatedAt: new Date('2099-01-02T12:00:00.000Z') });
    expect(args.data.items).toEqual([
      { productId: 42, quantidadeKg: 10, observacao: OBSERVACAO },
      { productId: 43, quantidadeKg: 0, observacao: null },
    ]);
    const [log] = auditoria();
    expect(log).toMatchObject({ entityType: 'forecast_quote_draft', entityId: '9', action: 'update' });
    expect(log.metadata).toMatchObject({ totalItens: 2, comObservacao: true, antes: { totalItens: 1 } });
    expect(JSON.stringify(log)).not.toContain(OBSERVACAO);
  });

  it('sem mudanca -> acao nenhuma, sem gravar nem auditar', async () => {
    tx.forecastQuoteDraft.findUnique.mockResolvedValue(linha());
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(URL)
      .set('Cookie', cookies)
      .send({ itens: [{ productId: 42, quantidadeKg: 1500 }] });
    expect(response.status).toBe(200);
    expect(response.body.data.acao).toBe('nenhuma');
    expect(response.body.data.rascunho.itens).toHaveLength(1);
    expect(tx.forecastQuoteDraft.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('lista vazia apaga (delete) e audita so a contagem', async () => {
    tx.forecastQuoteDraft.findUnique.mockResolvedValue(linha({ items: [{ productId: 42, quantidadeKg: 1, observacao: OBSERVACAO }] }));
    const cookies = await loginAs('admin');
    const response = await request(app).put(URL).set('Cookie', cookies).send({ itens: [] });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ acao: 'delete', rascunho: null });
    expect(tx.forecastQuoteDraft.deleteMany).toHaveBeenCalledWith({
      where: { id: 9, updatedAt: new Date('2099-01-02T12:00:00.000Z') },
    });
    const [log] = auditoria();
    expect(log).toMatchObject({ action: 'delete', entityType: 'forecast_quote_draft' });
    expect(JSON.stringify(log)).not.toContain(OBSERVACAO);
  });

  it('lista vazia sem rascunho -> acao nenhuma', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app).put(URL).set('Cookie', cookies).send({ itens: [] });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ acao: 'nenhuma', rascunho: null });
    expect(tx.forecastQuoteDraft.deleteMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('PUT /forecast/snapshots/:id/rascunho-cotacao - concorrencia (409)', () => {
  const corpo = { itens: [{ productId: 42, quantidadeKg: 10 }] };

  it('updateMany com count 0 -> 409 sem auditar', async () => {
    tx.forecastQuoteDraft.findUnique.mockResolvedValue(linha());
    tx.forecastQuoteDraft.updateMany.mockResolvedValue({ count: 0 });
    const cookies = await loginAs('admin');
    const response = await request(app).put(URL).set('Cookie', cookies).send(corpo);
    expect(response.status).toBe(409);
    expect(response.body.message).toBe(MSG_CORRIDA);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('deleteMany com count 0 -> 409 sem auditar', async () => {
    tx.forecastQuoteDraft.findUnique.mockResolvedValue(linha());
    tx.forecastQuoteDraft.deleteMany.mockResolvedValue({ count: 0 });
    const cookies = await loginAs('admin');
    const response = await request(app).put(URL).set('Cookie', cookies).send({ itens: [] });
    expect(response.status).toBe(409);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('create que perde a corrida (P2002 da chave unica) -> 409', async () => {
    tx.forecastQuoteDraft.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    const cookies = await loginAs('admin');
    const response = await request(app).put(URL).set('Cookie', cookies).send(corpo);
    expect(response.status).toBe(409);
    expect(response.body.message).toBe(MSG_CORRIDA);
  });

  it('atualizadoEm desatualizado (rascunho mudou em outra aba) -> 409 sem gravar', async () => {
    tx.forecastQuoteDraft.findUnique.mockResolvedValue(linha());
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(URL)
      .set('Cookie', cookies)
      .send({ ...corpo, atualizadoEm: '2099-01-01T00:00:00.000Z' });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe(MSG_CORRIDA);
    expect(tx.forecastQuoteDraft.updateMany).not.toHaveBeenCalled();
  });

  it('atualizadoEm igual ao da linha atual -> grava', async () => {
    tx.forecastQuoteDraft.findUnique
      .mockResolvedValueOnce(linha())
      .mockResolvedValueOnce(linha({ items: [{ productId: 42, quantidadeKg: 10, observacao: null }] }));
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(URL)
      .set('Cookie', cookies)
      .send({ ...corpo, atualizadoEm: '2099-01-02T12:00:00.000Z' });
    expect(response.status).toBe(200);
    expect(response.body.data.acao).toBe('update');
  });

  it('atualizadoEm informado mas o rascunho foi apagado -> 409; atualizadoEm null com rascunho existente -> 409', async () => {
    const cookies = await loginAs('admin');
    const apagado = await request(app)
      .put(URL)
      .set('Cookie', cookies)
      .send({ ...corpo, atualizadoEm: '2099-01-02T12:00:00.000Z' });
    expect(apagado.status).toBe(409);

    tx.forecastQuoteDraft.findUnique.mockResolvedValue(linha());
    const existente = await request(app).put(URL).set('Cookie', cookies).send({ ...corpo, atualizadoEm: null });
    expect(existente.status).toBe(409);
    expect(tx.forecastQuoteDraft.create).not.toHaveBeenCalled();
    expect(tx.forecastQuoteDraft.updateMany).not.toHaveBeenCalled();
  });
});

describe('DELETE /forecast/snapshots/:id/rascunho-cotacao', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).delete(URL)).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 sem abrir transacao', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).delete(URL).set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s apaga o proprio rascunho (200)', async (role) => {
    tx.forecastQuoteDraft.findUnique.mockResolvedValue(linha({ userId: 5 }));
    const cookies = await loginAs(role, 5);
    const response = await request(app).delete(URL).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ acao: 'delete', rascunho: null });
    expect(tx.forecastQuoteDraft.findUnique).toHaveBeenCalledWith({
      where: { snapshotId_userId: { snapshotId: 7, userId: 5 } },
    });
    expect(auditoria()[0]).toMatchObject({ action: 'delete', entityType: 'forecast_quote_draft', performedById: 5 });
  });

  it('sem rascunho do usuario -> 200 acao nenhuma (nao toca o do colega)', async () => {
    const cookies = await loginAs('admin', 6);
    const response = await request(app).delete(URL).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ acao: 'nenhuma', rascunho: null });
    expect(tx.forecastQuoteDraft.deleteMany).not.toHaveBeenCalled();
  });

  it('quinzena excluida -> 404', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    const cookies = await loginAs('admin');
    const response = await request(app).delete(URL).set('Cookie', cookies);
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Quinzena nao encontrada.');
  });

  it('deleteMany com count 0 -> 409', async () => {
    tx.forecastQuoteDraft.findUnique.mockResolvedValue(linha());
    tx.forecastQuoteDraft.deleteMany.mockResolvedValue({ count: 0 });
    const cookies = await loginAs('admin');
    const response = await request(app).delete(URL).set('Cookie', cookies);
    expect(response.status).toBe(409);
  });
});

async function loginAs(role: Role, id = 1) {
  const passwordHash = await hashPassword('ChangeMe123!');

  prismaMock.user.findUnique.mockResolvedValue({
    id,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  });
  prismaMock.user.findFirst.mockResolvedValue({
    id,
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
