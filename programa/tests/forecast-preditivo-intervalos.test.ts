import { describe, expect, it } from 'vitest';
import { PREDITIVO_CONFIG_P1 } from '../src/utils/forecastPreditivoConfigP1';
import { escalaLeadTime, intervalosEmpiricos, pinball, quantil } from '../src/utils/forecastPreditivoIntervalos';
import type { Intervalo, ParIntervalo } from '../src/utils/forecastPreditivoIntervalos';
import { somarMeses } from '../src/utils/forecastPreditivoSerie';
import type { SerieNormalizada } from '../src/utils/forecastPreditivoTipos';
import { mulberry32 } from './helpers/forecastPreditivoSinteticas';

const CFG = PREDITIVO_CONFIG_P1.intervalo;
const serie = (valores: number[], mascara?: boolean[]): SerieNormalizada => ({
  id: 'x',
  inicio: '2025-01',
  valores,
  mascara: mascara ?? valores.map(() => false),
  meta: { fonte: null, familia: null, leadTimeDias: null },
  avisos: [],
});

let contador = 0;
// Par cujo residuo escalonado e `r` (previsto 100, escala 50).
function parComResiduo(r: number, origem: string, hl = 3, celula = 'A'): ParIntervalo {
  return { indice: contador++, origem, liberacao: somarMeses(origem, hl), celula, hl, previstoLT: 100, realLT: 100 + 50 * r, escala: 50 };
}
const residuos30 = Array.from({ length: 30 }, (_, k) => (k - 15) / 10);
const teste = (origem: string, previstoLT = 100, hl = 3, celula = 'A'): ParIntervalo => ({
  indice: contador++,
  origem,
  liberacao: somarMeses(origem, hl),
  celula,
  hl,
  previstoLT,
  realLT: 100,
  escala: 50,
});

describe('quantil (tipo 7)', () => {
  it('valores a mao', () => {
    expect(quantil([7], 0.1)).toBe(7);
    expect(quantil([7], 0.9)).toBe(7);
    expect(quantil([], 0.5)).toBeNull();
    const um10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantil(um10, 0.1)).toBeCloseTo(1.9, 12);
    expect(quantil(um10, 0.9)).toBeCloseTo(9.1, 12);
    expect(quantil(um10, 0)).toBe(1);
    expect(quantil(um10, 1)).toBe(10);
    expect(quantil(um10, 0.5)).toBeCloseTo(5.5, 12);
    expect(quantil(residuos30, 0.1)).toBeCloseTo(-1.21, 12);
    expect(quantil(residuos30, 0.9)).toBeCloseTo(1.11, 12);
  });
  it('q fora de [0, 1] ou NaN lanca', () => {
    expect(() => quantil([1, 2], -0.01)).toThrow();
    expect(() => quantil([1, 2], 1.01)).toThrow();
    expect(() => quantil([1, 2], Number.NaN)).toThrow();
  });
});

describe('pinball', () => {
  it('valores a mao', () => {
    expect(pinball(100, 80, 0.1)).toBeCloseTo(2, 12);
    expect(pinball(100, 120, 0.9)).toBeCloseTo(2, 12);
    expect(pinball(100, 120, 0.1)).toBeCloseTo(18, 12);
    expect(pinball(100, 100, 0.1)).toBe(0);
    expect(pinball(100, 80, 0.9)).toBeCloseTo(18, 12);
  });
});

describe('escalaLeadTime', () => {
  it('nivel medio dos ultimos 12 meses x hl; mascarado fora; janela e parametro', () => {
    expect(escalaLeadTime(serie(new Array<number>(20).fill(10)), 3)).toBe(30);
    expect(escalaLeadTime(serie([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 7, 9], [...new Array<boolean>(12).fill(false), false, true]), 2)).toBeCloseTo(2 * ((10 + 7) / 11), 9);
    expect(escalaLeadTime(serie([2, 4, 6, 8]), 1, 2)).toBe(7);
    expect(escalaLeadTime(serie([0, 0, 0]), 4)).toBe(0);
  });
});

describe('intervalosEmpiricos: valores a mao', () => {
  it('30 residuos (k-15)/10 -> p10 39,5 e p90 155,5 (fonte celula); previstoLT 10 -> piso 0', () => {
    const base = residuos30.map((r) => parComResiduo(r, '2024-06'));
    const pares = [...base, teste('2025-01'), teste('2025-01', 10)];
    const r = intervalosEmpiricos(pares);
    expect(r.slice(0, 30).every((x) => x === null)).toBe(true); // origem < liberacao de todos
    expect(r[30]!.p10).toBeCloseTo(39.5, 9);
    expect(r[30]!.p90).toBeCloseTo(155.5, 9);
    expect(r[30]!.fonte).toBe('celula');
    expect(r[31]!.p10).toBe(0);
    expect(r[31]!.p90).toBeCloseTo(65.5, 9);
  });
  it('pares do mesmo mes compartilham os quantis', () => {
    const base = residuos30.map((r) => parComResiduo(r, '2024-06'));
    const r = intervalosEmpiricos([...base, teste('2025-01', 100), teste('2025-01', 200)]);
    expect((r[31]!.p10 - 200) / 50).toBeCloseTo((r[30]!.p10 - 100) / 50, 9);
  });
});

describe('intervalosEmpiricos: fronteiras do pool', () => {
  const comCelula = (nA: number, nB: number) => [
    ...residuos30.slice(0, nA).map((r) => parComResiduo(r, '2024-06', 3, 'A')),
    ...residuos30.slice(0, nB).map((r) => parComResiduo(r, '2024-06', 3, 'B')),
  ];
  it('celula com 29 residuos usa TOTAL (se >= 30); com 30 usa a celula', () => {
    const a29 = [...comCelula(29, 1), teste('2025-01', 100, 3, 'A')];
    expect(intervalosEmpiricos(a29)[30]!.fonte).toBe('total');
    const a30 = [...comCelula(30, 0), teste('2025-01', 100, 3, 'A')];
    expect(intervalosEmpiricos(a30)[30]!.fonte).toBe('celula');
  });
  it('TOTAL com 29 residuos -> null', () => {
    const r = intervalosEmpiricos([...comCelula(29, 0), teste('2025-01', 100, 3, 'A')]);
    expect(r[29]).toBeNull();
    const r2 = intervalosEmpiricos([...comCelula(15, 14), teste('2025-01', 100, 3, 'A')]);
    expect(r2[29]).toBeNull(); // 29 no total
    const r3 = intervalosEmpiricos([...comCelula(15, 15), teste('2025-01', 100, 3, 'A')]);
    expect(r3[30]!.fonte).toBe('total'); // 30 no total, 15 na celula
  });
  it('hl diferente nao compartilha pool', () => {
    const r = intervalosEmpiricos([...residuos30.map((x) => parComResiduo(x, '2024-06', 3)), teste('2025-01', 100, 4)]);
    expect(r[30]).toBeNull();
  });
  it('cfg chega ao calculo: minResiduos e quantis', () => {
    const tres = [-1, 0, 1].map((x) => parComResiduo(x, '2024-06'));
    expect(intervalosEmpiricos([...tres, teste('2025-01')], { ...CFG, minResiduos: 3, q10: 0.25, q90: 0.75 })[3]).toEqual({ p10: 100 - 25, p90: 100 + 25, fonte: 'celula' });
    expect(intervalosEmpiricos([...tres, teste('2025-01')], { ...CFG, minResiduos: 4 })[3]).toBeNull();
  });
  it('escala 0 -> null e o par nao entra no pool', () => {
    const base = residuos30.slice(0, 29).map((r) => parComResiduo(r, '2024-06'));
    const zeros = Array.from({ length: 5 }, () => ({ ...parComResiduo(0, '2024-06'), escala: 0 }));
    const alvoEscala0 = { ...teste('2025-01'), escala: 0 };
    const r = intervalosEmpiricos([...base, ...zeros, teste('2025-01'), alvoEscala0]);
    expect(r[34]).toBeNull(); // 29 residuos validos < 30
    expect(r[35]).toBeNull();
    const com30 = intervalosEmpiricos([...base, ...zeros, parComResiduo(0.5, '2024-06'), teste('2025-01'), alvoEscala0]);
    expect(com30[35]).not.toBeNull();
    expect(com30[36]).toBeNull();
  });
});

describe('intervalosEmpiricos: as-of (sem vazamento)', () => {
  const base = () => residuos30.map((r) => parComResiduo(r, '2025-05')); // liberacao 2025-08
  it('liberacao 2025-08 nao entra na origem 2025-07 e entra na 2025-08', () => {
    const r = intervalosEmpiricos([...base(), teste('2025-07'), teste('2025-08')]);
    expect(r[30]).toBeNull();
    expect(r[31]).not.toBeNull();
  });
  it('propriedade: alterar realLT de par com liberacao > o nao muda intervalo algum de origem <= o', () => {
    const rng = mulberry32(777);
    const pares: ParIntervalo[] = [];
    for (let i = 0; i < 600; i++) {
      const origem = somarMeses('2024-06', Math.floor(rng() * 24));
      const hl = 2 + Math.floor(rng() * 3);
      const prev = 50 + Math.floor(rng() * 100);
      pares.push({ indice: i, origem, liberacao: somarMeses(origem, hl), celula: ['smooth', 'lumpy'][Math.floor(rng() * 2)], hl, previstoLT: prev, realLT: Math.floor(rng() * 300), escala: 40 + Math.floor(rng() * 40) });
    }
    const antes = intervalosEmpiricos(pares);
    for (const corte of ['2025-03', '2025-08', '2026-01']) {
      const alterados = pares.map((p) => (p.liberacao > corte ? { ...p, realLT: p.realLT + 10000 } : p));
      expect(alterados.some((p, i) => p !== pares[i])).toBe(true);
      const depois = intervalosEmpiricos(alterados);
      pares.forEach((p, i) => {
        if (p.origem <= corte) expect(depois[i]).toEqual(antes[i]);
      });
    }
    expect(antes.some((x) => x !== null)).toBe(true);
  });
  it('a ordem dos pares de entrada nao muda o intervalo de cada par', () => {
    const pares = [...base(), teste('2025-08'), teste('2025-09', 120), teste('2025-12', 80)];
    const a = intervalosEmpiricos(pares);
    const inv = [...pares].reverse();
    const b = intervalosEmpiricos(inv);
    pares.forEach((_, i) => expect(b[pares.length - 1 - i]).toEqual(a[i]));
  });
});

describe('intervalosEmpiricos: complexidade', () => {
  it('40.000 pares em tempo linear-logaritmico (sem quantil por par nem varredura quadratica)', () => {
    const rng = mulberry32(99);
    const pares: ParIntervalo[] = [];
    for (let i = 0; i < 40000; i++) {
      const origem = somarMeses('2024-06', i % 24);
      const hl = 2 + (i % 5);
      pares.push({ indice: i, origem, liberacao: somarMeses(origem, hl), celula: ['smooth', 'erratic', 'lumpy'][i % 3], hl, previstoLT: 100, realLT: Math.floor(rng() * 200), escala: 80 });
    }
    const t0 = performance.now();
    const r: (Intervalo | null)[] = intervalosEmpiricos(pares);
    // medido ~0,1 s; o limite alto evita flake sob CPU carregada e ainda barra o O(n^2) (1,6 bi de passos) nesta massa
    expect(performance.now() - t0).toBeLessThan(30000);
    expect(r.filter((x) => x !== null).length).toBeGreaterThan(20000);
  });
});
