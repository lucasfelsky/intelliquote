import { Router } from 'express';
import { SupplierDocumentController } from '../controllers/SupplierDocumentController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const supplierDocumentRoutes = Router();

// `/summary` registrada ANTES das rotas com `:id` para nao cair no parametro.
supplierDocumentRoutes.get(
  '/supplier-documents/summary',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  SupplierDocumentController.summary,
);
supplierDocumentRoutes.get(
  '/supplier-documents',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  SupplierDocumentController.list,
);
supplierDocumentRoutes.post(
  '/supplier-documents',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierDocumentController.create,
);
supplierDocumentRoutes.patch(
  '/supplier-documents/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierDocumentController.update,
);
supplierDocumentRoutes.put(
  '/supplier-documents/:id/file',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierDocumentController.replaceFile,
);
supplierDocumentRoutes.get(
  '/supplier-documents/:id/download',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  SupplierDocumentController.download,
);
supplierDocumentRoutes.delete(
  '/supplier-documents/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  SupplierDocumentController.remove,
);

export { supplierDocumentRoutes };
