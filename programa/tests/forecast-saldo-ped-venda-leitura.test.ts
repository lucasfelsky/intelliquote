import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceljs from 'exceljs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fake } = vi.hoisted(() => ({
  fake: {
    forecastSnapshot: { findFirst: vi.fn() },
    forecastPurchaseDecision: { findMany: vi.fn() },
  },
}));

vi.mock('../src/lib/prisma', () => ({ prisma: fake }));

import { ForecastDemandaComercialService } from '../src/services/ForecastDemandaComercialService';
import { ForecastGrupoEquivalenciaService } from '../src/services/ForecastGrupoEquivalenciaService';
import { ForecastMesesAtipicosService } from '../src/services/ForecastMesesAtipicosService';
import { ForecastOcasioesService } from '../src/services/ForecastOcasioesService';
import { ForecastProductService } from '../src/services/ForecastProductService';
import { ForecastSnapshotService } from '../src/services/ForecastSnapshotService';
import { ForecastSobDemandaService } from '../src/services/ForecastSobDemandaService';
import type { Quinzena } from '../src/utils/forecastTypes';

// Fixture ANONIMIZADA (repo publico). saldoPedVenda: codigos anonimizados + quantidades sinteticas (SENTINELA + i).
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const SENTINELA = 7777.125;
const HOJE = '2026-10-20';
const PRODUTOS = fixture.produtos.slice(0, 30);
const SALDO_PED_VENDA = PRODUTOS.map((p, i) => ({ codigo: p.codigos[0]!, qtd: SENTINELA + i }));

type Mock = ReturnType<typeof vi.fn>;

function snapshot(origin: 'planilha' | 'dbcorp', comCampo: boolean) {
  const linhasDe = new Set(PRODUTOS.map((p) => String(p.linha)));
  return {
    id: 7,
    label: '10-2',
    baseDate: new Date('2026-10-15T00:00:00.000Z'),
    half: 2,
    origin,
    months: { consumo: fixture.mesesConsumo, chegada: fixture.mesesChegada, programacao: fixture.mesesProgramacao },
    products: PRODUTOS.map((p, i) => ({ ...p, productId: 100 + i })),
    inputs: comCampo ? { ...fixture.entradas, saldoPedVenda: SALDO_PED_VENDA } : fixture.entradas,
    expected:
      origin === 'planilha'
        ? Object.fromEntries(Object.entries(fixture.esperado).filter(([linha]) => linhasDe.has(linha)))
        : null,
    files: [{ kind: origin, fileName: 'quinzena.xlsx', sha256: 'abc', rows: 5 }],
    createdAt: new Date('2026-10-20T12:00:00.000Z'),
  };
}

async function celulas(contentBase64: string): Promise<unknown> {
  const wb = new exceljs.Workbook();
  await wb.xlsx.load(Buffer.from(contentBase64, 'base64') as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb.worksheets.map((ws) => {
    const linhas: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const valores: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => valores.push(cell.value));
      linhas[n] = valores;
    });
    return { aba: ws.name, linhas };
  });
}

const semCampoNaSaida = (saida: unknown) => {
  const texto = JSON.stringify(saida);
  expect(texto).not.toContain('saldoPedVenda');
  expect(texto).not.toContain(String(SENTINELA));
};

describe('D7: saldoPedVenda nao aparece nem altera nenhuma leitura da quinzena', () => {
  let findFirst: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    findFirst = fake.forecastSnapshot.findFirst;
    fake.forecastPurchaseDecision.findMany.mockResolvedValue([]);
    vi.spyOn(ForecastSobDemandaService, 'regrasDosProdutos').mockResolvedValue(new Map());
    vi.spyOn(ForecastGrupoEquivalenciaService, 'gruposDosProdutos').mockResolvedValue(new Map());
    vi.spyOn(ForecastMesesAtipicosService, 'doProdutos').mockResolvedValue(new Map());
    vi.spyOn(ForecastOcasioesService, 'contextoDoCalculo').mockResolvedValue(null);
    vi.spyOn(ForecastProductService, 'embalagensDosCodigos').mockResolvedValue([]);
    vi.spyOn(ForecastDemandaComercialService, 'abertas').mockResolvedValue([]);
    vi.spyOn(ForecastProductService, 'cadastroDeCodigos').mockResolvedValue({
      ativos: new Set(PRODUTOS.slice(0, 10).map((p) => p.codigos[0]!)),
      inativos: new Map(),
    } as never);
    vi.spyOn(ForecastProductService, 'vendasRecentes').mockResolvedValue({
      meses: ['2026-07', '2026-08', '2026-09'],
      anteriores: new Map(),
      ausentes: [],
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Executa `leitura` com a quinzena sem e com o campo e devolve as duas saidas.
  async function ambas<T>(origin: 'planilha' | 'dbcorp', leitura: () => Promise<T>) {
    findFirst.mockResolvedValue(snapshot(origin, false));
    const sem = await leitura();
    findFirst.mockResolvedValue(snapshot(origin, true));
    const com = await leitura();
    return { sem, com };
  }

  it.each(['planilha', 'dbcorp'] as const)('painel (getCalculated, %s) igual com e sem o campo', async (origin) => {
    const { sem, com } = await ambas(origin, () => ForecastSnapshotService.getCalculated(7, HOJE));
    expect(com).toEqual(sem);
    semCampoNaSaida(com);
  });

  it('relatorio de compras em JSON igual com e sem o campo', async () => {
    const { sem, com } = await ambas('dbcorp', () => ForecastSnapshotService.getRelatorioCompras(7, HOJE));
    expect(com).toEqual(sem);
    semCampoNaSaida(com);
  });

  it('XLSX do relatorio de compras: mesmo nome e mesmos valores de celula', async () => {
    const { sem, com } = await ambas('dbcorp', () => ForecastSnapshotService.getRelatorioComprasXlsx(7, HOJE));
    expect(com.fileName).toBe(sem.fileName);
    const valoresCom = await celulas(com.contentBase64);
    expect(valoresCom).toEqual(await celulas(sem.contentBase64));
    semCampoNaSaida(valoresCom);
  });

  it('XLSX MACRO: mesmo nome e mesmos valores de celula', async () => {
    const { sem, com } = await ambas('planilha', () => ForecastSnapshotService.getRelatorioComprasXlsxMacro(7, HOJE));
    expect(com.fileName).toBe(sem.fileName);
    const valoresCom = await celulas(com.contentBase64);
    expect(valoresCom).toEqual(await celulas(sem.contentBase64));
    semCampoNaSaida(valoresCom);
  }, 120_000);

  it('pendentes de cadastro (dbcorp) igual com e sem o campo', async () => {
    const { sem, com } = await ambas('dbcorp', () => ForecastSnapshotService.getPendentes(7));
    expect(com).toEqual(sem);
    semCampoNaSaida(com);
  });
});
