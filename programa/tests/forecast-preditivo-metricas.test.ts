import { describe, expect, it } from 'vitest';
import { cobertura, custoNoLeadTime, horizonteLeadTime, mae, vies, wape } from '../src/utils/forecastPreditivoMetricas';
import type { Erro } from '../src/utils/forecastPreditivoMetricas';
import { classificarSbc, segmentar } from '../src/utils/forecastPreditivoSegmentos';
import { normalizarSeries, somarMeses } from '../src/utils/forecastPreditivoSerie';
import type { SerieEntrada } from '../src/utils/forecastPreditivoTipos';
import { seriesSinteticas } from './helpers/forecastPreditivoSinteticas';

const erros = (reais: number[], previstos: number[]): Erro[] =>
  reais.map((real, i) => ({ serieId: 's', origem: '2025-01', h: 1, real, previsto: previstos[i] }));

describe('metricas de erro', () => {
  const e = erros([10, 0, 30], [12, 5, 20]);
  it('WAPE, vies e MAE a mao', () => {
    expect(wape(e)).toBeCloseTo(0.425, 12);
    expect(vies(e)).toBeCloseTo(-0.075, 12);
    expect(mae(e)).toBeCloseTo(5.666667, 6);
  });
  it('vazio ou soma do real zero: null, nunca divisao por zero', () => {
    expect(wape([])).toBeNull();
    expect(vies([])).toBeNull();
    expect(mae([])).toBeNull();
    expect(wape(erros([0, 0], [3, 4]))).toBeNull();
    expect(vies(erros([0, 0], [3, 4]))).toBeNull();
    expect(mae(erros([0, 0], [3, 4]))).toBe(3.5);
  });
  it('previsao perfeita: WAPE 0 e viés 0', () => {
    expect(wape(erros([5, 6], [5, 6]))).toBe(0);
    expect(vies(erros([5, 6], [5, 6]))).toBe(0);
  });
});

describe('custoNoLeadTime', () => {
  it('falta pesa razao vezes o excesso', () => {
    expect(custoNoLeadTime(100, 70, 3)).toEqual({ falta: 30, excesso: 0, custo: 90 });
    expect(custoNoLeadTime(70, 100, 3)).toEqual({ falta: 0, excesso: 30, custo: 30 });
    expect(custoNoLeadTime(50, 50, 3)).toEqual({ falta: 0, excesso: 0, custo: 0 });
    expect(custoNoLeadTime(100, 70, 1.5).custo).toBe(45);
  });
});

describe('cobertura', () => {
  it('fracao dentro de [p10, p90]; null se vazio', () => {
    expect(cobertura([])).toBeNull();
    expect(
      cobertura([
        { real: 5, p10: 1, p90: 9 },
        { real: 10, p10: 1, p90: 9 },
        { real: 1, p10: 1, p90: 9 },
        { real: 9, p10: 1, p90: 9 },
      ]),
    ).toBe(0.75);
  });
});

describe('horizonteLeadTime = min(H, max(1, ceil(LT/30)) + 1)', () => {
  it.each([
    [0, 6, 2],
    [30, 6, 2],
    [31, 6, 3],
    [90, 6, 4],
    [133, 6, 6],
    [133, 4, 4],
    [365, 12, 12],
    [14, 6, 2],
  ])('LT %s dias, H %s -> %s', (lt, h, esperado) => {
    expect(horizonteLeadTime(lt, h)).toBe(esperado);
  });
});

describe('classificarSbc (ADI 1,32; CV2 0,49)', () => {
  it('quatro quadrantes e fronteiras inclusivas no limite inferior', () => {
    expect(classificarSbc(1.32, 0.49)).toBe('smooth');
    expect(classificarSbc(1.0, 0.5)).toBe('erratic');
    expect(classificarSbc(1.33, 0.49)).toBe('intermittent');
    expect(classificarSbc(3, 0.669)).toBe('lumpy');
  });
});

const constantes = (valores: Record<string, number[]>): SerieEntrada[] =>
  Object.entries(valores).map(([id, v]) => ({ id, pontos: v.map((qtd, i) => ({ anoMes: somarMeses('2025-01', i), qtd })) }));
const seg = (entrada: SerieEntrada[], ate: string) => segmentar(normalizarSeries(entrada).series, ate);

describe('segmentar: ABC', () => {
  it('volumes [50,30,15,5] -> A, A, B, C (acumulado ANTES do item contra 80% e 95%)', () => {
    const m = seg(constantes({ s1: [50, 50, 50, 50, 50, 50], s2: [30, 30, 30, 30, 30, 30], s3: [15, 15, 15, 15, 15, 15], s4: [5, 5, 5, 5, 5, 5] }), '2025-06');
    expect(['s1', 's2', 's3', 's4'].map((id) => m.get(id)!.abc)).toEqual(['A', 'A', 'B', 'C']);
  });
  it('sem venda; empate de volume desempata por id (independe da ordem de entrada)', () => {
    const v = [10, 10, 10];
    const m = seg(constantes({ e: v, d: v, c: v, b: v, a: v, z: [0, 0, 0] }), '2025-03');
    expect(m.get('z')!.abc).toBe('sem-venda');
    // total 50; o 5o item tem acumulado antes = 40, que NAO e < 80% de 50 (40): vira B
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => m.get(id)!.abc)).toEqual(['A', 'A', 'A', 'A', 'B']);
  });
  it('usa so os meses ate `ate`', () => {
    const m = seg(constantes({ a: [100, 100, 100, 100, 100, 100], b: [1, 1, 1, 1, 1000, 1000] }), '2025-04');
    expect(m.get('b')!.abc).toBe('C');
    const depois = seg(constantes({ a: [100, 100, 100, 100, 100, 100], b: [1, 1, 1, 1, 1000, 1000] }), '2025-06');
    expect(depois.get('b')!.abc).toBe('A');
  });
});

describe('segmentar: XYZ e SBC', () => {
  const m = seg(
    constantes({
      x: [10, 10, 10, 10, 10, 10],
      y: [10, 30, 10, 30, 10, 30], // CV = 0,5 (inclusivo em Y)
      z: [1, 1, 1, 1, 1, 100],
      um: [0, 0, 0, 0, 0, 7],
      zero: [0, 0, 0, 0, 0, 0],
    }),
    '2025-06',
  );
  it('XYZ pelo CV dos meses com venda; menos de 2 vendas = n/a', () => {
    expect(m.get('x')!.xyz).toBe('X');
    expect(m.get('y')!.xyz).toBe('Y');
    expect(m.get('z')!.xyz).toBe('Z');
    expect(m.get('um')!.xyz).toBe('n/a');
    expect(m.get('zero')!.xyz).toBe('n/a');
  });
  it('SBC insuficiente com menos de 3 meses validos ou de 2 meses com venda', () => {
    expect(m.get('um')!.sbc).toBe('insuficiente');
    expect(m.get('zero')!.sbc).toBe('insuficiente');
    expect(m.get('x')!.sbc).toBe('smooth');
    expect(m.get('z')!.sbc).toBe('erratic');
  });
  it('series sinteticas no ultimo mes: INTERM intermittent, LUMPY lumpy, CONST smooth, NOVA insuficiente', () => {
    const s = segmentar(normalizarSeries(seriesSinteticas()).series, '2026-12');
    expect(s.get('INTERM')).toEqual({ abc: expect.any(String), xyz: 'X', sbc: 'intermittent' });
    expect(s.get('LUMPY')!.sbc).toBe('lumpy');
    expect(s.get('LUMPY')!.xyz).toBe('Y'); // CV 0,818 dos picos 20/200
    expect(s.get('CONST')).toEqual({ abc: expect.any(String), xyz: 'X', sbc: 'smooth' });
    expect(s.get('NOVA')!.sbc).toBe('insuficiente');
    expect(s.get('ZERO')).toEqual({ abc: 'sem-venda', xyz: 'n/a', sbc: 'insuficiente' });
    expect(s.get('ATIP')!.sbc).toBe('smooth'); // o atipico mascarado fica fora da janela
  });
  it('serie que ainda nao existe na data: sem-venda / n/a / insuficiente', () => {
    const s = segmentar(normalizarSeries(seriesSinteticas()).series, '2024-12');
    expect(s.get('NOVA')).toEqual({ abc: 'sem-venda', xyz: 'n/a', sbc: 'insuficiente' });
    expect(s.get('ZERO')).toEqual({ abc: 'sem-venda', xyz: 'n/a', sbc: 'insuficiente' });
  });
});
