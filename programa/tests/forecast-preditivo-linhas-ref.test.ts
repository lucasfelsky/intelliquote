import { describe, expect, it } from 'vitest';
import { calcularLinhaRef, rupturaSimulada } from '../src/utils/forecastPreditivoLinhasRef';
import type { ObsRef } from '../src/utils/forecastPreditivoLinhasRef';
import { calcularLinhaP1 } from '../src/utils/forecastPreditivoLinhasP1';
import type { ContextoLinha, ObsP1 } from '../src/utils/forecastPreditivoLinhasP1';
import type { Erro } from '../src/utils/forecastPreditivoMetricas';

const e = (serieId: string, origem: string, h: number, real: number, previsto: number): Erro => ({ serieId, origem, h, real, previsto });
const iv = (p10: number, p90: number) => ({ p10, p90, fonte: 'celula' as const });
const par = (id: string, origem: string) => ({ serieId: id, origem, abc: 'A' as const });

// 3 pares a mao (H = 3): A e B tem lead time observado (amostra); C so o 1o mes.
function montar() {
  const pares = [par('A', '2026-01'), par('B', '2026-01'), par('C', '2026-02')];
  const meu: ObsRef[] = [
    { p50s: [80, 130, 100], mensal: [e('A', '2026-01', 1, 100, 80), e('A', '2026-01', 2, 100, 130), e('A', '2026-01', 3, 100, 100)], lt: e('A', '2026-01', 3, 300, 310), intervaloLT: iv(250, 350), intervalosMes: [iv(90, 110), iv(100, 120), null], fallback: false, qHat: 30, ltDias: 30 },
    { p50s: [60, 40, 50], mensal: [e('B', '2026-01', 1, 50, 60), e('B', '2026-01', 2, 50, 40), e('B', '2026-01', 3, 50, 50)], lt: e('B', '2026-01', 3, 150, 119), intervaloLT: null, intervalosMes: [iv(55, 58), null, null], fallback: false, qHat: 30, ltDias: 30 },
    { p50s: [10, 10, 10], mensal: [e('C', '2026-02', 1, 10, 10), null, null], lt: null, intervaloLT: null, intervalosMes: [iv(0, 1), null, null], fallback: false, qHat: 10, ltDias: 30 },
  ];
  const ref: ObsRef[] = [
    { p50s: [90, 100, 110], mensal: [e('A', '2026-01', 1, 100, 90), e('A', '2026-01', 2, 100, 100), e('A', '2026-01', 3, 100, 110)], lt: e('A', '2026-01', 3, 300, 300), intervaloLT: null, intervalosMes: [null, null, null], fallback: false, qHat: 30, ltDias: 30 },
    { p50s: [50, 55, 45], mensal: [e('B', '2026-01', 1, 50, 50), e('B', '2026-01', 2, 50, 55), e('B', '2026-01', 3, 50, 45)], lt: e('B', '2026-01', 3, 150, 150), intervaloLT: null, intervalosMes: [null, null, null], fallback: false, qHat: 30, ltDias: 30 },
    { p50s: [20, 20, 20], mensal: [e('C', '2026-02', 1, 10, 20), null, null], lt: null, intervaloLT: null, intervalosMes: [null, null, null], fallback: false, qHat: 10, ltDias: 30 },
  ];
  const ctx: ContextoLinha = { pares, razaoFaltaExcesso: 3, tetoVies: null, ultimoMes1: null };
  return { meu, ref, ctx };
}
const proximo = (x: number | null, esperado: number) => expect(x).toBeCloseTo(esperado, 12);

describe('custo completo por horizonte (a mao)', () => {
  const { meu, ref, ctx } = montar();
  const l = calcularLinhaRef('TOTAL', 'referencia', [0, 1, 2], meu, ref, ctx, 3);

  it('WAPE por h, falta/excesso/custo 3:1 em KG e custo relativo a planilha Q (so a amostra)', () => {
    proximo(l.wapeH[0], 30 / 150);
    proximo(l.wapeH[1], 40 / 150);
    proximo(l.wapeH[2], 0);
    expect(l.faltaH).toEqual([20, 10, 0]);
    expect(l.excessoH).toEqual([10, 30, 0]);
    expect(l.custoH).toEqual([70, 60, 0]); // 3 x falta + excesso
    proximo(l.custoRelH[0], 70 / 30);
    proximo(l.custoRelH[1], 60 / 5);
    proximo(l.custoRelH[2], 0);
  });
  it('a razao falta/excesso chega ao custoH (1 e 5)', () => {
    expect(calcularLinhaRef('TOTAL', 'referencia', [0, 1, 2], meu, ref, { ...ctx, razaoFaltaExcesso: 1 }, 3).custoH).toEqual([30, 40, 0]);
    expect(calcularLinhaRef('TOTAL', 'referencia', [0, 1, 2], meu, ref, { ...ctx, razaoFaltaExcesso: 5 }, 3).custoH).toEqual([110, 80, 0]);
  });
  it('custoRelH null quando o custo da Q e 0; planilha Q contra ela mesma = 1', () => {
    const q = calcularLinhaRef('TOTAL', 'planilha-q', [0, 1, 2], ref, ref, ctx, 3);
    expect(q.custoRelH.map((x) => (x === null ? null : Math.round(x * 1e9) / 1e9))).toEqual([1, 1, 1]);
    const zero = ref.map((o) => ({ ...o, mensal: o.mensal.map((x) => (x ? { ...x, previsto: x.real } : x)) }));
    expect(calcularLinhaRef('TOTAL', 'referencia', [0, 1, 2], meu, zero, ctx, 3).custoRelH).toEqual([null, null, null]);
  });
  it('cobertura mensal: so pares da amostra com intervalo; limites p10 e p90 contam como dentro', () => {
    expect(l.nIntervaloH).toEqual([2, 1, 0]); // o par C tem intervalo em h1 mas fora da amostra
    expect(l.coberturaH).toEqual([0.5, 1, null]); // h1: A dentro (100 em [90, 110]), B fora; h2: real 100 = p10
  });
  it('wapeH e custo sem par realizado: null / 0', () => {
    const vazio = calcularLinhaRef('TOTAL', 'referencia', [2], meu, ref, ctx, 3);
    expect(vazio.wapeH).toEqual([null, null, null]);
    expect(vazio.custoH).toEqual([0, 0, 0]);
    expect(vazio.rupturaSimulada).toBeNull();
  });
});

describe('ruptura simulada (desenho 4.2)', () => {
  it('igualdade NAO e ruptura; +0,001 e; sem o termo qHat/30 x LT ou com >= o resultado mudaria', () => {
    expect(rupturaSimulada(150, 120, 30, 30)).toBe(false); // 120 + 30/30 x 30 = 150
    expect(rupturaSimulada(150.001, 120, 30, 30)).toBe(true);
    expect(rupturaSimulada(149.999, 120, 30, 30)).toBe(false);
    expect(rupturaSimulada(130, 120, 30, 30)).toBe(false); // sem o termo seria ruptura
    expect(rupturaSimulada(130, 120, 60, 15)).toBe(false); // 120 + 2 x 15 = 150
    expect(rupturaSimulada(151, 120, 60, 15)).toBe(true);
  });
  it('fracao dos pares da amostra: A (300 > 310 + 30) nao, B (150 > 119 + 30) sim -> 0,5', () => {
    const { meu, ref, ctx } = montar();
    expect(calcularLinhaRef('TOTAL', 'referencia', [0, 1, 2], meu, ref, ctx, 3).rupturaSimulada).toBe(0.5);
  });
});

describe('campos herdados = calcularLinhaP1 chamada direto', () => {
  it('todas as chaves de LinhaP1 (menos metodo) identicas; rotulo de saida = variante', () => {
    const { meu, ref, ctx } = montar();
    const ad = (x: ObsRef): ObsP1 => ({ obs: { h1: x.mensal[0] ?? undefined, h3: x.mensal[2] ?? undefined, lt: x.lt ?? undefined }, fallback: x.fallback, intervalo: x.intervaloLT });
    const direto = calcularLinhaP1('TOTAL', 'preditivo-p1', [0, 1, 2], meu.map(ad), ref.map(ad), ctx);
    const l = calcularLinhaRef('TOTAL', 'referencia-corrigida', [0, 1, 2], meu, ref, ctx, 3);
    const { metodo: _m, ...esperado } = direto;
    void _m;
    expect(l).toMatchObject(esperado);
    expect(l.variante).toBe('referencia-corrigida');
    expect('metodo' in l).toBe(false);
    expect(l.custoLT).toBe(direto.custoLT);
    expect(l.faltaLT).toBe(31 + 0); // B: 150 - 119
  });
  it('planilha-q e a referencia da P1a (promovivel "referencia", sem vitoria)', () => {
    const { ref, ctx } = montar();
    const q = calcularLinhaRef('TOTAL', 'planilha-q', [0, 1, 2], ref, ref, ctx, 3);
    expect(q.promovivel).toBe('referencia');
    expect(q.vitoria).toBeNull();
    expect(q.criterio7).toBe('n/a');
  });
});

describe('criterio 7 e teto de vies (muitos pares)', () => {
  // N pares com LT real 100; `dentro` deles com intervalo cobrindo o real; previsto do meu = prev
  function lote(n: number, dentro: number, prev = 100, prevQ = 100) {
    const pares = Array.from({ length: n }, (_, i) => par('S' + i, '2026-01'));
    const meu: ObsRef[] = pares.map((p, i) => ({ p50s: [], mensal: [], lt: e(p.serieId, p.origem, 3, 100, prev), intervaloLT: i < dentro ? iv(90, 110) : iv(120, 130), intervalosMes: [], fallback: false, qHat: 1, ltDias: 30 }));
    const ref: ObsRef[] = pares.map((p) => ({ p50s: [], mensal: [], lt: e(p.serieId, p.origem, 3, 100, prevQ), intervaloLT: null, intervalosMes: [], fallback: false, qHat: 1, ltDias: 30 }));
    const ctx: ContextoLinha = { pares, razaoFaltaExcesso: 3, tetoVies: null, ultimoMes1: null };
    return { meu, ref, ctx, idx: pares.map((_, i) => i) };
  }
  const c7 = (n: number, dentro: number) => {
    const { meu, ref, ctx, idx } = lote(n, dentro);
    const l = calcularLinhaRef('TOTAL', 'referencia', idx, meu, ref, ctx, 3);
    return [l.criterio7, l.criteriosFalhos.includes(7)];
  };
  it.each([
    [100, 72, 'passa'], [100, 88, 'passa'], [100, 71, 'falha'], [100, 89, 'falha'], [30, 24, 'passa'], [29, 24, 'falha'], [31, 25, 'passa'],
  ])('n %i com %i dentro -> %s (e coerente com os criterios herdados)', (n, dentro, esperado) => {
    expect(c7(n, dentro)).toEqual([esperado, esperado === 'falha']);
  });
  it('sem nenhum intervalo -> falha (cobertura null); planilha-q -> n/a', () => {
    const { meu, ref, ctx, idx } = lote(40, 0);
    const semIv = meu.map((o) => ({ ...o, intervaloLT: null }));
    expect(calcularLinhaRef('TOTAL', 'referencia', idx, semIv, ref, ctx, 3).criterio7).toBe('falha');
    expect(calcularLinhaRef('TOTAL', 'planilha-q', idx, ref, ref, ctx, 3).criterio7).toBe('n/a');
  });
  it('tetoVies chega aos criterios: vies 0,15 contra 0,14 da Q passa o relativo e falha o teto 0,10', () => {
    const { meu, ref, ctx, idx } = lote(40, 30, 115, 114);
    const sem = calcularLinhaRef('TOTAL', 'referencia', idx, meu, ref, ctx, 3);
    expect(sem.criteriosFalhos).not.toContain(3);
    const com = calcularLinhaRef('TOTAL', 'referencia', idx, meu, ref, { ...ctx, tetoVies: 0.1 }, 3);
    expect(com.criteriosFalhos).toContain(3);
  });
});
