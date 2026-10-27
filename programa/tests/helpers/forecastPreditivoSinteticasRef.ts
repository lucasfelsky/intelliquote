// Series SINTETICAS da P1b-1 (nenhum dado real; so em memoria). Calendario 2024-01..2026-12 (t = 0..35), quantidades
// inteiras, ruido mulberry32 com semente fixa. Nenhum id lembra codigo de item real.
import { hashConfigRef } from '../../src/utils/forecastPreditivoConfigRef';
import type { CelulaCalibracao, TabelaCalibracao } from '../../src/utils/forecastPreditivoCalibracao';
import { somarMeses } from '../../src/utils/forecastPreditivoSerie';
import { PREDITIVO_VERSAO } from '../../src/utils/forecastPreditivoTipos';
import type { AnoMes, PontoMensal, SerieEntrada } from '../../src/utils/forecastPreditivoTipos';
import { CALENDARIO_INICIO, CALENDARIO_MESES, mulberry32 } from './forecastPreditivoSinteticas';

export const SEMENTE_REF = 20261029;

export const mesRef = (t: number): AnoMes => somarMeses(CALENDARIO_INICIO, t);

function trecho(de: number, ate: number, f: (t: number) => number): PontoMensal[] {
  const pontos: PontoMensal[] = [];
  for (let t = de; t <= ate; t++) pontos.push({ anoMes: mesRef(t), qtd: f(t) });
  return pontos;
}

const todos = (f: (t: number) => number) => trecho(0, CALENDARIO_MESES - 1, f);

// 11 series: vies negativo conhecido, pico real (sem a flag), ruptura (ignorada), 3/4/7/8 meses, dormente, degrau, zero.
export function seriesRef(): SerieEntrada[] {
  const rng = mulberry32(SEMENTE_REF);
  const ruido = () => 80 + Math.floor(rng() * 41);
  const ruptura = todos(() => 100);
  ruptura[33] = { anoMes: mesRef(33), qtd: 0, ruptura: true };
  ruptura[34] = { anoMes: mesRef(34), qtd: 0, ruptura: true };
  const degrau5 = [10, 10, 10, 10000, 10000];
  return [
    { id: 'R-CRESC', fonte: 'F01', leadTimeDias: 90, pontos: todos((t) => Math.round(100 * Math.pow(1.03, t))) },
    { id: 'R-ATIP', fonte: 'F02', leadTimeDias: 45, pontos: todos((t) => (t === 30 ? 600 : 100)) },
    { id: 'R-RUPT', fonte: 'F03', leadTimeDias: 30, pontos: ruptura },
    { id: 'R-CURTA3', fonte: 'F01', pontos: trecho(33, 35, ruido) },
    { id: 'R-CURTA4', fonte: 'F02', leadTimeDias: 30, pontos: trecho(32, 35, ruido) },
    { id: 'R-CURTA7', fonte: 'F03', leadTimeDias: 45, pontos: trecho(29, 35, ruido) },
    { id: 'R-CURTA8', fonte: 'F01', leadTimeDias: 120, pontos: trecho(28, 35, ruido) },
    { id: 'R-DORM', fonte: 'F02', leadTimeDias: 90, pontos: todos((t) => (t <= 23 ? 100 : 0)) },
    { id: 'R-DEGRAU5', fonte: 'F03', leadTimeDias: 30, pontos: trecho(31, 35, (t) => degrau5[t - 31]) },
    { id: 'R-DEGRAU', fonte: 'F01', leadTimeDias: 151, pontos: todos((t) => (t < 18 ? 10 : 10000)) },
    { id: 'R-ZERO', fonte: 'F02', leadTimeDias: 120, pontos: trecho(12, 35, () => 0) },
  ];
}

// Marcas de ForecastAtypicalMonth (produto x yearMonth): o pico real de R-ATIP.
export function marcasRef(): Map<string, AnoMes[]> {
  return new Map<string, AnoMes[]>([['R-ATIP', [mesRef(30)]]]);
}

const celulas = (celula: CelulaCalibracao['celula'], ms: number[], n: number, q10: number, q90: number): CelulaCalibracao[] =>
  ms.map((m) => ({ celula, m, n, q10, q90 }));

// Tabela de calibracao sintetica (so agregados): smooth n 30 (fronteira exata do minimo), TOTAL n 100, erratic h=1 com n 29
// (um abaixo do minimo: cai no TOTAL), lead time m = 2..6, nivel n 300 / razao 1,2 (fator 1,1 com k 300).
export function tabelaSintetica(sobrescrever: Partial<TabelaCalibracao> = {}): TabelaCalibracao {
  return {
    formato: 'preditivo-calibracao-v1',
    versao: PREDITIVO_VERSAO,
    hashConfig: hashConfigRef(),
    correcaoNivel: false,
    parametros: { horizonte: 6, minTreino: 6, historicoMaximo: 7, usarMascara: true, janelaNivelMeses: 12 },
    ultimoMes: '2026-12',
    mensal: [
      ...celulas('smooth', [1, 2, 3, 4, 5, 6], 30, -0.5, 0.5),
      ...celulas('erratic', [1], 29, -0.9, 0.9),
      ...celulas('TOTAL', [1, 2, 3, 4, 5, 6], 100, -0.4, 0.6),
    ],
    leadTime: [...celulas('smooth', [2, 3, 4, 5, 6], 30, -0.3, 0.3), ...celulas('TOTAL', [2, 3, 4, 5, 6], 100, -0.2, 0.4)],
    nivel: { n: 300, razao: 1.2 },
    ...sobrescrever,
  };
}
