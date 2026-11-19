import { describe, expect, it } from 'vitest';
import type { ComparisonResult, ExcludedComparisonResponse, QuoteResponse } from '@/services/quoteResponses';
import {
  calcularCelulas,
  celulaDoItem,
  contarMenores,
  deltaPercentual,
  formatarNumero,
  formatarUnidade,
  leadTimeDaResposta,
  menorPorLinha,
  menoresTotais,
  moedaDeReferencia,
  montarColunas,
  rotuloMoeda,
  simularMenorPorItem,
  subtituloDoItem,
  type ItemDaCotacao,
} from './comparacaoPorItemHelpers';

const itens: ItemDaCotacao[] = [
  { id: 1, itemCode: 'AC-01', productName: 'Ácido cítrico', description: 'Pó, saco 25 kg', quantity: 20000, unit: 'KG', targetPrice: 0.78 },
  { id: 2, itemCode: null, productName: 'Sulfato de zinco', description: null, quantity: 15000, unit: 'KG', targetPrice: null },
  { id: 3, itemCode: null, productName: 'Tripolifosfato', description: null, quantity: 25000, unit: 'KG', targetPrice: null },
];

function resposta(
  id: number,
  precos: Array<number | null | 'NA' | { p: number; q: number }>,
  extra: Partial<QuoteResponse> = {},
): QuoteResponse {
  return {
    id,
    quoteRequestId: 10,
    supplierId: 100 + id,
    offeredPrice: 0,
    currency: 'USD',
    exchangeRate: null,
    freightCost: 0,
    insuranceCost: 0,
    otherFees: 0,
    importDuty: 0,
    ipi: 0,
    pis: 0,
    cofins: 0,
    offeredIncoterm: 'CIF',
    paymentTermsDays: 60,
    leadTimeDays: null,
    notes: null,
    isWinner: false,
    totalLandedCost: 0,
    submittedAt: '',
    version: 1,
    createdAt: '',
    updatedAt: '',
    items: precos.flatMap((v, i) => {
      if (v === null) return [];
      const item = itens[i]!;
      const p = typeof v === 'object' ? v.p : v === 'NA' ? 0 : v;
      const q = typeof v === 'object' ? v.q : v === 'NA' ? 0 : item.quantity;
      return [
        {
          id: id * 10 + i,
          quoteResponseId: id,
          quoteRequestItemId: item.id,
          unitPrice: p,
          quantity: q,
          totalPrice: p * q,
          leadTimeDays: null,
          notes: null,
          isUnavailable: v === 'NA',
        },
      ];
    }),
    ...extra,
  };
}

function resultado(id: number, extra: Partial<ComparisonResult> = {}): ComparisonResult {
  return {
    quoteResponseId: id,
    supplierId: 100 + id,
    supplier: { id: 100 + id, name: `Forn ${id}` },
    currency: 'USD',
    offeredPrice: 1000 * id,
    offeredIncoterm: 'CIF',
    paymentTermsDays: 60,
    exchangeRate: null,
    freightCost: 0,
    insuranceCost: 0,
    otherFees: 0,
    importDutyRate: 0,
    ipiRate: 0,
    pisRate: 0,
    cofinsRate: 0,
    cifValue: 0,
    importDutyAmount: 0,
    ipiAmount: 0,
    pisCofinsAmount: 0,
    totalLandedCost: 0,
    priceScore: 0,
    paymentTermsScore: 0,
    incotermScore: 0,
    qualityScore: 0,
    totalScore: 100 - id,
    isWinner: id === 1,
    leadTimeDays: 40 + id,
    ...extra,
  };
}

function excluida(id: number, extra: Partial<ExcludedComparisonResponse> = {}): ExcludedComparisonResponse {
  return {
    quoteResponseId: id,
    supplierId: 100 + id,
    supplier: { id: 100 + id, name: `Forn ${id}` },
    creditSupportRequestId: null,
    creditPartner: null,
    reason: 'partial',
    unavailableItems: [],
    ...extra,
  };
}

describe('formatacao', () => {
  it('rotuloMoeda: USD vira US$, BRL vira R$, o resto fica com o codigo', () => {
    expect(rotuloMoeda('USD')).toBe('US$');
    expect(rotuloMoeda('BRL')).toBe('R$');
    expect(rotuloMoeda('EUR')).toBe('EUR');
    expect(rotuloMoeda(null)).toBe('');
  });

  it('formatarUnidade: KG vira kg', () => {
    expect(formatarUnidade('KG')).toBe('kg');
    expect(formatarUnidade(' Tn ')).toBe('tn');
  });

  it('formatarNumero: pt-BR com casas fixas e traco para invalido', () => {
    expect(formatarNumero(1234.5)).toBe('1.234,50');
    expect(formatarNumero(0.8, 1)).toBe('0,8');
    expect(formatarNumero(Number.NaN)).toBe('—');
    expect(formatarNumero(null)).toBe('—');
  });

  it('subtituloDoItem: codigo e descricao so com o que existe', () => {
    expect(subtituloDoItem(itens[0]!)).toBe('AC-01 · Pó, saco 25 kg');
    expect(subtituloDoItem({ itemCode: null, description: 'Só descrição' })).toBe('Só descrição');
    expect(subtituloDoItem({ itemCode: '', description: '  ' })).toBe('');
  });
});

describe('celulaDoItem', () => {
  it('devolve o unitario cotado, sem qtdCotada quando a quantidade bate', () => {
    expect(celulaDoItem(resposta(1, [0.76, 0.9, 1]), itens[0]!)).toEqual({ tipo: 'preco', unitario: 0.76, qtdCotada: null });
  });

  it('quantidade divergente: informa a quantidade cotada', () => {
    expect(celulaDoItem(resposta(1, [{ p: 0.26, q: 40000 }, 1, 1]), itens[0]!)).toEqual({
      tipo: 'preco',
      unitario: 0.26,
      qtdCotada: 40000,
    });
  });

  it('item marcado como indisponivel', () => {
    expect(celulaDoItem(resposta(1, ['NA', 1, 1]), itens[0]!)).toEqual({ tipo: 'indisponivel' });
  });

  it('sem linha para o item -> nao cotou', () => {
    expect(celulaDoItem(resposta(1, [0.7, 0.9, null]), itens[2]!)).toEqual({ tipo: 'nao-cotou' });
    expect(celulaDoItem(undefined, itens[0]!)).toEqual({ tipo: 'nao-cotou' });
  });

  it('preco 0 (ou negativo / nao finito) sem isUnavailable vira nao-cotou', () => {
    expect(celulaDoItem(resposta(1, [0, 1, 1]), itens[0]!)).toEqual({ tipo: 'nao-cotou' });
    expect(celulaDoItem(resposta(1, [-1, 1, 1]), itens[0]!)).toEqual({ tipo: 'nao-cotou' });
    expect(celulaDoItem(resposta(1, [Number.NaN, 1, 1]), itens[0]!)).toEqual({ tipo: 'nao-cotou' });
  });

  it('item duplicado na resposta: vale a primeira ocorrencia', () => {
    const r = resposta(1, [0.7, 1, 1]);
    r.items = [...(r.items ?? []), { ...r.items![0]!, id: 999, unitPrice: 0.1 }];
    expect(celulaDoItem(r, itens[0]!)).toMatchObject({ tipo: 'preco', unitario: 0.7 });
  });
});

describe('menorPorLinha e deltaPercentual', () => {
  it('menor ignora null, 0 e NaN', () => {
    expect(menorPorLinha([0.89, null, 0.76, 0, Number.NaN, undefined])).toBe(0.76);
    expect(menorPorLinha([null, 0])).toBeNull();
    expect(menorPorLinha([])).toBeNull();
  });

  it('delta: 0.89 sobre 0.76 da +17,1%', () => {
    expect(formatarNumero(deltaPercentual(0.89, 0.76), 1)).toBe('17,1');
    expect(deltaPercentual(1, 1)).toBe(0);
  });
});

describe('montarColunas', () => {
  const respostas = [
    resposta(1, [0.76, 0.89, 0.99]),
    resposta(2, [0.77, 0.91, 1]),
    resposta(3, [0.81, 0.9, 'NA'], { currency: 'USD', paymentTermsDays: 45, offeredIncoterm: 'FOB' }),
  ];

  it('ranqueadas na ordem do ranking e depois as fora do ranking', () => {
    const { colunas, temViaParceiro } = montarColunas({
      rankedResults: [resultado(1), resultado(2)],
      excluded: [excluida(3)],
      excludedWinnerKey: null,
      respostas,
      winnerBadgeLabel: 'Vencedora',
    });
    expect(temViaParceiro).toBe(false);
    expect(colunas.map((c) => [c.key, c.posicao, c.foraDoRanking])).toEqual([
      ['1:0', 1, false],
      ['2:0', 2, false],
      ['3:0', null, true],
    ]);
    expect(colunas[0]).toMatchObject({ vencedora: true, rotuloVencedora: 'Vencedora', total: 1000, incoterm: 'CIF', pagamentoDias: 60 });
    expect(colunas[1]).toMatchObject({ vencedora: false, rotuloVencedora: null, total: 2000 });
    expect(colunas[2]).toMatchObject({ total: null, incoterm: 'FOB', pagamentoDias: 45, moeda: 'USD' });
  });

  it('alternativa via parceiro sai das colunas, a posicao pula e temViaParceiro liga', () => {
    const { colunas, temViaParceiro } = montarColunas({
      rankedResults: [
        resultado(1, { creditSupportRequestId: 7, creditPartner: { id: 7, name: 'Parceiro' }, isWinner: true }),
        resultado(1, { isWinner: false }),
        resultado(2, { isWinner: false }),
      ],
      excluded: [excluida(3, { creditSupportRequestId: 9 })],
      excludedWinnerKey: null,
      respostas,
      winnerBadgeLabel: 'Vencedora',
    });
    expect(temViaParceiro).toBe(true);
    expect(colunas.map((c) => [c.key, c.posicao])).toEqual([
      ['1:0', 2],
      ['2:0', 3],
    ]);
    // o selo vai para a coluna isWinner; se a vencedora e via parceiro, nenhuma coluna o recebe
    expect(colunas.some((c) => c.vencedora)).toBe(false);
  });

  it('vencedora manual fora do ranking recebe o selo (rotulo do Ranking)', () => {
    const { colunas } = montarColunas({
      rankedResults: [resultado(1, { isWinner: false }), resultado(2, { isWinner: false })],
      excluded: [excluida(3)],
      excludedWinnerKey: '3:0',
      respostas,
      winnerBadgeLabel: 'Vencedora (escolha manual)',
    });
    expect(colunas.find((c) => c.key === '3:0')).toMatchObject({ vencedora: true, rotuloVencedora: 'Vencedora (escolha manual)' });
    expect(colunas.filter((c) => c.vencedora)).toHaveLength(1);
  });

  it('resposta fora do cache: a coluna existe, sem resposta; moeda cai para a do resultado', () => {
    const { colunas } = montarColunas({
      rankedResults: [resultado(1)],
      excluded: [excluida(3)],
      excludedWinnerKey: null,
      respostas: [],
      winnerBadgeLabel: 'Vencedora',
    });
    expect(colunas[0]).toMatchObject({ resposta: undefined, moeda: 'USD' });
    expect(colunas[1]).toMatchObject({ resposta: undefined, moeda: null, incoterm: null, leadTimeDias: null });
    expect(moedaDeReferencia(colunas)).toBe('USD');
  });
});

describe('leadTimeDaResposta', () => {
  it('maior leadTime dos itens nao indisponiveis; sem nenhum, o da resposta', () => {
    const r = resposta(3, [0.8, 0.9, 'NA']);
    r.items![0]!.leadTimeDays = 30;
    r.items![1]!.leadTimeDays = 55;
    r.items![2]!.leadTimeDays = 90; // indisponivel: ignorado
    expect(leadTimeDaResposta(r)).toBe(55);

    const semItens = resposta(4, [], { leadTimeDays: 62 });
    expect(leadTimeDaResposta(semItens)).toBe(62);
    expect(leadTimeDaResposta(resposta(5, [0.5, 0.5, 0.5]))).toBeNull();
    expect(leadTimeDaResposta(undefined)).toBeNull();
  });
});

describe('matriz: menores, totais, contagem e simulacao', () => {
  function colunasDe(respostas: QuoteResponse[], ranked: ComparisonResult[], excluded: ExcludedComparisonResponse[] = []) {
    return montarColunas({ rankedResults: ranked, excluded, excludedWinnerKey: null, respostas, winnerBadgeLabel: 'Vencedora' }).colunas;
  }

  it('empate no menor: todas as empatadas contam', () => {
    const colunas = colunasDe(
      [resposta(1, [0.77, 0.9, 1]), resposta(2, [0.77, 0.95, 1.1])],
      [resultado(1), resultado(2)],
    );
    const celulas = calcularCelulas(itens, colunas);
    const ref = moedaDeReferencia(colunas);
    const contagem = contarMenores(celulas, colunas, ref);
    expect(contagem.get('1:0')).toBe(3); // item 1 (empate), 2 e 3
    expect(contagem.get('2:0')).toBe(1); // so o empate do item 1
  });

  it('coluna em outra moeda fica fora do menor e da contagem', () => {
    const colunas = colunasDe(
      [resposta(1, [0.9, 0.9, 0.9]), resposta(2, [0.5, 0.5, 0.5], { currency: 'BRL' })],
      [resultado(1), resultado(2)],
    );
    const celulas = calcularCelulas(itens, colunas);
    const contagem = contarMenores(celulas, colunas, 'USD');
    expect(contagem.get('1:0')).toBe(3);
    expect(contagem.get('2:0')).toBeNull();
  });

  it('menoresTotais: empates incluidos e fora do ranking nunca entra', () => {
    const colunas = colunasDe(
      [resposta(1, [1, 1, 1]), resposta(2, [1, 1, 1]), resposta(3, [1, 1, 1])],
      [resultado(1, { offeredPrice: 500 }), resultado(2, { offeredPrice: 500 }), resultado(4, { offeredPrice: 900 })],
      [excluida(3)],
    );
    expect([...menoresTotais(colunas)].sort()).toEqual(['1:0', '2:0']);
  });

  it('simularMenorPorItem: soma pelo menor x quantidade pedida; desempate pela ordem das colunas', () => {
    const colunas = colunasDe(
      [resposta(1, [0.76, 0.89, 0.99]), resposta(2, [0.77, 0.89, 1])],
      [resultado(1), resultado(2)],
    );
    const sim = simularMenorPorItem(itens, colunas, 'USD');
    // 0.76*20000 + 0.89*15000 + 0.99*25000
    expect(sim.soma).toBe(15200 + 13350 + 24750);
    // o item 2 empata e fica com a coluna 1 (mais bem ranqueada): 1 fornecedor so
    expect(sim.fornecedores).toBe(1);
    expect(sim.itensSemPreco).toEqual([]);
  });

  it('simularMenorPorItem: itens de fornecedores diferentes contam 2 fornecedores', () => {
    const colunas = colunasDe(
      [resposta(1, [0.76, 0.95, 1]), resposta(2, [0.8, 0.9, 1.1])],
      [resultado(1), resultado(2)],
    );
    const sim = simularMenorPorItem(itens, colunas, 'USD');
    expect(sim.fornecedores).toBe(2);
    expect(sim.soma).toBe(Math.round((0.76 * 20000 + 0.9 * 15000 + 1 * 25000) * 100) / 100);
  });

  it('simularMenorPorItem: item sem preco em nenhuma coluna vai para itensSemPreco e a soma some', () => {
    const colunas = colunasDe(
      [resposta(1, [0.76, 0.95, null]), resposta(2, [0.8, 0.9, 'NA'])],
      [resultado(1), resultado(2)],
    );
    const sim = simularMenorPorItem(itens, colunas, 'USD');
    expect(sim.itensSemPreco).toEqual(['Tripolifosfato']);
    expect(sim.soma).toBeNull();
  });

  it('simularMenorPorItem: coluna em outra moeda nao entra', () => {
    const colunas = colunasDe(
      [resposta(1, [0.9, 0.9, 0.9]), resposta(2, [0.1, 0.1, 0.1], { currency: 'BRL' })],
      [resultado(1), resultado(2)],
    );
    const sim = simularMenorPorItem(itens, colunas, 'USD');
    expect(sim.fornecedores).toBe(1);
    expect(sim.soma).toBe(Math.round(0.9 * 60000 * 100) / 100);
  });
});
