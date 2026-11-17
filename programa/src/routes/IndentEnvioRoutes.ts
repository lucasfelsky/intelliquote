import { Router } from 'express';
import { IndentDispatchController } from '../controllers/IndentDispatchController';
import { COMEX_ROLES } from '../constants/roles';
import { allowRoles, requireAuth } from '../middlewares/auth';

// IQ Indent PR 4a: envio da cotacao ao fornecedor por e-mail, reenvio do link e estado do portal. Montado em /api/v1/indent
// (segundo router; o parser de corpo maior do /send fica em app.ts). Leitura: equipe COMEX; envio/reenvio: admin/comprador/gestor.
// `comercial` recebe 403 em tudo.
const indentEnvioRoutes = Router();

const canRead = allowRoles(COMEX_ROLES);
const canWrite = allowRoles(['admin', 'comprador', 'gestor']);

indentEnvioRoutes.get('/quotes/:id/send-context', requireAuth, canRead, IndentDispatchController.sendContext);
indentEnvioRoutes.post('/quotes/:id/send', requireAuth, canWrite, IndentDispatchController.send);
indentEnvioRoutes.post('/quotes/:id/resend', requireAuth, canWrite, IndentDispatchController.resend);
indentEnvioRoutes.get('/quotes/:id/portal', requireAuth, canRead, IndentDispatchController.portalState);

export { indentEnvioRoutes };
