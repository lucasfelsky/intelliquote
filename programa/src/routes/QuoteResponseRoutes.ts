import { Router } from 'express';
import { QuoteResponseController } from '../controllers/QuoteResponseController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const quoteResponseRoutes = Router();

quoteResponseRoutes.post(
  '/quote-responses',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  QuoteResponseController.create,
);
quoteResponseRoutes.get(
  '/quote-responses',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  QuoteResponseController.getAll,
);
quoteResponseRoutes.get(
  '/quote-responses/:id',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  QuoteResponseController.getById,
);
quoteResponseRoutes.put(
  '/quote-responses/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  QuoteResponseController.update,
);
quoteResponseRoutes.delete(
  '/quote-responses/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  QuoteResponseController.delete,
);
quoteResponseRoutes.post(
  '/quote-responses/:id/reply/preview',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  QuoteResponseController.replyPreview,
);
quoteResponseRoutes.post(
  '/quote-responses/:id/reply',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  QuoteResponseController.reply,
);
quoteResponseRoutes.post(
  '/quote-responses/:id/purchase-order',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  QuoteResponseController.sendPurchaseOrder,
);
quoteResponseRoutes.post(
  '/quote-requests/:quoteRequestId/compare',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor']),
  QuoteResponseController.compareByQuoteRequest,
);
quoteResponseRoutes.get(
  '/quote-requests/:quoteRequestId/comparisons',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  QuoteResponseController.getComparisonHistoryByQuoteRequest,
);
quoteResponseRoutes.post(
  '/quote-requests/:quoteRequestId/comparisons/:comparisonId/approve',
  requireAuth,
  allowRoles(['admin', 'gestor']),
  QuoteResponseController.approveAward,
);
quoteResponseRoutes.post(
  '/quote-requests/:quoteRequestId/winner',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor']),
  QuoteResponseController.setManualWinner,
);

quoteResponseRoutes.get(
  '/quote-responses/:id/target-price-history',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  QuoteResponseController.getTargetPriceHistory,
);

export { quoteResponseRoutes };
