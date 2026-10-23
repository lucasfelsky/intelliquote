import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceljs from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  FORECAST_DBCORP_ETA_POR_ETD_DIAS,
  FORECAST_DBCORP_ETA_POR_PRONTIDAO_DIAS,
} from '../src/constants/forecast';
import { parseFup } from '../src/utils/forecastDbcorp';
import { calcular, conferir } from '../src/utils/forecastEngine';
import { rotulosDaQuinzena, somarDias, yearMonthsDaJanela } from '../src/utils/forecastMonths';
import type { Quinzena } from '../src/utils/forecastTypes';

// Paridade da regra F3 com a fixture ANONIMIZADA (repo publico: nenhum dado real). O FUP e montado em
// memoria a partir de `entradas.chegadas` da fixture: cada chegada vira 1 linha do FUP em um dos 3 modos
// (ETA, ETD + 35, DATA PRONTIDAO + 35), mais distratores que a F3 TEM que deixar de fora. As chegadas que
// o parser devolve precisam ser as da fixture e o motor precisa bater com todas as celulas conferidas.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;
const BASE = fixture.dataBase;
const HOJE = '2026-10-20';

const HEADERS = [
  'STATUS',
  'EXPORTADOR',
  'PO',
  'CÓD. SQ',
  'QTD - KGS',
  'ETD (EMBARQUE)',
  'ETA (CHEGADA)',
  'ETA FINAL',
  'DATA PO',
  'DATA PRONTIDÃO',
];

type Cell = string | number | Date | null;

const dia = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const MESES_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// 'SEP 30TH', 'OCT 1ST', 'NOV 22ND', 'DEC 3RD', 'JAN 12TH' (sufixo em ingles correto).
function prontidaoTexto(key: string): string {
  const mes = MESES_EN[Number(key.slice(5, 7)) - 1];
  const d = Number(key.slice(8, 10));
  const excecao = d % 100 >= 11 && d % 100 <= 13;
  const sufixo = excecao ? 'TH' : (['TH', 'ST', 'ND', 'RD'][d % 10] ?? 'TH');
  return `${mes} ${d}${sufixo}`;
}

async function xlsx(rows: Cell[][]): Promise<Buffer> {
  const workbook = new exceljs.Workbook();
  const ws = workbook.addWorksheet('FUP');
  HEADERS.forEach((h, i) => (ws.getCell(1, i + 1).value = h));
  rows.forEach((row, ri) =>
    row.forEach((value, ci) => {
      if (value !== null) ws.getCell(2 + ri, ci + 1).value = value;
    }),
  );
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const linhaFup = (
  status: string,
  codigo: string,
  kg: number,
  etd: Cell = null,
  eta: Cell = null,
  etaFinal: Cell = null,
  dataPo: Cell = null,
  prontidao: Cell = null,
): Cell[] => [status, 'Exportador teste', 'PO-1', codigo, kg, etd, eta, etaFinal, dataPo, prontidao];

const rotulos = rotulosDaQuinzena(BASE).chegada; // MM da janela de chegadas
const yearMonths = yearMonthsDaJanela(BASE, rotulos.length); // YYYY-MM na mesma ordem
const anoMesDoRotulo = new Map(rotulos.map((mm, i) => [mm, yearMonths[i]]));
// So as chegadas que o motor enxerga (a fixture tem 1 linha com mes fora da janela; nao e FUP).
const chegadasDaJanela = fixture.entradas.chegadas.filter((c) => anoMesDoRotulo.has(c.mes));

const chave = (c: { codigo: string; mes: string }) => `${c.codigo}|${c.mes}`;
function somaPorChave(lista: Array<{ codigo: string; mes: string; qtd: number }>): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const c of lista) mapa.set(chave(c), (mapa.get(chave(c)) ?? 0) + c.qtd);
  return mapa;
}

async function montarFup() {
  const rows: Cell[][] = [];
  const contagem = { eta: 0, etd: 0, prontidao: 0 };
  chegadasDaJanela.forEach((c, i) => {
    const alvo = `${anoMesDoRotulo.get(c.mes)}-20`;
    const modo = i % 3;
    if (modo === 0) {
      rows.push(linhaFup('EMBARCOU', c.codigo, c.qtd, null, dia(alvo)));
      contagem.eta++;
    } else if (modo === 1) {
      rows.push(linhaFup('AG. EMBARQUE', c.codigo, c.qtd, dia(somarDias(alvo, -FORECAST_DBCORP_ETA_POR_ETD_DIAS))));
      contagem.etd++;
    } else {
      const pronta = somarDias(alvo, -FORECAST_DBCORP_ETA_POR_PRONTIDAO_DIAS);
      rows.push(
        linhaFup('AG. PRONT. DA CARGA', c.codigo, c.qtd, null, null, null, dia(somarDias(alvo, -60)), prontidaoTexto(pronta)),
      );
      contagem.prontidao++;
    }
  });

  // Distratores (codigos da propria fixture): a F3 tem que deixar todos de fora das chegadas.
  const codigos = [...new Set(fixture.entradas.chegadas.map((c) => c.codigo))];
  const passada = dia('2026-09-12');
  for (let i = 0; i < 3; i++) {
    rows.push(linhaFup('ATRAC. AG. LIBERAÇÃO', codigos[i], 1000 + i, null, passada, passada)); // ETA e ETA FINAL passadas
  }
  for (let i = 3; i < 6; i++) {
    rows.push(linhaFup('EMBARCOU', codigos[i], 2000 + i, null, dia('2026-11-20'), passada)); // ETA FINAL passada
  }
  for (let i = 6; i < 8; i++) rows.push(linhaFup('CONCLUÍDO', codigos[i], 3000 + i, null, dia('2026-11-20')));
  rows.push(linhaFup('AG. PAGAMENTO (ANT)', codigos[8], 4000, null, null, null, dia('2026-10-01'), 'ASAP'));
  rows.push(linhaFup('AG. PAGAMENTO (ANT)', codigos[9], 5000));
  return { buffer: await xlsx(rows), contagem };
}

describe('F3 x fixture anonimizada (paridade do FUP sintetico)', () => {
  it('as chegadas do parser sao as da fixture, o motor bate com a planilha e os distratores ficam fora', async () => {
    const { buffer, contagem } = await montarFup();
    const r = await parseFup(buffer, BASE);
    expect(r.erros).toEqual([]);
    expect(r.avisos.join('\n')).not.toMatch(/coluna "/); // as 2 colunas opcionais existem

    // (1) soma por codigo|mes == soma da fixture
    const obtido = somaPorChave(r.linhas);
    const esperado = somaPorChave(chegadasDaJanela);
    expect([...obtido.keys()].sort()).toEqual([...esperado.keys()].sort());
    for (const [k, v] of esperado) expect(Math.abs((obtido.get(k) ?? 0) - v)).toBeLessThan(1e-6);
    const totalFixture = chegadasDaJanela.reduce((a, c) => a + c.qtd, 0);
    expect(Math.abs(r.total - totalFixture)).toBeLessThan(1e-3);

    // (2) o motor, com as chegadas do parser, bate com todas as celulas que a planilha calculou
    const original = conferir(fixture, calcular(fixture, { hoje: HOJE, quinzena: 2, somarChegada5oMes: false }));
    expect(original.batem).toBe(original.celulas);
    const q: Quinzena = { ...fixture, entradas: { ...fixture.entradas, chegadas: r.linhas } };
    const conferencia = conferir(q, calcular(q, { hoje: HOJE, quinzena: 2, somarChegada5oMes: false }));
    expect(conferencia.divergencias.slice(0, 5)).toEqual([]);
    expect(conferencia.celulas).toBe(original.celulas);
    expect(conferencia.batem).toBe(conferencia.celulas);

    // (3) contagens por motivo
    expect(r.estimadasPorProntidao.linhas).toBe(contagem.prontidao);
    expect(r.estimadasPorEtd.linhas).toBe(contagem.etd);
    expect(r.linhas.filter((l) => l.estimada === 'prontidao')).toHaveLength(contagem.prontidao);
    expect(r.linhas.filter((l) => l.estimada === 'etd')).toHaveLength(contagem.etd);
    expect(r.linhas.filter((l) => l.estimada === undefined)).toHaveLength(contagem.eta);
    expect(r.excluidas.atracadas.linhas).toBe(3);
    expect(r.excluidas.etaFinalPreenchida.linhas).toBe(3);
    expect(r.prontidaoNaoReconhecida.linhas).toBe(1);
    expect(r.semData.linhas).toBe(1);
    expect(r.vencidasNoMesBase.linhas).toBe(0);

    // kg dos distratores nao aparece nas chegadas
    expect(r.excluidas.atracadas.kg).toBe(1000 + 1001 + 1002);
    expect(r.excluidas.etaFinalPreenchida.kg).toBe(2003 + 2004 + 2005);
    expect(r.prontidaoNaoReconhecida.kg).toBe(4000);
    expect(r.semData.kg).toBe(5000);
    expect(r.lidas).toBe(chegadasDaJanela.length + 3 + 3 + 2 + 1 + 1);
    expect(r.usadas).toBe(chegadasDaJanela.length);
  });
});
