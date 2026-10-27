// Forecast preditivo (P1a): uma linha (segmento x metodo) do backtest P1 e os criterios D5 1-5, 7 e 8. O criterio 3 e
// RELATIVO por padrao (decisao do Lucas, 2026-10-27); o teto absoluto e opcional (--teto-vies); o 8 exige 1-5 em cada metade.
// Metricas sobre a AMOSTRA COMUM: pares (serie, origem) com lead time observado (todos os metodos; sem previsao = Q).
import { criteriosFalhos } from './forecastPreditivoBacktest';
import type { MedidasPromocao, Obs, Promovivel } from './forecastPreditivoBacktest';
import { PREDITIVO_CONFIG_P1 } from './forecastPreditivoConfigP1';
import { pinball } from './forecastPreditivoIntervalos';
import type { Intervalo } from './forecastPreditivoIntervalos';
import { custoNoLeadTime } from './forecastPreditivoMetricas';
import type { Erro } from './forecastPreditivoMetricas';
import type { Abc } from './forecastPreditivoSegmentos';
import { PREDITIVO_CONFIG as C } from './forecastPreditivoTipos';
import type { AnoMes, MetodoTodosId } from './forecastPreditivoTipos';

// Criterio 3 (D5, relativo): |vies do metodo| <= |vies da planilha Q| + folga (2 p.p.), no mesmo segmento e janela; vies da Q
// indefinido (null) vale 0. Sem teto absoluto: tetoVies null e o padrao; um numero soma o corte |vies| <= tetoVies (opcional).
export function passaCriterio3(viesLT: number | null, viesRef: number | null, tetoVies: number | null): boolean {
  if (viesLT === null) return false;
  if (tetoVies !== null && Math.abs(viesLT) > tetoVies) return false;
  return Math.abs(viesLT) <= Math.abs(viesRef ?? 0) + C.promocao.viesFolga;
}

// Criterios 1, 2, 4 e 5 da fase 0 + o 3 relativo (o 3 da fase 0, com teto fixo 0,10, e legado do --relatorio p0). Ordenado crescente.
export function criteriosFalhosP1(m: MedidasPromocao, tetoVies: number | null): number[] {
  const falhos = criteriosFalhos(m).filter((c) => c !== 3);
  if (!passaCriterio3(m.viesLT, m.viesRef, tetoVies)) falhos.push(3);
  return falhos.sort((a, b) => a - b);
}

// Criterio 7: cobertura do intervalo p10-p90 em [0,72; 0,88] com >= 30 pares com intervalo.
export function falhaCriterio7(cobertura: number | null, nIntervalo: number): boolean {
  const I = PREDITIVO_CONFIG_P1.intervalo;
  return cobertura === null || nIntervalo < I.minPares || cobertura < I.coberturaMin || cobertura > I.coberturaMax;
}

export interface ResumoMetade {
  n: number;
  origens: number;
  wapeLT: number | null;
  wapeRef: number | null;
  viesLT: number | null;
  viesRef: number | null;
  custoRel: number | null;
  vitoria: number | null;
  criteriosFalhos: number[]; // 1..5 (3 relativo; teto absoluto so se pedido)
}

export interface LinhaP1 {
  segmento: string;
  metodo: MetodoTodosId;
  n: number;
  origens: number;
  nFallback: number;
  wapeH1: number | null;
  wapeH3: number | null;
  wapeLT: number | null;
  wapeRef: number | null;
  wapeRel: number | null;
  viesLT: number | null;
  viesRef: number | null;
  maeLT: number | null;
  custoLT: number;
  custoRel: number | null;
  faltaLT: number;
  excessoLT: number;
  vitoria: number | null;
  cobertura: number | null;
  nIntervalo: number;
  nPoolTotal: number; // pares cujo intervalo veio do pool TOTAL (celula com poucos residuos)
  pinball10: number | null;
  pinball90: number | null;
  metade1: ResumoMetade;
  metade2: ResumoMetade;
  criteriosFalhos: number[];
  promovivel: Promovivel;
  itensAPiores: string[];
}

export interface ObsP1 {
  obs: Obs;
  fallback: boolean;
  intervalo: Intervalo | null;
}
export interface ParLinha {
  serieId: string;
  origem: AnoMes;
  abc: Abc;
}
export interface ContextoLinha {
  pares: readonly ParLinha[];
  razaoFaltaExcesso: number;
  tetoVies: number | null;
  ultimoMes1: AnoMes | null; // ultimo mes de origem da metade 1 (null: metade 1 vazia)
}

// Soma sequencial na ordem dos pares: o resultado e IDENTICO ao de wape/vies/mae da fase 0 (mesma conta, mesma ordem),
// sem montar um array de Erro por segmento (o backtest avalia ~8 segmentos x todos os metodos por par).
interface Acc {
  n: number;
  real: number;
  absM: number;
  absR: number;
}
const razaoOuNull = (num: number, den: number, n: number): number | null => (n === 0 || den === 0 ? null : num / den);

function medir(sub: number[], meu: readonly ObsP1[], ref: readonly ObsP1[], ctx: ContextoLinha) {
  let real = 0;
  let absM = 0;
  let difM = 0;
  let absR = 0;
  let difR = 0;
  let custoM = 0;
  let custoR = 0;
  let falta = 0;
  let excesso = 0;
  const meses = new Set<AnoMes>();
  const porSerie = new Map<string, Acc>();
  const porSerieA = new Map<string, Acc>();
  const somar = (mapa: Map<string, Acc>, id: string, e: Erro, r: Erro) => {
    const a = mapa.get(id);
    if (a) {
      a.n++;
      a.real += e.real;
      a.absM += Math.abs(e.real - e.previsto);
      a.absR += Math.abs(r.real - r.previsto);
    } else mapa.set(id, { n: 1, real: e.real, absM: Math.abs(e.real - e.previsto), absR: Math.abs(r.real - r.previsto) });
  };
  for (const p of sub) {
    const e = meu[p].obs.lt!;
    const r = ref[p].obs.lt!;
    real += e.real;
    absM += Math.abs(e.real - e.previsto);
    difM += e.previsto - e.real;
    absR += Math.abs(r.real - r.previsto);
    difR += r.previsto - r.real;
    const cm = custoNoLeadTime(e.real, e.previsto, ctx.razaoFaltaExcesso);
    custoM += cm.custo;
    falta += cm.falta;
    excesso += cm.excesso;
    custoR += custoNoLeadTime(r.real, r.previsto, ctx.razaoFaltaExcesso).custo;
    meses.add(e.origem);
    somar(porSerie, e.serieId, e, r);
    if (ctx.pares[p].abc === 'A') somar(porSerieA, e.serieId, e, r);
  }
  const n = sub.length;
  let comparaveis = 0;
  let vitorias = 0;
  for (const a of porSerie.values()) {
    const wm = razaoOuNull(a.absM, a.real, a.n);
    const wr = razaoOuNull(a.absR, a.real, a.n);
    if (wm === null || wr === null) continue;
    comparaveis++;
    if (wm < wr) vitorias++;
  }
  const piores: string[] = []; // criterio 6: series A com WAPE LT > guardaA x o da planilha (so listadas)
  for (const [id, a] of porSerieA) {
    const wm = razaoOuNull(a.absM, a.real, a.n);
    const wr = razaoOuNull(a.absR, a.real, a.n);
    if (wm !== null && wr !== null && wm > C.promocao.guardaA * wr) piores.push(id);
  }
  const m: MedidasPromocao = {
    origens: meses.size,
    n,
    wapeLT: razaoOuNull(absM, real, n),
    wapeRef: razaoOuNull(absR, real, n),
    viesLT: razaoOuNull(difM, real, n),
    viesRef: razaoOuNull(difR, real, n),
    custoRel: custoR > 0 ? custoM / custoR : null,
    vitoria: comparaveis > 0 ? vitorias / comparaveis : null,
  };
  return { m, custoM, falta, excesso, maeLT: n === 0 ? null : absM / n, piores: piores.sort() };
}

function resumoMetade(sub: number[], meu: readonly ObsP1[], ref: readonly ObsP1[], ctx: ContextoLinha, referencia: boolean): ResumoMetade {
  const { m } = medir(sub, meu, ref, ctx);
  const { n, origens, wapeLT, wapeRef, viesLT, viesRef, custoRel, vitoria } = m;
  return {
    n,
    origens,
    wapeLT,
    wapeRef,
    viesLT,
    viesRef,
    custoRel,
    vitoria,
    criteriosFalhos: referencia ? [] : criteriosFalhosP1(m, ctx.tetoVies),
  };
}

// WAPE de h1 ou h3 sobre todos os pares do segmento em que esse horizonte foi observado.
function wapeHorizonte(indices: number[], meu: readonly ObsP1[], campo: 'h1' | 'h3'): number | null {
  let real = 0;
  let abs = 0;
  let n = 0;
  for (const p of indices) {
    const e = meu[p].obs[campo];
    if (!e) continue;
    n++;
    real += e.real;
    abs += Math.abs(e.real - e.previsto);
  }
  return razaoOuNull(abs, real, n);
}

// indices = todos os pares do segmento; meu/ref = resultados por par (ref = planilha Q). Amostra = pares com lead time observado.
export function calcularLinhaP1(
  segmento: string,
  metodo: MetodoTodosId,
  indices: number[],
  meu: readonly ObsP1[],
  ref: readonly ObsP1[],
  ctx: ContextoLinha,
): LinhaP1 {
  const referencia = metodo === 'planilha-q';
  const amostra = indices.filter((p) => meu[p].obs.lt);
  const total = medir(amostra, meu, ref, ctx);
  const { m } = total;
  const metade1 = resumoMetade(amostra.filter((p) => ctx.ultimoMes1 !== null && ctx.pares[p].origem <= ctx.ultimoMes1), meu, ref, ctx, referencia);
  const metade2 = resumoMetade(amostra.filter((p) => ctx.ultimoMes1 === null || ctx.pares[p].origem > ctx.ultimoMes1), meu, ref, ctx, referencia);
  // intervalo: cobertura = fracao dos pares com intervalo em [p10, p90] (mesma regra de cobertura() da fase 0); pinball sobre eles
  const q = PREDITIVO_CONFIG_P1.intervalo;
  let nIntervalo = 0;
  let cobertos = 0;
  let nPoolTotal = 0;
  let somaReal = 0;
  let perda10 = 0;
  let perda90 = 0;
  for (const p of amostra) {
    const iv = meu[p].intervalo;
    if (!iv) continue;
    const e = meu[p].obs.lt!;
    nIntervalo++;
    if (iv.p10 <= e.real && e.real <= iv.p90) cobertos++;
    if (iv.fonte === 'total') nPoolTotal++;
    somaReal += e.real;
    perda10 += pinball(e.real, iv.p10, q.q10);
    perda90 += pinball(e.real, iv.p90, q.q90);
  }
  const cob = nIntervalo === 0 ? null : cobertos / nIntervalo;
  const f = referencia ? [] : criteriosFalhosP1(m, ctx.tetoVies);
  if (!referencia && falhaCriterio7(cob, nIntervalo)) f.push(7);
  if (!referencia && (metade1.criteriosFalhos.length > 0 || metade2.criteriosFalhos.length > 0)) f.push(8);
  const decisao = (lista: number[]): Promovivel => (referencia ? 'referencia' : lista.length > 0 ? 'nao' : 'candidato');
  return {
    segmento,
    metodo,
    n: m.n,
    origens: m.origens,
    nFallback: amostra.filter((p) => meu[p].fallback).length,
    wapeH1: wapeHorizonte(indices, meu, 'h1'),
    wapeH3: wapeHorizonte(indices, meu, 'h3'),
    wapeLT: m.wapeLT,
    wapeRef: m.wapeRef,
    wapeRel: m.wapeLT !== null && m.wapeRef !== null && m.wapeRef !== 0 ? m.wapeLT / m.wapeRef : null,
    viesLT: m.viesLT,
    viesRef: m.viesRef,
    maeLT: total.maeLT,
    custoLT: total.custoM,
    custoRel: m.custoRel,
    faltaLT: total.falta,
    excessoLT: total.excesso,
    vitoria: referencia ? null : m.vitoria,
    cobertura: cob,
    nIntervalo,
    nPoolTotal,
    pinball10: somaReal === 0 ? null : perda10 / somaReal,
    pinball90: somaReal === 0 ? null : perda90 / somaReal,
    metade1,
    metade2,
    criteriosFalhos: f,
    promovivel: decisao(f),
    itensAPiores: referencia ? [] : total.piores,
  };
}
