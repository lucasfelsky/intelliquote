import { describe, expect, it } from 'vitest';
import type { ForecastLinha, ForecastMonths } from '@/services/forecast';
import type { ForecastDecisao } from '@/services/forecastDecisoes';
import {
  colunasComDecisoes,
  dataCurtaEmSaoPaulo,
  dicaDaDecisao,
  ID_COLUNA_ANALISE,
  textoDaDecisao,
} from './forecastAnaliseDecidida';
import { colunasDoPainel, STATUS_ROTULO, type ColunaPainel } from './forecastPainel';

// Dados 100% sinteticos.
function linha(over: Partial<ForecastLinha> = {}): ForecastLinha {
  return {
    linha: 3,
    O: 100,
    P: 50,
    Q: 100,
    R: 90,
    S: 80,
    T: 10,
    U: 500,
    chegadas: [0, 0, 0, 0, 0],
    AA: 5,
    programacoes: [0, 0, 0, 0],
    AG: 100,
    projecao: [400, 300, 200, 100, 50, 20],
    AN: 200,
    AQ: 30,
    AP: '2026-11-20',
    AR: 0,
    AS: 0,
    item: 'PRODUTO A',
    codigos: ['C0001', 'C0002'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: null,
    productId: null,
    n: 1,
    historico: [10, 20, 30, 40, 50],
    obs: '',
    precoFixo: false,
    ...over,
  };
}

const MONTHS: ForecastMonths = {
  consumo: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

function decisao(over: Partial<ForecastDecisao> = {}): ForecastDecisao {
  return {
    productId: 42,
    quantidadeKg: 1600.5,
    status: 'cotando',
    observacao: null,
    sugeridaKg: 1000,
    demandaKg: 200,
    decididaPorId: 1,
    criadaEm: '2026-10-26T17:30:00.000Z',
    atualizadaEm: '2026-10-26T17:30:00.000Z',
    ...over,
  };
}

function mapaDe(...ds: ForecastDecisao[]): ReadonlyMap<number, ForecastDecisao> {
  return new Map(ds.map((d) => [d.productId, d]));
}

function colunaAnalise(colunas: ColunaPainel[]): ColunaPainel {
  const c = colunas.find((x) => x.id === ID_COLUNA_ANALISE);
  if (!c) throw new Error('coluna ANALISE FORECAST ausente');
  return c;
}

const BASE = colunasDoPainel(MONTHS, { ocultas: false });

describe('colunasComDecisoes - com decisao', () => {
  it('mostra a quantidade decidida, com o ponto do status e a classe forte', () => {
    const c = colunaAnalise(colunasComDecisoes(BASE, mapaDe(decisao())));
    const l = linha({ productId: 42 });
    expect(c.texto(l)).toBe('1.600,5');
    expect(c.destaque?.(l)).toContain('fcad-decidida');
    expect(c.destaque?.(l)).toContain('fcad-decidida--cotando');
    expect(c.classe?.(l)).toContain('fc-cell--forte');
  });

  it('decisao 0 e "0,0" (decidiu nao comprar), nunca "-"', () => {
    const c = colunaAnalise(colunasComDecisoes(BASE, mapaDe(decisao({ quantidadeKg: 0 }))));
    const l = linha({ productId: 42 });
    expect(c.texto(l)).toBe('0,0');
    expect(c.destaque?.(l)).toContain('fcad-decidida');
  });

  it('a decisao vence o valor congelado', () => {
    const c = colunaAnalise(colunasComDecisoes(BASE, mapaDe(decisao({ quantidadeKg: 10 }))));
    expect(c.texto(linha({ productId: 42, analiseForecast: 999 }))).toBe('10,0');
  });

  it('o ponto usa o status da DECISAO, nao o da linha congelada', () => {
    const c = colunaAnalise(colunasComDecisoes(BASE, mapaDe(decisao({ status: 'po' }))));
    expect(c.destaque?.(linha({ productId: 42, status: 'nao' }))).toContain('fcad-decidida--po');
  });
});

describe('colunasComDecisoes - sem decisao', () => {
  const mapa = mapaDe(decisao());

  it('igual ao congelado: numero formatado e "-" quando nulo', () => {
    const c = colunaAnalise(colunasComDecisoes(BASE, mapa));
    expect(c.texto(linha({ productId: 7, analiseForecast: 1234.5 }))).toBe('1.234,5');
    expect(c.texto(linha({ productId: 7, analiseForecast: null }))).toBe('-');
  });

  it('sem destaque, sem titulo e sem texto acessivel', () => {
    const c = colunaAnalise(colunasComDecisoes(BASE, mapa));
    const l = linha({ productId: 7, analiseForecast: 1234.5 });
    expect(c.destaque?.(l) ?? '').toBe('');
    expect(c.titulo?.(l)).toBeUndefined();
    expect(c.textoAcessivel?.(l)).toBeUndefined();
    expect(c.classe?.(l)).toBe('fc-cell--forte');
  });

  it('productId nulo com mapa contendo outros ids: congelado', () => {
    const c = colunaAnalise(colunasComDecisoes(BASE, mapa));
    expect(c.texto(linha({ productId: null, analiseForecast: 50 }))).toBe('50,0');
    expect(c.textoAcessivel?.(linha({ productId: null }))).toBeUndefined();
  });
});

describe('colunasComDecisoes - estrutura', () => {
  it('mapa null devolve o mesmo array', () => {
    expect(colunasComDecisoes(BASE, null)).toBe(BASE);
  });

  it('so a ANALISE FORECAST muda; as demais mantem a referencia', () => {
    const novas = colunasComDecisoes(BASE, mapaDe(decisao()));
    expect(novas).toHaveLength(BASE.length);
    novas.forEach((c, i) => {
      if (c.id === ID_COLUNA_ANALISE) expect(c).not.toBe(BASE[i]);
      else expect(c).toBe(BASE[i]);
    });
    expect(novas.map((c) => c.id)).toEqual(BASE.map((c) => c.id));
  });
});

describe('dicaDaDecisao', () => {
  it('data em Sao Paulo (17:30Z do dia 26 = 26/10)', () => {
    expect(dicaDaDecisao(decisao({ atualizadaEm: '2026-10-26T17:30:00.000Z' }))).toContain('decidida em 26/10');
  });

  it('02:00Z do dia 27 ainda e 26/10 em Sao Paulo (ISO daria 27)', () => {
    expect(dicaDaDecisao(decisao({ atualizadaEm: '2026-10-27T02:00:00.000Z' }))).toContain('decidida em 26/10');
  });

  it('quantidade e status em portugues', () => {
    const d = decisao({ status: 'confirmado' });
    const dica = dicaDaDecisao(d);
    expect(dica).toContain('Qtd. decidida pelo comprador: 1.600,5 kg');
    expect(dica).toContain(STATUS_ROTULO.confirmado);
  });

  it('a observacao so entra quando existe', () => {
    expect(dicaDaDecisao(decisao({ observacao: 'OBS SINTETICA' }))).toContain('Obs.: OBS SINTETICA');
    expect(dicaDaDecisao(decisao({ observacao: null }))).not.toContain('Obs.');
    expect(dicaDaDecisao(decisao({ observacao: '' }))).not.toContain('Obs.');
  });

  it('data invalida omite o trecho "decidida em"', () => {
    expect(dicaDaDecisao(decisao({ atualizadaEm: 'invalida' }))).not.toContain('decidida em');
  });

  it('titulo e texto acessivel da celula usam a mesma dica', () => {
    const d = decisao({ observacao: 'OBS SINTETICA' });
    const c = colunaAnalise(colunasComDecisoes(BASE, mapaDe(d)));
    const l = linha({ productId: 42 });
    expect(c.titulo?.(l)).toBe(dicaDaDecisao(d));
    expect(c.textoAcessivel?.(l)).toBe(` — ${dicaDaDecisao(d)}`);
  });
});

describe('textoDaDecisao e dataCurtaEmSaoPaulo', () => {
  it('formata 1 casa pt-BR e 0 como 0,0', () => {
    expect(textoDaDecisao(1600)).toBe('1.600,0');
    expect(textoDaDecisao(0)).toBe('0,0');
  });

  it('dd/mm no fuso de Sao Paulo; invalido = vazio', () => {
    expect(dataCurtaEmSaoPaulo('2026-11-01T02:59:59Z')).toBe('31/10');
    expect(dataCurtaEmSaoPaulo('2026-11-01T03:00:00Z')).toBe('01/11');
    expect(dataCurtaEmSaoPaulo('xx')).toBe('');
  });
});
