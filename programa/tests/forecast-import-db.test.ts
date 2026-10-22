import exceljs from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { FORECAST_SHEETS } from '../src/constants/forecast';
import { calcular, valorDaColuna } from '../src/utils/forecastEngine';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import type { Produto, Quinzena } from '../src/utils/forecastTypes';
import { COLUNAS_CONFERIDAS } from '../src/utils/forecastTypes';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fc${Date.now()}`;

// Datas longe do dado real: a importacao do historico substitui o mes inteiro.
const BASE_DATE = '2031-03-15';
const YEAR_MONTH = '2031-02'; // base-1
const HOJE = '2031-03-20';
const rotulos = rotulosDaQuinzena(BASE_DATE);

const CODE_A1 = `${runId}A1`.toUpperCase();
const CODE_A2 = `${runId}A2`.toUpperCase();
const CODE_B1 = `${runId}B1`.toUpperCase();
const SOURCE_1 = `FONTE ${runId} 1`.toUpperCase();
const SOURCE_2 = `FONTE ${runId} 2`.toUpperCase();
const NAME_A = `PRODUTO ${runId} A`.toUpperCase();
const NAME_B = `PRODUTO ${runId} B`.toUpperCase();

function produto(linha: number, item: string, codigos: string[], fonte: string): Produto {
  return {
    linha,
    n: linha - 2,
    item,
    codigos: [...codigos, ...Array(7 - codigos.length).fill('')],
    historico: [10, 20, 30, 40, 50],
    analiseForecast: null,
    obs: 'obs de teste',
    fonte,
    precoFechado: 'X',
    embalagem: '25 kg',
    naoFraciona: '',
    qtdAmostra: '',
    solicitarAmostra: '',
    status: 'nao',
  };
}

function quinzena(options: { produtos: Produto[]; vendasMes: Array<[string, number]>; label?: string }): Quinzena {
  const q: Quinzena = {
    id: options.label ?? '03-1',
    arquivo: 'sintetica.xlsx',
    dataBase: BASE_DATE,
    mesesConsumo: rotulos.consumo,
    mesesChegada: rotulos.chegada,
    mesesProgramacao: rotulos.programacao,
    produtos: options.produtos,
    entradas: {
      estoque: [{ codigo: CODE_A1, qtd: 100 }],
      vendasMes: options.vendasMes.map(([codigo, qtd]) => ({ codigo, qtd })),
      vendasAtual: [{ codigo: CODE_A1, qtd: 15 }],
      vendasAnual: [{ codigo: CODE_A1, qtd: 660 }],
      programacoes: [{ codigo: CODE_A1, qtd: 100, mes: rotulos.programacao[0] }],
      chegadas: [{ codigo: CODE_A1, qtd: 500, mes: rotulos.chegada[0] }],
      leadtime: [
        { fonte: SOURCE_1, total: 30 },
        { fonte: SOURCE_2, total: 45 },
      ],
      margem: [{ codigo: CODE_A1, margem: 0.25 }],
      clientesAtivos: [CODE_A1, CODE_A1, CODE_B1],
    },
    esperado: {},
  };
  // O "Excel" desta planilha sintetica e o proprio motor (o que se prova aqui e o encanamento).
  const linhas = calcular(q, { hoje: HOJE, quinzena: 2, somarChegada5oMes: false });
  for (const l of linhas) {
    q.esperado[String(l.linha)] = Object.fromEntries(COLUNAS_CONFERIDAS.map((c) => [c, valorDaColuna(l, c)]));
  }
  return q;
}

const LEADTIME_COMPONENTS: Record<string, number[]> = {
  [SOURCE_1]: [10, 5, 5, 5, 5],
  [SOURCE_2]: [15, 10, 10, 5, 5],
};

async function workbookBase64(q: Quinzena): Promise<string> {
  const wb = new exceljs.Workbook();
  const sheets = Object.fromEntries(
    Object.entries(FORECAST_SHEETS).map(([key, name]) => [key, wb.addWorksheet(name)]),
  ) as Record<keyof typeof FORECAST_SHEETS, exceljs.Worksheet>;

  const macro = sheets.macro;
  ['J', 'K', 'L', 'M', 'N', 'O', 'P'].forEach((c, i) => (macro.getCell(`${c}2`).value = q.mesesConsumo[i]));
  ['V', 'W', 'X', 'Y', 'Z'].forEach((c, i) => (macro.getCell(`${c}2`).value = q.mesesChegada[i]));
  ['AC', 'AD', 'AE', 'AF'].forEach((c, i) => (macro.getCell(`${c}2`).value = q.mesesProgramacao[i]));
  for (const p of q.produtos) {
    const r = p.linha;
    macro.getCell(`A${r}`).value = p.n;
    ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((c, i) => {
      if (p.codigos[i]) macro.getCell(`${c}${r}`).value = p.codigos[i];
    });
    macro.getCell(`I${r}`).value = p.item;
    ['J', 'K', 'L', 'M', 'N'].forEach((c, i) => (macro.getCell(`${c}${r}`).value = p.historico[i]));
    macro.getCell(`AT${r}`).value = p.obs;
    macro.getCell(`AU${r}`).value = p.fonte;
    macro.getCell(`AV${r}`).value = p.precoFechado;
    macro.getCell(`AW${r}`).value = p.embalagem;
    for (const col of COLUNAS_CONFERIDAS) {
      const value = q.esperado[String(r)][col];
      if (value !== null && value !== '') macro.getCell(`${col}${r}`).value = { formula: '1+0', result: value };
    }
  }

  const e = q.entradas;
  const put = (ws: exceljs.Worksheet, start: number, cols: string[], rows: Array<Array<string | number>>) =>
    rows.forEach((row, i) => cols.forEach((c, k) => (ws.getCell(`${c}${start + i}`).value = row[k])));
  put(sheets.estoque, 7, ['A', 'E'], e.estoque.map((l) => [l.codigo, l.qtd]));
  put(sheets.vendasMes, 6, ['B', 'D'], e.vendasMes.map((l) => [l.codigo, l.qtd]));
  put(sheets.vendasAtual, 6, ['B', 'D'], e.vendasAtual.map((l) => [l.codigo, l.qtd]));
  put(sheets.vendasAnual, 6, ['B', 'D'], e.vendasAnual.map((l) => [l.codigo, l.qtd]));
  put(sheets.programacoes, 7, ['A', 'D', 'I'], e.programacoes.map((l) => [l.codigo, l.qtd, l.mes]));
  put(sheets.chegadas, 2, ['E', 'L', 'Z'], e.chegadas.map((l) => [l.codigo, l.qtd, l.mes]));
  put(sheets.leadtime, 3, ['A', 'B', 'C', 'D', 'E', 'F'], e.leadtime.map((l) => [l.fonte, ...LEADTIME_COMPONENTS[l.fonte]]));
  e.leadtime.forEach((l, i) => {
    sheets.leadtime.getCell(`G${3 + i}`).value = { formula: `SUM(B${3 + i}:F${3 + i})`, result: l.total ?? 0 };
  });
  put(sheets.margem, 2, ['A', 'B'], e.margem.map((m) => [m.codigo, m.margem ?? 0]));
  put(sheets.clientesAtivos, 6, ['C'], e.clientesAtivos.map((c) => [c]));

  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

describe('Forecast - importacao da planilha (DB)', () => {
  let cookies: string[] = [];
  let adminId: number;
  let familyId: number;
  let catalogItemId: number;
  let supplierId: number;
  let snapshotId: number;

  const qCompleta = quinzena({
    produtos: [
      produto(3, NAME_A, [CODE_A1, CODE_A2], SOURCE_1),
      produto(4, NAME_B, [CODE_B1], SOURCE_2),
    ],
    vendasMes: [
      [CODE_A1, 40],
      [CODE_A1, 20],
      [CODE_A2, 30],
      [CODE_B1, 90],
    ],
  });

  const post = (path: string, body: unknown) =>
    request(app).post(`/api/v1/forecast/import/workbook/${path}`).set('Cookie', cookies).send(body as object);

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Import ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    const family = await prisma.itemFamily.create({ data: { name: `Familia ${runId}` } });
    familyId = family.id;
    // dbcorpCode em minusculas: o vinculo e case-insensitive.
    const item = await prisma.catalogItem.create({
      data: {
        commercialName: `Item ${runId}`,
        marketName: `Item mercado ${runId}`,
        dbcorpCode: CODE_A1.toLowerCase(),
        familyId,
      },
    });
    catalogItemId = item.id;
    // Fornecedor com o mesmo nome da fonte 1 (caixa diferente): vinculo por nome normalizado.
    const supplier = await prisma.supplier.create({
      data: { name: SOURCE_1.toLowerCase(), acceptedIncoterms: ['FOB'], status: 'active' },
    });
    supplierId = supplier.id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.forecastMonthlySale.deleteMany({ where: { yearMonth: YEAR_MONTH } });
    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: runId.toUpperCase() } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: runId.toUpperCase() } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (supplierId) await prisma.supplier.delete({ where: { id: supplierId } });
    if (catalogItemId) await prisma.catalogItem.delete({ where: { id: catalogItemId } });
    if (familyId) await prisma.itemFamily.delete({ where: { id: familyId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('preview: diff e conferencia, sem escrever nada', async () => {
    const res = await post('preview', {
      contentBase64: await workbookBase64(qCompleta),
      fileName: 'sintetica.xlsx',
      label: '03-1',
      baseDate: BASE_DATE,
    });

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.erros).toEqual([]);
    expect(data.half).toBe(1);
    expect(data.produtos).toMatchObject({ total: 2, novos: 2, alterados: 0 });
    expect(data.codigos).toEqual({ total: 3, vinculadosCatalogo: 1, movidos: 0 });
    expect(data.fontes).toEqual({ total: 2, novas: 2, alteradas: 0, comFornecedor: 1 });
    expect(data.historico).toEqual({ yearMonth: YEAR_MONTH, linhas: 3, novas: 3, alteradas: 0, removidas: 0 });
    expect(data.conferencia.celulas).toBe(2 * COLUNAS_CONFERIDAS.length);
    expect(data.conferencia.batem).toBe(data.conferencia.celulas);

    expect(await prisma.forecastProduct.count({ where: { name: { contains: runId.toUpperCase() } } })).toBe(0);
    expect(await prisma.forecastSnapshot.count({ where: { createdById: adminId } })).toBe(0);
  });

  testDbSkip('confirm com as 3 opcoes: cadastro, vinculos, historico, quinzena e auditoria', async () => {
    const res = await post('confirm', {
      contentBase64: await workbookBase64(qCompleta),
      fileName: 'sintetica.xlsx',
      label: '03-1',
      baseDate: BASE_DATE,
      options: { atualizarCadastro: true, gravarHistorico: true, criarQuinzena: true },
    });

    expect(res.status).toBe(201);
    snapshotId = res.body.data.snapshotId;
    expect(typeof snapshotId).toBe('number');

    // Fontes (+ vinculo com o Supplier por nome normalizado) e lead time.
    const sources = await prisma.forecastSource.findMany({
      where: { name: { contains: runId.toUpperCase() } },
      orderBy: { name: 'asc' },
    });
    expect(sources.map((s) => s.name)).toEqual([SOURCE_1, SOURCE_2]);
    expect(sources[0]).toMatchObject({
      readinessDays: 10,
      holidaysDays: 5,
      shippingDays: 5,
      transitDays: 5,
      clearanceDays: 5,
      leadTimeDays: 30,
      supplierId,
    });
    expect(sources[1]).toMatchObject({ leadTimeDays: 45, supplierId: null });

    // Produtos, codigos e vinculos com o catalogo/familia.
    const products = await prisma.forecastProduct.findMany({
      where: { name: { contains: runId.toUpperCase() } },
      orderBy: { name: 'asc' },
      include: { codes: { orderBy: { position: 'asc' } } },
    });
    expect(products).toHaveLength(2);
    const [a, b] = products;
    expect(a).toMatchObject({
      name: NAME_A,
      sheetOrder: 1,
      sourceId: sources[0].id,
      notes: 'obs de teste',
      fixedPriceFlag: true,
      noFractioning: false,
      packaging: '25 kg',
      familyId,
      isActive: true,
    });
    expect(a.codes.map((c) => [c.position, c.code, c.catalogItemId])).toEqual([
      [1, CODE_A1, catalogItemId],
      [2, CODE_A2, null],
    ]);
    expect(b.sourceId).toBe(sources[1].id);
    expect(b.familyId).toBeNull();
    expect(b.codes.map((c) => c.code)).toEqual([CODE_B1]);

    // Historico do mes (soma por codigo).
    const sales = await prisma.forecastMonthlySale.findMany({ where: { yearMonth: YEAR_MONTH } });
    const byCode = Object.fromEntries(sales.map((s) => [s.code, Number(s.quantity)]));
    expect(byCode).toMatchObject({ [CODE_A1]: 60, [CODE_A2]: 30, [CODE_B1]: 90 });
    expect(sales.every((s) => s.snapshotId === snapshotId && s.sourceLabel === 'planilha 03-1')).toBe(true);

    // Quinzena congelada.
    const snapshot = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    expect(snapshot).toMatchObject({ label: '03-1', half: 1, origin: 'planilha', createdById: adminId });
    expect(snapshot.baseDate.toISOString().slice(0, 10)).toBe(BASE_DATE);
    expect(snapshot.expected).not.toBeNull();
    const frozen = snapshot.products as unknown as Array<{ productId: number }>;
    expect(frozen.map((p) => p.productId)).toEqual([a.id, b.id]);
    const files = snapshot.files as unknown as Array<{ kind: string; sha256: string }>;
    expect(files[0].kind).toBe('planilha');
    expect(files[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    // Auditoria: 1 por fonte, 1 por produto, 1 resumo do historico, 1 da quinzena.
    const audits = await prisma.auditLog.findMany({ where: { performedById: adminId } });
    const count = (entityType: string) => audits.filter((l) => l.entityType === entityType).length;
    expect(count('forecast_source')).toBe(2);
    expect(count('forecast_product')).toBe(2);
    expect(count('forecast_sales')).toBe(1);
    expect(count('forecast_snapshot')).toBe(1);
    const resumo = audits.find((l) => l.entityType === 'forecast_sales')!;
    expect(resumo.entityId).toBe(YEAR_MONTH);
    expect(resumo.metadata).toMatchObject({ yearMonth: YEAR_MONTH, linhas: 3, novas: 3, alteradas: 0, removidas: 0 });
    const auditSnapshot = audits.find((l) => l.entityType === 'forecast_snapshot')!;
    expect(auditSnapshot.metadata).toMatchObject({ label: '03-1', origin: 'planilha' });
  });

  testDbSkip('GET /snapshots/:id: conferencia batem === celulas', async () => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshotId}?hoje=${HOJE}`)
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.data.linhas).toHaveLength(2);
    expect(res.body.data.conferencia.celulas).toBe(2 * COLUNAS_CONFERIDAS.length);
    expect(res.body.data.conferencia.batem).toBe(res.body.data.conferencia.celulas);
    expect(res.body.data.linhas[0]).toMatchObject({ item: NAME_A, fonte: SOURCE_1, AP: '2031-04-19' });

    const list = await request(app).get('/api/v1/forecast/snapshots').set('Cookie', cookies);
    expect(list.status).toBe(200);
    const mine = (list.body.data as Array<{ id: number; products?: unknown }>).find((s) => s.id === snapshotId)!;
    expect(mine).toBeDefined();
    expect(mine.products).toBeUndefined();

    const sources = await request(app).get('/api/v1/forecast/sources').set('Cookie', cookies);
    expect(sources.status).toBe(200);
    const products = await request(app).get('/api/v1/forecast/products').set('Cookie', cookies);
    expect(products.status).toBe(200);
    expect((products.body.data as Array<{ name: string }>).map((p) => p.name)).toContain(NAME_A);
  });

  testDbSkip('PATCH /sources/:id edita lead time e vinculo; fornecedor inexistente -> 400', async () => {
    const source = await prisma.forecastSource.findFirstOrThrow({ where: { name: SOURCE_2 } });
    const ok = await request(app)
      .patch(`/api/v1/forecast/sources/${source.id}`)
      .set('Cookie', cookies)
      .send({ leadTimeDays: 50, supplierId });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ leadTimeDays: 50, supplierId });

    const ruim = await request(app)
      .patch(`/api/v1/forecast/sources/${source.id}`)
      .set('Cookie', cookies)
      .send({ supplierId: 2147483000 });
    expect(ruim.status).toBe(400);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'forecast_source', entityId: String(source.id), performedById: adminId },
      orderBy: { id: 'desc' },
    });
    expect(audit?.action).toBe('update');
    expect(audit?.metadata).toMatchObject({ source: 'manual_patch' });
  });

  testDbSkip('mesmo rotulo de quinzena -> 409 e nada e gravado', async () => {
    const before = await prisma.forecastSnapshot.count({ where: { createdById: adminId } });
    const res = await post('confirm', {
      contentBase64: await workbookBase64(qCompleta),
      fileName: 'sintetica.xlsx',
      label: '03-1',
      baseDate: BASE_DATE,
      options: { atualizarCadastro: false, gravarHistorico: false, criarQuinzena: true },
    });
    expect(res.status).toBe(409);
    expect(await prisma.forecastSnapshot.count({ where: { createdById: adminId } })).toBe(before);
  });

  testDbSkip('reimportar com 1 produto a menos inativa o ausente (so cadastro)', async () => {
    const qMenos = quinzena({
      label: '03-2',
      produtos: [produto(3, NAME_A, [CODE_A1, CODE_A2], SOURCE_1)],
      vendasMes: [[CODE_A1, 60]],
    });
    const body = {
      contentBase64: await workbookBase64(qMenos),
      fileName: 'sintetica-2.xlsx',
      label: '03-2',
      baseDate: BASE_DATE,
    };

    const preview = await post('preview', body);
    expect(preview.status).toBe(200);
    expect(preview.body.data.produtos.inativados).toBeGreaterThanOrEqual(1);
    expect(preview.body.data.produtos).toMatchObject({ total: 1, novos: 0, alterados: 0 });

    const res = await post('confirm', {
      ...body,
      options: { atualizarCadastro: true, gravarHistorico: false, criarQuinzena: false },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.snapshotId).toBeNull();

    const b = await prisma.forecastProduct.findFirstOrThrow({ where: { name: NAME_B }, include: { codes: true } });
    expect(b.isActive).toBe(false);
    expect(b.codes.map((c) => c.code)).toEqual([CODE_B1]); // o codigo do inativado fica com ele
    const a = await prisma.forecastProduct.findFirstOrThrow({ where: { name: NAME_A } });
    expect(a.isActive).toBe(true);
    const deactivate = await prisma.auditLog.findFirst({
      where: { entityType: 'forecast_product', entityId: String(b.id), action: 'deactivate' },
    });
    expect(deactivate).not.toBeNull();
    // Sem "gravar historico": o mes continua como estava.
    expect(await prisma.forecastMonthlySale.count({ where: { yearMonth: YEAR_MONTH } })).toBe(3);
  });

  testDbSkip('gravar historico substitui o mes inteiro (so historico)', async () => {
    const qMenos = quinzena({
      label: '03-2',
      produtos: [produto(3, NAME_A, [CODE_A1, CODE_A2], SOURCE_1)],
      vendasMes: [[CODE_A1, 70]],
    });
    const res = await post('confirm', {
      contentBase64: await workbookBase64(qMenos),
      fileName: 'sintetica-2.xlsx',
      label: '03-2',
      baseDate: BASE_DATE,
      options: { atualizarCadastro: false, gravarHistorico: true, criarQuinzena: false },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.historico).toEqual({
      yearMonth: YEAR_MONTH,
      linhas: 1,
      novas: 0,
      alteradas: 1,
      removidas: 2,
    });
    const sales = await prisma.forecastMonthlySale.findMany({ where: { yearMonth: YEAR_MONTH } });
    expect(sales.map((s) => [s.code, Number(s.quantity), s.snapshotId])).toEqual([[CODE_A1, 70, null]]);
  });

  testDbSkip('VENDAS MENSAL vazia + gravar historico -> 400, historico do mes intacto e nenhuma quinzena nova', async () => {
    // O teste anterior deixou 1 linha em YEAR_MONTH; uma planilha sem vendas nao pode esvazia-lo.
    const antes = await prisma.forecastMonthlySale.count({ where: { yearMonth: YEAR_MONTH } });
    expect(antes).toBeGreaterThan(0);
    const snapshotsAntes = await prisma.forecastSnapshot.count({ where: { createdById: adminId } });

    const q = quinzena({
      label: '03-2',
      produtos: [produto(3, NAME_A, [CODE_A1, CODE_A2], SOURCE_1)],
      vendasMes: [],
    });
    const res = await post('confirm', {
      contentBase64: await workbookBase64(q),
      fileName: 'sintetica-vazia.xlsx',
      label: '03-2',
      baseDate: BASE_DATE,
      options: { atualizarCadastro: true, gravarHistorico: true, criarQuinzena: true },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/nao tem linhas validas/);
    expect(await prisma.forecastMonthlySale.count({ where: { yearMonth: YEAR_MONTH } })).toBe(antes);
    expect(await prisma.forecastSnapshot.count({ where: { createdById: adminId } })).toBe(snapshotsAntes);
  });

  testDbSkip('planilha com erro (codigo em 2 produtos) -> 400 e nada e gravado', async () => {
    const q = quinzena({
      label: '03-2',
      produtos: [
        produto(3, NAME_A, [CODE_A1], SOURCE_1),
        produto(4, NAME_B, [CODE_A1], SOURCE_2),
      ],
      vendasMes: [[CODE_A1, 1]],
    });
    const res = await post('confirm', {
      contentBase64: await workbookBase64(q),
      fileName: 'sintetica-3.xlsx',
      label: '03-2',
      baseDate: BASE_DATE,
      options: { atualizarCadastro: true, gravarHistorico: true, criarQuinzena: true },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/em 2 produtos/);
    expect(await prisma.forecastSnapshot.count({ where: { label: '03-2', createdById: adminId } })).toBe(0);
  });
});
