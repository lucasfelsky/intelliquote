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
    throw new HttpError(404, `PO ${deletedId} nao encontrada na lista informada.`);
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

/**
 * Serializa as operacoes de PO de uma cotacao travando a linha pai
 * ("QuoteRequest") com lock de linha NO KEY UPDATE.
 *
 * Regra de ordem de lock: "QuoteRequest primeiro". Deve ser a PRIMEIRA operacao
 * da transacao (antes de ler/calcular position ou rotulo e antes de qualquer
 * escrita em filhos), para nao criar deadlock (40P01) entre transacoes que
 * seguram filhos e esperam o pai.
 *
 * Por que NO KEY UPDATE e nao FOR UPDATE: o Postgres toma FOR KEY SHARE na linha
 * pai em todo INSERT com FK para QuoteRequest (regenerateToken, compare, submit do
 * portal, supplierReview). FOR UPDATE conflita com KEY SHARE e criaria ciclos com
 * transacoes que fazem updateMany e depois um INSERT com FK. NO KEY UPDATE ainda
 * conflita com ele mesmo (serializa as operacoes abaixo entre si), mas nao
 * bloqueia INSERTs com FK.
 *
 * Chamado por: criar PO, reordenar POs, excluir PO (neste arquivo), move_po
 * (QuoteRequestItemController), soft-delete e reopen (QuoteRequestController).
 * O close ja trava o pai na 1a escrita (quoteRequest.update).
 */
export async function lockQuoteRequestForPurchaseOrders(
  tx: Tx,
  quoteRequestId: number,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "QuoteRequest" WHERE id = ${quoteRequestId} FOR NO KEY UPDATE`;
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

/**
 * Rotulo padrao "PO N" com N unico na cotacao (sem diferenciar maiusculas):
 * o primeiro N >= startAt cujo rotulo ainda nao existe. "PO " + inteiro fica
 * sempre muito abaixo do limite de 60 caracteres (purchaseOrderLabelField).
 */
export function nextDefaultPurchaseOrderLabel(existingLabels: string[], startAt: number): string {
  const taken = new Set(existingLabels.map((l) => l.trim().toLowerCase()));
  let n = Math.max(1, startAt);
  while (taken.has(`po ${n}`)) n += 1;
  return `PO ${n}`;
}

export async function createPurchaseOrder(
  tx: Tx,
  input: { quoteRequestId: number; label?: string; adoptUnassigned?: boolean },
): Promise<{ purchaseOrder: PurchaseOrderDTO; movedItemIds: number[] }> {
  await lockQuoteRequestForPurchaseOrders(tx, input.quoteRequestId);
  const existing: { position: number; label: string }[] =
    await tx.quoteRequestPurchaseOrder.findMany({
      where: { quoteRequestId: input.quoteRequestId },
      select: { position: true, label: true },
    });
  const position = existing.reduce((max, o) => Math.max(max, o.position), 0) + 1;
  const purchaseOrder = await tx.quoteRequestPurchaseOrder.create({
    data: {
      quoteRequestId: input.quoteRequestId,
      label:
        input.label?.trim() ||
        nextDefaultPurchaseOrderLabel(
          existing.map((o) => o.label),
          position,
        ),
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
  await lockQuoteRequestForPurchaseOrders(tx, quoteRequestId);
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
  await lockQuoteRequestForPurchaseOrders(tx, purchaseOrder.quoteRequestId);
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
