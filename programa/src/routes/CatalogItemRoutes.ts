import { Router } from 'express';
import { CatalogItemController } from '../controllers/CatalogItemController';
import { CatalogItemImportController } from '../controllers/CatalogItemImportController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const catalogItemRoutes = Router();
catalogItemRoutes.post(
  '/catalog-items/import',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  CatalogItemImportController.preview,
);

catalogItemRoutes.post(
  '/catalog-items/import/confirm',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  CatalogItemImportController.confirm,
);

catalogItemRoutes.get(
  '/catalog-items',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  CatalogItemController.list,
);

catalogItemRoutes.get(
  '/catalog-items/:id',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  CatalogItemController.getById,
);

catalogItemRoutes.post(
  '/catalog-items',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  CatalogItemController.create,
);

catalogItemRoutes.put(
  '/catalog-items/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  CatalogItemController.update,
);

catalogItemRoutes.delete(
  '/catalog-items/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  CatalogItemController.softDelete,
);

export { catalogItemRoutes };
