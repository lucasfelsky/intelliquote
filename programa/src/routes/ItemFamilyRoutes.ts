import { Router } from 'express';
import { ItemFamilyController } from '../controllers/ItemFamilyController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const router = Router();

router.get(
  '/item-families',
  requireAuth,
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
