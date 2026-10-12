import { describe, expect, it } from 'vitest';
import {
  classifyForComparison,
  describePartialBasket,
  isInconsistentBasket,
  priceAtRequestedQuantity,
  priceForComparison,
  sumQuoteItems,
} from '../src/utils/quoteBasket';
import { QuoteComparisonService } from '../src/services/QuoteComparisonService';

const requested = [{ id: 1, quantity: 10 }, { id: 2, quantity: 2 }];
const items = [
  { quoteRequestItemId: 1, quantity: 10, unitPrice: 3.25 },
  { quoteRequestItemId: 2, quantity: 2, unitPrice: 10 },
];
describe('Comparação pela cesta completa', () => {
  it('recalcula propostas antigas pelo preço × quantidade de todos os itens', () => {
    expect(priceForComparison(requested, { id: 5, offeredPrice: 3.25, items })).toBe(52.5);
    expect(priceForComparison(requested, { id: 5, offeredPrice: 999, items: [...items].reverse() })).toBe(52.5);
  });

  it.each([
    items.slice(0, 1),
    [],
    [items[0], { ...items[1], quantity: 1 }],
    [items[0], { ...items[1], quoteRequestItemId: 99 }],
    [items[0], items[0]],
  ])('impede comparar uma cesta incompleta, duplicada ou diferente: %j', (invalid) => {
    expect(() => priceForComparison(requested, { id: 5, offeredPrice: 1, items: invalid })).toThrow();
  });

  it('preserva o contrato agregado apenas nas cotações legadas sem itens', () => {
    expect(priceForComparison([], { id: 5, offeredPrice: '123.45' })).toBe(123.45);
  });

  it('rejeita quantidades zeradas e não arredonda cada multiplicação prematuramente', () => {
    expect(() => sumQuoteItems([{ ...items[0], quantity: 0 }])).toThrow();
    expect(sumQuoteItems([{ ...items[0], quantity: 3, unitPrice: 0.1 }])).toBe(0.3);
  });

  it('mantém a conversão apenas no snapshot da alçada e bloqueia moedas mistas no ranking', () => {
    const base = { id: 1, quoteRequestId: 1, supplierId: 1, offeredIncoterm: 'FOB' as const,
      paymentTermsDays: 30, freightCost: 0, insuranceCost: 0, otherFees: 0,
      importDutyRate: 0, ipiRate: 0, pisRate: 0, cofinsRate: 0 };
    const proposals = [
      { ...base, offeredPrice: 21, currency: 'USD', exchangeRate: 5 },
      { ...base, id: 2, supplierId: 2, offeredPrice: 100, currency: 'BRL', exchangeRate: 5 },
    ];
    expect(proposals.map(p => QuoteComparisonService.calculateLandedCost(p).totalLandedCost)).toEqual([105, 100]);
    expect(() => QuoteComparisonService.compareResponses(proposals)).toThrow('mesma moeda');
  });
});

describe('classifyForComparison (item temporariamente indisponivel)', () => {
  const unavailable = (id: number) => ({
    quoteRequestItemId: id,
    quantity: 0,
    unitPrice: 0,
    isUnavailable: true,
  });

  it('proposta completa sem flag: complete com o preco da cesta (regra atual)', () => {
    expect(classifyForComparison(requested, { id: 5, offeredPrice: 1, items })).toEqual({
      kind: 'complete',
      price: 52.5,
    });
  });

  it('legado sem itens segue no contrato agregado', () => {
    expect(classifyForComparison([], { id: 5, offeredPrice: '123.45' })).toEqual({
      kind: 'complete',
      price: 123.45,
    });
  });

  it('disponiveis + indisponiveis cobrindo exatamente a cesta: unavailable (fora do ranking)', () => {
    expect(
      classifyForComparison(requested, {
        id: 5,
        offeredPrice: 32.5,
        items: [items[0], unavailable(2)],
      }),
    ).toEqual({ kind: 'unavailable', unavailableItemIds: [2] });
    expect(
      classifyForComparison(requested, {
        id: 6,
        offeredPrice: 0,
        items: [unavailable(1), unavailable(2)],
      }),
    ).toEqual({ kind: 'unavailable', unavailableItemIds: [1, 2] });
  });

  const noDetails = { missingItemIds: [], quantityMismatches: [], extraItemIds: [], duplicateItemIds: [] };

  it('item faltando (com flag em outro): partial com missingItemIds e os indisponiveis', () => {
    expect(classifyForComparison(requested, { id: 5, offeredPrice: 1, items: [unavailable(1)] })).toEqual({
      kind: 'partial',
      details: { ...noDetails, missingItemIds: [2] },
      unavailableItemIds: [1],
    });
  });

  it('item fora da cesta: partial com extraItemIds (e o item pedido que ficou faltando)', () => {
    expect(
      classifyForComparison(requested, { id: 5, offeredPrice: 1, items: [items[0], unavailable(99)] }),
    ).toEqual({
      kind: 'partial',
      details: { ...noDetails, missingItemIds: [2], extraItemIds: [99] },
      unavailableItemIds: [99],
    });
  });

  it('duplicata: partial com duplicateItemIds', () => {
    expect(
      classifyForComparison(requested, { id: 5, offeredPrice: 1, items: [items[0], unavailable(1)] }),
    ).toEqual({
      kind: 'partial',
      details: { ...noDetails, missingItemIds: [2], duplicateItemIds: [1] },
      unavailableItemIds: [1],
    });
  });

  it('item extra alem da cesta completa: partial com extraItemIds', () => {
    expect(
      classifyForComparison(requested, { id: 5, offeredPrice: 1, items: [items[0], items[1], unavailable(3)] }),
    ).toEqual({
      kind: 'partial',
      details: { ...noDetails, extraItemIds: [3] },
      unavailableItemIds: [3],
    });
  });

  it('quantidade divergente no item disponivel + item indisponivel: segue unavailable (fora do ranking)', () => {
    expect(
      classifyForComparison(requested, {
        id: 5,
        offeredPrice: 1,
        items: [{ ...items[0], quantity: 9 }, unavailable(2)],
      }),
    ).toEqual({ kind: 'unavailable', unavailableItemIds: [2] });
  });

  it('proposta parcial SEM flag: partial com missingItemIds e sem indisponiveis (nao lanca mais 400)', () => {
    expect(
      classifyForComparison(requested, { id: 5, offeredPrice: 1, items: items.slice(0, 1) }),
    ).toEqual({
      kind: 'partial',
      details: { ...noDetails, missingItemIds: [2] },
      unavailableItemIds: [],
    });
  });

  it('item faltando E quantidade divergente nos presentes: mesmo tratamento de item faltando', () => {
    expect(
      classifyForComparison(requested, { id: 5, offeredPrice: 1, items: [{ ...items[0], quantity: 8 }] }),
    ).toEqual({
      kind: 'partial',
      details: {
        ...noDetails,
        missingItemIds: [2],
        quantityMismatches: [{ quoteRequestItemId: 1, requested: 10, offered: 8 }],
      },
      unavailableItemIds: [],
    });
  });

  it('isInconsistentBasket: so item extra ou duplicado (item faltando pode ser escolhida manualmente)', () => {
    expect(isInconsistentBasket({ ...noDetails, missingItemIds: [2] })).toBe(false);
    expect(isInconsistentBasket({ ...noDetails, extraItemIds: [9] })).toBe(true);
    expect(isInconsistentBasket({ ...noDetails, duplicateItemIds: [1] })).toBe(true);
  });
});

describe('classifyForComparison (quantidade divergente entra no ranking)', () => {
  it('todos os itens presentes com quantidade diferente: adjusted com unitario cotado x quantidade PEDIDA', () => {
    // 3.25 x 10 (pedido, nao 8) + 10 x 2 (pedido, nao 3) = 52.5
    expect(
      classifyForComparison(requested, {
        id: 5,
        offeredPrice: 999,
        items: [{ ...items[0], quantity: 8 }, { ...items[1], quantity: 3 }],
      }),
    ).toEqual({
      kind: 'adjusted',
      price: 52.5,
      quantityMismatches: [
        { quoteRequestItemId: 1, requested: 10, offered: 8 },
        { quoteRequestItemId: 2, requested: 2, offered: 3 },
      ],
    });
  });

  it('priceAtRequestedQuantity ignora indisponiveis/fora da cesta e rejeita preco invalido', () => {
    expect(priceAtRequestedQuantity(requested, [{ ...items[0], quantity: 1 }])).toBe(32.5);
    expect(
      priceAtRequestedQuantity(requested, [
        { ...items[0], quantity: 1 },
        { quoteRequestItemId: 2, quantity: 0, unitPrice: 0, isUnavailable: true },
        { quoteRequestItemId: 99, quantity: 5, unitPrice: 100 },
      ]),
    ).toBe(32.5);
    expect(() => priceAtRequestedQuantity(requested, [{ ...items[0], unitPrice: 0 }])).toThrow(/invalidos/);
    // priceForComparison segue intacto: quantidade diferente continua 400 nele.
    expect(() =>
      priceForComparison(requested, { id: 5, offeredPrice: 1, items: [{ ...items[0], quantity: 8 }, items[1]] }),
    ).toThrow(/informe todos os itens/);
  });

  it('describePartialBasket monta so as partes presentes, em portugues, separadas por "; "', () => {
    const names: Record<number, string> = { 1: 'Resina', 2: 'Catalisador', 3: 'Solvente' };
    const nameOf = (id: number) => names[id] ?? `#${id}`;
    expect(
      describePartialBasket(
        {
          missingItemIds: [2],
          quantityMismatches: [{ quoteRequestItemId: 1, requested: 10, offered: 8 }],
          extraItemIds: [99],
          duplicateItemIds: [3],
        },
        nameOf,
      ),
    ).toBe(
      'faltam itens: Catalisador; quantidade diferente em Resina (pedido 10, cotado 8); item nao pertence mais a cotacao: #99; item duplicado: Solvente',
    );
    expect(
      describePartialBasket(
        { missingItemIds: [1, 2], quantityMismatches: [], extraItemIds: [], duplicateItemIds: [] },
        nameOf,
      ),
    ).toBe('faltam itens: Resina, Catalisador');
  });
});
