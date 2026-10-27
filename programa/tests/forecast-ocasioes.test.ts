import { describe, expect, it } from 'vitest';
import {
  FORECAST_OCASIAO_ETAPAS,
  FORECAST_OCASIAO_ESCOPOS,
  FORECAST_OCASIAO_RECORRENCIAS,
} from '../src/constants/forecast';
import {
  dataLimiteAjustada,
  leadTimeAjustado,
  ocasiaoAlcancaFonte,
  ocasioesNoPeriodo,
  ocorrenciasNaJanela,
  type FonteLeadTime,
  type OcasiaoLeadTime,
} from '../src/utils/forecastOcasioes';

// Fonte sintetica: prontidao 30, embarque 10, transito 40, liberacao 10, LT 100 (folga 10).
// Emissao 2030-01-01: prontidao 01-01..01-30, embarque 01-31..02-09, transito 02-10..03-21, liberacao 03-22..03-31,
// folga 04-01..04-10, chegada 04-11.
const D = '2030-01-01';

const fonte = (over: Partial<FonteLeadTime> = {}): FonteLeadTime => ({
  id: 1,
  countryCode: 'XA',
  ativa: true,
  leadTimeDays: 100,
  readinessDays: 30,
  shippingDays: 10,
  transitDays: 40,
  clearanceDays: 10,
  ...over,
});

let proximoId = 1;
const ocasiao = (over: Partial<OcasiaoLeadTime> = {}): OcasiaoLeadTime => ({
  id: proximoId++,
  escopo: 'global',
  countryCode: null,
  sourceId: null,
  inicio: '2030-01-10',
  fim: '2030-01-15',
  recorrencia: 'nenhuma',
  etapa: 'prontidao',
  efeito: 'dias',
  valor: 7,
  ativa: true,
  ...over,
});

const extra = (f: FonteLeadTime, ocasioes: OcasiaoLeadTime[], emissao = D) =>
  leadTimeAjustado(f, ocasioes, emissao)?.extraDias;

describe('ocorrenciasNaJanela', () => {
  it('nenhuma: devolve o proprio periodo se intersecta a janela (inclusiva), senao []', () => {
    const o = { inicio: '2030-01-10', fim: '2030-01-15', recorrencia: 'nenhuma' as const };
    expect(ocorrenciasNaJanela(o, '2030-01-01', '2030-01-31')).toEqual([{ inicio: '2030-01-10', fim: '2030-01-15' }]);
    expect(ocorrenciasNaJanela(o, '2030-01-15', '2030-02-01')).toEqual([{ inicio: '2030-01-10', fim: '2030-01-15' }]);
    expect(ocorrenciasNaJanela(o, '2030-01-16', '2030-02-01')).toEqual([]);
    expect(ocorrenciasNaJanela(o, '2029-12-01', '2030-01-09')).toEqual([]);
    expect(ocorrenciasNaJanela(o, '2031-01-01', '2031-12-31')).toEqual([]);
  });

  it('anual: repete antes e depois do ano de referencia', () => {
    const o = { inicio: '2030-03-10', fim: '2030-03-12', recorrencia: 'anual' as const };
    expect(ocorrenciasNaJanela(o, '2028-01-01', '2029-12-31')).toEqual([
      { inicio: '2028-03-10', fim: '2028-03-12' },
      { inicio: '2029-03-10', fim: '2029-03-12' },
    ]);
    expect(ocorrenciasNaJanela(o, '2031-01-01', '2032-12-31')).toEqual([
      { inicio: '2031-03-10', fim: '2031-03-12' },
      { inicio: '2032-03-10', fim: '2032-03-12' },
    ]);
  });

  it('anual: virada de ano (20/12 -> 05/01) e janela que pega so o fim da ocorrencia do ano anterior', () => {
    const o = { inicio: '2029-12-20', fim: '2030-01-05', recorrencia: 'anual' as const };
    expect(ocorrenciasNaJanela(o, '2031-12-01', '2032-01-31')).toEqual([
      { inicio: '2031-12-20', fim: '2032-01-05' },
    ]);
    // Janela comeca em 03/01: so o fim da ocorrencia que nasceu em 20/12 do ano anterior.
    expect(ocorrenciasNaJanela(o, '2032-01-03', '2032-01-04')).toEqual([{ inicio: '2031-12-20', fim: '2032-01-05' }]);
    expect(ocorrenciasNaJanela(o, '2032-01-06', '2032-02-01')).toEqual([]);
  });

  it('anual: 29/02 em ano nao bissexto vira 28/02 e em bissexto fica 29/02', () => {
    const o = { inicio: '2028-02-29', fim: '2028-03-02', recorrencia: 'anual' as const };
    expect(ocorrenciasNaJanela(o, '2029-01-01', '2029-12-31')).toEqual([{ inicio: '2029-02-28', fim: '2029-03-02' }]);
    expect(ocorrenciasNaJanela(o, '2032-01-01', '2032-12-31')).toEqual([{ inicio: '2032-02-29', fim: '2032-03-02' }]);
    const fimEm29 = { inicio: '2028-02-27', fim: '2028-02-29', recorrencia: 'anual' as const };
    expect(ocorrenciasNaJanela(fimEm29, '2029-01-01', '2029-12-31')).toEqual([
      { inicio: '2029-02-27', fim: '2029-02-28' },
    ]);
  });

  it('janela invertida, data invalida ou periodo invertido = []', () => {
    const o = { inicio: '2030-01-10', fim: '2030-01-15', recorrencia: 'nenhuma' as const };
    expect(ocorrenciasNaJanela(o, '2030-02-01', '2030-01-01')).toEqual([]);
    expect(ocorrenciasNaJanela({ ...o, inicio: '2030-02-30' }, '2030-01-01', '2030-12-31')).toEqual([]);
    expect(ocorrenciasNaJanela({ ...o, inicio: '2030-01-20' }, '2030-01-01', '2030-12-31')).toEqual([]);
  });
});

describe('leadTimeAjustado - linha do tempo por etapas', () => {
  it('sem ocasioes: extra 0 e lead time intacto', () => {
    expect(leadTimeAjustado(fonte(), [], D)).toEqual({
      leadTime: 100,
      extraDias: 0,
      leadTimeAjustado: 100,
      componentesAusentes: false,
      ocasioes: [],
    });
  });

  it('ocasiao na prontidao soma o efeito', () => {
    const r = leadTimeAjustado(fonte(), [ocasiao({ id: 10 })], D);
    expect(r?.extraDias).toBe(7);
    expect(r?.leadTimeAjustado).toBe(107);
    expect(r?.ocasioes).toEqual([{ id: 10, etapa: 'prontidao', dias: 7 }]);
  });

  it('empurrao: a prontidao esticada faz o embarque cruzar uma ocasiao que antes nao cruzava', () => {
    const prontidao = ocasiao({ id: 1 });
    const embarque = ocasiao({ id: 2, etapa: 'embarque', inicio: '2030-02-12', fim: '2030-02-14', valor: 5 });
    expect(extra(fonte(), [embarque])).toBe(0);
    expect(extra(fonte(), [prontidao])).toBe(7);
    // Prontidao +7 empurra o embarque para 02-07..02-16, que cruza 02-12..02-14.
    expect(extra(fonte(), [prontidao, embarque])).toBe(12);
  });

  it('fronteira inclusiva: termina no dia anterior = nao cruza; no primeiro dia = cruza', () => {
    const naProntidao = ocasiao({ inicio: '2030-01-31', fim: '2030-02-02', etapa: 'prontidao', valor: 4 });
    expect(extra(fonte(), [naProntidao])).toBe(0);
    const noEmbarque = ocasiao({ inicio: '2030-01-31', fim: '2030-02-02', etapa: 'embarque', valor: 4 });
    expect(extra(fonte(), [noEmbarque])).toBe(4);
    const terminaAntes = ocasiao({ inicio: '2030-01-25', fim: '2030-01-30', etapa: 'embarque', valor: 4 });
    expect(extra(fonte(), [terminaAntes])).toBe(0);
    const terminaNoPrimeiroDia = ocasiao({ inicio: '2030-01-25', fim: '2030-01-31', etapa: 'embarque', valor: 4 });
    expect(extra(fonte(), [terminaNoPrimeiroDia])).toBe(4);
  });

  it('percentual em aritmetica inteira: 10% de 30 = 3, 10% de 40 = 4, 33,33% de 10 = 4, 1% de 1 = 1', () => {
    const pront = ocasiao({ etapa: 'prontidao', efeito: 'percentual', valor: 10 });
    expect(extra(fonte(), [pront])).toBe(3);
    const trans = ocasiao({ etapa: 'transito', efeito: 'percentual', valor: 10, inicio: '2030-02-20', fim: '2030-02-21' });
    expect(extra(fonte(), [trans])).toBe(4);
    const lib = ocasiao({ etapa: 'liberacao', efeito: 'percentual', valor: 33.33, inicio: '2030-03-25', fim: '2030-03-26' });
    expect(extra(fonte(), [lib])).toBe(4);
    const umDia = fonte({ readinessDays: 1, shippingDays: 0, transitDays: 0, clearanceDays: 0, leadTimeDays: 1 });
    expect(extra(umDia, [ocasiao({ etapa: 'prontidao', efeito: 'percentual', valor: 1, inicio: D, fim: D })])).toBe(1);
  });

  it('dias fracionados arredondam para cima', () => {
    expect(extra(fonte(), [ocasiao({ valor: 7.5 })])).toBe(8);
  });

  it('total: avaliado contra o lead time esticado pelas etapas; base do percentual = lead time', () => {
    const total = ocasiao({ etapa: 'total', inicio: '2030-04-05', fim: '2030-04-06', valor: 3 });
    expect(extra(fonte(), [total])).toBe(3);
    // Sem extras a janela vai ate 04-10 (D+99): 04-12..04-13 fica de fora; com prontidao +7 a janela vai ate 04-17.
    const depois = ocasiao({ etapa: 'total', inicio: '2030-04-12', fim: '2030-04-13', valor: 3 });
    expect(extra(fonte(), [depois])).toBe(0);
    expect(extra(fonte(), [ocasiao({ id: 90 }), depois])).toBe(10);
    const pct = ocasiao({ etapa: 'total', efeito: 'percentual', valor: 5, inicio: '2030-04-05', fim: '2030-04-06' });
    expect(extra(fonte(), [pct])).toBe(5);
  });

  it('etapa com 0 dias nao cruza e nao some os dias da cadeia', () => {
    const f = fonte({ shippingDays: 0, leadTimeDays: 90 });
    const emb = ocasiao({ etapa: 'embarque', inicio: '2030-01-31', fim: '2030-02-05', valor: 9 });
    expect(extra(f, [emb])).toBe(0);
    // Transito comeca em 01-31 (embarque tem 0 dias).
    const trans = ocasiao({ etapa: 'transito', inicio: '2030-01-31', fim: '2030-01-31', valor: 2 });
    expect(extra(f, [trans])).toBe(2);
  });

  it('componentes ausentes (null) e soma das etapas > lead time: avalia contra [D, D+LT-1], base = LT', () => {
    const semTransito = fonte({ transitDays: null });
    const r = leadTimeAjustado(semTransito, [ocasiao({ etapa: 'transito', inicio: '2030-04-05', fim: '2030-04-06', valor: 3 })], D);
    expect(r?.componentesAusentes).toBe(true);
    expect(r?.extraDias).toBe(3);
    const pct = ocasiao({ etapa: 'embarque', efeito: 'percentual', valor: 10, inicio: D, fim: D });
    expect(extra(semTransito, [pct])).toBe(10);

    const somaMaior = fonte({ leadTimeDays: 80 });
    const r2 = leadTimeAjustado(somaMaior, [ocasiao({ etapa: 'liberacao', inicio: '2030-03-10', fim: '2030-03-11', valor: 2 })], D);
    expect(r2?.componentesAusentes).toBe(true);
    // [D, D+79] = ate 03-21: liberacao em 03-10 cruza (nao cruzaria na linha do tempo normal).
    expect(r2?.extraDias).toBe(2);
    expect(leadTimeAjustado(fonte(), [], D)?.componentesAusentes).toBe(false);
  });

  it('soma sem teto: tres ocasioes de 50 dias na mesma etapa = 150', () => {
    const tres = [1, 2, 3].map(() => ocasiao({ valor: 50 }));
    expect(extra(fonte(), tres)).toBe(150);
  });

  it('ocasiao que cruza com 0 dias aparece na lista com dias 0', () => {
    const r = leadTimeAjustado(fonte(), [ocasiao({ id: 5, valor: 0 })], D);
    expect(r?.extraDias).toBe(0);
    expect(r?.ocasioes).toEqual([{ id: 5, etapa: 'prontidao', dias: 0 }]);
  });

  it('ordem da lista: etapa e depois id; cada ocasiao conta uma vez mesmo com varias ocorrencias na janela', () => {
    const lista = [
      ocasiao({ id: 9, etapa: 'total', inicio: '2030-04-05', fim: '2030-04-06', valor: 1 }),
      ocasiao({ id: 8, etapa: 'embarque', inicio: '2030-02-01', fim: '2030-02-02', valor: 1 }),
      ocasiao({ id: 7, etapa: 'prontidao', inicio: '2030-01-05', fim: '2030-01-06', valor: 1 }),
      ocasiao({ id: 3, etapa: 'prontidao', inicio: '2030-01-05', fim: '2030-01-06', valor: 1 }),
    ];
    expect(leadTimeAjustado(fonte(), lista, D)?.ocasioes.map((o) => o.id)).toEqual([3, 7, 8, 9]);
    const anual = ocasiao({ id: 1, recorrencia: 'anual', inicio: '2029-01-05', fim: '2029-01-06', etapa: 'total', valor: 2 });
    expect(extra(fonte({ leadTimeDays: 800 }), [anual])).toBe(2);
  });

  it('lead time null = null; lead time 0 = 0', () => {
    expect(leadTimeAjustado(fonte({ leadTimeDays: null }), [ocasiao()], D)).toBeNull();
    const r = leadTimeAjustado(fonte({ leadTimeDays: 0 }), [ocasiao(), ocasiao({ etapa: 'total', inicio: D, fim: D })], D);
    expect(r?.extraDias).toBe(0);
    expect(r?.leadTimeAjustado).toBe(0);
  });

  it('ocasiao recorrente alcanca a fonte em outro ano', () => {
    const o = ocasiao({ recorrencia: 'anual', inicio: '2025-01-10', fim: '2025-01-15' });
    expect(extra(fonte(), [o])).toBe(7);
    expect(extra(fonte(), [o], '2031-01-01')).toBe(7);
  });
});

describe('ocasiaoAlcancaFonte', () => {
  it('global alcanca toda fonte ativa', () => {
    expect(ocasiaoAlcancaFonte(ocasiao(), fonte({ countryCode: null }))).toBe(true);
  });

  it('pais: so com o mesmo codigo; fonte sem pais nunca casa', () => {
    const o = ocasiao({ escopo: 'pais', countryCode: 'XA' });
    expect(ocasiaoAlcancaFonte(o, fonte({ countryCode: 'XA' }))).toBe(true);
    expect(ocasiaoAlcancaFonte(o, fonte({ countryCode: 'XB' }))).toBe(false);
    expect(ocasiaoAlcancaFonte(o, fonte({ countryCode: null }))).toBe(false);
    expect(ocasiaoAlcancaFonte(ocasiao({ escopo: 'pais', countryCode: null }), fonte({ countryCode: null }))).toBe(false);
  });

  it('fonte: so o id certo', () => {
    const o = ocasiao({ escopo: 'fonte', sourceId: 1 });
    expect(ocasiaoAlcancaFonte(o, fonte({ id: 1 }))).toBe(true);
    expect(ocasiaoAlcancaFonte(o, fonte({ id: 2 }))).toBe(false);
  });

  it('fonte inativa nunca e afetada; ocasiao inativa nunca conta', () => {
    expect(ocasiaoAlcancaFonte(ocasiao(), fonte({ ativa: false }))).toBe(false);
    expect(ocasiaoAlcancaFonte(ocasiao({ ativa: false }), fonte())).toBe(false);
    expect(leadTimeAjustado(fonte({ ativa: false }), [ocasiao()], D)).toMatchObject({ extraDias: 0, ocasioes: [] });
    expect(extra(fonte(), [ocasiao({ ativa: false })])).toBe(0);
  });

  it('pais: ocasiao de outro pais nao entra no lead time', () => {
    expect(extra(fonte({ countryCode: 'XB' }), [ocasiao({ escopo: 'pais', countryCode: 'XA' })])).toBe(0);
    expect(extra(fonte({ countryCode: 'XA' }), [ocasiao({ escopo: 'pais', countryCode: 'XA' })])).toBe(7);
  });
});

describe('ocasioesNoPeriodo', () => {
  it('so as ocasioes que alcancam a fonte e tem ocorrencia no periodo, por id', () => {
    const lista = [
      ocasiao({ id: 5, etapa: 'embarque', recorrencia: 'anual', inicio: '2029-02-01', fim: '2029-02-02' }),
      ocasiao({ id: 2, inicio: '2030-01-10', fim: '2030-01-15' }),
      ocasiao({ id: 3, inicio: '2031-01-10', fim: '2031-01-15' }),
      ocasiao({ id: 4, escopo: 'fonte', sourceId: 99 }),
      ocasiao({ id: 6, ativa: false }),
    ];
    expect(ocasioesNoPeriodo(fonte(), lista, '2030-01-01', '2030-03-01')).toEqual([
      { id: 2, etapa: 'prontidao', ocorrencias: [{ inicio: '2030-01-10', fim: '2030-01-15' }] },
      { id: 5, etapa: 'embarque', ocorrencias: [{ inicio: '2030-02-01', fim: '2030-02-02' }] },
    ]);
    expect(ocasioesNoPeriodo(fonte({ ativa: false }), lista, '2030-01-01', '2030-03-01')).toEqual([]);
  });
});

describe('dataLimiteAjustada', () => {
  const RUPTURA = '2030-06-01';
  const HOJE = '2030-01-01';
  // D0 = 2030-06-01 - 100 = 2030-02-21.
  const D0 = '2030-02-21';

  it('sem ocasioes: estavel na primeira avaliacao', () => {
    const r = dataLimiteAjustada({ fonte: fonte(), ocasioes: [], ruptura: RUPTURA, hoje: HOJE });
    expect(r).toMatchObject({
      extraDias: 0,
      leadTimeAjustado: 100,
      dataLimiteAjustada: D0,
      antesDeHoje: false,
      emissaoAvaliada: D0,
      chegadaEstimada: RUPTURA,
      iteracoes: 1,
      oscilou: false,
      componentesAusentes: false,
      ocasioes: [],
    });
  });

  it('estavel na primeira: a ocasiao cruza mas a data muda sem alterar o que cruza', () => {
    const total = ocasiao({ etapa: 'total', inicio: '2030-04-01', fim: '2030-06-30', valor: 5 });
    const r = dataLimiteAjustada({ fonte: fonte(), ocasioes: [total], ruptura: RUPTURA, hoje: HOJE });
    expect(r?.extraDias).toBe(5);
    expect(r?.dataLimiteAjustada).toBe('2030-02-16');
    expect(r?.oscilou).toBe(false);
  });

  it('precisa de 2 iteracoes: a data antecipada continua cruzando e estabiliza na segunda avaliacao', () => {
    // D0 = 02-21: a prontidao (02-21..03-22) cruza 02-21..02-22 (+4) => D1 = 02-17 (prontidao 02-17..03-18 tambem cruza)
    // => D2 = D1: estavel na 2a avaliacao.
    const o = ocasiao({ etapa: 'prontidao', inicio: '2030-02-21', fim: '2030-02-22', valor: 4 });
    const r = dataLimiteAjustada({ fonte: fonte(), ocasioes: [o], ruptura: RUPTURA, hoje: HOJE });
    expect(r).toMatchObject({ extraDias: 4, iteracoes: 2, oscilou: false, emissaoAvaliada: '2030-02-17' });
    expect(r?.dataLimiteAjustada).toBe('2030-02-17');
    expect(r?.chegadaEstimada).toBe(RUPTURA);
  });

  it('ocasiao que nao cruza em nenhuma avaliacao nao altera a data', () => {
    const o = ocasiao({ etapa: 'prontidao', inicio: '2030-02-17', fim: '2030-02-20', valor: 4 });
    const r = dataLimiteAjustada({ fonte: fonte(), ocasioes: [o], ruptura: RUPTURA, hoje: HOJE });
    expect(r).toMatchObject({ extraDias: 0, iteracoes: 1, emissaoAvaliada: D0 });
  });

  it('oscila: ocasiao de prontidao em D0+25..D0+29 com +10 -> usa o maior extra e a lista que o produziu', () => {
    const o = ocasiao({ id: 42, etapa: 'prontidao', inicio: '2030-03-18', fim: '2030-03-22', valor: 10 });
    // D0 = 02-21: D0+25 = 03-18. Prontidao de D0 = 02-21..03-22 cruza (10); D1 = 02-11: 02-11..03-12 nao cruza (0).
    const r = dataLimiteAjustada({ fonte: fonte(), ocasioes: [o], ruptura: RUPTURA, hoje: HOJE });
    expect(r).toMatchObject({ oscilou: true, extraDias: 10, iteracoes: 3, emissaoAvaliada: D0 });
    expect(r?.ocasioes).toEqual([{ id: 42, etapa: 'prontidao', dias: 10 }]);
    expect(r?.dataLimiteAjustada).toBe('2030-02-11');
    expect(r?.chegadaEstimada).toBe('2030-06-11');
  });

  it('emissao antes de hoje: avalia em hoje e marca antesDeHoje', () => {
    const r = dataLimiteAjustada({ fonte: fonte(), ocasioes: [], ruptura: '2030-03-01', hoje: HOJE });
    expect(r).toMatchObject({ antesDeHoje: true, emissaoAvaliada: HOJE, dataLimiteAjustada: '2029-11-21' });
    expect(r?.chegadaEstimada).toBe('2030-04-11');
  });

  it('lead time null = null', () => {
    expect(dataLimiteAjustada({ fonte: fonte({ leadTimeDays: null }), ocasioes: [], ruptura: RUPTURA, hoje: HOJE })).toBeNull();
  });
});

describe('propriedades (gerador deterministico)', () => {
  // LCG com semente fixa: sem Math.random, a suite e reproduzivel.
  function gerador(semente: number) {
    let estado = semente;
    return (maximo: number) => {
      estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
      return estado % maximo;
    };
  }

  const dataAleatoria = (sorteio: (n: number) => number) => {
    const mes = String(1 + sorteio(12)).padStart(2, '0');
    const dia = String(1 + sorteio(28)).padStart(2, '0');
    return `${2029 + sorteio(3)}-${mes}-${dia}`;
  };

  function sortear(sorteio: (n: number) => number): { f: FonteLeadTime; os: OcasiaoLeadTime[]; emissao: string } {
    const dias = () => (sorteio(6) === 0 ? null : sorteio(40));
    const f = fonte({
      id: 1 + sorteio(3),
      countryCode: sorteio(2) === 0 ? 'XA' : null,
      leadTimeDays: sorteio(8) === 0 ? 0 : 20 + sorteio(150),
      readinessDays: dias(),
      shippingDays: dias(),
      transitDays: dias(),
      clearanceDays: dias(),
    });
    const quantas = sorteio(6);
    const os: OcasiaoLeadTime[] = [];
    for (let i = 0; i < quantas; i += 1) {
      const inicio = dataAleatoria(sorteio);
      const fim = `${inicio.slice(0, 4)}-12-28`;
      const efeito = sorteio(2) === 0 ? 'dias' : 'percentual';
      os.push({
        id: 100 + i,
        escopo: FORECAST_OCASIAO_ESCOPOS[sorteio(3)],
        countryCode: 'XA',
        sourceId: 1 + sorteio(3),
        inicio,
        fim: fim >= inicio ? fim : inicio,
        recorrencia: FORECAST_OCASIAO_RECORRENCIAS[sorteio(2)],
        etapa: FORECAST_OCASIAO_ETAPAS[sorteio(5)],
        efeito,
        valor: efeito === 'dias' ? sorteio(30) : 1 + sorteio(100),
        ativa: sorteio(5) !== 0,
      });
    }
    return { f, os, emissao: dataAleatoria(sorteio) };
  }

  it('extraDias >= 0, ajustado = LT + extra, sem ocasioes = 0, deterministico e sem mutar entradas', () => {
    const sorteio = gerador(20301101);
    for (let i = 0; i < 250; i += 1) {
      const { f, os, emissao } = sortear(sorteio);
      Object.freeze(f);
      os.forEach((o) => Object.freeze(o));
      Object.freeze(os);

      const r = leadTimeAjustado(f, os, emissao);
      expect(r).not.toBeNull();
      expect(r!.extraDias).toBeGreaterThanOrEqual(0);
      expect(r!.leadTimeAjustado).toBe(f.leadTimeDays! + r!.extraDias);
      expect(r!.ocasioes.reduce((soma, o) => soma + o.dias, 0)).toBe(r!.extraDias);
      expect(leadTimeAjustado(f, os, emissao)).toEqual(r);
      expect(leadTimeAjustado(f, [], emissao)!.extraDias).toBe(0);

      const limite = dataLimiteAjustada({ fonte: f, ocasioes: os, ruptura: '2031-06-01', hoje: '2029-01-01' });
      expect(limite).not.toBeNull();
      expect(limite!.iteracoes).toBeGreaterThanOrEqual(1);
      expect(limite!.iteracoes).toBeLessThanOrEqual(3);
      expect(limite!.leadTimeAjustado).toBe(f.leadTimeDays! + limite!.extraDias);
    }
  });
});
