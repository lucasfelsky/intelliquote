import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  attachmentCreateSchema,
  attachmentListQuerySchema,
} from '../validators/domain';
import {
  handleControllerError,
  HttpError,
  parseId,
} from '../utils/http';
import { attachmentUploadsDir } from '../routes/AttachmentRoutes';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

interface UploadPayload {
  fileName: string;
  contentBase64: string;
  fileType: string;
  fileSize: number;
  entityType: string;
  entityId: string;
}

export class AttachmentController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const parsed = attachmentListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          message: 'Filtros de anexos invalidos.',
        });
      }

      const where: Prisma.AttachmentWhereInput = {};
      if (parsed.data.entityType) {
        where.entityType = parsed.data.entityType;
      }
      if (parsed.data.entityId) {
        where.entityId = parsed.data.entityId;
      }

      const attachments = await prisma.attachment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          uploadedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      return res.status(200).json(
        attachments.map((attachment) => ({
          ...attachment,
          fileSize: attachment.fileSize,
        })),
      );
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const parsed = attachmentCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message:
            'Informe fileName, contentBase64, fileType, fileSize, entityType e entityId para registrar o anexo.',
        });
      }

      const payload = parsed.data as UploadPayload;
      ensureEntityAccessible(payload.entityType, payload.entityId);

      if (payload.fileSize > MAX_FILE_SIZE_BYTES) {
        throw new HttpError(400, 'O arquivo excede o limite de 5MB por anexo.');
      }

      const buffer = decodeBase64(payload.contentBase64);
      if (buffer.length === 0) {
        throw new HttpError(400, 'Conteudo do anexo vazio.');
      }
      if (buffer.length > MAX_FILE_SIZE_BYTES) {
        throw new HttpError(400, 'O arquivo excede o limite de 5MB por anexo.');
      }

      await fs.mkdir(attachmentUploadsDir, { recursive: true });
      const safeFileName = payload.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storedName = `${Date.now()}-${safeFileName}`;
      const storedPath = path.join(attachmentUploadsDir, storedName);

      await fs.writeFile(storedPath, buffer);
      const publicPath = `/uploads/attachments/${storedName}`;

      const attachment = await prisma.attachment.create({
        data: {
          fileName: payload.fileName,
          fileUrl: publicPath,
          fileType: payload.fileType,
          fileSize: buffer.length,
          entityType: payload.entityType,
          entityId: payload.entityId,
          uploadedById: req.user?.id ?? null,
        },
        include: {
          uploadedBy: { select: { id: true, name: true, email: true } },
        },
      });

      await AuditLogService.log({
        entityType: 'attachment',
        entityId: attachment.id,
        action: 'create',
        performedById: req.user?.id ?? null,
        afterData: {
          id: attachment.id,
          fileName: attachment.fileName,
          fileType: attachment.fileType,
          fileSize: attachment.fileSize,
          entityType: attachment.entityType,
          entityId: attachment.entityId,
        },
        metadata: {
          relatedEntity: `${attachment.entityType}#${attachment.entityId}`,
        },
      });

      return res.status(201).json(attachment);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async download(req: Request, res: Response): Promise<Response> {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      if (!id) {
        return res.status(400).json({ message: 'ID do anexo invalido.' });
      }

      const attachment = await prisma.attachment.findUnique({ where: { id } });
      if (!attachment) {
        return res.status(404).json({ message: 'Anexo nao encontrado.' });
      }

      const filePath = path.join(process.cwd(), attachment.fileUrl);
      try {
        const content = await fs.readFile(filePath);
        res.setHeader('Content-Type', attachment.fileType || 'application/octet-stream');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
        );
        return res.status(200).send(content);
      } catch (_error) {
        return res
          .status(410)
          .json({ message: 'O arquivo fisico deste anexo nao esta mais disponivel.' });
      }
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async delete(req: Request, res: Response): Promise<Response> {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      if (!id) {
        return res.status(400).json({ message: 'ID do anexo invalido.' });
      }

      const existing = await prisma.attachment.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: 'Anexo nao encontrado.' });
      }

      await prisma.attachment.delete({ where: { id } });

      try {
        const filePath = path.join(process.cwd(), existing.fileUrl);
        await fs.unlink(filePath);
      } catch (_error) {
        // ignore missing physical file
      }

      await AuditLogService.log({
        entityType: 'attachment',
        entityId: existing.id,
        action: 'delete',
        performedById: req.user?.id ?? null,
        beforeData: existing,
        afterData: null,
        metadata: {
          relatedEntity: `${existing.entityType}#${existing.entityId}`,
        },
      });

      return res.status(204).send();
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}

function ensureEntityAccessible(entityType: string, entityId: string): void {
  if (entityType === 'supplier') {
    const id = parseId(entityId);
    if (!id) {
      throw new HttpError(400, 'entityId invalido para o fornecedor.');
    }
    return;
  }
  if (
    entityType === 'quote_request' ||
    entityType === 'quote_response' ||
    entityType === 'quote_request_item'
  ) {
    const id = parseId(entityId);
    if (!id) {
      throw new HttpError(400, `entityId invalido para ${entityType}.`);
    }
    return;
  }
  if (entityType.length === 0) {
    throw new HttpError(400, 'Informe entityType para o anexo.');
  }
  if (entityId.length === 0) {
    throw new HttpError(400, 'Informe entityId para o anexo.');
  }
}

function decodeBase64(content: string): Buffer {
  const normalized = content.includes(',')
    ? content.split(',').pop() ?? ''
    : content;
  try {
    return Buffer.from(normalized, 'base64');
  } catch (_error) {
    throw new HttpError(400, 'Conteudo base64 invalido.');
  }
}
