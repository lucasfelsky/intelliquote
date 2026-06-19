import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { allowRoles, requireAuth } from '../middlewares/auth';

const userRoutes = Router();

const adminOnly = [requireAuth, allowRoles(['admin'])] as const;

userRoutes.post('/users', ...adminOnly, UserController.create);
userRoutes.get('/users', ...adminOnly, UserController.getAll);
userRoutes.get('/users/:id', ...adminOnly, UserController.getById);
userRoutes.put('/users/:id', ...adminOnly, UserController.update);
userRoutes.post('/users/:id/reset-password', ...adminOnly, UserController.resetPassword);

export { userRoutes };
