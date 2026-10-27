// Series SINTETICAS do Forecast preditivo (nenhum dado real). Determinísticas: formulas + mulberry32 com semente fixa.
// Calendario 2024-01..2026-12 (36 meses, t = 0..35); quantidades inteiras.
import { somarMeses } from '../../src/utils/forecastPreditivoSerie';
import type { PontoMensal, SerieEntrada } from '../../src/utils/forecastPreditivoTipos';

export const CALENDARIO_INICIO = '2024-01';
export const CALENDARIO_MESES = 36;
export const SEMENTE_RUIDO = 20261027;

const mes = (t: number) => somarMeses(CALENDARIO_INICIO, t);

export function mulberry32(semente: number): () => number {
  let a = semente | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TABELA_SAZONAL = [100, 110, 125, 130, 125, 110, 100, 90, 75, 70, 75, 90];

// t de `de` ate `ate` (inclusive), com f(t) -> quantidade.
function trecho(de: number, ate: number, f: (t: number) => number): PontoMensal[] {
  const pontos: PontoMensal[] = [];
  for (let t = de; t <= ate; t++) pontos.push({ anoMes: mes(t), qtd: f(t) });
  return pontos;
}

const todos = (f: (t: number) => number) => trecho(0, CALENDARIO_MESES - 1, f);
const constante = () => todos(() => 100);

export function seriesSinteticas(): SerieEntrada[] {
  const rng = mulberry32(SEMENTE_RUIDO);
  const atipica = constante();
  atipica[34] = { anoMes: mes(34), qtd: 500, atipico: true };
  const ruptura = constante();
  ruptura[33] = { anoMes: mes(33), qtd: 0, ruptura: true };
  ruptura[34] = { anoMes: mes(34), qtd: 0, ruptura: true };
  return [
    { id: 'CONST', fonte: 'F01', familia: 'FAM1', leadTimeDias: 90, pontos: constante() },
    { id: 'TEND', fonte: 'F02', familia: 'FAM1', leadTimeDias: 30, pontos: todos((t) => 100 + 5 * t) },
    { id: 'SAZ', fonte: 'F03', familia: 'FAM2', leadTimeDias: 120, pontos: todos((t) => TABELA_SAZONAL[t % 12]) },
    { id: 'INTERM', fonte: 'F01', familia: 'FAM2', leadTimeDias: 90, pontos: todos((t) => (t % 3 === 2 ? 60 : 0)) },
    {
      id: 'LUMPY',
      fonte: 'F02',
      familia: 'FAM1',
      leadTimeDias: 120,
      pontos: todos((t) => (t % 3 === 2 ? ((t - 2) / 3) % 2 === 0 ? 20 : 200 : 0)),
    },
    { id: 'RUIDO', fonte: 'F03', familia: 'FAM1', leadTimeDias: 30, pontos: todos(() => 100 + Math.floor(rng() * 21) - 10) },
    { id: 'NOVA', fonte: 'F01', familia: 'FAM2', leadTimeDias: 30, pontos: [{ anoMes: mes(34), qtd: 50 }, { anoMes: mes(35), qtd: 70 }] },
    { id: 'ZERO', fonte: 'F02', familia: 'FAM2', leadTimeDias: 90, pontos: trecho(12, 35, () => 0) },
    { id: 'ATIP', fonte: 'F03', familia: 'FAM1', leadTimeDias: 90, pontos: atipica },
    { id: 'RUPT', fonte: 'F01', familia: 'FAM1', leadTimeDias: 120, pontos: ruptura },
    { id: 'DEGRAU', fonte: 'F02', familia: 'FAM2', leadTimeDias: 30, pontos: trecho(12, 35, (t) => (t < 24 ? 10 : 10000)) },
  ];
}

// Duas series sem 2025-06 em NENHUMA: ambas comecam em 2025-07 (lacuna-cortada). Fora do CSV (uma lacuna global cortaria todas).
export function serieLacuna(): SerieEntrada[] {
  const sem = (f: (t: number) => number) => trecho(12, 23, f).filter((p) => p.anoMes !== '2025-06');
  return [
    { id: 'LAC1', pontos: sem((t) => 10 + t) },
    { id: 'LAC2', pontos: sem(() => 40) },
  ];
}

const CABECALHO = 'serie;anoMes;quantidade;atipico;ruptura;fonte;familia;leadTimeDias';

// CSV (LF, sem BOM) com as series sinteticas: e o arquivo versionado tests/fixtures/forecast/preditivo-sinteticas.csv.
export function gerarCsvSinteticas(): string {
  const linhas = [CABECALHO];
  for (const s of seriesSinteticas()) {
    for (const p of s.pontos) {
      linhas.push(
        [s.id, p.anoMes, String(p.qtd), p.atipico ? '1' : '0', p.ruptura ? '1' : '0', s.fonte, s.familia, String(s.leadTimeDias)].join(';'),
      );
    }
  }
  return linhas.join('\n') + '\n';
}
