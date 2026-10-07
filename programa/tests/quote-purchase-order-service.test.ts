import { describe, expect, it, vi } from 'vitest';
import {
  createPurchaseOrder,
  deletePurchaseOrderWithReallocation,
  groupPurchaseOrders,
  lockQuoteRequestForPurchaseOrders,
  nextDefaultPurchaseOrderLabel,
  reorderPurchaseOrders,
  resolveReallocationTarget,
} from '../src/services/QuotePurchaseOrderService';

type Order = { id: number; quoteRequestId: number; position: number; label?: string };
type Item = { id: number; quoteRequestId: number; purchaseOrderId: number | null };

// Banco em memoria minimo para exercitar o service sem Prisma real.
function makeTx(orders: Order[], items: Item[]) {
  let nextId = 100;
  return {
    items,
    orders,
    $queryRaw: async (..._args: any[]) => [],
    quoteRequestPurchaseOrder: {
      create: vi.fn(async ({ data }: any) => {
        const o = { id: nextId++, ...data };
        orders.push(o);
        return { ...o };
      }),
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
        items
          .filter(
            (i) =>
              i.purchaseOrderId === where.purchaseOrderId &&
              (where.quoteRequestId === undefined || i.quoteRequestId === where.quoteRequestId),
          )
          .map((i) => ({ id: i.id })),
      updateMany: async ({ where, data }: any) => {
        for (const i of items) {
          if (
            i.purchaseOrderId === where.purchaseOrderId &&
            (where.quoteRequestId === undefined || i.quoteRequestId === where.quoteRequestId)
          ) {
            i.purchaseOrderId = data.purchaseOrderId;
          }
        }
      },
    },
  };
}

function scenario() {
  const orders: Order[] = [
    { id: 10, quoteRequestId: 1, position: 1, label: 'PO 1' },
    { id: 20, quoteRequestId: 1, position: 2, label: 'PO 2' },
    { id: 30, quoteRequestId: 1, position: 3, label: 'PO 3' },
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
    expect(() => resolveReallocationTarget(three, 99)).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('deletePurchaseOrderWithReallocation', () => {
  it('excluir a primeira realoca para a proxima e normaliza posicoes', async () => {
    const tx = scenario();
    const result = await deletePurchaseOrderWithReallocation(tx, { id: 10, quoteRequestId: 1 });

    expect(result).toEqual({
      deletedId: 10,
      reassignedToPurchaseOrderId: 20,
      movedItemIds: [1],
      dissolved: false,
      dissolvedPurchaseOrder: null,
    });
    expect(tx.items.find((i) => i.id === 1)!.purchaseOrderId).toBe(20);
    expect(tx.items).toHaveLength(5);
    expect(tx.orders.map((o) => [o.id, o.position])).toEqual([[20, 1], [30, 2]]);
  });

  it('excluir a do meio realoca para a anterior', async () => {
    const tx = scenario();
    const result = await deletePurchaseOrderWithReallocation(tx, { id: 20, quoteRequestId: 1 });

    expect(result).toEqual({
      deletedId: 20,
      reassignedToPurchaseOrderId: 10,
      movedItemIds: [2, 3],
      dissolved: false,
      dissolvedPurchaseOrder: null,
    });
    expect(tx.items.filter((i) => i.purchaseOrderId === 10).map((i) => i.id)).toEqual([1, 2, 3]);
    expect(tx.items).toHaveLength(5);
    expect(tx.orders.map((o) => [o.id, o.position])).toEqual([[10, 1], [30, 2]]);
  });

  it('excluir a ultima realoca para a anterior', async () => {
    const tx = scenario();
    const result = await deletePurchaseOrderWithReallocation(tx, { id: 30, quoteRequestId: 1 });

    expect(result).toEqual({
      deletedId: 30,
      reassignedToPurchaseOrderId: 20,
      movedItemIds: [4],
      dissolved: false,
      dissolvedPurchaseOrder: null,
    });
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

    expect(result).toEqual({
      deletedId: 7,
      reassignedToPurchaseOrderId: null,
      movedItemIds: [1, 2],
      dissolved: false,
      dissolvedPurchaseOrder: null,
    });
    expect(tx.items).toHaveLength(2);
    expect(tx.items.every((i) => i.purchaseOrderId === null)).toBe(true);
    expect(tx.orders).toHaveLength(0);
  });

  function twoPoScenario() {
    const orders: Order[] = [
      { id: 10, quoteRequestId: 1, position: 1, label: 'PO 1' },
      { id: 20, quoteRequestId: 1, position: 2, label: 'PO 2' },
    ];
    const items: Item[] = [
      { id: 1, quoteRequestId: 1, purchaseOrderId: 10 },
      { id: 2, quoteRequestId: 1, purchaseOrderId: 20 },
      { id: 3, quoteRequestId: 1, purchaseOrderId: null },
    ];
    return makeTx(orders, items);
  }

  it('2->1 dissolve: exclui a ultima e a PO restante, itens ficam sem PO', async () => {
    const tx = twoPoScenario();
    const result = await deletePurchaseOrderWithReallocation(tx, { id: 20, quoteRequestId: 1 });

    expect(result.dissolved).toBe(true);
    expect(result.reassignedToPurchaseOrderId).toBeNull();
    expect(result.dissolvedPurchaseOrder).toEqual({ id: 10, label: 'PO 1', position: 1 });
    expect(result.movedItemIds).toEqual([2, 1]);
    expect(tx.orders).toHaveLength(0);
    expect(tx.items).toHaveLength(3);
    expect(tx.items.every((i) => i.purchaseOrderId === null)).toBe(true);
  });

  it('2->1 dissolve: exclui a primeira e a PO restante', async () => {
    const tx = twoPoScenario();
    const result = await deletePurchaseOrderWithReallocation(tx, { id: 10, quoteRequestId: 1 });

    expect(result.dissolved).toBe(true);
    expect(result.dissolvedPurchaseOrder).toEqual({ id: 20, label: 'PO 2', position: 2 });
    expect(result.movedItemIds).toEqual([1, 2]);
    expect(tx.orders).toHaveLength(0);
    expect(tx.items).toHaveLength(3);
    expect(tx.items.every((i) => i.purchaseOrderId === null)).toBe(true);
  });
});

describe('groupPurchaseOrders', () => {
  it('sem POs cria PO 1 + PO 2 e adota os itens sem PO na PO 1', async () => {
    const tx = makeTx([], [
      { id: 1, quoteRequestId: 1, purchaseOrderId: null },
      { id: 2, quoteRequestId: 1, purchaseOrderId: null },
    ]);
    const result = await groupPurchaseOrders(tx, 1);

    expect(tx.orders.map((o) => [o.label, o.position])).toEqual([['PO 1', 1], ['PO 2', 2]]);
    const [first, second] = tx.orders;
    expect(tx.items.every((i) => i.purchaseOrderId === first.id)).toBe(true);
    expect(result.movedItemIds).toEqual([1, 2]);
    expect(result.purchaseOrder.id).toBe(second.id);
    expect(result.purchaseOrders.map((o) => o.id)).toEqual([first.id, second.id]);
    expect(result.createdIds).toEqual([first.id, second.id]);
    expect(result.adoptedIntoPurchaseOrderId).toBe(first.id);
  });

  it('cotacao legada com 1 PO mantem a PO, adota os soltos e cria so mais uma', async () => {
    const tx = makeTx(
      [{ id: 5, quoteRequestId: 1, position: 3, label: '4500012345' }],
      [
        { id: 1, quoteRequestId: 1, purchaseOrderId: null },
        { id: 2, quoteRequestId: 1, purchaseOrderId: 5 },
      ],
    );
    const result = await groupPurchaseOrders(tx, 1);

    expect(tx.quoteRequestPurchaseOrder.create).toHaveBeenCalledTimes(1);
    expect(tx.orders).toHaveLength(2);
    expect(tx.orders.find((o) => o.id === 5)!.label).toBe('4500012345');
    expect(tx.orders.map((o) => o.position)).toEqual([1, 2]);
    expect(tx.items.every((i) => i.purchaseOrderId === 5)).toBe(true);
    expect(result.adoptedIntoPurchaseOrderId).toBe(5);
    expect(result.purchaseOrder.label).toBe('PO 2');
    expect(result.purchaseOrder.position).toBe(2);
    expect(result.purchaseOrders.map((o) => o.position)).toEqual([1, 2]);
    expect(result.createdIds).toHaveLength(1);
  });

  it('com 2 POs rejeita com 409 e nao cria nada', async () => {
    const tx = makeTx(
      [
        { id: 10, quoteRequestId: 1, position: 1, label: 'PO 1' },
        { id: 20, quoteRequestId: 1, position: 2, label: 'PO 2' },
      ],
      [],
    );
    await expect(groupPurchaseOrders(tx, 1)).rejects.toMatchObject({ status: 409 });
    expect(tx.quoteRequestPurchaseOrder.create).not.toHaveBeenCalled();
    expect(tx.orders).toHaveLength(2);
  });
});

describe('nextDefaultPurchaseOrderLabel', () => {
  it('sem POs comeca em PO 1', () => {
    expect(nextDefaultPurchaseOrderLabel([], 1)).toBe('PO 1');
  });
  it('pula rotulo ja existente', () => {
    expect(nextDefaultPurchaseOrderLabel(['PO 2'], 2)).toBe('PO 3');
  });
  it('ignora caixa e espacos ao comparar', () => {
    expect(nextDefaultPurchaseOrderLabel(['po 3', ' PO 2 '], 2)).toBe('PO 4');
  });
  it('rotulo customizado nao colide', () => {
    expect(nextDefaultPurchaseOrderLabel(['Embarque'], 2)).toBe('PO 2');
  });
});

describe('createPurchaseOrder: rotulo unico apos excluir e recriar', () => {
  // Stub em memoria com label/create/findMany(select), alem do necessario para excluir.
  function makeLabelTx() {
    type O = { id: number; quoteRequestId: number; label: string; position: number };
    const orders: O[] = [];
    let nextId = 100;
    return {
      orders,
      $queryRaw: async (..._args: any[]) => [],
      quoteRequestPurchaseOrder: {
        findMany: async ({ where }: any) =>
          orders
            .filter((o) => o.quoteRequestId === where.quoteRequestId)
            .sort((a, b) => a.position - b.position || a.id - b.id)
            .map((o) => ({ ...o })),
        create: async ({ data }: any) => {
          const o = { id: nextId++, ...data };
          orders.push(o);
          return { ...o };
        },
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
        findMany: async () => [],
        updateMany: async () => undefined,
      },
    };
  }

  it('PO 1, PO 2, PO 3, exclui PO 1, cria de novo => PO 4 na posicao 3', async () => {
    const tx = makeLabelTx();
    const first = await createPurchaseOrder(tx, { quoteRequestId: 1 });
    await createPurchaseOrder(tx, { quoteRequestId: 1 });
    await createPurchaseOrder(tx, { quoteRequestId: 1 });
    await deletePurchaseOrderWithReallocation(tx, {
      id: first.purchaseOrder.id,
      quoteRequestId: 1,
    });
    const fourth = await createPurchaseOrder(tx, { quoteRequestId: 1 });

    expect(fourth.purchaseOrder.position).toBe(3);
    expect(fourth.purchaseOrder.label).toBe('PO 4');
    expect(tx.orders.map((o) => o.label).sort()).toEqual(['PO 2', 'PO 3', 'PO 4']);
  });
});

describe('lock da cotacao (QuoteRequest FOR NO KEY UPDATE)', () => {
  // Tx que registra a ordem das operacoes para provar "lock primeiro".
  function makeRecordingTx(
    existing: { id: number; position: number; label: string }[] = [
      { id: 1, position: 1, label: 'PO 1' },
      { id: 2, position: 2, label: 'PO 2' },
    ],
  ) {
    const log: string[] = [];
    const lockValues: unknown[][] = [];
    const tx = {
      log,
      lockValues,
      $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        log.push('lock');
        lockValues.push(values);
        return [];
      },
      quoteRequestPurchaseOrder: {
        findMany: async () => {
          log.push('findMany');
          return existing.map((o) => ({ ...o }));
        },
        create: async ({ data }: any) => {
          log.push('create');
          return { id: 3, ...data };
        },
        update: async ({ where, data }: any) => {
          log.push('update');
          return { id: where.id, ...data };
        },
        delete: async () => {
          log.push('delete');
        },
      },
      quoteRequestItem: {
        findMany: async () => [],
        updateMany: async () => {
          log.push('updateMany');
        },
      },
    };
    return tx;
  }

  it('lockQuoteRequestForPurchaseOrders passa o id como parametro', async () => {
    const tx = makeRecordingTx();
    await lockQuoteRequestForPurchaseOrders(tx, 42);
    expect(tx.lockValues).toEqual([[42]]);
  });

  it('createPurchaseOrder trava antes de ler posicoes e de criar', async () => {
    const tx = makeRecordingTx();
    await createPurchaseOrder(tx, { quoteRequestId: 7 });
    expect(tx.log.slice(0, 3)).toEqual(['lock', 'findMany', 'create']);
    expect(tx.lockValues).toEqual([[7]]);
  });

  it('groupPurchaseOrders trava antes de ler e de criar', async () => {
    const tx = makeRecordingTx([]);
    await groupPurchaseOrders(tx, 7);
    expect(tx.log[0]).toBe('lock');
    expect(tx.log.filter((e) => e === 'lock')).toHaveLength(1);
    expect(tx.log.slice(0, 3)).toEqual(['lock', 'findMany', 'create']);
    expect(tx.lockValues).toEqual([[7]]);
  });

  it('reorderPurchaseOrders trava antes de ler e de atualizar posicoes', async () => {
    const tx = makeRecordingTx();
    await reorderPurchaseOrders(tx, 7, [2, 1]);
    expect(tx.log).toEqual(['lock', 'findMany', 'update', 'update']);
    expect(tx.lockValues).toEqual([[7]]);
  });

  it('deletePurchaseOrderWithReallocation trava antes de qualquer leitura/escrita', async () => {
    const tx = makeRecordingTx();
    await deletePurchaseOrderWithReallocation(tx, { id: 2, quoteRequestId: 7 });
    expect(tx.log[0]).toBe('lock');
    expect(tx.log.filter((e) => e === 'lock')).toHaveLength(1);
    expect(tx.lockValues).toEqual([[7]]);
  });
});
