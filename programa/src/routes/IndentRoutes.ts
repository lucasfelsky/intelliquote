import { Router } from 'express';
import { IndentClientController } from '../controllers/IndentClientController';
import { IndentImportController } from '../controllers/IndentImportController';
import { IndentProductController } from '../controllers/IndentProductController';
import { IndentRequestController } from '../controllers/IndentRequestController';
import { IndentSupplierController } from '../controllers/IndentSupplierController';
import { COMEX_ROLES } from '../constants/roles';
import { allowRoles, requireAuth } from '../middlewares/auth';

// IQ Indent (cadastros). Montado em /api/v1/indent. Sem rota de exclusao: inativar = PUT com isActive:false.
// Leitura: equipe COMEX. Escrita, vinculo de produtos e importacao (inclusive os candidatos): admin/comprador/gestor.
// `comercial` recebe 403 em tudo. Solicitacoes (PR 2): leitura = equipe COMEX; criar, confirmar itens e gerar cotacoes = admin/comprador/gestor.
const indentRoutes = Router();

const canRead = allowRoles(COMEX_ROLES);
const canWrite = allowRoles(['admin', 'comprador', 'gestor']);

indentRoutes.get('/clients', requireAuth, canRead, IndentClientController.list);
indentRoutes.post('/clients', requireAuth, canWrite, IndentClientController.create);
indentRoutes.put('/clients/:id/supplier-rule', requireAuth, canWrite, IndentClientController.setSupplierRule);
indentRoutes.put('/clients/:id', requireAuth, canWrite, IndentClientController.update);

indentRoutes.get('/suppliers/options', requireAuth, canRead, IndentSupplierController.options);
indentRoutes.get('/suppliers', requireAuth, canRead, IndentSupplierController.list);
indentRoutes.post('/suppliers', requireAuth, canWrite, IndentSupplierController.create);
indentRoutes.put('/suppliers/:id/products', requireAuth, canWrite, IndentSupplierController.setProducts);
indentRoutes.put('/suppliers/:id', requireAuth, canWrite, IndentSupplierController.update);

indentRoutes.get('/products/options', requireAuth, canRead, IndentProductController.options);
indentRoutes.get('/products', requireAuth, canRead, IndentProductController.list);
indentRoutes.post('/products', requireAuth, canWrite, IndentProductController.create);
indentRoutes.post('/products/:id/promote', requireAuth, canWrite, IndentProductController.promote);
indentRoutes.put('/products/:id', requireAuth, canWrite, IndentProductController.update);

// Solicitacoes (PR 2). As rotas estaticas vem antes de /requests/:id.
indentRoutes.get('/requests/new-count', requireAuth, canRead, IndentRequestController.newCount);
indentRoutes.get('/requests/client-options', requireAuth, canRead, IndentRequestController.clientOptions);
indentRoutes.get('/requests', requireAuth, canRead, IndentRequestController.list);
indentRoutes.post('/requests', requireAuth, canWrite, IndentRequestController.create);
indentRoutes.get('/requests/:id/supplier-options', requireAuth, canRead, IndentRequestController.supplierOptions);
indentRoutes.post('/requests/:id/items/confirm', requireAuth, canWrite, IndentRequestController.confirmItems);
indentRoutes.post('/requests/:id/quotes', requireAuth, canWrite, IndentRequestController.generateQuotes);
indentRoutes.get('/requests/:id', requireAuth, canRead, IndentRequestController.getById);

indentRoutes.get('/import/suppliers', requireAuth, canWrite, IndentImportController.supplierCandidates);
indentRoutes.post('/import/suppliers', requireAuth, canWrite, IndentImportController.importSuppliers);
indentRoutes.get('/import/products', requireAuth, canWrite, IndentImportController.productCandidates);
indentRoutes.post('/import/products', requireAuth, canWrite, IndentImportController.importProducts);

export { indentRoutes };
