import { api } from '@/api/client';

export interface PurchaseOrder {
  id: number;
  quoteRequestId: number;
  label: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePurchaseOrderResult {
  purchaseOrder: PurchaseOrder;
  /** Presente quando o POST usou group: true (lista final das 2 POs, por position). */
  purchaseOrders?: PurchaseOrder[];
  movedItemIds: number[];
}

export interface DeletePurchaseOrderResult {
  deletedId: number;
  reassignedToPurchaseOrderId: number | null;
  movedItemIds: number[];
  /** true quando sobrava 1 PO e o agrupamento foi desfeito (as 2 POs foram removidas). */
  dissolved: boolean;
  dissolvedPurchaseOrder: { id: number; label: string; position: number } | null;
}

export function createPurchaseOrder(
  quoteRequestId: number,
  body: { label?: string; adoptUnassigned?: boolean; group?: boolean } = {},
): Promise<CreatePurchaseOrderResult> {
  return api.post<CreatePurchaseOrderResult>(
    `/v1/quote-requests/${quoteRequestId}/purchase-orders`,
    body,
  );
}

export function renamePurchaseOrder(id: number, label: string): Promise<PurchaseOrder> {
  return api.patch<PurchaseOrder>(`/v1/quote-request-purchase-orders/${id}`, { label });
}

export function reorderPurchaseOrders(
  quoteRequestId: number,
  orderedIds: number[],
): Promise<PurchaseOrder[]> {
  return api.put<PurchaseOrder[]>(
    `/v1/quote-requests/${quoteRequestId}/purchase-orders/order`,
    { orderedIds },
  );
}

export function deletePurchaseOrder(id: number): Promise<DeletePurchaseOrderResult> {
  return api.del<DeletePurchaseOrderResult>(`/v1/quote-request-purchase-orders/${id}`);
}

export function moveItemToPurchaseOrder(
  itemId: number,
  purchaseOrderId: number | null,
): Promise<unknown> {
  return api.patch<unknown>(`/v1/quote-request-items/${itemId}/purchase-order`, {
    purchaseOrderId,
  });
}
