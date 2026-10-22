import { Router } from 'express';
import { ForecastController } from '../controllers/ForecastController';
import { allowRoles, requireAuth } from '../middlewares/auth';
import { COMEX_ROLES } from '../constants/roles';

const router = Router();

// Escrita (importar, editar fonte) = admin/comprador; leitura = equipe COMEX. `comercial` nao entra.
router.post(
  '/forecast/import/workbook/preview',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.previewWorkbook,
);

router.post(
  '/forecast/import/workbook/confirm',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.confirmWorkbook,
);

router.post(
  '/forecast/import/dbcorp/preview',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.previewDbcorp,
);

router.post(
  '/forecast/import/dbcorp/confirm',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.confirmDbcorp,
);

router.get('/forecast/sources', requireAuth, allowRoles(COMEX_ROLES), ForecastController.listSources);

router.patch(
  '/forecast/sources/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.patchSource,
);

router.get('/forecast/products', requireAuth, allowRoles(COMEX_ROLES), ForecastController.listProducts);

router.get('/forecast/snapshots', requireAuth, allowRoles(COMEX_ROLES), ForecastController.listSnapshots);

router.get(
  '/forecast/snapshots/:id',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.getSnapshot,
);

router.get(
  '/forecast/snapshots/:id/relatorio-compras',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.getRelatorioCompras,
);

router.get(
  '/forecast/snapshots/:id/relatorio-compras/xlsx',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.getRelatorioComprasXlsx,
);

export { router as forecastRoutes };
