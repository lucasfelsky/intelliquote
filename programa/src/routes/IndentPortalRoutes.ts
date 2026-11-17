import express, { Router, type NextFunction, type Request, type Response } from 'express';
import {
  INDENT_PORTAL_CONFLICT_MESSAGE,
  INDENT_PORTAL_CLOSED_MESSAGE,
  INDENT_PORTAL_FILE_TOO_LARGE_MESSAGE,
  INDENT_PORTAL_GENERIC_MESSAGE,
  INDENT_PORTAL_BAD_LINK_MESSAGE,
  INDENT_PORTAL_LOCKED_MESSAGE,
  INDENT_PORTAL_MAX_FILE_BYTES,
  INDENT_PORTAL_NOT_PDF_MESSAGE,
} from '../constants/indentPortal';
import { logger } from '../lib/logger';
import { IndentPortalNotificationService } from '../services/IndentPortalNotificationService';
import { IndentPortalService, type IndentPortalMeta, type ResolvedIndentToken } from '../services/IndentPortalService';
import { handleControllerError, HttpError } from '../utils/http';
import { PortalHttpError } from '../utils/portalHttpError';
import { indentPortalRespondSchema } from '../validators/indentPortal';
import {
  PORTAL_INVALID_PAYLOAD_MESSAGE,
  getClientKey,
  getRequestMeta,
  isLocked,
  portalRateLimiter,
  registerInvalidAttempt,
} from './PortalRoutes';

// Rotas PUBLICAS (sem login) do portal do fornecedor do IQ Indent (PR 4a-2). Rate limit (10/min) e lockout (5 invalidas/15 min) sao a
// MESMA instancia do portal do IQ e do de credito. A leitura do token e o corpo de erro sao proprios (nada de "contact your ..."):
// 404 unico para formato invalido e inexistente; 410 so para token que existe. Sem /api/v1: rota publica, sem sessao.
const indentPortalRoutes = Router();

type ErrorBody = { message: string; code?: string; path?: string };

// Nenhum texto em portugues chega ao fornecedor: so PortalHttpError (mensagem ja em ingles) repassa `message`; o resto vira texto por status.
function indentPortalErrorBody(error: HttpError): ErrorBody {
  if (error instanceof PortalHttpError) {
    if (!error.code) {
      return { message: error.message };
    }
    // Codigo em MAIUSCULAS (LINK_INVALID, NOT_PDF...) e codigo de erro; em minusculas e o campo do formulario (path).
    return /^[A-Z_]+$/.test(error.code) ? { message: error.message, code: error.code } : { message: error.message, path: error.code };
  }

  switch (error.status) {
    case 400:
      return { message: PORTAL_INVALID_PAYLOAD_MESSAGE };
    case 404:
      return { message: INDENT_PORTAL_BAD_LINK_MESSAGE };
    case 409:
      return { message: INDENT_PORTAL_CONFLICT_MESSAGE };
    case 410:
      return { message: INDENT_PORTAL_CLOSED_MESSAGE };
    case 413:
      return { message: INDENT_PORTAL_FILE_TOO_LARGE_MESSAGE, code: 'FILE_TOO_LARGE' };
    default:
      return { message: INDENT_PORTAL_GENERIC_MESSAGE };
  }
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof HttpError) {
    res.status(error.status).json(indentPortalErrorBody(error));
    return;
  }

  const handled = handleControllerError(error);
  res.status(handled.status).json(indentPortalErrorBody(new HttpError(handled.status, handled.message)));
}

// Corpo ainda nao lido (upload) ou lixo pendente: a conexao fecha depois da resposta de erro.
function closeAfter(res: Response): void {
  res.setHeader('Connection', 'close');
}

function tokenOf(res: Response): ResolvedIndentToken {
  return res.locals.indentToken as ResolvedIndentToken;
}

function metaOf(res: Response): IndentPortalMeta {
  return res.locals.indentMeta as IndentPortalMeta;
}

// Lockout -> token. So o 404 (formato invalido ou inexistente) conta como tentativa invalida.
async function withIndentToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const key = getClientKey(req);

    if (isLocked(key)) {
      closeAfter(res);
      res.status(429).json({ message: INDENT_PORTAL_LOCKED_MESSAGE, code: 'LOCKED' });
      return;
    }

    const meta = getRequestMeta(req);
    res.locals.indentMeta = meta;
    res.locals.indentToken = await IndentPortalService.resolveToken(String(req.params.token ?? ''), meta);
    next();
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      registerInvalidAttempt(getClientKey(req));
    }
    closeAfter(res);
    sendError(res, error);
  }
}

// O token e uma credencial na URL: nada disto pode ficar em cache.
indentPortalRoutes.use('/api/indent-portal', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

indentPortalRoutes.get('/api/indent-portal/:token', portalRateLimiter, withIndentToken, async (_req, res) => {
  try {
    res.status(200).json(await IndentPortalService.getView(tokenOf(res), metaOf(res)));
  } catch (error) {
    sendError(res, error);
  }
});

indentPortalRoutes.post('/api/indent-portal/:token/respond', portalRateLimiter, withIndentToken, async (req, res) => {
  try {
    const parsed = indentPortalRespondSchema.safeParse(req.body);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      res.status(400).json({ message: issue?.message ?? PORTAL_INVALID_PAYLOAD_MESSAGE, path: issue ? issue.path.join('.') : '' });
      return;
    }

    const result = await IndentPortalService.submit(tokenOf(res), parsed.data, metaOf(res));

    // Depois do commit: log SUBMIT e aviso a Compras (espera no maximo ~5 s). Nenhum dos dois pode alterar a resposta ao fornecedor.
    if (result.notify) {
      await IndentPortalService.logAccess(tokenOf(res).id, 'SUBMIT', null, metaOf(res));
      await IndentPortalNotificationService.notifyWithCap(result.notify);
    }

    res.status(result.status).json(result.body);
  } catch (error) {
    sendError(res, error);
  }
});

// O corpo so e lido (express.raw) DEPOIS do token valido; token invalido responde com Connection: close sem ler nada.
indentPortalRoutes.post(
  '/api/indent-portal/:token/attachments',
  portalRateLimiter,
  withIndentToken,
  express.raw({ type: 'application/pdf', limit: INDENT_PORTAL_MAX_FILE_BYTES }),
  async (req, res) => {
    try {
      const body: unknown = req.body;

      if (!Buffer.isBuffer(body) || body.length === 0) {
        closeAfter(res);
        throw new PortalHttpError(400, INDENT_PORTAL_NOT_PDF_MESSAGE, 'NOT_PDF');
      }

      let fileName = 'attachment.pdf';
      const header = req.headers['x-file-name'];

      if (typeof header === 'string' && header.length > 0) {
        try {
          fileName = decodeURIComponent(header);
        } catch {
          fileName = 'attachment.pdf';
        }
      }

      const result = await IndentPortalService.addAttachment(tokenOf(res), { fileName, buffer: body }, metaOf(res));
      res.status(result.status).json(result.body);
    } catch (error) {
      sendError(res, error);
    }
  },
);

// Erros do parser do upload: corpo grande demais -> 413; qualquer outro -> 400.
indentPortalRoutes.use(
  '/api/indent-portal',
  (err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large') {
      closeAfter(res);
      res.status(413).json({ message: INDENT_PORTAL_FILE_TOO_LARGE_MESSAGE, code: 'FILE_TOO_LARGE' });
      return;
    }
    if (typeof err?.type === 'string') {
      logger.warn({ type: err.type }, 'Erro de parser no upload do portal Indent.');
      closeAfter(res);
      res.status(400).json({ message: INDENT_PORTAL_NOT_PDF_MESSAGE, code: 'NOT_PDF' });
      return;
    }
    next(err);
  },
);

export { indentPortalRoutes };
