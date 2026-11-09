import exceljs from 'exceljs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dados 100% sinteticos (repositorio publico): fontes FIC-FONTE-n, codigos FIC000n, datas em 2033.

const { fake } = vi.hoisted(() => {
  const fake = {
    forecastProduct: { findMany: vi.fn() },
    forecastMonthlySale: { groupBy: vi.fn(), findMany: vi.fn() },
    forecastSource: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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
import { mesesHistorico } from '../src/utils/forecastMonths';
import type { Quinzena } from '../src/utils/forecastTypes';

type Mock = ReturnType<typeof vi.fn>;
type Cell = string | number | null;

const BASE_DATE = '2033-10-15';
const LABEL = '10-1';
const CODIGO_1 = 'FIC0001';
const CODIGO_2 = 'FIC0002';

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

const FUP_HEADERS = ['STATUS', 'CÓD. SQ', 'QTD - KGS', 'ETD (EMBARQUE)', 'ETA (CHEGADA)', 'ETA FINAL', 'DATA PO', 'DATA PRONTIDÃO'];
const VAZIO = ' ';
const fupRow = (status: string, codigo: string, kg: number, etaFinal: Cell, prontidao: Cell): Cell[] => [
  status,
  codigo,
  kg,
  VAZIO,
  VAZIO,
  etaFinal,
  null,
  prontidao,
];

async function relatorios() {
  const vendasHeaders = ['Descr. Item', 'Item', 'Unid. Medida', 'Quantidade ', 'Empresa'];
  const vendas = (qtd: number) => [['x', CODIGO_1, 'KG', qtd, 'SQ QUIMICA']];
  // FIC-FONTE-1: 12 chegadas medidas (prontidao 2033-01-10 -> ETA FINAL 2033-03-11 = 60 dias) e 1 linha em aberto
  // (prontidao 2033-10-10: +35 = novembro, +60 = dezembro). FIC-FONTE-2: so 3 chegadas medidas e 1 linha em aberto.
  const historico = (codigo: string, n: number) =>
    Array.from({ length: n }, () => fupRow('CONCLUÍDO', codigo, 10, '2033-03-11', '2033-01-10'));
  return {
    saldo: file(
      'saldo.xlsx',
      await xlsxBase64(
        ['Código', 'Descrição', 'Depósito', 'Unidade', 'Saldo Físico Disponível', 'Saldo Final', 'Empresa'],
        [
          [CODIGO_1, 'x', 'DEPOSITO ITAJAI', 'KG', 100, 100, 'SQ QUIMICA'],
          [CODIGO_2, 'x', 'DEPOSITO ITAJAI', 'KG', 40, 40, 'SQ QUIMICA'],
        ],
      ),
    ),
    vendasMes: file('vendas-mes.xlsx', await xlsxBase64(vendasHeaders, vendas(30))),
    vendasAnual: file('vendas-anual.xlsx', await xlsxBase64(vendasHeaders, vendas(360))),
    programacao: file(
      'programacao.xlsx',
      await xlsxBase64(['Orçamento', 'Status', 'Data Faturamento', 'Cód. Item', 'Qtde.'], [[1, 'Aprovado', '2033-10-20', CODIGO_1, 5]]),
    ),
    fup: file(
      'fup.xlsx',
      await xlsxBase64(FUP_HEADERS, [
        ...historico(CODIGO_1, 12),
        ...historico(CODIGO_2, 3),
        fupRow('EM PRODUCAO', CODIGO_1, 200, VAZIO, '2033-10-10'),
        fupRow('EM PRODUCAO', CODIGO_2, 50, VAZIO, '2033-10-10'),
      ]),
    ),
  };
}

const produto = (id: number, code: string, sourceId: number) => ({
  id,
  name: `FIC-PRODUTO ${id}`,
  sheetOrder: id,
  notes: null,
  sourceId,
  source: null,
  fixedPriceFlag: false,
  packaging: null,
  noFractioning: false,
  sampleQty: null,
  sampleRequestNote: null,
  codes: [{ code, position: 1 }],
});

const fonteDb = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `FIC-FONTE-${id}`,
  leadTimeDays: null,
  isActive: true,
  arrivalFromReadinessDays: null,
  arrivalFromEtdDays: null,
  ...over,
});

describe('Forecast DBCorp: sugestao de prazo de chegada (nada e gravado sozinho)', () => {
  let createFromParsed: Mock;
  let auditLog: Mock;
  let salvarPrazos: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    fake.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(fake));
    fake.$executeRaw.mockResolvedValue(0);
    fake.forecastProduct.findMany.mockResolvedValue([produto(1, CODIGO_1, 1), produto(2, CODIGO_2, 2)]);
    fake.forecastMonthlySale.groupBy.mockResolvedValue(
      mesesHistorico(BASE_DATE).historico.map((yearMonth) => ({ yearMonth, _count: { _all: 3 } })),
    );
    fake.forecastMonthlySale.findMany.mockResolvedValue([]);
    fake.forecastSource.findMany.mockResolvedValue([fonteDb(1), fonteDb(2)]);
    vi.spyOn(ForecastProductService, 'cadastroDeCodigos').mockResolvedValue({
      ativos: new Set([CODIGO_1, CODIGO_2]),
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
    salvarPrazos = vi
      .spyOn(ForecastSourceService, 'salvarPrazosChegada')
      .mockResolvedValue(undefined as never) as unknown as Mock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const corpo = async (extra: object = {}) => ({
    label: LABEL,
    baseDate: BASE_DATE,
    files: await relatorios(),
    ...extra,
  });
  const preview = async (extra: object = {}) => ForecastDbcorpService.preview((await corpo(extra)) as never);
  const confirmar = async (extra: object = {}) => ForecastDbcorpService.confirm((await corpo(extra)) as never, 77);
  const metadataDoSnapshot = () => {
    const entradas = auditLog.mock.calls.filter(
      ([entry]) => (entry as { entityType: string }).entityType === 'forecast_snapshot',
    );
    return (entradas[0]![0] as { metadata: Record<string, unknown> }).metadata;
  };
  const chegadasDe = (codigo: string) =>
    (createFromParsed.mock.calls[0]![1] as Quinzena).entradas.chegadas.filter((c) => c.codigo === codigo);

  it('preview: cada fonte da tabela traz a sugestao (P75 e evidencia); sem amostra suficiente, so a evidencia', async () => {
    const resumo = await preview();
    expect(resumo.erros).toEqual([]);
    const fontes = resumo.prazosEstimativa!.fontes;
    const um = fontes.find((f) => f.nome === 'FIC-FONTE-1')!;
    expect(um.sugestao?.prontidao).toMatchObject({ situacao: 'sugerida', dias: 60, atual: 35 });
    expect(um.sugestao?.prontidao?.evidencia).toMatchObject({
      amostras: 12,
      mediana: 60,
      percentil: 75,
      valorPercentil: 60,
      min: 60,
      max: 60,
      de: '2033-03-11',
      ate: '2033-03-11',
      dispersaoAlta: false,
    });
    expect(um.sugestao?.etd).toBeNull();
    const dois = fontes.find((f) => f.nome === 'FIC-FONTE-2')!;
    expect(dois.sugestao?.prontidao).toMatchObject({ situacao: 'poucas_amostras', dias: null, minAmostras: 10 });
    expect(dois.sugestao?.prontidao?.evidencia.amostras).toBe(3);
  });

  it('preview: nada e gravado (sem update/updateMany de fonte, sem salvarPrazosChegada, sem AuditLog, sem snapshot)', async () => {
    await preview();
    expect(fake.forecastSource.update).not.toHaveBeenCalled();
    expect(fake.forecastSource.updateMany).not.toHaveBeenCalled();
    expect(salvarPrazos).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
    expect(createFromParsed).not.toHaveBeenCalled();
  });

  it('preview: a sugestao nao muda o prazo usado nem a chegada estimada (continua 35 dias)', async () => {
    const resumo = await preview();
    const um = resumo.prazosEstimativa!.fontes.find((f) => f.nome === 'FIC-FONTE-1')!;
    expect(um.usado).toEqual({ prontidaoDias: 35, etdDias: 35 });
    expect(resumo.prazosEstimativa!.padroesAlterados).toBe(0);
  });

  it('preview: com prazo salvo perto do medido a sugestao vira diferenca_pequena (compara com o salvo, nao com 35)', async () => {
    fake.forecastSource.findMany.mockResolvedValue([fonteDb(1, { arrivalFromReadinessDays: 58 }), fonteDb(2)]);
    const resumo = await preview();
    const um = resumo.prazosEstimativa!.fontes.find((f) => f.nome === 'FIC-FONTE-1')!;
    expect(um.sugestao?.prontidao).toMatchObject({ situacao: 'diferenca_pequena', dias: 60, atual: 58 });
  });

  it('preview: fonte inativa nao recebe sugestao nem entra na tabela', async () => {
    fake.forecastSource.findMany.mockResolvedValue([fonteDb(1, { isActive: false }), fonteDb(2)]);
    const resumo = await preview();
    expect(resumo.prazosEstimativa!.fontes.map((f) => f.nome)).toEqual(['FIC-FONTE-2']);
  });

  it('confirm SEM prazosEstimativa: grava [] (a sugestao nao vira prazo) e a chegada segue em 35 dias', async () => {
    await confirmar();
    expect(salvarPrazos).toHaveBeenCalledTimes(1);
    expect(salvarPrazos.mock.calls[0]![1]).toEqual([]);
    expect(chegadasDe(CODIGO_1)).toMatchObject([{ qtd: 200, mes: '11' }]); // 2033-10-10 + 35 = 2033-11-14
    const fup = metadataDoSnapshot().fup as Record<string, unknown>;
    expect(fup.padroesAlterados).toBe(0);
    expect(fup.padroesIguaisASugestao).toBe(0);
    expect(fup.fontesComSugestao).toBe(1);
  });

  it('confirm COM o valor sugerido no corpo: grava aquele valor e conta 1 padrao igual a sugestao', async () => {
    await confirmar({ prazosEstimativa: [{ sourceId: 1, prontidaoDias: 60, etdDias: 35 }] });
    expect(salvarPrazos.mock.calls[0]![1]).toEqual([{ sourceId: 1, arrivalFromReadinessDays: 60 }]);
    expect(chegadasDe(CODIGO_1)).toMatchObject([{ qtd: 200, mes: '12' }]); // 2033-10-10 + 60 = 2033-12-09
    const fup = metadataDoSnapshot().fup as Record<string, unknown>;
    expect(fup.padroesAlterados).toBe(1);
    expect(fup.padroesIguaisASugestao).toBe(1);
  });

  it('confirm com valor DIFERENTE do sugerido: grava o digitado e nao conta como igual a sugestao', async () => {
    await confirmar({ prazosEstimativa: [{ sourceId: 1, prontidaoDias: 55, etdDias: 35 }] });
    expect(salvarPrazos.mock.calls[0]![1]).toEqual([{ sourceId: 1, arrivalFromReadinessDays: 55 }]);
    const fup = metadataDoSnapshot().fup as Record<string, unknown>;
    expect(fup.padroesAlterados).toBe(1);
    expect(fup.padroesIguaisASugestao).toBe(0);
  });

  it('confirm: o snapshot congela as amostras com prontidaoDias', async () => {
    await confirmar();
    const prazosFup = (createFromParsed.mock.calls[0]![1] as Quinzena).entradas.prazosFup!;
    expect(prazosFup).toHaveLength(15);
    expect(prazosFup.every((a) => a.prontidaoDias === 60 && a.etaFinal === '2033-03-11')).toBe(true);
  });

  it('confirm: o AuditLog do snapshot so tem numeros nas chaves novas e as chaves de topo de sempre', async () => {
    await confirmar({ prazosEstimativa: [{ sourceId: 1, prontidaoDias: 60, etdDias: 35 }] });
    const metadata = metadataDoSnapshot();
    expect(Object.keys(metadata).sort()).toEqual(['arquivos', 'fup', 'label', 'origin', 'produtos']);
    const fup = metadata.fup as Record<string, unknown>;
    expect(typeof fup.fontesComSugestao).toBe('number');
    expect(typeof fup.padroesIguaisASugestao).toBe('number');
    expect(fup.prontidaoVencida).toBe(2); // as duas linhas em aberto tem prontidao 2033-10-10, antes da base 2033-10-15
    const texto = JSON.stringify(metadata);
    expect(texto).not.toContain('FIC0001');
    expect(texto).not.toContain('FIC-FONTE');
  });
});
