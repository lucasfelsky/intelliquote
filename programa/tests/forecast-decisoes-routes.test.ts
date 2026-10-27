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
    forecastPurchaseDecision: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastSnapshotService } from '../src/services/ForecastSnapshotService';
import type { RelatorioCompras } from '../src/utils/forecastRelatorioCompras';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock; findUnique: Mock; update: Mock; updateMany: Mock };
  auditLog: { create: Mock };
  forecastSnapshot: { findFirst: Mock };
  forecastPurchaseDecision: { findMany: Mock };
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const BASE = '/api/v1/forecast/snapshots/7/decisoes';
const PUT_URL = `${BASE}/42`;

// Cliente transacional distinto do `prisma`: prova que a gravacao e o AuditLog usam o `tx`.
const tx = {
  forecastSnapshot: { findFirst: vi.fn() },
  forecastPurchaseDecision: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditLog: { create: vi.fn() },
};

const OBSERVACAO = 'OBSERVACAO SINTETICA SECRETA';

// Linha do banco (tudo sintetico). Decimal chega como string/objeto: o service converte com Number().
const linha = (over: Record<string, unknown> = {}) => ({
  id: 9,
  snapshotId: 7,
  productId: 42,
  quantityKg: '1500',
  status: 'nao',
  note: null,
  suggestedKg: '1000',
  demandKg: '-800',
  decidedById: 1,
  createdAt: new Date('2099-01-01T12:00:00.000Z'),
  updatedAt: new Date('2099-01-02T12:00:00.000Z'),
  ...over,
});

// Relatorio SINTETICO: o item do produto 42 tem quantidadeFinal (embalagem) diferente da quantidadeSugerida.
function relatorioSintetico(): RelatorioCompras {
  const item = {
    linha: 3,
    n: 1,
    productId: 42,
    item: 'PRODUTO 001',
    codigos: ['COD-001'],
    status: 'nao',
    demanda: -750.5,
    quantidadeSugerida: 900,
    quantidadeFinal: 1000,
  };
  return { grupos: [{ fonte: 'FONTE 001', itens: [item] }] } as unknown as RelatorioCompras;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(tx));
  prismaMock.forecastSnapshot.findFirst.mockResolvedValue({
    id: 7,
    label: '10-2',
    products: [{ linha: 3, productId: 42 }, { linha: 4, productId: 43 }, { linha: 5 }],
  });
  prismaMock.forecastPurchaseDecision.findMany.mockResolvedValue([linha()]);
  tx.forecastSnapshot.findFirst.mockResolvedValue({ id: 7 });
  tx.forecastPurchaseDecision.findUnique.mockResolvedValue(null);
  tx.forecastPurchaseDecision.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    linha({ id: 10, ...data, note: data.note ?? null }),
  );
  tx.forecastPurchaseDecision.updateMany.mockResolvedValue({ count: 1 });
  tx.forecastPurchaseDecision.deleteMany.mockResolvedValue({ count: 1 });
  tx.auditLog.create.mockResolvedValue({});
  vi.spyOn(ForecastSnapshotService, 'getRelatorioCompras').mockResolvedValue(relatorioSintetico());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /forecast/snapshots/:id/decisoes', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it.each<Role>(['admin', 'comprador', 'gestor', 'viewer'])('%s le as decisoes (COMEX_ROLES)', async (role) => {
    prismaMock.forecastPurchaseDecision.findMany.mockResolvedValue([
      linha({ id: 9, productId: 42 }),
      linha({ id: 11, productId: 43, quantityKg: '0', status: 'po', note: 'NOTA' }),
    ]);
    const cookies = await loginAs(role);
    const response = await request(app).get(BASE).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      snapshotId: 7,
      label: '10-2',
      decisoes: [
        {
          productId: 42,
          quantidadeKg: 1500,
          status: 'nao',
          observacao: null,
          sugeridaKg: 1000,
          demandaKg: -800,
          decididaPorId: 1,
          criadaEm: '2099-01-01T12:00:00.000Z',
          atualizadaEm: '2099-01-02T12:00:00.000Z',
        },
        {
          productId: 43,
          quantidadeKg: 0,
          status: 'po',
          observacao: 'NOTA',
          sugeridaKg: 1000,
          demandaKg: -800,
          decididaPorId: 1,
          criadaEm: '2099-01-01T12:00:00.000Z',
          atualizadaEm: '2099-01-02T12:00:00.000Z',
        },
      ],
    });
    expect(prismaMock.forecastPurchaseDecision.findMany).toHaveBeenCalledWith({
      where: { snapshotId: 7 },
      orderBy: { productId: 'asc' },
    });
  });

  it('comercial -> 403 e nada e consultado', async () => {
    const cookies = await loginAs('comercial');
    const response = await request(app).get(BASE).set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(prismaMock.forecastPurchaseDecision.findMany).not.toHaveBeenCalled();
  });

  it.each(['abc', '0'])('id %s -> 400', async (id) => {
    const cookies = await loginAs('admin');
    const response = await request(app).get(`/api/v1/forecast/snapshots/${id}/decisoes`).set('Cookie', cookies);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Quinzena invalida.');
  });

  it('quinzena excluida/inexistente -> 404 (busca com deletedAt: null)', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    const cookies = await loginAs('admin');
    const response = await request(app).get(BASE).set('Cookie', cookies);
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Quinzena nao encontrada.');
    expect(prismaMock.forecastSnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: 7, deletedAt: null },
      select: { id: true, label: true },
    });
    expect(prismaMock.forecastPurchaseDecision.findMany).not.toHaveBeenCalled();
  });
});

describe('PUT /forecast/snapshots/:id/decisoes/:productId - papeis', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).put(PUT_URL).send({ quantidadeKg: 10 })).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 sem abrir transacao', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: 10 });
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s grava (200)', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: 1200 });
    expect(response.status).toBe(200);
    expect(response.body.data.acao).toBe('create');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /forecast/snapshots/:id/decisoes/:productId - validacao', () => {
  it.each<[string, unknown]>([
    ['negativo', { quantidadeKg: -1 }],
    ['string', { quantidadeKg: '10' }],
    ['acima do maximo', { quantidadeKg: 10_000_001 }],
    ['4 casas decimais', { quantidadeKg: 1.2345 }],
    ['observacao com 301 caracteres', { quantidadeKg: 1, observacao: 'x'.repeat(301) }],
    ['status invalido', { quantidadeKg: 1, status: 'aprovado' }],
    ['chave desconhecida', { quantidadeKg: 1, extra: true }],
    ['null com observacao', { quantidadeKg: null, observacao: 'x' }],
    ['null com status', { quantidadeKg: null, status: 'po' }],
    ['corpo sem quantidadeKg', { observacao: 'x' }],
    ['corpo vazio', {}],
  ])('%s -> 400 sem abrir transacao', async (_nome, corpo) => {
    const cookies = await loginAs('admin');
    const response = await request(app).put(PUT_URL).set('Cookie', cookies).send(corpo as object);
    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('null + observacao devolve a mensagem de apagar', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(PUT_URL)
      .set('Cookie', cookies)
      .send({ quantidadeKg: null, observacao: 'x' });
    expect(response.body.message).toBe('Para apagar a decisão, envie só quantidadeKg: null.');
  });

  it('aceita 0, o maximo e ate 3 casas', async () => {
    const cookies = await loginAs('admin');
    for (const kg of [0, 10_000_000, 12.345]) {
      const response = await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: kg });
      expect(response.status).toBe(200);
    }
  });

  it.each(['abc', '0'])('quinzena %s -> 400', async (id) => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(`/api/v1/forecast/snapshots/${id}/decisoes/42`)
      .set('Cookie', cookies)
      .send({ quantidadeKg: 1 });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Quinzena invalida.');
  });

  it.each(['abc', '0'])('produto %s -> 400', async (id) => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(`/api/v1/forecast/snapshots/7/decisoes/${id}`)
      .set('Cookie', cookies)
      .send({ quantidadeKg: 1 });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Produto inválido.');
  });

  it('observacao vazia vira null e e aparada', async () => {
    const cookies = await loginAs('admin');
    await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: 5, observacao: '   ' });
    expect(tx.forecastPurchaseDecision.create.mock.calls[0][0].data.note).toBeNull();
    await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: 5, observacao: '  texto  ' });
    expect(tx.forecastPurchaseDecision.create.mock.calls[1][0].data.note).toBe('texto');
  });
});

describe('PUT /forecast/snapshots/:id/decisoes/:productId - regras de negocio', () => {
  it('quinzena excluida -> 404 (busca com deletedAt: null) e nada e gravado', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    const cookies = await loginAs('admin');
    const response = await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: 5 });
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
    const response = await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: 5 });
    expect(response.status).toBe(404);
    expect(tx.forecastSnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: 7, deletedAt: null },
      select: { id: true },
    });
    expect(tx.forecastPurchaseDecision.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('produto fora da quinzena -> 400', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(`${BASE}/999`)
      .set('Cookie', cookies)
      .send({ quantidadeKg: 5 });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('O produto não faz parte desta quinzena.');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('item fora da lista de compra (criar) -> 400', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app).put(`${BASE}/43`).set('Cookie', cookies).send({ quantidadeKg: 5 });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('O item não está na lista de compra desta quinzena.');
    expect(tx.forecastPurchaseDecision.create).not.toHaveBeenCalled();
  });

  it('item fora da lista de compra (mudar a quantidade) -> 400, mas mudar so o status passa', async () => {
    tx.forecastPurchaseDecision.findUnique.mockResolvedValue(linha({ productId: 43 }));
    const cookies = await loginAs('admin');
    const quantidade = await request(app).put(`${BASE}/43`).set('Cookie', cookies).send({ quantidadeKg: 5 });
    expect(quantidade.status).toBe(400);
    expect(tx.forecastPurchaseDecision.updateMany).not.toHaveBeenCalled();
    const soStatus = await request(app)
      .put(`${BASE}/43`)
      .set('Cookie', cookies)
      .send({ quantidadeKg: 1500, status: 'po' });
    expect(soStatus.status).toBe(200);
    expect(tx.forecastPurchaseDecision.updateMany).toHaveBeenCalledTimes(1);
  });

  it('create: grava com tx, congela quantidadeFinal e demanda, status padrao nao e AuditLog sem a observacao', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .put(PUT_URL)
      .set('Cookie', cookies)
      .send({ quantidadeKg: 1200, observacao: OBSERVACAO });
    expect(response.status).toBe(200);
    expect(response.body.data.acao).toBe('create');
    expect(response.body.data.decisao.productId).toBe(42);
    expect(tx.forecastPurchaseDecision.create).toHaveBeenCalledWith({
      data: {
        snapshotId: 7,
        productId: 42,
        quantityKg: 1200,
        status: 'nao',
        note: OBSERVACAO,
        suggestedKg: 1000,
        demandKg: -750.5,
        decidedById: 1,
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log.entityType).toBe('forecast_purchase_decision');
    expect(log.entityId).toBe('10');
    expect(log.action).toBe('create');
    expect(log.performedById).toBe(1);
    expect(log.metadata).toEqual({
      snapshotId: 7,
      productId: 42,
      label: '10-2',
      quantidadeKg: 1200,
      sugeridaKg: 1000,
      demandaKg: -750.5,
      status: 'nao',
      comObservacao: true,
    });
    expect(JSON.stringify(log)).not.toContain(OBSERVACAO);
  });

  it('create com status informado grava o status', async () => {
    const cookies = await loginAs('admin');
    await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: 0, status: 'cotando' });
    expect(tx.forecastPurchaseDecision.create.mock.calls[0][0].data).toMatchObject({
      quantityKg: 0,
      status: 'cotando',
      note: null,
    });
  });

  it('update so de status: nao recongela suggestedKg/demandKg e usa updatedAt no WHERE', async () => {
    const atual = linha();
    tx.forecastPurchaseDecision.findUnique.mockResolvedValueOnce(atual).mockResolvedValueOnce(linha({ status: 'po' }));
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(PUT_URL)
      .set('Cookie', cookies)
      .send({ quantidadeKg: 1500, status: 'po' });
    expect(response.status).toBe(200);
    expect(response.body.data.acao).toBe('update');
    expect(response.body.data.decisao.status).toBe('po');
    const chamada = tx.forecastPurchaseDecision.updateMany.mock.calls[0][0];
    expect(chamada.where).toEqual({ id: 9, updatedAt: atual.updatedAt });
    expect(chamada.data).not.toHaveProperty('suggestedKg');
    expect(chamada.data).not.toHaveProperty('demandKg');
    expect(chamada.data).not.toHaveProperty('quantityKg');
    expect(chamada.data).toMatchObject({ status: 'po', decidedById: 1 });
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log.action).toBe('update');
    expect(log.metadata).toMatchObject({
      status: 'po',
      antes: { quantidadeKg: 1500, status: 'nao' },
      camposAlterados: ['status'],
    });
  });

  it('update de quantidade: recongela suggestedKg/demandKg', async () => {
    tx.forecastPurchaseDecision.findUnique
      .mockResolvedValueOnce(linha())
      .mockResolvedValueOnce(linha({ quantityKg: '900', suggestedKg: '1000', demandKg: '-750.5' }));
    const cookies = await loginAs('admin');
    const response = await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: 900 });
    expect(response.status).toBe(200);
    const chamada = tx.forecastPurchaseDecision.updateMany.mock.calls[0][0];
    expect(chamada.data).toMatchObject({ quantityKg: 900, suggestedKg: 1000, demandKg: -750.5 });
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log.metadata.camposAlterados).toEqual(['quantidadeKg']);
    expect(log.metadata.antes).toEqual({ quantidadeKg: 1500, status: 'nao' });
    expect(log.metadata.demandaKg).toBe(-750.5);
  });

  it('update de observacao: audit sem o texto', async () => {
    tx.forecastPurchaseDecision.findUnique
      .mockResolvedValueOnce(linha())
      .mockResolvedValueOnce(linha({ note: OBSERVACAO }));
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(PUT_URL)
      .set('Cookie', cookies)
      .send({ quantidadeKg: 1500, observacao: OBSERVACAO });
    expect(response.status).toBe(200);
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log.metadata.camposAlterados).toEqual(['observacao']);
    expect(log.metadata.comObservacao).toBe(true);
    expect(JSON.stringify(log)).not.toContain(OBSERVACAO);
  });

  it('sem mudanca: nenhuma, sem updateMany e sem audit', async () => {
    tx.forecastPurchaseDecision.findUnique.mockResolvedValue(linha({ status: 'po', note: 'N' }));
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(PUT_URL)
      .set('Cookie', cookies)
      .send({ quantidadeKg: 1500, status: 'po', observacao: 'N' });
    expect(response.status).toBe(200);
    expect(response.body.data.acao).toBe('nenhuma');
    expect(response.body.data.decisao.quantidadeKg).toBe(1500);
    expect(tx.forecastPurchaseDecision.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('delete: deleteMany com updatedAt no WHERE + audit delete', async () => {
    const atual = linha({ note: OBSERVACAO });
    tx.forecastPurchaseDecision.findUnique.mockResolvedValue(atual);
    const cookies = await loginAs('admin');
    const response = await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: null });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ acao: 'delete', decisao: null });
    expect(tx.forecastPurchaseDecision.deleteMany).toHaveBeenCalledWith({
      where: { id: 9, updatedAt: atual.updatedAt },
    });
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log.action).toBe('delete');
    expect(log.entityId).toBe('9');
    expect(log.metadata).toEqual({
      snapshotId: 7,
      productId: 42,
      label: '10-2',
      quantidadeKg: 1500,
      sugeridaKg: 1000,
      status: 'nao',
      comObservacao: true,
    });
    expect(JSON.stringify(log)).not.toContain(OBSERVACAO);
    // Apagar nao precisa do relatorio.
    expect(ForecastSnapshotService.getRelatorioCompras).not.toHaveBeenCalled();
  });

  it('null sem decisao: nenhuma, sem audit', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: null });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ acao: 'nenhuma', decisao: null });
    expect(tx.forecastPurchaseDecision.deleteMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('PUT /forecast/snapshots/:id/decisoes/:productId - concorrencia (409)', () => {
  const MSG =
    'A quantidade decidida deste item acabou de ser gravada por outra pessoa. Atualize a tela e confira.';

  it('P2002 no create -> 409 com a mensagem propria', async () => {
    tx.forecastPurchaseDecision.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
    );
    const cookies = await loginAs('admin');
    const response = await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: 5 });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe(MSG);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('updateMany com count 0 -> 409', async () => {
    tx.forecastPurchaseDecision.findUnique.mockResolvedValue(linha());
    tx.forecastPurchaseDecision.updateMany.mockResolvedValue({ count: 0 });
    const cookies = await loginAs('admin');
    const response = await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: 5 });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe(MSG);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('deleteMany com count 0 -> 409', async () => {
    tx.forecastPurchaseDecision.findUnique.mockResolvedValue(linha());
    tx.forecastPurchaseDecision.deleteMany.mockResolvedValue({ count: 0 });
    const cookies = await loginAs('admin');
    const response = await request(app).put(PUT_URL).set('Cookie', cookies).send({ quantidadeKg: null });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe(MSG);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
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
