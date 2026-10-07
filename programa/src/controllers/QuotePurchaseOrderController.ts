import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  createPurchaseOrder,
  deletePurchaseOrderWithReallocation,
  groupPurchaseOrders,
  renamePurchaseOrder,
  reorderPurchaseOrders,
} from '../services/QuotePurchaseOrderService';
import { handleControllerError, HttpError, parseId } from '../utils/http';
import {
  purchaseOrderCreateSchema,
  purchaseOrderRenameSchema,
  purchaseOrderReorderSchema,
} from '../validators/domain';

function ensureOpen(status: string, message: string): void {
  if (status === 'closed') {
    throw new HttpError(400, message);
  }
}

async function loadOpenQuote(quoteRequestId: number | null) {
  if (!quoteRequestId) {
    throw new HttpError(400, 'ID da cotacao invalido.');
  }
  const quote = await prisma.quoteRequest.findFirst({
    where: { id: quoteRequestId, deletedAt: null },
  });
  if (!quote) {
    throw new HttpError(404, 'Cotacao nao encontrada.');
  }
  ensureOpen(quote.status, 'Reabra a cotacao antes de alterar as POs.');
  return quote;
}

async function loadPurchaseOrder(id: number | null) {
  if (!id) {
    throw new HttpError(400, 'ID da PO invalido.');
  }
  const po = await prisma.quoteRequestPurchaseOrder.findUnique({
    where: { id },
    include: { quoteRequest: true },
  });
  if (!po || po.quoteRequest.deletedAt) {
    throw new HttpError(404, 'PO nao encontrada.');
  }
  ensureOpen(po.quoteRequest.status, 'Reabra a cotacao antes de alterar as POs.');
  return po;
}

export class QuotePurchaseOrderController {
  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const quote = await loadOpenQuote(parseId(req.params.quoteRequestId));
      const body = purchaseOrderCreateSchema.parse(req.body ?? {});

      const result = await prisma.$transaction(async (tx) => {
        if (body.group) {
          const grouped = await groupPurchaseOrders(tx, quote.id);
          for (const createdId of grouped.createdIds) {
            const createdPo = grouped.purchaseOrders.find((o) => o.id === createdId);
            await AuditLogService.log(
              {
                entityType: 'quote_request_purchase_order',
                entityId: createdId,
                action: 'create',
                performedById: req.user?.id ?? null,
                afterData: createdPo ?? null,
                metadata: {
                  quoteRequestId: quote.id,
                  mode: 'group',
                  adoptedIntoPurchaseOrderId: grouped.adoptedIntoPurchaseOrderId,
                  movedItemIds: grouped.movedItemIds,
                },
              },
              tx,
            );
          }
          return {
            purchaseOrder: grouped.purchaseOrder,
            purchaseOrders: grouped.purchaseOrders,
            movedItemIds: grouped.movedItemIds,
          };
        }
        const created = await createPurchaseOrder(tx, {
          quoteRequestId: quote.id,
          label: body.label,
          adoptUnassigned: body.adoptUnassigned,
        });
        await AuditLogService.log(
          {
            entityType: 'quote_request_purchase_order',
            entityId: created.purchaseOrder.id,
            action: 'create',
            performedById: req.user?.id ?? null,
            afterData: created.purchaseOrder,
            metadata: {
              quoteRequestId: quote.id,
              movedItemIds: created.movedItemIds,
            },
          },
          tx,
        );
        return created;
      });

      return res.status(201).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async rename(req: Request, res: Response): Promise<Response> {
    try {
      const po = await loadPurchaseOrder(parseId(req.params.id));
      const body = purchaseOrderRenameSchema.parse(req.body ?? {});

      const updated = await prisma.$transaction(async (tx) => {
        const result = await renamePurchaseOrder(tx, po.id, body.label);
        await AuditLogService.log(
          {
            entityType: 'quote_request_purchase_order',
            entityId: po.id,
            action: 'rename',
            performedById: req.user?.id ?? null,
            beforeData: { label: po.label },
            afterData: { label: result.label },
            metadata: { quoteRequestId: po.quoteRequestId },
          },
          tx,
        );
        return result;
      });

      return res.status(200).json(updated);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async reorder(req: Request, res: Response): Promise<Response> {
    try {
      const quote = await loadOpenQuote(parseId(req.params.quoteRequestId));
      const body = purchaseOrderReorderSchema.parse(req.body ?? {});

      const result = await prisma.$transaction(async (tx) => {
        const ordered = await reorderPurchaseOrders(tx, quote.id, body.orderedIds);
        for (const po of ordered) {
          await AuditLogService.log(
            {
              entityType: 'quote_request_purchase_order',
              entityId: po.id,
              action: 'reorder',
              performedById: req.user?.id ?? null,
              afterData: { position: po.position, orderedIds: body.orderedIds },
              metadata: { quoteRequestId: quote.id },
            },
            tx,
          );
        }
        return ordered;
      });

      return res.status(200).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async delete(req: Request, res: Response): Promise<Response> {
    try {
      const po = await loadPurchaseOrder(parseId(req.params.id));

      const result = await prisma.$transaction(async (tx) => {
        const outcome = await deletePurchaseOrderWithReallocation(tx, {
          id: po.id,
          quoteRequestId: po.quoteRequestId,
        });
        await AuditLogService.log(
          {
            entityType: 'quote_request_purchase_order',
            entityId: po.id,
            action: 'delete',
            performedById: req.user?.id ?? null,
            beforeData: {
              label: po.label,
              position: po.position,
            },
            afterData: null,
            metadata: {
              quoteRequestId: po.quoteRequestId,
              reassignedToPurchaseOrderId: outcome.reassignedToPurchaseOrderId,
              movedItemIds: outcome.movedItemIds,
              dissolved: outcome.dissolved,
            },
          },
          tx,
        );
        if (outcome.dissolved && outcome.dissolvedPurchaseOrder) {
          const survivor = outcome.dissolvedPurchaseOrder;
          await AuditLogService.log(
            {
              entityType: 'quote_request_purchase_order',
              entityId: survivor.id,
              action: 'delete',
              performedById: req.user?.id ?? null,
              beforeData: { label: survivor.label, position: survivor.position },
              afterData: null,
              metadata: {
                quoteRequestId: po.quoteRequestId,
                reason: 'dissolve',
                triggeredByPurchaseOrderId: po.id,
                movedItemIds: outcome.movedItemIds,
              },
            },
            tx,
          );
        }
        return outcome;
      });

      return res.status(200).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
