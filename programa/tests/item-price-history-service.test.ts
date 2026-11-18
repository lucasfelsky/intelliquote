import { describe, expect, it } from 'vitest';
import {
  ITEM_PRICE_HISTORY_MAX_ENTRIES,
  buildItemPriceHistoryEntries,
  type ItemPriceHistoryResponseInput,
  type ItemPriceHistoryTarget,
} from '../src/services/ItemPriceHistoryService';

const TARGETS: ItemPriceHistoryTarget[] = [
  { id: 10, quoteRequestId: 1, unit: 'KG' },
  { id: 20, quoteRequestId: 2, unit: 'KG' },
  { id: 30, quoteRequestId: 3, unit: 'TON' },
];

function snapItem(id: number, unitPrice: string, extra: Record<string, unknown> = {}) {
  return {
    quoteRequestItemId: id,
    unitPrice,
    quantity: 100,
    totalPrice: (Number(unitPrice) * 100).toFixed(2),
    isUnavailable: false,
    incotermPrices: null,
    ...extra,
  };
}

function response(
  over: Partial<ItemPriceHistoryResponseInput> & Pick<ItemPriceHistoryResponseInput, 'id'>,
): ItemPriceHistoryResponseInput {
  return {
    quoteRequestId: 1,
    requestCode: 'COT-1',
    supplierId: 7,
    supplierName: 'Forn A',
    submittedAt: new Date('2026-10-01T12:00:00.000Z'),
    currency: 'USD',
    offeredIncoterm: 'FOB',
    snapshots: [],
    items: [],
    ...over,
  };
}

function snap(id: number, at: string, items: unknown[], over: Record<string, unknown> = {}) {
  return {
    id,
    recordedAt: new Date(at),
    source: 'portal',
    currency: 'USD',
    offeredIncoterm: 'FOB',
    items,
    ...over,
  };
}

describe('buildItemPriceHistoryEntries', () => {
  it('colapsa snapshots em que o preco DESTE item nao mudou (mudou so outro item)', () => {
    const { entries } = buildItemPriceHistoryEntries({
      currentQuoteRequestId: 1,
      targets: TARGETS,
      responses: [
        response({
          id: 1,
          snapshots: [
            snap(1, '2026-10-12T10:00:00Z', [snapItem(10, '5.00'), snapItem(11, '9.00')]),
            snap(2, '2026-10-13T10:00:00Z', [snapItem(10, '5.00'), snapItem(11, '8.00')]),
            snap(3, '2026-10-14T10:00:00Z', [snapItem(10, '5.50'), snapItem(11, '8.00')]),
          ],
        }),
      ],
    });

    expect(entries.map((e) => e.unitPrice)).toEqual(['5.50', '5.00']);
  });

  it('calcula variacao por serie (fornecedor+moeda+incoterm+unidade) com 2 casas; null na primeira e anterior zero', () => {
    const { entries } = buildItemPriceHistoryEntries({
      currentQuoteRequestId: 1,
      targets: TARGETS,
      responses: [
        response({
          id: 1,
          snapshots: [
            snap(1, '2026-10-12T10:00:00Z', [snapItem(10, '10.00')]),
            snap(2, '2026-10-13T10:00:00Z', [snapItem(10, '10.32')]),
            snap(3, '2026-10-14T10:00:00Z', [snapItem(10, '10.21')]),
          ],
        }),
        response({
          id: 2,
          supplierId: 8,
          supplierName: 'Forn B',
          snapshots: [
            snap(4, '2026-10-12T11:00:00Z', [snapItem(10, '0.00')]),
            snap(5, '2026-10-13T11:00:00Z', [snapItem(10, '2.00')]),
          ],
        }),
      ],
    });

    const a = entries.filter((e) => e.supplierId === 7);
    expect(a.map((e) => e.variationPct)).toEqual([-1.07, 3.2, null]);
    const b = entries.filter((e) => e.supplierId === 8);
    expect(b.map((e) => e.variationPct)).toEqual([null, null]);
  });

  it('separa a serie por moeda, incoterm e unidade (nunca compara KG com TON)', () => {
    const { entries } = buildItemPriceHistoryEntries({
      currentQuoteRequestId: 1,
      targets: TARGETS,
      responses: [
        response({
          id: 1,
          snapshots: [
            snap(1, '2026-10-12T10:00:00Z', [snapItem(10, '10.00')]),
            snap(2, '2026-10-13T10:00:00Z', [snapItem(10, '12.00')], { currency: 'EUR' }),
            snap(3, '2026-10-14T10:00:00Z', [snapItem(10, '14.00')], { offeredIncoterm: 'CIF' }),
          ],
        }),
        response({
          id: 2,
          quoteRequestId: 3,
          requestCode: 'COT-3',
          snapshots: [snap(4, '2026-10-15T10:00:00Z', [snapItem(30, '900.00')])],
        }),
      ],
    });

    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.variationPct === null)).toBe(true);
    expect(entries.find((e) => e.requestCode === 'COT-3')?.unit).toBe('TON');
  });

  it('item indisponivel fica fora e a volta do mesmo preco gera nova linha', () => {
    const { entries } = buildItemPriceHistoryEntries({
      currentQuoteRequestId: 1,
      targets: TARGETS,
      responses: [
        response({
          id: 1,
          snapshots: [
            snap(1, '2026-10-12T10:00:00Z', [snapItem(10, '5.00')]),
            snap(2, '2026-10-13T10:00:00Z', [snapItem(10, '0.00', { isUnavailable: true })]),
            snap(3, '2026-10-14T10:00:00Z', [snapItem(10, '5.00')]),
          ],
        }),
      ],
    });

    expect(entries.map((e) => e.recordedAt.toISOString())).toEqual([
      '2026-10-14T10:00:00.000Z',
      '2026-10-12T10:00:00.000Z',
    ]);
  });

  it('resposta sem snapshot usa o estado atual com origem "legado" e submittedAt', () => {
    const { entries } = buildItemPriceHistoryEntries({
      currentQuoteRequestId: 1,
      targets: TARGETS,
      responses: [
        response({
          id: 1,
          offeredIncoterm: 'CFR',
          currency: 'EUR',
          items: [
            { quoteRequestItemId: 10, unitPrice: '4.20', quantity: 50, isUnavailable: false, incotermPrices: null },
            { quoteRequestItemId: 20, unitPrice: '0.00', quantity: 0, isUnavailable: true, incotermPrices: null },
            { quoteRequestItemId: 99, unitPrice: '1.00', quantity: 1, isUnavailable: false, incotermPrices: null },
          ],
        }),
      ],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'legado',
      incoterm: 'CFR',
      currency: 'EUR',
      unitPrice: '4.20',
      quantity: 50,
      unit: 'KG',
      isCurrentQuote: true,
    });
    expect(entries[0].recordedAt.toISOString()).toBe('2026-10-01T12:00:00.000Z');
  });

  it('ordena do mais recente para o mais antigo e marca a cotacao atual', () => {
    const { entries } = buildItemPriceHistoryEntries({
      currentQuoteRequestId: 2,
      targets: TARGETS,
      responses: [
        response({
          id: 1,
          snapshots: [snap(1, '2026-10-12T10:00:00Z', [snapItem(10, '5.00')], { source: 'manual' })],
        }),
        response({
          id: 2,
          quoteRequestId: 2,
          requestCode: 'COT-2',
          snapshots: [snap(2, '2026-10-20T10:00:00Z', [snapItem(20, '6.00')])],
        }),
      ],
    });

    expect(entries.map((e) => e.requestCode)).toEqual(['COT-2', 'COT-1']);
    expect(entries.map((e) => e.isCurrentQuote)).toEqual([true, false]);
    expect(entries.map((e) => e.source)).toEqual(['portal', 'manual']);
  });

  it('preco alternativo por incoterm vira lista de alternativas, sem o incoterm principal', () => {
    const { entries } = buildItemPriceHistoryEntries({
      currentQuoteRequestId: 1,
      targets: TARGETS,
      responses: [
        response({
          id: 1,
          snapshots: [
            snap(1, '2026-10-12T10:00:00Z', [
              snapItem(10, '5.00', {
                incotermPrices: [
                  { incoterm: 'FOB', unitPrice: '5.00', totalPrice: '500.00' },
                  { incoterm: 'CIF', unitPrice: '5.50', totalPrice: null },
                ],
              }),
            ]),
          ],
        }),
      ],
    });

    expect(entries[0].incotermPrices).toEqual([{ incoterm: 'CIF', unitPrice: '5.50', totalPrice: null }]);
  });

  it('aplica o teto de 300 linhas e marca truncated (mantem as mais recentes)', () => {
    const total = ITEM_PRICE_HISTORY_MAX_ENTRIES + 5;
    const snapshots = Array.from({ length: total }, (_, i) =>
      snap(i + 1, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), [snapItem(10, (1 + i).toFixed(2))]),
    );
    const { entries, truncated } = buildItemPriceHistoryEntries({
      currentQuoteRequestId: 1,
      targets: TARGETS,
      responses: [response({ id: 1, snapshots })],
    });

    expect(truncated).toBe(true);
    expect(entries).toHaveLength(ITEM_PRICE_HISTORY_MAX_ENTRIES);
    expect(entries[0].unitPrice).toBe(total.toFixed(2));
  });

  it('sem respostas devolve vazio e truncated false', () => {
    expect(
      buildItemPriceHistoryEntries({ currentQuoteRequestId: 1, targets: TARGETS, responses: [] }),
    ).toEqual({ entries: [], truncated: false });
  });
});
