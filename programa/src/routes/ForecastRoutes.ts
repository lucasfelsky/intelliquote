import { Router } from 'express';
import { ForecastController } from '../controllers/ForecastController';
import { allowRoles, requireAuth } from '../middlewares/auth';
import { COMEX_ROLES } from '../constants/roles';

const router = Router();

// Importar pela planilha (.xlsx) = so admin (ferramenta de validacao/migracao); importar DBCorp e as demais escritas = admin/comprador; leitura = equipe COMEX. `comercial` nao entra.
router.post(
  '/forecast/import/workbook/preview',
  requireAuth,
  allowRoles(['admin']),
  ForecastController.previewWorkbook,
);

router.post(
  '/forecast/import/workbook/confirm',
  requireAuth,
  allowRoles(['admin']),
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

// Reativa produto inativo (ex.: inativado pelo import da planilha); so o flag, sem mexer em codigos nem marcas.
router.post(
  '/forecast/products/:id/reativar',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.reativarProduto,
);

router.get(
  '/forecast/products/:id/embalagens',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.getEmbalagens,
);

// Ultimo preco negociado (proposta vencedora direta mais recente): so leitura, sem AuditLog.
router.get(
  '/forecast/products/:id/ultimo-preco',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.getUltimoPreco,
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

// Ocasioes que afetam o lead time (feriado, greve, fechamento de porto): por ora so informam no relatorio. Leitura =
// equipe COMEX (com janela, expande a recorrencia); criar, editar e apagar = admin/comprador. `comercial` nao entra.
router.get(
  '/forecast/lead-time-events',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.listOcasioes,
);

router.post(
  '/forecast/lead-time-events',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.createOcasiao,
);

router.patch(
  '/forecast/lead-time-events/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.patchOcasiao,
);

router.delete(
  '/forecast/lead-time-events/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.deleteOcasiao,
);

router.get('/forecast/snapshots', requireAuth, allowRoles(COMEX_ROLES), ForecastController.listSnapshots);

router.get(
  '/forecast/snapshots/:id',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.getSnapshot,
);

// Excluir quinzena = soft delete; admin/comprador.
router.delete(
  '/forecast/snapshots/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.deleteSnapshot,
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

// Quantidade decidida de compra por item e quinzena (PR3): ler = equipe COMEX; gravar/apagar = admin/comprador.
router.get(
  '/forecast/snapshots/:id/decisoes',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ForecastController.listDecisoes,
);

router.put(
  '/forecast/snapshots/:id/decisoes/:productId',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForecastController.putDecisao,
);

export { router as forecastRoutes };
