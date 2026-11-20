import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { authEnv } from '../config/env';
import { CommercialRequestController } from '../controllers/CommercialRequestController';
import { CommercialRequestAttachmentController } from '../controllers/CommercialRequestAttachmentController';
import { allowRoles, requireAuth } from '../middlewares/auth';
import { COMEX_ROLES } from '../constants/roles';

const commercialRequestRoutes = Router();

const comercialOnly = [requireAuth, allowRoles(['comercial'])] as const;
const comexRead = [requireAuth, allowRoles(COMEX_ROLES)] as const;
const comexAct = [requireAuth, allowRoles(['admin', 'comprador'])] as const;

// Rate limit dos anexos: um balde unico para as 3 rotas, por usuario autenticado (nao por IP),
// em memoria por instancia. Roda depois de requireAuth/allowRoles, entao 401/403 nao consomem.
// Nao confundir com o `limit` do CommercialRequestAttachmentService (teto de 5 anexos, 409).
const commercialRequestAttachmentRateLimit = rateLimit({
  windowMs: authEnv.commercialRequestAttachmentRateLimitWindowMs,
  limit: authEnv.commercialRequestAttachmentRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip ?? '')),
  message: {
    message: 'Muitas tentativas. Tente novamente mais tarde.',
  },
});

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

// Anexos tecnicos (TDS/MSDS) da solicitacao de desenvolvimento. So o comercial dono anexa/remove
// (a posse e conferida no service: outro comercial recebe 404); COMEX e o dono baixam.
commercialRequestRoutes.post(
  '/commercial-requests/:id/attachments',
  ...comercialOnly,
  commercialRequestAttachmentRateLimit,
  CommercialRequestAttachmentController.upload,
);
commercialRequestRoutes.delete(
  '/commercial-requests/:id/attachments/:attachmentId',
  ...comercialOnly,
  commercialRequestAttachmentRateLimit,
  CommercialRequestAttachmentController.remove,
);
commercialRequestRoutes.get(
  '/commercial-requests/:id/attachments/:attachmentId/download',
  requireAuth,
  allowRoles([...COMEX_ROLES, 'comercial']),
  commercialRequestAttachmentRateLimit,
  CommercialRequestAttachmentController.download,
);

export { commercialRequestRoutes };
