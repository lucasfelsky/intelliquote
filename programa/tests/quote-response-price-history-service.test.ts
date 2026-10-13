import { describe, expect, it, vi } from 'vitest';
import {
  QuoteResponsePriceHistoryService,
  buildSnapshotItems,
  buildSnapshotKey,
} from '../src/services/QuoteResponsePriceHistoryService';

type FakeItem = {
  quoteRequestItemId: number;
  unitPrice: string | number;
  quantity: number;
  totalPrice: string | number;
  isUnavailable?: boolean;
  incotermPrices?: unknown;
};

function makeResponse(overrides: Partial<{
  id: number;
  currency: string;
  offeredIncoterm: string;
  offeredPrice: string | number;
  items: FakeItem[];
}> = {}) {
  return {
    id: 42,
    currency: 'USD',
    offeredIncoterm: 'FOB',
    offeredPrice: '80.00',
    items: [
      { quoteRequestItemId: 5, unitPrice: '10.00', quantity: 5, totalPrice: '50.00', isUnavailable: false, incotermPrices: null },
      { quoteRequestItemId: 6, unitPrice: '10.00', quantity: 3, totalPrice: '30.00', isUnavailable: false, incotermPrices: null },
    ],
    ...overrides,
  };
}

function makeTx(opts: {
  response?: ReturnType<typeof makeResponse> | null;
  last?: Record<string, unknown> | null;
  user?: { name: string } | null;
  contact?: { name: string; email: string } | null;
  userThrows?: boolean;
} = {}) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 900, recordedAt: new Date(), ...data }));
  const tx = {
    quoteResponse: {
      findUnique: vi.fn(async () => (opts.response === undefined ? makeResponse() : opts.response)),
    },
    quoteResponsePriceSnapshot: {
      findFirst: vi.fn(async () => opts.last ?? null),
      create,
      findMany: vi.fn(async () => []),
    },
    user: {
      findUnique: vi.fn(async () => {
        if (opts.userThrows) throw new Error('boom');
        return opts.user === undefined ? { name: 'Admin Teste' } : opts.user;
      }),
    },
    supplierContact: {
      findUnique: vi.fn(async () => (opts.contact === undefined ? { name: 'Contato', email: 'c@forn.test' } : opts.contact)),
    },
    quoteRequestItem: { findMany: vi.fn(async () => []) },
  };
  return { tx, create };
}

function snapshotOf(response: ReturnType<typeof makeResponse>, extra: Record<string, unknown> = {}) {
  return {
    id: 1,
    quoteResponseId: response.id,
    source: 'portal',
    actorName: null,
    performedById: null,
    supplierContactId: null,
    currency: response.currency,
    offeredIncoterm: response.offeredIncoterm,
    offeredPrice: response.offeredPrice,
    items: buildSnapshotItems(response.items),
    recordedAt: new Date('2026-10-01T10:00:00Z'),
    ...extra,
  };
}

describe('buildSnapshotKey', () => {
  const base = makeResponse();

  it('e deterministica e independe da ordem dos itens e dos incoterms alternativos', () => {
    const a = buildSnapshotKey({
      ...base,
      items: [
        { ...base.items[1]!, incotermPrices: [{ incoterm: 'FOB', unitPrice: 10 }, { incoterm: 'CIF', unitPrice: 12 }] },
        base.items[0]!,
      ],
    });
    const b = buildSnapshotKey({
      ...base,
      items: [
        base.items[0]!,
        { ...base.items[1]!, incotermPrices: [{ incoterm: 'CIF', unitPrice: '12.00' }, { incoterm: 'FOB', unitPrice: '10' }] },
      ],
    });
    expect(a).toBe(b);
    expect(a).toContain('USD|FOB|80.00|');
  });

  it('muda quando algo de preco muda', () => {
    const key = buildSnapshotKey(base);
    expect(buildSnapshotKey({ ...base, currency: 'EUR' })).not.toBe(key);
    expect(buildSnapshotKey({ ...base, offeredIncoterm: 'CIF' })).not.toBe(key);
    expect(buildSnapshotKey({ ...base, offeredPrice: 81 })).not.toBe(key);
    expect(buildSnapshotKey({ ...base, items: [{ ...base.items[0]!, unitPrice: 11 }, base.items[1]!] })).not.toBe(key);
    expect(buildSnapshotKey({ ...base, items: [{ ...base.items[0]!, quantity: 6 }, base.items[1]!] })).not.toBe(key);
    expect(buildSnapshotKey({ ...base, items: [{ ...base.items[0]!, isUnavailable: true }, base.items[1]!] })).not.toBe(key);
  });

  it('ignora campos que nao sao de preco (leadTime, notes, originPort)', () => {
    const key = buildSnapshotKey(base);
    const withNoise = buildSnapshotKey({
      ...base,
      items: base.items.map((item) => ({ ...item, leadTimeDays: 99, notes: 'x', originPort: 'Ningbo' } as FakeItem)),
    });
    expect(withNoise).toBe(key);
  });
});

describe('QuoteResponsePriceHistoryService.record', () => {
  it('grava o primeiro snapshot (manual) com o nome do usuario', async () => {
    const { tx, create } = makeTx();
    const result = await QuoteResponsePriceHistoryService.record(tx as never, 42, { source: 'manual', performedById: 7 });
    expect(result).not.toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      quoteResponseId: 42,
      source: 'manual',
      performedById: 7,
      supplierContactId: null,
      actorName: 'Admin Teste',
      currency: 'USD',
      offeredIncoterm: 'FOB',
      offeredPrice: '80.00',
    });
    expect(data.items).toEqual([
      { quoteRequestItemId: 5, unitPrice: '10.00', quantity: 5, totalPrice: '50.00', isUnavailable: false, incotermPrices: null },
      { quoteRequestItemId: 6, unitPrice: '10.00', quantity: 3, totalPrice: '30.00', isUnavailable: false, incotermPrices: null },
    ]);
    expect(tx.quoteResponse.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ include: { items: { where: { deletedAt: null } } } }),
    );
  });

  it('portal: actorName = "Nome <email>" do contato e supplierContactId preenchido', async () => {
    const { tx, create } = makeTx();
    await QuoteResponsePriceHistoryService.record(tx as never, 42, { source: 'portal', supplierContactId: 9 });
    expect(create.mock.calls[0]![0].data).toMatchObject({
      source: 'portal',
      supplierContactId: 9,
      performedById: null,
      actorName: 'Contato <c@forn.test>',
    });
  });

  it('estado identico ao ultimo snapshot: nao grava e retorna null', async () => {
    const response = makeResponse();
    const { tx, create } = makeTx({ response, last: snapshotOf(response) });
    const result = await QuoteResponsePriceHistoryService.record(tx as never, 42, { source: 'manual', performedById: 7 });
    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('resposta inexistente: retorna null sem gravar', async () => {
    const { tx, create } = makeTx({ response: null });
    expect(await QuoteResponsePriceHistoryService.record(tx as never, 999, { source: 'manual', performedById: 7 })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  const base = makeResponse();
  const cases: Array<[string, ReturnType<typeof makeResponse>]> = [
    ['unitPrice', makeResponse({ items: [{ ...base.items[0]!, unitPrice: '12.00', totalPrice: '60.00' }, base.items[1]!], offeredPrice: '90.00' })],
    ['quantity', makeResponse({ items: [{ ...base.items[0]!, quantity: 6, totalPrice: '60.00' }, base.items[1]!] })],
    ['isUnavailable', makeResponse({ items: [{ ...base.items[0]!, isUnavailable: true, unitPrice: '0.00', quantity: 0, totalPrice: '0.00' }, base.items[1]!] })],
    ['currency', makeResponse({ currency: 'EUR' })],
    ['offeredIncoterm', makeResponse({ offeredIncoterm: 'CIF' })],
    ['incotermPrices alternativo', makeResponse({
      items: [
        { ...base.items[0]!, incotermPrices: [{ incoterm: 'FOB', unitPrice: '10.00' }, { incoterm: 'CIF', unitPrice: '13.00' }] },
        base.items[1]!,
      ],
    })],
    ['offeredPrice (legada sem itens)', makeResponse({ items: [], offeredPrice: '81.00' })],
  ];

  for (const [label, changed] of cases) {
    it(`grava quando muda ${label}`, async () => {
      // Ultimo snapshot = base; para o caso legado, o ultimo tambem e sem itens.
      const last = label.startsWith('offeredPrice') ? snapshotOf(makeResponse({ items: [] })) : snapshotOf(
        label.startsWith('incotermPrices')
          ? makeResponse({ items: [{ ...base.items[0]!, incotermPrices: [{ incoterm: 'FOB', unitPrice: '10.00' }, { incoterm: 'CIF', unitPrice: '12.00' }] }, base.items[1]!] })
          : base,
      );
      const { tx, create } = makeTx({ response: changed, last });
      const result = await QuoteResponsePriceHistoryService.record(tx as never, 42, { source: 'manual', performedById: 7 });
      expect(result).not.toBeNull();
      expect(create).toHaveBeenCalledTimes(1);
    });
  }

  it('falha ao resolver o autor nao impede a gravacao (actorName null)', async () => {
    const { tx, create } = makeTx({ userThrows: true });
    const result = await QuoteResponsePriceHistoryService.record(tx as never, 42, { source: 'manual', performedById: 7 });
    expect(result).not.toBeNull();
    expect(create.mock.calls[0]![0].data.actorName).toBeNull();
  });
});

describe('QuoteResponsePriceHistoryService.listByQuoteResponse', () => {
  it('ordena asc, resolve colunas (sem filtrar deletedAt) e marca so o que mudou vs a linha anterior', async () => {
    const v1 = makeResponse();
    const v2 = makeResponse({ items: [{ ...v1.items[0]!, unitPrice: '12.00', totalPrice: '60.00' }, v1.items[1]!], offeredPrice: '90.00' });
    const v3 = makeResponse({ currency: 'EUR', items: [v2.items[0]!, { ...v2.items[1]!, isUnavailable: true, unitPrice: '0.00', quantity: 0, totalPrice: '0.00' }], offeredPrice: '60.00' });
    const snapshots = [
      snapshotOf(v1, { id: 1, recordedAt: new Date('2026-10-01T10:00:00Z'), source: 'portal', actorName: 'Contato <c@forn.test>' }),
      snapshotOf(v2, { id: 2, recordedAt: new Date('2026-10-02T10:00:00Z'), source: 'portal', actorName: 'Contato <c@forn.test>' }),
      snapshotOf(v3, { id: 3, recordedAt: new Date('2026-10-03T10:00:00Z'), source: 'manual', actorName: 'Admin Teste' }),
    ];
    const findMany = vi.fn(async () => snapshots);
    const quoteRequestItemFindMany = vi.fn(async () => [
      { id: 5, productName: 'Resina', itemCode: 'RES-01', unit: 'KG' },
      // item 6 nao devolvido pelo banco (hard-deleted): vira "Item #6"
    ]);
    const client = {
      quoteResponsePriceSnapshot: { findMany },
      quoteRequestItem: { findMany: quoteRequestItemFindMany },
    };

    const result = await QuoteResponsePriceHistoryService.listByQuoteResponse(42, client as never);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { quoteResponseId: 42 }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] }),
    );
    const itemWhere = quoteRequestItemFindMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(itemWhere.where).toEqual({ id: { in: [5, 6] } });
    expect(itemWhere.where).not.toHaveProperty('deletedAt');

    expect(result.columns).toEqual([
      { quoteRequestItemId: 5, productName: 'Resina', itemCode: 'RES-01', unit: 'KG' },
      { quoteRequestItemId: 6, productName: 'Item #6', itemCode: null, unit: 'UN' },
    ]);
    expect(result.rows.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(result.rows[0]).toMatchObject({ changedItemIds: [], changedFields: [], offeredPrice: '80.00', source: 'portal' });
    expect(result.rows[1]).toMatchObject({ changedItemIds: [5], changedFields: ['offeredPrice'] });
    expect(result.rows[2]).toMatchObject({ changedItemIds: [6], changedFields: ['currency', 'offeredPrice'], actorName: 'Admin Teste' });
  });

  it('sem snapshots: colunas e linhas vazias, sem consultar itens', async () => {
    const quoteRequestItemFindMany = vi.fn(async () => []);
    const client = {
      quoteResponsePriceSnapshot: { findMany: vi.fn(async () => []) },
      quoteRequestItem: { findMany: quoteRequestItemFindMany },
    };
    const result = await QuoteResponsePriceHistoryService.listByQuoteResponse(42, client as never);
    expect(result).toEqual({ columns: [], rows: [] });
    expect(quoteRequestItemFindMany).not.toHaveBeenCalled();
  });
});
