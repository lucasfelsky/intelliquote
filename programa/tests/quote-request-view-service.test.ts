import { describe, expect, it, vi } from 'vitest';
import {
  QuoteRequestViewService,
  computeNewResponseIds,
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

describe('QuoteRequestViewService', () => {
  function clientMock() {
    return {
      quoteRequestView: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({ quoteRequestId: 4, lastSeenAt: new Date('2026-11-18T12:00:00.000Z') }),
      },
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
    expect(snapshotWhere.NOT).toEqual({ source: 'manual', performedById: USER_ID });
    expect(snapshotWhere.quoteResponse).toEqual({
      deletedAt: null,
      quoteRequestId: { in: [1, 2, 3] },
      quoteRequest: { deletedAt: null },
    });
    const portalArgs = client.supplierPortalResponse.groupBy.mock.calls[0][0];
    expect(portalArgs.by).toEqual(['quoteRequestId']);
    expect(portalArgs.where.deletedAt).toBeNull();
  });

  it('usuario inexistente -> conjunto vazio', async () => {
    const client = clientMock();
    client.user.findUnique.mockResolvedValue(null);

    const ids = await QuoteRequestViewService.findIdsWithNewResponses(USER_ID, [1], client as never);

    expect(ids.size).toBe(0);
  });
});
