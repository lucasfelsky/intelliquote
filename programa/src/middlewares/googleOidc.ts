import type { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';

import { internalJobsEnv } from '../config/env';
import { logger } from '../lib/logger';

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  if (!client) client = new OAuth2Client();
  return client;
}

function extractBearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Autentica chamadas dos jobs agendados (Cloud Scheduler) via ID token OIDC
 * do Google. Valida assinatura, audience, e-mail da service account invocadora
 * e `email_verified`.
 *
 * - Sem INTERNAL_JOBS_OIDC_AUDIENCE/INTERNAL_JOBS_INVOKER_EMAIL: 503 (fail-closed).
 * - Bearer ausente, token invalido, e-mail diferente ou nao verificado: 401.
 * - O token nunca vai para o log.
 */
export function requireGoogleOidc() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { audience, invokerEmail } = internalJobsEnv;
    if (!audience || !invokerEmail) {
      logger.error({}, 'Jobs internos sem INTERNAL_JOBS_OIDC_AUDIENCE/INTERNAL_JOBS_INVOKER_EMAIL.');
      res.status(503).json({ message: 'Jobs internos nao configurados.' });
      return;
    }

    const idToken = extractBearer(req);
    if (!idToken) {
      res.status(401).json({ message: 'Nao autenticado.' });
      return;
    }

    try {
      const ticket = await getClient().verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      const email = payload?.email?.trim().toLowerCase();
      if (!payload || !email || email !== invokerEmail || payload.email_verified !== true) {
        logger.warn({}, 'Chamada de job interno rejeitada: identidade nao autorizada.');
        res.status(401).json({ message: 'Nao autenticado.' });
        return;
      }
      next();
    } catch {
      logger.warn({}, 'Chamada de job interno rejeitada: ID token invalido.');
      res.status(401).json({ message: 'Nao autenticado.' });
    }
  };
}
