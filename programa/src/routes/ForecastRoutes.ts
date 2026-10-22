import { Router } from 'express';
import { ForecastController } from '../controllers/ForecastController';
import { allowRoles, requireAuth } from '../middlewares/auth';
import { COMEX_ROLES } from '../constants/roles';

const router = Router();

// Escrita (importar, editar fonte, editar embalagem) = admin/comprador; leitura = equipe COMEX. `comercial` nao entra.
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

// Produto novo a partir de um pendente de cadastro (3B): cria com fonte/familia/codigos e acrescenta codigo.
router.post(
  '/forecast/products',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.createProduct,
);

router.post(
  '/forecast/products/:id/codigos',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.addProductCode,
);

router.get(
  '/forecast/products/:id/embalagens',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.getEmbalagens,
);

router.patch(
  '/forecast/products/:id/embalagens',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.patchEmbalagens,
);

// Marca "compra sob demanda" do produto (PR 6a): sai da lista de compra do relatorio, com o motivo.
router.patch(
  '/forecast/products/:id/compra-sob-demanda',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.patchSobDemanda,
);

router.get('/forecast/snapshots', requireAuth, allowRoles(COMEX_ROLES), ForecastController.listSnapshots);

router.get(
  '/forecast/snapshots/:id',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.getSnapshot,
);

router.get(
  '/forecast/snapshots/:id/pendentes',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.getPendentes,
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
