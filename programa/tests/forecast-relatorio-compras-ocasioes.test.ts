import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calcular } from '../src/utils/forecastEngine';
import type { OcasiaoLeadTime } from '../src/utils/forecastOcasioes';
import {
  montarRelatorioCompras,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
  type RelatorioCompras,
} from '../src/utils/forecastRelatorioCompras';
import {
  anexarOcasioesAoRelatorio,
  chaveDaFonte,
  ocasioesDaPoHoje,
  ocasioesDoItem,
  type ContextoOcasioes,
  type FonteDoCadastro,
} from '../src/utils/forecastRelatorioComprasOcasioes';
import { normalizeSourceName } from '../src/utils/forecastWorkbook';
import type { Quinzena } from '../src/utils/forecastTypes';

// Fixture ANONIMIZADA (repo publico) + dados 100% sinteticos (FONTE 001, OCASIAO 001, PRODUTO 001, paises XA..XZ).
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const BASE = '2026-10-15';
const HOJE = '2026-10-20';

const ocasiao = (over: Partial<OcasiaoLeadTime> & Pick<OcasiaoLeadTime, 'id'>): OcasiaoLeadTime => ({
  escopo: 'global',
  countryCode: null,
  sourceId: null,
  inicio: '2026-11-01',
  fim: '2026-11-05',
  recorrencia: 'nenhuma',
  etapa: 'total',
  efeito: 'dias',
  valor: 5,
  ativa: true,
  ...over,
});

// Etapas que somam 30 (= AQ padrao dos testes sinteticos).
const fonteCad = (over: Partial<FonteDoCadastro> = {}): FonteDoCadastro => ({
  id: 1,
  countryCode: 'XA',
  ativa: true,
  readinessDays: 10,
  shippingDays: 5,
  transitDays: 10,
  clearanceDays: 5,
  ...over,
});

const contexto = (
  fontes: Record<string, FonteDoCadastro>,
  ocasioes: OcasiaoLeadTime[],
  nomes: Record<number, string> = {},
): ContextoOcasioes => ({
  ocasioes,
  nomes: new Map(Object.entries(nomes).map(([id, nome]) => [Number(id), nome] as const)),
  fontes: new Map(Object.entries(fontes)),
});

function linha(
  parcial: Partial<LinhaParaRelatorio> & Pick<LinhaParaRelatorio, 'linha' | 'item' | 'fonte'>,
): LinhaParaRelatorio {
  return {
    codigos: [`C${String(parcial.linha).padStart(4, '0')}`],
    status: 'nao',
    Q: 60,
    AG: 60,
    U: 0,
    AN: -100,
    AQ: 30,
    projecao: [40, -20, -80, -140, -200, -260],
    chegadas: [0, 0, 0, 0, 0],
    programacoes: [0, 0, 0, 0],
    ...parcial,
  };
}

const sintetica = (linhas: LinhaParaRelatorio[]): QuinzenaParaRelatorio => ({
  id: 1,
  label: '10-2',
  baseDate: BASE,
  half: 2,
  origin: 'planilha',
  hoje: HOJE,
  linhas,
});

// Remove, em qualquer nivel, a chave `ocasioes` (o bloco novo) para comparar o resto com o relatorio sem ocasioes.
function semBlocos<T>(valor: T): T {
  if (Array.isArray(valor)) {
    return valor.map(semBlocos) as unknown as T;
  }
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([chave]) => chave !== 'ocasioes')
        .map(([chave, v]) => [chave, semBlocos(v)]),
    ) as T;
  }
  return valor;
}

function congelar<T>(valor: T): T {
  if (valor !== null && typeof valor === 'object' && !(valor instanceof Map)) {
    Object.values(valor as Record<string, unknown>).forEach(congelar);
    Object.freeze(valor);
  }
  return valor;
}

const itensDe = (r: RelatorioCompras) => r.grupos.flatMap((g) => g.itens);

describe('chaveDaFonte', () => {
  it('mesma regra de normalizeSourceName (trim + maiusculas)', () => {
    for (const texto of ['  fonte 001 ', 'Fonte 001', 'FONTE 001', '', '   ']) {
      expect(chaveDaFonte(texto)).toBe(normalizeSourceName(texto));
    }
  });
});

describe('ocasioesDoItem', () => {
  // Fonte com etapas 10/5/10/5 (soma 30); ruptura 2026-11-21 e AQ 30 => data-limite normal 2026-10-22 (hoje 2026-10-20).
  const E = { fonte: 'FONTE 001', leadTimeDias: 30, ruptura: '2026-11-21', vencida: false, hoje: HOJE };
  const fontes = { 'FONTE 001': fonteCad() };

  it('ocasiao total: soma o acrescimo, antecipa a data-limite e avisa que passou de hoje', () => {
    const ctx = contexto(fontes, [ocasiao({ id: 1 })], { 1: 'OCASIAO 001' });
    expect(ocasioesDoItem(E, ctx)).toStrictEqual({
      extraDias: 5,
      leadTimeAjustado: 35,
      dataLimiteAjustada: '2026-10-17',
      antesDeHoje: true,
      emissaoAvaliada: '2026-10-20',
      chegadaEstimada: '2026-11-24',
      ocasioes: [{ id: 1, nome: 'OCASIAO 001', etapa: 'total', dias: 5 }],
    });
  });

  it('ocasiao que cruza so uma etapa: soma so ela e lista a etapa certa', () => {
    const ctx = contexto(
      fontes,
      [
        ocasiao({ id: 2, etapa: 'prontidao', inicio: '2026-10-22', fim: '2026-10-23', valor: 3 }),
        ocasiao({ id: 3, etapa: 'liberacao', inicio: '2026-12-20', fim: '2026-12-21', valor: 9 }),
      ],
      { 2: 'OCASIAO 002', 3: 'OCASIAO 003' },
    );
    const r = ocasioesDoItem(E, ctx);
    expect(r?.extraDias).toBe(3);
    expect(r?.ocasioes).toStrictEqual([{ id: 2, nome: 'OCASIAO 002', etapa: 'prontidao', dias: 3 }]);
    expect(r?.componentesAusentes).toBeUndefined();
  });

  it('nome ausente do mapa vira "Ocasião <id>"', () => {
    const r = ocasioesDoItem(E, contexto(fontes, [ocasiao({ id: 7 })]));
    expect(r?.ocasioes[0].nome).toBe('Ocasião 7');
  });

  it('ocasiao que cruza com 0 dias: bloco presente com extraDias 0 e sem antes de hoje', () => {
    const r = ocasioesDoItem(E, contexto(fontes, [ocasiao({ id: 4, valor: 0 })]));
    expect(r).toMatchObject({ extraDias: 0, leadTimeAjustado: 30, dataLimiteAjustada: '2026-10-22', antesDeHoje: false });
    expect(r?.ocasioes).toHaveLength(1);
    expect(r?.ocasioes[0].dias).toBe(0);
  });

  it('nenhuma ocasiao cruza: sem bloco', () => {
    const longe = ocasiao({ id: 5, inicio: '2027-05-01', fim: '2027-05-05' });
    expect(ocasioesDoItem(E, contexto(fontes, [longe]))).toBeNull();
    expect(ocasioesDoItem(E, contexto(fontes, []))).toBeNull();
  });

  it('antesDeHoje: a normal ja vencida nao repete o aviso (ja e "Vencida")', () => {
    const ctx = contexto(fontes, [ocasiao({ id: 1, inicio: '2026-11-01', fim: '2026-12-31' })]);
    expect(ocasioesDoItem({ ...E, leadTimeDias: 90, vencida: false }, ctx)?.antesDeHoje).toBe(true);
    // AQ 90: data-limite normal 2026-08-23 (vencida); a ajustada tambem passou, mas o aviso nao duplica.
    expect(ocasioesDoItem({ ...E, leadTimeDias: 90, vencida: true }, ctx)?.antesDeHoje).toBe(false);
  });

  it('item sem ruptura: sem bloco', () => {
    expect(ocasioesDoItem({ ...E, ruptura: null }, contexto(fontes, [ocasiao({ id: 1 })]))).toBeNull();
  });

  it('fonte vazia ou fora do cadastro: sem bloco', () => {
    const ctx = contexto(fontes, [ocasiao({ id: 1 })]);
    expect(ocasioesDoItem({ ...E, fonte: '' }, ctx)).toBeNull();
    expect(ocasioesDoItem({ ...E, fonte: 'FONTE 009' }, ctx)).toBeNull();
  });

  it('a chave da fonte ignora caixa e espacos', () => {
    const ctx = contexto(fontes, [ocasiao({ id: 1 })]);
    expect(ocasioesDoItem({ ...E, fonte: '  fonte 001 ' }, ctx)).not.toBeNull();
  });

  it('fonte inativa: sem bloco', () => {
    const ctx = contexto({ 'FONTE 001': fonteCad({ ativa: false }) }, [ocasiao({ id: 1 })]);
    expect(ocasioesDoItem(E, ctx)).toBeNull();
  });

  it('ocasiao inativa e ignorada', () => {
    expect(ocasioesDoItem(E, contexto(fontes, [ocasiao({ id: 1, ativa: false })]))).toBeNull();
  });

  it('ocasiao de pais: fonte sem pais nao e alcancada; com pais igual, sim', () => {
    const pais = ocasiao({ id: 6, escopo: 'pais', countryCode: 'XA' });
    expect(ocasioesDoItem(E, contexto({ 'FONTE 001': fonteCad({ countryCode: null }) }, [pais]))).toBeNull();
    expect(ocasioesDoItem(E, contexto({ 'FONTE 001': fonteCad({ countryCode: 'XB' }) }, [pais]))).toBeNull();
    expect(ocasioesDoItem(E, contexto({ 'FONTE 001': fonteCad({ countryCode: 'XA' }) }, [pais]))).not.toBeNull();
  });

  it('ocasiao de fonte: so a fonte indicada', () => {
    const daFonte = ocasiao({ id: 8, escopo: 'fonte', sourceId: 2 });
    expect(ocasioesDoItem(E, contexto({ 'FONTE 001': fonteCad({ id: 1 }) }, [daFonte]))).toBeNull();
    expect(ocasioesDoItem(E, contexto({ 'FONTE 001': fonteCad({ id: 2 }) }, [daFonte]))).not.toBeNull();
  });

  it('etapa nula no cadastro: componentesAusentes e cada ocasiao e comparada com o lead time inteiro', () => {
    const ctx = contexto({ 'FONTE 001': fonteCad({ shippingDays: null }) }, [ocasiao({ id: 9, etapa: 'liberacao' })]);
    const r = ocasioesDoItem(E, ctx);
    expect(r?.componentesAusentes).toBe(true);
    expect(r?.ocasioes).toHaveLength(1);
  });

  it('etapas somam mais que o AQ congelado: componentesAusentes', () => {
    const ctx = contexto({ 'FONTE 001': fonteCad({ readinessDays: 40 }) }, [ocasiao({ id: 9, etapa: 'prontidao' })]);
    expect(ocasioesDoItem(E, ctx)?.componentesAusentes).toBe(true);
  });

  it('etapas somam menos que o AQ (folga): sem aviso (PONTO ABERTO do plano)', () => {
    const ctx = contexto({ 'FONTE 001': fonteCad({ readinessDays: 5 }) }, [ocasiao({ id: 9 })]);
    expect(ocasioesDoItem(E, ctx)?.componentesAusentes).toBeUndefined();
  });

  it('usa o AQ congelado (leadTimeDias do item), nao o do cadastro', () => {
    const r = ocasioesDoItem({ ...E, leadTimeDias: 40 }, contexto(fontes, [ocasiao({ id: 1 })]));
    expect(r?.leadTimeAjustado).toBe(45);
  });

  it('nao estabiliza: oscilou e vale o maior acrescimo', () => {
    // Fonte da util (forecast-ocasioes.test.ts): prontidao 30, embarque 10, transito 40, liberacao 10, LT 100; hoje 2030-01-01.
    const longa = fonteCad({ readinessDays: 30, shippingDays: 10, transitDays: 40, clearanceDays: 10 });
    const o = ocasiao({ id: 42, etapa: 'prontidao', inicio: '2030-03-18', fim: '2030-03-22', valor: 10 });
    const r = ocasioesDoItem(
      { fonte: 'FONTE 001', leadTimeDias: 100, ruptura: '2030-06-01', vencida: false, hoje: '2030-01-01' },
      contexto({ 'FONTE 001': longa }, [o], { 42: 'OCASIAO 042' }),
    );
    expect(r).toMatchObject({ oscilou: true, extraDias: 10, dataLimiteAjustada: '2030-02-11', chegadaEstimada: '2030-06-11' });
    expect(r?.ocasioes).toStrictEqual([{ id: 42, nome: 'OCASIAO 042', etapa: 'prontidao', dias: 10 }]);
  });

  it('recorrente anual: a ocorrencia do ano da janela cruza', () => {
    const natal = ocasiao({ id: 10, inicio: '2025-11-02', fim: '2025-11-04', recorrencia: 'anual', valor: 2 });
    expect(ocasioesDoItem(E, contexto(fontes, [natal]))?.extraDias).toBe(2);
  });
});

describe('ocasioesDaPoHoje', () => {
  const fontes = { 'FONTE 001': fonteCad() };

  it('emissao = hoje; chegada = hoje + AQ + acrescimo', () => {
    const ctx = contexto(fontes, [ocasiao({ id: 1 })], { 1: 'OCASIAO 001' });
    expect(ocasioesDaPoHoje({ fonte: 'FONTE 001', AQ: 30 }, HOJE, ctx)).toStrictEqual({
      extraDias: 5,
      leadTimeAjustado: 35,
      chegadaEstimada: '2026-11-24',
      ocasioes: [{ id: 1, nome: 'OCASIAO 001', etapa: 'total', dias: 5 }],
    });
  });

  it('sem AQ, fonte fora do cadastro ou nenhuma ocasiao cruzando: null', () => {
    const ctx = contexto(fontes, [ocasiao({ id: 1 })]);
    expect(ocasioesDaPoHoje({ fonte: 'FONTE 001', AQ: null }, HOJE, ctx)).toBeNull();
    expect(ocasioesDaPoHoje({ fonte: 'FONTE 009', AQ: 30 }, HOJE, ctx)).toBeNull();
    expect(ocasioesDaPoHoje({ fonte: 'FONTE 001', AQ: 30 }, HOJE, contexto(fontes, []))).toBeNull();
  });

  it('componentes ausentes sai marcado', () => {
    const ctx = contexto({ 'FONTE 001': fonteCad({ transitDays: null }) }, [ocasiao({ id: 1 })]);
    expect(ocasioesDaPoHoje({ fonte: 'FONTE 001', AQ: 30 }, HOJE, ctx)?.componentesAusentes).toBe(true);
  });
});

describe('anexarOcasioesAoRelatorio (sintetico)', () => {
  const linhas = [
    linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE 001' }),
    linha({ linha: 2, item: 'PRODUTO 002', fonte: 'fonte 001 ', AN: -50 }),
    linha({ linha: 3, item: 'PRODUTO 003', fonte: 'FONTE 002' }),
    linha({ linha: 4, item: 'PRODUTO 004', fonte: '' }),
    // Sem ruptura em 6 meses: nao conta em nada.
    linha({ linha: 5, item: 'PRODUTO 005', fonte: 'FONTE 003', AN: -5, Q: 10, AG: 10, projecao: [5, 5, 5, 5, 5, 5] }),
    // Fonte inativa no cadastro.
    linha({ linha: 6, item: 'PRODUTO 006', fonte: 'FONTE 004' }),
  ];
  const fontes = {
    'FONTE 001': fonteCad({ id: 1 }),
    'FONTE 003': fonteCad({ id: 3, countryCode: null }),
    'FONTE 004': fonteCad({ id: 4, countryCode: null, ativa: false }),
  };
  const ocasioes = [ocasiao({ id: 1 }), ocasiao({ id: 2, escopo: 'pais', countryCode: 'XB', etapa: 'prontidao' })];
  const base = montarRelatorioCompras(sintetica(linhas), []);
  const ctx = contexto(fontes, ocasioes, { 1: 'OCASIAO 001', 2: 'OCASIAO 002' });
  const r = anexarOcasioesAoRelatorio(base, ctx);

  it('bloco do relatorio com todas as contagens', () => {
    expect(r.ocasioes).toStrictEqual({
      estado: 'ok',
      ativas: 2,
      itensAfetados: 2,
      ocasioesQueCruzam: 1,
      antesDeHoje: 2,
      itensSemFonteCadastrada: 2,
      fontesSemPais: 1,
    });
  });

  it('item: bloco so nos itens da fonte cadastrada que a ocasiao cruza', () => {
    const porLinha = new Map(itensDe(r).map((i) => [i.linha, i] as const));
    expect(porLinha.get(1)?.ocasioes?.extraDias).toBe(5);
    expect(porLinha.get(2)?.ocasioes?.extraDias).toBe(5);
    for (const l of [3, 4, 5, 6]) {
      expect('ocasioes' in (porLinha.get(l) ?? {})).toBe(false);
    }
  });

  it('grupo: uniao distinta por id, itensAfetados e so no grupo com efeito', () => {
    const grupos = new Map(r.grupos.map((g) => [g.fonte, g] as const));
    expect(grupos.get('FONTE 001')?.ocasioes).toStrictEqual({
      itensAfetados: 2,
      ocasioes: [{ id: 1, nome: 'OCASIAO 001', etapa: 'total' }],
    });
    expect('ocasioes' in (grupos.get('FONTE 002') ?? {})).toBe(false);
    expect('ocasioes' in (grupos.get('FONTE 003') ?? {})).toBe(false);
  });

  it('grupo marca componentesAusentes quando algum item tem', () => {
    const c = contexto({ 'FONTE 001': fonteCad({ shippingDays: null }) }, [ocasiao({ id: 1 })]);
    const rr = anexarOcasioesAoRelatorio(montarRelatorioCompras(sintetica(linhas.slice(0, 2)), []), c);
    expect(rr.grupos[0].ocasioes?.componentesAusentes).toBe(true);
  });

  it('fontesSemPais so conta com ocasiao de pais ativa', () => {
    const rr = anexarOcasioesAoRelatorio(base, contexto(fontes, [ocasiao({ id: 1 })]));
    expect(rr.ocasioes).toMatchObject({ estado: 'ok', fontesSemPais: 0 });
  });

  it('campos existentes identicos (nada reescrito)', () => {
    expect(semBlocos(r)).toStrictEqual(semBlocos(base));
  });

  it('indisponivel: so o aviso no topo; o resto e identico', () => {
    const ind = anexarOcasioesAoRelatorio(base, { indisponivel: true });
    expect(ind.ocasioes).toStrictEqual({ estado: 'indisponivel' });
    expect(semBlocos(ind)).toStrictEqual(semBlocos(base));
    expect(itensDe(ind).every((i) => !('ocasioes' in i))).toBe(true);
    expect(ind.grupos.every((g) => !('ocasioes' in g))).toBe(true);
  });

  it('chaves novas entram como ultima chave do objeto', () => {
    expect(Object.keys(r).at(-1)).toBe('ocasioes');
    const afetado = r.grupos.find((g) => g.fonte === 'FONTE 001');
    expect(Object.keys(afetado ?? {}).at(-1)).toBe('ocasioes');
    expect(Object.keys(afetado?.itens[0] ?? {}).at(-1)).toBe('ocasioes');
  });

  it('nao muta nem quebra com entradas congeladas', () => {
    const baseCongelada = congelar(montarRelatorioCompras(sintetica(linhas), []));
    const ctxCongelado = congelar(contexto(fontes, ocasioes.map((o) => ({ ...o })), { 1: 'OCASIAO 001' }));
    expect(() => anexarOcasioesAoRelatorio(baseCongelada, ctxCongelado)).not.toThrow();
  });
});

describe('anexarOcasioesAoRelatorio (grupo de equivalencia)', () => {
  it('vale a fonte e o AQ da linha do grupo (o principal); membros de outras fontes nao sao avaliados', () => {
    const linhas = [
      linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE 001', productId: 1, AQ: 30 }),
      linha({ linha: 2, item: 'PRODUTO 002', fonte: 'FONTE 002', productId: 2, AQ: 60 }),
    ];
    const grupos = [{ id: 1, nome: 'GRUPO 001', principalProductId: 1, productIds: [1, 2] }];
    const base = montarRelatorioCompras(sintetica(linhas), [], { grupos });
    expect(base.grupos).toHaveLength(1);
    expect(base.grupos[0].itens[0].grupo).toBeDefined();

    const fontes = { 'FONTE 001': fonteCad({ id: 1 }), 'FONTE 002': fonteCad({ id: 2, readinessDays: 20, shippingDays: 10, transitDays: 20, clearanceDays: 10 }) };
    const daFonte2 = ocasiao({ id: 2, escopo: 'fonte', sourceId: 2 });
    const daFonte1 = ocasiao({ id: 1, escopo: 'fonte', sourceId: 1, valor: 4 });
    const r = anexarOcasioesAoRelatorio(base, contexto(fontes, [daFonte1, daFonte2], { 1: 'OCASIAO 001', 2: 'OCASIAO 002' }));
    const bloco = r.grupos[0].itens[0].ocasioes;
    expect(bloco?.ocasioes.map((o) => o.id)).toStrictEqual([1]);
    expect(bloco?.leadTimeAjustado).toBe(base.grupos[0].itens[0].leadTimeDias + 4);
  });
});

describe('igualdade com a fixture anonimizada (hoje 2026-10-20)', () => {
  const calculadas = calcular(fixture, { hoje: HOJE, quinzena: 2 });
  const produtoPorLinha = new Map(fixture.produtos.map((p) => [p.linha, p]));
  const linhas: LinhaParaRelatorio[] = calculadas.map((c) => {
    const p = produtoPorLinha.get(c.linha)!;
    return {
      ...c,
      n: p.n,
      item: p.item,
      codigos: p.codigos.filter((x) => x !== ''),
      fonte: p.fonte,
      status: p.status,
      naoFraciona: p.naoFraciona.trim().toUpperCase() === 'X',
    };
  });
  const quinzena: QuinzenaParaRelatorio = {
    id: 7,
    label: fixture.id,
    baseDate: fixture.dataBase,
    half: 2,
    origin: 'planilha',
    hoje: HOJE,
    linhas,
  };

  // Cadastro sintetico: ids 1..N pela ordem das fontes; 1/2 com etapas que somam o AQ, 1/4 com etapa nula, 1/4 sem pais.
  const chaves = [...new Set(linhas.map((l) => chaveDaFonte(l.fonte)).filter((c) => c !== ''))].sort();
  const fontes: Record<string, FonteDoCadastro> = {};
  chaves.forEach((chave, i) => {
    const aq = linhas.find((l) => chaveDaFonte(l.fonte) === chave && l.AQ !== null)?.AQ ?? 0;
    const quarto = Math.floor(aq / 4);
    fontes[chave] = {
      id: i + 1,
      countryCode: i % 4 === 3 ? null : i % 2 === 0 ? 'XA' : 'XB',
      ativa: true,
      readinessDays: quarto,
      shippingDays: i % 4 === 2 ? null : quarto,
      transitDays: quarto,
      clearanceDays: aq - 3 * quarto,
    };
  });
  const ocasioes = [
    ocasiao({ id: 1, etapa: 'total', inicio: '2026-11-01', fim: '2026-11-05', valor: 5 }),
    ocasiao({ id: 2, escopo: 'pais', countryCode: 'XA', etapa: 'prontidao', inicio: '2026-10-22', fim: '2026-10-26', valor: 3 }),
    ocasiao({ id: 3, escopo: 'fonte', sourceId: 2, etapa: 'embarque', inicio: '2026-11-10', fim: '2026-11-12', valor: 2 }),
    ocasiao({ id: 4, etapa: 'total', inicio: '2025-12-24', fim: '2025-12-26', recorrencia: 'anual', valor: 4 }),
    ocasiao({ id: 5, etapa: 'total', inicio: '2026-10-20', fim: '2026-12-31', valor: 100, ativa: false }),
  ];
  const nomes = Object.fromEntries(ocasioes.map((o) => [o.id, `OCASIAO ${String(o.id).padStart(3, '0')}`]));
  const ctx = contexto(fontes, ocasioes, nomes);

  const sem = montarRelatorioCompras(quinzena, []);
  const com = montarRelatorioCompras(quinzena, [], { ocasioes: ctx });

  it('sem contexto: relatorio identico e sem nenhuma chave nova', () => {
    const semOpcao = montarRelatorioCompras(quinzena, [], { ocasioes: undefined });
    expect(semOpcao).toStrictEqual(sem);
    expect(JSON.stringify(sem)).not.toContain('"ocasioes"');
    expect('ocasioes' in sem).toBe(false);
    expect(sem.grupos.every((g) => !('ocasioes' in g) && g.itens.every((i) => !('ocasioes' in i)))).toBe(true);
  });

  it('com ocasioes: ha efeito de verdade e todos os campos existentes saem identicos', () => {
    const afetados = itensDe(com).filter((i) => i.ocasioes);
    expect(afetados.length).toBeGreaterThan(10);
    expect(com.ocasioes).toMatchObject({ estado: 'ok', ativas: 5 });
    expect(semBlocos(com)).toStrictEqual(sem);

    const original = itensDe(sem);
    const novo = itensDe(com);
    expect(novo).toHaveLength(original.length);
    novo.forEach((item, i) => {
      for (const campo of [
        'leadTimeDias',
        'dataLimite',
        'vencida',
        'urgencia',
        'diasAteRuptura',
        'posicaoUrgencia',
        'quantidadeSugerida',
        'quantidadeFinal',
        'quantidadeEmbalagens',
        'demanda',
        'linha',
      ] as const) {
        expect(item[campo]).toStrictEqual(original[i][campo]);
      }
    });
    expect(com.totais).toStrictEqual(sem.totais);
    expect(com.fora).toStrictEqual(sem.fora);
    expect(com.grupos.map((g) => g.fonte)).toStrictEqual(sem.grupos.map((g) => g.fonte));
    expect(com.grupos.map((g) => g.leadTimeDias)).toStrictEqual(sem.grupos.map((g) => g.leadTimeDias));
  });

  it('a ocasiao inativa nunca aparece e os casos de borda do cadastro sintetico aparecem', () => {
    const blocos = itensDe(com).flatMap((i) => (i.ocasioes ? [i.ocasioes] : []));
    expect(blocos.some((b) => b.ocasioes.some((o) => o.id === 5))).toBe(false);
    expect(blocos.some((b) => b.componentesAusentes)).toBe(true);
    expect(blocos.some((b) => b.ocasioes.some((o) => o.nome === 'OCASIAO 001'))).toBe(true);
  });

  it('indisponivel: so o aviso no topo', () => {
    const ind = montarRelatorioCompras(quinzena, [], { ocasioes: { indisponivel: true } });
    expect(ind.ocasioes).toStrictEqual({ estado: 'indisponivel' });
    expect(semBlocos(ind)).toStrictEqual(sem);
  });
});

describe('desempenho', () => {
  afterEach(() => vi.restoreAllMocks());

  it('400 itens em 40 fontes x 20 ocasioes ativas em menos de 1 segundo, sem console', () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const linhas = Array.from({ length: 400 }, (_, i) =>
      linha({
        linha: i + 1,
        item: `PRODUTO ${String(i + 1).padStart(3, '0')}`,
        fonte: `FONTE ${String((i % 40) + 1).padStart(3, '0')}`,
        AQ: 20 + (i % 9) * 10,
      }),
    );
    const fontes: Record<string, FonteDoCadastro> = {};
    for (let i = 1; i <= 40; i += 1) {
      fontes[`FONTE ${String(i).padStart(3, '0')}`] = fonteCad({ id: i, countryCode: i % 3 === 0 ? null : 'XA' });
    }
    const ocasioes = Array.from({ length: 20 }, (_, i) =>
      ocasiao({
        id: i + 1,
        escopo: i % 3 === 0 ? 'global' : i % 3 === 1 ? 'pais' : 'fonte',
        countryCode: i % 3 === 1 ? 'XA' : null,
        sourceId: i % 3 === 2 ? (i % 40) + 1 : null,
        etapa: (['total', 'prontidao', 'embarque', 'transito', 'liberacao'] as const)[i % 5],
        inicio: `2026-${String(10 + (i % 3)).padStart(2, '0')}-${String(1 + i).padStart(2, '0')}`,
        fim: `2026-${String(10 + (i % 3)).padStart(2, '0')}-${String(10 + i).padStart(2, '0')}`,
        valor: 1 + (i % 6),
      }),
    );
    const base = montarRelatorioCompras(sintetica(linhas), []);
    expect(itensDe(base)).toHaveLength(400);

    const inicio = performance.now();
    const r = anexarOcasioesAoRelatorio(base, contexto(fontes, ocasioes));
    const ms = performance.now() - inicio;

    expect(r.ocasioes).toMatchObject({ estado: 'ok', ativas: 20 });
    expect(ms).toBeLessThan(1000);
    for (const espiao of espioes) expect(espiao).not.toHaveBeenCalled();
  });
});
