import exceljs from 'exceljs';
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
const runId = `fs${Date.now()}`;

// Datas longe do dado real e dos demais testes de forecast. Tudo SINTETICO (repo publico).
const BASE_DATE = '2035-04-15';
const HOJE = '2035-04-20';
const rotulos = rotulosDaQuinzena(BASE_DATE);

const U = runId.toUpperCase();
const CODE_A1 = `${U}A1`;
const CODE_A2 = `${U}A2`;
const CODE_B1 = `${U}B1`;
const CODE_NOVO = `${U}N1`;
const NAME_A = `PRODUTO ${U} A`;
const NAME_B = `PRODUTO ${U} B`;
const NAME_NOVO = `PRODUTO ${U} NOVO`;
const FONTE = `FONTE ${U}`;
const MOTIVO = `MOTIVO SINTETICO ${U}`;

describe('Forecast - compra sob demanda (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let productA = 0;
  let productB = 0;
  let sourceId = 0;
  let familyId = 0;
  let snapshotId = 0;

  const patch = (productId: number, body: unknown) =>
    request(app)
      .patch(`/api/v1/forecast/products/${productId}/compra-sob-demanda`)
      .set('Cookie', cookies)
      .send(body as object);

  const relatorio = async () => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshotId}/relatorio-compras?hoje=${HOJE}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    return res.body.data as {
      totais: { itens: number };
      fora: { sobDemanda: number };
      grupos: Array<{ itens: Array<{ productId: number | null; item: string }> }>;
      sobDemanda: {
        itens: Array<{ productId: number | null; item: string; motivo: string | null; programacaoDescoberta: number }>;
      };
    };
  };

  const nomesNaLista = (r: Awaited<ReturnType<typeof relatorio>>) => r.grupos.flatMap((g) => g.itens).map((i) => i.item);

  const draft = (name: string, codes: string[], notes: string | null = null): ProductDraft => ({
    name,
    normalizedName: normalizeProductName(name),
    sheetOrder: null,
    sourceKey: null,
    notes,
    fixedPriceFlag: false,
    packaging: null,
    noFractioning: false,
    sampleQty: null,
    sampleRequestNote: null,
    codes: codes.map((code, i) => ({ position: i + 1, code })),
  });

  // Reimportacao da planilha so com os 2 produtos deste teste (o banco pode ter outros).
  const reimportar = async (drafts: ProductDraft[], inativar: number[] = []) => {
    await prisma.$transaction(async (tx) => {
      const plan = await ForecastProductService.plan(tx, drafts, new Set());
      await ForecastProductService.apply(
        tx,
        { ...plan, inativados: plan.inativados.filter((p) => inativar.includes(p.id)) },
        new Map(),
        adminId,
      );
    });
  };

  const produto = (linha: number, item: string, codigo: string, id: number) => ({
    linha,
    n: linha - 2,
    item,
    codigos: [codigo, '', '', '', '', '', ''],
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
    productId: id,
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Sob Demanda ${runId}`,
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
      await prisma.forecastSource.create({ data: { name: FONTE, normalizedName: FONTE, leadTimeDays: 30 } })
    ).id;

    const a = await prisma.forecastProduct.create({
      data: {
        name: NAME_A,
        normalizedName: normalizeProductName(NAME_A),
        codes: { create: [{ position: 1, code: CODE_A1 }, { position: 2, code: CODE_A2 }] },
      },
    });
    productA = a.id;
    const b = await prisma.forecastProduct.create({
      data: {
        name: NAME_B,
        normalizedName: normalizeProductName(NAME_B),
        codes: { create: [{ position: 1, code: CODE_B1 }] },
      },
    });
    productB = b.id;

    // Quinzena sintetica congelada direto no banco: A e B com a mesma demanda (entram na lista de compra); A tem
    // estoque 300 e programacao 800 no 1o mes (programacao descoberta = 500).
    const snapshot = await prisma.forecastSnapshot.create({
      data: {
        label: '04-2',
        baseDate: dateKeyToDbDate(BASE_DATE),
        half: 2,
        origin: 'planilha',
        months: { consumo: rotulos.consumo, chegada: rotulos.chegada, programacao: rotulos.programacao },
        products: [produto(3, NAME_A, CODE_A1, productA), produto(4, NAME_B, CODE_B1, productB)],
        inputs: {
          estoque: [{ codigo: CODE_A1, qtd: 300 }],
          vendasMes: [
            { codigo: CODE_A1, qtd: 400 },
            { codigo: CODE_B1, qtd: 400 },
          ],
          vendasAtual: [
            { codigo: CODE_A1, qtd: 200 },
            { codigo: CODE_B1, qtd: 200 },
          ],
          vendasAnual: [
            { codigo: CODE_A1, qtd: 4800 },
            { codigo: CODE_B1, qtd: 4800 },
          ],
          programacoes: [{ codigo: CODE_A1, qtd: 800, mes: rotulos.programacao[0] }],
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

  testDbSkip('antes de marcar: A e B estao na lista de compra e a secao sob demanda vem vazia', async () => {
    const r = await relatorio();
    expect(nomesNaLista(r)).toEqual(expect.arrayContaining([NAME_A, NAME_B]));
    expect(r.totais.itens).toBe(2);
    expect(r.sobDemanda).toEqual({ itens: [] });
    expect(r.fora.sobDemanda).toBe(0);
    const calc = await request(app).get(`/api/v1/forecast/snapshots/${snapshotId}?hoje=${HOJE}`).set('Cookie', cookies);
    const linhaA = (calc.body.data.linhas as Array<{ productId: number; sobDemanda: boolean; sobDemandaMotivo: string | null }>).find(
      (l) => l.productId === productA,
    )!;
    expect(linhaA).toMatchObject({ sobDemanda: false, sobDemandaMotivo: null });
  });

  testDbSkip('marcar A: grava, o relatorio tira A da lista com o motivo e a programacao descoberta; B continua; snapshot intocado; 1 AuditLog sem o motivo', async () => {
    const antes = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    const res = await patch(productA, { sobDemanda: true, motivo: MOTIVO });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ productId: productA, sobDemanda: true, motivo: MOTIVO });
    const gravado = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productA } });
    expect(gravado.purchaseOnDemand).toBe(true);
    expect(gravado.purchaseOnDemandNote).toBe(MOTIVO);

    const r = await relatorio();
    expect(nomesNaLista(r)).toEqual([NAME_B]);
    expect(r.totais.itens).toBe(1);
    expect(r.fora.sobDemanda).toBe(1);
    expect(r.sobDemanda.itens).toHaveLength(1);
    expect(r.sobDemanda.itens[0]).toMatchObject({
      productId: productA,
      item: NAME_A,
      motivo: MOTIVO,
      programacaoDescoberta: 500,
    });

    const calc = await request(app).get(`/api/v1/forecast/snapshots/${snapshotId}?hoje=${HOJE}`).set('Cookie', cookies);
    const linhas = calc.body.data.linhas as Array<{ productId: number; sobDemanda: boolean; sobDemandaMotivo: string | null }>;
    expect(linhas.find((l) => l.productId === productA)).toMatchObject({ sobDemanda: true, sobDemandaMotivo: MOTIVO });
    expect(linhas.find((l) => l.productId === productB)).toMatchObject({ sobDemanda: false, sobDemandaMotivo: null });

    const depois = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    expect({ products: depois.products, inputs: depois.inputs, months: depois.months }).toEqual({
      products: antes.products,
      inputs: antes.inputs,
      months: antes.months,
    });

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'forecast_product', entityId: String(productA), action: 'purchase_on_demand_update' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].performedById).toBe(adminId);
    expect(logs[0].metadata).toEqual({ antes: false, depois: true, comMotivo: true });
    expect(JSON.stringify(logs[0])).not.toContain(MOTIVO);
    expect(JSON.stringify(logs[0])).not.toContain(NAME_A);
  });

  testDbSkip('o XLSX do relatorio ganha a aba "Sob demanda" com o item e o motivo', async () => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshotId}/relatorio-compras/xlsx?hoje=${HOJE}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    const wb = new exceljs.Workbook();
    await wb.xlsx.load(Buffer.from(res.body.data.contentBase64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Sob demanda')!;
    expect(ws).toBeTruthy();
    expect(String(ws.getRow(2).getCell(1).value)).toBe(NAME_A);
    expect(String(ws.getRow(2).getCell(5).value)).toBe(`Compra sob programação do cliente: ${MOTIVO}`);
  });

  testDbSkip('reimportar a planilha (produto alterado) PRESERVA a marca e o motivo', async () => {
    await reimportar([draft(NAME_A, [CODE_A1, CODE_A2], `NOTA ${U}`), draft(NAME_B, [CODE_B1])]);
    const a = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productA } });
    expect(a.id).toBe(productA); // o produto nao e apagado/recriado
    expect(a.notes).toBe(`NOTA ${U}`); // a reimportacao de fato gravou o produto
    expect(a.purchaseOnDemand).toBe(true);
    expect(a.purchaseOnDemandNote).toBe(MOTIVO);
    const r = await relatorio();
    expect(r.sobDemanda.itens.map((i) => i.item)).toEqual([NAME_A]);
  });

  testDbSkip('reimportar com os codigos reordenados (codigos apagados e recriados) tambem preserva a marca', async () => {
    await reimportar([draft(NAME_A, [CODE_A2, CODE_A1]), draft(NAME_B, [CODE_B1])]);
    const a = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productA }, include: { codes: true } });
    expect(a.codes.map((c) => c.code).sort()).toEqual([CODE_A1, CODE_A2].sort());
    expect(a.purchaseOnDemand).toBe(true);
    expect(a.purchaseOnDemandNote).toBe(MOTIVO);
  });

  testDbSkip('produto ausente da reimportacao e inativado, mas a marca fica; ao voltar ativo a marca continua', async () => {
    await reimportar([draft(NAME_B, [CODE_B1])], [productA]);
    const inativo = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productA } });
    expect(inativo.isActive).toBe(false);
    expect(inativo.purchaseOnDemand).toBe(true);
    expect(inativo.purchaseOnDemandNote).toBe(MOTIVO);

    await reimportar([draft(NAME_A, [CODE_A1, CODE_A2]), draft(NAME_B, [CODE_B1])]);
    const volta = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productA } });
    expect(volta.isActive).toBe(true);
    expect(volta.purchaseOnDemand).toBe(true);
    expect(volta.purchaseOnDemandNote).toBe(MOTIVO);
  });

  testDbSkip('produto criado pela tela (POST /forecast/products) nasce sem a marca e nao mexe na dos outros', async () => {
    const res = await request(app)
      .post('/api/v1/forecast/products')
      .set('Cookie', cookies)
      .send({ nome: NAME_NOVO, codigos: [CODE_NOVO], sourceId, familyId });
    expect(res.status).toBe(201);
    const novo = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(novo.purchaseOnDemand).toBe(false);
    expect(novo.purchaseOnDemandNote).toBeNull();
    const a = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productA } });
    expect(a.purchaseOnDemand).toBe(true);
    // O produto da tela tambem pode ser marcado depois.
    expect((await patch(novo.id, { sobDemanda: true })).status).toBe(200);
    const marcado = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: novo.id } });
    expect(marcado.purchaseOnDemand).toBe(true);
    expect(marcado.purchaseOnDemandNote).toBeNull();
  });

  testDbSkip('desmarcar A limpa o motivo e A volta para a lista de compra; sem alteracao nao audita de novo', async () => {
    const res = await patch(productA, { sobDemanda: false, motivo: 'IGNORADO' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ productId: productA, sobDemanda: false, motivo: null });
    const a = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productA } });
    expect(a.purchaseOnDemand).toBe(false);
    expect(a.purchaseOnDemandNote).toBeNull();
    const r = await relatorio();
    expect(nomesNaLista(r)).toEqual(expect.arrayContaining([NAME_A, NAME_B]));
    expect(r.sobDemanda).toEqual({ itens: [] });

    const logsAntes = await prisma.auditLog.count({ where: { entityType: 'forecast_product', entityId: String(productA), action: 'purchase_on_demand_update' } });
    expect((await patch(productA, { sobDemanda: false })).status).toBe(200);
    const logsDepois = await prisma.auditLog.count({ where: { entityType: 'forecast_product', entityId: String(productA), action: 'purchase_on_demand_update' } });
    expect(logsDepois).toBe(logsAntes);
  });

  testDbSkip('produto inexistente -> 404 e Zod invalido -> 400, sem gravar', async () => {
    expect((await patch(2147483000, { sobDemanda: true })).status).toBe(404);
    const curto = await patch(productB, { sobDemanda: true, motivo: 'ab' });
    expect(curto.status).toBe(400);
    const b = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productB } });
    expect(b.purchaseOnDemand).toBe(false);
  });
});
