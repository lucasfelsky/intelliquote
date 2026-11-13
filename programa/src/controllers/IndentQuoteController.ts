import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { IndentQuoteService } from '../services/IndentQuoteService';
import { IndentQuoteWorkflowService } from '../services/IndentQuoteWorkflowService';
import type { IndentActor } from '../services/IndentRequestService';
import { HttpError, handleControllerError, parseId } from '../utils/http';
import {
  indentQuoteEmptyBodySchema,
  indentQuoteFreeItemSchema,
  indentQuoteListQuerySchema,
  indentQuoteMarkSentSchema,
  indentQuoteResponseSchema,
} from '../validators/indentQuote';

const INVALID_ID = 'ID da cotação inválido.';

// Responsavel vem SEMPRE do usuario logado (nunca do corpo).
function actorOf(req: Request): IndentActor | null {
  return req.user ? { id: req.user.id, name: req.user.name } : null;
}

// Erro de validacao devolve tambem o `path` do campo (a tela marca o campo); os demais seguem o padrao da API.
function fail(res: Response, error: unknown): Response {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return res.status(400).json({
      message: issue?.message ?? 'Os dados enviados são inválidos.',
      path: issue ? issue.path.join('.') : '',
    });
  }

  // 400 de regra de negocio com campo (HttpError.code = path): a tela marca o campo, como nos erros do Zod.
  if (error instanceof HttpError && error.status === 400 && error.code) {
    return res.status(400).json({ message: error.message, path: error.code });
  }

  const handled = handleControllerError(error);
  return res.status(handled.status).json({ message: handled.message });
}

type Action = (id: number, actor: IndentActor, role: string, body: unknown) => Promise<unknown>;

// Boilerplate comum das 6 acoes: autenticacao, id e resposta (201 quando cria algo).
async function runAction(req: Request, res: Response, status: number, action: Action): Promise<Response> {
  try {
    const actor = actorOf(req);

    if (!actor || !req.user) {
      return res.status(401).json({ message: 'Não autenticado.' });
    }

    const id = parseId(req.params.id);

    if (!id) {
      return res.status(400).json({ message: INVALID_ID });
    }

    return res.status(status).json(await action(id, actor, req.user.role, req.body));
  } catch (error) {
    return fail(res, error);
  }
}

export class IndentQuoteController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const query = indentQuoteListQuerySchema.parse(req.query);
      return res.status(200).json(await IndentQuoteService.list(query));
    } catch (error) {
      return fail(res, error);
    }
  }

  static async getById(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: INVALID_ID });
      }

      return res.status(200).json(await IndentQuoteService.getById(id, req.user?.role ?? ''));
    } catch (error) {
      return fail(res, error);
    }
  }

  static markSent(req: Request, res: Response): Promise<Response> {
    return runAction(req, res, 200, (id, actor, role, body) =>
      IndentQuoteWorkflowService.markSent(id, indentQuoteMarkSentSchema.parse(body), actor, role),
    );
  }

  static addFreeItem(req: Request, res: Response): Promise<Response> {
    return runAction(req, res, 201, (id, actor, role, body) =>
      IndentQuoteWorkflowService.addFreeItem(id, indentQuoteFreeItemSchema.parse(body), actor, role),
    );
  }

  static recordResponse(req: Request, res: Response): Promise<Response> {
    return runAction(req, res, 200, (id, actor, role, body) =>
      IndentQuoteWorkflowService.recordResponse(id, indentQuoteResponseSchema.parse(body), actor, role),
    );
  }

  static accept(req: Request, res: Response): Promise<Response> {
    return runAction(req, res, 200, (id, actor, role, body) => {
      indentQuoteEmptyBodySchema.parse(body);
      return IndentQuoteWorkflowService.accept(id, actor, role);
    });
  }

  static refuse(req: Request, res: Response): Promise<Response> {
    return runAction(req, res, 200, (id, actor, role, body) => {
      indentQuoteEmptyBodySchema.parse(body);
      return IndentQuoteWorkflowService.refuse(id, actor, role);
    });
  }

  static requestRevision(req: Request, res: Response): Promise<Response> {
    return runAction(req, res, 201, (id, actor, role, body) => {
      indentQuoteEmptyBodySchema.parse(body);
      return IndentQuoteWorkflowService.requestRevision(id, actor, role);
    });
  }
}
