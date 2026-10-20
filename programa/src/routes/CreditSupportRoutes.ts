import { Router } from 'express';
import { CreditSupportController } from '../controllers/CreditSupportController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const creditSupportRoutes = Router();

creditSupportRoutes.post(
  '/quote-responses/:id/credit-support/preview',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  CreditSupportController.preview,
);
creditSupportRoutes.post(
  '/quote-responses/:id/credit-support',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  CreditSupportController.forward,
);
creditSupportRoutes.get(
  '/quote-requests/:id/credit-support',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  CreditSupportController.listByQuoteRequest,
);
creditSupportRoutes.post(
  '/credit-support-requests/:id/revoke',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor']),
  CreditSupportController.revoke,
);
creditSupportRoutes.post(
  '/credit-support-requests/:id/resend',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor']),
  CreditSupportController.resend,
);
creditSupportRoutes.post(
  '/credit-support-requests/:id/purchase-order',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  CreditSupportController.sendPurchaseOrder,
);
creditSupportRoutes.get(
  '/credit-support-requests/:id/purchase-order/recipients',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  CreditSupportController.purchaseOrderRecipients,
);

export { creditSupportRoutes };
