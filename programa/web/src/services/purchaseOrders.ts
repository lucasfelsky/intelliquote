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
  movedItemIds: number[];
}

export interface DeletePurchaseOrderResult {
  deletedId: number;
  reassignedToPurchaseOrderId: number | null;
  movedItemIds: number[];
}

export function createPurchaseOrder(
  quoteRequestId: number,
  body: { label?: string; adoptUnassigned?: boolean } = {},
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
