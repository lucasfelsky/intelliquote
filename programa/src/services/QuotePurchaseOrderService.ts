import { HttpError } from '../utils/http';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tx = any;

export interface PurchaseOrderDTO {
  id: number;
  quoteRequestId: number;
  label: string;
  position: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Regra de realocacao ao excluir uma PO: anterior (maior position menor);
 * se for a primeira, a proxima (menor position maior); se for a unica, null.
 */
export function resolveReallocationTarget(
  orders: { id: number; position: number }[],
  deletedId: number,
): number | null {
  const deleted = orders.find((o) => o.id === deletedId);
  if (!deleted) {
    throw new Error(`PO ${deletedId} nao encontrada na lista informada.`);
  }
  const others = orders.filter((o) => o.id !== deletedId);
  const previous = others
    .filter((o) => o.position < deleted.position)
    .sort((a, b) => b.position - a.position)[0];
  if (previous) return previous.id;
  const next = others
    .filter((o) => o.position > deleted.position)
    .sort((a, b) => a.position - b.position)[0];
  return next ? next.id : null;
}

export async function normalizePositions(
  tx: Tx,
  quoteRequestId: number,
): Promise<PurchaseOrderDTO[]> {
  const orders = await tx.quoteRequestPurchaseOrder.findMany({
    where: { quoteRequestId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
  for (const [index, order] of orders.entries()) {
    if (order.position !== index + 1) {
      await tx.quoteRequestPurchaseOrder.update({
        where: { id: order.id },
        data: { position: index + 1 },
      });
      order.position = index + 1;
    }
  }
  return orders;
}

export async function createPurchaseOrder(
  tx: Tx,
  input: { quoteRequestId: number; label?: string; adoptUnassigned?: boolean },
): Promise<{ purchaseOrder: PurchaseOrderDTO; movedItemIds: number[] }> {
  const last = await tx.quoteRequestPurchaseOrder.findFirst({
    where: { quoteRequestId: input.quoteRequestId },
    orderBy: { position: 'desc' },
  });
  const position = (last?.position ?? 0) + 1;
  const purchaseOrder = await tx.quoteRequestPurchaseOrder.create({
    data: {
      quoteRequestId: input.quoteRequestId,
      label: input.label?.trim() || `PO ${position}`,
      position,
    },
  });

  let movedItemIds: number[] = [];
  if (input.adoptUnassigned) {
    const unassigned = await tx.quoteRequestItem.findMany({
      where: { quoteRequestId: input.quoteRequestId, purchaseOrderId: null },
      select: { id: true },
    });
    movedItemIds = unassigned.map((i: { id: number }) => i.id);
    await tx.quoteRequestItem.updateMany({
      where: { quoteRequestId: input.quoteRequestId, purchaseOrderId: null },
      data: { purchaseOrderId: purchaseOrder.id },
    });
  }
  return { purchaseOrder, movedItemIds };
}

export async function renamePurchaseOrder(
  tx: Tx,
  id: number,
  label: string,
): Promise<PurchaseOrderDTO> {
  return tx.quoteRequestPurchaseOrder.update({
    where: { id },
    data: { label: label.trim() },
  });
}

export async function reorderPurchaseOrders(
  tx: Tx,
  quoteRequestId: number,
  orderedIds: number[],
): Promise<PurchaseOrderDTO[]> {
  const current = await tx.quoteRequestPurchaseOrder.findMany({
    where: { quoteRequestId },
  });
  const currentIds = new Set<number>(current.map((o: { id: number }) => o.id));
  const given = new Set<number>(orderedIds);
  if (
    given.size !== orderedIds.length ||
    orderedIds.length !== currentIds.size ||
    orderedIds.some((id) => !currentIds.has(id))
  ) {
    throw new HttpError(
      400,
      'A lista de POs deve conter exatamente todas as POs da cotacao, sem repeticao.',
    );
  }
  const result: PurchaseOrderDTO[] = [];
  for (const [index, id] of orderedIds.entries()) {
    result.push(
      await tx.quoteRequestPurchaseOrder.update({
        where: { id },
        data: { position: index + 1 },
      }),
    );
  }
  return result;
}

/**
 * Exclui a PO realocando seus itens (nunca apaga itens) e normaliza posicoes.
 */
export async function deletePurchaseOrderWithReallocation(
  tx: Tx,
  purchaseOrder: { id: number; quoteRequestId: number },
): Promise<{
  deletedId: number;
  reassignedToPurchaseOrderId: number | null;
  movedItemIds: number[];
}> {
  const orders = await tx.quoteRequestPurchaseOrder.findMany({
    where: { quoteRequestId: purchaseOrder.quoteRequestId },
    select: { id: true, position: true },
  });
  const targetId = resolveReallocationTarget(orders, purchaseOrder.id);
  const items = await tx.quoteRequestItem.findMany({
    where: { purchaseOrderId: purchaseOrder.id },
    select: { id: true },
  });
  const movedItemIds: number[] = items.map((i: { id: number }) => i.id);
  await tx.quoteRequestItem.updateMany({
    where: { purchaseOrderId: purchaseOrder.id },
    data: { purchaseOrderId: targetId },
  });
  await tx.quoteRequestPurchaseOrder.delete({ where: { id: purchaseOrder.id } });
  await normalizePositions(tx, purchaseOrder.quoteRequestId);
  return {
    deletedId: purchaseOrder.id,
    reassignedToPurchaseOrderId: targetId,
    movedItemIds,
  };
}
