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
// Prazo real medio por fonte (3C): so leitura, calculado da ultima quinzena DBCorp.
router.get('/forecast/sources/prazo-real', requireAuth, allowRoles(COMEX_ROLES), ForecastController.getPrazoReal);

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

// Meses de venda atipica do produto (PR 6c): ficam fora das medias trimestral/semestral. Substitui o conjunto.
router.put(
  '/forecast/products/:id/meses-atipicos',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.putMesesAtipicos,
);

// Demanda do comercial (PR 6d): compra pedida pelo comercial por programacao futura, lancada a mao pelo COMEX.
// Leitura = equipe COMEX; lancar, editar e fechar = admin/comprador. `comercial` nao entra.
router.get(
  '/forecast/commercial-demands',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.listDemandasComerciais,
);

router.post(
  '/forecast/commercial-demands',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.createDemandaComercial,
);

router.patch(
  '/forecast/commercial-demands/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.patchDemandaComercial,
);

// Grupos de equivalencia (PR 6b): produtos que sao o mesmo material tem o estoque avaliado somado no relatorio.
// Leitura = equipe COMEX; criar, editar e desfazer = admin/comprador. `comercial` nao entra.
router.get(
  '/forecast/equivalence-groups',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.listGruposEquivalencia,
);

router.post(
  '/forecast/equivalence-groups',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.createGrupoEquivalencia,
);

router.patch(
  '/forecast/equivalence-groups/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.patchGrupoEquivalencia,
);

router.delete(
  '/forecast/equivalence-groups/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.deleteGrupoEquivalencia,
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
