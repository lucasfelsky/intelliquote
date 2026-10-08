import { describe, expect, it } from 'vitest';
import { buildDangerousGoodItems } from '../src/utils/dangerousGoods';

describe('buildDangerousGoodItems', () => {
  it('lista so itens marcados como DG, com o nome do produto', () => {
    expect(
      buildDangerousGoodItems([
        { quoteRequestItemId: 1, isDangerousGood: true, quoteRequestItem: { productName: 'Acetona' } },
        { quoteRequestItemId: 2, isDangerousGood: false, quoteRequestItem: { productName: 'Agua' } },
      ]),
    ).toEqual([{ quoteRequestItemId: 1, productName: 'Acetona' }]);
  });

  it('item indisponivel nunca conta como DG, mesmo com a flag inconsistente', () => {
    expect(
      buildDangerousGoodItems([
        {
          quoteRequestItemId: 1,
          isDangerousGood: true,
          isUnavailable: true,
          quoteRequestItem: { productName: 'Acetona' },
        },
      ]),
    ).toEqual([]);
  });

  it('ausente/null/undefined trata como nao DG (respostas e revisoes antigas)', () => {
    expect(buildDangerousGoodItems(undefined)).toEqual([]);
    expect(buildDangerousGoodItems(null)).toEqual([]);
    expect(
      buildDangerousGoodItems([
        { quoteRequestItemId: 1, quoteRequestItem: { productName: 'A' } },
        { quoteRequestItemId: 2, isDangerousGood: null, quoteRequestItem: { productName: 'B' } },
      ]),
    ).toEqual([]);
  });

  it('sem nome do produto usa string vazia (a UI cai para "Item <id>")', () => {
    expect(buildDangerousGoodItems([{ quoteRequestItemId: 9, isDangerousGood: true }])).toEqual([
      { quoteRequestItemId: 9, productName: '' },
    ]);
  });
});
