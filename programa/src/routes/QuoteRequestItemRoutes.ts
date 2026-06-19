import { Router } from 'express';
import { QuoteRequestItemController } from '../controllers/QuoteRequestItemController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const quoteRequestItemRoutes = Router();

quoteRequestItemRoutes.post(
  '/quote-requests/:quoteRequestId/items',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  QuoteRequestItemController.create,
);
quoteRequestItemRoutes.get(
  '/quote-request-items',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  QuoteRequestItemController.getAll,
);
quoteRequestItemRoutes.get(
  '/quote-request-items/:id',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  QuoteRequestItemController.getById,
);
quoteRequestItemRoutes.put(
  '/quote-request-items/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  QuoteRequestItemController.update,
);
quoteRequestItemRoutes.delete(
  '/quote-request-items/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  QuoteRequestItemController.delete,
);

export { quoteRequestItemRoutes };
