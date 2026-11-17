import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { IndentDispatchService } from '../services/IndentDispatchService';
import { IndentPortalService } from '../services/IndentPortalService';
import type { IndentActor } from '../services/IndentRequestService';
import { HttpError, handleControllerError, parseId } from '../utils/http';
import { indentResendSchema, indentSendSchema } from '../validators/indentPortal';

const INVALID_ID = 'ID da cotação inválido.';
const INVALID_ATTACHMENT_ID = 'ID do anexo inválido.';

// Content-Disposition RFC 5987: `filename` so com ASCII seguro (fallback) e `filename*` com o nome real em UTF-8 percent-encoded.
export function buildContentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^ -~]/g, '_').replace(/["\\%]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// Responsavel vem SEMPRE do usuario logado (nunca do corpo).
function actorOf(req: Request): IndentActor | null {
  return req.user ? { id: req.user.id, name: req.user.name } : null;
}

// Erro de validacao devolve tambem o `path` do campo (a tela marca o campo), como no IndentQuoteController.
function fail(res: Response, error: unknown): Response {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return res.status(400).json({
      message: issue?.message ?? 'Os dados enviados são inválidos.',
      path: issue ? issue.path.join('.') : '',
    });
  }

  if (error instanceof HttpError && error.status === 400 && error.code) {
    return res.status(400).json({ message: error.message, path: error.code });
  }

  const handled = handleControllerError(error);
  return res.status(handled.status).json({ message: handled.message });
}

type Action = (id: number, actor: IndentActor, role: string, body: unknown) => Promise<unknown>;

async function runAction(req: Request, res: Response, action: Action): Promise<Response> {
  try {
    const actor = actorOf(req);

    if (!actor || !req.user) {
      return res.status(401).json({ message: 'Não autenticado.' });
    }

    const id = parseId(req.params.id);

    if (!id) {
      return res.status(400).json({ message: INVALID_ID });
    }

    const result = (await action(id, actor, req.user.role, req.body)) as {
      allFailed: boolean;
      message: string | null;
      results: unknown;
      quote: unknown;
    };

    // Nenhum e-mail saiu: 502 com o resultado por destinatario (a tela mostra o motivo de cada um).
    if (result.allFailed) {
      return res.status(502).json({ message: result.message, results: result.results });
    }

    return res.status(200).json({ results: result.results, quote: result.quote });
  } catch (error) {
    return fail(res, error);
  }
}

async function runRead(req: Request, res: Response, read: (id: number, role: string) => Promise<unknown>): Promise<Response> {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return res.status(400).json({ message: INVALID_ID });
    }

    return res.status(200).json(await read(id, req.user?.role ?? ''));
  } catch (error) {
    return fail(res, error);
  }
}

export class IndentDispatchController {
  static sendContext(req: Request, res: Response): Promise<Response> {
    return runRead(req, res, (id, role) => IndentDispatchService.getSendContext(id, role));
  }

  static portalState(req: Request, res: Response): Promise<Response> {
    return runRead(req, res, (id, role) => IndentDispatchService.getPortalState(id, role));
  }

  // Download interno do PDF anexado pelo fornecedor no portal (leitura; so equipe COMEX). O anexo precisa ser DESTA cotacao.
  static async downloadAttachment(req: Request, res: Response): Promise<Response> {
    try {
      const quoteId = parseId(req.params.id);
      const attachmentId = parseId(req.params.attachmentId);

      if (!quoteId) {
        return res.status(400).json({ message: INVALID_ID });
      }
      if (!attachmentId) {
        return res.status(400).json({ message: INVALID_ATTACHMENT_ID });
      }

      const file = await IndentPortalService.getAttachmentForDownload(quoteId, attachmentId);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', buildContentDisposition(file.fileName));
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(file.data);
    } catch (error) {
      return fail(res, error);
    }
  }

  static send(req: Request, res: Response): Promise<Response> {
    return runAction(req, res, (id, actor, role, body) =>
      IndentDispatchService.send(id, indentSendSchema.parse(body), actor, role),
    );
  }

  static resend(req: Request, res: Response): Promise<Response> {
    return runAction(req, res, (id, actor, role, body) => {
      indentResendSchema.parse(body);
      return IndentDispatchService.resend(id, actor, role);
    });
  }
}
