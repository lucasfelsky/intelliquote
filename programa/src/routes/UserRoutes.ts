import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { allowRoles, requireAuth } from '../middlewares/auth';
import { prisma } from '../lib/prisma';
import { handleControllerError } from '../utils/http';

const userRoutes = Router();

const adminOnly = [requireAuth, allowRoles(['admin'])] as const;
const anyAuthenticated = [requireAuth] as const;

userRoutes.post('/users', ...adminOnly, UserController.create);
userRoutes.get('/users', ...adminOnly, UserController.getAll);
userRoutes.get('/users/:id', ...adminOnly, UserController.getById);
userRoutes.put('/users/:id', ...adminOnly, UserController.update);
userRoutes.post('/users/:id/reset-password', ...adminOnly, UserController.resetPassword);

// Lista leve de perfis para alimentar seletores de UI (picker de CC,
// mencoes em envios etc). Retorna apenas dados de identificacao — sem
// hash de senha, sem contadores. Restringimos a usuarios ativos por
// padrao; aceita ?status=inactive|all explicito para auditoria.
userRoutes.get('/users-directory', ...anyAuthenticated, async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'active';
    const where: { isActive?: boolean } = {};
    if (status === 'active') where.isActive = true;
    else if (status === 'inactive') where.isActive = false;
    // status=all => sem filtro

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        role: { select: { name: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    return res.status(200).json(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role.name,
        isActive: u.isActive,
      })),
    );
  } catch (error) {
    const handled = handleControllerError(error);
    return res.status(handled.status).json({ message: handled.message });
  }
});

export { userRoutes };
