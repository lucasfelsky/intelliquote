import type { Request, Response } from 'express';
import { IndentProductService } from '../services/IndentProductService';
import { handleControllerError, parseId } from '../utils/http';
import {
  indentProductCreateSchema,
  indentProductListQuerySchema,
  indentProductUpdateSchema,
} from '../validators/indent';

export class IndentProductController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const query = indentProductListQuerySchema.parse(req.query);
      return res.status(200).json(await IndentProductService.list(query));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async options(_req: Request, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await IndentProductService.options());
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const payload = indentProductCreateSchema.parse(req.body);
      const created = await IndentProductService.create(payload, req.user?.id ?? null);
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
        return res.status(400).json({ message: 'ID do produto inválido.' });
      }

      const payload = indentProductUpdateSchema.parse(req.body);
      const updated = await IndentProductService.update(id, payload, req.user?.id ?? null);
      return res.status(200).json(updated);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async promote(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID do produto inválido.' });
      }

      const promoted = await IndentProductService.promote(id, req.user?.id ?? null);
      return res.status(200).json(promoted);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
