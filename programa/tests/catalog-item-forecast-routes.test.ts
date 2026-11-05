import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CADASTRO_TX_OPTIONS } from '../src/services/ForecastProductCadastroService';
import { hashPassword } from '../src/utils/password';

// O arquivo faz dezenas de logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

// Sem delete/deleteMany em forecastProductCode DE PROPOSITO: chamar vira 500 (o catalogo nunca apaga codigo, D1).
vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    catalogItem: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    quoteRequestItem: { count: vi.fn() },
    forecastProductCode: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    forecastProduct: { findUnique: vi.fn(), create: vi.fn() },
    forecastSource: { findUnique: vi.fn() },
    itemFamily: { findUnique: vi.fn() },
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
  catalogItem: { findUnique: Mock; findMany: Mock; count: Mock; create: Mock; update: Mock };
  quoteRequestItem: { count: Mock };
  forecastProductCode: Record<'findUnique' | 'findMany' | 'create' | 'update' | 'updateMany', Mock>;
  forecastProduct: { findUnique: Mock; create: Mock };
  forecastSource: { findUnique: Mock };
  itemFamily: { findUnique: Mock };
  $executeRaw: Mock;
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer';

// Dados SINTETICOS (repo publico).
const POST_PATH = '/api/v1/catalog-items';
const corpoLivre = { commercialName: 'Item TST', marketName: 'ITEM TST 9001', dbcorpCode: 'tst9001' };
const produtoAtivo = { id: 5, name: 'PRODUTO TST', isActive: true, origin: 'dbcorp', codes: [] as Array<{ position: number }> };

function itemLegado(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    commercialName: 'Item legado',
    marketName: 'ITEM LEGADO 9100',
    ncm: null,
    dbcorpCode: 'TST9100',
    notes: null,
    isActive: true,
    familyId: null,
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.catalogItem.findUnique.mockResolvedValue(null);
  prismaMock.catalogItem.findMany.mockResolvedValue([]);
  prismaMock.catalogItem.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 7,
    ...data,
    family: null,
  }));
  prismaMock.catalogItem.update.mockImplementation(
    async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => ({
      ...itemLegado(),
      id: where.id,
      ...data,
      family: null,
    }),
  );
  prismaMock.forecastProductCode.findUnique.mockResolvedValue(null);
  prismaMock.forecastProductCode.findMany.mockResolvedValue([]);
  prismaMock.forecastProductCode.create.mockImplementation(
    async ({ data }: { data: { position: number; code: string } }) => ({
      id: 900 + data.position,
      position: data.position,
      code: data.code,
    }),
  );
  prismaMock.forecastProductCode.update.mockResolvedValue({});
  prismaMock.forecastProductCode.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.forecastProduct.findUnique.mockResolvedValue(produtoAtivo);
  prismaMock.forecastProduct.create.mockImplementation(async ({ data }: { data: { name: string } }) => ({
    id: 55,
    name: data.name,
  }));
  prismaMock.forecastSource.findUnique.mockResolvedValue({ id: 3, isActive: true, leadTimeDays: 45 });
  prismaMock.itemFamily.findUnique.mockResolvedValue({ id: 4, isActive: true });
});

const existente = { modo: 'existente', productId: 5 };
const novo = { modo: 'novo', nome: 'PRODUTO NOVO TST', sourceId: 3, familyId: 4 };

describe('POST /catalog-items - vinculo com o Forecast', () => {
  it('a. codigo livre sem forecast -> 400 e nada gravado', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send(corpoLivre);
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('não está no Forecast');
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });

  it('b. existente: item + codigo na MESMA transacao, lock primeiro, catalogItemId = id do item', async () => {
    const cookies = await loginAs('comprador');
    // 2 itens ativos com o mesmo codigo: catalogoPorCodigo nao resolveria; o id explicito do item sim.
    prismaMock.catalogItem.findMany.mockResolvedValue([
      { id: 7, dbcorpCode: 'TST9001' },
      { id: 8, dbcorpCode: 'TST9001' },
    ]);
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, forecast: existente });

    expect(response.status).toBe(201);
    expect(response.body.forecastVinculo).toMatchObject({ situacao: 'adicionado', produto: { id: 5 } });
    expect(response.body.marketName).toBe('ITEM TST 9001');

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000, maxWait: 10_000 });
    const lockCall = prismaMock.$executeRaw.mock.calls[0];
    expect((lockCall[0] as string[]).join('')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(lockCall[1]).toBe('forecast:import');
    const ordemLock = prismaMock.$executeRaw.mock.invocationCallOrder[0];
    const ordemItem = prismaMock.catalogItem.create.mock.invocationCallOrder[0];
    const ordemCodigo = prismaMock.forecastProductCode.create.mock.invocationCallOrder[0];
    expect(ordemLock).toBeLessThan(ordemItem);
    expect(ordemItem).toBeLessThan(ordemCodigo);

    expect(prismaMock.forecastProductCode.create).toHaveBeenCalledWith({
      data: { productId: 5, position: 1, code: 'TST9001', catalogItemId: 7 },
    });
    const audits = prismaMock.auditLog.create.mock.calls.map(
      (c) => c[0].data as { entityType: string; action: string; metadata: Record<string, unknown> | null },
    );
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'catalog_item', action: 'create' }),
        expect.objectContaining({
          entityType: 'forecast_product',
          action: 'code_add',
          metadata: expect.objectContaining({ source: 'catalogo', codeId: 901, catalogItemId: 7 }),
        }),
      ]),
    );
  });

  it('c. novo: cria produto origin dbcorp com o codigo na posicao 1 ligado ao item', async () => {
    const cookies = await loginAs('admin');
    prismaMock.forecastProduct.findUnique.mockResolvedValue(null);
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, forecast: novo });

    expect(response.status).toBe(201);
    expect(response.body.forecastVinculo).toMatchObject({ situacao: 'produto_novo', produto: { id: 55, origem: 'dbcorp' } });
    expect(prismaMock.forecastProduct.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ origin: 'dbcorp', sourceId: 3, familyId: 4, name: 'PRODUTO NOVO TST' }),
    });
    expect(prismaMock.forecastProductCode.create).toHaveBeenCalledWith({
      data: { productId: 55, position: 1, code: 'TST9001', catalogItemId: 7 },
    });
    const origem = prismaMock.auditLog.create.mock.calls
      .map((c) => c[0].data as { entityType: string; action: string; metadata: Record<string, unknown> })
      .find((a) => a.entityType === 'forecast_product' && a.action === 'create');
    expect(origem?.metadata).toMatchObject({ source: 'catalogo', catalogItemIds: [7] });
  });

  it('c. novo com fonte sem lead time -> 400', async () => {
    const cookies = await loginAs('admin');
    prismaMock.forecastProduct.findUnique.mockResolvedValue(null);
    prismaMock.forecastSource.findUnique.mockResolvedValue({ id: 3, isActive: true, leadTimeDays: null });
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, forecast: novo });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('A fonte escolhida não tem lead time cadastrado.');
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });

  it('d. produto inexistente -> 404', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.forecastProduct.findUnique.mockResolvedValue(null);
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, forecast: existente });
    expect(response.status).toBe(404);
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
  });

  it('d. produto inativo -> 400', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.forecastProduct.findUnique.mockResolvedValue({ ...produtoAtivo, isActive: false });
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, forecast: existente });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Produto inativo.');
  });

  it('d. produto com 7 codigos -> 400', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.forecastProduct.findUnique.mockResolvedValue({
      ...produtoAtivo,
      codes: [1, 2, 3, 4, 5, 6, 7].map((position) => ({ position })),
    });
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, forecast: existente });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('O produto já tem 7 códigos.');
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
  });

  it('d. codigo de OUTRO produto com escolha diferente -> 409', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.forecastProductCode.findUnique.mockResolvedValue({
      id: 31,
      catalogItemId: null,
      product: { id: 9, name: 'DONO TST', isActive: true, origin: 'planilha' },
    });
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, forecast: existente });
    expect(response.status).toBe(409);
    expect(response.body.message).toContain('já pertence ao produto DONO TST');
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
  });

  it('d. Zod: modo invalido, productId 0 e campo extra -> 400', async () => {
    const cookies = await loginAs('comprador');
    for (const forecast of [
      { modo: 'qualquer' },
      { modo: 'existente', productId: 0 },
      { modo: 'existente', productId: 5, extra: 1 },
      { modo: 'novo', nome: '', sourceId: 3, familyId: 4 },
    ]) {
      const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, forecast });
      expect(response.status).toBe(400);
    }
    expect(prismaMock.catalogItem.create).not.toHaveBeenCalled();
  });

  it('d. forecast sem dbcorpCode -> 400', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .post(POST_PATH)
      .set('Cookie', cookies)
      .send({ commercialName: 'Item TST', marketName: 'ITEM TST 9002', forecast: existente });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Informe o código DBCorp para vincular o item ao Forecast.');
    expect(prismaMock.catalogItem.create).not.toHaveBeenCalled();
  });

  it('d. transacao que estoura (P2028) -> 503 cadastro ocupado', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('timeout', { code: 'P2028', clientVersion: 'test' }),
    );
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, forecast: existente });
    expect(response.status).toBe(503);
    expect(response.body.message).toBe('O cadastro está ocupado por uma importação. Tente novamente em instantes.');
  });

  it('d. P2002 de marketName na transacao -> 409 de nome de mercado', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['marketName'] },
      }),
    );
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, forecast: existente });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Ja existe um item cadastrado com esse nome de mercado.');
  });

  it('e. codigo ja no Forecast com catalogItemId de OUTRO item -> 201 sem sobrescrever', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.forecastProductCode.findUnique.mockResolvedValue({
      id: 31,
      catalogItemId: 99,
      product: { id: 9, name: 'DONO TST', isActive: true, origin: 'dbcorp' },
    });
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send(corpoLivre);
    expect(response.status).toBe(201);
    expect(response.body.forecastVinculo).toMatchObject({ situacao: 'ja_no_forecast', codigoId: 31 });
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
  });

  it('e. codigo ja no Forecast sem catalogItemId -> liga ao item e audita code_catalog_link', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.forecastProductCode.findUnique.mockResolvedValue({
      id: 31,
      catalogItemId: null,
      product: { id: 9, name: 'DONO TST', isActive: true, origin: 'dbcorp' },
    });
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send(corpoLivre);
    expect(response.status).toBe(201);
    expect(prismaMock.forecastProductCode.update).toHaveBeenCalledWith({ where: { id: 31 }, data: { catalogItemId: 7 } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'forecast_product',
        entityId: '9',
        action: 'code_catalog_link',
        metadata: { source: 'catalogo', codeId: 31, catalogItemId: 7 },
      }),
    });
  });

  it('e. codigo em produto INATIVO: salva sem novo vinculo (D5)', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.forecastProductCode.findUnique.mockResolvedValue({
      id: 31,
      catalogItemId: 99,
      product: { id: 9, name: 'DONO TST', isActive: false, origin: 'dbcorp' },
    });
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send(corpoLivre);
    expect(response.status).toBe(201);
    expect(response.body.forecastVinculo.situacao).toBe('produto_inativo');
  });

  it('f. item criado inativo com codigo livre e sem forecast -> 201 sem vinculo (D6)', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, isActive: false });
    expect(response.status).toBe(201);
    expect(response.body.forecastVinculo).toBeNull();
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
  });

  it('n. item criado inativo COM forecast -> 400 (mesma mensagem do PUT) e nada gravado', async () => {
    const cookies = await loginAs('comprador');
    for (const forecast of [existente, novo]) {
      const response = await request(app)
        .post(POST_PATH)
        .set('Cookie', cookies)
        .send({ ...corpoLivre, isActive: false, forecast });
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Reative o item para vinculá-lo ao Forecast.');
    }
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
    expect(prismaMock.catalogItem.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('o. item criado inativo SEM forecast -> 201, gravado inativo e sem tocar o Forecast (D6)', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app).post(POST_PATH).set('Cookie', cookies).send({ ...corpoLivre, isActive: false });
    expect(response.status).toBe(201);
    expect(response.body.isActive).toBe(false);
    expect(response.body.forecastVinculo).toBeNull();
    expect(prismaMock.catalogItem.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.catalogItem.create.mock.calls[0][0].data).toMatchObject({ dbcorpCode: 'TST9001', isActive: false });
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
  });

  it('sem codigo e sem forecast: caminho atual, sem transacao', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .post(POST_PATH)
      .set('Cookie', cookies)
      .send({ commercialName: 'Item TST', marketName: 'ITEM TST 9003' });
    expect(response.status).toBe(201);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(response.body.forecastVinculo).toBeUndefined();
  });

  it('codigo acima de 40 caracteres e livre -> 400', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .post(POST_PATH)
      .set('Cookie', cookies)
      .send({ ...corpoLivre, dbcorpCode: 'T'.repeat(41), forecast: existente });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('O código aceita no máximo 40 caracteres.');
  });
});

describe('PUT /catalog-items/:id - vinculo com o Forecast', () => {
  const put = (cookies: string[], body: object) =>
    request(app).put('/api/v1/catalog-items/7').set('Cookie', cookies).send(body);

  it('g. so nota em item legado com codigo livre -> 200 sem transacao (D2)', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado());
    const response = await put(cookies, { notes: 'nota nova' });
    expect(response.status).toBe(200);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.findUnique).not.toHaveBeenCalled();
  });

  it('g. reenviar o MESMO codigo (outra caixa) tambem nao exige vinculo', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado());
    const response = await put(cookies, { dbcorpCode: ' tst9100 ', notes: 'x' });
    expect(response.status).toBe(200);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('h. trocar codigo A->B livre sem forecast -> 400', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado());
    const response = await put(cookies, { dbcorpCode: 'tst9200' });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('não está no Forecast');
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
  });

  it('h. trocar A->B com forecast -> 200; A so perde o vinculo (nunca e apagado)', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado());
    const response = await put(cookies, { dbcorpCode: 'tst9200', forecast: existente });
    expect(response.status).toBe(200);
    expect(response.body.forecastVinculo).toMatchObject({ situacao: 'adicionado' });
    expect(prismaMock.forecastProductCode.updateMany).toHaveBeenCalledWith({
      where: { code: 'TST9100', catalogItemId: 7 },
      data: { catalogItemId: null },
    });
    expect(prismaMock.forecastProductCode.create).toHaveBeenCalledWith({
      data: { productId: 5, position: 1, code: 'TST9200', catalogItemId: 7 },
    });
    const lock = prismaMock.$executeRaw.mock.invocationCallOrder[0];
    expect(lock).toBeLessThan(prismaMock.catalogItem.update.mock.invocationCallOrder[0]);
  });

  it('i. zerar o codigo -> 200, solta o vinculo antigo e nao exige nada', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado());
    const response = await put(cookies, { dbcorpCode: '' });
    expect(response.status).toBe(200);
    expect(prismaMock.forecastProductCode.updateMany).toHaveBeenCalledWith({
      where: { code: 'TST9100', catalogItemId: 7 },
      data: { catalogItemId: null },
    });
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.findUnique).not.toHaveBeenCalled();
  });

  it('j. reativar item com codigo livre sem forecast -> 400; com forecast -> 200', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado({ isActive: false }));
    const sem = await put(cookies, { isActive: true });
    expect(sem.status).toBe(400);
    expect(sem.body.message).toContain('não está no Forecast');

    const com = await put(cookies, { isActive: true, forecast: existente });
    expect(com.status).toBe(200);
    expect(com.body.forecastVinculo.situacao).toBe('adicionado');
  });

  it('j. reativar item cujo codigo ja esta no Forecast -> 200 sem forecast', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado({ isActive: false }));
    prismaMock.forecastProductCode.findUnique.mockResolvedValue({
      id: 31,
      catalogItemId: 7,
      product: { id: 9, name: 'DONO TST', isActive: true, origin: 'dbcorp' },
    });
    const response = await put(cookies, { isActive: true });
    expect(response.status).toBe(200);
    expect(response.body.forecastVinculo.situacao).toBe('ja_no_forecast');
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
  });

  it('forecast em item sem codigo -> 400; forecast com isActive false -> 400', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado({ dbcorpCode: null }));
    const semCodigo = await put(cookies, { forecast: existente });
    expect(semCodigo.status).toBe(400);
    expect(semCodigo.body.message).toBe('Informe o código DBCorp para vincular o item ao Forecast.');

    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado());
    const inativo = await put(cookies, { isActive: false, forecast: existente });
    expect(inativo.status).toBe(400);
    expect(inativo.body.message).toBe('Reative o item para vinculá-lo ao Forecast.');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('DELETE /catalog-items/:id (D1)', () => {
  it('k. inativar item com codigo nao toca em forecastProductCode', async () => {
    const cookies = await loginAs('admin');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado());
    prismaMock.quoteRequestItem.count.mockResolvedValue(0);
    const response = await request(app).delete('/api/v1/catalog-items/7').set('Cookie', cookies);
    expect(response.status).toBe(200);
    for (const fn of Object.values(prismaMock.forecastProductCode)) expect(fn).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('POST /catalog-items/:id/forecast', () => {
  const PATH = '/api/v1/catalog-items/7/forecast';

  it('l. vincula item ativo existente -> 200', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado());
    const response = await request(app).post(PATH).set('Cookie', cookies).send(existente);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ situacao: 'adicionado' });
    expect(prismaMock.forecastProductCode.create).toHaveBeenCalledWith({
      data: { productId: 5, position: 1, code: 'TST9100', catalogItemId: 7 },
    });
  });

  it('l. admin tambem; item inativo, sem codigo, id invalido e item inexistente -> 400/400/400/404', async () => {
    const cookies = await loginAs('admin');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado({ isActive: false }));
    const inativo = await request(app).post(PATH).set('Cookie', cookies).send(existente);
    expect(inativo.status).toBe(400);
    expect(inativo.body.message).toBe('Reative o item para vinculá-lo ao Forecast.');

    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado({ dbcorpCode: null }));
    const semCodigo = await request(app).post(PATH).set('Cookie', cookies).send(existente);
    expect(semCodigo.status).toBe(400);
    expect(semCodigo.body.message).toBe('O item não tem código DBCorp.');

    const idRuim = await request(app).post('/api/v1/catalog-items/abc/forecast').set('Cookie', cookies).send(existente);
    expect(idRuim.status).toBe(400);
    expect(idRuim.body.message).toBe('ID do item invalido.');

    prismaMock.catalogItem.findUnique.mockResolvedValue(null);
    const inexistente = await request(app).post(PATH).set('Cookie', cookies).send(existente);
    expect(inexistente.status).toBe(404);
  });

  it('l. corpo obrigatorio e validado -> 400', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado());
    expect((await request(app).post(PATH).set('Cookie', cookies).send({})).status).toBe(400);
    expect((await request(app).post(PATH).set('Cookie', cookies).send({ modo: 'existente', productId: 0 })).status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('l. viewer e gestor -> 403; sem login -> 401', async () => {
    for (const role of ['viewer', 'gestor'] as Role[]) {
      const cookies = await loginAs(role);
      expect((await request(app).post(PATH).set('Cookie', cookies).send(existente)).status).toBe(403);
    }
    expect((await request(app).post(PATH).send(existente)).status).toBe(401);
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
  });
});

describe('GET /catalog-items/sem-forecast', () => {
  const PATH = '/api/v1/catalog-items/sem-forecast';

  it('m. devolve so itens ativos com codigo normalizado fora do Forecast (nao cai no /:id)', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.catalogItem.findMany.mockResolvedValue([
      { id: 1, commercialName: 'A', marketName: 'A', dbcorpCode: ' tst9001 ', familyId: 2, family: { id: 2, name: 'F' } },
      { id: 2, commercialName: 'B', marketName: 'B', dbcorpCode: 'TST9002', familyId: null, family: null },
      { id: 3, commercialName: 'C', marketName: 'C', dbcorpCode: '   ', familyId: null, family: null },
    ]);
    prismaMock.forecastProductCode.findMany.mockResolvedValue([{ code: 'TST9002' }]);

    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.data.map((i: { id: number }) => i.id)).toEqual([1]);
    expect(prismaMock.catalogItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, dbcorpCode: { not: null } } }),
    );
  });

  it('m. query com parametro extra -> 400; sem login -> 401', async () => {
    const cookies = await loginAs('viewer');
    expect((await request(app).get(`${PATH}?x=1`).set('Cookie', cookies)).status).toBe(400);
    expect((await request(app).get(PATH)).status).toBe(401);
  });
});

// Mutante M18b: tirar `travarImportForecast(tx)` de ForecastProductCadastroService.addCode. O addCode (POST
// /forecast/products/:id/codigos) e o vinculo do catalogo gravam em ForecastProductCode e precisam serializar
// com o import do Forecast (advisory lock `forecast:import`) ANTES de ler o produto e gravar o codigo.
describe('trava advisory forecast:import - addCode e vinculo do catalogo (M18b)', () => {
  const ordemDaLockDoImport = () => {
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), CADASTRO_TX_OPTIONS);
    // Ao menos uma chamada de $executeRaw e a advisory lock do import: pg_advisory_xact_lock com a chave 'forecast:import'.
    const ordens = prismaMock.$executeRaw.mock.calls.flatMap((call, i) => {
      const [sql, ...valores] = call as [readonly string[], ...unknown[]];
      const ehAdvisoryLock = sql.join('').includes('pg_advisory_xact_lock(hashtext(');
      return ehAdvisoryLock && valores.includes('forecast:import') ? [prismaMock.$executeRaw.mock.invocationCallOrder[i]] : [];
    });
    expect(ordens.length).toBeGreaterThanOrEqual(1);
    return ordens[0];
  };

  it('POST /forecast/products/:id/codigos: lock antes de ler o produto e gravar o codigo', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .post('/api/v1/forecast/products/5/codigos')
      .set('Cookie', cookies)
      .send({ codigo: 'TST9300' });

    expect(response.status).toBe(201);
    expect(prismaMock.forecastProductCode.create).toHaveBeenCalledTimes(1);
    const ordemLock = ordemDaLockDoImport();
    expect(ordemLock).toBeLessThan(prismaMock.forecastProduct.findUnique.mock.invocationCallOrder[0]);
    expect(ordemLock).toBeLessThan(prismaMock.forecastProductCode.create.mock.invocationCallOrder[0]);
  });

  it('POST /catalog-items/:id/forecast (existente): lock antes de ler o produto e gravar o codigo', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.catalogItem.findUnique.mockResolvedValue(itemLegado());
    const response = await request(app)
      .post('/api/v1/catalog-items/7/forecast')
      .set('Cookie', cookies)
      .send(existente);

    expect(response.status).toBe(200);
    expect(prismaMock.forecastProductCode.create).toHaveBeenCalledTimes(1);
    const ordemLock = ordemDaLockDoImport();
    expect(ordemLock).toBeLessThan(prismaMock.forecastProduct.findUnique.mock.invocationCallOrder[0]);
    expect(ordemLock).toBeLessThan(prismaMock.forecastProductCode.create.mock.invocationCallOrder[0]);
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

  return loginResponse.headers['set-cookie'] as unknown as string[];
}
