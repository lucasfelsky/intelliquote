import { describe, expect, it } from 'vitest';
import { PREDITIVO_CONFIG_P1 } from '../src/utils/forecastPreditivoConfigP1';
import { METODOS } from '../src/utils/forecastPreditivoMetodos';
import { METODOS_P1, criarPreditivoP1, ehDormente, regraProtecao } from '../src/utils/forecastPreditivoMetodosP1';
import { segmentar } from '../src/utils/forecastPreditivoSegmentos';
import { cortarAte, normalizarSeries } from '../src/utils/forecastPreditivoSerie';
import type { ResultadoPrevisao, SerieNormalizada } from '../src/utils/forecastPreditivoTipos';
import { serieLacuna, seriesSinteticas } from './helpers/forecastPreditivoSinteticas';
import { seriesP1 } from './helpers/forecastPreditivoSinteticasP1';

const serie = (valores: number[], mascara?: boolean[]): SerieNormalizada => ({
  id: 'x',
  inicio: '2025-01',
  valores,
  mascara: mascara ?? valores.map(() => false),
  meta: { fonte: null, familia: null, leadTimeDias: null },
  avisos: [],
});
const ok = (r: ResultadoPrevisao) => {
  if (!r.ok) throw new Error('esperava ok: ' + r.motivo);
  return r;
};
const p1 = (valores: number[], horizonte = 2, mascara?: boolean[]) => METODOS_P1['preditivo-p1'](serie(valores, mascara), { horizonte });
const h1 = (r: ResultadoPrevisao) => ok(r).pontos[0].p50;
const rodaDe = (valores: number[], mascara?: boolean[]) => regraProtecao(serie(valores, mascara));
const todas = () => normalizarSeries([...seriesSinteticas(), ...serieLacuna(), ...seriesP1()]).series;

describe('regraProtecao: valores a mao', () => {
  it('padrao, curto, dormente e degrau', () => {
    expect(rodaDe([10, 20, 30, 40, 50, 60, 70, 80])).toBe('padrao');
    expect(rodaDe([10, 12, 15, 14, 18, 20, 23])).toBe('curto');
    expect(rodaDe([10, 20, 30, 40])).toBe('curto');
    expect(rodaDe([5, 8, 6, 0, 0, 0, 0, 0, 0])).toBe('dormente');
    expect(rodaDe([...new Array<number>(12).fill(10), ...new Array<number>(12).fill(10000)])).toBe('degrau');
    expect(rodaDe([])).toBe('curto');
  });
  it('fronteira dormente: 5 zeros finais nao; 6 zeros finais sim', () => {
    expect(rodaDe([5, 0, 0, 0, 0, 0])).toBe('curto');
    expect(ehDormente(serie([5, 0, 0, 0, 0, 0]))).toBe(false);
    expect(rodaDe([5, 0, 0, 0, 0, 0, 0])).toBe('dormente');
    expect(ehDormente(serie([5, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(ehDormente(serie([5, 0, 0, 0, 0, 0, 0]), 7)).toBe(false); // janela e parametro
    expect(ehDormente(serie([5, 0, 0, 0, 0, 0, 0]), 6)).toBe(true);
  });
  it('dormente: mascarado fora da media; todos mascarados usa a media sem mascara', () => {
    expect(ehDormente(serie([9, 0, 0, 0, 0, 0], [true, false, false, false, false, false]))).toBe(true);
    expect(ehDormente(serie([0, 0, 0, 0, 0, 7], [false, false, false, false, false, true]))).toBe(true); // 7 mascarado
    expect(ehDormente(serie([1, 0, 0, 0, 0, 0], [false, false, false, false, false, false]))).toBe(false);
    expect(ehDormente(serie([3, 0, 0, 0, 0, 0], [true, true, true, true, true, true]))).toBe(false); // media sem mascara 0,5
  });
  it('fronteira de meses validos: 7 -> curto, 8 -> padrao', () => {
    expect(rodaDe([10, 12, 15, 14, 18, 20, 23])).toBe('curto');
    expect(rodaDe([10, 12, 15, 14, 18, 20, 23, 25])).toBe('padrao');
  });
  it('fronteira da razao de degrau: 20 -> padrao, 21 -> degrau', () => {
    expect(rodaDe([1, 1, 1, 1, 20, 20, 20, 20])).toBe('padrao');
    expect(rodaDe([1, 1, 1, 1, 21, 21, 21, 21])).toBe('degrau');
  });
  it('mascara reduz os validos: 1 mascarado (8 validos) -> padrao; 2 mascarados (7) -> curto', () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90];
    expect(rodaDe(v, [false, true, false, false, false, false, false, false, false])).toBe('padrao');
    expect(rodaDe(v, [false, true, true, false, false, false, false, false, false])).toBe('curto');
  });
  it('cfg alternativa: minimoValidos e janelaDormente chegam a regra', () => {
    const cfg = { ...PREDITIVO_CONFIG_P1.protecao, minimoValidos: 4 };
    expect(regraProtecao(serie([10, 20, 30, 40]), cfg)).toBe('padrao');
    expect(regraProtecao(serie([10, 20, 30]), cfg)).toBe('curto');
    const cfgJanela = { ...PREDITIVO_CONFIG_P1.protecao, janelaDormente: 2 };
    expect(regraProtecao(serie([9, 8, 7, 6, 5, 4, 3, 2, 0, 0]), cfgJanela)).toBe('dormente');
    expect(regraProtecao(serie([9, 8, 7, 6, 5, 4, 3, 2, 0, 0]))).toBe('padrao');
  });
});

describe('regraProtecao x ABC sem-venda da fase 0', () => {
  it('dormente <=> ABC sem-venda, em varias origens das sinteticas (inclui a ultima)', () => {
    const series = todas();
    for (const origem of ['2024-06', '2025-01', '2025-06', '2025-12', '2026-06', '2026-12']) {
      const seg = segmentar(series, origem);
      for (const s of series) {
        const cortada = cortarAte(s, origem);
        if (!cortada) continue;
        expect(regraProtecao(cortada) === 'dormente').toBe(seg.get(s.id)!.abc === 'sem-venda');
      }
    }
  });
});

describe('preditivo-p1: valores a mao', () => {
  it('padrao = combinacao', () => {
    expect(h1(p1([10, 20, 30, 40, 50, 60, 70, 80]))).toBeCloseTo(71.146802, 6);
    expect(h1(p1([10, 12, 15, 14, 18, 20, 23, 25]))).toBeCloseTo(22.57158, 6);
    expect(ok(p1([10, 12, 15, 14, 18, 20, 23, 25])).parametros.regra).toBe(0);
  });
  it('curto = Q; com metodoCurto planilha-r = R', () => {
    expect(h1(p1([10, 12, 15, 14, 18, 20, 23]))).toBeCloseTo(20.333333, 6);
    expect(h1(p1([10, 20, 30, 40]))).toBeCloseTo(30, 9);
    const r = criarPreditivoP1({ ...PREDITIVO_CONFIG_P1.protecao, metodoCurto: 'planilha-r' })(serie([10, 20, 30, 40]), { horizonte: 2 });
    expect(h1(r)).toBeCloseTo(25, 9);
    expect(ok(p1([10, 20, 30, 40])).parametros.regra).toBe(2);
  });
  it('degrau = Holt amortecido (alfa .5, beta .2, phi .8)', () => {
    const r = ok(p1([...new Array<number>(12).fill(10), ...new Array<number>(12).fill(10000)]));
    expect(r.pontos[0].p50).toBeCloseTo(10037.775737, 6);
    expect(r.parametros).toMatchObject({ regra: 3, alfa: 0.5, beta: 0.2, phi: 0.8 });
  });
  it('dormente = Q = 0; toda zero = 0 com aviso sem-venda', () => {
    const r = ok(p1([5, 8, 6, 0, 0, 0, 0, 0, 0]));
    expect(r.pontos.map((p) => p.p50)).toEqual([0, 0]);
    expect(r.parametros.regra).toBe(1);
    const z = ok(p1([0, 0, 0]));
    expect(z.pontos.map((p) => p.p50)).toEqual([0, 0]);
    expect(z.avisos).toEqual(['sem-venda']);
  });
  it('resultado identificado como preditivo-p1 e versao p1.0.0', () => {
    const r = ok(p1([5, 8, 6, 0, 0, 0, 0, 0, 0, 3, 3, 3]));
    expect(r.metodo).toBe('preditivo-p1');
    expect(r.versao).toBe('p1.0.0');
  });
  it('horizonte invalido e sem dados vem da validacao comum', () => {
    expect(p1([10, 20, 30, 40, 50, 60, 70, 80], 13)).toEqual({ ok: false, metodo: 'preditivo-p1', motivo: 'horizonte-invalido' });
    expect(p1([], 2)).toEqual({ ok: false, metodo: 'preditivo-p1', motivo: 'sem-dados' });
  });
  it('alvo sem previsao cai na planilha Q', () => {
    const cfg = { ...PREDITIVO_CONFIG_P1.protecao, metodoPadrao: 'croston' as const };
    const s = serie([0, 0, 0, 0, 0, 0, 0, 9]); // 1 venda so: croston nao tem previsao
    expect(METODOS.croston(s, { horizonte: 2 }).ok).toBe(false);
    expect(regraProtecao(s, cfg)).toBe('padrao');
    const r = ok(criarPreditivoP1(cfg)(s, { horizonte: 2 }));
    expect(r.pontos[0].p50).toBeCloseTo(3, 9); // Q = media dos 3 ultimos
    expect(r.metodo).toBe('preditivo-p1');
  });
  it('cfg alternativa escolhe o metodo de cada regra', () => {
    const cfg = { ...PREDITIVO_CONFIG_P1.protecao, metodoPadrao: 'ses' as const, metodoDegrau: 'planilha-q' as const, metodoDormente: 'planilha-r' as const };
    const v8 = [10, 12, 15, 14, 18, 20, 23, 25];
    expect(h1(criarPreditivoP1(cfg)(serie(v8), { horizonte: 2 }))).toBeCloseTo(h1(METODOS.ses(serie(v8), { horizonte: 2 })), 9);
    const deg = [...new Array<number>(12).fill(10), ...new Array<number>(12).fill(10000)];
    expect(h1(criarPreditivoP1(cfg)(serie(deg), { horizonte: 2 }))).toBeCloseTo(10000, 9);
    const dorm = serie([5, 8, 6, 0, 0, 0, 0, 0, 0]);
    expect(h1(criarPreditivoP1(cfg)(dorm, { horizonte: 2 }))).toBeCloseTo(0, 9);
  });
});

describe('preditivo-p1: sem vazamento do degrau', () => {
  it('DEGRAU cortada em 2025-12 (so os 12 meses de 10) -> padrao e p50 = combinacao', () => {
    const todasN = normalizarSeries(seriesSinteticas()).series;
    const inteira = todasN.find((s) => s.id === 'DEGRAU')!;
    expect(inteira.avisos).toContain('degrau-nivel'); // a serie inteira tem o aviso (usa o futuro)
    expect(regraProtecao(inteira)).toBe('degrau');
    const cortada = cortarAte(inteira, '2025-12')!;
    expect(cortada.valores).toHaveLength(12);
    expect(cortada.avisos).toContain('degrau-nivel'); // cortarAte copia os avisos da serie inteira
    expect(regraProtecao(cortada)).toBe('padrao');
    const a = ok(METODOS_P1['preditivo-p1'](cortada, { horizonte: 3 }));
    const b = ok(METODOS_P1['combinacao-ses-r-holt'](cortada, { horizonte: 3 }));
    expect(a.pontos.map((p) => p.p50)).toEqual(b.pontos.map((p) => p.p50));
  });
});
