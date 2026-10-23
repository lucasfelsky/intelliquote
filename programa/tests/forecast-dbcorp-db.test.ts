import exceljs from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fd${Date.now()}`;

// Datas longe do dado real e do 2031-02 usado pelo teste da planilha (1B).
const BASE_DATE = '2033-06-15';
const LABEL = '06-2';
const HOJE = '2033-06-20';
const ANTERIOR = '2033-05'; // base-1: substituido pelas VENDAS do mes anterior
const HIST = ['2032-12', '2033-01', '2033-02', '2033-03', '2033-04']; // base-6..base-2

const BASE_DATE_2 = '2033-09-05';
const LABEL_2 = '09-1';
const ANTERIOR_2 = '2033-08';
const HIST_2 = ['2033-03', '2033-04', '2033-05', '2033-06', '2033-07'];

const ALL_MONTHS = [...new Set([...HIST, ANTERIOR, ...HIST_2, ANTERIOR_2])];

const CODE_A1 = `${runId}A1`.toUpperCase();
const CODE_A2 = `${runId}A2`.toUpperCase();
const CODE_B1 = `${runId}B1`.toUpperCase();
const CODE_OLD = `${runId}OLD`.toUpperCase();
const CODE_SEM_PRODUTO = `${runId}ZZ`.toUpperCase();
const SOURCE_NAME = `FONTE ${runId} 1`.toUpperCase();
const NAME_A = `PRODUTO ${runId} A`.toUpperCase();
const NAME_B = `PRODUTO ${runId} B`.toUpperCase();

type Cell = string | number | Date | null;

async function xlsxBase64(headers: string[], rows: Cell[][], headerRow = 1): Promise<string> {
  const wb = new exceljs.Workbook();
  const ws = wb.addWorksheet('Sheet');
  headers.forEach((h, i) => (ws.getCell(headerRow, i + 1).value = h));
  rows.forEach((row, ri) =>
    row.forEach((value, ci) => {
      if (value !== null) ws.getCell(headerRow + 1 + ri, ci + 1).value = value;
    }),
  );
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

const d = (key: string): Date => {
  const [y, m, day] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};

const VAZIO = ' ';
const file = (fileName: string, contentBase64: string) => ({ fileName, contentBase64 });

const SALDO_HEADERS = [
  'Código',
  'Descrição',
  'Depósito',
  'Unidade',
  'Saldo Físico Disponível',
  'Saldo Ped. Venda',
  'Saldo Final',
  'Empresa',
];
const saldoRow = (codigo: string, deposito: string, qtd: number, empresa = 'SQ QUIMICA'): Cell[] => [
  codigo,
  'x',
  deposito,
  'KG',
  qtd,
  0,
  qtd,
  empresa,
];

const VENDAS_HEADERS = ['Descr. Item', 'Item', 'Unid. Medida', 'Quantidade ', 'Empresa'];
const vendasRow = (codigo: string, qtd: number): Cell[] => ['x', codigo, 'KG', qtd, 'SQ QUIMICA'];

const PROG_HEADERS = ['Orçamento', 'Status', 'Data Faturamento', 'Cód. Item', 'Qtde.'];
const progRow = (status: string, data: Date, codigo: string, qtd: number): Cell[] => [1, status, data, codigo, qtd];

const FUP_HEADERS = ['STATUS', 'CÓD. SQ', 'QTD - KGS', 'ETD (EMBARQUE)', 'ETA (CHEGADA)', 'ETA FINAL'];
const fupRow = (status: string, codigo: string, kg: number, etd: Cell, eta: Cell, etaFinal: Cell): Cell[] => [
  status,
  codigo,
  kg,
  etd,
  eta,
  etaFinal,
];

async function reports(options: { vendasMes?: Cell[][]; withVendasAtual?: boolean } = {}) {
  const files: Record<string, { fileName: string; contentBase64: string }> = {
    saldo: file(
      'saldo.xlsx',
      await xlsxBase64(SALDO_HEADERS, [
        saldoRow(CODE_A1, 'DEPOSITO TESTE', 100),
        saldoRow(CODE_A1, 'QUALIDADE', 900), // deposito excluido
        saldoRow(CODE_A1, VAZIO, 25), // sem deposito: entra
        saldoRow(CODE_B1, 'DEPOSITO TESTE', 40),
        saldoRow(CODE_A1, 'DEPOSITO TESTE', 5000, 'OUTRA EMPRESA'), // outra empresa
      ]),
    ),
    vendasMes: file(
      'vendas-mes.xlsx',
      await xlsxBase64(
        VENDAS_HEADERS,
        options.vendasMes ?? [
          vendasRow(CODE_A1, 40),
          vendasRow(CODE_A1, 20),
          vendasRow(CODE_A2, 30),
          vendasRow(CODE_B1, 90),
          vendasRow(CODE_SEM_PRODUTO, 10),
        ],
      ),
    ),
    vendasAnual: file('vendas-anual.xlsx', await xlsxBase64(VENDAS_HEADERS, [vendasRow(CODE_A1, 660)])),
    programacao: file(
      'programacao.xlsx',
      await xlsxBase64(PROG_HEADERS, [
        progRow('Pendente', d('2033-06-20'), CODE_A1, 100),
        progRow('Pendente', d('2034-06-20'), CODE_A1, 777), // 12 meses a frente (mesmo MM): nao entra
        progRow('Pendente', d('2033-05-10'), CODE_A1, 888), // antes do mes base: nao entra
        progRow('Aprovado', d('2033-06-21'), CODE_A1, 555),
      ]),
    ),
    fup: file(
      'fup.xlsx',
      await xlsxBase64(FUP_HEADERS, [
        fupRow('EM TRANSITO', CODE_A1, 500, VAZIO, d('2033-06-25'), VAZIO),
        fupRow('EM TRANSITO', CODE_A1, 300, VAZIO, d('2033-05-01'), VAZIO), // vencida: conta no mes base
        fupRow('AG. EMBARQUE', CODE_A1, 400, d('2033-06-30'), VAZIO, VAZIO), // ETD + 35 = 2033-08-04
        fupRow('AG. PAGAMENTO (ANT)', CODE_A1, 1000, VAZIO, VAZIO, VAZIO), // sem data: fora
        fupRow('CONCLUÍDO', CODE_A1, 2000, VAZIO, d('2033-06-10'), VAZIO),
      ]),
    ),
  };
  if (options.withVendasAtual !== false) {
    files.vendasAtual = file('vendas-atual.xlsx', await xlsxBase64(VENDAS_HEADERS, [vendasRow(CODE_A1, 15)]));
  }
  return files;
}

describe('Forecast - quinzena a partir dos relatorios DBCorp (DB)', () => {
  let cookies: string[] = [];
  let adminId: number;
  let sourceId: number;
  let productA: { id: number };
  let productB: { id: number };
  let snapshotId: number;

  const post = (path: 'preview' | 'confirm', body: unknown) =>
    request(app).post(`/api/v1/forecast/import/dbcorp/${path}`).set('Cookie', cookies).send(body as object);

  const seed = (months: string[], rows: Array<[string, number]>) =>
    prisma.forecastMonthlySale.createMany({
      data: months.flatMap((yearMonth) =>
        rows.map(([code, quantity]) => ({ code, yearMonth, quantity, sourceLabel: `semente ${runId}` })),
      ),
    });

  const salesOf = async (yearMonth: string) =>
    Object.fromEntries(
      (await prisma.forecastMonthlySale.findMany({ where: { yearMonth } })).map((s) => [s.code, Number(s.quantity)]),
    );

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Dbcorp ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    const source = await prisma.forecastSource.create({
      data: { name: SOURCE_NAME, normalizedName: SOURCE_NAME, leadTimeDays: 30 },
    });
    sourceId = source.id;
    productA = await prisma.forecastProduct.create({
      data: {
        name: NAME_A,
        normalizedName: NAME_A,
        sheetOrder: 90001,
        sourceId,
        notes: 'obs de teste',
        fixedPriceFlag: true,
        packaging: '25 kg',
        codes: {
          create: [
            { position: 1, code: CODE_A1 },
            { position: 2, code: CODE_A2 },
          ],
        },
      },
    });
    productB = await prisma.forecastProduct.create({
      data: {
        name: NAME_B,
        normalizedName: NAME_B,
        sheetOrder: 90002,
        codes: { create: [{ position: 1, code: CODE_B1 }] },
      },
    });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.forecastMonthlySale.deleteMany({ where: { yearMonth: { in: ALL_MONTHS } } });
    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastProduct.deleteMany({ where: { id: { in: [productA?.id, productB?.id].filter(Boolean) } } });
    if (sourceId) await prisma.forecastSource.delete({ where: { id: sourceId } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('historico com 1 dos 5 meses faltando: preview mostra o erro; confirm -> 400 e nada e gravado', async () => {
    // 2033-02 fica de fora.
    await seed(
      HIST.filter((m) => m !== '2033-02'),
      [[CODE_A1, 10]],
    );
    await prisma.forecastMonthlySale.create({
      data: { code: CODE_OLD, yearMonth: ANTERIOR, quantity: 999, sourceLabel: `semente ${runId}` },
    });
    const body = { label: LABEL, baseDate: BASE_DATE, files: await reports() };

    const preview = await post('preview', body);
    expect(preview.status).toBe(200);
    expect(preview.body.data.historico.ausentes).toEqual(['2033-02']);
    expect(preview.body.data.erros).toEqual([
      'Historico de 02/2033 ausente - importe a planilha dessa quinzena (so "Gravar historico").',
    ]);

    const confirm = await post('confirm', body);
    expect(confirm.status).toBe(400);
    expect(confirm.body.message).toMatch(/Historico de 02\/2033 ausente/);
    expect(await prisma.forecastSnapshot.count({ where: { label: LABEL, createdById: adminId } })).toBe(0);
    expect(await salesOf(ANTERIOR)).toEqual({ [CODE_OLD]: 999 });
  });

  testDbSkip('preview com historico completo: resumo por relatorio, sem escrever nada', async () => {
    await prisma.forecastMonthlySale.deleteMany({ where: { yearMonth: { in: HIST } } });
    await seed(
      HIST.filter((m) => m !== '2033-02'),
      [[CODE_A1, 10]],
    );
    await prisma.forecastMonthlySale.createMany({
      data: [
        { code: CODE_A1, yearMonth: '2033-02', quantity: 20, sourceLabel: `semente ${runId}` },
        { code: CODE_A2, yearMonth: '2033-04', quantity: 5, sourceLabel: `semente ${runId}` },
        { code: CODE_B1, yearMonth: '2033-04', quantity: 7, sourceLabel: `semente ${runId}` },
      ],
    });

    const res = await post('preview', { label: LABEL, baseDate: BASE_DATE, files: await reports() });
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.erros).toEqual([]);
    expect(data.half).toBe(2);
    expect(data.historico.ausentes).toEqual([]);
    expect(data.historico.mesAnterior).toEqual({ yearMonth: ANTERIOR, linhas: 4, novas: 4, alteradas: 0, removidas: 1 });
    expect(data.relatorios.saldo.total).toBe(165);
    expect(data.relatorios.saldo.outrasEmpresas).toEqual([{ empresa: 'OUTRA EMPRESA', linhas: 1, saldo: 5000 }]);
    expect(data.relatorios.saldo.codigosSemProduto).toBe(0);
    expect(data.relatorios.vendasMes.codigosSemProduto).toBe(1);
    expect(data.relatorios.vendasMes.totalCasado).toBe(180);
    expect(data.relatorios.programacao.foraDaJanela).toEqual({ antes: 1, depois: 1 });
    expect(data.relatorios.fup.semData).toMatchObject({ linhas: 1, kg: 1000 });
    expect(data.relatorios.fup.semData.porStatus).toEqual([{ status: 'AG. PAGAMENTO (ANT)', linhas: 1, kg: 1000 }]);
    expect(data.relatorios.fup.estimadasPorEtd).toEqual({ linhas: 1, kg: 400 });
    expect(data.relatorios.fup.vencidasNoMesBase).toEqual({ linhas: 1, kg: 300 });
    // Regra F3: este FUP nao tem ATRAC nem ETA FINAL, nem as colunas DATA PO / DATA PRONTIDAO (so aviso).
    expect(data.relatorios.fup.regra).toMatchObject({ id: 'F3', etaPorEtdDias: 35, etaPorProntidaoDias: 35 });
    expect(data.relatorios.fup.excluidas.atracadas).toEqual({ linhas: 0, kg: 0 });
    expect(data.relatorios.fup.excluidas.etaFinalPreenchida.linhas).toBe(0);
    expect(data.relatorios.fup.estimadasPorProntidao).toEqual({ linhas: 0, kg: 0 });
    expect(data.relatorios.fup.prontidaoNaoReconhecida.linhas).toBe(0);
    expect(data.avisos).toContain('FUP: coluna "DATA PRONTIDÃO" não encontrada - linhas sem ETA nem ETD ficam de fora.');
    expect(data.avisos).toContain('FUP: coluna "DATA PO" não encontrada - o ano da DATA PRONTIDÃO usa a data base.');

    expect(await prisma.forecastSnapshot.count({ where: { label: LABEL, createdById: adminId } })).toBe(0);
    expect(await salesOf(ANTERIOR)).toEqual({ [CODE_OLD]: 999 });
  });

  testDbSkip('confirm: quinzena dbcorp, produtos congelados, historico base-1 substituido e auditoria', async () => {
    const res = await post('confirm', { label: LABEL, baseDate: BASE_DATE, files: await reports() });
    expect(res.status).toBe(201);
    snapshotId = res.body.data.snapshotId;
    expect(typeof snapshotId).toBe('number');

    const snapshot = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    expect(snapshot).toMatchObject({ label: LABEL, half: 2, origin: 'dbcorp', expected: null, createdById: adminId });
    const files = snapshot.files as unknown as Array<{
      kind: string;
      fileName: string;
      sha256: string;
      rows: number;
      regra?: string;
    }>;
    expect(files.map((f) => f.kind)).toEqual(['saldo', 'vendasMes', 'vendasAtual', 'vendasAnual', 'programacao', 'fup']);
    expect(files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(files.find((f) => f.kind === 'saldo')).toMatchObject({ fileName: 'saldo.xlsx', rows: 3 });
    expect(files.find((f) => f.kind === 'fup')?.regra).toBe('F3');
    expect(files.filter((f) => f.kind !== 'fup').every((f) => f.regra === undefined)).toBe(true);

    const frozen = (snapshot.products as unknown as Array<Record<string, unknown>>).filter((p) =>
      [productA.id, productB.id].includes(p.productId as number),
    );
    expect(frozen).toHaveLength(2);
    const a = frozen.find((p) => p.productId === productA.id)!;
    const b = frozen.find((p) => p.productId === productB.id)!;
    expect(a).toMatchObject({
      item: NAME_A,
      n: 90001,
      codigos: [CODE_A1, CODE_A2, '', '', '', '', ''],
      historico: [10, 10, 20, 10, 15], // J..N = soma por codigo (A1 + A2) dos 5 meses
      fonte: SOURCE_NAME,
      obs: 'obs de teste',
      precoFechado: 'X',
      embalagem: '25 kg',
      naoFraciona: '',
      status: 'nao',
      analiseForecast: null,
    });
    expect(b).toMatchObject({ item: NAME_B, codigos: [CODE_B1, '', '', '', '', '', ''], historico: [0, 0, 0, 0, 7], fonte: '' });

    // Mes base-1 substituido por inteiro pelas VENDAS do mes anterior.
    const sales = await prisma.forecastMonthlySale.findMany({ where: { yearMonth: ANTERIOR } });
    expect(Object.fromEntries(sales.map((s) => [s.code, Number(s.quantity)]))).toEqual({
      [CODE_A1]: 60,
      [CODE_A2]: 30,
      [CODE_B1]: 90,
      [CODE_SEM_PRODUTO]: 10,
    });
    expect(sales.every((s) => s.sourceLabel === `dbcorp ${LABEL}` && s.snapshotId === snapshotId)).toBe(true);

    const audits = await prisma.auditLog.findMany({ where: { performedById: adminId } });
    const auditSnapshot = audits.find((l) => l.entityType === 'forecast_snapshot' && l.entityId === String(snapshotId))!;
    expect(auditSnapshot.action).toBe('create');
    expect(auditSnapshot.metadata).toMatchObject({ label: LABEL, origin: 'dbcorp' });
    const arquivos = (auditSnapshot.metadata as { arquivos: Array<{ kind: string; usadas: number }> }).arquivos;
    expect(arquivos.map((x) => x.kind)).toEqual(['saldo', 'vendasMes', 'vendasAtual', 'vendasAnual', 'programacao', 'fup']);
    // So contagens de LINHAS (nunca kg, codigo ou texto do FUP).
    expect((auditSnapshot.metadata as { fup: unknown }).fup).toEqual({
      regra: 'F3',
      estimadasEtd: 1,
      estimadasProntidao: 0,
      excluidasAtracadas: 0,
      excluidasEtaFinal: 0,
      prontidaoNaoReconhecida: 0,
      semData: 1,
    });
    const auditSales = audits.find((l) => l.entityType === 'forecast_sales' && l.entityId === ANTERIOR)!;
    expect(auditSales.action).toBe('replace_month');
    expect(auditSales.metadata).toMatchObject({ yearMonth: ANTERIOR, linhas: 4, novas: 4, alteradas: 0, removidas: 1 });
  });

  testDbSkip('GET /snapshots/:id: sem conferencia; estoque, chegadas e programacao seguem as regras da D2', async () => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshotId}?hoje=${HOJE}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.data.conferencia).toBeNull();
    expect(res.body.data.origin).toBe('dbcorp');

    const linhas = res.body.data.linhas as Array<{
      productId: number | null;
      U: number;
      O: number;
      P: number;
      chegadas: number[];
      programacoes: number[];
    }>;
    const a = linhas.find((l) => l.productId === productA.id)!;
    const b = linhas.find((l) => l.productId === productB.id)!;
    // Estoque: so os depositos incluidos da empresa (100 + 25 sem deposito; 900 de QUALIDADE e 5000 de outra empresa fora).
    expect(a.U).toBe(125);
    expect(b.U).toBe(40);
    expect(a.O).toBe(90);
    expect(a.P).toBe(15);
    // Chegadas V..Z = 06..10: a ETA vencida cai no mes base; ETD 2033-06-30 + 35 = 2033-08-04; sem data e CONCLUIDO fora.
    expect(a.chegadas).toEqual([800, 0, 400, 0, 0]);
    // Programacao AC..AF = 06..09: so a pendente de 2033-06; 12 meses a frente e antes do mes base nao somam.
    expect(a.programacoes).toEqual([100, 0, 0, 0]);
  });

  testDbSkip('mesmo rotulo de novo -> 409 e o historico do mes nao muda', async () => {
    const antes = await salesOf(ANTERIOR);
    const res = await post('confirm', { label: LABEL, baseDate: BASE_DATE, files: await reports({ vendasMes: [vendasRow(CODE_A1, 1)] }) });
    expect(res.status).toBe(409);
    expect(await salesOf(ANTERIOR)).toEqual(antes);
    expect(await prisma.forecastSnapshot.count({ where: { label: LABEL, createdById: adminId } })).toBe(1);
  });

  testDbSkip('vendas do mes anterior sem linhas validas -> 400 e o historico do mes intacto', async () => {
    const antes = await salesOf(ANTERIOR);
    const body = {
      label: '06-1',
      baseDate: BASE_DATE,
      files: await reports({ vendasMes: [[null, null, null, 'Soma = 0,00', null]] }),
    };
    const preview = await post('preview', body);
    expect(preview.status).toBe(200);
    expect(preview.body.data.erros).toContain('Relatorio de vendas do mes anterior sem linhas validas.');

    const res = await post('confirm', body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/sem linhas validas/);
    expect(await salesOf(ANTERIOR)).toEqual(antes);
    expect(await prisma.forecastSnapshot.count({ where: { label: '06-1', createdById: adminId } })).toBe(0);
  });

  testDbSkip('quinzena NN-1 sem vendasAtual -> 201 (AG = Q)', async () => {
    // 2033-03..05 ja existem (sementes e vendas gravadas pelo confirm anterior); faltam 06 e 07.
    await seed(['2033-06', '2033-07'], [[CODE_A1, 12]]);
    const body = {
      label: LABEL_2,
      baseDate: BASE_DATE_2,
      files: await reports({ withVendasAtual: false }),
    };
    const res = await post('confirm', body);
    expect(res.status).toBe(201);

    const snapshot = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: res.body.data.snapshotId } });
    expect(snapshot).toMatchObject({ label: LABEL_2, half: 1, origin: 'dbcorp' });
    expect((snapshot.inputs as unknown as { vendasAtual: unknown[] }).vendasAtual).toEqual([]);
    expect(Object.keys(await salesOf(ANTERIOR_2)).length).toBe(4);

    const calc = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshot.id}?hoje=2033-09-10`)
      .set('Cookie', cookies);
    expect(calc.status).toBe(200);
    const a = (calc.body.data.linhas as Array<{ productId: number; AG: number; Q: number }>).find(
      (l) => l.productId === productA.id,
    )!;
    expect(a.AG).toBe(a.Q);
  });
});
