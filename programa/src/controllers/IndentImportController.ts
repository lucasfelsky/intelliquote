import type { Request, Response } from 'express';
import { IndentImportService } from '../services/IndentImportService';
import { handleControllerError } from '../utils/http';
import { indentImportQuerySchema, indentImportSchema } from '../validators/indent';

export class IndentImportController {
  static async supplierCandidates(req: Request, res: Response): Promise<Response> {
    try {
      const query = indentImportQuerySchema.parse(req.query);
      return res.status(200).json(await IndentImportService.supplierCandidates(query));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async importSuppliers(req: Request, res: Response): Promise<Response> {
    try {
      const payload = indentImportSchema.parse(req.body);
      const result = await IndentImportService.importSuppliers(payload.ids, req.user?.id ?? null);
      return res.status(200).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async productCandidates(req: Request, res: Response): Promise<Response> {
    try {
      const query = indentImportQuerySchema.parse(req.query);
      return res.status(200).json(await IndentImportService.productCandidates(query));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async importProducts(req: Request, res: Response): Promise<Response> {
    try {
      const payload = indentImportSchema.parse(req.body);
      const result = await IndentImportService.importProducts(payload.ids, req.user?.id ?? null);
      return res.status(200).json(result);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
