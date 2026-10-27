import { describe, expect, it } from 'vitest';
import { holtEstado, holtPrevisao, METODOS_SUAVIZACAO, sesNivel } from '../src/utils/forecastPreditivoSuavizacao';
import type { ResultadoPrevisao, SerieNormalizada } from '../src/utils/forecastPreditivoTipos';

const serie = (valores: number[], mascara?: boolean[]): SerieNormalizada => ({
  id: 'x',
  inicio: '2025-01',
  valores,
  mascara: mascara ?? valores.map(() => false),
  meta: { fonte: null, familia: null, leadTimeDias: null },
  avisos: [],
});
const nenhuma = (n: number) => new Array<boolean>(n).fill(false);
const ok = (r: ResultadoPrevisao) => {
  if (!r.ok) throw new Error('esperava ok: ' + r.motivo);
  return r;
};

describe('sesNivel', () => {
  it('[10,20,30,40]: nivel e SSE por alfa', () => {
    const v = [10, 20, 30, 40];
    expect(sesNivel(v, nenhuma(4), 0.1).nivel).toBeCloseTo(15.61, 6);
    expect(sesNivel(v, nenhuma(4), 0.1).sse).toBeCloseTo(1195.41, 2);
    expect(sesNivel(v, nenhuma(4), 0.2).sse).toBeCloseTo(1019.36, 2);
    expect(sesNivel(v, nenhuma(4), 0.3).sse).toBeCloseTo(868.61, 2);
    expect(sesNivel(v, nenhuma(4), 0.5)).toEqual({ nivel: 31.25, sse: 631.25 });
  });
  it('mes mascarado nao atualiza o nivel', () => {
    expect(sesNivel([10, 999, 30, 40], [false, true, false, false], 0.5).nivel).toBe(30);
  });
  it('mascara no inicio: o nivel inicial e o 1o valor valido', () => {
    expect(sesNivel([999, 10, 20], [true, false, false], 0.5)).toEqual({ nivel: 15, sse: 100 });
  });
});

describe('holtEstado / holtPrevisao a mao', () => {
  it('[10,20,26], alfa 0,5 beta 0,5 phi 1: nivel 28, tendencia 9, h1 37, h2 46', () => {
    const e = holtEstado([10, 20, 26], nenhuma(3), { alfa: 0.5, beta: 0.5, phi: 1 });
    expect(e.nivel).toBe(28);
    expect(e.tendencia).toBe(9);
    expect(e.sse).toBe(16);
    expect(holtPrevisao(e.nivel, e.tendencia, 1, 1)).toBe(37);
    expect(holtPrevisao(e.nivel, e.tendencia, 1, 2)).toBe(46);
  });
  it('mesmo caso com phi 0,8: nivel 25,9, tendencia 6,85, h1 31,38, h2 35,764', () => {
    const e = holtEstado([10, 20, 26], nenhuma(3), { alfa: 0.5, beta: 0.5, phi: 0.8 });
    expect(e.nivel).toBeCloseTo(25.9, 9);
    expect(e.tendencia).toBeCloseTo(6.85, 9);
    expect(holtPrevisao(e.nivel, e.tendencia, 0.8, 1)).toBeCloseTo(31.38, 9);
    expect(holtPrevisao(e.nivel, e.tendencia, 0.8, 2)).toBeCloseTo(35.764, 9);
  });
  it('[10,12,15,14,18,20,23,25] com alfa 0,5 e beta 0,1', () => {
    const v = [10, 12, 15, 14, 18, 20, 23, 25];
    const a = holtEstado(v, nenhuma(8), { alfa: 0.5, beta: 0.1, phi: 1 });
    expect(holtPrevisao(a.nivel, a.tendencia, 1, 1)).toBeCloseTo(26.789306, 6);
    expect(holtPrevisao(a.nivel, a.tendencia, 1, 2)).toBeCloseTo(28.864154, 6);
    const b = holtEstado(v, nenhuma(8), { alfa: 0.5, beta: 0.1, phi: 0.9 });
    expect(holtPrevisao(b.nivel, b.tendencia, 0.9, 1)).toBeCloseTo(25.114615, 6);
    expect(holtPrevisao(b.nivel, b.tendencia, 0.9, 2)).toBeCloseTo(26.170108, 6);
  });
  it('mes mascarado so avanca o estado (nivel += phi*tendencia; tendencia *= phi)', () => {
    const e = holtEstado([10, 20, 999], [false, false, true], { alfa: 0.5, beta: 0.5, phi: 0.8 });
    // apos t=1: nivel 19, tendencia 8,5; mascarado: nivel 19 + 0,8 * 8,5 = 25,8; tendencia 6,8
    expect(e.nivel).toBeCloseTo(25.8, 9);
    expect(e.tendencia).toBeCloseTo(6.8, 9);
    expect(e.sse).toBe(0);
  });
  it('menos de 2 validos nao quebra', () => {
    expect(holtEstado([5], [false], { alfa: 0.5, beta: 0.5, phi: 1 })).toEqual({ nivel: 5, tendencia: 0, sse: 0 });
    expect(holtEstado([], [], { alfa: 0.5, beta: 0.5, phi: 1 })).toEqual({ nivel: 0, tendencia: 0, sse: 0 });
  });
});

describe('ses (grade de alfa)', () => {
  it('[10,20,30,40] escolhe alfa 0,5 e preve 31,25 plano', () => {
    const r = ok(METODOS_SUAVIZACAO.ses(serie([10, 20, 30, 40]), { horizonte: 6 }));
    expect(r.parametros).toEqual({ alfa: 0.5 });
    expect(r.pontos.map((p) => p.p50)).toEqual(new Array(6).fill(31.25));
    expect(r.origem).toBe('2025-04');
  });
  it('a escolha e o menor SSE da grade (serie que oscila)', () => {
    const v = [10, 30, 10, 30, 10, 30];
    const grade = [0.1, 0.2, 0.3, 0.5];
    const sses = grade.map((a) => sesNivel(v, nenhuma(6), a).sse);
    const r = ok(METODOS_SUAVIZACAO.ses(serie(v), { horizonte: 3 }));
    expect(r.parametros.alfa).toBe(grade[sses.indexOf(Math.min(...sses))]);
  });
  it('empate fica com o primeiro da grade (serie constante)', () => {
    const r = ok(METODOS_SUAVIZACAO.ses(serie(new Array<number>(8).fill(100)), { horizonte: 2 }));
    expect(r.parametros).toEqual({ alfa: 0.1 });
    expect(r.pontos.map((p) => p.p50)).toEqual([100, 100]);
  });
  it('minimo de 4 meses validos (mascarado nao conta)', () => {
    expect(METODOS_SUAVIZACAO.ses(serie([10, 20, 30]), { horizonte: 6 })).toEqual({ ok: false, metodo: 'ses', motivo: 'historico-curto' });
    expect(METODOS_SUAVIZACAO.ses(serie([10, 20, 30, 40], [false, true, false, false]), { horizonte: 6 })).toMatchObject({
      ok: false,
      motivo: 'historico-curto',
    });
  });
});

describe('holt e holt amortecido (grade)', () => {
  const rampa = serie([10, 20, 30, 40, 50, 60, 70, 80]);
  it('holt em rampa exata: h1 90, h6 140 e primeiro candidato da grade (SSE 0)', () => {
    const r = ok(METODOS_SUAVIZACAO.holt(rampa, { horizonte: 6 }));
    expect(r.parametros).toEqual({ alfa: 0.1, beta: 0.05 });
    expect(r.pontos[0].p50).toBeCloseTo(90, 6);
    expect(r.pontos[5].p50).toBeCloseTo(140, 6);
  });
  it('holt amortecido escolhe phi na grade e fica abaixo da rampa', () => {
    const r = ok(METODOS_SUAVIZACAO['holt-amortecido'](rampa, { horizonte: 6 }));
    expect(r.parametros.phi).toBe(0.98); // rampa exata: o phi mais proximo de 1 erra menos
    expect(r.pontos[0].p50).toBeLessThan(90);
    expect(r.pontos[5].p50).toBeGreaterThan(r.pontos[0].p50);
    expect(r.pontos[5].p50).toBeLessThan(140);
  });
  it('minimo de 8 meses validos', () => {
    for (const id of ['holt', 'holt-amortecido'] as const) {
      expect(METODOS_SUAVIZACAO[id](serie([10, 20, 30, 40, 50, 60, 70]), { horizonte: 6 })).toEqual({
        ok: false,
        metodo: id,
        motivo: 'historico-curto',
      });
    }
  });
  it('tendencia que cruza zero: p50 vira 0 com aviso previsao-negativa-zerada', () => {
    const r = ok(METODOS_SUAVIZACAO.holt(serie([80, 70, 60, 50, 40, 30, 20, 10]), { horizonte: 6 }));
    expect(r.pontos.map((p) => p.p50).every((x) => x >= 0)).toBe(true);
    expect(r.pontos[5].p50).toBe(0);
    expect(r.avisos).toEqual(['previsao-negativa-zerada']);
  });
  it('mascara: meses mascarados nao entram no erro e nao quebram a previsao', () => {
    const v = [10, 20, 30, 40, 500, 60, 70, 80, 90];
    const m = v.map((_, i) => i === 4);
    const r = ok(METODOS_SUAVIZACAO.holt(serie(v, m), { horizonte: 3 }));
    expect(r.pontos[0].p50).toBeCloseTo(100, 6);
  });
});

describe('holtPrevisao', () => {
  it('phi = 1: nivel + h * tendencia; phi < 1: soma da serie geometrica', () => {
    expect(holtPrevisao(10, 2, 1, 5)).toBe(20);
    expect(holtPrevisao(10, 2, 0.5, 3)).toBeCloseTo(10 + 2 * (0.5 + 0.25 + 0.125), 12);
  });
});
