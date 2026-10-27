import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rodarBacktest } from '../src/utils/forecastPreditivoBacktest';
import { hashConfigP1 } from '../src/utils/forecastPreditivoConfigP1';
import { rodarBacktestP1, rodarCenarioP1, validarOpcoesBacktestP1 } from '../src/utils/forecastPreditivoBacktestP1';
import type { OpcoesBacktestP1 } from '../src/utils/forecastPreditivoBacktestP1';
import { passaCriterio3 } from '../src/utils/forecastPreditivoLinhasP1';
import { normalizarSeries, serieDaQuinzena } from '../src/utils/forecastPreditivoSerie';
import { METODO_IDS, METODO_TODOS_IDS, PREDITIVO_CONFIG } from '../src/utils/forecastPreditivoTipos';
import type { SerieEntrada, SerieNormalizada } from '../src/utils/forecastPreditivoTipos';
import type { Quinzena } from '../src/utils/forecastTypes';
import { seriesSinteticas } from './helpers/forecastPreditivoSinteticas';
import { seriesP1 } from './helpers/forecastPreditivoSinteticasP1';

const OPCOES: OpcoesBacktestP1 = {
  horizonte: 6,
  minTreino: 6,
  metodos: [...METODO_TODOS_IDS],
  leadTimePadraoDias: 90,
  razaoFaltaExcesso: 3,
  usarMascara: true,
  tetoVies: 0.1,
};
const normal = (entrada: SerieEntrada[]): SerieNormalizada[] => normalizarSeries(entrada).series;
const sint = (...ids: string[]) => seriesSinteticas().filter((s) => ids.length === 0 || ids.includes(s.id));
const todas = () => normal([...sint(), ...seriesP1()]);
// subconjunto (rodadas repetidas em loops de teste ficam abaixo de 1 s)
const pequena = () => normal([...sint('TEND', 'SAZ', 'RUIDO', 'LUMPY'), ...seriesP1().filter((s) => ['P-LT61', 'P-DEGRAU', 'P-DORM', 'P-LT45'].includes(s.id))]);
const rodar = (series: SerieNormalizada[], o: Partial<OpcoesBacktestP1> = {}) => rodarBacktestP1(series, { ...OPCOES, ...o });
const constante = (id: string, leadTimeDias?: number): SerieEntrada => ({
  id,
  fonte: 'FX',
  leadTimeDias: leadTimeDias ?? null,
  pontos: Array.from({ length: 36 }, (_, t) => ({ anoMes: sint('CONST')[0].pontos[t].anoMes, qtd: 100 })),
});

describe('validarOpcoesBacktestP1', () => {
  it('opcoes validas nao dao erro; tetoVies null e limites 0 e 1 sao validos', () => {
    expect(validarOpcoesBacktestP1(OPCOES)).toEqual([]);
    expect(validarOpcoesBacktestP1({ ...OPCOES, tetoVies: null })).toEqual([]);
    expect(validarOpcoesBacktestP1({ ...OPCOES, tetoVies: 0 })).toEqual([]);
    expect(validarOpcoesBacktestP1({ ...OPCOES, tetoVies: 1 })).toEqual([]);
  });
  it('cada campo invalido gera um erro', () => {
    for (const tetoVies of [1.01, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) expect(validarOpcoesBacktestP1({ ...OPCOES, tetoVies })).toHaveLength(1);
    expect(validarOpcoesBacktestP1({ ...OPCOES, metodos: [] })).toHaveLength(1);
    expect(validarOpcoesBacktestP1({ ...OPCOES, metodos: ['tsb' as never] })).toHaveLength(1);
    expect(validarOpcoesBacktestP1({ ...OPCOES, horizonte: 13 })).toHaveLength(1);
    expect(validarOpcoesBacktestP1({ ...OPCOES, minTreino: 0 })).toHaveLength(1);
    expect(validarOpcoesBacktestP1({ ...OPCOES, razaoFaltaExcesso: 0 })).toHaveLength(1);
    expect(validarOpcoesBacktestP1({ ...OPCOES, leadTimePadraoDias: -1 })).toHaveLength(1);
  });
  it('rodarBacktestP1 lanca com opcoes invalidas', () => {
    expect(() => rodar(todas(), { tetoVies: 1.01 })).toThrow(/^opcoes invalidas: /);
    expect(() => rodar(todas(), { metodos: ['tsb' as never] })).toThrow(/^opcoes invalidas: /);
    expect(() => rodar(todas(), { metodos: [] })).toThrow(/^opcoes invalidas: /);
    expect(() => rodar(todas(), { tetoVies: Number.NaN })).toThrow(/^opcoes invalidas: /);
  });
});

describe('estrutura do resultado', () => {
  const series = todas();
  const r = rodar(series);
  it('cabecalho, hashes e cenarios [12, 6] (principal primeiro)', () => {
    expect(r.versao).toBe('p1.0.0');
    expect(r.hashConfig).toBe(hashConfigP1());
    expect(r.hashConfig).toMatch(/^[0-9a-f]{64}$/);
    expect(r.hashConfig).not.toBe(rodarBacktest(series, { ...OPCOES, metodos: [...METODO_IDS] }).hashConfig);
    expect(r.hashEntrada).toBe(rodarBacktest(series, { ...OPCOES, metodos: [...METODO_IDS] }).hashEntrada);
    expect(r.cenariosMinTreino).toEqual([12, 6]);
    expect(r.cenarios.map((c) => [c.minTreino, c.principal])).toEqual([[12, true], [6, false]]);
    expect(r.opcoes.tetoVies).toBe(0.1);
  });
  it('min-treino 12 pedido -> um unico cenario principal', () => {
    const u = rodar(series, { minTreino: 12 });
    expect(u.cenariosMinTreino).toEqual([12]);
    expect(u.cenarios).toHaveLength(1);
    expect(u.cenarios[0].principal).toBe(true);
    expect(JSON.stringify(u.cenarios[0])).toBe(JSON.stringify(r.cenarios[0]));
  });
  it('linhas: TOTAL primeiro; metodos na ordem de METODO_TODOS_IDS; todos os eixos', () => {
    const c = r.cenarios[1];
    expect(c.linhas.slice(0, METODO_TODOS_IDS.length).map((l) => [l.segmento, l.metodo])).toEqual(METODO_TODOS_IDS.map((m) => ['TOTAL', m]));
    const segs = [...new Set(c.linhas.map((l) => l.segmento))];
    expect(c.linhas.length).toBe(segs.length * METODO_TODOS_IDS.length);
    for (const eixo of ['ABC:', 'SBC:', 'XYZ:', 'ABC/SBC:', 'LT:', 'FONTE:', 'REGRA:']) expect(segs.some((s) => s.startsWith(eixo))).toBe(true);
    const ordemEixos = ['TOTAL', 'ABC:', 'SBC:', 'XYZ:', 'ABC/SBC:', 'LT:', 'FONTE:', 'REGRA:'];
    const posicoes = segs.map((s) => ordemEixos.findIndex((e) => s === e || s.startsWith(e)));
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
  });
  it('fonte so como posto: fonte-NN, outras ou sem-fonte; porSerie e array ordenado por id', () => {
    const fontes = [...new Set(r.cenarios[1].linhas.map((l) => l.segmento).filter((s) => s.startsWith('FONTE:')))];
    for (const f of fontes) expect(f).toMatch(/^FONTE:(fonte-(0[1-9]|10)|outras|sem-fonte)$/);
    expect(fontes).toContain('FONTE:outras');
    expect(fontes).toContain('FONTE:sem-fonte');
    const ids = r.cenarios[1].porSerie.map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
    expect(Array.isArray(JSON.parse(JSON.stringify(r)).cenarios[1].porSerie)).toBe(true);
  });
  it('planilha-q e referencia; maximo e candidato (nunca "sim"); criterios 1-8', () => {
    for (const c of r.cenarios) {
      for (const l of c.linhas) {
        if (l.metodo === 'planilha-q') expect(l).toMatchObject({ promovivel: 'referencia', criteriosFalhos: [], vitoria: null });
        else expect(['nao', 'candidato']).toContain(l.promovivel);
        for (const lista of [l.criteriosFalhos, l.criteriosFalhosSemTeto]) expect(lista.every((x) => x >= 1 && x <= 8 && x !== 6)).toBe(true);
      }
    }
  });
  it('contagens: series, segmentos no ultimo mes com todas as chaves (zeros inclusive)', () => {
    const c = r.cenarios[1];
    expect(c.contagem.series).toBe(series.length);
    expect(c.contagem.comPrevisao + c.contagem.historicoCurto).toBe(series.length);
    expect(Object.keys(c.contagemSegmentos.abc)).toEqual(['A', 'B', 'C', 'sem-venda']);
    expect(Object.keys(c.contagemSegmentos.sbc)).toEqual(['smooth', 'erratic', 'intermittent', 'lumpy', 'insuficiente']);
    expect(Object.keys(c.contagemSegmentos.xyz)).toEqual(['X', 'Y', 'Z', 'n/a']);
    expect(Object.keys(c.contagemSegmentos.lt)).toEqual(['<=60', '61-90', '>90', 'padrao']);
    expect(Object.keys(c.contagemSegmentos.regra)).toEqual(['padrao', 'dormente', 'curto', 'degrau']);
    expect(Object.keys(c.contagemSegmentos.fonte)).toEqual([...Array.from({ length: 10 }, (_, i) => 'fonte-' + String(i + 1).padStart(2, '0')), 'outras', 'sem-fonte']);
    for (const eixo of Object.values(c.contagemSegmentos)) expect(Object.values(eixo).reduce((a, b) => a + b, 0)).toBe(series.length);
    expect(r.fontes.filter((f) => f.rotulo === 'outras').length).toBeGreaterThan(0);
  });
});

describe('amostra comum e fallback', () => {
  const series = todas();
  const r = rodar(series);
  it('n igual para todos os metodos em cada segmento e cenario', () => {
    for (const c of r.cenarios) {
      const porSeg = new Map<string, Set<number>>();
      for (const l of c.linhas) porSeg.set(l.segmento, (porSeg.get(l.segmento) ?? new Set<number>()).add(l.n));
      for (const [, ns] of porSeg) expect(ns.size).toBe(1);
      expect(c.linhas.find((l) => l.segmento === 'TOTAL' && l.metodo === 'ses')!.n).toBe(c.amostra.pares);
    }
  });
  it('serie com 1 venda: croston/sba caem em fallback sem mudar n', () => {
    const uma: SerieEntrada = { ...constante('UMA'), pontos: constante('UMA').pontos.map((p, t) => ({ ...p, qtd: t === 2 ? 50 : 0 })) };
    const base = normal([constante('BASE'), uma]);
    const c = rodar(base).cenarios[1];
    const total = (m: string) => c.linhas.find((l) => l.segmento === 'TOTAL' && l.metodo === m)!;
    expect(total('croston').n).toBe(total('planilha-q').n);
    expect(total('sba').n).toBe(total('planilha-q').n);
    expect(total('croston').nFallback).toBeGreaterThan(0);
    expect(total('sba').nFallback).toBeGreaterThan(0);
    expect(total('planilha-q').nFallback).toBe(0);
    expect(total('ses').nFallback).toBe(0);
    expect(c.amostra.fallbackPorMetodo.croston).toBe(total('croston').nFallback);
    expect(c.amostra.fallbackPorMetodo['planilha-q']).toBe(0);
    expect(Object.keys(c.amostra.fallbackPorMetodo)).toEqual([...METODO_TODOS_IDS]);
  });
  it('metodo sem previsao usa a Q no par: linha igual a da Q quando todo par cai em fallback', () => {
    const uma: SerieEntrada = { ...constante('UMA'), pontos: constante('UMA').pontos.map((p, t) => ({ ...p, qtd: t === 2 ? 50 : 0 })) };
    const c = rodar(normal([uma])).cenarios[1];
    const q = c.linhas.find((l) => l.segmento === 'TOTAL' && l.metodo === 'planilha-q')!;
    const cr = c.linhas.find((l) => l.segmento === 'TOTAL' && l.metodo === 'croston')!;
    expect(cr.n).toBeGreaterThan(0);
    expect(cr.nFallback).toBe(cr.n);
    expect(cr.wapeLT).toBe(q.wapeLT);
    expect(cr.viesLT).toBe(q.viesLT);
    expect(cr.custoLT).toBe(q.custoLT);
  });
});

describe('cenarios e opcoes chegam as funcoes', () => {
  it('min-treino: CONST 36 meses, LT 90 (hl 4) -> 21 origens com observacao em 12 e 27 em 6', () => {
    const r = rodar(normal([constante('C1', 90)]));
    expect(r.cenarios[0].origensComObservacao).toBe(21);
    expect(r.cenarios[1].origensComObservacao).toBe(27);
    expect(r.cenarios[0].origens).toBe(24);
    expect(r.cenarios[1].origens).toBe(30);
    expect(rodar(normal([constante('C1', 90)]), { minTreino: 20 }).cenarios.map((c) => c.origensComObservacao)).toEqual([21, 13]);
  });
  it('rodarCenarioP1 usa o minTreino da opcao e marca principal', () => {
    const c = rodarCenarioP1(normal([constante('C1', 90)]), { ...OPCOES, minTreino: 10 }, false);
    expect([c.minTreino, c.principal, c.origensComObservacao]).toEqual([10, false, 23]);
  });
  it('horizonte e lead time padrao: serie sem LT, padrao 150 -> hl 6 (19 origens); padrao 90 -> hl 4 (21)', () => {
    const s = normal([constante('C1')]);
    expect(rodar(s, { leadTimePadraoDias: 90 }).cenarios[0].origensComObservacao).toBe(21);
    expect(rodar(s, { leadTimePadraoDias: 150 }).cenarios[0].origensComObservacao).toBe(19);
    expect(rodar(s, { leadTimePadraoDias: 150, horizonte: 3 }).cenarios[0].origensComObservacao).toBe(22);
  });
  it('razao falta/excesso: custo = razao x falta + excesso, em toda linha', () => {
    for (const razaoFaltaExcesso of [1, 2, 5]) {
      const r = rodar(pequena(), { razaoFaltaExcesso });
      for (const l of r.cenarios[1].linhas) expect(l.custoLT).toBeCloseTo(razaoFaltaExcesso * l.faltaLT + l.excessoLT, 6);
    }
    const a = rodar(pequena(), { razaoFaltaExcesso: 1 }).cenarios[1].linhas.find((l) => l.segmento === 'TOTAL' && l.metodo === 'ses')!;
    const b = rodar(pequena(), { razaoFaltaExcesso: 5 }).cenarios[1].linhas.find((l) => l.segmento === 'TOTAL' && l.metodo === 'ses')!;
    expect(b.custoLT).toBeGreaterThan(a.custoLT);
  });
  it('usarMascara: sem mascara a amostra cresce (ATIP tem mes mascarado) e a entrada nao e alterada', () => {
    const series = normal(sint('ATIP', 'CONST'));
    const copia = JSON.parse(JSON.stringify(series));
    const com = rodar(series).cenarios[1].amostra.pares;
    const sem = rodar(series, { usarMascara: false }).cenarios[1].amostra.pares;
    expect(sem).toBeGreaterThan(com);
    expect(series).toEqual(copia);
  });
  it('metodos: so as linhas pedidas, e a referencia continua calculada', () => {
    const c = rodar(todas(), { metodos: ['ses'] }).cenarios[1];
    expect([...new Set(c.linhas.map((l) => l.metodo))]).toEqual(['ses']);
    const total = c.linhas.find((l) => l.segmento === 'TOTAL')!;
    expect(total.wapeRef).not.toBeNull();
    expect(total.metodo).toBe('ses');
    expect(Object.keys(c.amostra.fallbackPorMetodo)).toEqual(['ses']);
    expect(rodar(todas(), { metodos: ['preditivo-p1', 'ses'] }).opcoes.metodos).toEqual(['ses', 'preditivo-p1']);
  });
  it('tetoVies chega ao criterio 3 de toda linha, nas duas variantes', () => {
    for (const tetoVies of [0, 0.1, 0.3, 1, null]) {
      const r = rodar(pequena(), { tetoVies });
      for (const c of r.cenarios) {
        for (const l of c.linhas) {
          if (l.metodo === 'planilha-q') continue;
          expect(l.criteriosFalhos.includes(3)).toBe(!passaCriterio3(l.viesLT, l.viesRef, tetoVies));
          expect(l.criteriosFalhosSemTeto.includes(3)).toBe(!passaCriterio3(l.viesLT, l.viesRef, null));
          for (const m of [l.metade1, l.metade2]) {
            expect(m.criteriosFalhos.includes(3)).toBe(!passaCriterio3(m.viesLT, m.viesRef, tetoVies));
            expect(m.criteriosFalhosSemTeto.includes(3)).toBe(!passaCriterio3(m.viesLT, m.viesRef, null));
          }
        }
      }
    }
    const l0 = rodar(pequena(), { tetoVies: 0 }).cenarios[1].linhas.filter((l) => l.metodo !== 'planilha-q');
    expect(l0.some((l) => l.criteriosFalhos.includes(3) && !l.criteriosFalhosSemTeto.includes(3))).toBe(true);
    const lNull = rodar(pequena(), { tetoVies: null }).cenarios[1].linhas;
    expect(lNull.every((l) => JSON.stringify(l.criteriosFalhos) === JSON.stringify(l.criteriosFalhosSemTeto))).toBe(true);
  });
});

describe('metades temporais', () => {
  it('CONST LT 30 (hl 2), min-treino 6: 29 origens -> 14 / 15, ate 2025-07', () => {
    const c = rodar(normal([constante('C1', 30)])).cenarios[1];
    expect(c.origensComObservacao).toBe(29);
    expect(c.metades).toEqual({ meses1: 14, meses2: 15, ultimoMes1: '2025-07' });
    const total = c.linhas.find((l) => l.segmento === 'TOTAL' && l.metodo === 'ses')!;
    expect(total.metade1.origens).toBe(14);
    expect(total.metade2.origens).toBe(15);
    expect(total.metade1.n + total.metade2.n).toBe(total.n);
  });
  it('30 -> 15/15; 31 -> 15/16 (par e impar); poucas origens -> 0/k', () => {
    const m30 = rodarCenarioP1(normal([constante('C1', 30)]), { ...OPCOES, minTreino: 5 }, false);
    expect(m30.origensComObservacao).toBe(30);
    expect(m30.metades).toMatchObject({ meses1: 15, meses2: 15 });
    const m31 = rodarCenarioP1(normal([constante('C1', 30)]), { ...OPCOES, minTreino: 4 }, false);
    expect(m31.origensComObservacao).toBe(31);
    expect(m31.metades).toMatchObject({ meses1: 15, meses2: 16 });
    const m1 = rodarCenarioP1(normal([constante('C1', 30)]), { ...OPCOES, minTreino: 34 }, false);
    expect(m1.origensComObservacao).toBe(1);
    expect(m1.metades).toEqual({ meses1: 0, meses2: 1, ultimoMes1: null });
    const m0 = rodarCenarioP1(normal([constante('C1', 30)]), { ...OPCOES, minTreino: 35 }, false);
    expect(m0.origensComObservacao).toBe(0);
    expect(m0.metades).toEqual({ meses1: 0, meses2: 0, ultimoMes1: null });
  });
});

describe('regras de protecao e avisos no backtest', () => {
  const r = rodar(todas());
  it('REGRA:dormente aparece para a serie dormente; ABC sem-venda == regra dormente por serie (ultimo mes)', () => {
    expect(r.cenarios[1].linhas.some((l) => l.segmento === 'REGRA:dormente')).toBe(true);
    for (const s of r.cenarios[1].porSerie) {
      if (s.meses === 0) continue;
      expect(s.regra === 'dormente').toBe(s.abc === 'sem-venda');
    }
    expect(r.cenarios[1].porSerie.find((s) => s.id === 'P-DORM')!.regra).toBe('dormente');
    expect(r.cenarios[1].porSerie.find((s) => s.id === 'P-DEGRAU')!.regra).toBe('degrau');
    expect(r.cenarios[1].porSerie.find((s) => s.id === 'P-CURTA')!.regra).toBe('curto');
  });
  it('lead-time-truncado conta as series de LT 151 com horizonte 6 (e nenhuma com horizonte 12)', () => {
    expect(r.cenarios[1].avisosP1['lead-time-truncado']).toBe(1);
    expect(r.cenarios[1].porSerie.find((s) => s.id === 'P-LT151')!.avisosP1).toEqual(['lead-time-truncado']);
    expect(r.cenarios[1].porSerie.find((s) => s.id === 'P-LT150')!.avisosP1).toEqual([]);
    expect(rodar(todas(), { horizonte: 12 }).cenarios[1].avisosP1['lead-time-truncado']).toBe(0);
  });
  it('avisos da fase 0 contados por serie', () => {
    const a = r.cenarios[1].avisos;
    expect(a['degrau-nivel']).toBeGreaterThanOrEqual(2);
    expect(a['sem-venda']).toBe(1);
    expect(a['historico-curto']).toBeGreaterThanOrEqual(1);
  });
  it('porSerie: segmentos, classe de LT e fonte por serie', () => {
    const p = r.cenarios[1].porSerie.find((s) => s.id === 'P-LT61')!;
    expect(p).toMatchObject({ classeLt: '61-90', meses: 36 });
    expect(r.cenarios[1].porSerie.find((s) => s.id === 'P-LTNULO')!.classeLt).toBe('padrao');
    expect(r.cenarios[1].porSerie.find((s) => s.id === 'P-SEMFONTE')!.rotuloFonte).toBe('sem-fonte');
  });
});

describe('intervalos no backtest', () => {
  it('ha pares com intervalo e cobertura em [0, 1]; o piso 0 vale; pinball >= 0', () => {
    const l = rodar(todas()).cenarios[1].linhas.find((x) => x.segmento === 'TOTAL' && x.metodo === 'planilha-q')!;
    expect(l.nIntervalo).toBeGreaterThan(0);
    expect(l.cobertura!).toBeGreaterThanOrEqual(0);
    expect(l.cobertura!).toBeLessThanOrEqual(1);
    expect(l.pinball10!).toBeGreaterThanOrEqual(0);
    expect(l.pinball90!).toBeGreaterThanOrEqual(0);
    expect(l.nPoolTotal).toBeLessThanOrEqual(l.nIntervalo);
  });
});

describe('igualdade com a fase 0 (metodos antigos, todos ok em todos os pares)', () => {
  it('linhas TOTAL iguais (toBe) com CONST, TEND, SAZ, RUIDO e min-treino 13', () => {
    const series = normal(sint('CONST', 'TEND', 'SAZ', 'RUIDO'));
    const p0 = rodarBacktest(series, { horizonte: 6, minTreino: 13, metodos: [...METODO_IDS], leadTimePadraoDias: 90, razaoFaltaExcesso: 3, usarMascara: true });
    const p1 = rodar(series, { minTreino: 13 }).cenarios[1];
    expect(p1.minTreino).toBe(13);
    for (const id of METODO_IDS) {
      const a = p0.linhas.find((l) => l.segmento === 'TOTAL' && l.metodo === id)!;
      const b = p1.linhas.find((l) => l.segmento === 'TOTAL' && l.metodo === id)!;
      expect(b.nFallback).toBe(0);
      expect(b.n).toBe(a.n);
      for (const campo of ['wapeH1', 'wapeH3', 'wapeLT', 'viesLT', 'maeLT', 'custoLT', 'custoRel', 'vitoria'] as const) expect(b[campo]).toBe(a[campo]);
    }
    expect(p1.linhas.find((l) => l.segmento === 'TOTAL' && l.metodo === 'ses')!.n).toBeGreaterThan(30);
  });
});

describe('determinismo, ordem e cenario vazio', () => {
  it('duas rodadas e entrada invertida dao o mesmo JSON; entrada nao mutada', () => {
    const series = todas();
    const copia = JSON.parse(JSON.stringify(series));
    const a = JSON.stringify(rodar(series));
    expect(JSON.stringify(rodar(series))).toBe(a);
    expect(JSON.stringify(rodar([...series].reverse()))).toBe(a);
    expect(series).toEqual(copia);
  });
  it('fixture 10-2 com min-treino 12: cenario sem pares, sem excecao', () => {
    const q = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/forecast/quinzena-10-2.anon.json'), 'utf8')) as Quinzena;
    const series = normal(serieDaQuinzena(q));
    const r = rodar(series, { minTreino: 3 });
    expect(r.cenarios[0].linhas).toEqual([]);
    expect(r.cenarios[0].amostra.pares).toBe(0);
    expect(r.cenarios[0].metades).toEqual({ meses1: 0, meses2: 0, ultimoMes1: null });
    expect(r.cenarios[0].contagem.comPrevisao).toBe(0);
    expect(r.cenarios[0].contagem.historicoCurto).toBe(series.length);
    expect(r.cenarios[1].linhas.length).toBeGreaterThan(0);
  });
  it('sem nenhuma serie: cenarios vazios', () => {
    const r = rodar([]);
    expect(r.cenarios).toHaveLength(2);
    expect(r.cenarios[0].linhas).toEqual([]);
    expect(r.cenarios[0].porSerie).toEqual([]);
  });
});

describe('PREDITIVO_CONFIG da fase 0 intacto', () => {
  it('minimos e promocao continuam os mesmos', () => {
    expect(PREDITIVO_CONFIG.promocao.viesMax).toBe(0.1);
    expect(PREDITIVO_CONFIG.minimoValidos.ses).toBe(4);
  });
});
