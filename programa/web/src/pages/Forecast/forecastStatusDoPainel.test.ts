import { describe, expect, it } from 'vitest';
import type { ForecastLinha, ForecastStatus } from '@/services/forecast';
import type { ForecastCotacaoVinculada, ForecastDecisao } from '@/services/forecastDecisoes';
import { STATUS_ROTULO } from './forecastPainel';
import { statusDaLinha, statusDoPainel, statusDoPainelPorLinha } from './forecastTrackingRegras';

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
    codigos: ['C0001'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: null,
    productId: 42,
    n: 1,
    historico: [10, 20, 30, 40, 50],
    obs: '',
    precoFixo: false,
    ...over,
  };
}

function cotacao(statusCotacao: ForecastCotacaoVinculada['statusCotacao']): ForecastCotacaoVinculada {
  return { id: 1, requestCode: 'AO/UV-17112026', statusCotacao };
}

function decisao(over: Partial<ForecastDecisao> = {}): ForecastDecisao {
  return {
    productId: 42,
    quantidadeKg: 1600,
    status: 'cotando',
    observacao: null,
    sugeridaKg: 40,
    demandaKg: -40,
    decididaPorId: 1,
    criadaEm: '2026-10-26T17:30:00.000Z',
    atualizadaEm: '2026-10-26T17:30:00.000Z',
    ...over,
  };
}

describe('statusDoPainel', () => {
  const casos: Array<{
    nome: string;
    congelado: ForecastStatus;
    decisao: ForecastDecisao | undefined;
    classe: ForecastStatus;
    rotulo: string;
  }> = [
    { nome: 'sem decisao, congelado "nao"', congelado: 'nao', decisao: undefined, classe: 'nao', rotulo: 'Cotação não enviada' },
    { nome: 'sem decisao, congelado "cotando"', congelado: 'cotando', decisao: undefined, classe: 'cotando', rotulo: 'Cotando' },
    {
      nome: 'decisao SEM cotacao com status "po" segue o congelado (paridade com o relatorio)',
      congelado: 'nao',
      decisao: decisao({ status: 'po' }),
      classe: 'nao',
      rotulo: 'Cotação não enviada',
    },
    {
      nome: 'cotacao enviada + statusDerivado "cotando"',
      congelado: 'nao',
      decisao: decisao({ cotacao: cotacao('enviada'), statusDerivado: 'cotando' }),
      classe: 'cotando',
      rotulo: 'Cotando',
    },
    {
      nome: 'cotacao po_enviada sem statusDerivado (backend antigo) vira "po"',
      congelado: 'nao',
      decisao: decisao({ cotacao: cotacao('po_enviada') }),
      classe: 'po',
      rotulo: 'PO enviada',
    },
    {
      nome: 'statusDerivado "preco" com cotacao fechada nao regride',
      congelado: 'nao',
      decisao: decisao({ cotacao: cotacao('fechada'), statusDerivado: 'preco' }),
      classe: 'preco',
      rotulo: STATUS_ROTULO.preco,
    },
    {
      nome: 'statusDerivado "cotacao_criada" cai na classe "nao" com o rotulo do relatorio',
      congelado: 'nao',
      decisao: decisao({ cotacao: cotacao('criada'), statusDerivado: 'cotacao_criada' }),
      classe: 'nao',
      rotulo: 'Cotação criada',
    },
    {
      nome: 'cotacao criada sem statusDerivado (backend antigo) tambem vira "Cotação criada"',
      congelado: 'nao',
      decisao: decisao({ cotacao: cotacao('criada') }),
      classe: 'nao',
      rotulo: 'Cotação criada',
    },
  ];

  it.each(casos)('$nome', ({ congelado, decisao: d, classe, rotulo }) => {
    const r = statusDoPainel(congelado, d);
    expect(r.classe).toBe(classe);
    expect(r.rotulo).toBe(rotulo);
    // paridade: o rotulo e exatamente o que o relatorio mostra
    expect(r.rotulo).toBe(statusDaLinha(congelado, d, false).rotulo);
  });
});

describe('statusDoPainelPorLinha', () => {
  it('sem decisoes carregadas (mapa nulo) devolve null', () => {
    expect(statusDoPainelPorLinha([linha()], null)).toBeNull();
  });

  it('chaveia por linha.linha; linha sem productId ou sem decisao fica com o congelado', () => {
    const linhas = [
      linha({ linha: 3, productId: 42, status: 'nao' }),
      linha({ linha: 4, productId: null, status: 'cotando' }),
      linha({ linha: 5, productId: 77, status: 'po' }),
    ];
    const mapa = new Map<number, ForecastDecisao>([
      [42, decisao({ productId: 42, cotacao: cotacao('enviada'), statusDerivado: 'cotando' })],
      // decisao vinculada a produto sem linha com productId: nao pode vazar para a linha 4
      [0, decisao({ productId: 0, cotacao: cotacao('po_enviada'), statusDerivado: 'po' })],
    ]);
    const r = statusDoPainelPorLinha(linhas, mapa)!;
    expect(Array.from(r.keys())).toEqual([3, 4, 5]);
    expect(r.get(3)).toEqual({ classe: 'cotando', rotulo: 'Cotando' });
    expect(r.get(4)).toEqual({ classe: 'cotando', rotulo: 'Cotando' });
    expect(r.get(5)).toEqual({ classe: 'po', rotulo: 'PO enviada' });
  });
});
