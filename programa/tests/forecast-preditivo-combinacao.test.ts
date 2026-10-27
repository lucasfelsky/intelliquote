import { describe, expect, it } from 'vitest';
import { PREDITIVO_CONFIG_P1 } from '../src/utils/forecastPreditivoConfigP1';
import { METODOS } from '../src/utils/forecastPreditivoMetodos';
import { METODOS_P1, METODOS_TODOS, combinacaoSesRHolt } from '../src/utils/forecastPreditivoMetodosP1';
import { METODO_IDS, METODO_P1_IDS, METODO_TODOS_IDS } from '../src/utils/forecastPreditivoTipos';
import type { ResultadoPrevisao, SerieNormalizada } from '../src/utils/forecastPreditivoTipos';

const serie = (valores: number[], mascara?: boolean[]): SerieNormalizada => ({
  id: 'x',
  inicio: '2025-01',
  valores,
  mascara: mascara ?? valores.map(() => false),
  meta: { fonte: null, familia: null, leadTimeDias: null },
  avisos: [],
});
const comb = (valores: number[], horizonte = 2, mascara?: boolean[]): ResultadoPrevisao =>
  METODOS_P1['combinacao-ses-r-holt'](serie(valores, mascara), { horizonte });
const ok = (r: ResultadoPrevisao) => {
  if (!r.ok) throw new Error('esperava ok: ' + r.motivo);
  return r;
};
const p50 = (r: ResultadoPrevisao) => ok(r).pontos.map((p) => p.p50);

describe('registros e tipos', () => {
  it('METODO_TODOS_IDS = fase 0 + P1, na ordem do relatorio', () => {
    expect(METODO_TODOS_IDS).toEqual([...METODO_IDS, ...METODO_P1_IDS]);
    expect(METODO_P1_IDS).toEqual(['combinacao-ses-r-holt', 'preditivo-p1']);
    expect(Object.keys(METODOS_TODOS).sort()).toEqual([...METODO_TODOS_IDS].sort());
  });
  it('config P1 congelada e com os valores do plano', () => {
    expect(Object.isFrozen(PREDITIVO_CONFIG_P1)).toBe(true);
    expect(Object.isFrozen(PREDITIVO_CONFIG_P1.protecao)).toBe(true);
    expect(PREDITIVO_CONFIG_P1.combinacao).toEqual({ componentes: ['ses', 'planilha-r', 'holt-amortecido'], minimoValidos: 4, minimoValidosHolt: 8 });
    expect(PREDITIVO_CONFIG_P1.intervalo.minResiduos).toBe(30);
    expect(PREDITIVO_CONFIG_P1.criterios).toEqual({ tetoViesPadrao: null, minTreinoPrincipal: 12 });
  });
});

describe('combinacao SES + R + Holt amortecido: valores a mao', () => {
  it('3 valores -> historico-curto', () => {
    expect(comb([10, 20, 30])).toEqual({ ok: false, metodo: 'combinacao-ses-r-holt', motivo: 'historico-curto' });
  });
  it('4 valores: SES 31,25 + R 25 -> 28,125 (2 componentes)', () => {
    const r = ok(comb([10, 20, 30, 40]));
    expect(p50(r)[0]).toBeCloseTo(28.125, 6);
    expect(p50(r)[1]).toBeCloseTo(28.125, 6);
    expect(r.parametros.componentes).toBe(2);
    expect(r.metodo).toBe('combinacao-ses-r-holt');
    expect(r.versao).toBe('p1.0.0');
  });
  it('7 valores: SES 20,4375 + R 17 -> 18,71875', () => {
    const r = ok(comb([10, 12, 15, 14, 18, 20, 23]));
    expect(p50(r)[0]).toBeCloseTo(18.71875, 6);
    expect(p50(r)[1]).toBeCloseTo(18.71875, 6);
    expect(r.parametros.componentes).toBe(2);
  });
  it('8 valores: 3 componentes (alfa .3, beta .1, phi .98)', () => {
    const r = ok(comb([10, 12, 15, 14, 18, 20, 23, 25]));
    expect(p50(r)[0]).toBeCloseTo(22.57158, 6);
    expect(p50(r)[1]).toBeCloseTo(23.160156, 6);
    expect(r.parametros).toMatchObject({ componentes: 3, 'holt.alfa': 0.3, 'holt.beta': 0.1, 'holt.phi': 0.98 });
  });
  it('tendencia linear de 8 valores (alfa .5, beta .2, phi .98)', () => {
    const r = ok(comb([10, 20, 30, 40, 50, 60, 70, 80]));
    expect(p50(r)[0]).toBeCloseTo(71.146802, 6);
    expect(p50(r)[1]).toBeCloseTo(74.129831, 6);
    expect(r.parametros).toMatchObject({ 'holt.alfa': 0.5, 'holt.beta': 0.2, 'holt.phi': 0.98 });
  });
  it('previsao negativa de componente e zerada e o aviso e herdado', () => {
    const r = ok(comb([5, 8, 6, 0, 0, 0, 0, 0, 0]));
    expect(p50(r)[0]).toBeCloseTo(0.032552, 6);
    expect(r.avisos).toContain('previsao-negativa-zerada');
  });
});

describe('combinacao: composicao e parametros', () => {
  const valores = [10, 12, 15, 14, 18, 20, 23, 25];
  it('p50 = media dos p50 dos componentes (ses, planilha-r, holt-amortecido) em todo h', () => {
    const s = serie(valores);
    const r = ok(combinacaoSesRHolt(s, { horizonte: 6 }));
    for (let h = 0; h < 6; h++) {
      const soma = (['ses', 'planilha-r', 'holt-amortecido'] as const).map((c) => p50(METODOS[c](s, { horizonte: 6 }))[h]).reduce((a, b) => a + b, 0);
      expect(r.pontos[h].p50).toBeCloseTo(soma / 3, 9);
    }
  });
  it('2 componentes: sem chaves holt.*; 3 componentes: com as 4 chaves', () => {
    expect(Object.keys(ok(comb(valores.slice(0, 7))).parametros).sort()).toEqual(['componentes', 'ses.alfa']);
    expect(Object.keys(ok(comb(valores)).parametros).sort()).toEqual(['componentes', 'holt.alfa', 'holt.beta', 'holt.phi', 'ses.alfa']);
  });
  it('serie toda zero -> p50 0 e aviso sem-venda; horizonte invalido e sem dados', () => {
    const r = ok(comb([0, 0, 0], 3));
    expect(p50(r)).toEqual([0, 0, 0]);
    expect(r.avisos).toEqual(['sem-venda']);
    expect(comb([], 2)).toEqual({ ok: false, metodo: 'combinacao-ses-r-holt', motivo: 'sem-dados' });
    expect(comb(valores, 13)).toEqual({ ok: false, metodo: 'combinacao-ses-r-holt', motivo: 'horizonte-invalido' });
  });
});

describe('combinacao: fronteiras de meses validos (3/4 e 7/8)', () => {
  const base = [10, 12, 15, 14, 18, 20, 23, 25];
  it('3 validos (com mascara) -> curto; 4 -> ok com 2 componentes', () => {
    expect(comb([10, 20, 30, 40], 2, [false, true, false, false]).ok).toBe(false);
    expect(ok(comb([10, 20, 30, 40, 50], 2, [false, true, false, false, false])).parametros.componentes).toBe(2);
  });
  it('7 validos -> 2 componentes; 8 validos -> 3 componentes (mascara conta)', () => {
    expect(ok(comb(base, 2, [false, false, false, false, false, false, false, false])).parametros.componentes).toBe(3);
    expect(ok(comb(base, 2, [true, false, false, false, false, false, false, false])).parametros.componentes).toBe(2);
    expect(ok(comb([9, ...base], 2, [true, false, false, false, false, false, false, false, false])).parametros.componentes).toBe(3);
  });
});
