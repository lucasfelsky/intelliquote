import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { AuditLogService } from '../services/AuditLogService';
import { CommercialRequestNotificationService } from '../services/CommercialRequestNotificationService';
import {
  commercialCatalogSearchQuerySchema,
  commercialRequestCreateSchema,
  commercialRequestListQuerySchema,
} from '../validators/domain';
import {
  buildPaginatedResponse,
  handleControllerError,
  HttpError,
  parseId,
  parsePagination,
} from '../utils/http';

const ENTITY_TYPE = 'commercial_request';
const DEFAULT_TARGET_CURRENCY = 'USD';
const CATALOG_SEARCH_LIMIT = 20;

// Projecao do COMERCIAL: select explicito, nunca `include` do catalogItem inteiro.
// Proibido expor marketName/dbcorpCode/ncm/notes do catalogo, fornecedor, preco de
// fornecedor ou dados de outros solicitantes.
const commercialSelect = {
  id: true,
  status: true,
  customerName: true,
  notes: true,
  rejectionReason: true,
  createdAt: true,
  statusChangedAt: true,
  quoteRequest: { select: { requestCode: true, deletedAt: true } },
  items: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      catalogItemId: true,
      quantity: true,
      unit: true,
      targetPrice: true,
      targetCurrency: true,
      catalogItem: { select: { commercialName: true } },
    },
  },
} satisfies Prisma.CommercialRequestSelect;

// Projecao do COMEX (somente leitura no PR1).
const comexSelect = {
  id: true,
  status: true,
  customerName: true,
  notes: true,
  rejectionReason: true,
  createdAt: true,
  statusChangedAt: true,
  requestedBy: { select: { id: true, name: true, email: true } },
  statusChangedBy: { select: { id: true, name: true } },
  quoteRequest: { select: { id: true, requestCode: true, status: true, deletedAt: true } },
  items: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      catalogItemId: true,
      quantity: true,
      unit: true,
      targetPrice: true,
      targetCurrency: true,
      catalogItem: {
        select: { commercialName: true, marketName: true, dbcorpCode: true },
      },
    },
  },
} satisfies Prisma.CommercialRequestSelect;

type CommercialRow = Prisma.CommercialRequestGetPayload<{ select: typeof commercialSelect }>;
type ComexRow = Prisma.CommercialRequestGetPayload<{ select: typeof comexSelect }>;

function serializePrice(
  value: { toFixed: (digits: number) => string } | string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value.toFixed(2);
  return String(value);
}

function serializeForCommercial(row: CommercialRow) {
  return {
    id: row.id,
    status: row.status,
    customerName: row.customerName,
    notes: row.notes,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    statusChangedAt: row.statusChangedAt,
    quote:
      row.quoteRequest && row.quoteRequest.deletedAt === null
        ? { requestCode: row.quoteRequest.requestCode }
        : null,
    items: row.items.map((item) => ({
      id: item.id,
      catalogItemId: item.catalogItemId,
      commercialName: item.catalogItem.commercialName,
      quantity: item.quantity,
      unit: item.unit,
      targetPrice: serializePrice(item.targetPrice),
      targetCurrency: item.targetCurrency,
    })),
  };
}

function serializeForComex(row: ComexRow) {
  return {
    id: row.id,
    status: row.status,
    customerName: row.customerName,
    notes: row.notes,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    statusChangedAt: row.statusChangedAt,
    requestedBy: row.requestedBy,
    statusChangedBy: row.statusChangedBy,
    quoteRequest:
      row.quoteRequest && row.quoteRequest.deletedAt === null
        ? {
            id: row.quoteRequest.id,
            requestCode: row.quoteRequest.requestCode,
            status: row.quoteRequest.status,
          }
        : null,
    items: row.items.map((item) => ({
      id: item.id,
      catalogItemId: item.catalogItemId,
      commercialName: item.catalogItem.commercialName,
      marketName: item.catalogItem.marketName,
      dbcorpCode: item.catalogItem.dbcorpCode,
      quantity: item.quantity,
      unit: item.unit,
      targetPrice: serializePrice(item.targetPrice),
      targetCurrency: item.targetCurrency,
    })),
  };
}

function requireUserId(req: Request): number {
  if (!req.user) {
    throw new HttpError(401, 'Utilizador nao autenticado.');
  }
  return req.user.id;
}

export class CommercialRequestController {
  // Busca de itens do comercial: SO commercialName + familia (nunca marketName/dbcorpCode/ncm).
  static async searchCatalogItems(req: Request, res: Response): Promise<Response> {
    try {
      const { search } = commercialCatalogSearchQuerySchema.parse(req.query);

      const items = await prisma.catalogItem.findMany({
        where: {
          isActive: true,
          ...(search ? { commercialName: { contains: search, mode: 'insensitive' as const } } : {}),
        },
        select: {
          id: true,
          commercialName: true,
          family: { select: { name: true } },
        },
        orderBy: { commercialName: 'asc' },
        take: CATALOG_SEARCH_LIMIT,
      });

      return res.status(200).json(
        items.map((item) => ({
          id: item.id,
          commercialName: item.commercialName,
          familyName: item.family?.name ?? null,
        })),
      );
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const userId = requireUserId(req);
      const input = commercialRequestCreateSchema.parse(req.body);

      const catalogIds = input.items.map((item) => item.catalogItemId);
      const activeItems = await prisma.catalogItem.findMany({
        where: { id: { in: catalogIds }, isActive: true },
        select: { id: true },
      });
      if (activeItems.length !== catalogIds.length) {
        throw new HttpError(400, 'Um ou mais itens nao existem ou estao inativos.');
      }

      const created = await prisma.$transaction(async (tx) => {
        const request = await tx.commercialRequest.create({
          data: {
            requestedById: userId,
            customerName: input.customerName ?? null,
            notes: input.notes ?? null,
            status: 'pending',
            items: {
              create: input.items.map((item) => {
                const hasPrice = item.targetPrice !== undefined && item.targetPrice !== null;
                return {
                  catalogItemId: item.catalogItemId,
                  quantity: item.quantity,
                  unit: item.unit,
                  targetPrice: hasPrice ? item.targetPrice : null,
                  targetCurrency: hasPrice
                    ? (item.targetCurrency ?? DEFAULT_TARGET_CURRENCY)
                    : null,
                };
              }),
            },
          },
          select: commercialSelect,
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: request.id,
            action: 'create',
            performedById: userId,
            afterData: {
              status: request.status,
              customerName: request.customerName,
              items: request.items.map((item) => ({
                catalogItemId: item.catalogItemId,
                quantity: item.quantity,
                unit: item.unit,
              })),
            },
          },
          tx,
        );

        return request;
      });

      // Aviso a Equipe COMEX: APOS o commit; nunca derruba a criacao.
      try {
        await CommercialRequestNotificationService.notifyComexOfNewRequest(created.id);
      } catch (notifyError) {
        logger.error(
          {
            requestId: created.id,
            reason: notifyError instanceof Error ? notifyError.message : String(notifyError),
          },
          'Falha ao avisar a Equipe COMEX sobre nova solicitacao do comercial.',
        );
      }

      return res.status(201).json(serializeForCommercial(created));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async listMine(req: Request, res: Response): Promise<Response> {
    try {
      const userId = requireUserId(req);
      // So `status` e' aceito: `requestedById` da query e' ignorado (sempre a sessao).
      const { status } = commercialRequestListQuerySchema.parse(req.query);
      const pagination = parsePagination(req);
      const where: Prisma.CommercialRequestWhereInput = {
        requestedById: userId,
        ...(status ? { status } : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.commercialRequest.findMany({
          where,
          select: commercialSelect,
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.commercialRequest.count({ where }),
      ]);

      return res
        .status(200)
        .json(buildPaginatedResponse(rows.map(serializeForCommercial), total, pagination));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async pendingCount(_req: Request, res: Response): Promise<Response> {
    try {
      const count = await prisma.commercialRequest.count({ where: { status: 'pending' } });
      return res.status(200).json({ count });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async listRequesters(_req: Request, res: Response): Promise<Response> {
    try {
      const users = await prisma.user.findMany({
        where: { commercialRequests: { some: {} } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      return res.status(200).json(users.map((user) => ({ id: user.id, name: user.name })));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const { status, requestedById } = commercialRequestListQuerySchema.parse(req.query);
      const pagination = parsePagination(req);
      const where: Prisma.CommercialRequestWhereInput = {
        ...(status ? { status } : {}),
        ...(requestedById ? { requestedById } : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.commercialRequest.findMany({
          where,
          select: comexSelect,
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.commercialRequest.count({ where }),
      ]);

      return res
        .status(200)
        .json(buildPaginatedResponse(rows.map(serializeForComex), total, pagination));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        throw new HttpError(400, 'Identificador invalido.');
      }

      const row = await prisma.commercialRequest.findUnique({
        where: { id },
        select: comexSelect,
      });
      if (!row) {
        throw new HttpError(404, 'Solicitacao nao encontrada.');
      }

      return res.status(200).json(serializeForComex(row));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
