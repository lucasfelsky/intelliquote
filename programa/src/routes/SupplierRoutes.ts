import { Router } from 'express';
import { SupplierController } from '../controllers/SupplierController';
import { SupplierImportController } from '../controllers/SupplierImportController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const supplierRoutes = Router();

// Rotas de importação em massa via planilha registradas ANTES de
// `GET /suppliers/:id`: senão `/suppliers/import/template` cai no `:id` e
// responde 400 "ID do fornecedor invalido".
supplierRoutes.get(
  '/suppliers/import/template',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierImportController.template,
);
supplierRoutes.post(
  '/suppliers/import',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierImportController.preview,
);
supplierRoutes.post(
  '/suppliers/import/confirm',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierImportController.confirm,
);

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
  allowRoles(['admin', 'comprador']),
  SupplierController.delete,
);

export { supplierRoutes };
