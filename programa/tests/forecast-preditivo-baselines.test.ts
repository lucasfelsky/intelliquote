import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { METODOS_BASELINE, mediaValidos, validarAntes } from '../src/utils/forecastPreditivoBaselines';
import { normalizarSeries, serieDaQuinzena } from '../src/utils/forecastPreditivoSerie';
import type { ResultadoPrevisao, SerieNormalizada } from '../src/utils/forecastPreditivoTipos';
import { calcular } from '../src/utils/forecastEngine';
import type { Quinzena } from '../src/utils/forecastTypes';

const serie = (valores: number[], mascara?: boolean[], inicio = '2025-01'): SerieNormalizada => ({
  id: 'x',
  inicio,
  valores,
  mascara: mascara ?? valores.map(() => false),
  meta: { fonte: null, familia: null, leadTimeDias: null },
  avisos: [],
});

const prever = (id: keyof typeof METODOS_BASELINE, s: SerieNormalizada, horizonte = 6): ResultadoPrevisao =>
  METODOS_BASELINE[id](s, { horizonte });

const p50 = (r: ResultadoPrevisao): number[] => {
  if (!r.ok) throw new Error('esperava ok: ' + r.motivo);
  return r.pontos.map((p) => p.p50);
};

const planos = (r: ResultadoPrevisao, valor: number, horizonte = 6) => {
  const v = p50(r);
  expect(v).toHaveLength(horizonte);
  for (const x of v) expect(x).toBeCloseTo(valor, 6);
};

describe('mediaValidos', () => {
  it('janela fixa dos ultimos meses de calendario', () => {
    expect(mediaValidos([1, 2, 3, 4, 5], [false, false, false, false, false], 3)).toEqual({ media: 4, semMesValido: false });
    expect(mediaValidos([1, 2], [false, false], 6)).toEqual({ media: 1.5, semMesValido: false });
  });
  it('mascarado sai do numerador e do denominador, sem buscar mes mais antigo', () => {
    expect(mediaValidos([100, 20, 30, 40], [false, false, true, false], 3)).toEqual({ media: 30, semMesValido: false });
  });
  it('todos mascarados na janela: media sem mascara e semMesValido', () => {
    expect(mediaValidos([100, 20, 30, 40], [false, true, true, true], 3)).toEqual({ media: 30, semMesValido: true });
    expect(mediaValidos([], [], 3)).toEqual({ media: 0, semMesValido: true });
  });
});

describe('baselines a mao: [10, 20, 30, 40]', () => {
  const s = serie([10, 20, 30, 40]);
  it('planilha-q, planilha-r, ingenuo e media ponderada (3,2,1)', () => {
    planos(prever('planilha-q', s), 30);
    planos(prever('planilha-r', s), 25);
    planos(prever('ingenuo', s), 40);
    planos(prever('media-ponderada', s), 33.333333);
  });
  it('ingenuo sazonal precisa de 13 meses validos', () => {
    expect(prever('ingenuo-sazonal', s)).toEqual({ ok: false, metodo: 'ingenuo-sazonal', motivo: 'historico-curto' });
  });
  it('origem e meses do horizonte', () => {
    const r = prever('planilha-q', s, 3);
    if (!r.ok) throw new Error('ok');
    expect(r.origem).toBe('2025-04');
    expect(r.versao).toBe('p1.1.0');
    expect(r.pontos.map((p) => [p.h, p.anoMes])).toEqual([[1, '2025-05'], [2, '2025-06'], [3, '2025-07']]);
    expect(r.avisos).toEqual([]);
  });
});

describe('baselines com mascara', () => {
  const valores = [10, 20, 30, 40];
  it('mascarado sai da media e da ponderada', () => {
    const s = serie(valores, [false, false, true, false]);
    planos(prever('planilha-q', s), 30);
    planos(prever('planilha-r', s), (10 + 20 + 40) / 3);
    planos(prever('media-ponderada', s), (20 * 1 + 40 * 3) / 4);
  });
  it('ingenuo pula o ultimo mes mascarado', () => {
    planos(prever('ingenuo', serie(valores, [false, false, true, true])), 20);
  });
  it('janela toda mascarada: media sem mascara + sem-mes-valido', () => {
    const s = serie([1, 2, 3, 4, 5, 6], [false, false, false, true, true, true]);
    const q = prever('planilha-q', s);
    planos(q, 5);
    if (!q.ok) throw new Error('ok');
    expect(q.avisos).toEqual(['sem-mes-valido']);
    const w = prever('media-ponderada', s);
    planos(w, (4 * 1 + 5 * 2 + 6 * 3) / 6);
    if (!w.ok) throw new Error('ok');
    expect(w.avisos).toEqual(['sem-mes-valido']);
  });
  it('sem nenhum mes valido: historico-curto', () => {
    expect(prever('planilha-q', serie([5, 6], [true, true]))).toEqual({
      ok: false,
      metodo: 'planilha-q',
      motivo: 'historico-curto',
    });
  });
});

describe('ingenuo sazonal', () => {
  const ate = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  it('p50[h] = y[T+h-12]', () => {
    const r = prever('ingenuo-sazonal', serie(ate(13)), 12);
    expect(p50(r)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
  it('mascarado: usa 24 meses antes, se existir e nao mascarado', () => {
    const m = new Array<boolean>(25).fill(false);
    m[13] = true; // y[T+1-12]
    expect(p50(prever('ingenuo-sazonal', serie(ate(25), m), 2))).toEqual([2, 15]);
  });
  it('mascarado sem 24 meses antes: media dos 12 ultimos validos', () => {
    const m = new Array<boolean>(14).fill(false);
    m[2] = true;
    const r = prever('ingenuo-sazonal', serie(ate(14), m), 1);
    planos(r, 99 / 11, 1);
  });
});

describe('regras comuns (validarAntes)', () => {
  const metodos = Object.keys(METODOS_BASELINE) as (keyof typeof METODOS_BASELINE)[];
  it('horizonte fora de 1..12 ou nao inteiro', () => {
    for (const id of metodos) {
      for (const h of [0, 13, 2.5, -1]) {
        expect(prever(id, serie([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), h)).toEqual({
          ok: false,
          metodo: id,
          motivo: 'horizonte-invalido',
        });
      }
    }
  });
  it('sem dados', () => {
    for (const id of metodos) expect(prever(id, serie([]))).toEqual({ ok: false, metodo: id, motivo: 'sem-dados' });
  });
  it('serie toda zero: ok com zero e aviso sem-venda, mesmo curta', () => {
    for (const id of metodos) {
      const r = prever(id, serie([0, 0]));
      planos(r, 0);
      if (!r.ok) throw new Error('ok');
      expect(r.avisos).toEqual(['sem-venda']);
    }
  });
  it('validarAntes devolve null quando pode prever', () => {
    expect(validarAntes(serie([1, 2, 3]), { horizonte: 6 }, 'ses', 3)).toBeNull();
    expect(validarAntes(serie([1, 2, 3]), { horizonte: 6 }, 'ses', 4)).toEqual({
      ok: false,
      metodo: 'ses',
      motivo: 'historico-curto',
    });
  });
  it('constante: todos os baselines dao a constante', () => {
    const s = serie(new Array<number>(14).fill(100));
    for (const id of metodos) planos(prever(id, s), 100);
  });
});

// Paridade com o motor: a fixture ANONIMIZADA 10-2 (338 produtos). Janela fixa de calendario, sem mascara.
describe('paridade planilha Q e R x motor (fixture 10-2)', () => {
  const q = JSON.parse(
    readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
  ) as Quinzena;
  const linhas = calcular(q, { hoje: '2026-10-20', somarChegada5oMes: false });
  const { series, erros } = normalizarSeries(serieDaQuinzena(q));
  const porId = new Map(series.map((s) => [s.id, s]));
  const igual = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

  it('338 series, 6 meses cada, nenhum erro de entrada', () => {
    expect(erros).toEqual([]);
    expect(series).toHaveLength(338);
    expect(series.every((s) => s.valores.length === 6 && s.inicio === '2026-04')).toBe(true);
  });

  it('planilha-q (h = 1) = Q e planilha-r (h = 1) = R do motor nas 338 linhas', () => {
    expect(linhas).toHaveLength(338);
    let q338 = 0;
    let r338 = 0;
    for (const l of linhas) {
      const s = porId.get('linha-' + l.linha)!;
      const rq = METODOS_BASELINE['planilha-q'](s, { horizonte: 1 });
      const rr = METODOS_BASELINE['planilha-r'](s, { horizonte: 1 });
      if (rq.ok && igual(rq.pontos[0].p50, l.Q)) q338++;
      if (rr.ok && igual(rr.pontos[0].p50, l.R)) r338++;
    }
    expect(q338).toBe(338);
    expect(r338).toBe(338);
  });

  it('com 6 meses: ponderada sempre ok; ingenuo sazonal so para serie toda zero (sem-venda)', () => {
    for (const s of series) {
      expect(METODOS_BASELINE['media-ponderada'](s, { horizonte: 6 }).ok).toBe(true);
      expect(METODOS_BASELINE['ingenuo-sazonal'](s, { horizonte: 6 }).ok).toBe(s.valores.every((v) => v === 0));
    }
  });
});
