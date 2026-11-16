import { Router } from 'express';
import { IndentClientController } from '../controllers/IndentClientController';
import { IndentImportController } from '../controllers/IndentImportController';
import { IndentPendingOrgController } from '../controllers/IndentPendingOrgController';
import { IndentPipedriveController } from '../controllers/IndentPipedriveController';
import { IndentProductController } from '../controllers/IndentProductController';
import { IndentQuoteController } from '../controllers/IndentQuoteController';
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
const adminOnly = allowRoles(['admin']);

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
indentRoutes.delete('/products/:id', requireAuth, canWrite, IndentProductController.remove);

// Solicitacoes (PR 2). As rotas estaticas vem antes de /requests/:id.
indentRoutes.get('/requests/new-count', requireAuth, canRead, IndentRequestController.newCount);
indentRoutes.get('/requests/client-options', requireAuth, canRead, IndentRequestController.clientOptions);
indentRoutes.get('/requests', requireAuth, canRead, IndentRequestController.list);
indentRoutes.post('/requests', requireAuth, canWrite, IndentRequestController.create);
indentRoutes.get('/requests/:id/supplier-options', requireAuth, canRead, IndentRequestController.supplierOptions);
indentRoutes.post('/requests/:id/items/confirm', requireAuth, canWrite, IndentRequestController.confirmItems);
indentRoutes.post('/requests/:id/quotes', requireAuth, canWrite, IndentRequestController.generateQuotes);
// PR 5a.3 (Pipedrive): referencia pendente e confirmacao humana dos itens da nota (admin/comprador/gestor).
indentRoutes.put('/requests/:id/reference', requireAuth, canWrite, IndentRequestController.setReference);
indentRoutes.put('/requests/:id/note-items', requireAuth, canWrite, IndentRequestController.updateNoteItems);
indentRoutes.get('/requests/:id', requireAuth, canRead, IndentRequestController.getById);

// Cotacoes (PR 3). Leitura = equipe COMEX; as 6 acoes = admin/comprador/gestor (viewer le sem agir; comercial 403 em tudo). Sem DELETE.
indentRoutes.get('/quotes', requireAuth, canRead, IndentQuoteController.list);
indentRoutes.get('/quotes/:id', requireAuth, canRead, IndentQuoteController.getById);
indentRoutes.post('/quotes/:id/mark-sent', requireAuth, canWrite, IndentQuoteController.markSent);
indentRoutes.post('/quotes/:id/items', requireAuth, canWrite, IndentQuoteController.addFreeItem);
indentRoutes.post('/quotes/:id/response', requireAuth, canWrite, IndentQuoteController.recordResponse);
indentRoutes.post('/quotes/:id/accept', requireAuth, canWrite, IndentQuoteController.accept);
indentRoutes.post('/quotes/:id/refuse', requireAuth, canWrite, IndentQuoteController.refuse);
indentRoutes.post('/quotes/:id/revision', requireAuth, canWrite, IndentQuoteController.requestRevision);

// Integracao Pipedrive (PR 5a.2; SO LEITURA no CRM). Estado = leitura COMEX; sincronizar = admin/comprador/gestor; opcoes e configuracao = so admin.
// Rotas estaticas (nunca colidem com /requests/:id). Sem DELETE.
indentRoutes.get('/pipedrive/status', requireAuth, canRead, IndentPipedriveController.status);
indentRoutes.get('/pipedrive/options', requireAuth, adminOnly, IndentPipedriveController.options);
indentRoutes.put('/pipedrive/config', requireAuth, adminOnly, IndentPipedriveController.updateConfig);
indentRoutes.post('/pipedrive/sync', requireAuth, canWrite, IndentPipedriveController.sync);

// Fila de vinculo (PR 5a.3): organizacao do Pipedrive sem cliente. Leitura = equipe COMEX; criar cliente e vincular = admin/comprador/gestor.
indentRoutes.get('/pending-orgs', requireAuth, canRead, IndentPendingOrgController.list);
indentRoutes.post('/pending-orgs/:id/create-client', requireAuth, canWrite, IndentPendingOrgController.createClient);
indentRoutes.post('/pending-orgs/:id/link', requireAuth, canWrite, IndentPendingOrgController.link);

indentRoutes.get('/import/suppliers', requireAuth, canWrite, IndentImportController.supplierCandidates);
indentRoutes.post('/import/suppliers', requireAuth, canWrite, IndentImportController.importSuppliers);
indentRoutes.get('/import/products', requireAuth, canWrite, IndentImportController.productCandidates);
indentRoutes.post('/import/products', requireAuth, canWrite, IndentImportController.importProducts);

export { indentRoutes };
