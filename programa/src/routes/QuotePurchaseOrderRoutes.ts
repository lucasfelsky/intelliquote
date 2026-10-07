import { Router } from 'express';
import { QuotePurchaseOrderController } from '../controllers/QuotePurchaseOrderController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const quotePurchaseOrderRoutes = Router();
const writers = allowRoles(['admin', 'comprador']);

quotePurchaseOrderRoutes.post(
  '/quote-requests/:quoteRequestId/purchase-orders',
  requireAuth,
  writers,
  QuotePurchaseOrderController.create,
);
quotePurchaseOrderRoutes.put(
  '/quote-requests/:quoteRequestId/purchase-orders/order',
  requireAuth,
  writers,
  QuotePurchaseOrderController.reorder,
);
quotePurchaseOrderRoutes.patch(
  '/quote-request-purchase-orders/:id',
  requireAuth,
  writers,
  QuotePurchaseOrderController.rename,
);
quotePurchaseOrderRoutes.delete(
  '/quote-request-purchase-orders/:id',
  requireAuth,
  writers,
  QuotePurchaseOrderController.delete,
);

export { quotePurchaseOrderRoutes };
