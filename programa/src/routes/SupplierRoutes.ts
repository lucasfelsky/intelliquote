import { Router } from 'express';
import { SupplierController } from '../controllers/SupplierController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const supplierRoutes = Router();

supplierRoutes.post(
  '/suppliers',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierController.create,
);
supplierRoutes.get(
  '/suppliers',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  SupplierController.getAll,
);
supplierRoutes.get(
  '/suppliers/:id',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  SupplierController.getById,
);
supplierRoutes.put(
  '/suppliers/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierController.update,
);
supplierRoutes.delete(
  '/suppliers/:id',
  requireAuth,
  allowRoles(['admin']),
  SupplierController.delete,
);

export { supplierRoutes };
