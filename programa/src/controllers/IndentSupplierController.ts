import type { Request, Response } from 'express';
import { IndentSupplierService } from '../services/IndentSupplierService';
import { handleControllerError, parseId } from '../utils/http';
import {
  indentListQuerySchema,
  indentSupplierCreateSchema,
  indentSupplierProductsSchema,
  indentSupplierUpdateSchema,
} from '../validators/indent';

export class IndentSupplierController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const query = indentListQuerySchema.parse(req.query);
      return res.status(200).json(await IndentSupplierService.list(query));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async options(_req: Request, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await IndentSupplierService.options());
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const payload = indentSupplierCreateSchema.parse(req.body);
      const created = await IndentSupplierService.create(payload, req.user?.id ?? null);
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
        return res.status(400).json({ message: 'ID do fornecedor inválido.' });
      }

      const payload = indentSupplierUpdateSchema.parse(req.body);
      const updated = await IndentSupplierService.update(id, payload, req.user?.id ?? null);
      return res.status(200).json(updated);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async setProducts(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({ message: 'ID do fornecedor inválido.' });
      }

      const payload = indentSupplierProductsSchema.parse(req.body);
      const updated = await IndentSupplierService.setProducts(id, payload.productIds, req.user?.id ?? null);
      return res.status(200).json(updated);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
