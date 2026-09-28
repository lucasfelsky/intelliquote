import { describe, expect, it } from 'vitest';
import { priceForComparison, sumQuoteItems } from '../src/utils/quoteBasket';
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
