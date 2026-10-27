import { describe, expect, it } from 'vitest';
import { METODOS } from '../src/utils/forecastPreditivoMetodos';
import { normalizarSeries } from '../src/utils/forecastPreditivoSerie';
import { METODO_IDS } from '../src/utils/forecastPreditivoTipos';
import type { MetodoId, ResultadoPrevisao, SerieNormalizada } from '../src/utils/forecastPreditivoTipos';
import { serieLacuna, seriesSinteticas } from './helpers/forecastPreditivoSinteticas';

const todas = (): SerieNormalizada[] => normalizarSeries([...seriesSinteticas(), ...serieLacuna()]).series;
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

// Minimo de meses (validos) por metodo; croston/sba pedem 2 meses COM VENDA.
const MINIMO: Record<MetodoId, number> = {
  'planilha-q': 1,
  'planilha-r': 1,
  ingenuo: 1,
  'media-ponderada': 3,
  'ingenuo-sazonal': 13,
  ses: 4,
  holt: 8,
  'holt-amortecido': 8,
  croston: 2,
  sba: 2,
};

describe('propriedades de todos os metodos x todas as series sinteticas', () => {
  const series = todas();

  it('o registro cobre exatamente METODO_IDS', () => {
    expect(Object.keys(METODOS).sort()).toEqual([...METODO_IDS].sort());
  });

  it('duas chamadas dao resultado identico (toEqual), com versao e origem', () => {
    for (const id of METODO_IDS) {
      for (const s of series) {
        const a = METODOS[id](s, { horizonte: 6 });
        expect(METODOS[id](s, { horizonte: 6 })).toEqual(a);
        if (a.ok) {
          expect(a.versao).toBe('p1.1.0');
          expect(a.metodo).toBe(id);
          expect(a.pontos.map((p) => p.h)).toEqual([1, 2, 3, 4, 5, 6]);
        }
      }
    }
  });

  it('a ordem das series de entrada nao muda o resultado', () => {
    const entrada = [...seriesSinteticas(), ...serieLacuna()];
    const invertida = normalizarSeries([...entrada].reverse()).series;
    expect(invertida).toEqual(normalizarSeries(entrada).series);
    for (const id of METODO_IDS) {
      const a = normalizarSeries(entrada).series.map((s) => METODOS[id](s, { horizonte: 6 }));
      const b = invertida.map((s) => METODOS[id](s, { horizonte: 6 }));
      expect(b).toEqual(a);
    }
  });

  it('todo p50 e finito e >= 0, em horizontes 1, 6 e 12', () => {
    for (const id of METODO_IDS) {
      for (const s of series) {
        for (const horizonte of [1, 6, 12]) {
          const r = METODOS[id](s, { horizonte });
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

  it('serie com valor atipico ou degrau nunca produz NaN', () => {
    for (const id of METODO_IDS) {
      for (const valores of [[0, 0, 1e12, 0, 0, 1e12, 0, 0, 1e12, 0], [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0]]) {
        const r = METODOS[id](serie(valores), { horizonte: 12 });
        if (r.ok) expect(r.pontos.every((p) => Number.isFinite(p.p50) && p.p50 >= 0)).toBe(true);
      }
    }
  });
});

describe('validacoes comuns', () => {
  it('sem dados -> sem-dados', () => {
    for (const id of METODO_IDS) expect(METODOS[id](serie([]), { horizonte: 6 })).toEqual({ ok: false, metodo: id, motivo: 'sem-dados' });
  });

  it('horizonte 0, 13 e 2,5 -> horizonte-invalido', () => {
    for (const id of METODO_IDS) {
      for (const horizonte of [0, 13, 2.5]) {
        expect(METODOS[id](serie(sequencia(20)), { horizonte })).toEqual({ ok: false, metodo: id, motivo: 'horizonte-invalido' });
      }
    }
  });

  it('serie curta -> historico-curto conforme o minimo do metodo; no minimo, ok', () => {
    for (const id of METODO_IDS) {
      const minimo = MINIMO[id];
      if (minimo > 1 && id !== 'croston' && id !== 'sba') {
        expect(METODOS[id](serie(sequencia(minimo - 1)), { horizonte: 6 })).toEqual({ ok: false, metodo: id, motivo: 'historico-curto' });
      }
      expect(METODOS[id](serie(sequencia(Math.max(minimo, 2))), { horizonte: 6 }).ok).toBe(true);
    }
    for (const id of ['croston', 'sba'] as const) {
      expect(METODOS[id](serie([0, 0, 0, 0, 0, 9]), { horizonte: 6 })).toEqual({ ok: false, metodo: id, motivo: 'historico-curto' });
    }
  });

  it('serie toda zero -> ok com p50 0 e aviso sem-venda', () => {
    for (const id of METODO_IDS) {
      const r = ok(METODOS[id](serie([0, 0, 0]), { horizonte: 4 }));
      expect(r.pontos.map((p) => p.p50)).toEqual([0, 0, 0, 0]);
      expect(r.avisos).toEqual(['sem-venda']);
    }
  });

  it('serie sintetica ZERO e NOVA se comportam como o desenho', () => {
    const porId = new Map(todas().map((s) => [s.id, s]));
    for (const id of METODO_IDS) {
      expect(ok(METODOS[id](porId.get('ZERO')!, { horizonte: 6 })).avisos).toEqual(['sem-venda']);
    }
    const nova = porId.get('NOVA')!;
    for (const id of ['media-ponderada', 'ingenuo-sazonal', 'ses', 'holt', 'holt-amortecido'] as const) {
      expect(METODOS[id](nova, { horizonte: 6 })).toEqual({ ok: false, metodo: id, motivo: 'historico-curto' });
    }
    for (const id of ['planilha-q', 'planilha-r', 'ingenuo', 'croston', 'sba'] as const) {
      expect(METODOS[id](nova, { horizonte: 6 }).ok).toBe(true);
    }
  });
});

describe('serie constante', () => {
  it.each([[100, 36], [7, 14], [0.5, 20]])('c = %s (%s meses): plano em todo h, igual a c (SBA = (1 - alfa/2) c)', (c, n) => {
    for (const id of METODO_IDS) {
      const r = ok(METODOS[id](serie(new Array<number>(n).fill(c)), { horizonte: 12 }));
      const esperado = id === 'sba' ? (1 - r.parametros.alfa / 2) * c : c;
      for (const p of r.pontos) expect(p.p50).toBeCloseTo(esperado, 9);
    }
  });
});

describe('intermitentes sinteticas: SBA < Croston', () => {
  it('INTERM e LUMPY', () => {
    const porId = new Map(todas().map((s) => [s.id, s]));
    for (const id of ['INTERM', 'LUMPY']) {
      const c = ok(METODOS.croston(porId.get(id)!, { horizonte: 6 }));
      const b = ok(METODOS.sba(porId.get(id)!, { horizonte: 6 }));
      expect(b.pontos[0].p50).toBeLessThan(c.pontos[0].p50);
    }
    const interm = porId.get('INTERM')!;
    expect(ok(METODOS.croston(interm, { horizonte: 1 })).pontos[0].p50).toBeCloseTo(20, 9);
    expect(ok(METODOS.sba(interm, { horizonte: 1 })).pontos[0].p50).toBeCloseTo(19.5, 9);
  });
});
