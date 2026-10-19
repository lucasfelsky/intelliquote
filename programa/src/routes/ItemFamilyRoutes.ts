import { Router } from 'express';
import { ItemFamilyController } from '../controllers/ItemFamilyController';
import { allowRoles, requireAuth } from '../middlewares/auth';
import { COMEX_ROLES } from '../constants/roles';

const router = Router();

router.get(
  '/item-families',
  requireAuth,
  allowRoles(COMEX_ROLES),
  ItemFamilyController.listFamilies
);

router.post(
  '/item-families',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ItemFamilyController.createFamily
);

router.put(
  '/item-families/:id',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ItemFamilyController.updateFamily
);

export { router as itemFamilyRoutes };
