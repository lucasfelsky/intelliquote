import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastProductService } from '../src/services/ForecastProductService';
import { codigosPendentes } from '../src/utils/forecastPendentes';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `cf${Date.now()}`;
const U = runId.toUpperCase();

// Tudo SINTETICO (repo publico): codigos e nomes derivados do runId.
const CODE_LIVRE_A = `${U}A1`; // item novo + produto existente
const CODE_LIVRE_B = `${U}B1`; // rollback: produto cheio
const CODE_LIVRE_C = `${U}C1`; // rollback: codigo de outro produto
const CODE_LIVRE_N = `${U}N1`; // produto novo
const CODE_TROCA_1 = `${U}T1`;
const CODE_TROCA_2 = `${U}T2`;
const CODE_DONO = `${U}D1`;
const CODE_INATIVO = `${U}I1`;
const NAME_BASE = `PRODUTO ${U} BASE`;
const NAME_CHEIO = `PRODUTO ${U} CHEIO`;
const NAME_DONO = `PRODUTO ${U} DONO`;
const NAME_INATIVO = `PRODUTO ${U} INATIVO`;
const NAME_NOVO = `PRODUTO ${U} NOVO`;
const SOURCE_NAME = `FONTE ${U} 1`;

describe('Catalogo -> Forecast: vinculo na transacao (DB)', () => {
  let cookies: string[] = [];
  let adminId: number;
  let familyId: number;
  let sourceId: number;
  let baseProductId: number;
  let cheioProductId: number;
  let donoProductId: number;

  const post = (path: string, body: unknown) => request(app).post(path).set('Cookie', cookies).send(body as object);
  const put = (path: string, body: unknown) => request(app).put(path).set('Cookie', cookies).send(body as object);
  const existente = (productId: number) => ({ modo: 'existente', productId });
  const corpo = (n: string, code: string, extra: Record<string, unknown> = {}) => ({
    commercialName: `Item ${runId} ${n}`,
    marketName: `ITEM ${U} ${n}`,
    dbcorpCode: code,
    ...extra,
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Catalogo Forecast ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    familyId = (await prisma.itemFamily.create({ data: { name: `Familia ${runId}` } })).id;
    sourceId = (
      await prisma.forecastSource.create({ data: { name: SOURCE_NAME, normalizedName: SOURCE_NAME, leadTimeDays: 30 } })
    ).id;
    baseProductId = (
      await prisma.forecastProduct.create({
        data: { name: NAME_BASE, normalizedName: NAME_BASE, sheetOrder: null, sourceId, origin: 'dbcorp' },
      })
    ).id;
    cheioProductId = (
      await prisma.forecastProduct.create({
        data: {
          name: NAME_CHEIO,
          normalizedName: NAME_CHEIO,
          sheetOrder: null,
          sourceId,
          origin: 'dbcorp',
          codes: { create: [1, 2, 3, 4, 5, 6, 7].map((position) => ({ position, code: `${U}CH${position}` })) },
        },
      })
    ).id;
    donoProductId = (
      await prisma.forecastProduct.create({
        data: {
          name: NAME_DONO,
          normalizedName: NAME_DONO,
          sheetOrder: null,
          sourceId,
          origin: 'dbcorp',
          codes: { create: [{ position: 1, code: CODE_DONO }] },
        },
      })
    ).id;
    await prisma.forecastProduct.create({
      data: {
        name: NAME_INATIVO,
        normalizedName: NAME_INATIVO,
        sheetOrder: null,
        isActive: false,
        origin: 'dbcorp',
        codes: { create: [{ position: 1, code: CODE_INATIVO }] },
      },
    });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.catalogItem.deleteMany({ where: { marketName: { contains: U } } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: U } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: U } } });
    await prisma.itemFamily.deleteMany({ where: { name: { contains: runId } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('a. item ativo com codigo livre + produto existente: codigo ligado ao item e fora dos pendentes', async () => {
    const entradas = {
      estoque: [],
      vendasMes: [{ codigo: CODE_LIVRE_A, qtd: 40 }],
      vendasAtual: [],
      vendasAnual: [],
      programacoes: [],
      chegadas: [],
    };
    const vendas = { meses: [], anteriores: new Map<string, number>(), ausentes: [] };
    const antes = codigosPendentes(entradas, await ForecastProductService.cadastroDeCodigos(), vendas);
    expect(antes.itens.map((i) => i.codigo)).toContain(CODE_LIVRE_A);

    const res = await post('/api/v1/catalog-items', corpo('A', CODE_LIVRE_A.toLowerCase(), { forecast: existente(baseProductId) }));
    expect(res.status).toBe(201);
    expect(res.body.forecastVinculo).toMatchObject({ situacao: 'adicionado', produto: { id: baseProductId } });

    const row = await prisma.forecastProductCode.findUnique({ where: { code: CODE_LIVRE_A } });
    expect(row).toMatchObject({ productId: baseProductId, position: 1, catalogItemId: res.body.id });

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'forecast_product', action: 'code_add', entityId: String(baseProductId) },
    });
    expect(audit?.metadata).toMatchObject({ source: 'catalogo', codeId: row?.id, catalogItemId: res.body.id });

    const cadastro = await ForecastProductService.cadastroDeCodigos();
    expect(cadastro.ativos.has(CODE_LIVRE_A)).toBe(true);
    const depois = codigosPendentes(entradas, cadastro, vendas);
    expect(depois.itens.map((i) => i.codigo)).not.toContain(CODE_LIVRE_A);
  });

  testDbSkip('b. ROLLBACK real: falha no vinculo nao deixa item orfao', async () => {
    const cheio = await post('/api/v1/catalog-items', corpo('B', CODE_LIVRE_B, { forecast: existente(cheioProductId) }));
    expect(cheio.status).toBe(400);
    expect(cheio.body.message).toBe('O produto já tem 7 códigos.');
    expect(await prisma.catalogItem.count({ where: { marketName: `ITEM ${U} B` } })).toBe(0);
    expect(await prisma.forecastProductCode.count({ where: { code: CODE_LIVRE_B } })).toBe(0);

    const dono = await post('/api/v1/catalog-items', corpo('C', CODE_DONO, { forecast: existente(baseProductId) }));
    expect(dono.status).toBe(409);
    expect(dono.body.message).toContain('já pertence ao produto');
    expect(await prisma.catalogItem.count({ where: { marketName: `ITEM ${U} C` } })).toBe(0);

    const semEscolha = await post('/api/v1/catalog-items', corpo('D', CODE_LIVRE_C));
    expect(semEscolha.status).toBe(400);
    expect(semEscolha.body.message).toContain('não está no Forecast');
    expect(await prisma.catalogItem.count({ where: { marketName: `ITEM ${U} D` } })).toBe(0);

    // Codigo ja no Forecast (do dono): salva sem escolher e liga o item ao codigo sem dono de catalogo.
    const jaNoForecast = await post('/api/v1/catalog-items', corpo('E', CODE_DONO));
    expect(jaNoForecast.status).toBe(201);
    expect(jaNoForecast.body.forecastVinculo).toMatchObject({ situacao: 'ja_no_forecast', produto: { id: donoProductId } });
    const dono2 = await prisma.forecastProductCode.findUnique({ where: { code: CODE_DONO } });
    expect(dono2?.catalogItemId).toBe(jaNoForecast.body.id);
  });

  testDbSkip('c. produto novo: origin dbcorp, codigo na posicao 1 ligado ao item', async () => {
    const res = await post(
      '/api/v1/catalog-items',
      corpo('N', CODE_LIVRE_N, { forecast: { modo: 'novo', nome: NAME_NOVO, sourceId, familyId } }),
    );
    expect(res.status).toBe(201);
    expect(res.body.forecastVinculo.situacao).toBe('produto_novo');
    const produto = await prisma.forecastProduct.findUnique({
      where: { normalizedName: NAME_NOVO },
      include: { codes: true },
    });
    expect(produto).toMatchObject({ origin: 'dbcorp', isActive: true, sourceId, familyId });
    expect(produto?.codes).toEqual([expect.objectContaining({ position: 1, code: CODE_LIVRE_N, catalogItemId: res.body.id })]);
  });

  testDbSkip('d. trocar o codigo A->B: A continua no Forecast sem vinculo; B fica ligado', async () => {
    const criado = await post('/api/v1/catalog-items', corpo('T', CODE_TROCA_1, { forecast: existente(baseProductId) }));
    expect(criado.status).toBe(201);
    const id = criado.body.id as number;

    const semEscolha = await put(`/api/v1/catalog-items/${id}`, { dbcorpCode: CODE_TROCA_2 });
    expect(semEscolha.status).toBe(400);
    expect((await prisma.catalogItem.findUniqueOrThrow({ where: { id } })).dbcorpCode).toBe(CODE_TROCA_1);

    const trocou = await put(`/api/v1/catalog-items/${id}`, { dbcorpCode: CODE_TROCA_2, forecast: existente(baseProductId) });
    expect(trocou.status).toBe(200);
    const antigo = await prisma.forecastProductCode.findUnique({ where: { code: CODE_TROCA_1 } });
    const novo = await prisma.forecastProductCode.findUnique({ where: { code: CODE_TROCA_2 } });
    expect(antigo).toMatchObject({ productId: baseProductId, catalogItemId: null });
    expect(novo).toMatchObject({ productId: baseProductId, catalogItemId: id });
  });

  testDbSkip('e. GET sem-forecast: so itens ativos com codigo fora do Forecast (produto inativo conta como dentro)', async () => {
    const livre = await prisma.catalogItem.create({
      data: { commercialName: `Item ${runId} S1`, marketName: `ITEM ${U} S1`, dbcorpCode: ` ${U.toLowerCase()}s1 ` },
    });
    const inativo = await prisma.catalogItem.create({
      data: { commercialName: `Item ${runId} S2`, marketName: `ITEM ${U} S2`, dbcorpCode: `${U}S2`, isActive: false },
    });
    const noInativo = await prisma.catalogItem.create({
      data: { commercialName: `Item ${runId} S3`, marketName: `ITEM ${U} S3`, dbcorpCode: CODE_INATIVO },
    });

    const res = await request(app).get('/api/v1/catalog-items/sem-forecast').set('Cookie', cookies);
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: number }>).map((i) => i.id);
    expect(ids).toContain(livre.id);
    expect(ids).not.toContain(inativo.id);
    expect(ids).not.toContain(noInativo.id);
    expect(res.body.total).toBe(ids.length);

    // Vincular o item livre pela rota nova tira ele da lista.
    const vinculado = await post(`/api/v1/catalog-items/${livre.id}/forecast`, existente(baseProductId));
    expect(vinculado.status).toBe(200);
    expect(vinculado.body.data.situacao).toBe('adicionado');
    const depois = await request(app).get('/api/v1/catalog-items/sem-forecast').set('Cookie', cookies);
    expect((depois.body.data as Array<{ id: number }>).map((i) => i.id)).not.toContain(livre.id);
    expect(await prisma.forecastProductCode.findUnique({ where: { code: `${U}S1` } })).toMatchObject({
      catalogItemId: livre.id,
    });
  });
});
