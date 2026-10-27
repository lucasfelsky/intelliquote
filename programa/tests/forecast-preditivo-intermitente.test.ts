import { describe, expect, it } from 'vitest';
import { crostonEstado, METODOS_INTERMITENTE } from '../src/utils/forecastPreditivoIntermitente';
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

describe('crostonEstado a mao', () => {
  it('[0,40,0,0,100,0,30], alfa 0,1: tamanho 44,4, intervalo 2,09, Croston 21,244019, SBA 20,181818', () => {
    const e = crostonEstado([0, 40, 0, 0, 100, 0, 30], nenhuma(7), 0.1)!;
    expect(e.tamanho).toBeCloseTo(44.4, 9);
    expect(e.intervalo).toBeCloseTo(2.09, 9);
    expect(e.tamanho / e.intervalo).toBeCloseTo(21.244019, 6);
    expect((1 - 0.1 / 2) * (e.tamanho / e.intervalo)).toBeCloseTo(20.181818, 6);
  });
  it('SSE: erros de 1 passo apos a 1a venda', () => {
    // 1a venda em 40 (intervalo 2): previsto 20 nos meses seguintes ate a proxima venda
    const e = crostonEstado([0, 40, 0], nenhuma(3), 0.1);
    expect(e).toBeNull(); // so 1 venda
    const dois = crostonEstado([0, 40, 0, 40], nenhuma(4), 0.1)!;
    // 0: erro 0 - 20 = -20 -> 400; 40: erro 40 - 20 = 20 -> 400
    expect(dois.sse).toBe(800);
  });
  it('menos de 2 vendas: null', () => {
    expect(crostonEstado([0, 0, 0], nenhuma(3), 0.1)).toBeNull();
    expect(crostonEstado([0, 5, 0], nenhuma(3), 0.1)).toBeNull();
  });
  it('mes mascarado sai da sequencia (nao conta no intervalo)', () => {
    const sem = crostonEstado([0, 40, 0, 100], nenhuma(4), 0.1)!;
    const com = crostonEstado([0, 40, 777, 0, 100], [false, false, true, false, false], 0.1)!;
    expect(com).toEqual(sem);
  });
});

describe('croston e sba (metodos)', () => {
  const tres = serie([0, 0, 60, 0, 0, 60, 0, 0, 60]); // [0,0,60] x 3
  it('[0,0,60] x 3: Croston 20 e SBA 19 com alfa 0,1', () => {
    // todos os alfas empatam em SSE; o primeiro da grade e 0,05 -> SBA 19,5. Com alfa 0,1 (calculo direto) -> 19.
    const e = crostonEstado(tres.valores, tres.mascara, 0.1)!;
    expect(e.tamanho / e.intervalo).toBeCloseTo(20, 9);
    expect((1 - 0.1 / 2) * (e.tamanho / e.intervalo)).toBeCloseTo(19, 9);
  });
  it('a grade escolhe o primeiro alfa no empate (0,05): Croston 20, SBA 19,5', () => {
    const c = ok(METODOS_INTERMITENTE.croston(tres, { horizonte: 4 }));
    const b = ok(METODOS_INTERMITENTE.sba(tres, { horizonte: 4 }));
    expect(c.parametros).toEqual({ alfa: 0.05 });
    expect(b.parametros).toEqual({ alfa: 0.05 });
    for (const p of c.pontos) expect(p.p50).toBeCloseTo(20, 9);
    for (const p of b.pontos) expect(p.p50).toBeCloseTo(19.5, 9);
  });
  it('SBA e sempre menor que Croston quando Croston > 0 (mesmo alfa)', () => {
    const s = serie([0, 40, 0, 0, 100, 0, 30]);
    const c = ok(METODOS_INTERMITENTE.croston(s, { horizonte: 2 }));
    const b = ok(METODOS_INTERMITENTE.sba(s, { horizonte: 2 }));
    expect(b.parametros.alfa).toBe(c.parametros.alfa);
    expect(b.pontos[0].p50).toBeCloseTo((1 - c.parametros.alfa / 2) * c.pontos[0].p50, 9);
    expect(b.pontos[0].p50).toBeLessThan(c.pontos[0].p50);
  });
  it('precisa de 2 meses com venda (nao de meses de calendario)', () => {
    for (const id of ['croston', 'sba'] as const) {
      expect(METODOS_INTERMITENTE[id](serie([0, 0, 0, 0, 0, 0, 5]), { horizonte: 6 })).toEqual({
        ok: false,
        metodo: id,
        motivo: 'historico-curto',
      });
      expect(METODOS_INTERMITENTE[id](serie([50, 70]), { horizonte: 6 })).toMatchObject({ ok: true });
    }
  });
  it('serie toda zero: ok com zero e sem-venda; horizonte invalido; sem dados', () => {
    const z = ok(METODOS_INTERMITENTE.croston(serie([0, 0, 0]), { horizonte: 3 }));
    expect(z.pontos.map((p) => p.p50)).toEqual([0, 0, 0]);
    expect(z.avisos).toEqual(['sem-venda']);
    expect(METODOS_INTERMITENTE.sba(serie([0, 5, 0, 5]), { horizonte: 0 })).toMatchObject({ motivo: 'horizonte-invalido' });
    expect(METODOS_INTERMITENTE.sba(serie([]), { horizonte: 3 })).toMatchObject({ motivo: 'sem-dados' });
  });
  it('vendas mascaradas nao contam', () => {
    const r = METODOS_INTERMITENTE.croston(serie([0, 40, 0, 500], [false, false, false, true]), { horizonte: 1 });
    expect(r).toMatchObject({ ok: false, motivo: 'historico-curto' });
  });
});
