import exceljs from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fmt${Date.now()}`;

// Datas e rotulo que nenhum outro teste de banco usa (1a quinzena: sem VENDAS do mes atual).
const BASE_DATE = '2038-07-06';
const LABEL = '07-1';
const ANTERIOR = '2038-06'; // base-1: so e substituido no modo normal
const HIST = ['2038-01', '2038-02', '2038-03', '2038-04', '2038-05']; // base-6..base-2
const ALL_MONTHS = [...HIST, ANTERIOR];

const CODE_A1 = `${runId}A1`.toUpperCase();
const CODE_A2 = `${runId}A2`.toUpperCase();
const CODE_B1 = `${runId}B1`.toUpperCase();
const CODE_OLD = `${runId}OLD`.toUpperCase();
const SOURCE_NAME = `FONTE ${runId} 1`.toUpperCase();
const NAME_A = `PRODUTO ${runId} A`.toUpperCase();
const NAME_B = `PRODUTO ${runId} B`.toUpperCase();

// Prazos salvos na fonte (que o modo teste NAO pode alterar) e os digitados no corpo.
const SALVO = { arrivalFromReadinessDays: 40, arrivalFromEtdDays: 30 };
const DIGITADO = { prontidaoDias: 60, etdDias: 20 };

type Cell = string | number | Date | null;

async function xlsxBase64(headers: string[], rows: Cell[][]): Promise<string> {
  const wb = new exceljs.Workbook();
  const ws = wb.addWorksheet('Sheet');
  headers.forEach((h, i) => (ws.getCell(1, i + 1).value = h));
  rows.forEach((row, ri) =>
    row.forEach((value, ci) => {
      if (value !== null) ws.getCell(2 + ri, ci + 1).value = value;
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
const saldoRow = (codigo: string, deposito: string, qtd: number): Cell[] => [
  codigo,
  'x',
  deposito,
  'KG',
  qtd,
  0,
  qtd,
  'SQ QUIMICA',
];

const VENDAS_HEADERS = ['Descr. Item', 'Item', 'Unid. Medida', 'Quantidade ', 'Empresa'];
const vendasRow = (codigo: string, qtd: number): Cell[] => ['x', codigo, 'KG', qtd, 'SQ QUIMICA'];

const PROG_HEADERS = ['Orçamento', 'Status', 'Data Faturamento', 'Cód. Item', 'Qtde.'];
const progRow = (status: string, data: Date, codigo: string, qtd: number): Cell[] => [1, status, data, codigo, qtd];

// FUP so com linhas que dependem do prazo por fonte: A1 pertence a fonte do teste; B1 cai em "Sem fonte" (padrao 35).
const FUP_HEADERS = [
  'STATUS',
  'CÓD. SQ',
  'QTD - KGS',
  'ETD (EMBARQUE)',
  'ETA (CHEGADA)',
  'ETA FINAL',
  'DATA PO',
  'DATA PRONTIDÃO',
];
const fupRow = (status: string, codigo: string, kg: number, etd: Cell, prontidao: Cell): Cell[] => [
  status,
  codigo,
  kg,
  etd,
  VAZIO,
  VAZIO,
  null,
  prontidao,
];

async function reports() {
  return {
    saldo: file(
      'saldo.xlsx',
      await xlsxBase64(SALDO_HEADERS, [saldoRow(CODE_A1, 'DEPOSITO ITAJAI', 100), saldoRow(CODE_B1, 'DEPOSITO ITAJAI', 40)]),
    ),
    vendasMes: file(
      'vendas-mes.xlsx',
      await xlsxBase64(VENDAS_HEADERS, [vendasRow(CODE_A1, 40), vendasRow(CODE_A2, 30), vendasRow(CODE_B1, 90)]),
    ),
    vendasAnual: file('vendas-anual.xlsx', await xlsxBase64(VENDAS_HEADERS, [vendasRow(CODE_A1, 660)])),
    programacao: file(
      'programacao.xlsx',
      await xlsxBase64(PROG_HEADERS, [progRow('Pendente', d('2038-07-20'), CODE_A1, 100)]),
    ),
    fup: file(
      'fup.xlsx',
      await xlsxBase64(FUP_HEADERS, [
        fupRow('AG. EMBARQUE', CODE_A1, 400, d('2038-07-30'), null),
        fupRow('AG. EMBARQUE', CODE_B1, 90, d('2038-07-30'), null),
        fupRow('AG. PRONT. DA CARGA', CODE_A1, 200, VAZIO, '2038-08-01'),
      ]),
    ),
  };
}

describe('Forecast - modo teste da importacao DBCorp (DB)', () => {
  let cookies: string[] = [];
  let adminId: number;
  let sourceId: number;
  let productA: { id: number };
  let productB: { id: number };

  const confirm = async (extra: object = {}) =>
    request(app)
      .post('/api/v1/forecast/import/dbcorp/confirm')
      .set('Cookie', cookies)
      .send({
        label: LABEL,
        baseDate: BASE_DATE,
        files: await reports(),
        prazosEstimativa: [{ sourceId, ...DIGITADO }],
        ...extra,
      });

  const salesOf = async (yearMonth: string) =>
    Object.fromEntries(
      (await prisma.forecastMonthlySale.findMany({ where: { yearMonth } })).map((s) => [s.code, Number(s.quantity)]),
    );
  const prazoDaFonte = () =>
    prisma.forecastSource.findUniqueOrThrow({
      where: { id: sourceId },
      select: { arrivalFromReadinessDays: true, arrivalFromEtdDays: true },
    });
  const auditorias = () => prisma.auditLog.findMany({ where: { performedById: adminId } });
  const auditoriaDoSnapshot = async (snapshotId: number) =>
    (await auditorias()).find((l) => l.entityType === 'forecast_snapshot' && l.entityId === String(snapshotId))!;

  let snapshotTeste: { id: number; products: unknown; inputs: unknown };

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Modo Teste ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    const source = await prisma.forecastSource.create({
      data: { name: SOURCE_NAME, normalizedName: SOURCE_NAME, leadTimeDays: 30, ...SALVO },
    });
    sourceId = source.id;
    productA = await prisma.forecastProduct.create({
      data: {
        name: NAME_A,
        normalizedName: NAME_A,
        sheetOrder: 91001,
        sourceId,
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
        sheetOrder: 91002,
        codes: { create: [{ position: 1, code: CODE_B1 }] },
      },
    });
    // Historico base-6..base-2 completo e uma linha sentinela no mes base-1.
    await prisma.forecastMonthlySale.createMany({
      data: HIST.map((yearMonth) => ({ code: CODE_A1, yearMonth, quantity: 10, sourceLabel: `semente ${runId}` })),
    });
    await prisma.forecastMonthlySale.create({
      data: { code: CODE_OLD, yearMonth: ANTERIOR, quantity: 999, sourceLabel: `semente ${runId}` },
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

  testDbSkip('modoTeste: cria a quinzena com o prazo digitado e NAO grava historico nem prazos', async () => {
    const res = await confirm({ modoTeste: true });
    expect(res.status).toBe(201);
    expect(res.body.data.modoTeste).toBe(true);
    const snapshotId = res.body.data.snapshotId as number;

    const snapshot = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    expect(snapshot).toMatchObject({ label: LABEL, origin: 'dbcorp', createdById: adminId });
    snapshotTeste = { id: snapshotId, products: snapshot.products, inputs: snapshot.inputs };

    // O calculo usou o prazo DIGITADO: A1 ETD 2038-07-30 + 20 = 08; prontidao 2038-08-01 + 60 = 09; sem fonte: ETD + 35 = 09.
    const chegadas = (snapshot.inputs as unknown as { chegadas: Array<{ codigo: string; qtd: number; mes: string }> })
      .chegadas;
    expect(chegadas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: CODE_A1, qtd: 400, mes: '08', estimada: 'etd' }),
        expect.objectContaining({ codigo: CODE_B1, qtd: 90, mes: '09', estimada: 'etd' }),
        expect.objectContaining({ codigo: CODE_A1, qtd: 200, mes: '09', estimada: 'prontidao' }),
      ]),
    );
    const fup = (
      snapshot.files as unknown as Array<{
        kind: string;
        estimativa?: { porFonte: Array<{ sourceId: number; prontidaoDias: number; etdDias: number }> };
      }>
    ).find((f) => f.kind === 'fup')!;
    expect(fup.estimativa?.porFonte).toEqual([expect.objectContaining({ sourceId, ...DIGITADO })]);

    // Historico do mes base-1 e prazos salvos da fonte intactos.
    expect(await salesOf(ANTERIOR)).toEqual({ [CODE_OLD]: 999 });
    expect(await prazoDaFonte()).toEqual(SALVO);

    const audits = await auditorias();
    expect(audits.filter((l) => l.entityType === 'forecast_sales' && l.entityId === ANTERIOR)).toHaveLength(0);
    expect(
      audits.filter(
        (l) =>
          l.entityType === 'forecast_source' &&
          (l.metadata as { source?: string } | null)?.source === 'dbcorp_import_prazo',
      ),
    ).toHaveLength(0);
    const audit = await auditoriaDoSnapshot(snapshotId);
    expect(audit.metadata).toMatchObject({ modoTeste: true, historicoNaoGravado: true, padroesNaoGravados: 1 });
  });

  testDbSkip('segundo modoTeste com o mesmo rotulo -> 409 e nada muda', async () => {
    const res = await confirm({ modoTeste: true });
    expect(res.status).toBe(409);
    expect(await salesOf(ANTERIOR)).toEqual({ [CODE_OLD]: 999 });
    expect(await prazoDaFonte()).toEqual(SALVO);
  });

  testDbSkip('excluir a quinzena de teste e importar normal: mesmo calculo, historico e prazos gravados', async () => {
    const del = await request(app).delete(`/api/v1/forecast/snapshots/${snapshotTeste.id}`).set('Cookie', cookies);
    expect(del.status).toBe(200);

    const res = await confirm();
    expect(res.status).toBe(201);
    expect(res.body.data.modoTeste).toBe(false);
    const snapshotId = res.body.data.snapshotId as number;

    const snapshot = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    expect(snapshot.products).toEqual(snapshotTeste.products);
    expect(snapshot.inputs).toEqual(snapshotTeste.inputs);

    // Agora sim: VENDAS do mes anterior substituem o mes e o prazo digitado vira o padrao da fonte.
    expect(await salesOf(ANTERIOR)).toEqual({ [CODE_A1]: 40, [CODE_A2]: 30, [CODE_B1]: 90 });
    expect(await prazoDaFonte()).toEqual({
      arrivalFromReadinessDays: DIGITADO.prontidaoDias,
      arrivalFromEtdDays: DIGITADO.etdDias,
    });

    const audit = await auditoriaDoSnapshot(snapshotId);
    expect(audit.metadata).not.toHaveProperty('modoTeste');
    expect(audit.metadata).not.toHaveProperty('padroesNaoGravados');
    expect(audit.metadata).not.toHaveProperty('historicoNaoGravado');
  });
});
