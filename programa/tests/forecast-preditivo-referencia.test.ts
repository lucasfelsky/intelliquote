import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcular } from '../src/utils/forecastEngine';
import { mesesDaJanelaDeVendas } from '../src/utils/forecastMesesAtipicos';
import type { Quinzena } from '../src/utils/forecastTypes';
import { hashConfigRef } from '../src/utils/forecastPreditivoConfigRef';
import { METODOS } from '../src/utils/forecastPreditivoMetodos';
import { combinacaoSesRHolt } from '../src/utils/forecastPreditivoMetodosP1';
import { previsaoBaseRef, preverReferencia } from '../src/utils/forecastPreditivoReferencia';
import type { PrevisaoSerieRef } from '../src/utils/forecastPreditivoReferencia';
import { normalizarSeries, serieDaQuinzena, somarMeses } from '../src/utils/forecastPreditivoSerie';
import { hashCanonico } from '../src/utils/forecastPreditivoTipos';
import type { AnoMes, SerieEntrada } from '../src/utils/forecastPreditivoTipos';
import { seriesSinteticas } from './helpers/forecastPreditivoSinteticas';
import { seriesP1 } from './helpers/forecastPreditivoSinteticasP1';
import { marcasRef, seriesRef, tabelaSintetica } from './helpers/forecastPreditivoSinteticasRef';

const FIM = '2026-12';
const ent = (id: string, qtds: number[], dias?: number | null, extra: Partial<SerieEntrada> = {}): SerieEntrada => ({
  id,
  ...(dias === undefined ? {} : { leadTimeDias: dias }),
  ...extra,
  pontos: qtds.map((q, k) => ({ anoMes: somarMeses(FIM, k - (qtds.length - 1)), qtd: q })),
});
const constante = (n: number, v = 100) => new Array<number>(n).fill(v);
const uma = (e: SerieEntrada, o: Parameters<typeof preverReferencia>[2] = {}, m = new Map<string, AnoMes[]>()): PrevisaoSerieRef => preverReferencia([e], m, o).series[0];
const p50s = (r: PrevisaoSerieRef) => r.pontos.map((p) => p.p50);

describe('regra da referencia (minimo 4 validos)', () => {
  it('3 validos -> planilha Q (media dos 3) + historico-curto-planilha, sem intervalo', () => {
    const r = uma(ent('A', [10, 20, 30], 90), { calibracao: tabelaSintetica() });
    expect(r).toMatchObject({ ok: true, regra: 'curto', metodoUsado: 'planilha-q', componentes: 1 });
    expect(p50s(r)).toEqual([20, 20, 20, 20, 20, 20]);
    expect(r.avisosRef).toEqual(['historico-curto-planilha', 'sem-intervalo']);
    expect(r.pontos.every((p) => p.p10 === null && p.p90 === null)).toBe(true);
    expect(r.leadTime.p10).toBeNull();
  });
  it.each([[4, 2], [5, 2], [7, 2], [8, 3], [9, 3]])('%i meses validos constantes -> combinacao com %i componentes, p50 = 100', (n, comp) => {
    const r = uma(ent('A', constante(n), 90));
    expect(r).toMatchObject({ regra: 'padrao', metodoUsado: 'combinacao-ses-r-holt', componentes: comp });
    for (const v of p50s(r)) expect(v).toBeCloseTo(100, 9);
    expect(r.historico).toEqual({ meses: n, validos: n, mascarados: 0, minimoExigido: 4, minimoHolt: 8 });
  });
  it('dormente -> Q = 0 + dormente-planilha; degrau 36 meses -> Holt amortecido; degrau 5 meses -> Q + degrau-planilha', () => {
    const dorm = uma(ent('A', [...constante(6), ...constante(6, 0)], 90));
    expect(dorm).toMatchObject({ regra: 'dormente', metodoUsado: 'planilha-q' });
    expect(p50s(dorm)).toEqual(constante(6, 0));
    expect(dorm.avisosRef).toContain('dormente-planilha');
    const g = (n: number, mudou: number) => Array.from({ length: n }, (_, i) => (i < mudou ? 10 : 10000));
    const longo = uma(ent('A', g(36, 18), 90));
    expect(longo).toMatchObject({ regra: 'degrau', metodoUsado: 'holt-amortecido', componentes: 1 });
    expect(longo.avisosRef).toContain('degrau-holt');
    const curto = uma(ent('A', [10, 10, 10, 10000, 10000], 90));
    expect(curto).toMatchObject({ regra: 'degrau', metodoUsado: 'planilha-q' });
    expect(curto.avisosRef).toContain('degrau-planilha');
    expect(curto.avisosRef).not.toContain('degrau-holt');
  });
  it('todos os meses marcados -> ok false, sem metodo, sem pontos, aviso historico-curto-planilha', () => {
    const r = uma(ent('A', [30, 40, 50], 90), {}, new Map([['A', ['2026-10', '2026-11', '2026-12']]]));
    expect(r).toMatchObject({ ok: false, metodoUsado: null, componentes: 0, pontos: [] });
    expect(r.avisosRef).toContain('historico-curto-planilha');
    expect(r.leadTime.p50).toBe(0);
  });
  it('entradas vazias e serie sem pontos: sem excecao', () => {
    const v = preverReferencia([], new Map());
    expect(v.series).toEqual([]);
    expect(v.contagem).toMatchObject({ series: 0, comPrevisao: 0, comIntervalo: 0 });
    const s = uma({ id: 'A', pontos: [] });
    expect(s).toMatchObject({ ok: false, regra: 'sem-dados', metodoUsado: null, origem: null });
  });
  it('p50 da combinacao e da Q = o dos metodos da P1a/fase 0 (mesmo codigo)', () => {
    const { series } = normalizarSeries(seriesRef());
    for (const id of ['R-CRESC', 'R-CURTA4', 'R-CURTA7', 'R-CURTA8']) {
      const s = series.find((x) => x.id === id)!;
      const c = combinacaoSesRHolt(s, { horizonte: 6 });
      expect(c.ok && previsaoBaseRef(s, 6).p50s).toEqual(c.ok && c.pontos.map((p) => p.p50));
    }
    const q = METODOS['planilha-q'](series.find((x) => x.id === 'R-CURTA3')!, { horizonte: 6 });
    expect(previsaoBaseRef(series.find((x) => x.id === 'R-CURTA3')!, 6).p50s).toEqual(q.ok ? q.pontos.map((p) => p.p50) : null);
  });
});

describe('lead time', () => {
  it('0 dias -> 2 meses; 45 -> 3 (qHat = media dos 2 primeiros); 151 -> 6 e truncado; null -> padrao + aviso', () => {
    const d0 = uma(ent('A', constante(12), 0)).leadTime;
    expect(d0).toMatchObject({ dias: 0, padrao: false, meses: 2, truncado: false });
    const d45 = uma(ent('A', constante(12), 45)).leadTime;
    expect(d45).toMatchObject({ dias: 45, meses: 3, truncado: false });
    expect(d45.p50).toBeCloseTo(300, 9);
    expect(d45.qHat).toBeCloseTo(100, 9);
    const d151 = uma(ent('A', constante(12), 151));
    expect(d151.leadTime).toMatchObject({ meses: 6, truncado: true });
    expect(d151.avisosRef).toContain('lead-time-truncado');
    const nulo = uma(ent('A', constante(12), null), { leadTimePadraoDias: 30 });
    expect(nulo.leadTime).toMatchObject({ dias: 30, padrao: true, meses: 2 });
    expect(nulo.avisosRef).toContain('lead-time-padrao');
  });
  it('qHat = media de p50_1..p50_mq e p50 do LT = soma de p50_1..p50_meses (serie com tendencia)', () => {
    const r = uma(seriesRef().find((s) => s.id === 'R-CRESC')!);
    const p = p50s(r);
    expect(r.leadTime.meses).toBe(4); // 90 dias -> 3 + 1
    expect(r.leadTime.p50).toBeCloseTo(p[0] + p[1] + p[2] + p[3], 9);
    expect(r.leadTime.qHat).toBeCloseTo((p[0] + p[1] + p[2]) / 3, 9);
  });
});

describe('intervalos por tabela de calibracao', () => {
  const doze = () => ent('A', constante(12), 45);
  it('p10/p90 a mao (celula smooth n 30): mensal 50/150 e lead time 210/390', () => {
    const r = uma(doze(), { calibracao: tabelaSintetica() });
    expect(r.intervalo).toEqual({ celula: 'smooth', fonte: 'celula' });
    for (const p of r.pontos) {
      expect(p.p10).toBeCloseTo(50, 9);
      expect(p.p90).toBeCloseTo(150, 9);
    }
    expect(r.leadTime.p10).toBeCloseTo(210, 9);
    expect(r.leadTime.p90).toBeCloseTo(390, 9);
    expect(r.avisosRef).toEqual([]);
  });
  it('celula com n 29 cai no TOTAL (60/160 e 240/420); piso em 0', () => {
    const t = tabelaSintetica();
    const abaixo = (cs: typeof t.mensal) => cs.map((c) => (c.celula === 'smooth' ? { ...c, n: 29 } : c));
    const r = uma(doze(), { calibracao: { ...t, mensal: abaixo(t.mensal), leadTime: abaixo(t.leadTime) } });
    expect(r.intervalo.fonte).toBe('total');
    expect(r.pontos[0].p10).toBeCloseTo(60, 9);
    expect(r.pontos[0].p90).toBeCloseTo(160, 9);
    expect(r.leadTime.p10).toBeCloseTo(240, 9);
    expect(r.leadTime.p90).toBeCloseTo(420, 9);
    const fundo = uma(doze(), { calibracao: tabelaSintetica({ mensal: tabelaSintetica().mensal.map((c) => (c.celula === 'smooth' ? { ...c, q10: -2 } : c)) }) });
    expect(fundo.pontos[0].p10).toBe(0);
    expect(fundo.pontos[0].p90).toBeCloseTo(150, 9);
  });
  it('sem tabela -> sem-calibracao + sem-intervalo; tabela de outro hash ou de outro modo -> calibracao-incompativel e null', () => {
    const sem = uma(doze());
    expect(sem.avisosRef).toEqual(['sem-calibracao', 'sem-intervalo']);
    expect(sem.leadTime.p10).toBeNull();
    for (const calibracao of [tabelaSintetica({ hashConfig: 'x'.repeat(64) }), tabelaSintetica({ correcaoNivel: true })]) {
      const v = preverReferencia([doze()], new Map(), { calibracao });
      expect(v.calibracao).toBe('incompativel');
      expect(v.series[0].avisosRef).toEqual(['calibracao-incompativel', 'sem-intervalo']);
      expect(v.series[0].pontos[0].p10).toBeNull();
    }
    expect(preverReferencia([doze()], new Map(), { calibracao: tabelaSintetica() }).calibracao).toBe('aplicada');
    expect(preverReferencia([doze()], new Map()).calibracao).toBe('nenhuma');
  });
  it('escala 0 -> sem-intervalo (6 meses a zero validos + 6 mascarados com venda)', () => {
    const e = ent('A', [...constante(6, 0), ...constante(6)], 45);
    const marcas = new Map([['A', [7, 8, 9, 10, 11, 12].map((k) => somarMeses(FIM, k - 12))]]);
    const r = uma(e, { calibracao: tabelaSintetica() }, marcas);
    expect(r.metodoUsado).toBe('combinacao-ses-r-holt');
    expect(r.avisosRef).toContain('sem-intervalo');
    expect(r.avisosRef).not.toContain('sem-calibracao');
    expect(r.pontos.every((p) => p.p10 === null)).toBe(true);
  });
  it('horizonte 8 com tabela ate m = 6: h 1-6 com intervalo, h 7-8 sem; LT de 4 meses (90 dias) com intervalo', () => {
    const r = uma(ent('A', constante(12), 90), { horizonte: 8, calibracao: tabelaSintetica() });
    expect(r.pontos.map((p) => p.p10 !== null)).toEqual([true, true, true, true, true, true, false, false]);
    expect(r.avisosRef).toContain('sem-intervalo');
    expect(r.leadTime).toMatchObject({ meses: 4 });
    expect(r.leadTime.p10).not.toBeNull();
  });
  it('p10 <= p90 sempre; p50 pode ficar fora da faixa (nada e forcado)', () => {
    const t = tabelaSintetica({ mensal: tabelaSintetica().mensal.map((c) => ({ ...c, q10: 0.2, q90: 0.4 })) });
    const r = uma(doze(), { calibracao: t });
    expect(r.pontos[0].p10!).toBeGreaterThan(r.pontos[0].p50);
    expect(r.pontos[0].p10!).toBeLessThanOrEqual(r.pontos[0].p90!);
  });
});

describe('correcao de nivel (desligada por padrao)', () => {
  const doze = () => ent('A', constante(12), 45);
  it('padrao: fator 1, sem avisos de correcao', () => {
    const r = uma(doze(), { calibracao: tabelaSintetica() });
    expect(r.correcao).toEqual({ aplicada: false, fator: 1 });
    expect(r.avisosRef.some((a) => a.startsWith('correcao'))).toBe(false);
  });
  it('ligada com razao 1,2 e n 300 -> p50 x 1,1 (intervalo sobre o p50 corrigido); Q e Holt de degrau intactos', () => {
    const calibracao = tabelaSintetica({ correcaoNivel: true });
    const r = uma(doze(), { correcaoNivel: true, calibracao });
    expect(r.correcao.aplicada).toBe(true);
    expect(r.correcao.fator).toBeCloseTo(1.1, 12);
    expect(r.pontos[0].p50).toBeCloseTo(110, 9);
    expect(r.pontos[0].p10).toBeCloseTo(60, 9);
    expect(r.leadTime.p50).toBeCloseTo(330, 9);
    const curta = ent('B', [10, 20, 30], 45);
    const desl = uma(curta, { calibracao });
    expect(uma(curta, { correcaoNivel: true, calibracao })).toEqual(desl);
    const degrau = ent('C', Array.from({ length: 36 }, (_, i) => (i < 18 ? 10 : 10000)), 45);
    expect(uma(degrau, { correcaoNivel: true, calibracao }).pontos).toEqual(uma(degrau, { calibracao }).pontos);
  });
  it('n 29 -> correcao-sem-dados; sem tabela -> correcao-sem-dados; razao 1,6 -> 1,25 no limite; os parametros chegam', () => {
    const n29 = uma(doze(), { correcaoNivel: true, calibracao: tabelaSintetica({ correcaoNivel: true, nivel: { n: 29, razao: 1.2 } }) });
    expect(n29.correcao).toEqual({ aplicada: false, fator: 1 });
    expect(n29.avisosRef).toContain('correcao-sem-dados');
    expect(uma(doze(), { correcaoNivel: true }).avisosRef).toEqual(expect.arrayContaining(['correcao-sem-dados', 'sem-calibracao']));
    const alto = tabelaSintetica({ correcaoNivel: true, nivel: { n: 300, razao: 1.6 } });
    const lim = uma(doze(), { correcaoNivel: true, calibracao: alto });
    expect(lim.correcao.fator).toBe(1.25);
    expect(lim.avisosRef).toContain('correcao-no-limite');
    const largo = uma(doze(), { correcaoNivel: true, calibracao: alto, parametrosCorrecao: { k: 300, fatorMin: 0.85, fatorMax: 2, minPares: 30 } });
    expect(largo.correcao.fator).toBeCloseTo(1.3, 12);
    expect(largo.avisosRef).not.toContain('correcao-no-limite');
  });
});

describe('mascara por marcas', () => {
  const atip = () => seriesRef().find((s) => s.id === 'R-ATIP')!;
  it('com a marca o pico some (p50 = 100); sem a marca (prova de que as marcas chegam) o p50 e outro', () => {
    const com = uma(atip(), {}, marcasRef());
    for (const v of p50s(com)) expect(v).toBeCloseTo(100, 9);
    expect(com.historico).toMatchObject({ mascarados: 1, validos: 35 });
    expect(Math.abs(p50s(uma(atip()))[0] - 100)).toBeGreaterThan(5);
  });
  it('usarMascara false ignora as marcas; a flag atipico do ponto e ignorada', () => {
    const sem = p50s(uma(atip()));
    expect(p50s(uma(atip(), { usarMascara: false }, marcasRef()))).toEqual(sem);
    const flag = atip();
    flag.pontos = flag.pontos.map((p) => (p.qtd === 600 ? { ...p, atipico: true } : p));
    expect(p50s(uma(flag))).toEqual(sem);
  });
  it('ruptura da entrada e ignorada (R-RUPT = mesma previsao da serie sem as flags) e contada', () => {
    const r = seriesRef().find((s) => s.id === 'R-RUPT')!;
    const limpa = { ...r, pontos: r.pontos.map((p) => ({ anoMes: p.anoMes, qtd: p.qtd })) };
    const v = preverReferencia([r], new Map());
    expect(v.contagem.rupturaIgnorada).toBe(2);
    expect(v.series).toEqual(preverReferencia([limpa], new Map()).series);
  });
});

describe('opcoes invalidas lancam; fronteiras validas passam', () => {
  const e = [ent('A', constante(6), 90)];
  it.each([[{ horizonte: 0 }], [{ horizonte: 13 }], [{ horizonte: 2.5 }], [{ leadTimePadraoDias: -1 }], [{ leadTimePadraoDias: 3651 }], [{ parametrosCorrecao: { k: 0, fatorMin: 0.85, fatorMax: 1.25, minPares: 30 } }]])('%j', (o) => {
    expect(() => preverReferencia(e, new Map(), o)).toThrow(/opcoes invalidas/);
  });
  it.each([[{ horizonte: 1 }], [{ horizonte: 12 }], [{ leadTimePadraoDias: 0 }], [{ leadTimePadraoDias: 3650 }]])('%j valido', (o) => {
    expect(() => preverReferencia(e, new Map(), o)).not.toThrow();
  });
  it('horizonte chega: 3 -> 3 pontos', () => {
    expect(preverReferencia(e, new Map(), { horizonte: 3 }).series[0].pontos.length).toBe(3);
  });
});

describe('determinismo e propriedades', () => {
  it('2 chamadas iguais; ordem invertida das entradas e das marcas; JSON igual; entrada nao mutada', () => {
    const entradas = seriesRef();
    const copia = JSON.stringify(entradas);
    const o = { calibracao: tabelaSintetica() };
    const a = preverReferencia(entradas, marcasRef(), o);
    expect(preverReferencia(entradas, marcasRef(), o)).toEqual(a);
    expect(preverReferencia([...entradas].reverse(), new Map([...marcasRef()].reverse()), o)).toEqual(a);
    expect(JSON.stringify(a)).toBe(JSON.stringify(preverReferencia(entradas, marcasRef(), o)));
    expect(JSON.stringify(entradas)).toBe(copia);
    expect(a.hashCalibracao).toBe(hashCanonico(tabelaSintetica()));
  });
  it.each([['sinteticas', seriesSinteticas], ['p1', seriesP1], ['ref', seriesRef]])('propriedades em %s', (_n, f) => {
    const v = preverReferencia(f(), new Map(), { calibracao: tabelaSintetica() });
    expect(v.versao).toBe('p1.1.0');
    expect(v.hashConfig).toBe(hashConfigRef());
    expect(v.contagem.series).toBe(f().length);
    for (const s of v.series) {
      for (const p of s.pontos) {
        expect(Number.isFinite(p.p50) && p.p50 >= 0).toBe(true);
        if (p.p10 !== null) expect(p.p10).toBeLessThanOrEqual(p.p90!);
        expect((p.p10 === null) === (p.p90 === null)).toBe(true);
      }
      if (s.metodoUsado !== 'combinacao-ses-r-holt') expect(s.leadTime.p10).toBeNull();
    }
  });
});

describe('paridade da mascara com o motor (fixture 10-2)', () => {
  const q = JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8')) as Quinzena;
  const janela = mesesDaJanelaDeVendas(q.dataBase);
  it.each([[[1, 3, 5]], [[3, 4, 5]], [[0, 1, 2]]])('3 dos 6 meses marcados %j: p50 = Q do motor (tolerancia 1e-6)', (indices) => {
    const linhas = q.produtos.slice(0, 60);
    const entradas = serieDaQuinzena({ ...q, produtos: linhas });
    const marcas = new Map(entradas.map((e) => [e.id, indices.map((i) => janela[i])]));
    const v = preverReferencia(entradas, marcas, { horizonte: 3 });
    const fora = new Map(linhas.map((p) => [p.linha, new Set(indices)]));
    const motor = calcular({ ...q, produtos: linhas }, { hoje: '2026-10-20', somarChegada5oMes: false, mesesForaDaMedia: fora });
    expect(v.series.length).toBe(linhas.length);
    let curtas = 0;
    for (const l of motor) {
      const s = v.series.find((x) => x.id === 'linha-' + l.linha)!;
      if (s.regra === 'curto') curtas++;
      for (const p of s.pontos) expect(Math.abs(p.p50 - l.Q)).toBeLessThan(1e-6);
    }
    expect(curtas).toBeGreaterThan(10);
  });
});
