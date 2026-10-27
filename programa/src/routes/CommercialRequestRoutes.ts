import { Router } from 'express';
import { CommercialRequestController } from '../controllers/CommercialRequestController';
import { allowRoles, requireAuth } from '../middlewares/auth';
import { COMEX_ROLES } from '../constants/roles';

const commercialRequestRoutes = Router();

const comercialOnly = [requireAuth, allowRoles(['comercial'])] as const;
const comexRead = [requireAuth, allowRoles(COMEX_ROLES)] as const;
const comexAct = [requireAuth, allowRoles(['admin', 'comprador'])] as const;

// Rotas fixas SEMPRE antes de /:id.
commercialRequestRoutes.get(
  '/commercial-requests/catalog-items',
  ...comercialOnly,
  CommercialRequestController.searchCatalogItems,
);
commercialRequestRoutes.get(
  '/commercial-requests/mine',
  ...comercialOnly,
  CommercialRequestController.listMine,
);
commercialRequestRoutes.get(
  '/commercial-requests/pending-count',
  ...comexRead,
  CommercialRequestController.pendingCount,
);
commercialRequestRoutes.get(
  '/commercial-requests/requesters',
  ...comexRead,
  CommercialRequestController.listRequesters,
);
commercialRequestRoutes.post(
  '/commercial-requests',
  ...comercialOnly,
  CommercialRequestController.create,
);
commercialRequestRoutes.get(
  '/commercial-requests',
  ...comexRead,
  CommercialRequestController.list,
);
commercialRequestRoutes.get(
  '/commercial-requests/:id',
  ...comexRead,
  CommercialRequestController.getById,
);

// Acoes do COMEX (PR2): admin e comprador. gestor/viewer so leem.
commercialRequestRoutes.post(
  '/commercial-requests/:id/link-quote',
  ...comexAct,
  CommercialRequestController.linkQuote,
);
commercialRequestRoutes.post(
  '/commercial-requests/:id/items/:itemId/catalog',
  ...comexAct,
  CommercialRequestController.linkItemToCatalog,
);
commercialRequestRoutes.post(
  '/commercial-requests/:id/reject',
  ...comexAct,
  CommercialRequestController.reject,
);
commercialRequestRoutes.post(
  '/commercial-requests/:id/fulfill',
  ...comexAct,
  CommercialRequestController.fulfill,
);

export { commercialRequestRoutes };
