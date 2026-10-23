import exceljs from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastProductService, type ProductDraft } from '../src/services/ForecastProductService';
import { calcular, valorDaColuna } from '../src/utils/forecastEngine';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import { COLUNAS_CONFERIDAS, type Quinzena } from '../src/utils/forecastTypes';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fm${Date.now()}`;

// Datas longe do dado real e dos demais testes de forecast. Tudo SINTETICO (repo publico).
// Quinzena 1 (planilha): base 2024-04-15 -> janela de vendas 2023-10 .. 2024-04; o mes atipico 2024-02 e o N (indice 4).
const BASE_1 = '2024-04-15';
const HOJE = '2024-04-20';
// Quinzena 2 (DBCorp, 1a quinzena): base 2024-05-05 -> janela 2023-11 .. 2024-05; 2024-02 vira o M (indice 3).
const BASE_2 = '2024-05-05';
// Quinzena 3: base 2024-09-05 -> janela 2024-03 .. 2024-09; 2024-02 ja saiu da janela.
const BASE_3 = '2024-09-05';
const MES_ATIPICO = '2024-02';
const rotulos = rotulosDaQuinzena(BASE_1);

const U = runId.toUpperCase();
const CODE_A = `${U}A1`;
const CODE_B = `${U}B1`;
const CODE_D = `${U}D1`;
const NAME_A = `PRODUTO ${U} A`;
const NAME_B = `PRODUTO ${U} B`;
const NAME_D = `PRODUTO ${U} D`;
const FONTE = `FONTE ${U}`;
const MOTIVO = `VENDA ATIPICA SINTETICA ${U}`;

const produtoBase = (linha: number, item: string, codigo: string, id: number, historico: number[]) => ({
  linha,
  n: linha - 2,
  item,
  codigos: [codigo, '', '', '', '', '', ''],
  historico,
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

describe('Forecast - meses atipicos fora da media (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let productA = 0;
  let productB = 0;
  let snapshot1 = 0;
  let snapshot2 = 0;
  let snapshot3 = 0;

  const put = (productId: number, body: unknown) =>
    request(app)
      .put(`/api/v1/forecast/products/${productId}/meses-atipicos`)
      .set('Cookie', cookies)
      .send(body as object);

  type Linha = {
    productId: number;
    Q: number;
    R: number;
    AG: number;
    AN: number;
    S: number;
    mesesForaDaMedia: Array<{ anoMes: string; motivo: string; indice: number }>;
    mediaAjustada?: { meses: number[]; Q: number; R: number; AG: number; semMesValido: boolean };
  };

  const calculada = async (id: number) => {
    const res = await request(app).get(`/api/v1/forecast/snapshots/${id}?hoje=${HOJE}`).set('Cookie', cookies);
    expect(res.status).toBe(200);
    return res.body.data as {
      linhas: Linha[];
      conferencia: { celulas: number; batem: number; totalDivergencias: number } | null;
    };
  };
  const linhaDe = (d: Awaited<ReturnType<typeof calculada>>, productId: number) =>
    d.linhas.find((l) => l.productId === productId)!;

  const relatorio = async () => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshot1}/relatorio-compras?hoje=${HOJE}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    return res.body.data as {
      grupos: Array<{ itens: Array<{ productId: number | null; item: string; quantidadeSugerida: number; mesesForaDaMedia: string[] }> }>;
    };
  };
  const itemDoRelatorio = async (productId: number) =>
    (await relatorio()).grupos.flatMap((g) => g.itens).find((i) => i.productId === productId);

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

  const reimportar = async (drafts: ProductDraft[]) => {
    await prisma.$transaction(async (tx) => {
      const plan = await ForecastProductService.plan(tx, drafts, new Set());
      await ForecastProductService.apply(tx, { ...plan, inativados: [] }, new Map(), adminId);
    });
  };

  const logs = (productId: number) =>
    prisma.auditLog.findMany({
      where: { entityType: 'forecast_product', entityId: String(productId), action: 'atypical_months_update' },
      orderBy: { id: 'asc' },
    });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Atipicos ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    await prisma.forecastSource.create({ data: { name: FONTE, normalizedName: FONTE, leadTimeDays: 90 } });
    productA = (
      await prisma.forecastProduct.create({
        data: {
          name: NAME_A,
          normalizedName: normalizeProductName(NAME_A),
          codes: { create: [{ position: 1, code: CODE_A }] },
        },
      })
    ).id;
    productB = (
      await prisma.forecastProduct.create({
        data: {
          name: NAME_B,
          normalizedName: normalizeProductName(NAME_B),
          codes: { create: [{ position: 1, code: CODE_B }] },
        },
      })
    ).id;

    // Quinzena 1 (planilha): caso A do plano para os DOIS produtos (J..N = 300 300 300 300 2100, O = 300, P = 100,
    // estoque 2.500, chegada 1.000 e programacao 1.000 em cada mes, lead time 90). Sem marca: Q 900, AN -4.100.
    const entradas = (codigo: string) => ({
      estoque: [{ codigo, qtd: 2500 }],
      vendasMes: [{ codigo, qtd: 300 }],
      vendasAtual: [{ codigo, qtd: 100 }],
      vendasAnual: [{ codigo, qtd: 1100 }],
      programacoes: rotulos.programacao.map((mes) => ({ codigo, qtd: 1000, mes })),
      chegadas: [{ codigo, qtd: 1000, mes: rotulos.chegada[0] }],
    });
    const eA = entradas(CODE_A);
    const eB = entradas(CODE_B);
    const inputs1 = {
      estoque: [...eA.estoque, ...eB.estoque],
      vendasMes: [...eA.vendasMes, ...eB.vendasMes],
      vendasAtual: [...eA.vendasAtual, ...eB.vendasAtual],
      vendasAnual: [...eA.vendasAnual, ...eB.vendasAnual],
      programacoes: [...eA.programacoes, ...eB.programacoes],
      chegadas: [...eA.chegadas, ...eB.chegadas],
      leadtime: [{ fonte: FONTE, total: 90 }],
      margem: [],
      clientesAtivos: [],
    };
    const produtos1 = [
      produtoBase(3, NAME_A, CODE_A, productA, [300, 300, 300, 300, 2100]),
      produtoBase(4, NAME_B, CODE_B, productB, [300, 300, 300, 300, 2100]),
    ];
    // Valores "do Excel": o proprio motor na regra da planilha (2a quinzena, sem marca) - a conferencia tem de
    // continuar 100% mesmo com marcas no cadastro.
    const q1 = {
      id: '04-2',
      arquivo: 'sintetica',
      dataBase: BASE_1,
      mesesConsumo: rotulos.consumo,
      mesesChegada: rotulos.chegada,
      mesesProgramacao: rotulos.programacao,
      produtos: produtos1,
      entradas: inputs1,
      esperado: {},
    } as unknown as Quinzena;
    const esperado: Record<string, Record<string, number | string | null>> = {};
    for (const l of calcular(q1, { hoje: HOJE, quinzena: 2, somarChegada5oMes: false })) {
      esperado[String(l.linha)] = Object.fromEntries(COLUNAS_CONFERIDAS.map((c) => [c, valorDaColuna(l, c)]));
    }
    snapshot1 = (
      await prisma.forecastSnapshot.create({
        data: {
          label: '04-2',
          baseDate: dateKeyToDbDate(BASE_1),
          half: 2,
          origin: 'planilha',
          months: { consumo: rotulos.consumo, chegada: rotulos.chegada, programacao: rotulos.programacao },
          products: produtos1,
          inputs: inputs1,
          expected: esperado,
          files: [],
          createdById: adminId,
        },
      })
    ).id;

    // Quinzena 2 (DBCorp, 1a quinzena) e quinzena 3 (fora da janela): so A, sem chegadas nem programacoes.
    const semMovimento = (codigo: string) => ({
      estoque: [{ codigo, qtd: 2500 }],
      vendasMes: [{ codigo, qtd: 300 }],
      vendasAtual: [{ codigo, qtd: 100 }],
      vendasAnual: [{ codigo, qtd: 1100 }],
      programacoes: [],
      chegadas: [],
      leadtime: [{ fonte: FONTE, total: 90 }],
      margem: [],
      clientesAtivos: [],
    });
    const rotulos2 = rotulosDaQuinzena(BASE_2);
    snapshot2 = (
      await prisma.forecastSnapshot.create({
        data: {
          label: '05-1',
          baseDate: dateKeyToDbDate(BASE_2),
          half: 1,
          origin: 'dbcorp',
          months: { consumo: rotulos2.consumo, chegada: rotulos2.chegada, programacao: rotulos2.programacao },
          // Aqui 2024-02 e o M (indice 3): a venda atipica de 2.100 fica nessa posicao.
          products: [produtoBase(3, NAME_A, CODE_A, productA, [300, 300, 300, 2100, 300])],
          inputs: semMovimento(CODE_A),
          files: [],
          createdById: adminId,
        },
      })
    ).id;
    const rotulos3 = rotulosDaQuinzena(BASE_3);
    snapshot3 = (
      await prisma.forecastSnapshot.create({
        data: {
          label: '09-1',
          baseDate: dateKeyToDbDate(BASE_3),
          half: 1,
          origin: 'dbcorp',
          months: { consumo: rotulos3.consumo, chegada: rotulos3.chegada, programacao: rotulos3.programacao },
          products: [produtoBase(3, NAME_A, CODE_A, productA, [300, 300, 300, 300, 300])],
          inputs: semMovimento(CODE_A),
          files: [],
          createdById: adminId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: U } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: U } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('antes de marcar: media da planilha (Q 900, compra 4.100), sem marcas e sem mediaAjustada', async () => {
    const d = await calculada(snapshot1);
    for (const id of [productA, productB]) {
      const l = linhaDe(d, id);
      expect(l).toMatchObject({ Q: 900, R: 600, S: 100, AG: 900, AN: -4100, mesesForaDaMedia: [] });
      expect(l.mediaAjustada).toBeUndefined();
    }
    expect((await itemDoRelatorio(productA))?.quantidadeSugerida).toBe(4100);
    expect(d.conferencia?.batem).toBe(d.conferencia?.celulas);
    expect(d.conferencia?.celulas).toBeGreaterThan(0);
  });

  testDbSkip('marcar o mes atipico de A: grava, Q cai para 300 e a compra de A para 1.700; B nao muda; 1 AuditLog sem o motivo', async () => {
    const antes = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshot1 } });
    const res = await put(productA, { meses: [{ anoMes: MES_ATIPICO, motivo: `  ${MOTIVO}  ` }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ productId: productA, meses: [{ anoMes: MES_ATIPICO, motivo: MOTIVO }] });
    const gravado = await prisma.forecastAtypicalMonth.findMany({ where: { productId: productA } });
    expect(gravado).toHaveLength(1);
    expect(gravado[0]).toMatchObject({ yearMonth: MES_ATIPICO, reason: MOTIVO, createdById: adminId });

    const d = await calculada(snapshot1);
    const a = linhaDe(d, productA);
    expect(a).toMatchObject({ Q: 300, R: 300, S: 100, AG: 300, AN: -1700 });
    expect(a.mesesForaDaMedia).toEqual([{ anoMes: MES_ATIPICO, motivo: MOTIVO, indice: 4 }]);
    expect(a.mediaAjustada).toEqual({ meses: [4], Q: 900, R: 600, AG: 900, semMesValido: false });
    const b = linhaDe(d, productB);
    expect(b).toMatchObject({ Q: 900, AN: -4100, mesesForaDaMedia: [] });

    // A conferencia motor x planilha NAO passa os meses atipicos: continua 100% com marca no cadastro.
    expect(d.conferencia?.batem).toBe(d.conferencia?.celulas);
    expect(d.conferencia?.totalDivergencias).toBe(0);

    const item = await itemDoRelatorio(productA);
    expect(item?.quantidadeSugerida).toBe(1700);
    expect(item?.mesesForaDaMedia).toEqual([MES_ATIPICO]);
    expect((await itemDoRelatorio(productB))?.quantidadeSugerida).toBe(4100);

    // O snapshot congelado nao foi tocado.
    const depois = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshot1 } });
    expect({ products: depois.products, inputs: depois.inputs, months: depois.months, expected: depois.expected }).toEqual({
      products: antes.products,
      inputs: antes.inputs,
      months: antes.months,
      expected: antes.expected,
    });

    const registros = await logs(productA);
    expect(registros).toHaveLength(1);
    expect(registros[0].performedById).toBe(adminId);
    expect(registros[0].metadata).toEqual({ antes: [], depois: [MES_ATIPICO], motivosAlterados: 0 });
    expect(JSON.stringify(registros[0])).not.toContain(MOTIVO);
    expect(JSON.stringify(registros[0])).not.toContain(NAME_A);
  });

  testDbSkip('o XLSX do relatorio traz o mes na coluna "Meses fora da média", antes da Observação', async () => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshot1}/relatorio-compras/xlsx?hoje=${HOJE}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    const wb = new exceljs.Workbook();
    await wb.xlsx.load(Buffer.from(res.body.data.contentBase64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Por urgência')!;
    const cabecalho = (ws.getRow(1).values as Array<string | undefined>).slice(1);
    // Observacao segue a ULTIMA; "Grupo de equivalência" (PR 6b) vem entre ela e "Meses fora da média".
    const colMeses = cabecalho.indexOf('Meses fora da média');
    expect(cabecalho.at(-1)).toBe('Observação');
    expect(cabecalho.at(-2)).toBe('Grupo de equivalência');
    expect(colMeses).toBe(cabecalho.length - 3);
    const linhas: Array<Array<string | undefined>> = [];
    ws.eachRow((row, n) => {
      if (n > 1) linhas.push((row.values as Array<string | undefined>).slice(1));
    });
    const daA = linhas.find((l) => l[0] === NAME_A)!;
    expect(daA[colMeses]).toBe('fev/2024');
    const daB = linhas.find((l) => l[0] === NAME_B)!;
    expect(daB[colMeses] ?? '').toBe('');
  });

  testDbSkip('quinzena nova herda a marca: o mesmo mes vira o M (indice 3) na quinzena 05-1 e a media sai sem ele', async () => {
    const d = await calculada(snapshot2);
    const a = linhaDe(d, productA);
    expect(a.mesesForaDaMedia).toEqual([{ anoMes: MES_ATIPICO, motivo: MOTIVO, indice: 3 }]);
    // Planilha: (2.100 + 300 + 300) / 3 = 900; sem o M: (300 + 300) / 2 = 300. 1a quinzena: AG = Q.
    expect(a).toMatchObject({ Q: 300, AG: 300 });
    expect(a.mediaAjustada).toEqual({ meses: [3], Q: 900, R: 600, AG: 900, semMesValido: false });
    expect(d.conferencia).toBeNull();
  });

  testDbSkip('mes saindo da janela: na quinzena 09-1 a marca continua gravada mas nao vale (media da planilha)', async () => {
    const d = await calculada(snapshot3);
    const a = linhaDe(d, productA);
    expect(a.mesesForaDaMedia).toEqual([]);
    expect(a.mediaAjustada).toBeUndefined();
    expect(a.Q).toBe(300);
    expect(await prisma.forecastAtypicalMonth.count({ where: { productId: productA, yearMonth: MES_ATIPICO } })).toBe(1);
  });

  testDbSkip('reimportar a planilha (produto alterado) preserva as marcas', async () => {
    await reimportar([draft(NAME_A, [CODE_A], `NOTA ${U}`), draft(NAME_B, [CODE_B])]);
    const a = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productA } });
    expect(a.notes).toBe(`NOTA ${U}`);
    expect(await prisma.forecastAtypicalMonth.count({ where: { productId: productA } })).toBe(1);
    expect(linhaDe(await calculada(snapshot1), productA).Q).toBe(300);
  });

  testDbSkip('com janela, so os meses dela sao substituidos: a marca de outro mes e preservada', async () => {
    // Marca antiga (fora de qualquer janela dos testes) + a do mes atipico; depois a tela desmarca so o 2024-02.
    expect((await put(productA, { meses: [{ anoMes: '2020-01', motivo: 'MOTIVO ANTIGO SINTETICO' }, { anoMes: MES_ATIPICO, motivo: MOTIVO }] })).status).toBe(200);
    const janela = ['2023-10', '2023-11', '2023-12', '2024-01', '2024-02', '2024-03', '2024-04'];
    const res = await put(productA, { meses: [], janela });
    expect(res.status).toBe(200);
    expect(res.body.data.meses).toEqual([{ anoMes: '2020-01', motivo: 'MOTIVO ANTIGO SINTETICO' }]);
    const a = linhaDe(await calculada(snapshot1), productA);
    expect(a).toMatchObject({ Q: 900, AN: -4100, mesesForaDaMedia: [] });
  });

  testDbSkip('sem alteracao nao grava nem audita; so o motivo muda: atualiza a linha e conta o motivo alterado', async () => {
    const total = async () => (await logs(productA)).length;
    const antes = await total();
    expect((await put(productA, { meses: [{ anoMes: '2020-01', motivo: 'MOTIVO ANTIGO SINTETICO' }] })).status).toBe(200);
    expect(await total()).toBe(antes);

    const linhaAntes = await prisma.forecastAtypicalMonth.findFirstOrThrow({ where: { productId: productA, yearMonth: '2020-01' } });
    expect((await put(productA, { meses: [{ anoMes: '2020-01', motivo: 'MOTIVO NOVO SINTETICO' }] })).status).toBe(200);
    const linhaDepois = await prisma.forecastAtypicalMonth.findFirstOrThrow({ where: { productId: productA, yearMonth: '2020-01' } });
    expect(linhaDepois.id).toBe(linhaAntes.id);
    expect(linhaDepois.reason).toBe('MOTIVO NOVO SINTETICO');
    const registros = await logs(productA);
    expect(registros).toHaveLength(antes + 1);
    expect(registros.at(-1)?.metadata).toEqual({ antes: ['2020-01'], depois: ['2020-01'], motivosAlterados: 1 });
    expect(JSON.stringify(registros.at(-1))).not.toContain('MOTIVO NOVO SINTETICO');
  });

  testDbSkip('lista vazia (sem janela) desmarca tudo e A volta a media da planilha', async () => {
    expect((await put(productA, { meses: [] })).status).toBe(200);
    expect(await prisma.forecastAtypicalMonth.count({ where: { productId: productA } })).toBe(0);
    expect(linhaDe(await calculada(snapshot1), productA).Q).toBe(900);
  });

  testDbSkip('produto INATIVO aceita a marca e ela vale na quinzena que ainda o referencia', async () => {
    await prisma.forecastProduct.update({ where: { id: productB }, data: { isActive: false } });
    expect((await put(productB, { meses: [{ anoMes: MES_ATIPICO, motivo: MOTIVO }] })).status).toBe(200);
    const b = linhaDe(await calculada(snapshot1), productB);
    expect(b).toMatchObject({ Q: 300, AN: -1700 });
    // Reativar mantem a marca.
    await prisma.forecastProduct.update({ where: { id: productB }, data: { isActive: true } });
    expect(await prisma.forecastAtypicalMonth.count({ where: { productId: productB } })).toBe(1);
  });

  testDbSkip('todos os meses do trimestre marcados: Q e a media da planilha (sem divisao por zero) e semMesValido avisa', async () => {
    // Quinzena 1: M, N, O = 2024-01, 2024-02, 2024-03 (indices 3, 4, 5).
    const meses = ['2024-01', '2024-02', '2024-03'].map((anoMes) => ({ anoMes, motivo: MOTIVO }));
    expect((await put(productB, { meses })).status).toBe(200);
    const b = linhaDe(await calculada(snapshot1), productB);
    expect(b.Q).toBe(900);
    expect(Number.isFinite(b.R)).toBe(true);
    expect(b.mediaAjustada).toMatchObject({ meses: [3, 4, 5], semMesValido: true });
    expect(b.mesesForaDaMedia.map((m) => m.indice)).toEqual([3, 4, 5]);
  });

  testDbSkip('apagar o produto apaga as marcas (cascade)', async () => {
    const d = await prisma.forecastProduct.create({
      data: { name: NAME_D, normalizedName: normalizeProductName(NAME_D), codes: { create: [{ position: 1, code: CODE_D }] } },
    });
    expect((await put(d.id, { meses: [{ anoMes: MES_ATIPICO, motivo: MOTIVO }] })).status).toBe(200);
    expect(await prisma.forecastAtypicalMonth.count({ where: { productId: d.id } })).toBe(1);
    await prisma.forecastProduct.delete({ where: { id: d.id } });
    expect(await prisma.forecastAtypicalMonth.count({ where: { productId: d.id } })).toBe(0);
  });

  testDbSkip('erros: produto inexistente 404, mes futuro 400 e duplicado 400, sem gravar', async () => {
    expect((await put(2147483000, { meses: [{ anoMes: MES_ATIPICO, motivo: MOTIVO }] })).status).toBe(404);
    const antes = await prisma.forecastAtypicalMonth.count({ where: { productId: productA } });
    expect((await put(productA, { meses: [{ anoMes: '2099-01', motivo: MOTIVO }] })).status).toBe(400);
    expect(
      (await put(productA, { meses: [{ anoMes: MES_ATIPICO, motivo: MOTIVO }, { anoMes: MES_ATIPICO, motivo: MOTIVO }] })).status,
    ).toBe(400);
    expect(await prisma.forecastAtypicalMonth.count({ where: { productId: productA } })).toBe(antes);
  });
});
