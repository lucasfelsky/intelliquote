import { Request, Response } from 'express';
import { CommercialRequestAttachmentService } from '../services/CommercialRequestAttachmentService';
import { handleControllerError, HttpError, parseId } from '../utils/http';
import { commercialRequestAttachmentUploadSchema } from '../validators/commercialRequestDevelopment';

const MAX_DB_INT = 2147483647;

function requireActor(req: Request): { id: number; role: string } {
  if (!req.user) {
    throw new HttpError(401, 'Utilizador nao autenticado.');
  }
  return { id: req.user.id, role: req.user.role };
}

function requireDbId(raw: string | string[] | undefined): number {
  const id = parseId(raw);
  // > Int do Postgres viraria 500 no banco.
  if (!id || id > MAX_DB_INT) {
    throw new HttpError(400, 'Identificador invalido.');
  }
  return id;
}

export class CommercialRequestAttachmentController {
  static async upload(req: Request, res: Response): Promise<Response> {
    try {
      const actor = requireActor(req);
      const requestId = requireDbId(req.params.id);

      const parsed = commercialRequestAttachmentUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Dados invalidos.');
      }

      const created = await CommercialRequestAttachmentService.upload(requestId, parsed.data, actor);
      return res.status(201).json(created);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async download(req: Request, res: Response): Promise<Response> {
    try {
      const actor = requireActor(req);
      const requestId = requireDbId(req.params.id);
      const attachmentId = requireDbId(req.params.attachmentId);

      const file = await CommercialRequestAttachmentService.getFile(requestId, attachmentId, actor);
      // Arquivo do cliente: nunca cacheado por navegador ou proxy.
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(file);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async remove(req: Request, res: Response): Promise<Response> {
    try {
      const actor = requireActor(req);
      const requestId = requireDbId(req.params.id);
      const attachmentId = requireDbId(req.params.attachmentId);

      await CommercialRequestAttachmentService.remove(requestId, attachmentId, actor);
      return res.status(204).send();
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
