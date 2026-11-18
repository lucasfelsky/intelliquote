import { describe, expect, it, vi } from 'vitest';
import {
  QuoteRequestViewService,
  computeMinReference,
  computeNewResponseIds,
  isCountableSnapshot,
  type NewResponseSnapshot,
} from '../src/services/QuoteRequestViewService';

const USER_ID = 5;
const USER_CREATED_AT = new Date('2026-09-01T00:00:00.000Z');

function snapshot(over: Partial<NewResponseSnapshot> & { quoteRequestId: number }): NewResponseSnapshot {
  return {
    recordedAt: new Date('2026-11-10T10:00:00.000Z'),
    source: 'portal',
    performedById: null,
    ...over,
  };
}

function compute(over: Partial<Parameters<typeof computeNewResponseIds>[0]> = {}) {
  return computeNewResponseIds({
    userId: USER_ID,
    userCreatedAt: USER_CREATED_AT,
    quoteRequestIds: [1, 2, 3],
    lastSeenByQuoteRequestId: new Map(),
    snapshots: [],
    portalLatestSubmittedAt: new Map(),
    ...over,
  });
}

describe('computeNewResponseIds', () => {
  it('sem view usa User.createdAt como referencia', () => {
    const ids = compute({
      snapshots: [
        snapshot({ quoteRequestId: 1, recordedAt: new Date('2026-09-02T00:00:00.000Z') }),
        snapshot({ quoteRequestId: 2, recordedAt: new Date('2026-08-31T23:59:59.000Z') }),
      ],
    });

    expect([...ids]).toEqual([1]);
  });

  it('view mais recente que a resposta -> falso; resposta depois da view -> verdadeiro', () => {
    const ids = compute({
      lastSeenByQuoteRequestId: new Map([
        [1, new Date('2026-11-11T00:00:00.000Z')],
        [2, new Date('2026-11-09T00:00:00.000Z')],
      ]),
      snapshots: [snapshot({ quoteRequestId: 1 }), snapshot({ quoteRequestId: 2 })],
    });

    expect([...ids]).toEqual([2]);
  });

  it('snapshot manual do proprio usuario e ignorado; manual de colega e portal contam', () => {
    const ids = compute({
      snapshots: [
        snapshot({ quoteRequestId: 1, source: 'manual', performedById: USER_ID }),
        snapshot({ quoteRequestId: 2, source: 'manual', performedById: 99 }),
        snapshot({ quoteRequestId: 3, source: 'portal', performedById: null }),
      ],
    });

    expect([...ids].sort()).toEqual([2, 3]);
  });

  it('resposta do portal (submittedAt) depois da referencia conta, mesmo sem snapshot', () => {
    const ids = compute({
      lastSeenByQuoteRequestId: new Map([[1, new Date('2026-11-01T00:00:00.000Z')]]),
      portalLatestSubmittedAt: new Map([
        [1, new Date('2026-11-05T00:00:00.000Z')],
        [2, new Date('2026-08-01T00:00:00.000Z')],
      ]),
    });

    expect([...ids]).toEqual([1]);
  });

  it('ids sem resposta -> falso e ids fora do lote sao ignorados', () => {
    const ids = compute({
      quoteRequestIds: [1],
      snapshots: [snapshot({ quoteRequestId: 77 })],
      portalLatestSubmittedAt: new Map([[88, new Date('2026-11-05T00:00:00.000Z')]]),
    });

    expect(ids.size).toBe(0);
  });
});

describe('isCountableSnapshot', () => {
  it('isCountableSnapshot conta manual com performedById null e exclui so o manual do proprio usuario', () => {
    expect(isCountableSnapshot({ source: 'manual', performedById: null }, USER_ID)).toBe(true);
    expect(isCountableSnapshot({ source: 'manual', performedById: 99 }, USER_ID)).toBe(true);
    expect(isCountableSnapshot({ source: 'manual', performedById: USER_ID }, USER_ID)).toBe(false);
    expect(isCountableSnapshot({ source: 'portal', performedById: null }, USER_ID)).toBe(true);
    expect(isCountableSnapshot({ source: 'portal', performedById: USER_ID }, USER_ID)).toBe(true);
  });
});

describe('computeNewResponseIds (manual sem autor)', () => {
  it('computeNewResponseIds conta snapshot manual com performedById null', () => {
    const ids = compute({
      snapshots: [snapshot({ quoteRequestId: 1, source: 'manual', performedById: null })],
    });

    expect([...ids]).toEqual([1]);
  });
});

describe('computeMinReference', () => {
  it('computeMinReference usa o menor lastSeenAt quando todas as cotacoes do lote tem view', () => {
    const min = computeMinReference(
      [1, 2, 3],
      new Map([
        [1, new Date('2026-11-05T00:00:00.000Z')],
        [2, new Date('2026-11-01T00:00:00.000Z')],
        [3, new Date('2026-11-09T00:00:00.000Z')],
      ]),
      USER_CREATED_AT,
    );

    expect(min.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('computeMinReference cai em User.createdAt quando alguma cotacao do lote nao tem view', () => {
    const min = computeMinReference(
      [1, 2, 3],
      new Map([
        [1, new Date('2026-11-05T00:00:00.000Z')],
        [3, new Date('2026-11-09T00:00:00.000Z')],
      ]),
      USER_CREATED_AT,
    );

    expect(min.getTime()).toBe(USER_CREATED_AT.getTime());
    expect(computeMinReference([], new Map(), USER_CREATED_AT).getTime()).toBe(USER_CREATED_AT.getTime());
  });

  it('corte por minReference nao muda o resultado (equivalencia)', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7];
    const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    const lastSeen = new Map<number, Date>([
      [1, d('2026-11-10')],
      [2, d('2026-11-03')],
      [3, d('2026-11-07')],
      [5, d('2026-11-12')],
      [6, d('2026-11-01')],
    ]);
    const snapshots: NewResponseSnapshot[] = [
      snapshot({ quoteRequestId: 1, recordedAt: d('2026-11-09') }),
      snapshot({ quoteRequestId: 1, recordedAt: d('2026-11-11') }),
      snapshot({ quoteRequestId: 2, recordedAt: d('2026-11-02') }),
      snapshot({ quoteRequestId: 2, recordedAt: d('2026-11-04'), source: 'manual', performedById: USER_ID }),
      snapshot({ quoteRequestId: 3, recordedAt: d('2026-11-06') }),
      snapshot({ quoteRequestId: 3, recordedAt: d('2026-11-08'), source: 'manual', performedById: null }),
      snapshot({ quoteRequestId: 4, recordedAt: d('2026-08-15') }),
      snapshot({ quoteRequestId: 4, recordedAt: d('2026-09-20') }),
      snapshot({ quoteRequestId: 5, recordedAt: d('2026-11-11') }),
      snapshot({ quoteRequestId: 6, recordedAt: d('2026-10-30') }),
      snapshot({ quoteRequestId: 7, recordedAt: d('2026-08-31') }),
    ];
    const portal = new Map<number, Date>([
      [1, d('2026-11-08')],
      [2, d('2026-11-02')],
      [5, d('2026-11-13')],
      [6, d('2026-11-02')],
      [7, d('2026-08-30')],
    ]);

    const run = (quoteRequestIds: number[]) => {
      const full = computeNewResponseIds({
        userId: USER_ID,
        userCreatedAt: USER_CREATED_AT,
        quoteRequestIds,
        lastSeenByQuoteRequestId: lastSeen,
        snapshots,
        portalLatestSubmittedAt: portal,
      });
      const minReference = computeMinReference(quoteRequestIds, lastSeen, USER_CREATED_AT);
      const cut = computeNewResponseIds({
        userId: USER_ID,
        userCreatedAt: USER_CREATED_AT,
        quoteRequestIds,
        lastSeenByQuoteRequestId: lastSeen,
        snapshots: snapshots.filter(
          (item) => item.recordedAt > minReference && isCountableSnapshot(item, USER_ID),
        ),
        portalLatestSubmittedAt: new Map([...portal].filter(([, submittedAt]) => submittedAt > minReference)),
      });
      return { full: [...full].sort(), cut: [...cut].sort(), minReference };
    };

    // Lote misto (4 e 7 sem view -> corte em User.createdAt).
    const mixed = run(ids);
    expect(mixed.cut).toEqual(mixed.full);
    expect(mixed.full).toEqual([1, 3, 4, 5, 6]);

    // Lote so com views: o corte sobe para o menor lastSeenAt.
    const withViews = run([1, 2, 3, 5, 6]);
    expect(withViews.minReference.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(withViews.cut).toEqual(withViews.full);
    expect(withViews.full).toEqual([1, 3, 5, 6]);
  });
});

describe('QuoteRequestViewService', () => {
  function clientMock() {
    return {
      quoteRequestView: {
        findMany: vi.fn().mockResolvedValue([]),
        // Por padrao o usuario ja tem alguma view (sem baseline).
        findFirst: vi.fn().mockResolvedValue({ id: 99 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({ quoteRequestId: 4, lastSeenAt: new Date('2026-11-18T12:00:00.000Z') }),
      },
      quoteRequest: { findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]) },
      user: { findUnique: vi.fn().mockResolvedValue({ createdAt: USER_CREATED_AT }) },
      quoteResponsePriceSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
      supplierPortalResponse: { groupBy: vi.fn().mockResolvedValue([]) },
    };
  }

  it('markSeen faz upsert pela unique composta userId_quoteRequestId', async () => {
    const client = clientMock();

    const result = await QuoteRequestViewService.markSeen(USER_ID, 4, client as never);

    expect(result.quoteRequestId).toBe(4);
    const args = client.quoteRequestView.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId_quoteRequestId: { userId: USER_ID, quoteRequestId: 4 } });
    expect(args.create).toMatchObject({ userId: USER_ID, quoteRequestId: 4 });
    expect(args.update.lastSeenAt).toBeInstanceOf(Date);
  });

  it('findIdsWithNewResponses com lista vazia nao consulta o banco', async () => {
    const client = clientMock();

    const ids = await QuoteRequestViewService.findIdsWithNewResponses(USER_ID, [], client as never);

    expect(ids.size).toBe(0);
    expect(client.quoteRequestView.findMany).not.toHaveBeenCalled();
  });

  it('findIdsWithNewResponses cruza views, snapshots (sem o manual proprio) e portal, com deletedAt null', async () => {
    const client = clientMock();
    client.quoteRequestView.findMany.mockResolvedValue([
      { quoteRequestId: 1, lastSeenAt: new Date('2026-11-01T00:00:00.000Z') },
    ]);
    client.quoteResponsePriceSnapshot.findMany.mockResolvedValue([
      {
        recordedAt: new Date('2026-11-05T00:00:00.000Z'),
        source: 'portal',
        performedById: null,
        quoteResponse: { quoteRequestId: 1 },
      },
    ]);
    client.supplierPortalResponse.groupBy.mockResolvedValue([
      { quoteRequestId: 2, _max: { submittedAt: new Date('2026-11-06T00:00:00.000Z') } },
    ]);

    const ids = await QuoteRequestViewService.findIdsWithNewResponses(USER_ID, [1, 2, 3], client as never);

    expect([...ids].sort()).toEqual([1, 2]);
    const snapshotWhere = client.quoteResponsePriceSnapshot.findMany.mock.calls[0][0].where;
    expect(snapshotWhere.NOT).toBeUndefined();
    expect(snapshotWhere.OR).toEqual([
      { source: { not: 'manual' } },
      { performedById: null },
      { performedById: { not: USER_ID } },
    ]);
    expect(snapshotWhere.quoteResponse).toEqual({
      deletedAt: null,
      quoteRequestId: { in: [1, 2, 3] },
      quoteRequest: { deletedAt: null },
    });
    const portalArgs = client.supplierPortalResponse.groupBy.mock.calls[0][0];
    expect(portalArgs.by).toEqual(['quoteRequestId']);
    expect(portalArgs.where.deletedAt).toBeNull();
  });

  it('findIdsWithNewResponses usa o menor lastSeenAt do lote no corte da leitura', async () => {
    const client = clientMock();
    client.quoteRequestView.findMany.mockResolvedValue([
      { quoteRequestId: 1, lastSeenAt: new Date('2026-11-03T00:00:00.000Z') },
      { quoteRequestId: 2, lastSeenAt: new Date('2026-11-01T00:00:00.000Z') },
    ]);

    await QuoteRequestViewService.findIdsWithNewResponses(USER_ID, [1, 2], client as never);

    const snapshotWhere = client.quoteResponsePriceSnapshot.findMany.mock.calls[0][0].where;
    expect(snapshotWhere.recordedAt.gt).toEqual(new Date('2026-11-01T00:00:00.000Z'));
    const portalArgs = client.supplierPortalResponse.groupBy.mock.calls[0][0];
    expect(portalArgs.where.submittedAt.gt).toEqual(new Date('2026-11-01T00:00:00.000Z'));
  });

  it('findIdsWithNewResponses grava baseline e devolve vazio quando o usuario nao tem nenhuma view', async () => {
    const client = clientMock();
    client.quoteRequestView.findFirst.mockResolvedValue(null);
    client.quoteRequest.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);

    const ids = await QuoteRequestViewService.findIdsWithNewResponses(USER_ID, [1, 2], client as never);

    expect(ids.size).toBe(0);
    expect(client.quoteRequestView.findFirst.mock.calls[0][0].where).toEqual({ userId: USER_ID });
    expect(client.quoteRequest.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
    const args = client.quoteRequestView.createMany.mock.calls[0][0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data.map((row: { quoteRequestId: number }) => row.quoteRequestId)).toEqual([1, 2, 3]);
    for (const row of args.data) {
      expect(row.userId).toBe(USER_ID);
      expect(row.lastSeenAt).toBeInstanceOf(Date);
    }
    expect(client.quoteResponsePriceSnapshot.findMany).not.toHaveBeenCalled();
    expect(client.supplierPortalResponse.groupBy).not.toHaveBeenCalled();
  });

  it('findIdsWithNewResponses nao grava baseline quando o usuario ja tem view em outra cotacao', async () => {
    const client = clientMock();
    client.quoteRequestView.findMany.mockResolvedValue([]);
    client.quoteRequestView.findFirst.mockResolvedValue({ id: 7 });

    await QuoteRequestViewService.findIdsWithNewResponses(USER_ID, [1, 2], client as never);

    expect(client.quoteRequestView.createMany).not.toHaveBeenCalled();
    expect(client.quoteResponsePriceSnapshot.findMany).toHaveBeenCalledTimes(1);
    expect(client.supplierPortalResponse.groupBy).toHaveBeenCalledTimes(1);
  });

  it('markSeen grava baseline antes do upsert quando o usuario nao tem nenhuma view', async () => {
    const client = clientMock();
    client.quoteRequestView.findFirst.mockResolvedValue(null);

    await QuoteRequestViewService.markSeen(USER_ID, 4, client as never);

    expect(client.quoteRequestView.createMany).toHaveBeenCalledTimes(1);
    expect(client.quoteRequestView.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(client.quoteRequestView.upsert).toHaveBeenCalledTimes(1);
    expect(client.quoteRequestView.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      client.quoteRequestView.upsert.mock.invocationCallOrder[0],
    );
  });

  it('markSeen nao grava baseline quando o usuario ja tem view', async () => {
    const client = clientMock();

    await QuoteRequestViewService.markSeen(USER_ID, 4, client as never);

    expect(client.quoteRequestView.createMany).not.toHaveBeenCalled();
    expect(client.quoteRequest.findMany).not.toHaveBeenCalled();
    expect(client.quoteRequestView.upsert).toHaveBeenCalledTimes(1);
  });

  it('usuario inexistente -> conjunto vazio', async () => {
    const client = clientMock();
    client.user.findUnique.mockResolvedValue(null);

    const ids = await QuoteRequestViewService.findIdsWithNewResponses(USER_ID, [1], client as never);

    expect(ids.size).toBe(0);
  });
});
