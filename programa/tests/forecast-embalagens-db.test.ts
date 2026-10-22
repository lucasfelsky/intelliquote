import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastProductService, type ProductDraft } from '../src/services/ForecastProductService';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fc${Date.now()}`;

// Datas longe do dado real.
const BASE_DATE = '2031-03-15';
const HOJE = '2031-03-20';
const rotulos = rotulosDaQuinzena(BASE_DATE);

const CODE_A1 = `${runId}A1`.toUpperCase();
const CODE_A2 = `${runId}A2`.toUpperCase();
const CODE_A3 = `${runId}A3`.toUpperCase();
const CODE_A4 = `${runId}A4`.toUpperCase();
const CODE_B1 = `${runId}B1`.toUpperCase();
const CODE_B2 = `${runId}B2`.toUpperCase();
const NAME_A = `PRODUTO ${runId} A`.toUpperCase();
const NAME_B = `PRODUTO ${runId} B`.toUpperCase();
const NAME_C = `PRODUTO ${runId} C`.toUpperCase();
const FONTE = `FONTE ${runId}`.toUpperCase();
const ROTULO = `ROTULO-${runId}`;

describe('Forecast - embalagens por codigo (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let productA = 0;
  let productB = 0;
  let snapshotId = 0;
  const ids: Record<string, number> = {};

  const patch = (productId: number, body: unknown) =>
    request(app)
      .patch(`/api/v1/forecast/products/${productId}/embalagens`)
      .set('Cookie', cookies)
      .send(body as object);

  const relatorio = async () => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshotId}/relatorio-compras?hoje=${HOJE}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    type Item = {
      productId: number | null;
      quantidadeFinal: number;
      embalagem: { usada: { codigo: string; quantidade: number } | null };
    };
    const itens = (res.body.data.grupos as Array<{ itens: Item[] }>).flatMap((g) => g.itens);
    expect(itens).toHaveLength(1);
    return itens[0];
  };

  const lerSnapshot = async () => {
    const s = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    return { products: s.products, inputs: s.inputs, months: s.months, expected: s.expected };
  };

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Embalagens ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    const a = await prisma.forecastProduct.create({
      data: {
        name: NAME_A,
        normalizedName: normalizeProductName(NAME_A),
        codes: {
          create: [
            { position: 1, code: CODE_A1 },
            { position: 2, code: CODE_A2 },
            { position: 3, code: CODE_A3 },
          ],
        },
      },
      include: { codes: true },
    });
    productA = a.id;
    for (const c of a.codes) ids[c.code] = c.id;
    const b = await prisma.forecastProduct.create({
      data: {
        name: NAME_B,
        normalizedName: normalizeProductName(NAME_B),
        codes: {
          create: [
            { position: 1, code: CODE_B1 },
            { position: 2, code: CODE_B2 },
          ],
        },
      },
      include: { codes: true },
    });
    productB = b.id;
    for (const c of b.codes) ids[c.code] = c.id;

    // Quinzena sintetica congelada direto no banco: 1 item com demanda < 0 e lead time de 30 dias.
    const produto = {
      linha: 3,
      n: 1,
      item: NAME_A,
      codigos: [CODE_A1, CODE_A2, CODE_A3, '', '', '', ''],
      historico: [10, 20, 30, 40, 50],
      analiseForecast: null,
      obs: '',
      fonte: FONTE,
      precoFechado: '',
      embalagem: '',
      naoFraciona: '',
      qtdAmostra: '',
      solicitarAmostra: '',
      status: 'nao',
      productId: productA,
    };
    const snapshot = await prisma.forecastSnapshot.create({
      data: {
        label: '03-2',
        baseDate: dateKeyToDbDate(BASE_DATE),
        half: 2,
        origin: 'planilha',
        months: { consumo: rotulos.consumo, chegada: rotulos.chegada, programacao: rotulos.programacao },
        products: [produto],
        inputs: {
          estoque: [],
          vendasMes: [{ codigo: CODE_A1, qtd: 400 }],
          vendasAtual: [{ codigo: CODE_A1, qtd: 200 }],
          vendasAnual: [{ codigo: CODE_A1, qtd: 4800 }],
          programacoes: [],
          chegadas: [],
          leadtime: [{ fonte: FONTE, total: 30 }],
          margem: [],
          clientesAtivos: [],
        },
        files: [],
        createdById: adminId,
      },
    });
    snapshotId = snapshot.id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: runId.toUpperCase() } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('relatorio antes: item sem embalagem e com o productId do produto', async () => {
    const item = await relatorio();
    expect(item.productId).toBe(productA);
    expect(item.embalagem.usada).toBeNull();
  });

  testDbSkip('PATCH A1=25, A2=200 e principal A2: relatorio arredonda por 200, snapshot intocado, 1 AuditLog sem valores', async () => {
    const antes = await lerSnapshot();
    const res = await patch(productA, {
      embalagens: [
        { codigoId: ids[CODE_A1], quantidadeKg: 25 },
        { codigoId: ids[CODE_A2], quantidadeKg: 200, rotulo: ROTULO },
      ],
      principalCodigoId: ids[CODE_A2],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.usadaCodigoId).toBe(ids[CODE_A2]);
    expect(res.body.data.codigos[1]).toMatchObject({ quantidadeKg: 200, rotulo: ROTULO, principal: true, origem: 'manual' });
    expect(res.body.data.codigos[1].atualizadoEm).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const item = await relatorio();
    expect(item.embalagem.usada).toMatchObject({ codigo: CODE_A2, quantidade: 200 });
    expect(item.quantidadeFinal % 200).toBe(0);
    expect(item.quantidadeFinal).toBeGreaterThan(0);

    expect(await lerSnapshot()).toEqual(antes);

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'forecast_product', entityId: String(productA), action: 'packaging_update' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].performedById).toBe(adminId);
    expect(logs[0].beforeData).toBeNull();
    expect(logs[0].afterData).toBeNull();
    const texto = JSON.stringify(logs[0]);
    expect(texto).not.toContain(ROTULO);
    expect(logs[0].metadata).toMatchObject({
      source: 'manual_patch',
      comEmbalagem: 2,
      semEmbalagem: 1,
      principalAntes: null,
      principalDepois: ids[CODE_A2],
    });
  });

  testDbSkip('trocar a principal para A1 deixa exatamente uma principal no produto', async () => {
    const res = await patch(productA, { principalCodigoId: ids[CODE_A1] });
    expect(res.status).toBe(200);
    expect(await prisma.forecastProductCode.count({ where: { productId: productA, packagingIsPrimary: true } })).toBe(1);
    const principal = await prisma.forecastProductCode.findFirstOrThrow({
      where: { productId: productA, packagingIsPrimary: true },
    });
    expect(principal.code).toBe(CODE_A1);
    const item = await relatorio();
    expect(item.embalagem.usada).toMatchObject({ codigo: CODE_A1, quantidade: 25 });
  });

  testDbSkip('o indice parcial existe e o banco recusa duas principais no mesmo produto (P2002)', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>(
      Prisma.sql`SELECT indexname FROM pg_indexes WHERE indexname = 'ForecastProductCode_single_primary_packaging_per_product'`,
    );
    expect(rows).toHaveLength(1);
    await expect(
      prisma.forecastProductCode.update({ where: { id: ids[CODE_A2] }, data: { packagingIsPrimary: true } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  testDbSkip('codigoId de outro produto -> 400 e nada gravado', async () => {
    const antes = await prisma.forecastProductCode.findMany({ where: { productId: productA }, orderBy: { id: 'asc' } });
    const res = await patch(productA, { embalagens: [{ codigoId: ids[CODE_B1], quantidadeKg: 99 }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('O codigo informado nao pertence a este produto.');
    const depois = await prisma.forecastProductCode.findMany({ where: { productId: productA }, orderBy: { id: 'asc' } });
    expect(depois).toEqual(antes);
    const b1 = await prisma.forecastProductCode.findUniqueOrThrow({ where: { id: ids[CODE_B1] } });
    expect(b1.packagingQtyKg).toBeNull();
  });

  testDbSkip('o import da planilha preserva a embalagem por codigo (principal so no mesmo produto)', async () => {
    // Estado de partida: A1 principal 25 kg, A2 200 kg (produto A); B2 principal 10 kg (produto B).
    expect((await patch(productA, { principalCodigoId: ids[CODE_A1] })).status).toBe(200);
    expect(
      (
        await patch(productB, {
          embalagens: [{ codigoId: ids[CODE_B2], quantidadeKg: 10, rotulo: 'Balde' }],
          principalCodigoId: ids[CODE_B2],
        })
      ).status,
    ).toBe(200);

    const draft = (name: string, codes: string[]): ProductDraft => ({
      name,
      normalizedName: normalizeProductName(name),
      sheetOrder: null,
      sourceKey: null,
      notes: null,
      fixedPriceFlag: false,
      packaging: null,
      noFractioning: false,
      sampleQty: null,
      sampleRequestNote: null,
      codes: codes.map((code, i) => ({ position: i + 1, code })),
    });
    // A acrescenta A4 e perde A2 (que vai para o produto novo C); B perde B2 (que tambem vai para C).
    const drafts = [
      draft(NAME_A, [CODE_A1, CODE_A3, CODE_A4]),
      draft(NAME_B, [CODE_B1]),
      draft(NAME_C, [CODE_A2, CODE_B2]),
    ];

    await prisma.$transaction(async (tx) => {
      const plan = await ForecastProductService.plan(tx, drafts, new Set());
      // O banco de teste pode ter outros produtos: so os 3 deste teste entram no apply.
      await ForecastProductService.apply(tx, { ...plan, inativados: [] }, new Map(), adminId);
    });

    const a1 = await prisma.forecastProductCode.findUniqueOrThrow({ where: { code: CODE_A1 } });
    expect(a1.productId).toBe(productA);
    expect(Number(a1.packagingQtyKg)).toBe(25);
    expect(a1.packagingIsPrimary).toBe(true);
    expect(a1.packagingSource).toBe('manual');
    expect(a1.packagingUpdatedAt).toBeInstanceOf(Date);

    const a4 = await prisma.forecastProductCode.findUniqueOrThrow({ where: { code: CODE_A4 } });
    expect(a4.packagingQtyKg).toBeNull();
    expect(a4.packagingIsPrimary).toBe(false);

    const a2 = await prisma.forecastProductCode.findUniqueOrThrow({ where: { code: CODE_A2 } });
    expect(a2.productId).not.toBe(productA);
    expect(Number(a2.packagingQtyKg)).toBe(200);
    expect(a2.packagingLabel).toBe(ROTULO);
    expect(a2.packagingIsPrimary).toBe(false);

    const b2 = await prisma.forecastProductCode.findUniqueOrThrow({ where: { code: CODE_B2 } });
    expect(b2.productId).toBe(a2.productId);
    expect(Number(b2.packagingQtyKg)).toBe(10);
    expect(b2.packagingLabel).toBe('Balde');
    expect(b2.packagingIsPrimary).toBe(false);

    expect(await prisma.forecastProductCode.count({ where: { productId: a2.productId, packagingIsPrimary: true } })).toBe(0);
    expect(await prisma.forecastProductCode.count({ where: { productId: productA, packagingIsPrimary: true } })).toBe(1);
  });
});
