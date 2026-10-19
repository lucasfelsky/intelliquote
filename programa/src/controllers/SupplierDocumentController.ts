import { Request, Response } from 'express';
import { SupplierDocumentService } from '../services/SupplierDocumentService';
import { handleControllerError, parseId } from '../utils/http';
import {
  supplierDocumentCreateSchema,
  supplierDocumentListQuerySchema,
  supplierDocumentReplaceFileSchema,
  supplierDocumentUpdateSchema,
} from '../validators/supplierDocuments';

function badRequest(res: Response, message: string): Response {
  return res.status(400).json({ message });
}

export class SupplierDocumentController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const parsed = supplierDocumentListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return badRequest(res, parsed.error.issues[0]?.message ?? 'Filtros invalidos.');
      }

      const documents = await SupplierDocumentService.list(parsed.data.supplierId);
      return res.status(200).json(documents);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async summary(_req: Request, res: Response): Promise<Response> {
    try {
      const summary = await SupplierDocumentService.summary();
      return res.status(200).json(summary);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const parsed = supplierDocumentCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return badRequest(res, parsed.error.issues[0]?.message ?? 'Dados invalidos.');
      }

      const created = await SupplierDocumentService.create(parsed.data, req.user?.id ?? null);
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
        return badRequest(res, 'ID do documento invalido.');
      }

      const parsed = supplierDocumentUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return badRequest(res, parsed.error.issues[0]?.message ?? 'Dados invalidos.');
      }

      const updated = await SupplierDocumentService.update(id, parsed.data, req.user?.id ?? null);
      return res.status(200).json(updated);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async replaceFile(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return badRequest(res, 'ID do documento invalido.');
      }

      const parsed = supplierDocumentReplaceFileSchema.safeParse(req.body);
      if (!parsed.success) {
        return badRequest(res, parsed.error.issues[0]?.message ?? 'Dados invalidos.');
      }

      const updated = await SupplierDocumentService.replaceFile(
        id,
        parsed.data,
        req.user?.id ?? null,
      );
      return res.status(200).json(updated);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async download(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return badRequest(res, 'ID do documento invalido.');
      }

      const file = await SupplierDocumentService.getFile(id);
      return res.status(200).json(file);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async remove(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return badRequest(res, 'ID do documento invalido.');
      }

      await SupplierDocumentService.softDelete(id, req.user?.id ?? null);
      return res.status(200).json({ ok: true });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
