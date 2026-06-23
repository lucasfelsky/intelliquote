import { Router } from 'express';
import { QuoteRequestController } from '../controllers/QuoteRequestController';
import { DispatchController } from '../controllers/DispatchController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const quoteRequestRoutes = Router();

quoteRequestRoutes.post(
  '/quote-requests',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  QuoteRequestController.create,
);
quoteRequestRoutes.get(
  '/quote-requests',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  QuoteRequestController.getAll,
);
quoteRequestRoutes.get(
  '/quote-requests/:id',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  QuoteRequestController.getById,
);
quoteRequestRoutes.put(
  '/quote-requests/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  QuoteRequestController.update,
);
quoteRequestRoutes.post(
  '/quote-requests/:id/close',
  requireAuth,
  allowRoles(['admin', 'gestor']),
  QuoteRequestController.close,
);
quoteRequestRoutes.post(
  '/quote-requests/:id/reopen',
  requireAuth,
  allowRoles(['admin', 'gestor']),
  QuoteRequestController.reopen,
);
quoteRequestRoutes.delete(
  '/quote-requests/:id',
  requireAuth,
  allowRoles(['admin']),
  QuoteRequestController.delete,
);

quoteRequestRoutes.post(
  '/quote-requests/:id/dispatch/preview',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  DispatchController.preview,
);
quoteRequestRoutes.post(
  '/quote-requests/:id/dispatch',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  DispatchController.create,
);
quoteRequestRoutes.get(
  '/quote-requests/:id/dispatches',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  DispatchController.list,
);
quoteRequestRoutes.post(
  '/portal-tokens/:id/revoke',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor']),
  DispatchController.revokeToken,
);

quoteRequestRoutes.get(
  '/quote-requests/:id/portal-tokens',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  DispatchController.listPortalTokens,
);

quoteRequestRoutes.post(
  '/quote-requests/:id/portal-tokens',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  DispatchController.generatePortalTokens,
);

export { quoteRequestRoutes };
