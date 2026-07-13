import { Router } from 'express';
import { ReportController } from '../controllers/ReportController';
import { HelpController } from '../controllers/HelpController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const reportRoutes = Router();

reportRoutes.get(
  '/reports/summary',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  ReportController.summary,
);
reportRoutes.get(
  '/reports/savings',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  ReportController.savings,
);
reportRoutes.get(
  '/reports/lead-time',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  ReportController.leadTime,
);
reportRoutes.get(
  '/reports/top-suppliers',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  ReportController.topSuppliers,
);
reportRoutes.get(
  '/reports/award-rate',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  ReportController.awardRate,
);
reportRoutes.get(
  '/reports/supplier-engagement',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  ReportController.supplierEngagement,
);
reportRoutes.get(
  '/reports/price-history',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  ReportController.priceHistory,
);

reportRoutes.get(
  '/help/articles',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  HelpController.list,
);

export { reportRoutes };
