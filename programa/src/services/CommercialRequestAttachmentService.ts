import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import {
  CR_ATTACHMENT_DUPLICATE_MESSAGE,
  CR_ATTACHMENT_EMPTY_FILE_MESSAGE,
  CR_ATTACHMENT_EXTENSION_MISMATCH_MESSAGE,
  CR_ATTACHMENT_FILE_NOT_FOUND_MESSAGE,
  CR_ATTACHMENT_INVALID_BASE64_MESSAGE,
  CR_ATTACHMENT_INVALID_TYPE_MESSAGE,
  CR_ATTACHMENT_LIMIT_MESSAGE,
  CR_ATTACHMENT_MAX_FILE_BYTES,
  CR_ATTACHMENT_MAX_PER_REQUEST,
  CR_ATTACHMENT_NOT_FOUND_MESSAGE,
  CR_ATTACHMENT_ONLY_DEVELOPMENT_MESSAGE,
  CR_ATTACHMENT_ONLY_PENDING_MESSAGE,
  CR_ATTACHMENT_TOO_LARGE_MESSAGE,
  CR_ATTACHMENT_TYPE_MISMATCH_MESSAGE,
  type CommercialRequestAttachmentKind,
} from '../constants/commercialRequestAttachments';
import { HttpError } from '../utils/http';
import {
  extensionMatchesMime,
  sanitizeAttachmentFileName,
} from '../utils/commercialRequestAttachmentFile';
import { decodeStrictBase64, detectDocumentMime } from '../utils/supplierDocumentFile';
import type { CommercialRequestAttachmentUploadInput } from '../validators/commercialRequestDevelopment';
import { AuditLogService } from './AuditLogService';

const ENTITY_TYPE = 'commercial_request_attachment';
const INTERACTIVE_TX_OPTIONS = { timeout: 15000, maxWait: 10000 };

export interface AttachmentActor {
  id: number;
  role: string;
}

export interface SerializedAttachment {
  id: number;
  kind: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: Date;
}

interface PreparedAttachment {
  data: Uint8Array<ArrayBuffer>;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
}

// Validacao do arquivo, nesta ordem: base64 estrito, vazio, tamanho, tipo REAL pelos magic
// bytes, tipo declarado igual ao real, nome sanitizado, extensao final igual ao tipo, hash.
function prepare(input: CommercialRequestAttachmentUploadInput): PreparedAttachment {
  let data: Buffer;
  try {
    data = decodeStrictBase64(input.contentBase64);
  } catch {
    throw new HttpError(400, CR_ATTACHMENT_INVALID_BASE64_MESSAGE);
  }

  if (data.length === 0) {
    throw new HttpError(400, CR_ATTACHMENT_EMPTY_FILE_MESSAGE);
  }
  if (data.length > CR_ATTACHMENT_MAX_FILE_BYTES) {
    throw new HttpError(400, CR_ATTACHMENT_TOO_LARGE_MESSAGE);
  }

  const detected = detectDocumentMime(data);
  if (!detected) {
    throw new HttpError(400, CR_ATTACHMENT_INVALID_TYPE_MESSAGE);
  }
  if (detected !== input.mimeType) {
    throw new HttpError(400, CR_ATTACHMENT_TYPE_MISMATCH_MESSAGE);
  }

  const fileName = sanitizeAttachmentFileName(input.fileName, detected);
  if (!extensionMatchesMime(fileName, detected)) {
    throw new HttpError(400, CR_ATTACHMENT_EXTENSION_MISMATCH_MESSAGE);
  }

  return {
    // Copia para um ArrayBuffer proprio: e o tipo que o Prisma exige para campos Bytes.
    data: new Uint8Array(data),
    fileName,
    mimeType: detected,
    fileSize: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

const metadataSelect = {
  id: true,
  kind: true,
  fileName: true,
  mimeType: true,
  fileSize: true,
  createdAt: true,
} satisfies Prisma.CommercialRequestAttachmentSelect;

// Trava a solicitacao e confere que e do usuario. Outro usuario (ou id inexistente) = 404, sem
// vazar a existencia da solicitacao.
async function lockOwnedRequest(
  tx: Prisma.TransactionClient,
  requestId: number,
  actor: AttachmentActor,
): Promise<{ status: string; isDevelopment: boolean }> {
  // Serializa uploads/remocoes e a mudanca de status (mesmo lock do vinculo de catalogo),
  // sem bloquear as FKs filhas. Garante o teto de 5 anexos mesmo com envios simultaneos.
  await tx.$queryRaw`SELECT id FROM "CommercialRequest" WHERE id = ${requestId} FOR NO KEY UPDATE`;

  const request = await tx.commercialRequest.findUnique({
    where: { id: requestId },
    select: { requestedById: true, status: true, isDevelopment: true },
  });
  if (!request || request.requestedById !== actor.id) {
    throw new HttpError(404, CR_ATTACHMENT_NOT_FOUND_MESSAGE);
  }
  return { status: request.status, isDevelopment: request.isDevelopment };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export class CommercialRequestAttachmentService {
  static async upload(
    requestId: number,
    input: CommercialRequestAttachmentUploadInput,
    actor: AttachmentActor,
  ): Promise<SerializedAttachment> {
    const prepared = prepare(input);
    const kind: CommercialRequestAttachmentKind = input.kind;

    try {
      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const request = await lockOwnedRequest(tx, requestId, actor);
        if (request.status !== 'pending') {
          throw new HttpError(409, CR_ATTACHMENT_ONLY_PENDING_MESSAGE);
        }
        if (!request.isDevelopment) {
          throw new HttpError(409, CR_ATTACHMENT_ONLY_DEVELOPMENT_MESSAGE);
        }

        const count = await tx.commercialRequestAttachment.count({
          where: { commercialRequestId: requestId },
        });
        if (count >= CR_ATTACHMENT_MAX_PER_REQUEST) {
          throw new HttpError(409, CR_ATTACHMENT_LIMIT_MESSAGE);
        }

        const attachment = await tx.commercialRequestAttachment.create({
          data: {
            commercialRequestId: requestId,
            kind,
            fileName: prepared.fileName,
            mimeType: prepared.mimeType,
            fileSize: prepared.fileSize,
            sha256: prepared.sha256,
            uploadedById: actor.id,
            file: { create: { data: prepared.data } },
          },
          select: metadataSelect,
        });

        // So ids, tipo e tamanho: nunca nome do arquivo, hash ou conteudo.
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: attachment.id,
            action: 'create',
            performedById: actor.id,
            afterData: {
              commercialRequestId: requestId,
              kind,
              mimeType: prepared.mimeType,
              fileSize: prepared.fileSize,
            },
          },
          tx,
        );

        return attachment;
      }, INTERACTIVE_TX_OPTIONS);

      logger.info(
        { requestId, attachmentId: created.id, fileSize: created.fileSize, kind },
        'Anexo tecnico da solicitacao do comercial gravado.',
      );
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, CR_ATTACHMENT_DUPLICATE_MESSAGE);
      }
      throw error;
    }
  }

  // Dono (comercial) ou COMEX. Para o comercial, o filtro de posse vai na propria query: o
  // anexo de outro comercial e' indistinguivel de um inexistente (404).
  static async getFile(
    requestId: number,
    attachmentId: number,
    actor: AttachmentActor,
  ): Promise<{ fileName: string; mimeType: string; contentBase64: string }> {
    const row = await prisma.commercialRequestAttachment.findFirst({
      where: {
        id: attachmentId,
        commercialRequestId: requestId,
        ...(actor.role === 'comercial' ? { commercialRequest: { requestedById: actor.id } } : {}),
      },
      select: {
        fileName: true,
        mimeType: true,
        file: { select: { data: true } },
      },
    });

    if (!row || !row.file) {
      throw new HttpError(404, CR_ATTACHMENT_FILE_NOT_FOUND_MESSAGE);
    }

    return {
      fileName: row.fileName,
      mimeType: row.mimeType,
      contentBase64: Buffer.from(row.file.data).toString('base64'),
    };
  }

  static async remove(
    requestId: number,
    attachmentId: number,
    actor: AttachmentActor,
  ): Promise<void> {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const request = await lockOwnedRequest(tx, requestId, actor);
      if (request.status !== 'pending') {
        throw new HttpError(409, CR_ATTACHMENT_ONLY_PENDING_MESSAGE);
      }

      const attachment = await tx.commercialRequestAttachment.findFirst({
        where: { id: attachmentId, commercialRequestId: requestId },
        select: { id: true, kind: true, mimeType: true, fileSize: true },
      });
      if (!attachment) {
        throw new HttpError(404, CR_ATTACHMENT_FILE_NOT_FOUND_MESSAGE);
      }

      // Hard delete: o arquivo (CommercialRequestAttachmentFile) sai em cascade.
      await tx.commercialRequestAttachment.delete({ where: { id: attachment.id } });

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: attachment.id,
          action: 'delete',
          performedById: actor.id,
          beforeData: {
            commercialRequestId: requestId,
            kind: attachment.kind,
            mimeType: attachment.mimeType,
            fileSize: attachment.fileSize,
          },
        },
        tx,
      );
    }, INTERACTIVE_TX_OPTIONS);

    logger.info({ requestId, attachmentId }, 'Anexo tecnico da solicitacao do comercial removido.');
  }
}
