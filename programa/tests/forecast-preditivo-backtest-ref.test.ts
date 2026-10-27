import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { compatibilidadeTabela, fatorCorrecao, lerTabelaCalibracao } from '../src/utils/forecastPreditivoCalibracao';
import { PARAMETROS_CORRECAO_PADRAO, VARIANTE_IDS, hashConfigRef } from '../src/utils/forecastPreditivoConfigRef';
import { rodarBacktestRef, rodarCenarioRef, tabelaDoBacktest, validarOpcoesBacktestRef } from '../src/utils/forecastPreditivoBacktestRef';
import type { OpcoesBacktestRef } from '../src/utils/forecastPreditivoBacktestRef';
import { prepararSeriesRef } from '../src/utils/forecastPreditivoMarcas';
import type { MarcasPorSerie } from '../src/utils/forecastPreditivoMarcas';
import { normalizarSeries, serieDaQuinzena, somarMeses } from '../src/utils/forecastPreditivoSerie';
import type { AnoMes, SerieEntrada } from '../src/utils/forecastPreditivoTipos';
import type { Quinzena } from '../src/utils/forecastTypes';
import { seriesDesempenho } from './helpers/forecastPreditivoSinteticasP1';
import { marcasRef, seriesRef } from './helpers/forecastPreditivoSinteticasRef';

interface Registro { id: string; origem: AnoMes; variante: 'q' | 'ref' | 'cor'; metodo: string | null; componentes: number; p50s: number[]; p10s: (number | null)[]; p90s: (number | null)[]; ltP10: number | null; ltP90: number | null; ltP50: number; ltMeses: number; fator: number }
const registro = vi.hoisted(() => [] as Registro[]);
// Espiao transparente: registra o que montarPrevisaoRef devolve em cada par (serie, origem, variante) do backtest.
vi.mock('../src/utils/forecastPreditivoReferencia', async (original) => {
  const m = await original<typeof import('../src/utils/forecastPreditivoReferencia')>();
  return {
    ...m,
    montarPrevisaoRef: (...a: Parameters<typeof m.montarPrevisaoRef>) => {
      const r = m.montarPrevisaoRef(...a);
      registro.push({ id: r.id, origem: r.origem!, variante: a[3].correcaoNivel ? 'cor' : a[4] === null ? 'q' : 'ref', metodo: r.metodoUsado, componentes: r.componentes, p50s: r.pontos.map((p) => p.p50), p10s: r.pontos.map((p) => p.p10), p90s: r.pontos.map((p) => p.p90), ltP10: r.leadTime.p10, ltP90: r.leadTime.p90, ltP50: r.leadTime.p50, ltMeses: r.leadTime.meses, fator: r.correcao.fator });
      return r;
    },
  };
});

const OPC: OpcoesBacktestRef = { horizonte: 6, minTreino: 6, leadTimePadraoDias: 90, razaoFaltaExcesso: 3, usarMascara: true, tetoVies: null, historicoMaximo: null, parametrosCorrecao: PARAMETROS_CORRECAO_PADRAO };
const prep = (e: SerieEntrada[], m: MarcasPorSerie = new Map(), usar = true) => prepararSeriesRef(e, m, usar).series;
const FIM = '2026-12';
const ent = (id: string, qtds: number[], dias: number | null = 30): SerieEntrada => ({
  id,
  leadTimeDias: dias,
  pontos: qtds.map((q, k) => ({ anoMes: somarMeses(FIM, k - (qtds.length - 1)), qtd: q })),
});
const k = (n: number, v = 100) => new Array<number>(n).fill(v);
const total = (r: ReturnType<typeof rodarCenarioRef>, v: string) => r.linhas.find((l) => l.segmento === 'TOTAL' && l.variante === v)!;
const crescentes = (n: number): SerieEntrada[] => Array.from({ length: n }, (_, i) => ({ id: 'G' + i, fonte: 'F01', leadTimeDias: 60, pontos: Array.from({ length: 36 }, (_, t) => ({ anoMes: somarMeses('2024-01', t), qtd: Math.round((50 + 10 * i) * Math.pow(1.03, t)) })) }));

describe('estrutura e amostra comum', () => {
  const entradas = seriesRef();
  const r = rodarBacktestRef(prep(entradas, marcasRef()), OPC);
  it('chaves, versao, cenarios [12, 6] e [12]; n igual nas 3 variantes de cada segmento', () => {
    expect(Object.keys(r)).toEqual(['versao', 'hashConfig', 'hashEntrada', 'opcoes', 'cenariosMinTreino', 'fontes', 'marcas', 'cenarios']);
    expect(r.versao).toBe('p1.1.0');
    expect(r.hashConfig).toBe(hashConfigRef());
    expect(r.cenariosMinTreino).toEqual([12, 6]);
    expect(r.cenarios.map((c) => c.principal)).toEqual([true, false]);
    expect(rodarBacktestRef(prep(entradas), { ...OPC, minTreino: 12 }).cenariosMinTreino).toEqual([12]);
    expect(Object.keys(r.cenarios[0])).toEqual(['minTreino', 'principal', 'origens', 'origensComObservacao', 'metades', 'contagem', 'contagemSegmentos', 'amostra', 'correcao', 'criterio7', 'linhas', 'porSerie', 'tabelas']);
    for (const c of r.cenarios) {
      expect(c.linhas.length % 3).toBe(0);
      for (let i = 0; i < c.linhas.length; i += 3) {
        expect(c.linhas.slice(i, i + 3).map((l) => l.variante)).toEqual([...VARIANTE_IDS]);
        expect(new Set(c.linhas.slice(i, i + 3).map((l) => l.n)).size).toBe(1);
      }
    }
  });
  it('amostra.pares igual com e sem mascara e com qualquer historicoMaximo (elegibilidade por meses de calendario)', () => {
    // marcas cedo na serie: com a elegibilidade por meses VALIDOS a amostra mudaria com a mascara
    const cedo = new Map([...marcasRef(), ['R-CRESC', ['2024-03', '2024-05']], ['R-DEGRAU', ['2024-02']]]);
    const comum = (o: Partial<OpcoesBacktestRef>, usar = true) => rodarBacktestRef(prep(entradas, cedo, usar), { ...OPC, ...o, usarMascara: usar }).cenarios.map((c) => c.amostra.pares);
    const base = comum({});
    expect(base.every((n) => n > 0)).toBe(true);
    expect(comum({}, false)).toEqual(base);
    for (const historicoMaximo of [3, 4, 7, 8, 240]) expect(comum({ historicoMaximo })).toEqual(base);
  });
  it('determinismo e entrada nao mutada', () => {
    const series = prep(entradas, marcasRef());
    const copia = JSON.stringify(series);
    expect(rodarBacktestRef(series, OPC)).toEqual(r);
    expect(rodarBacktestRef([...series].reverse(), OPC)).toEqual(r);
    expect(JSON.stringify(series)).toBe(copia);
  });
  it('opcoes invalidas lancam; fronteiras validas passam', () => {
    for (const o of [{ historicoMaximo: 0 }, { historicoMaximo: 241 }, { historicoMaximo: 2.5 }, { tetoVies: 1.01 }, { horizonte: 0 }, { horizonte: 13 }, { minTreino: 0 }, { razaoFaltaExcesso: 0 }, { parametrosCorrecao: { ...PARAMETROS_CORRECAO_PADRAO, k: 0 } }]) {
      expect(validarOpcoesBacktestRef({ ...OPC, ...o }).length).toBeGreaterThan(0);
      expect(() => rodarBacktestRef(prep(entradas), { ...OPC, ...o })).toThrow(/opcoes invalidas/);
    }
    for (const o of [{ historicoMaximo: 1 }, { historicoMaximo: 240 }, { tetoVies: 0 }, { tetoVies: 1 }, { horizonte: 12 }]) expect(validarOpcoesBacktestRef({ ...OPC, ...o })).toEqual([]);
  });
});

describe('realizado bruto e residuos de janela mascarada', () => {
  // 14 meses: o mes de indice 12 (2026-11) e um pico real de 600, marcado. minTreino 12 -> unica origem (indice 11), LT 30 dias -> hl 2.
  const e = ent('X', [...k(12), 600, 100]);
  const marcas = new Map([['X', ['2026-11']]]);
  const com = rodarBacktestRef(prep([e], marcas), { ...OPC, minTreino: 12 }).cenarios[0];
  const sem = rodarBacktestRef(prep([e], marcas, false), { ...OPC, minTreino: 12, usarMascara: false }).cenarios[0];
  it('o par com o pico marcado na janela realizada esta na amostra e o erro e o BRUTO (700 - 200 = 500 de falta)', () => {
    expect(com.amostra.pares).toBe(1);
    expect(sem.amostra.pares).toBe(1);
    for (const c of [com, sem]) {
      expect(c.porSerie[0].variantes.referencia.faltaLT).toBeCloseTo(500, 6);
      expect(c.porSerie[0].variantes['planilha-q'].faltaLT).toBeCloseTo(500, 6);
    }
  });
  it('residuos de janela mascarada nao entram nos pools e sao contados; sem a marca entram todos', () => {
    expect(com.amostra.residuosExcluidosMascara).toBe(2); // mensal h1 e lead time
    // origem 11: h1 (mes marcado) fora, h2 dentro; origem 12 (a outra): h1 dentro -> TOTAL|1 n 1; sem a marca, TOTAL|1 tem n 2 (a celula da origem 12 vira erratic)
    const n = (c: typeof com, celula: string, m: number) => c.tabelas.referencia.mensal.find((x) => x.celula === celula && x.m === m)?.n;
    expect([n(com, 'smooth', 1), n(com, 'smooth', 2), n(com, 'TOTAL', 1)]).toEqual([1, 1, 1]);
    expect(com.tabelas.referencia.leadTime).toEqual([]);
    expect(com.tabelas.referencia.nivel.n).toBe(0);
    expect(sem.amostra.residuosExcluidosMascara).toBe(0);
    expect([n(sem, 'smooth', 1), n(sem, 'smooth', 2), n(sem, 'TOTAL', 1)]).toEqual([1, 1, 2]);
    expect(sem.tabelas.referencia.leadTime.map((c) => c.m)).toEqual([2, 2]);
    expect(sem.tabelas.referencia.nivel.n).toBe(1);
  });
});

describe('historicoMaximo (simula a producao)', () => {
  const metodos = (historicoMaximo: number | null) => {
    registro.length = 0;
    rodarBacktestRef(prep([ent('Y', Array.from({ length: 24 }, (_, i) => 90 + (i % 5) * 5))]), { ...OPC, minTreino: 12, historicoMaximo });
    const refs = registro.filter((x) => x.variante === 'ref');
    return [...new Set(refs.map((x) => `${x.metodo}:${x.componentes}`))];
  };
  it('3 meses -> toda origem cai na Q; 4 -> SES+R (2); 7 -> 2; 8 -> +Holt (3); null = 240 = 3 componentes', () => {
    expect(metodos(3)).toEqual(['planilha-q:1']);
    expect(metodos(4)).toEqual(['combinacao-ses-r-holt:2']);
    expect(metodos(7)).toEqual(['combinacao-ses-r-holt:2']);
    expect(metodos(8)).toEqual(['combinacao-ses-r-holt:3']);
    expect(metodos(null)).toEqual(['combinacao-ses-r-holt:3']);
  });
  it('null e 240 dao o mesmo resultado; 7 muda o resultado', () => {
    const s = prep(seriesRef());
    const a = rodarBacktestRef(s, { ...OPC, historicoMaximo: null });
    const miolo = (r: typeof a) => r.cenarios.map((c) => [c.linhas, c.amostra, c.correcao, c.porSerie]);
    expect(miolo(rodarBacktestRef(s, { ...OPC, historicoMaximo: 240 }))).toEqual(miolo(a));
    expect(miolo(rodarBacktestRef(s, { ...OPC, historicoMaximo: 7 }))).not.toEqual(miolo(a));
    expect(rodarBacktestRef(s, { ...OPC, historicoMaximo: 7 }).opcoes.historicoMaximo).toBe(7);
  });
});

describe('nao vazamento (mutar o futuro nao muda nada de origens anteriores)', () => {
  const T = '2025-12';
  const base = seriesDesempenho(40);
  const marcas = new Map(base.slice(0, 15).map((s, i) => [s.id, [somarMeses('2024-08', i % 6)]] as [string, AnoMes[]]));
  const rodar = (entradas: SerieEntrada[], m: MarcasPorSerie) => {
    registro.length = 0;
    rodarBacktestRef(prep(entradas, m), { ...OPC, minTreino: 12 });
    return [...registro];
  };
  const ate = (rs: Registro[], corte: AnoMes) => rs.filter((x) => x.origem <= corte);
  const mutar = (entradas: SerieEntrada[], depoisDe: AnoMes) => entradas.map((s) => ({ ...s, pontos: s.pontos.map((p) => (p.anoMes > depoisDe ? { ...p, qtd: p.qtd * 3 + 17 } : p)) }));
  const original = rodar(base, marcas);

  it('previsoes (p50), intervalos, fator e metodo das origens <= corte nao mudam (as 3 variantes); marcas futuras tambem nao', () => {
    const futuro = new Map(marcas);
    for (const s of base.slice(15, 30)) futuro.set(s.id, [somarMeses(T, 4)]);
    const mudado = rodar(mutar(base, T), futuro);
    const a = ate(original, T);
    expect(a.length).toBeGreaterThan(300);
    expect(ate(mudado, T)).toEqual(a);
    expect(a.some((x) => x.variante === 'ref' && x.ltP10 !== null)).toBe(true); // nao e vazio: ha intervalo antes do corte
    expect(a.some((x) => x.variante === 'cor' && x.fator !== 1)).toBe(true); // nem a correcao
    expect(mudado.length).toBe(original.length);
  });
  it('controle: mudar valores ANTES do corte muda as previsoes seguintes', () => {
    const mudado = rodar(mutar(base, '2025-06'), marcas);
    expect(ate(mudado, T)).not.toEqual(ate(original, T));
  });
});

describe('correcao de nivel', () => {
  it('fator de cada origem = oracle independente (razao Soma real / Soma previsto SEM correcao, liberacoes em (origem - 12, origem], minimo 30)', () => {
    const base = seriesDesempenho(40);
    registro.length = 0;
    rodarBacktestRef(prep(base), { ...OPC, minTreino: 12 });
    const rs = [...registro];
    const valor = new Map(base.map((s) => [s.id, new Map(s.pontos.map((p) => [p.anoMes, p.qtd]))]));
    const refs = rs.filter((x) => x.variante === 'ref' && x.metodo === 'combinacao-ses-r-holt');
    const realLT = (x: Registro) => {
      let soma = 0;
      for (let h = 1; h <= x.ltMeses; h++) {
        const v = valor.get(x.id)!.get(somarMeses(x.origem, h));
        if (v === undefined) return null;
        soma += v;
      }
      return soma;
    };
    const pares = refs.flatMap((x) => { const r = realLT(x); return r === null ? [] : [{ lib: somarMeses(x.origem, x.ltMeses), real: r, prev: x.ltP50 }]; });
    let aplicados = 0;
    for (const c of rs.filter((x) => x.variante === 'cor' && x.metodo === 'combinacao-ses-r-holt')) {
      const janela = pares.filter((p) => p.lib <= c.origem && p.lib > somarMeses(c.origem, -12));
      const real = janela.reduce((t, p) => t + p.real, 0);
      const prev = janela.reduce((t, p) => t + p.prev, 0);
      const esperado = janela.length >= 30 && prev > 0 ? fatorCorrecao(real / prev, janela.length, PARAMETROS_CORRECAO_PADRAO).fator : 1;
      if (esperado !== 1) aplicados++;
      expect(c.fator).toBeCloseTo(esperado, 9);
    }
    expect(aplicados).toBeGreaterThan(50); // a correcao entrou em muitas origens: o oracle nao e vazio
  });

  it('fator 1 enquanto ha < 30 pares liberados (1 serie); a correcao nao se realimenta (mesmo nivel nas 2 tabelas)', () => {
    const c = rodarBacktestRef(prep([ent('Z', Array.from({ length: 30 }, (_, i) => 100 + 3 * i))]), { ...OPC, minTreino: 12 }).cenarios[0];
    expect(c.correcao).toMatchObject({ fatorMedio: 1, fatorMin: 1, fatorMax: 1, paresNoLimite: 0 });
    expect(c.correcao.paresSemDados).toBeGreaterThan(0);
    expect(c.tabelas.referencia.nivel).toEqual(c.tabelas['referencia-corrigida'].nivel);
  });
  it('em series crescentes a corrigida tem vies mais perto de 0; fator dentro de [0,85; 1,25]', () => {
    const c = rodarBacktestRef(prep(crescentes(12)), { ...OPC, minTreino: 12 }).cenarios[0];
    const ref = total(c, 'referencia').viesLT!;
    const cor = total(c, 'referencia-corrigida').viesLT!;
    expect(ref).toBeLessThan(0);
    expect(Math.abs(cor)).toBeLessThan(Math.abs(ref));
    expect(c.correcao.fatorMin!).toBeGreaterThanOrEqual(0.85);
    expect(c.correcao.fatorMax!).toBeLessThanOrEqual(1.25);
    expect(c.correcao.fatorMax!).toBeGreaterThan(1);
  });
  it('parametrosCorrecao chegam ao backtest (fatorMax 1 trava o fator em 1)', () => {
    const c = rodarBacktestRef(prep(crescentes(12)), { ...OPC, minTreino: 12, parametrosCorrecao: { ...PARAMETROS_CORRECAO_PADRAO, fatorMax: 1 } }).cenarios[0];
    expect(c.correcao.fatorMax).toBe(1);
    expect(c.correcao.paresNoLimite).toBeGreaterThan(0);
  });
  it('a razao falta/excesso chega ao custo por horizonte', () => {
    const s = prep(crescentes(6));
    const custo = (razaoFaltaExcesso: number) => total(rodarBacktestRef(s, { ...OPC, minTreino: 12, razaoFaltaExcesso }).cenarios[0], 'referencia').custoH;
    expect(custo(5)[0]).toBeGreaterThan(custo(1)[0]);
  });
});

describe('tabelaDoBacktest', () => {
  const r = rodarBacktestRef(prep(seriesDesempenho(40)), OPC);
  it('lida por lerTabelaCalibracao, compativel com o modo pedido; cenario do min-treino pedido (o ultimo)', () => {
    for (const correcao of [false, true]) {
      const t = tabelaDoBacktest(r, correcao);
      const lida = lerTabelaCalibracao(JSON.stringify(t));
      expect(lida.ok && lida.tabela).toEqual(t);
      expect(compatibilidadeTabela(t, correcao)).toBeNull();
      expect(compatibilidadeTabela(t, !correcao)).toBe('calibracao-incompativel');
      expect(t.correcaoNivel).toBe(correcao);
      expect(t.parametros).toEqual({ horizonte: 6, minTreino: 6, historicoMaximo: null, usarMascara: true, janelaNivelMeses: 12 });
      expect(t.ultimoMes).toBe('2026-12');
    }
    expect(tabelaDoBacktest(r, false)).toBe(r.cenarios[1].tabelas.referencia);
    expect(r.cenarios[1].tabelas.referencia.mensal.length).toBeGreaterThan(0);
  });
  it('nao carrega id, nome nem quantidade em KG', () => {
    const texto = JSON.stringify(tabelaDoBacktest(r, false));
    expect(texto).not.toMatch(/D0\d{3}|F\d{2}|FAM/);
  });
});

describe('cenario sem pares e fixture 10-2', () => {
  const q = JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8')) as Quinzena;
  const series = normalizarSeries(serieDaQuinzena(q)).series;
  it('min-treino 12 com 6 meses: sem pares, sem excecao, tabelas vazias validas', () => {
    const c = rodarBacktestRef(series, { ...OPC, minTreino: 12 }).cenarios[0];
    expect(c.linhas).toEqual([]);
    expect(c.amostra).toEqual({ pares: 0, fallbackReferencia: 0, residuosExcluidosMascara: 0 });
    expect(c.criterio7.referencia).toEqual({ cobertura: null, n: 0, passa: false });
    expect(c.correcao).toMatchObject({ fatorMedio: null, fatorMin: null, fatorMax: null });
    expect(lerTabelaCalibracao(JSON.stringify(c.tabelas.referencia)).ok).toBe(true);
    expect(c.contagem.historicoCurto).toBe(series.length);
  });
  it('min-treino 3 gera pares e linhas', () => {
    const c = rodarBacktestRef(series, { ...OPC, minTreino: 3, horizonte: 3 }).cenarios[1];
    expect(c.amostra.pares).toBeGreaterThan(0);
    expect(total(c, 'referencia').n).toBe(c.amostra.pares);
  });
});
