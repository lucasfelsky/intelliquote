import exceljs from 'exceljs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dados 100% sinteticos (repositorio publico). SENTINELA = valor unico de pedido de venda que nao coincide com
// nenhuma soma do estoque nem das vendas.
const SENTINELA = 7777.125;

const { fake } = vi.hoisted(() => {
  const fake = {
    forecastProduct: { findMany: vi.fn() },
    forecastMonthlySale: { groupBy: vi.fn(), findMany: vi.fn() },
    forecastSource: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { fake };
});

vi.mock('../src/lib/prisma', () => ({ prisma: fake }));

// Isola o historico: so as duas gravacoes de VENDAS sao espionadas (aggregateSales segue real).
vi.mock('../src/services/ForecastImportService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/ForecastImportService')>()),
  replaceMonthlySales: vi.fn(),
  summarizeMonthlySales: vi.fn(),
}));

import { AuditLogService } from '../src/services/AuditLogService';
import { ForecastDbcorpService } from '../src/services/ForecastDbcorpService';
import { ForecastProductService } from '../src/services/ForecastProductService';
import { ForecastSnapshotService } from '../src/services/ForecastSnapshotService';
import { ForecastSourceService } from '../src/services/ForecastSourceService';
import { calcular } from '../src/utils/forecastEngine';
import { mesesHistorico } from '../src/utils/forecastMonths';
import type { Quinzena } from '../src/utils/forecastTypes';

type Mock = ReturnType<typeof vi.fn>;
type Cell = string | number | null;

const BASE_DATE = '2026-10-15';
const LABEL = '10-1';
const HOJE = '2026-10-20';
const CODIGO_A = 'TST0001';
const CODIGO_B = 'TST0002';

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

const file = (fileName: string, contentBase64: string) => ({ fileName, contentBase64 });

const SALDO_HEADERS = ['Código', 'Descrição', 'Depósito', 'Unidade', 'Saldo Físico Disponível', 'Saldo Ped. Venda', 'Saldo Final', 'Empresa'];
const SALDO_HEADERS_SEM_COLUNA = SALDO_HEADERS.filter((h) => h !== 'Saldo Ped. Venda');

async function relatorios(comColuna: boolean) {
  const linhas: Array<[string, number, number]> = [
    [CODIGO_A, 100, SENTINELA],
    [CODIGO_B, 40, 0],
  ];
  const saldoRows: Cell[][] = linhas.map(([codigo, fisico, pedVenda]) =>
    comColuna
      ? [codigo, 'x', 'DEPOSITO TESTE', 'KG', fisico, pedVenda, fisico, 'SQ QUIMICA']
      : [codigo, 'x', 'DEPOSITO TESTE', 'KG', fisico, fisico, 'SQ QUIMICA'],
  );
  const vendasHeaders = ['Descr. Item', 'Item', 'Unid. Medida', 'Quantidade ', 'Empresa'];
  const vendas = (qtd: number) => [['x', CODIGO_A, 'KG', qtd, 'SQ QUIMICA']];
  return {
    saldo: file('saldo.xlsx', await xlsxBase64(comColuna ? SALDO_HEADERS : SALDO_HEADERS_SEM_COLUNA, saldoRows)),
    vendasMes: file('vendas-mes.xlsx', await xlsxBase64(vendasHeaders, vendas(30))),
    vendasAnual: file('vendas-anual.xlsx', await xlsxBase64(vendasHeaders, vendas(360))),
    programacao: file(
      'programacao.xlsx',
      await xlsxBase64(['Orçamento', 'Status', 'Data Faturamento', 'Cód. Item', 'Qtde.'], [[1, 'Aprovado', '2026-10-20', CODIGO_A, 5]]),
    ),
    fup: file(
      'fup.xlsx',
      await xlsxBase64(
        ['STATUS', 'CÓD. SQ', 'QTD - KGS', 'ETD (EMBARQUE)', 'ETA (CHEGADA)', 'ETA FINAL'],
        [['EM TRANSITO', CODIGO_A, 50, ' ', ' ', ' ']],
      ),
    ),
  };
}

const produto = (id: number, code: string) => ({
  id,
  name: `PRODUTO SINTETICO ${id}`,
  sheetOrder: id,
  notes: null,
  sourceId: null,
  source: null,
  fixedPriceFlag: false,
  packaging: null,
  noFractioning: false,
  sampleQty: null,
  sampleRequestNote: null,
  codes: [{ code, position: 1 }],
});

describe('Forecast DBCorp: saldo de pedido de venda no preview e no confirm', () => {
  let createFromParsed: Mock;
  let auditLog: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    fake.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(fake));
    fake.$executeRaw.mockResolvedValue(0);
    fake.forecastProduct.findMany.mockResolvedValue([produto(1, CODIGO_A), produto(2, CODIGO_B)]);
    fake.forecastMonthlySale.groupBy.mockResolvedValue(
      mesesHistorico(BASE_DATE).historico.map((yearMonth) => ({ yearMonth, _count: { _all: 3 } })),
    );
    fake.forecastMonthlySale.findMany.mockResolvedValue([]);
    fake.forecastSource.findMany.mockResolvedValue([]);
    vi.spyOn(ForecastProductService, 'cadastroDeCodigos').mockResolvedValue({
      ativos: new Set([CODIGO_A, CODIGO_B]),
      inativos: new Map(),
    } as never);
    vi.spyOn(ForecastProductService, 'vendasRecentes').mockResolvedValue({
      meses: [],
      anteriores: new Map(),
      ausentes: [],
    } as never);
    vi.spyOn(ForecastSnapshotService, 'assertLabelFree').mockResolvedValue(undefined as never);
    createFromParsed = vi
      .spyOn(ForecastSnapshotService, 'createFromParsed')
      .mockResolvedValue({ id: 123 } as never) as unknown as Mock;
    auditLog = vi.spyOn(AuditLogService, 'log').mockResolvedValue(undefined as never) as unknown as Mock;
    vi.spyOn(ForecastSourceService, 'salvarPrazosChegada').mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const corpo = async (comColuna: boolean, extra: object = {}) => ({
    label: LABEL,
    baseDate: BASE_DATE,
    files: await relatorios(comColuna),
    ...extra,
  });
  const confirmar = async (comColuna: boolean, extra: object = {}) =>
    ForecastDbcorpService.confirm((await corpo(comColuna, extra)) as never, 77);
  const quinzenaGravada = (chamada = 0) => createFromParsed.mock.calls[chamada]![1] as Quinzena;
  const metadataDoSnapshot = (chamada = 0) => {
    const entradas = auditLog.mock.calls.filter(
      ([entry]) => (entry as { entityType: string }).entityType === 'forecast_snapshot',
    );
    return (entradas[chamada]![0] as { metadata: Record<string, unknown> }).metadata;
  };

  it('preview com a coluna: nao vaza o saldo nem o sentinela e o resumo e igual ao sem a coluna', async () => {
    const com = await ForecastDbcorpService.preview((await corpo(true)) as never);
    const sem = await ForecastDbcorpService.preview((await corpo(false)) as never);
    const texto = JSON.stringify(com);
    expect(texto).not.toContain('saldoPedVenda');
    expect(texto).not.toContain(String(SENTINELA));
    expect(com.erros).toEqual([]);
    expect(Object.keys(com.relatorios.saldo!)).toEqual(Object.keys(sem.relatorios.saldo!));
    expect(com.avisos).toEqual(sem.avisos);
    expect(com.erros).toEqual(sem.erros);
    expect(com.relatorios.saldo).toEqual(sem.relatorios.saldo);
  });

  it('confirm com a coluna: congela o saldo em entradas e o resto das entradas e igual ao sem a coluna', async () => {
    await confirmar(true);
    await confirmar(false);
    const com = quinzenaGravada(0).entradas;
    const sem = quinzenaGravada(1).entradas;
    expect(com.saldoPedVenda).toEqual([{ codigo: CODIGO_A, qtd: SENTINELA }]);
    const { saldoPedVenda, ...restoCom } = com;
    void saldoPedVenda;
    expect(restoCom).toEqual(sem);
    expect(calcular(quinzenaGravada(0), { hoje: HOJE })).toEqual(calcular(quinzenaGravada(1), { hoje: HOJE }));
  });

  it('confirm sem a coluna: a chave nao existe (JSON igual ao de quinzena antiga)', async () => {
    await confirmar(false);
    const entradas = quinzenaGravada().entradas;
    expect('saldoPedVenda' in entradas).toBe(false);
    expect(JSON.stringify(entradas)).not.toContain('saldoPedVenda');
  });

  it('AuditLog: metadata igual com e sem a coluna, so contagens, sem sentinela nem codigos', async () => {
    await confirmar(true);
    await confirmar(false);
    const com = metadataDoSnapshot(0);
    const sem = metadataDoSnapshot(1);
    expect(com).toEqual(sem);
    expect(Object.keys(com).sort()).toEqual(['arquivos', 'fup', 'label', 'origin', 'produtos']);
    const texto = JSON.stringify(com);
    expect(texto).not.toContain(String(SENTINELA));
    expect(texto).not.toContain('TST');
    const arquivos = com.arquivos as Array<{ kind: string; usadas: number; ignoradas: number }>;
    const saldo = arquivos.find((a) => a.kind === 'saldo')!;
    expect(saldo.usadas).toBe(2);
    expect(saldo.ignoradas).toBe(0);
    expect(arquivos.find((a) => a.kind === 'saldo')).toEqual((sem.arquivos as typeof arquivos).find((a) => a.kind === 'saldo'));
  });

  it('modo teste: as entradas gravadas (inclusive saldoPedVenda) sao iguais com e sem modoTeste', async () => {
    await confirmar(true, { modoTeste: true });
    await confirmar(true);
    const teste = quinzenaGravada(0).entradas;
    const normal = quinzenaGravada(1).entradas;
    expect(teste.saldoPedVenda).toEqual([{ codigo: CODIGO_A, qtd: SENTINELA }]);
    expect(teste).toEqual(normal);
  });
});
