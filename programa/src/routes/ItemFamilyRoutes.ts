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

export { router as itemFamilyRoutes };
