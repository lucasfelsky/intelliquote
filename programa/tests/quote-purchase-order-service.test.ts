import { describe, expect, it } from 'vitest';
import {
  deletePurchaseOrderWithReallocation,
  resolveReallocationTarget,
} from '../src/services/QuotePurchaseOrderService';

type Order = { id: number; quoteRequestId: number; position: number };
type Item = { id: number; quoteRequestId: number; purchaseOrderId: number | null };

// Banco em memoria minimo para exercitar o service sem Prisma real.
function makeTx(orders: Order[], items: Item[]) {
  return {
    items,
    orders,
    quoteRequestPurchaseOrder: {
      findMany: async ({ where }: any) =>
        orders
          .filter((o) => o.quoteRequestId === where.quoteRequestId)
          .sort((a, b) => a.position - b.position || a.id - b.id)
          .map((o) => ({ ...o })),
      update: async ({ where, data }: any) => {
        const o = orders.find((x) => x.id === where.id)!;
        Object.assign(o, data);
        return o;
      },
      delete: async ({ where }: any) => {
        orders.splice(orders.findIndex((x) => x.id === where.id), 1);
      },
    },
    quoteRequestItem: {
      findMany: async ({ where }: any) =>
        items.filter((i) => i.purchaseOrderId === where.purchaseOrderId).map((i) => ({ id: i.id })),
      updateMany: async ({ where, data }: any) => {
        for (const i of items) {
          if (i.purchaseOrderId === where.purchaseOrderId) i.purchaseOrderId = data.purchaseOrderId;
        }
      },
    },
  };
}

function scenario() {
  const orders: Order[] = [
    { id: 10, quoteRequestId: 1, position: 1 },
    { id: 20, quoteRequestId: 1, position: 2 },
    { id: 30, quoteRequestId: 1, position: 3 },
  ];
  const items: Item[] = [
    { id: 1, quoteRequestId: 1, purchaseOrderId: 10 },
    { id: 2, quoteRequestId: 1, purchaseOrderId: 20 },
    { id: 3, quoteRequestId: 1, purchaseOrderId: 20 },
    { id: 4, quoteRequestId: 1, purchaseOrderId: 30 },
    { id: 5, quoteRequestId: 1, purchaseOrderId: null },
  ];
  return makeTx(orders, items);
}

describe('resolveReallocationTarget', () => {
  const three = [
    { id: 1, position: 1 },
    { id: 2, position: 2 },
    { id: 3, position: 3 },
  ];

  it('do meio vai para a anterior', () => {
    expect(resolveReallocationTarget(three, 2)).toBe(1);
  });
  it('a primeira vai para a proxima', () => {
    expect(resolveReallocationTarget(three, 1)).toBe(2);
  });
  it('a ultima vai para a anterior', () => {
    expect(resolveReallocationTarget(three, 3)).toBe(2);
  });
  it('a unica resulta em null', () => {
    expect(resolveReallocationTarget([{ id: 9, position: 1 }], 9)).toBeNull();
  });
  it('posicoes nao contiguas usam a anterior mais proxima', () => {
    const sparse = [
      { id: 1, position: 1 },
      { id: 2, position: 3 },
      { id: 3, position: 7 },
    ];
    expect(resolveReallocationTarget(sparse, 3)).toBe(2);
    expect(resolveReallocationTarget(sparse, 2)).toBe(1);
  });
  it('id inexistente lanca erro', () => {
    expect(() => resolveReallocationTarget(three, 99)).toThrow();
  });
});

describe('deletePurchaseOrderWithReallocation', () => {
  it('excluir a primeira realoca para a proxima e normaliza posicoes', async () => {
    const tx = scenario();
    const result = await deletePurchaseOrderWithReallocation(tx, { id: 10, quoteRequestId: 1 });

    expect(result).toEqual({ deletedId: 10, reassignedToPurchaseOrderId: 20, movedItemIds: [1] });
    expect(tx.items.find((i) => i.id === 1)!.purchaseOrderId).toBe(20);
    expect(tx.items).toHaveLength(5);
    expect(tx.orders.map((o) => [o.id, o.position])).toEqual([[20, 1], [30, 2]]);
  });

  it('excluir a do meio realoca para a anterior', async () => {
    const tx = scenario();
    const result = await deletePurchaseOrderWithReallocation(tx, { id: 20, quoteRequestId: 1 });

    expect(result).toEqual({ deletedId: 20, reassignedToPurchaseOrderId: 10, movedItemIds: [2, 3] });
    expect(tx.items.filter((i) => i.purchaseOrderId === 10).map((i) => i.id)).toEqual([1, 2, 3]);
    expect(tx.items).toHaveLength(5);
    expect(tx.orders.map((o) => [o.id, o.position])).toEqual([[10, 1], [30, 2]]);
  });

  it('excluir a ultima realoca para a anterior', async () => {
    const tx = scenario();
    const result = await deletePurchaseOrderWithReallocation(tx, { id: 30, quoteRequestId: 1 });

    expect(result).toEqual({ deletedId: 30, reassignedToPurchaseOrderId: 20, movedItemIds: [4] });
    expect(tx.items.find((i) => i.id === 4)!.purchaseOrderId).toBe(20);
    expect(tx.items).toHaveLength(5);
    expect(tx.orders.map((o) => [o.id, o.position])).toEqual([[10, 1], [20, 2]]);
  });

  it('excluir a unica PO deixa os itens sem PO e nao apaga nenhum', async () => {
    const orders: Order[] = [{ id: 7, quoteRequestId: 1, position: 1 }];
    const items: Item[] = [
      { id: 1, quoteRequestId: 1, purchaseOrderId: 7 },
      { id: 2, quoteRequestId: 1, purchaseOrderId: 7 },
    ];
    const tx = makeTx(orders, items);
    const result = await deletePurchaseOrderWithReallocation(tx, { id: 7, quoteRequestId: 1 });

    expect(result).toEqual({ deletedId: 7, reassignedToPurchaseOrderId: null, movedItemIds: [1, 2] });
    expect(tx.items).toHaveLength(2);
    expect(tx.items.every((i) => i.purchaseOrderId === null)).toBe(true);
    expect(tx.orders).toHaveLength(0);
  });
});
