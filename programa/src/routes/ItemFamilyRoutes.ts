import { Router } from 'express';
import { ItemFamilyController } from '../controllers/ItemFamilyController';
import { requireAuth } from '../middlewares/requireAuth';
import { allowRoles } from '../middlewares/allowRoles';

const router = Router();

router.get(
  '/',
  requireAuth,
  ItemFamilyController.listFamilies
);

router.post(
  '/',
  requireAuth,
  allowRoles(['admin', 'comprador']),
  ItemFamilyController.createFamily
);

export default router;
