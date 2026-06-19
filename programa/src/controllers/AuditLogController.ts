import { Request, Response } from 'express';
import { AuditLogService } from '../services/AuditLogService';
import { handleControllerError, parseId } from '../utils/http';

export class AuditLogController {
  static async getAll(req: Request, res: Response): Promise<Response> {
    try {
      const limit = parseLimit(req.query.limit);
      const performedById = parseOptionalQueryId(req.query.performedById);

      const auditLogs = await AuditLogService.findMany({
        where: {
          entityType:
            typeof req.query.entityType === 'string' && req.query.entityType.trim()
              ? req.query.entityType.trim()
              : undefined,
          entityId:
            typeof req.query.entityId === 'string' && req.query.entityId.trim()
              ? req.query.entityId.trim()
              : undefined,
          action:
            typeof req.query.action === 'string' && req.query.action.trim()
              ? req.query.action.trim()
              : undefined,
          performedById,
        },
        include: {
          performedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
      });

      return res.status(200).json(auditLogs);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}

function parseLimit(value: unknown): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(parsed, 200);
}

function parseOptionalQueryId(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return parseOptionalQueryId(value[0]);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = parseId(value);
  return parsed ?? undefined;
}
