import { describe, expect, it } from 'vitest';
import { METODOS_TODOS } from '../src/utils/forecastPreditivoMetodosP1';
import { normalizarSeries } from '../src/utils/forecastPreditivoSerie';
import { METODO_P1_IDS, METODO_TODOS_IDS } from '../src/utils/forecastPreditivoTipos';
import type { ResultadoPrevisao, SerieEntrada, SerieNormalizada } from '../src/utils/forecastPreditivoTipos';
import { serieLacuna, seriesSinteticas } from './helpers/forecastPreditivoSinteticas';
import { seriesP1 } from './helpers/forecastPreditivoSinteticasP1';

const entrada = (): SerieEntrada[] => [...seriesSinteticas(), ...serieLacuna(), ...seriesP1()];
const todas = (): SerieNormalizada[] => normalizarSeries(entrada()).series;
const serie = (valores: number[]): SerieNormalizada => ({
  id: 'x',
  inicio: '2025-01',
  valores,
  mascara: valores.map(() => false),
  meta: { fonte: null, familia: null, leadTimeDias: null },
  avisos: [],
});
const ok = (r: ResultadoPrevisao) => {
  if (!r.ok) throw new Error('esperava ok: ' + r.motivo);
  return r;
};
const sequencia = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('propriedades dos metodos P1 x todas as series sinteticas (fase 0 + P1)', () => {
  const series = todas();

  it('o registro cobre exatamente METODO_TODOS_IDS', () => {
    expect(Object.keys(METODOS_TODOS).sort()).toEqual([...METODO_TODOS_IDS].sort());
  });

  it('duas chamadas dao resultado identico, com versao, metodo e horizontes', () => {
    let oks = 0;
    for (const id of METODO_P1_IDS) {
      for (const s of series) {
        const a = METODOS_TODOS[id](s, { horizonte: 6 });
        expect(METODOS_TODOS[id](s, { horizonte: 6 })).toEqual(a);
        if (a.ok) {
          oks++;
          expect(a.versao).toBe('p1.0.0');
          expect(a.metodo).toBe(id);
          expect(a.pontos.map((p) => p.h)).toEqual([1, 2, 3, 4, 5, 6]);
        }
      }
    }
    expect(oks).toBeGreaterThan(series.length); // nao e um teste vazio
  });

  it('a ordem das series de entrada nao muda o resultado', () => {
    const invertida = normalizarSeries([...entrada()].reverse()).series;
    expect(invertida).toEqual(series);
    for (const id of METODO_P1_IDS) {
      expect(invertida.map((s) => METODOS_TODOS[id](s, { horizonte: 6 }))).toEqual(series.map((s) => METODOS_TODOS[id](s, { horizonte: 6 })));
    }
  });

  it('todo p50 e finito e >= 0, em horizontes 1, 6 e 12', () => {
    for (const id of METODO_P1_IDS) {
      for (const s of series) {
        for (const horizonte of [1, 6, 12]) {
          const r = METODOS_TODOS[id](s, { horizonte });
          if (!r.ok) continue;
          expect(r.pontos).toHaveLength(horizonte);
          for (const p of r.pontos) {
            expect(Number.isFinite(p.p50)).toBe(true);
            expect(p.p50).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('valor atipico enorme e degrau nunca produzem NaN', () => {
    const casos = [[0, 0, 1e12, 0, 0, 1e12, 0, 0, 1e12, 0], [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0], [...new Array<number>(12).fill(1), ...new Array<number>(12).fill(1e12)]];
    for (const id of METODO_P1_IDS) {
      for (const valores of casos) {
        const r = METODOS_TODOS[id](serie(valores), { horizonte: 12 });
        if (r.ok) expect(r.pontos.every((p) => Number.isFinite(p.p50) && p.p50 >= 0)).toBe(true);
      }
    }
  });
});

describe('validacoes comuns dos metodos P1', () => {
  it('sem dados -> sem-dados', () => {
    for (const id of METODO_P1_IDS) expect(METODOS_TODOS[id](serie([]), { horizonte: 6 })).toEqual({ ok: false, metodo: id, motivo: 'sem-dados' });
  });
  it('horizonte 0, 13 e 2,5 -> horizonte-invalido', () => {
    for (const id of METODO_P1_IDS) {
      for (const horizonte of [0, 13, 2.5]) {
        expect(METODOS_TODOS[id](serie(sequencia(20)), { horizonte })).toEqual({ ok: false, metodo: id, motivo: 'horizonte-invalido' });
      }
    }
  });
  it('serie toda zero -> ok, p50 0, avisos sem-venda', () => {
    for (const id of METODO_P1_IDS) {
      const r = ok(METODOS_TODOS[id](serie([0, 0, 0]), { horizonte: 4 }));
      expect(r.pontos.map((p) => p.p50)).toEqual([0, 0, 0, 0]);
      expect(r.avisos).toEqual(['sem-venda']);
    }
  });
  it('serie constante c: p50 = c em todo h', () => {
    for (const [c, n] of [[100, 36], [7, 14], [0.5, 20]]) {
      for (const id of METODO_P1_IDS) {
        const r = ok(METODOS_TODOS[id](serie(new Array<number>(n).fill(c)), { horizonte: 12 }));
        for (const p of r.pontos) expect(p.p50).toBeCloseTo(c, 9);
      }
    }
  });
  it('historico curto: combinacao pede 4 validos; composto sempre devolve previsao (Q)', () => {
    expect(METODOS_TODOS['combinacao-ses-r-holt'](serie([1, 2, 3]), { horizonte: 3 })).toEqual({ ok: false, metodo: 'combinacao-ses-r-holt', motivo: 'historico-curto' });
    const r = ok(METODOS_TODOS['preditivo-p1'](serie([1, 2, 3]), { horizonte: 3 }));
    expect(r.pontos[0].p50).toBeCloseTo(2, 9);
  });
});
