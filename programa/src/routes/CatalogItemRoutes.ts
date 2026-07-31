import { Router } from 'express';
import { CatalogItemController } from '../controllers/CatalogItemController';
import { CatalogItemImportController } from '../controllers/CatalogItemImportController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const catalogItemRoutes = Router();
const importController = new CatalogItemImportController();

catalogItemRoutes.post(
  '/catalog-items/import',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  importController.preview,
);

catalogItemRoutes.post(
  '/catalog-items/import/confirm',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  importController.confirm,
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
