import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  SUPPLIER_DOCUMENT_EMPTY_FILE_MESSAGE,
  SUPPLIER_DOCUMENT_EXPIRING_WINDOW_DAYS,
  SUPPLIER_DOCUMENT_INVALID_BASE64_MESSAGE,
  SUPPLIER_DOCUMENT_INVALID_TYPE_MESSAGE,
  SUPPLIER_DOCUMENT_MAX_FILE_BYTES,
  SUPPLIER_DOCUMENT_TOO_LARGE_MESSAGE,
  SUPPLIER_DOCUMENT_TYPE_MISMATCH_MESSAGE,
} from '../constants/supplierDocuments';
import { HttpError } from '../utils/http';
import {
  addDaysToKey,
  dateKeyToDbDate,
  daysUntil,
  dbDateToKey,
  documentStatus,
  todayKeyInSaoPaulo,
  type SupplierDocumentStatus,
} from '../utils/supplierDocumentDates';
import {
  decodeStrictBase64,
  detectDocumentMime,
  sanitizeDocumentFileName,
} from '../utils/supplierDocumentFile';
import type {
  SupplierDocumentCreateInput,
  SupplierDocumentReplaceFileInput,
  SupplierDocumentUpdateInput,
} from '../validators/supplierDocuments';
import { AuditLogService } from './AuditLogService';

const ENTITY_TYPE = 'supplier_document';

// Sem `file`: a leitura de lista nunca carrega o bytea.
const documentInclude = {
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.SupplierDocumentInclude;

type DocumentRow = Prisma.SupplierDocumentGetPayload<{ include: typeof documentInclude }>;

export interface SerializedSupplierDocument {
  id: number;
  supplierId: number;
  name: string;
  expiresOn: string;
  notes: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  daysLeft: number;
  status: SupplierDocumentStatus;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: number; name: string } | null;
}

export interface SupplierDocumentSummaryEntry {
  expired: number;
  // Inclui "vence hoje" e "vence em ate 30 dias".
  expiring: number;
  // Menor daysLeft entre os documentos NAO vencidos a vencer (null se nao houver).
  nextDaysLeft: number | null;
}

export interface SupplierDocumentSummary {
  bySupplier: Record<string, SupplierDocumentSummaryEntry>;
}

// Filtro padrao: documento e fornecedor nao excluidos.
function activeWhere(
  extra: Prisma.SupplierDocumentWhereInput = {},
): Prisma.SupplierDocumentWhereInput {
  return { ...extra, deletedAt: null, supplier: { deletedAt: null } };
}

function serialize(row: DocumentRow, now: Date): SerializedSupplierDocument {
  const expiresOn = dbDateToKey(row.expiresOn);
  const daysLeft = daysUntil(expiresOn, todayKeyInSaoPaulo(now));

  return {
    id: row.id,
    supplierId: row.supplierId,
    name: row.name,
    expiresOn,
    notes: row.notes,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    daysLeft,
    status: documentStatus(daysLeft),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy ? { id: row.createdBy.id, name: row.createdBy.name } : null,
  };
}

// Metadados para o AuditLog (nunca os bytes).
function auditSnapshot(row: {
  name: string;
  expiresOn: Date;
  notes: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  alertCycle: number;
}) {
  return {
    name: row.name,
    expiresOn: dbDateToKey(row.expiresOn),
    notes: row.notes,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    alertCycle: row.alertCycle,
  };
}

interface PreparedFile {
  data: Uint8Array<ArrayBuffer>;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

function prepareFile(input: {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}): PreparedFile {
  let data: Buffer;
  try {
    data = decodeStrictBase64(input.contentBase64);
  } catch {
    throw new HttpError(400, SUPPLIER_DOCUMENT_INVALID_BASE64_MESSAGE);
  }

  if (data.length === 0) {
    throw new HttpError(400, SUPPLIER_DOCUMENT_EMPTY_FILE_MESSAGE);
  }
  if (data.length > SUPPLIER_DOCUMENT_MAX_FILE_BYTES) {
    throw new HttpError(400, SUPPLIER_DOCUMENT_TOO_LARGE_MESSAGE);
  }

  const detected = detectDocumentMime(data);
  if (!detected) {
    throw new HttpError(400, SUPPLIER_DOCUMENT_INVALID_TYPE_MESSAGE);
  }
  if (detected !== input.mimeType) {
    throw new HttpError(400, SUPPLIER_DOCUMENT_TYPE_MISMATCH_MESSAGE);
  }

  // Copia para um ArrayBuffer proprio: e o tipo que o Prisma exige para campos Bytes.
  return {
    data: new Uint8Array(data),
    fileName: sanitizeDocumentFileName(input.fileName, detected),
    mimeType: detected,
    fileSize: data.length,
  };
}

async function findActiveOrThrow(tx: Prisma.TransactionClient, id: number): Promise<DocumentRow> {
  const row = await tx.supplierDocument.findFirst({
    where: activeWhere({ id }),
    include: documentInclude,
  });

  if (!row) {
    throw new HttpError(404, 'Documento nao encontrado.');
  }
  return row;
}

export class SupplierDocumentService {
  static async list(
    supplierId: number,
    now: Date = new Date(),
  ): Promise<SerializedSupplierDocument[]> {
    const rows = await prisma.supplierDocument.findMany({
      where: activeWhere({ supplierId }),
      include: documentInclude,
      orderBy: [{ expiresOn: 'asc' }, { id: 'asc' }],
    });

    return rows.map((row) => serialize(row, now));
  }

  static async summary(now: Date = new Date()): Promise<SupplierDocumentSummary> {
    const todayKey = todayKeyInSaoPaulo(now);
    // So vencidos e a vencer (<= hoje+30 em BRT): o status 'ok' nunca entra no resumo.
    const limit = dateKeyToDbDate(addDaysToKey(todayKey, SUPPLIER_DOCUMENT_EXPIRING_WINDOW_DAYS));
    const rows = await prisma.supplierDocument.findMany({
      where: activeWhere({ expiresOn: { lte: limit } }),
      select: { supplierId: true, expiresOn: true },
    });

    const bySupplier: Record<string, SupplierDocumentSummaryEntry> = {};

    for (const row of rows) {
      const daysLeft = daysUntil(dbDateToKey(row.expiresOn), todayKey);
      const status = documentStatus(daysLeft);
      if (status === 'ok') {
        continue;
      }

      const key = String(row.supplierId);
      const entry = bySupplier[key] ?? { expired: 0, expiring: 0, nextDaysLeft: null };

      if (status === 'expired') {
        entry.expired += 1;
      } else {
        entry.expiring += 1;
        entry.nextDaysLeft =
          entry.nextDaysLeft === null ? daysLeft : Math.min(entry.nextDaysLeft, daysLeft);
      }
      bySupplier[key] = entry;
    }

    return { bySupplier };
  }

  static async create(
    input: SupplierDocumentCreateInput,
    userId: number | null,
    now: Date = new Date(),
  ): Promise<SerializedSupplierDocument> {
    const file = prepareFile(input);

    return prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: input.supplierId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) {
        throw new HttpError(404, 'Fornecedor nao encontrado.');
      }

      const created = await tx.supplierDocument.create({
        data: {
          supplierId: input.supplierId,
          name: input.name,
          expiresOn: dateKeyToDbDate(input.expiresOn),
          notes: input.notes ?? null,
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          createdById: userId,
          file: { create: { data: file.data } },
        },
        include: documentInclude,
      });

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: created.id,
          action: 'create',
          performedById: userId,
          afterData: { supplierId: created.supplierId, ...auditSnapshot(created) },
        },
        tx,
      );

      return serialize(created, now);
    });
  }

  static async update(
    id: number,
    input: SupplierDocumentUpdateInput,
    userId: number | null,
    now: Date = new Date(),
  ): Promise<SerializedSupplierDocument> {
    return prisma.$transaction(async (tx) => {
      const before = await findActiveOrThrow(tx, id);
      const dateChanged =
        input.expiresOn !== undefined && input.expiresOn !== dbDateToKey(before.expiresOn);

      const updated = await tx.supplierDocument.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.expiresOn !== undefined
            ? { expiresOn: dateKeyToDbDate(input.expiresOn) }
            : {}),
          // Renovacao (data mudou de fato) reinicia os marcos de aviso.
          ...(dateChanged ? { alertCycle: { increment: 1 } } : {}),
        },
        include: documentInclude,
      });

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'update',
          performedById: userId,
          beforeData: auditSnapshot(before),
          afterData: auditSnapshot(updated),
        },
        tx,
      );

      return serialize(updated, now);
    });
  }

  static async replaceFile(
    id: number,
    input: SupplierDocumentReplaceFileInput,
    userId: number | null,
    now: Date = new Date(),
  ): Promise<SerializedSupplierDocument> {
    const file = prepareFile(input);

    return prisma.$transaction(async (tx) => {
      const before = await findActiveOrThrow(tx, id);
      const dateChanged = input.expiresOn !== dbDateToKey(before.expiresOn);

      const updated = await tx.supplierDocument.update({
        where: { id },
        data: {
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          expiresOn: dateKeyToDbDate(input.expiresOn),
          ...(dateChanged ? { alertCycle: { increment: 1 } } : {}),
          file: { upsert: { create: { data: file.data }, update: { data: file.data } } },
        },
        include: documentInclude,
      });

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'replace_file',
          performedById: userId,
          beforeData: auditSnapshot(before),
          afterData: auditSnapshot(updated),
        },
        tx,
      );

      return serialize(updated, now);
    });
  }

  static async getFile(
    id: number,
  ): Promise<{ fileName: string; mimeType: string; contentBase64: string }> {
    const row = await prisma.supplierDocument.findFirst({
      where: activeWhere({ id }),
      select: {
        fileName: true,
        mimeType: true,
        file: { select: { data: true } },
      },
    });

    if (!row || !row.file) {
      throw new HttpError(404, 'Documento nao encontrado.');
    }

    return {
      fileName: row.fileName,
      mimeType: row.mimeType,
      contentBase64: Buffer.from(row.file.data).toString('base64'),
    };
  }

  static async softDelete(id: number, userId: number | null): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const before = await findActiveOrThrow(tx, id);

      await tx.supplierDocument.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'delete',
          performedById: userId,
          beforeData: { supplierId: before.supplierId, ...auditSnapshot(before) },
        },
        tx,
      );
    });
  }
}
