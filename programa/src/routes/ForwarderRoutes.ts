import { Router } from 'express';
import { ForwarderController } from '../controllers/ForwarderController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const forwarderRoutes = Router();

forwarderRoutes.get(
  '/forwarders',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  ForwarderController.list,
);
forwarderRoutes.post(
  '/forwarders',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForwarderController.create,
);
forwarderRoutes.put(
  '/forwarders/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForwarderController.update,
);
forwarderRoutes.delete(
  '/forwarders/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ForwarderController.remove,
);

export { forwarderRoutes };
