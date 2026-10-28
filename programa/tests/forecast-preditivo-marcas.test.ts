import { describe, expect, it } from 'vitest';
import { marcasDaEntrada, prepararSeriesRef } from '../src/utils/forecastPreditivoMarcas';
import type { MarcasPorSerie } from '../src/utils/forecastPreditivoMarcas';
import { cortarAte, normalizarSeries, somarMeses } from '../src/utils/forecastPreditivoSerie';
import type { SerieEntrada } from '../src/utils/forecastPreditivoTipos';
import { marcasRef, seriesRef } from './helpers/forecastPreditivoSinteticasRef';

const mes = (t: number) => somarMeses('2025-01', t);
const serie = (id: string, qtds: number[], de = 0): SerieEntrada => ({ id, pontos: qtds.map((q, k) => ({ anoMes: mes(de + k), qtd: q })) });
const A = () => serie('A', [10, 20, 30, 40, 50, 60]);
const B = () => serie('B', [5, 5, 5, 5, 5, 5]);
const marcas = (o: Record<string, string[]>): MarcasPorSerie => new Map(Object.entries(o));
const achar = (r: ReturnType<typeof prepararSeriesRef>, id: string) => r.series.find((s) => s.id === id)!;

function congelarFundo<T>(o: T): T {
  if (o !== null && typeof o === 'object') {
    for (const v of o instanceof Map ? [...o.values()] : Object.values(o as Record<string, unknown>)) congelarFundo(v);
    Object.freeze(o);
  }
  return o;
}

describe('prepararSeriesRef: marca aplicada', () => {
  it('a marca mascara o mes e e contada como aplicada', () => {
    const r = prepararSeriesRef([A(), B()], marcas({ A: ['2025-03'] }), true);
    expect(achar(r, 'A').mascara).toEqual([false, false, true, false, false, false]);
    expect(achar(r, 'A').valores).toEqual([10, 20, 30, 40, 50, 60]);
    expect(achar(r, 'B').mascara).toEqual([false, false, false, false, false, false]);
    expect(r.marcas).toEqual({ recebidas: 1, aplicadas: 1, invalidas: 0, semSerie: 0, foraDaSerie: 0, duplicadas: 0 });
    expect(r.erros).toEqual([]);
  });

  it('flags atipico/ruptura dos pontos sao IGNORADAS e contadas', () => {
    const a = A();
    a.pontos[1] = { anoMes: mes(1), qtd: 20, atipico: true };
    a.pontos[2] = { anoMes: mes(2), qtd: 0, ruptura: true };
    a.pontos[3] = { anoMes: mes(3), qtd: 40, atipico: true, ruptura: true };
    const r = prepararSeriesRef([a, B()], new Map(), true);
    expect(achar(r, 'A').mascara.every((m) => !m)).toBe(true);
    expect(r.rupturaIgnorada).toBe(2);
    expect(r.atipicoDaEntradaIgnorado).toBe(2);
    expect(r.marcas.recebidas).toBe(0);
  });

  it('mes do calendario sem linha na serie vira ponto 0 mascarado, sem mes-duplicado-somado', () => {
    const a = serie('A', [10, 20, 40, 50, 60], 0);
    a.pontos = [a.pontos[0], a.pontos[1], a.pontos[2], a.pontos[3], a.pontos[4]]; // 2025-01,02,03,04,05; falta 2025-06
    const r = prepararSeriesRef([a, B()], marcas({ A: ['2025-06'] }), true);
    const s = achar(r, 'A');
    expect(s.valores).toEqual([10, 20, 40, 50, 60, 0]);
    expect(s.mascara).toEqual([false, false, false, false, false, true]);
    expect(s.avisos).not.toContain('mes-duplicado-somado');
    expect(r.marcas.aplicadas).toBe(1);
  });

  it('marca em mes que ja tem ponto nao duplica o mes', () => {
    const r = prepararSeriesRef([A(), B()], marcas({ A: ['2025-04'] }), true);
    expect(achar(r, 'A').avisos).not.toContain('mes-duplicado-somado');
    expect(achar(r, 'A').valores[3]).toBe(40);
  });
});

describe('prepararSeriesRef: fronteiras da marca', () => {
  // A comeca em 2025-02 (t1..t5); B cobre 2025-01..2025-06: calendario global = 2025-01..2025-06
  const entradas = () => [serie('A', [20, 30, 40, 50, 60], 1), B()];

  it('1o mes da serie aplica; mes anterior e apos o fim do calendario ficam fora', () => {
    const r = prepararSeriesRef(entradas(), marcas({ A: ['2025-01', '2025-02', '2025-06', '2025-07'] }), true);
    expect(r.marcas).toEqual({ recebidas: 4, aplicadas: 2, invalidas: 0, semSerie: 0, foraDaSerie: 2, duplicadas: 0 });
    const s = achar(r, 'A');
    expect(s.inicio).toBe('2025-02');
    expect(s.valores.length).toBe(5);
    expect(s.mascara).toEqual([true, false, false, false, true]);
  });

  it('mes fora do calendario global nao cria mes (nem tapa lacuna)', () => {
    const r = prepararSeriesRef(entradas(), marcas({ A: ['2024-06', '2026-01'] }), true);
    expect(r.marcas.foraDaSerie).toBe(2);
    expect(r.marcas.aplicadas).toBe(0);
    expect(achar(r, 'A').valores.length).toBe(5);
    expect(achar(r, 'B').valores.length).toBe(6);
  });

  it('lacuna global (mes que nenhuma serie tem) continua cortando a serie e a marca ali fica fora', () => {
    const a = { id: 'A', pontos: [0, 1, 3, 4].map((t) => ({ anoMes: mes(t), qtd: 10 + t })) }; // sem 2025-03
    const b = { id: 'B', pontos: [0, 1, 3, 4].map((t) => ({ anoMes: mes(t), qtd: 5 })) };
    const r = prepararSeriesRef([a, b], marcas({ A: ['2025-03'] }), true);
    expect(r.marcas.foraDaSerie).toBe(1);
    expect(achar(r, 'A').avisos).toContain('lacuna-cortada');
    expect(achar(r, 'A').inicio).toBe('2025-04');
  });
});

describe('prepararSeriesRef: marcas invalidas', () => {
  it.each([['2025-13'], [''], ['abc'], ['2025-3'], ['2025-00']])('%j -> invalida', (m) => {
    const r = prepararSeriesRef([A(), B()], marcas({ A: [m] }), true);
    expect(r.marcas).toEqual({ recebidas: 1, aplicadas: 0, invalidas: 1, semSerie: 0, foraDaSerie: 0, duplicadas: 0 });
    expect(achar(r, 'A').mascara.every((x) => !x)).toBe(true);
  });

  it('serie inexistente -> semSerie; repetida -> duplicadas (aplica uma vez)', () => {
    const r = prepararSeriesRef([A(), B()], marcas({ X: ['2025-03'], A: ['2025-03', '2025-03', '2025-04'] }), true);
    expect(r.marcas).toEqual({ recebidas: 4, aplicadas: 2, invalidas: 0, semSerie: 1, foraDaSerie: 0, duplicadas: 1 });
    expect(achar(r, 'A').mascara).toEqual([false, false, true, true, false, false]);
  });

  it('usarMascara false: nenhuma marca aplicada (recebidas contada), flags da entrada continuam ignoradas', () => {
    const a = A();
    a.pontos[4] = { anoMes: mes(4), qtd: 50, atipico: true };
    const r = prepararSeriesRef([a, B()], marcas({ A: ['2025-03'], X: ['2025-01'] }), false);
    expect(r.marcas).toEqual({ recebidas: 2, aplicadas: 0, invalidas: 0, semSerie: 0, foraDaSerie: 0, duplicadas: 0 });
    expect(achar(r, 'A').mascara.every((m) => !m)).toBe(true);
    expect(r.atipicoDaEntradaIgnorado).toBe(1);
  });
});

describe('prepararSeriesRef: pureza e determinismo', () => {
  it('entrada e marcas congeladas (profundo) nao mudam e o resultado e o mesmo', () => {
    const livre = prepararSeriesRef([A(), B()], marcas({ A: ['2025-03', '2025-04'] }), true);
    const e = congelarFundo([A(), B()]);
    const m = congelarFundo(marcas({ A: ['2025-03', '2025-04'] }));
    const r = prepararSeriesRef(e, m, true);
    expect(r).toEqual(livre);
    expect(e[0].pontos.length).toBe(6);
  });

  it('a ordem das entradas e das marcas nao muda o resultado', () => {
    const r1 = prepararSeriesRef([A(), B()], marcas({ A: ['2025-04', '2025-03'], B: ['2025-02'] }), true);
    const r2 = prepararSeriesRef([B(), A()], marcas({ B: ['2025-02'], A: ['2025-03', '2025-04'] }), true);
    expect(r2).toEqual(r1);
  });

  it('Map vazio = normalizarSeries das entradas sem flags', () => {
    const entradas = seriesRef();
    const sem = entradas.map((e) => ({ ...e, pontos: e.pontos.map((p) => ({ anoMes: p.anoMes, qtd: p.qtd })) }));
    const r = prepararSeriesRef(entradas, new Map(), true);
    const base = normalizarSeries(sem);
    expect(r.series).toEqual(base.series);
    expect(r.erros).toEqual(base.erros);
    expect(r.rupturaIgnorada).toBe(2); // R-RUPT
    expect(achar(r, 'R-RUPT').mascara.every((m) => !m)).toBe(true);
  });

  it('marcasRef() mascara o pico real de R-ATIP (2026-07)', () => {
    const r = prepararSeriesRef(seriesRef(), marcasRef(), true);
    const s = achar(r, 'R-ATIP');
    expect(s.mascara.filter(Boolean).length).toBe(1);
    expect(s.mascara[30]).toBe(true);
    expect(s.valores[30]).toBe(600);
  });

  it('ponto NaN/Infinity e rejeitado e contado em erros sem ecoar o valor', () => {
    const a = A();
    a.pontos.push({ anoMes: mes(6), qtd: Number.NaN });
    a.pontos.push({ anoMes: mes(7), qtd: Number.POSITIVE_INFINITY });
    const r = prepararSeriesRef([a, B()], new Map(), true);
    expect(r.erros).toEqual(['serie A: ponto invalido', 'serie A: ponto invalido']);
    expect(r.erros.join(' ')).not.toMatch(/NaN|Infinity/);
  });
});

describe('causalidade da mascara', () => {
  it('a marca de um mes so aparece no treino de origens >= ao mes', () => {
    const s = achar(prepararSeriesRef([A(), B()], marcas({ A: ['2025-04'] }), true), 'A');
    expect(cortarAte(s, '2025-03')!.mascara.some(Boolean)).toBe(false);
    expect(cortarAte(s, '2025-04')!.mascara).toEqual([false, false, false, true]);
  });
});

describe('marcasDaEntrada', () => {
  it('pontos com atipico=true viram marcas; false/ausente nao', () => {
    const a = A();
    a.pontos[1] = { anoMes: mes(1), qtd: 20, atipico: true };
    a.pontos[4] = { anoMes: mes(4), qtd: 50, atipico: true };
    a.pontos[2] = { anoMes: mes(2), qtd: 30, atipico: false };
    const b = B();
    b.pontos[0] = { anoMes: mes(0), qtd: 5, ruptura: true };
    const m = marcasDaEntrada([a, b]);
    expect([...m.keys()]).toEqual(['A']);
    expect(m.get('A')).toEqual(['2025-02', '2025-05']);
  });

  it('entrada sem atipico -> Map vazio; ida e volta com prepararSeriesRef mascara o mes', () => {
    expect(marcasDaEntrada([A(), B()]).size).toBe(0);
    const a = A();
    a.pontos[2] = { anoMes: mes(2), qtd: 30, atipico: true };
    const r = prepararSeriesRef([a, B()], marcasDaEntrada([a, B()]), true);
    expect(achar(r, 'A').mascara[2]).toBe(true);
    expect(r.atipicoDaEntradaIgnorado).toBe(1);
    expect(r.marcas.aplicadas).toBe(1);
  });
});
