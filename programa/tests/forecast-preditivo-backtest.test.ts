import { describe, expect, it } from 'vitest';
import { criteriosFalhos, rodarBacktest, validarOpcoesBacktest } from '../src/utils/forecastPreditivoBacktest';
import type { LinhaResultado, MedidasPromocao, OpcoesBacktest } from '../src/utils/forecastPreditivoBacktest';
import { METODOS } from '../src/utils/forecastPreditivoMetodos';
import { normalizarSeries, somarMeses } from '../src/utils/forecastPreditivoSerie';
import { AVISO_IDS, METODO_IDS } from '../src/utils/forecastPreditivoTipos';
import type { SerieEntrada, SerieNormalizada } from '../src/utils/forecastPreditivoTipos';
import { seriesSinteticas } from './helpers/forecastPreditivoSinteticas';

const OPCOES: OpcoesBacktest = {
  horizonte: 6,
  minTreino: 6,
  metodos: [...METODO_IDS],
  leadTimePadraoDias: 90,
  razaoFaltaExcesso: 3,
  usarMascara: true,
};
const sinteticas = (...ids: string[]): SerieEntrada[] => seriesSinteticas().filter((s) => ids.length === 0 || ids.includes(s.id));
const normal = (...ids: string[]): SerieNormalizada[] => normalizarSeries(sinteticas(...ids)).series;
const rodar = (entrada: SerieNormalizada[], o: Partial<OpcoesBacktest> = {}) => rodarBacktest(entrada, { ...OPCOES, ...o });
const linha = (linhas: LinhaResultado[], segmento: string, metodo: string) => linhas.find((l) => l.segmento === segmento && l.metodo === metodo)!;
const copias = (base: SerieEntrada, n: number): SerieEntrada[] =>
  Array.from({ length: n }, (_, i) => ({ ...base, id: `${base.id}${i + 1}` }));

describe('validarOpcoesBacktest', () => {
  it('opcoes validas nao dao erro', () => {
    expect(validarOpcoesBacktest(OPCOES)).toEqual([]);
  });
  it('cada campo invalido gera um erro', () => {
    expect(validarOpcoesBacktest({ ...OPCOES, horizonte: 0 })).toHaveLength(1);
    expect(validarOpcoesBacktest({ ...OPCOES, horizonte: 13 })).toHaveLength(1);
    expect(validarOpcoesBacktest({ ...OPCOES, horizonte: 2.5 })).toHaveLength(1);
    expect(validarOpcoesBacktest({ ...OPCOES, minTreino: 0 })).toHaveLength(1);
    expect(validarOpcoesBacktest({ ...OPCOES, metodos: [] })).toHaveLength(1);
    expect(validarOpcoesBacktest({ ...OPCOES, metodos: ['xyz' as never] })).toHaveLength(1);
    expect(validarOpcoesBacktest({ ...OPCOES, leadTimePadraoDias: 4000 })).toHaveLength(1);
    expect(validarOpcoesBacktest({ ...OPCOES, razaoFaltaExcesso: 0 })).toHaveLength(1);
  });
  it('rodarBacktest lanca com opcoes invalidas', () => {
    expect(() => rodar(normal(), { horizonte: 13 })).toThrow(/^opcoes invalidas: /);
  });
});

describe('estrutura do resultado', () => {
  const r = rodar(normal());
  it('cabecalho, contagens e avisos com todas as chaves', () => {
    expect(r.versao).toBe('p0.1.0');
    expect(r.hashConfig).toMatch(/^[0-9a-f]{64}$/);
    expect(r.hashEntrada).toMatch(/^[0-9a-f]{64}$/);
    expect(r.origens).toBe(30); // 2024-06 .. 2026-11
    expect(r.contagem).toEqual({ series: 11, comPrevisao: 10, semVenda: 1, historicoCurto: 1 });
    expect(Object.keys(r.avisos)).toEqual([...AVISO_IDS]);
    expect(r.avisos['degrau-nivel']).toBe(1);
    expect(r.avisos['sem-venda']).toBe(1);
    expect(r.avisos['historico-curto']).toBe(1);
    expect(r.avisos['lacuna-cortada']).toBe(0);
  });
  it('porSerie e array ordenado por id (sobrevive ao JSON)', () => {
    expect(Array.isArray(r.porSerie)).toBe(true);
    const ids = r.porSerie.map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
    expect(JSON.parse(JSON.stringify(r)).porSerie).toHaveLength(11);
    expect(r.porSerie.find((s) => s.id === 'NOVA')).toMatchObject({ origens: 0, avisos: ['historico-curto'] });
  });
  it('linhas: TOTAL primeiro, metodos na ordem de METODO_IDS, segmentos ABC, SBC e ABC/SBC', () => {
    const segs = [...new Set(r.linhas.map((l) => l.segmento))];
    expect(segs[0]).toBe('TOTAL');
    expect(r.linhas.slice(0, METODO_IDS.length).map((l) => l.metodo)).toEqual([...METODO_IDS]);
    expect(r.linhas.length).toBe(segs.length * METODO_IDS.length);
    const abc = segs.filter((s) => ['A', 'B', 'C', 'sem-venda'].includes(s));
    expect(abc).toEqual(['A', 'B', 'C', 'sem-venda'].filter((s) => abc.includes(s)));
    expect(segs.some((s) => s.includes('/'))).toBe(true);
    expect(segs.indexOf(abc[abc.length - 1])).toBeLessThan(segs.findIndex((s) => ['smooth', 'erratic', 'intermittent', 'lumpy', 'insuficiente'].includes(s)));
  });
  it('planilha-q e a referencia; nada e promovido na fase 0 (so candidato ou nao)', () => {
    expect(linha(r.linhas, 'TOTAL', 'planilha-q')).toMatchObject({ promovivel: 'referencia', criteriosFalhos: [], vitoria: null, itensAPiores: [] });
    expect(r.linhas.filter((l) => l.metodo !== 'planilha-q').every((l) => l.promovivel === 'nao' || l.promovivel === 'candidato')).toBe(true);
    for (const l of r.linhas) expect(l.criteriosFalhos.every((c) => c >= 1 && c <= 5)).toBe(true);
  });
});

describe('series sinteticas: valores conhecidos', () => {
  it('CONST: baselines, SES, Holt e Croston com WAPE 0; SBA com WAPE (alfa/2)', () => {
    const w = rodar(normal('CONST')).porSerie[0].wapeLT;
    for (const m of ['planilha-q', 'planilha-r', 'ingenuo', 'media-ponderada', 'ses', 'holt', 'holt-amortecido', 'croston']) expect(w[m]).toBeCloseTo(0, 9);
    expect(w['ingenuo-sazonal']).toBeCloseTo(0, 9);
    expect(w.sba).toBeCloseTo(0.025, 9);
  });
  it('TEND: Q erra -10 em h = 1 (WAPE 300/6075), Holt exato, Holt amortecido com vies negativo', () => {
    const r = rodar(normal('TEND'));
    const q = linha(r.linhas, 'TOTAL', 'planilha-q');
    expect(q.wapeH1).toBeCloseTo(300 / 6075, 9);
    expect(linha(r.linhas, 'TOTAL', 'holt').wapeH1).toBeCloseTo(0, 9);
    expect(linha(r.linhas, 'TOTAL', 'holt').wapeLT).toBeCloseTo(0, 9);
    expect(linha(r.linhas, 'TOTAL', 'holt-amortecido').viesLT!).toBeLessThan(0);
    expect(linha(r.linhas, 'TOTAL', 'planilha-q').viesLT!).toBeLessThan(0);
  });
  it('intersecao: Holt (min 8 meses) tem menos pares que Q (min 1)', () => {
    const r = rodar(normal('TEND'));
    expect(linha(r.linhas, 'TOTAL', 'holt').n).toBeLessThan(linha(r.linhas, 'TOTAL', 'planilha-q').n);
  });
  it('SAZ: ingenuo sazonal com erro 0 a partir do mes 13', () => {
    const l = linha(rodar(normal('SAZ')).linhas, 'TOTAL', 'ingenuo-sazonal');
    expect(l.n).toBeGreaterThan(0);
    expect(l.wapeH1).toBeCloseTo(0, 9);
    expect(l.wapeH3).toBeCloseTo(0, 9);
    expect(l.wapeLT).toBeCloseTo(0, 9);
  });
  it('ZERO: WAPE n/a (soma do real zero), contada como sem venda', () => {
    const r = rodar(normal('ZERO'));
    expect(r.contagem.semVenda).toBe(1);
    expect(r.porSerie[0].wapeLT['planilha-q']).toBeNull();
    expect(linha(r.linhas, 'TOTAL', 'planilha-q')).toMatchObject({ wapeH1: null, wapeLT: null, viesLT: null, custoRel: null });
  });
  it('INTERM: Croston 20 e SBA 19,5 na origem final', () => {
    const [s] = normal('INTERM');
    const c = METODOS.croston(s, { horizonte: 1 });
    const b = METODOS.sba(s, { horizonte: 1 });
    if (!c.ok || !b.ok) throw new Error('ok');
    expect(c.pontos[0].p50).toBeCloseTo(20, 9);
    expect(b.pontos[0].p50).toBeCloseTo(19.5, 9);
  });
});

describe('mascara de atipico e ruptura', () => {
  it('ATIP: com mascara = CONST; sem mascara a Q na origem 2026-12 e 233,333333', () => {
    const [s] = normal('ATIP');
    const q = METODOS['planilha-q'](s, { horizonte: 1 });
    const qSem = METODOS['planilha-q']({ ...s, mascara: s.mascara.map(() => false) }, { horizonte: 1 });
    if (!q.ok || !qSem.ok) throw new Error('ok');
    expect(q.pontos[0].p50).toBe(100);
    expect(qSem.pontos[0].p50).toBeCloseTo(233.333333, 6);
    expect(rodar([s]).porSerie[0].wapeLT['planilha-q']).toBeCloseTo(0, 9);
    expect(rodar([s], { usarMascara: false }).porSerie[0].wapeLT['planilha-q']!).toBeGreaterThan(0);
  });
  it('RUPT: a mascara remove os meses de ruptura; sem mascara a Q cai', () => {
    const [s] = normal('RUPT');
    expect(linha(rodar([s]).linhas, 'TOTAL', 'planilha-q').wapeH1).toBeCloseTo(0, 9);
    expect(linha(rodar([s], { usarMascara: false }).linhas, 'TOTAL', 'planilha-q').wapeH1!).toBeGreaterThan(0);
  });
});

describe('lead time', () => {
  const constante = (leadTimeDias: number | null): SerieNormalizada[] =>
    normalizarSeries([{ id: 'c', leadTimeDias, pontos: Array.from({ length: 36 }, (_, i) => ({ anoMes: somarMeses('2024-01', i), qtd: 100 })) }]).series;
  const n = (s: SerieNormalizada[], o: Partial<OpcoesBacktest> = {}) => linha(rodar(s, { metodos: ['planilha-q'], ...o }).linhas, 'TOTAL', 'planilha-q').n;
  it('o horizonte do lead time limita as observacoes (LT 30 -> 2 meses, LT 120 -> 5 meses)', () => {
    expect(n(constante(30))).toBe(29);
    expect(n(constante(120))).toBe(26);
  });
  it('sem lead time na serie vale o padrao da opcao', () => {
    expect(n(constante(null))).toBe(27); // 90 dias -> 4 meses
    expect(n(constante(null), { leadTimePadraoDias: 30 })).toBe(29);
  });
});

describe('promocao (avaliada, sem efeito)', () => {
  it('Holt em 3 rampas: candidato (criterios 1 a 5 atendidos)', () => {
    const tend = sinteticas('TEND')[0];
    const r = rodar(normalizarSeries(copias(tend, 3)).series);
    const l = linha(r.linhas, 'TOTAL', 'holt');
    expect(l.criteriosFalhos).toEqual([]);
    expect(l.promovivel).toBe('candidato');
    expect(l.vitoria).toBe(1);
    expect(l.custoRel!).toBeLessThanOrEqual(0.95);
    expect(l.origens).toBeGreaterThanOrEqual(6);
    expect(l.n).toBeGreaterThanOrEqual(30);
  });
  it('amostra pequena reprova o criterio 1', () => {
    const r = rodar(normal('TEND'), { minTreino: 30 });
    const l = linha(r.linhas, 'TOTAL', 'holt');
    expect(l.promovivel).toBe('nao');
    expect(l.criteriosFalhos).toContain(1);
  });
  it('sem ganho sobre a planilha (CONST): custo e vitoria falham', () => {
    const l = linha(rodar(normal('CONST')).linhas, 'TOTAL', 'ses');
    expect(l.criteriosFalhos).toEqual(expect.arrayContaining([4, 5]));
    expect(l.promovivel).toBe('nao');
  });
  it('criterio 6: serie A pior que 1,25 x a planilha e listada por id (nao reprova sozinha)', () => {
    const l = linha(rodar(normal('TEND')).linhas, 'TOTAL', 'ingenuo-sazonal');
    expect(l.itensAPiores).toEqual(['TEND']);
  });
  it('so os metodos pedidos viram linhas, mas a planilha continua a referencia da comparacao', () => {
    const r = rodar(normalizarSeries(copias(sinteticas('TEND')[0], 3)).series, { metodos: ['holt'] });
    expect(new Set(r.linhas.map((l) => l.metodo))).toEqual(new Set(['holt']));
    expect(linha(r.linhas, 'TOTAL', 'holt').custoRel).not.toBeNull();
  });
});

describe('promocao: fronteira de cada limiar (criterios 1 a 5)', () => {
  // Base que atende tudo, nos limites exatos de origens e n; cada caso mexe em UM campo.
  const BOA: MedidasPromocao = { origens: 6, n: 30, wapeLT: 0.5, wapeRef: 1, viesLT: 0.01, viesRef: 0.01, custoRel: 0.9, vitoria: 0.6 };
  const falhos = (m: Partial<MedidasPromocao>) => criteriosFalhos({ ...BOA, ...m });
  it('a base atende todos os criterios', () => {
    expect(falhos({})).toEqual([]);
  });
  it('minOrigens 6: 5 falha, 6 passa', () => {
    expect(falhos({ origens: 5 })).toEqual([1]);
    expect(falhos({ origens: 6 })).toEqual([]);
    expect(falhos({ origens: 7 })).toEqual([]);
  });
  it('minObs 30: 29 falha, 30 passa', () => {
    expect(falhos({ n: 29 })).toEqual([1]);
    expect(falhos({ n: 30 })).toEqual([]);
    expect(falhos({ n: 31 })).toEqual([]);
  });
  it('wapeRel 0,90 da planilha: 0,899 e 0,90 passam, 0,901 falha; sem WAPE falha', () => {
    expect(falhos({ wapeLT: 0.899 })).toEqual([]);
    expect(falhos({ wapeLT: 0.9 })).toEqual([]);
    expect(falhos({ wapeLT: 0.901 })).toEqual([2]);
    expect(falhos({ wapeLT: null })).toEqual([2]);
    expect(falhos({ wapeRef: null })).toEqual([2]);
  });
  it('viesMax 0,10 (planilha com vies grande para isolar o teto)', () => {
    const ref = { viesRef: 0.5 };
    expect(falhos({ ...ref, viesLT: 0.099 })).toEqual([]);
    expect(falhos({ ...ref, viesLT: 0.1 })).toEqual([]);
    expect(falhos({ ...ref, viesLT: 0.101 })).toEqual([3]);
    expect(falhos({ viesLT: null })).toEqual([3]);
  });
  it('viesFolga 0,02 sobre o vies absoluto da planilha (planilha sem vies)', () => {
    const ref = { viesRef: 0 };
    expect(falhos({ ...ref, viesLT: 0.019 })).toEqual([]);
    expect(falhos({ ...ref, viesLT: 0.02 })).toEqual([]);
    expect(falhos({ ...ref, viesLT: 0.021 })).toEqual([3]);
    expect(falhos({ viesRef: -0.04, viesLT: 0.059 })).toEqual([]); // folga sobre |viesRef|
    expect(falhos({ viesRef: -0.04, viesLT: 0.061 })).toEqual([3]);
    expect(falhos({ viesRef: null, viesLT: 0.021 })).toEqual([3]); // sem vies da planilha vale 0
  });
  it('vies negativo grande reprova (vale o modulo)', () => {
    expect(falhos({ viesRef: 0.5, viesLT: -0.5 })).toEqual([3]);
    expect(falhos({ viesRef: 0.5, viesLT: -0.101 })).toEqual([3]);
    expect(falhos({ viesRef: 0.5, viesLT: -0.099 })).toEqual([]);
    expect(falhos({ viesRef: 0, viesLT: -0.021 })).toEqual([3]);
    expect(falhos({ viesRef: 0, viesLT: -0.019 })).toEqual([]);
  });
  it('custoRel 0,95: 0,949 e 0,95 passam, 0,951 falha; sem custo da planilha falha', () => {
    expect(falhos({ custoRel: 0.949 })).toEqual([]);
    expect(falhos({ custoRel: 0.95 })).toEqual([]);
    expect(falhos({ custoRel: 0.951 })).toEqual([4]);
    expect(falhos({ custoRel: null })).toEqual([4]);
  });
  it('vitoria 55%: 0,549 falha, 0,55 e 0,551 passam; sem comparaveis falha', () => {
    expect(falhos({ vitoria: 0.549 })).toEqual([5]);
    expect(falhos({ vitoria: 0.55 })).toEqual([]);
    expect(falhos({ vitoria: 0.551 })).toEqual([]);
    expect(falhos({ vitoria: null })).toEqual([5]);
  });
  it('varios criterios falhos saem em ordem crescente', () => {
    expect(falhos({ origens: 1, wapeLT: 2, viesLT: 1, custoRel: 2, vitoria: 0 })).toEqual([1, 2, 3, 4, 5]);
  });
  it('criterio 6 so considera series A: serie B/C pior que 1,25 x a planilha nao entra em itensAPiores', () => {
    const grande: SerieEntrada = { id: 'GRANDE', leadTimeDias: 30, pontos: sinteticas('CONST')[0].pontos.map((p) => ({ ...p, qtd: 100000 })) };
    const r = rodar(normalizarSeries([...copias(sinteticas('TEND')[0], 2), grande]).series, { metodos: ['planilha-q', 'ingenuo-sazonal'] });
    for (const id of ['TEND1', 'TEND2']) {
      const s = r.porSerie.find((x) => x.id === id)!;
      expect(s.abc).not.toBe('A'); // a serie gigante domina o volume
      expect(s.wapeLT['ingenuo-sazonal']!).toBeGreaterThan(1.25 * s.wapeLT['planilha-q']!); // pior que o limite do criterio 6
    }
    expect(linha(r.linhas, 'TOTAL', 'ingenuo-sazonal').itensAPiores).toEqual([]);
  });
});

describe('determinismo', () => {
  it('duas rodadas e ordem de entrada invertida dao o mesmo JSON, byte a byte', () => {
    const a = JSON.stringify(rodar(normal()));
    expect(JSON.stringify(rodar(normal()))).toBe(a);
    const invertida = normalizarSeries([...sinteticas()].reverse()).series.reverse();
    expect(JSON.stringify(rodar(invertida))).toBe(a);
  });
  it('hashEntrada muda com a entrada e nao com a mascara (opcao)', () => {
    const base = rodar(normal());
    expect(rodar(normal('CONST')).hashEntrada).not.toBe(base.hashEntrada);
    expect(rodar(normal(), { usarMascara: false }).hashEntrada).toBe(base.hashEntrada);
    expect(rodar(normal(), { usarMascara: false }).opcoes.usarMascara).toBe(false);
  });
  it('a entrada nao e alterada', () => {
    const s = normal();
    const copia = JSON.stringify(s);
    rodar(s, { usarMascara: false });
    expect(JSON.stringify(s)).toBe(copia);
  });
});
