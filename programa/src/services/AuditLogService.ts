import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

interface CreateAuditLogInput {
  entityType: string;
  entityId: number | string;
  action: string;
  performedById?: number | null;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: unknown;
}

interface FindAuditLogsInput {
  where?: Record<string, unknown>;
  include?: Record<string, unknown>;
  orderBy?: Record<string, unknown>;
  take?: number;
}

type AuditLogDelegate = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  findMany?: (args: FindAuditLogsInput) => Promise<unknown>;
};

type AuditClientLike = {
  auditLog: AuditLogDelegate;
};

export class AuditLogService {
  static async log(
    input: CreateAuditLogInput,
    client?: unknown,
  ): Promise<void> {
    const auditClient = getAuditClient(client);

    if (!auditClient) {
      return;
    }

    await auditClient.auditLog.create({
      data: {
        entityType: input.entityType,
        entityId: String(input.entityId),
        action: input.action,
        performedById: input.performedById ?? null,
        beforeData: toAuditJson(input.beforeData),
        afterData: toAuditJson(input.afterData),
        metadata: toAuditJson(input.metadata),
      },
    });
  }

  static async findMany(
    input: FindAuditLogsInput,
    client?: unknown,
  ): Promise<unknown[]> {
    const auditClient = getAuditClient(client);

    if (!auditClient?.auditLog.findMany) {
      return [];
    }

    const rows = await auditClient.auditLog.findMany(input);
    return Array.isArray(rows) ? rows : [];
  }
}

function getAuditClient(client?: unknown): AuditClientLike | null {
  if (hasAuditLogDelegate(client)) {
    return client;
  }

  return hasAuditLogDelegate(prisma) ? prisma : null;
}

function hasAuditLogDelegate(value: unknown): value is AuditClientLike {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { auditLog?: AuditLogDelegate };
  return typeof candidate.auditLog?.create === 'function';
}

function toAuditJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return Prisma.JsonNull;
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
