import type { Request, Response } from 'express';
import { IndentClientService } from '../services/IndentClientService';
import { handleControllerError, parseId } from '../utils/http';
import {
  indentClientCreateSchema,
  indentClientRuleSchema,
  indentClientUpdateSchema,
  indentListQuerySchema,
} from '../validators/indent';

export class IndentClientController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const query = indentListQuerySchema.parse(req.query);
      return res.status(200).json(await IndentClientService.list(query));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const payload = indentClientCreateSchema.parse(req.body);
      const created = await IndentClientService.create(payload, req.user?.id ?? null);
      return res.status(201).json(created);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID do cliente inválido.' });
      }

      const payload = indentClientUpdateSchema.parse(req.body);
      const updated = await IndentClientService.update(id, payload, req.user?.id ?? null);
      return res.status(200).json(updated);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async setSupplierRule(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID do cliente inválido.' });
      }

      const payload = indentClientRuleSchema.parse(req.body);
      const updated = await IndentClientService.setSupplierRule(id, payload, req.user?.id ?? null);
      return res.status(200).json(updated);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
