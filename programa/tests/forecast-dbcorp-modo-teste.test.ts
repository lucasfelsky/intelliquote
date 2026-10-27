import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FORECAST_DBCORP_FUP_REGRA,
  FORECAST_DBCORP_SLOTS,
  FORECAST_ORIGIN_DBCORP,
} from '../src/constants/forecast';

vi.mock('../src/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));

// Isola o historico: so as duas gravacoes que o modo teste pula sao espionadas (o resto segue real).
vi.mock('../src/services/ForecastImportService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/ForecastImportService')>()),
  replaceMonthlySales: vi.fn(),
  summarizeMonthlySales: vi.fn(),
}));

import { prisma } from '../src/lib/prisma';
import { AuditLogService } from '../src/services/AuditLogService';
import { ForecastDbcorpService } from '../src/services/ForecastDbcorpService';
import { replaceMonthlySales } from '../src/services/ForecastImportService';
import { ForecastSnapshotService } from '../src/services/ForecastSnapshotService';
import { ForecastSourceService } from '../src/services/ForecastSourceService';
import { forecastDbcorpConfirmSchema, forecastDbcorpPreviewSchema } from '../src/validators/forecast';

type Mock = ReturnType<typeof vi.fn>;

const fakeFile = (name: string) => ({
  fileName: name,
  contentBase64: Buffer.from('conteudo qualquer').toString('base64'),
});
const validBody = {
  label: '10-2',
  baseDate: '2026-10-15',
  files: {
    saldo: fakeFile('saldo.xlsx'),
    vendasMes: fakeFile('vendas-mes.xlsx'),
    vendasAtual: fakeFile('vendas-atual.xlsx'),
    vendasAnual: fakeFile('vendas-anual.xlsx'),
    programacao: fakeFile('programacao.xlsx'),
    fup: fakeFile('fup.xlsx'),
  },
};

describe('Forecast DBCorp modo teste - schema', () => {
  it('confirm aceita modoTeste booleano e preserva a chave; sem a chave fica undefined', () => {
    expect(forecastDbcorpConfirmSchema.parse({ ...validBody, modoTeste: true }).modoTeste).toBe(true);
    expect(forecastDbcorpConfirmSchema.parse({ ...validBody, modoTeste: false }).modoTeste).toBe(false);
    expect(forecastDbcorpConfirmSchema.parse(validBody).modoTeste).toBeUndefined();
  });

  it('confirm recusa modoTeste nao booleano com path [modoTeste]', () => {
    for (const modoTeste of ['true', 1]) {
      const result = forecastDbcorpConfirmSchema.safeParse({ ...validBody, modoTeste });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map((i) => i.path)).toContainEqual(['modoTeste']);
    }
  });

  it('preview descarta a chave modoTeste', () => {
    const parsed = forecastDbcorpPreviewSchema.parse({ ...validBody, modoTeste: true });
    expect('modoTeste' in parsed).toBe(false);
  });

  it('confirm com modoTeste mantem as regras: -2 sem vendasAtual e fonte repetida', () => {
    const { vendasAtual: _vendasAtual, ...semAtual } = validBody.files;
    void _vendasAtual;
    const semVendasAtual = forecastDbcorpConfirmSchema.safeParse({
      ...validBody,
      files: semAtual,
      modoTeste: true,
    });
    expect(semVendasAtual.success).toBe(false);
    if (!semVendasAtual.success) {
      expect(semVendasAtual.error.issues.map((i) => i.path)).toContainEqual(['files', 'vendasAtual']);
    }

    const prazo = { sourceId: 1, prontidaoDias: 35, etdDias: 35 };
    const repetida = forecastDbcorpConfirmSchema.safeParse({
      ...validBody,
      prazosEstimativa: [prazo, { ...prazo, prontidaoDias: 20 }],
      modoTeste: true,
    });
    expect(repetida.success).toBe(false);
    if (!repetida.success) {
      expect(repetida.error.issues.map((i) => i.path)).toContainEqual(['prazosEstimativa', 1, 'sourceId']);
    }
  });
});

// Objetos minimos SINTETICOS: o que o confirm le de `parsed`/`built`.
function syntheticParsed() {
  const resumo = (usadas: number) => ({ usadas, ignoradas: { cabecalho: 1 }, linhas: [] as unknown[] });
  const fupResumo = {
    ...resumo(5),
    estimadasPorEtd: { linhas: 2 },
    estimadasPorProntidao: { linhas: 1 },
    excluidas: { atracadas: { linhas: 1 }, etaFinalPreenchida: { linhas: 3 } },
    prontidaoNaoReconhecida: { linhas: 0 },
    semData: { linhas: 4 },
    avisos: [] as string[],
  };
  return {
    erros: [] as string[],
    saldo: resumo(10),
    vendasMes: resumo(7),
    vendasAtual: resumo(2),
    vendasAnual: resumo(9),
    programacao: resumo(3),
    fup: fupResumo,
    clientesAtivos: null,
    margem: null,
    files: [
      { kind: 'saldo', fileName: 'saldo.xlsx', rows: 10 },
      { kind: 'fup', fileName: 'fup.xlsx', rows: 5 },
    ],
  };
}

function syntheticBuilt() {
  return {
    erros: [] as string[],
    quinzena: { id: '10-2', dataBase: '2026-10-15' },
    produtosTotal: 2,
    historico: {
      meses: [],
      ausentes: [],
      mesAnterior: { yearMonth: '2026-09', linhas: 7 },
    },
    fup: syntheticParsed().fup,
    prazosEstimativa: {
      fontes: [
        { sourceId: 1, nome: 'FONTE SINTETICA', usado: { prontidaoDias: 40, etdDias: 35 } },
        { sourceId: 2, nome: 'OUTRA FONTE', usado: { prontidaoDias: 35, etdDias: 35 } },
      ],
    },
    mudancasDePrazo: [{ sourceId: 1, prontidaoDias: 40, etdDias: null }],
  };
}

const PADRAO_LABEL = /^\d{2}-[12]$/;

type Folha = { caminho: string; valor: unknown };
function folhas(valor: unknown, caminho = ''): Folha[] {
  if (Array.isArray(valor)) return valor.flatMap((v, i) => folhas(v, `${caminho}[${i}]`));
  if (valor !== null && typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>).flatMap(([k, v]) => folhas(v, `${caminho}.${k}`));
  }
  return [{ caminho, valor }];
}

describe('Forecast DBCorp modo teste - confirm (service)', () => {
  const statics = ForecastDbcorpService as unknown as {
    parseAll: (...args: unknown[]) => unknown;
    buildQuinzena: (...args: unknown[]) => unknown;
    summarize: (...args: unknown[]) => unknown;
  };
  let built: ReturnType<typeof syntheticBuilt>;
  let salvarPrazos: Mock;
  let createFromParsed: Mock;
  let auditLog: Mock;
  const replace = replaceMonthlySales as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    built = syntheticBuilt();
    (prisma.$transaction as unknown as Mock).mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ $executeRaw: vi.fn() }),
    );
    vi.spyOn(statics, 'parseAll').mockResolvedValue(syntheticParsed());
    vi.spyOn(statics, 'buildQuinzena').mockResolvedValue(built);
    vi.spyOn(statics, 'summarize').mockReturnValue({ label: '10-2' });
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

  const input = (extra: object = {}) => ({
    label: '10-2',
    baseDate: '2026-10-15',
    files: {
      saldo: fakeFile('saldo.xlsx'),
      vendasMes: fakeFile('vendas-mes.xlsx'),
      fup: fakeFile('fup.xlsx'),
    },
    ...extra,
  });
  const confirmar = (extra: object = {}) =>
    ForecastDbcorpService.confirm(input(extra) as never, 77);
  const metadataDoSnapshot = () => {
    const chamada = auditLog.mock.calls.find(
      ([entry]) => (entry as { entityType: string }).entityType === 'forecast_snapshot',
    );
    return (chamada![0] as { metadata: Record<string, unknown> }).metadata;
  };

  it('modoTeste true: nao grava prazos nem historico, cria a quinzena e ecoa modoTeste', async () => {
    const resultado = await confirmar({ modoTeste: true });

    expect(salvarPrazos).toHaveBeenCalledTimes(0);
    expect(replace).toHaveBeenCalledTimes(0);
    expect(createFromParsed).toHaveBeenCalledTimes(1);
    expect(createFromParsed.mock.calls[0]![1]).toBe(built.quinzena);
    expect(resultado.modoTeste).toBe(true);
    expect(resultado.snapshotId).toBe(123);

    const metadata = metadataDoSnapshot();
    expect(metadata.modoTeste).toBe(true);
    expect(metadata.historicoNaoGravado).toBe(true);
    expect(metadata.padroesNaoGravados).toBe(1);
    expect(Object.keys(metadata).sort()).toEqual(
      ['label', 'origin', 'produtos', 'arquivos', 'fup', 'modoTeste', 'padroesNaoGravados', 'historicoNaoGravado'].sort(),
    );
  });

  it('modoTeste true: metadata so com numeros, booleanos e textos fixos (sem arquivo, codigo ou fonte)', async () => {
    await confirmar({ modoTeste: true });
    const metadata = metadataDoSnapshot();
    const slots = Object.keys(FORECAST_DBCORP_SLOTS);

    for (const { caminho, valor } of folhas(metadata)) {
      if (typeof valor === 'number' || typeof valor === 'boolean') continue;
      if (caminho === '.label') expect(valor as string).toMatch(PADRAO_LABEL);
      else if (caminho === '.origin') expect(valor).toBe(FORECAST_ORIGIN_DBCORP);
      else if (caminho === '.fup.regra') expect(valor).toBe(FORECAST_DBCORP_FUP_REGRA);
      else if (/^\.arquivos\[\d+\]\.kind$/.test(caminho)) expect(slots).toContain(valor);
      else throw new Error(`texto livre no metadata: ${caminho}`);
    }

    const texto = JSON.stringify(metadata);
    for (const proibido of ['.xlsx', 'FONTE SINTETICA', 'OUTRA FONTE', 'fileName']) {
      expect(texto).not.toContain(proibido);
    }
  });

  it.each([[{}], [{ modoTeste: false }]])(
    'sem modoTeste (%j): grava prazos e historico, metadata sem chaves de teste',
    async (extra) => {
      const resultado = await confirmar(extra);

      expect(salvarPrazos).toHaveBeenCalledTimes(1);
      expect(salvarPrazos.mock.calls[0]!.slice(1)).toEqual([built.mudancasDePrazo, 77, '10-2']);
      expect(replace).toHaveBeenCalledTimes(1);
      const gravacao = replace.mock.calls[0]![1] as Record<string, unknown>;
      expect(gravacao.yearMonth).toBe('2026-09');
      expect(gravacao.sourceLabel).toBe('dbcorp 10-2');
      expect(gravacao.snapshotId).toBe(123);
      expect(resultado.modoTeste).toBe(false);
      expect(resultado.snapshotId).toBe(123);

      const metadata = metadataDoSnapshot();
      expect(metadata).not.toHaveProperty('modoTeste');
      expect(metadata).not.toHaveProperty('padroesNaoGravados');
      expect(metadata).not.toHaveProperty('historicoNaoGravado');
      expect(Object.keys(metadata).sort()).toEqual(['arquivos', 'fup', 'label', 'origin', 'produtos']);
    },
  );

  it('mesmo calculo: a quinzena e os arquivos gravados sao iguais com e sem modoTeste', async () => {
    await confirmar({ modoTeste: true });
    await confirmar();

    expect(createFromParsed).toHaveBeenCalledTimes(2);
    const [teste, normal] = createFromParsed.mock.calls as unknown[][];
    expect(teste![1]).toBe(normal![1]);
    expect(teste!.slice(2)).toEqual(normal!.slice(2));
  });
});
