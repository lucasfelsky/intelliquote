import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '../constants/roles';
import { AuthService } from '../services/AuthService';
import { handleControllerError, HttpError } from '../utils/http';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  verifyAccessToken,
} from '../utils/tokens';

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = getAccessToken(req);

    if (!token) {
      throw new HttpError(401, 'Token de acesso ausente.');
    }

    const payload = verifyAccessToken(token);
    req.user = await AuthService.getAuthenticatedUserById(Number(payload.sub));
    next();
  } catch (error) {
    const handled = handleControllerError(error);
    res.status(handled.status).json({ message: handled.message });
  }
}

export function allowRoles(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        throw new HttpError(401, 'Utilizador nao autenticado.');
      }

      if (!roles.includes(req.user.role)) {
        throw new HttpError(403, 'Voce nao tem permissao para executar esta acao.');
      }

      next();
    } catch (error) {
      const handled = handleControllerError(error);
      res.status(handled.status).json({ message: handled.message });
    }
  };
}

function getAccessToken(req: Request): string | null {
  const authorizationHeader = req.headers.authorization;

  if (authorizationHeader?.startsWith('Bearer ')) {
    return authorizationHeader.slice(7).trim();
  }

  return req.cookies?.[ACCESS_TOKEN_COOKIE_NAME] ?? null;
}
