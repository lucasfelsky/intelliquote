import { Router } from 'express';
import { AuditLogController } from '../controllers/AuditLogController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const auditRoutes = Router();

auditRoutes.get(
  '/audit',
  requireAuth,
  allowRoles(['admin', 'gestor']),
  AuditLogController.getAll,
);

export { auditRoutes };
