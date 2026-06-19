import { Router } from 'express';
import { SupplierContactController } from '../controllers/SupplierContactController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const supplierContactRoutes = Router();

// Rotas flat (legacy /api/v1/supplier-contacts com supplierId no body)
supplierContactRoutes.get(
  '/supplier-contacts',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  SupplierContactController.list,
);
supplierContactRoutes.post(
  '/supplier-contacts',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierContactController.create,
);
supplierContactRoutes.put(
  '/supplier-contacts/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierContactController.update,
);
supplierContactRoutes.delete(
  '/supplier-contacts/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierContactController.delete,
);

// Rotas nested usadas pelo frontend (/suppliers/:supplierId/contacts/:id?)
supplierContactRoutes.get(
  '/suppliers/:supplierId/contacts',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  SupplierContactController.list,
);
supplierContactRoutes.post(
  '/suppliers/:supplierId/contacts',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierContactController.create,
);
supplierContactRoutes.put(
  '/suppliers/:supplierId/contacts/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierContactController.update,
);
supplierContactRoutes.delete(
  '/suppliers/:supplierId/contacts/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierContactController.delete,
);

export { supplierContactRoutes };
