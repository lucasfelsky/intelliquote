import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { authEnv } from '../config/env';
import { AuthController } from '../controllers/AuthController';
import { FirebaseAuthController } from '../controllers/FirebaseAuthController';
import { PasswordRecoveryController } from '../controllers/PasswordRecoveryController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const authRoutes = Router();
const authRateLimit = rateLimit({
  windowMs: authEnv.authRateLimitWindowMs,
  max: authEnv.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Muitas tentativas. Tente novamente mais tarde.',
  },
});

authRoutes.post('/auth/login', authRateLimit, AuthController.login);
authRoutes.post('/auth/refresh', authRateLimit, AuthController.refresh);
authRoutes.post('/auth/firebase', authRateLimit, FirebaseAuthController.exchange);
authRoutes.post('/auth/logout', AuthController.logout);
authRoutes.get('/auth/me', requireAuth, AuthController.me);
authRoutes.post('/auth/forgot-password', authRateLimit, PasswordRecoveryController.request);
authRoutes.post('/auth/reset-password', authRateLimit, PasswordRecoveryController.reset);
authRoutes.get(
  '/auth/password-recovery/tokens',
  requireAuth,
  allowRoles(['admin']),
  PasswordRecoveryController.listForAdmin,
);

export { authRoutes };
