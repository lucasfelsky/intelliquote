import path from 'path';
import { Router } from 'express';
import { AttachmentController } from '../controllers/AttachmentController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const attachmentRoutes = Router();

attachmentRoutes.get(
  '/attachments',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  AttachmentController.list,
);
attachmentRoutes.post(
  '/attachments',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor']),
  AttachmentController.create,
);
attachmentRoutes.get(
  '/attachments/:id/download',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  AttachmentController.download,
);
attachmentRoutes.delete(
  '/attachments/:id',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor']),
  AttachmentController.delete,
);

export { attachmentRoutes };
export const attachmentUploadsDir = path.join(process.cwd(), 'uploads', 'attachments');
