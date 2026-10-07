import { Router } from 'express';
import { CreditPartnerController } from '../controllers/CreditPartnerController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const creditPartnerRoutes = Router();

creditPartnerRoutes.get(
  '/credit-partners',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  CreditPartnerController.list,
);
creditPartnerRoutes.post(
  '/credit-partners',
  requireAuth,
  allowRoles(['admin', 'gestor']),
  CreditPartnerController.create,
);
creditPartnerRoutes.put(
  '/credit-partners/:id',
  requireAuth,
  allowRoles(['admin', 'gestor']),
  CreditPartnerController.update,
);
creditPartnerRoutes.delete(
  '/credit-partners/:id',
  requireAuth,
  allowRoles(['admin', 'gestor']),
  CreditPartnerController.remove,
);

export { creditPartnerRoutes };
