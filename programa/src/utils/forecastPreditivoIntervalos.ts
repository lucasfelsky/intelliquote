// Forecast preditivo (P1a): intervalos empiricos p10/p90 da SOMA da previsao no lead time, SEM vazamento. O residuo de um
// par (serie, origem) e (real - previsto) / escala, onde escala = nivel medio dos ultimos 12 meses x meses do lead time.
// Um residuo so vale para pares cuja origem seja >= ao ultimo mes realizado da janela dele (a "liberacao"): na origem o,
// o mes o ja e conhecido. Pool por celula (celula|hl) com fallback para TOTAL|hl; minimo de residuos por pool.
import { mediaValidos } from './forecastPreditivoBaselines';
import { PREDITIVO_CONFIG_P1 } from './forecastPreditivoConfigP1';
import { indiceMes } from './forecastPreditivoSerie';
import type { AnoMes, SerieNormalizada } from './forecastPreditivoTipos';

// Quantil tipo 7 (interpolacao linear, pos = (n-1) q) sobre valores ORDENADOS crescentes; vazio -> null.
export function quantil(ordenados: readonly number[], q: number): number | null {
  if (!(q >= 0 && q <= 1)) throw new Error('quantil fora de [0, 1]');
  const n = ordenados.length;
  if (n === 0) return null;
  const pos = (n - 1) * q;
  const base = Math.floor(pos);
  const seguinte = Math.min(base + 1, n - 1);
  return ordenados[base] + (pos - base) * (ordenados[seguinte] - ordenados[base]);
}

// Perda pinball de um quantil q: u = real - previsto; u >= 0 ? q u : (q - 1) u.
export function pinball(real: number, previsto: number, q: number): number {
  const u = real - previsto;
  return u >= 0 ? q * u : (q - 1) * u;
}

// Nivel medio dos ultimos `janela` meses de calendario (sem mascarados) x meses do lead time.
export function escalaLeadTime(s: SerieNormalizada, hl: number, janela = PREDITIVO_CONFIG_P1.intervalo.janelaEscala): number {
  return mediaValidos(s.valores, s.mascara, janela).media * hl;
}

export interface ParIntervalo {
  indice: number; // desempate estavel (posicao do par)
  origem: AnoMes;
  liberacao: AnoMes; // origem + hl: ultimo mes realizado da janela do lead time
  celula: string;
  hl: number;
  previstoLT: number;
  realLT: number;
  escala: number;
}

export interface Intervalo {
  p10: number;
  p90: number;
  fonte: 'celula' | 'total';
}

interface Pool {
  valores: number[];
  sujo: boolean; // houve insercao desde o ultimo calculo dos quantis
  q10: number | null;
  q90: number | null;
}

const ordemNumerica = (a: number, b: number) => a - b;

// Resultado indexado pela posicao em `pares`; null = sem intervalo (escala 0 ou pool pequeno demais). Custo ~ N log N + (meses x pools):
// os quantis de cada pool sao recalculados no maximo uma vez por mes de origem, nunca por par.
export function intervalosEmpiricos(
  pares: readonly ParIntervalo[],
  cfg: typeof PREDITIVO_CONFIG_P1.intervalo = PREDITIVO_CONFIG_P1.intervalo,
): (Intervalo | null)[] {
  const saida: (Intervalo | null)[] = new Array<Intervalo | null>(pares.length).fill(null);
  const elegiveis: number[] = []; // posicoes de pares com escala > 0
  pares.forEach((p, i) => {
    if (p.escala > 0) elegiveis.push(i);
  });
  const residuo = (i: number) => (pares[i].realLT - pares[i].previstoLT) / pares[i].escala;
  const lib = elegiveis.map((i) => indiceMes(pares[i].liberacao));
  const porLiberacao = elegiveis
    .map((i, k) => ({ i, lib: lib[k] }))
    .sort((a, b) => a.lib - b.lib || pares[a.i].indice - pares[b.i].indice || a.i - b.i);

  const porMes = new Map<number, number[]>();
  for (const i of elegiveis) {
    const m = indiceMes(pares[i].origem);
    const lista = porMes.get(m);
    if (lista) lista.push(i);
    else porMes.set(m, [i]);
  }
  const pools = new Map<string, Pool>();
  const adicionar = (chave: string, v: number) => {
    const pool = pools.get(chave);
    if (pool) {
      pool.valores.push(v);
      pool.sujo = true;
    } else pools.set(chave, { valores: [v], sujo: true, q10: null, q90: null });
  };
  const quantis = (pool: Pool): Pool => {
    if (pool.sujo) {
      pool.valores.sort(ordemNumerica);
      pool.q10 = quantil(pool.valores, cfg.q10);
      pool.q90 = quantil(pool.valores, cfg.q90);
      pool.sujo = false;
    }
    return pool;
  };

  let proximo = 0;
  for (const mes of [...porMes.keys()].sort(ordemNumerica)) {
    while (proximo < porLiberacao.length && porLiberacao[proximo].lib <= mes) {
      const p = pares[porLiberacao[proximo].i];
      const r = residuo(porLiberacao[proximo].i);
      adicionar(`${p.celula}|${p.hl}`, r);
      adicionar(`TOTAL|${p.hl}`, r);
      proximo++;
    }
    for (const i of porMes.get(mes)!) {
      const p = pares[i];
      const celula = pools.get(`${p.celula}|${p.hl}`);
      const total = pools.get(`TOTAL|${p.hl}`);
      let escolhido: Pool | null = null;
      let fonte: Intervalo['fonte'] = 'celula';
      if (celula && celula.valores.length >= cfg.minResiduos) escolhido = quantis(celula);
      else if (total && total.valores.length >= cfg.minResiduos) {
        escolhido = quantis(total);
        fonte = 'total';
      }
      if (escolhido === null || escolhido.q10 === null || escolhido.q90 === null) continue;
      saida[i] = {
        p10: Math.max(0, p.previstoLT + escolhido.q10 * p.escala),
        p90: Math.max(0, p.previstoLT + escolhido.q90 * p.escala),
        fonte,
      };
    }
  }
  return saida;
}
