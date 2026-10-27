// Series SINTETICAS da P1a (nenhum dado real). Determinísticas: formulas + mulberry32 com semente fixa.
// Calendario 2024-01..2026-12 (36 meses, t = 0..35); quantidades inteiras. So em memoria: nada daqui e versionado como CSV.
import { somarMeses } from '../../src/utils/forecastPreditivoSerie';
import type { PontoMensal, SerieEntrada } from '../../src/utils/forecastPreditivoTipos';
import { CALENDARIO_INICIO, CALENDARIO_MESES, mulberry32 } from './forecastPreditivoSinteticas';

export const SEMENTE_P1 = 20261028;

const mes = (t: number) => somarMeses(CALENDARIO_INICIO, t);

function trecho(de: number, ate: number, f: (t: number) => number): PontoMensal[] {
  const pontos: PontoMensal[] = [];
  for (let t = de; t <= ate; t++) pontos.push({ anoMes: mes(t), qtd: f(t) });
  return pontos;
}

const todos = (f: (t: number) => number) => trecho(0, CALENDARIO_MESES - 1, f);
const SAZONAL = [100, 110, 125, 130, 125, 110, 100, 90, 75, 70, 75, 90];
const fonte = (n: number) => 'F' + String(n).padStart(2, '0');

// 14 series: lead times 45/60/61/90/91/150/151/null, fontes F01..F12 (+1 sem fonte), dormente, degrau, 7 meses, intermitente.
export function seriesP1(): SerieEntrada[] {
  const rng = mulberry32(SEMENTE_P1);
  const ruido = (base: number, amp: number) => () => base + Math.floor(rng() * (2 * amp + 1)) - amp;
  return [
    { id: 'P-LT45', fonte: fonte(1), leadTimeDias: 45, pontos: todos(ruido(100, 10)) },
    { id: 'P-LT60', fonte: fonte(2), leadTimeDias: 60, pontos: todos((t) => 50 + 2 * t + Math.floor(rng() * 7)) },
    { id: 'P-LT61', fonte: fonte(3), leadTimeDias: 61, pontos: todos((t) => SAZONAL[t % 12] + Math.floor(rng() * 9)) },
    { id: 'P-LT90', fonte: fonte(4), leadTimeDias: 90, pontos: todos(ruido(200, 30)) },
    { id: 'P-LT91', fonte: fonte(5), leadTimeDias: 91, pontos: todos(ruido(80, 15)) },
    { id: 'P-LT150', fonte: fonte(6), leadTimeDias: 150, pontos: todos(ruido(60, 6)) },
    { id: 'P-LT151', fonte: fonte(7), leadTimeDias: 151, pontos: todos(ruido(40, 8)) },
    { id: 'P-LTNULO', fonte: fonte(8), pontos: todos(ruido(120, 20)) },
    { id: 'P-DORM', fonte: fonte(9), leadTimeDias: 90, pontos: todos((t) => (t <= 23 ? 70 + Math.floor(rng() * 11) : 0)) },
    { id: 'P-DEGRAU', fonte: fonte(10), leadTimeDias: 30, pontos: todos((t) => (t < 18 ? 10 : 10000)) },
    { id: 'P-CURTA', fonte: fonte(11), leadTimeDias: 30, pontos: trecho(29, 35, (t) => 20 + (t % 4)) },
    { id: 'P-INTERM', fonte: fonte(12), leadTimeDias: 90, pontos: todos((t) => (t % 3 === 2 ? 50 + Math.floor(rng() * 10) : 0)) },
    { id: 'P-SEMFONTE', leadTimeDias: 120, pontos: todos(ruido(90, 12)) },
    { id: 'P-TEND', fonte: fonte(1), leadTimeDias: 60, pontos: todos((t) => 100 + 4 * t) },
  ];
}

// n series de 36 meses para o gate de desempenho: formas das sinteticas da fase 0 com fator 0,5..1,5, LT 14..133.
export function seriesDesempenho(n: number): SerieEntrada[] {
  const rng = mulberry32(SEMENTE_P1 + 1);
  const formas: ((t: number) => number)[] = [
    () => 100,
    (t) => 100 + 5 * t,
    (t) => SAZONAL[t % 12],
    (t) => (t % 3 === 2 ? 60 : 0),
    (t) => (t % 3 === 2 ? (((t - 2) / 3) % 2 === 0 ? 20 : 200) : 0),
    () => 90 + Math.floor(rng() * 21),
  ];
  return Array.from({ length: n }, (_, i) => {
    const fator = 0.5 + rng();
    const forma = formas[i % formas.length];
    return {
      id: 'D' + String(i + 1).padStart(4, '0'),
      fonte: fonte(1 + Math.floor(rng() * 12)),
      familia: 'FAM' + (1 + (i % 3)),
      leadTimeDias: 14 + Math.floor(rng() * 120),
      pontos: todos((t) => Math.round(forma(t) * fator)),
    };
  });
}

const CABECALHO = 'serie;anoMes;quantidade;atipico;ruptura;fonte;familia;leadTimeDias';

// CSV (LF, sem BOM) no formato da fase 0, para o gate de desempenho (gravado fora do repo).
export function gerarCsvDesempenho(n: number): string {
  const linhas = [CABECALHO];
  for (const s of seriesDesempenho(n)) {
    for (const p of s.pontos) linhas.push([s.id, p.anoMes, String(p.qtd), '0', '0', s.fonte, s.familia, String(s.leadTimeDias)].join(';'));
  }
  return linhas.join('\n') + '\n';
}
