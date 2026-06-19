import { Router } from 'express';
import { tryFirebaseAuth } from '../middlewares/firebaseAuth';

/**
 * Router dedicado a endpoints consumidos pelo Portal COMEX
 * atraves do subdominio intelliquote.portal-comex.com.
 *
 * O middleware `tryFirebaseAuth` popula `req.user` se o cabecalho
 * Authorization trouxer um Firebase ID Token valido. Caso contrario
 * (rotas publicas como health check), segue adiante.
 */
const router = Router();

router.use(tryFirebaseAuth);

router.get('/api/v1/whoami', (req, res) => {
  if (!req.user) {
    res.status(200).json({ authenticated: false });
    return;
  }
  res.status(200).json({
    authenticated: true,
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

export { router as portalIntegrationsRoutes };
