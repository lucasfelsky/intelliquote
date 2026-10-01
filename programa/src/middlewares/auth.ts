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
    await authenticate(req);
    next();
  } catch (error) {
    const handled = handleControllerError(error);
    res.status(handled.status).json({ message: handled.message });
  }
}

// Mesma verificacao do requireAuth, para montar ANTES de um express.json grande:
// sem login, o corpo nao e bufferizado nem parseado. Na falha o corpo e drenado
// (descartado, memoria O(1)) antes do 401; responder sem ler o corpo faz o
// cliente receber ECONNRESET em vez do 401. O requireAuth do router roda de novo.
export async function requireAuthBeforeBody(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await authenticate(req);
  } catch (error) {
    const handled = handleControllerError(error);
    discardBody(req, () => {
      if (!res.headersSent) {
        res.status(handled.status).json({ message: handled.message });
      }
    });
    return;
  }

  next();
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

async function authenticate(req: Request): Promise<void> {
  const token = getAccessToken(req);

  if (!token) {
    throw new HttpError(401, 'Token de acesso ausente.');
  }

  const payload = verifyAccessToken(token);
  req.user = await AuthService.getAuthenticatedUserById(Number(payload.sub));
}

function discardBody(req: Request, done: () => void): void {
  if (req.readableEnded) {
    done();
    return;
  }

  let called = false;
  const finish = (): void => {
    if (called) {
      return;
    }
    called = true;
    done();
  };

  req.once('end', finish);
  req.once('error', finish);
  req.once('close', finish);
  req.resume();
}

function getAccessToken(req: Request): string | null {
  const authorizationHeader = req.headers.authorization;

  if (authorizationHeader?.startsWith('Bearer ')) {
    return authorizationHeader.slice(7).trim();
  }

  return req.cookies?.[ACCESS_TOKEN_COOKIE_NAME] ?? null;
}
