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
// O descarte tem teto de bytes e de tempo (review do #92): corpo declarado acima
// do teto, corpo que passa do teto ou que nao termina no prazo recebem o 401 na
// hora com `Connection: close` e a conexao e encerrada - sem isso um cliente
// lento/chunked sem login seguraria a conexao e consumiria banda sem limite.
export const UNAUTHENTICATED_DRAIN_MAX_BYTES = 11 * 1024 * 1024;
export const UNAUTHENTICATED_DRAIN_TIMEOUT_MS = 10_000;

export function createRequireAuthBeforeBody({
  maxBytes = UNAUTHENTICATED_DRAIN_MAX_BYTES,
  timeoutMs = UNAUTHENTICATED_DRAIN_TIMEOUT_MS,
}: { maxBytes?: number; timeoutMs?: number } = {}) {
  return async function requireAuthBeforeBodyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await authenticate(req);
    } catch (error) {
      const handled = handleControllerError(error);
      discardBodyBounded(req, res, { maxBytes, timeoutMs }, (aborted) => {
        if (res.headersSent) {
          return;
        }
        if (aborted) {
          res.setHeader('Connection', 'close');
          res.once('finish', () => req.socket.destroy());
        }
        res.status(handled.status).json({ message: handled.message });
      });
      return;
    }

    next();
  };
}

export const requireAuthBeforeBody = createRequireAuthBeforeBody();

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

function discardBodyBounded(
  req: Request,
  res: Response,
  { maxBytes, timeoutMs }: { maxBytes: number; timeoutMs: number },
  done: (aborted: boolean) => void,
): void {
  if (req.readableEnded) {
    done(false);
    return;
  }

  let called = false;
  let received = 0;
  let timer: NodeJS.Timeout | undefined;
  const finish = (aborted: boolean): void => {
    if (called) {
      return;
    }
    called = true;
    if (timer) {
      clearTimeout(timer);
    }
    req.removeListener('data', onData);
    done(aborted);
  };
  const onData = (chunk: Buffer): void => {
    received += chunk.length;
    if (received > maxBytes) {
      req.pause();
      finish(true);
    }
  };

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    finish(true);
    return;
  }

  timer = setTimeout(() => {
    req.pause();
    finish(true);
  }, timeoutMs);
  req.on('data', onData);
  req.once('end', () => finish(false));
  req.once('error', () => finish(false));
  req.once('close', () => finish(false));
  res.once('close', () => {
    if (timer) {
      clearTimeout(timer);
    }
  });
  req.resume();
}

function getAccessToken(req: Request): string | null {
  const authorizationHeader = req.headers.authorization;

  if (authorizationHeader?.startsWith('Bearer ')) {
    return authorizationHeader.slice(7).trim();
  }

  return req.cookies?.[ACCESS_TOKEN_COOKIE_NAME] ?? null;
}
