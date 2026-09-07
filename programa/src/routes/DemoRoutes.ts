import { Router } from 'express';
import { DemoController } from '../controllers/DemoController';

// Rota da area de teste (demo), fora do prefixo /api/v1 — igual ao padrao
// do portal publico do fornecedor (PortalRoutes.ts). Sem `requireAuth`: a
// protecao real e' a dupla guarda dentro do controller (DEMO_MODE + token).
const demoRoutes = Router();

demoRoutes.post('/admin/demo/reset', DemoController.reset);

export { demoRoutes };
