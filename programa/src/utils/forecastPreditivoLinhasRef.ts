// Forecast preditivo (P1b-1): uma linha (segmento x variante) do backtest da referencia. Campos herdados = EXATAMENTE os da P1a
// (calcularLinhaP1: WAPE LT, vies, custo LT 3:1, falta/excesso, vitoria, cobertura LT, pinball, metades, criterios 1-5, 7, 8);
// acrescenta o custo de negocio completo por horizonte (KG, sem preco), a ruptura simulada (desenho 4.2) e a cobertura mensal.
// Metricas sobre a AMOSTRA COMUM (pares com lead time observado). O criterio 4 nao muda: segue sendo o custo no lead time.
import type { VarianteRef } from './forecastPreditivoConfigRef';
import type { Intervalo } from './forecastPreditivoIntervalos';
import { calcularLinhaP1, falhaCriterio7 } from './forecastPreditivoLinhasP1';
import type { ContextoLinha, LinhaP1, ObsP1 } from './forecastPreditivoLinhasP1';
import { custoNoLeadTime } from './forecastPreditivoMetricas';
import type { Erro } from './forecastPreditivoMetricas';

export interface ObsRef {
  p50s: number[];
  mensal: (Erro | null)[]; // h = 1..H; null = mes ainda nao realizado
  lt: Erro | null;
  intervaloLT: Intervalo | null;
  intervalosMes: (Intervalo | null)[]; // so a fonte do lead time conta em nPoolTotal; a do mensal e informativa
  fallback: boolean;
  qHat: number;
  ltDias: number;
}

export interface LinhaRef extends Omit<LinhaP1, 'metodo'> {
  variante: VarianteRef;
  wapeH: (number | null)[];
  custoH: number[];
  custoRelH: (number | null)[];
  faltaH: number[];
  excessoH: number[];
  coberturaH: (number | null)[];
  nIntervaloH: number[];
  rupturaSimulada: number | null;
  criterio7: 'passa' | 'falha' | 'n/a';
}

// Ruptura simulada: o realizado no lead time supera o previsto mais o consumo diario medio (qHat/30) x lead time. Igualdade NAO e ruptura.
export function rupturaSimulada(realLT: number, previstoLT: number, qHat: number, ltDias: number): boolean {
  return realLT > previstoLT + (qHat / 30) * ltDias;
}

const adaptar = (x: ObsRef): ObsP1 => ({
  obs: { h1: x.mensal[0] ?? undefined, h3: x.mensal[2] ?? undefined, lt: x.lt ?? undefined },
  fallback: x.fallback,
  intervalo: x.intervaloLT,
});

// indices = todos os pares do segmento; meu/ref indexados pelo par (ref = planilha Q).
export function calcularLinhaRef(
  segmento: string,
  variante: VarianteRef,
  indices: number[],
  meu: readonly ObsRef[],
  ref: readonly ObsRef[],
  ctx: ContextoLinha,
  horizonte: number,
): LinhaRef {
  const a: ObsP1[] = [];
  const r: ObsP1[] = [];
  for (const p of indices) {
    a[p] = adaptar(meu[p]);
    r[p] = adaptar(ref[p]);
  }
  // (o id passado so decide se e a referencia; o rotulo de saida e `variante`)
  const { metodo: _metodo, ...base } = calcularLinhaP1(segmento, variante === 'planilha-q' ? 'planilha-q' : 'preditivo-p1', indices, a, r, ctx);
  void _metodo;
  const amostra = indices.filter((p) => meu[p].lt !== null);

  const wapeH: (number | null)[] = [];
  const custoH: number[] = [];
  const custoRelH: (number | null)[] = [];
  const faltaH: number[] = [];
  const excessoH: number[] = [];
  const coberturaH: (number | null)[] = [];
  const nIntervaloH: number[] = [];
  for (let h = 1; h <= horizonte; h++) {
    let real = 0;
    let abs = 0;
    let n = 0;
    let falta = 0;
    let excesso = 0;
    let custo = 0;
    let custoRef = 0;
    let nInt = 0;
    let cobertos = 0;
    for (const p of amostra) {
      const e = meu[p].mensal[h - 1];
      const er = ref[p].mensal[h - 1];
      if (!e || !er) continue;
      n++;
      real += e.real;
      abs += Math.abs(e.real - e.previsto);
      const c = custoNoLeadTime(e.real, e.previsto, ctx.razaoFaltaExcesso);
      falta += c.falta;
      excesso += c.excesso;
      custo += c.custo;
      custoRef += custoNoLeadTime(er.real, er.previsto, ctx.razaoFaltaExcesso).custo;
      const iv = meu[p].intervalosMes[h - 1];
      if (iv) {
        nInt++;
        if (iv.p10 <= e.real && e.real <= iv.p90) cobertos++;
      }
    }
    wapeH.push(n === 0 || real === 0 ? null : abs / real);
    custoH.push(custo);
    custoRelH.push(n === 0 || custoRef === 0 ? null : custo / custoRef);
    faltaH.push(falta);
    excessoH.push(excesso);
    coberturaH.push(nInt === 0 ? null : cobertos / nInt);
    nIntervaloH.push(nInt);
  }

  let rupturas = 0;
  for (const p of amostra) {
    const o = meu[p];
    if (rupturaSimulada(o.lt!.real, o.lt!.previsto, o.qHat, o.ltDias)) rupturas++;
  }
  const criterio7 = variante === 'planilha-q' ? 'n/a' : falhaCriterio7(base.cobertura, base.nIntervalo) ? 'falha' : 'passa';
  return {
    ...base,
    variante,
    wapeH,
    custoH,
    custoRelH,
    faltaH,
    excessoH,
    coberturaH,
    nIntervaloH,
    rupturaSimulada: amostra.length === 0 ? null : rupturas / amostra.length,
    criterio7,
  };
}
