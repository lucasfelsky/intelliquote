import type { Request, Response } from 'express';
import { IndentPendingOrgService } from '../services/IndentPendingOrgService';
import type { IndentActor } from '../services/IndentRequestService';
import { handleControllerError, parseId } from '../utils/http';
import { pendingOrgCreateClientSchema, pendingOrgLinkSchema } from '../validators/indentPipedrive';

const INVALID_ID = 'ID da pendência inválido.';

// Fila de vinculo do Pipedrive (PR 5a.3). Quem resolve vem SEMPRE do usuario logado (nunca do corpo).
function actorOf(req: Request): IndentActor | null {
  return req.user ? { id: req.user.id, name: req.user.name } : null;
}

export class IndentPendingOrgController {
  static async list(_req: Request, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await IndentPendingOrgService.list());
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async createClient(req: Request, res: Response): Promise<Response> {
    try {
      const actor = actorOf(req);

      if (!actor) {
        return res.status(401).json({ message: 'Não autenticado.' });
      }

      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: INVALID_ID });
      }

      const payload = pendingOrgCreateClientSchema.parse(req.body);
      return res.status(201).json(await IndentPendingOrgService.createClient(id, payload, actor));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async link(req: Request, res: Response): Promise<Response> {
    try {
      const actor = actorOf(req);

      if (!actor) {
        return res.status(401).json({ message: 'Não autenticado.' });
      }

      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: INVALID_ID });
      }

      const payload = pendingOrgLinkSchema.parse(req.body);
      return res.status(200).json(await IndentPendingOrgService.link(id, payload, actor));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
