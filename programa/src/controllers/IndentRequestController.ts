import type { Request, Response } from 'express';
import { IndentQuoteGenerationService } from '../services/IndentQuoteGenerationService';
import { IndentRequestService, type IndentActor } from '../services/IndentRequestService';
import { handleControllerError, parseId } from '../utils/http';
import {
  indentConfirmItemsSchema,
  indentGenerateQuotesSchema,
  indentRequestCreateSchema,
  indentRequestListQuerySchema,
} from '../validators/indentRequest';

const INVALID_ID = 'ID da solicitação inválido.';

// Responsavel e autoria vem SEMPRE do usuario logado (nunca do corpo).
function actorOf(req: Request): IndentActor | null {
  return req.user ? { id: req.user.id, name: req.user.name } : null;
}

export class IndentRequestController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const query = indentRequestListQuerySchema.parse(req.query);
      return res.status(200).json(await IndentRequestService.list(query));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async newCount(_req: Request, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await IndentRequestService.newCount());
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async clientOptions(_req: Request, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await IndentRequestService.clientOptions());
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: INVALID_ID });
      }

      return res.status(200).json(await IndentRequestService.getById(id));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async supplierOptions(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: INVALID_ID });
      }

      return res.status(200).json(await IndentQuoteGenerationService.supplierOptions(id));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const actor = actorOf(req);

      if (!actor) {
        return res.status(401).json({ message: 'Não autenticado.' });
      }

      const payload = indentRequestCreateSchema.parse(req.body);
      return res.status(201).json(await IndentRequestService.create(payload, actor));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async confirmItems(req: Request, res: Response): Promise<Response> {
    try {
      const actor = actorOf(req);

      if (!actor) {
        return res.status(401).json({ message: 'Não autenticado.' });
      }

      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: INVALID_ID });
      }

      const payload = indentConfirmItemsSchema.parse(req.body);
      return res.status(200).json(await IndentRequestService.confirmItems(id, payload, actor));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async generateQuotes(req: Request, res: Response): Promise<Response> {
    try {
      const actor = actorOf(req);

      if (!actor) {
        return res.status(401).json({ message: 'Não autenticado.' });
      }

      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: INVALID_ID });
      }

      const payload = indentGenerateQuotesSchema.parse(req.body);
      return res.status(201).json(await IndentQuoteGenerationService.generate(id, payload, actor));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
