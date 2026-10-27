import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { AuditLogService } from '../services/AuditLogService';
import { CommercialRequestNotificationService } from '../services/CommercialRequestNotificationService';
import {
  CommercialRequestWorkflowService,
  StatusChange,
} from '../services/CommercialRequestWorkflowService';
import { computeFinalPrices, FinalPrice } from '../services/CommercialRequestPriceService';
import {
  commercialCatalogSearchQuerySchema,
  commercialRequestCreateSchema,
  commercialRequestFulfillSchema,
  commercialRequestLinkQuoteSchema,
  commercialRequestListQuerySchema,
  commercialRequestRejectSchema,
} from '../validators/domain';
import { commercialRequestLinkCatalogSchema } from '../validators/commercialRequestDevelopment';
import { normalizeItemNameKey } from '../utils/commercialItemName';
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
const MAX_DB_INT = 2147483647;

// Anexos tecnicos: SO metadados. Nunca `file` (bytea) nem `sha256` nas listas.
const attachmentsSelect = {
  orderBy: { id: 'asc' as const },
  select: { id: true, kind: true, fileName: true, mimeType: true, fileSize: true, createdAt: true },
};

// Projecao do COMERCIAL: select explicito, nunca `include` do catalogItem inteiro.
// Proibido expor marketName/dbcorpCode/ncm/notes do catalogo, fornecedor, parceiro, preco de
// fornecedor ou dados de outros solicitantes.
// `quoteRequestId` e `items.quoteRequestItemId` sao lidos SO para calcular o preco final;
// o serializer NUNCA os emite.
const commercialSelect = {
  id: true,
  status: true,
  customerName: true,
  notes: true,
  rejectionReason: true,
  fulfillmentNote: true,
  createdAt: true,
  statusChangedAt: true,
  isDevelopment: true,
  quoteRequestId: true,
  quoteRequest: { select: { requestCode: true, deletedAt: true } },
  attachments: attachmentsSelect,
  items: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      catalogItemId: true,
      // proposedName so alimenta o fallback do nome; a projecao do comercial nao o emite a parte.
      proposedName: true,
      notes: true,
      quantity: true,
      unit: true,
      targetPrice: true,
      targetCurrency: true,
      quoteRequestItemId: true,
      catalogItem: { select: { commercialName: true } },
    },
  },
} satisfies Prisma.CommercialRequestSelect;

// Projecao do COMEX.
const comexSelect = {
  id: true,
  status: true,
  customerName: true,
  notes: true,
  rejectionReason: true,
  fulfillmentNote: true,
  createdAt: true,
  statusChangedAt: true,
  isDevelopment: true,
  requestedBy: { select: { id: true, name: true, email: true } },
  statusChangedBy: { select: { id: true, name: true } },
  quoteRequest: { select: { id: true, requestCode: true, status: true, deletedAt: true } },
  attachments: attachmentsSelect,
  items: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      catalogItemId: true,
      proposedName: true,
      notes: true,
      quantity: true,
      unit: true,
      targetPrice: true,
      targetCurrency: true,
      quoteRequestItemId: true,
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

// Lista explicita de campos: mesmo que a linha traga mais (ex.: mocks), so os metadados saem.
function serializeAttachments(
  attachments:
    | {
        id: number;
        kind: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
        createdAt: Date;
      }[]
    | undefined,
) {
  return (attachments ?? []).map((attachment) => ({
    id: attachment.id,
    kind: attachment.kind,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    createdAt: attachment.createdAt,
  }));
}

// Shape ESTRITO do comercial (nada de IDs internos nem fornecedor/parceiro).
function serializeForCommercial(row: CommercialRow, prices: Map<number, FinalPrice | null>) {
  return {
    id: row.id,
    status: row.status,
    customerName: row.customerName,
    notes: row.notes,
    rejectionReason: row.rejectionReason,
    fulfillmentNote: row.fulfillmentNote,
    createdAt: row.createdAt,
    statusChangedAt: row.statusChangedAt,
    // `?? false` / `?? null`: tolera linhas de mocks anteriores a esta coluna.
    isDevelopment: row.isDevelopment ?? false,
    attachments: serializeAttachments(row.attachments),
    quote:
      row.quoteRequest && row.quoteRequest.deletedAt === null
        ? { requestCode: row.quoteRequest.requestCode }
        : null,
    items: row.items.map((item) => {
      const price = prices.get(item.id) ?? null;
      const proposedName = item.proposedName ?? null;
      return {
        id: item.id,
        catalogItemId: item.catalogItemId,
        commercialName: item.catalogItem?.commercialName ?? proposedName ?? '',
        isNewItem: proposedName !== null,
        notes: item.notes ?? null,
        quantity: item.quantity,
        unit: item.unit,
        targetPrice: serializePrice(item.targetPrice),
        targetCurrency: item.targetCurrency,
        finalPrice: price
          ? {
              unitPrice: price.unitPrice,
              currency: price.currency,
              incoterm: price.incoterm,
              unit: price.unit,
            }
          : null,
      };
    }),
  };
}

function serializeForComex(row: ComexRow) {
  return {
    id: row.id,
    status: row.status,
    customerName: row.customerName,
    notes: row.notes,
    rejectionReason: row.rejectionReason,
    fulfillmentNote: row.fulfillmentNote,
    createdAt: row.createdAt,
    statusChangedAt: row.statusChangedAt,
    isDevelopment: row.isDevelopment ?? false,
    attachments: serializeAttachments(row.attachments),
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
    items: row.items.map((item) => {
      const proposedName = item.proposedName ?? null;
      return {
        id: item.id,
        catalogItemId: item.catalogItemId,
        commercialName: item.catalogItem?.commercialName ?? proposedName ?? '',
        proposedName,
        isNewItem: proposedName !== null,
        notes: item.notes ?? null,
        marketName: item.catalogItem?.marketName ?? null,
        dbcorpCode: item.catalogItem?.dbcorpCode ?? null,
        quantity: item.quantity,
        unit: item.unit,
        targetPrice: serializePrice(item.targetPrice),
        targetCurrency: item.targetCurrency,
        quoteRequestItemId: item.quoteRequestItemId,
      };
    }),
  };
}

function requireUserId(req: Request): number {
  if (!req.user) {
    throw new HttpError(401, 'Utilizador nao autenticado.');
  }
  return req.user.id;
}

// Avisa o solicitante APOS o commit; nunca derruba a acao.
async function notifyRequesters(changes: StatusChange[]): Promise<void> {
  for (const change of changes) {
    try {
      await CommercialRequestNotificationService.notifyRequesterOfStatusChange(change.id, {
        status: change.status,
        quoteCode: change.quoteCode,
        rejectionReason: change.rejectionReason,
      });
    } catch (notifyError) {
      logger.error(
        {
          requestId: change.id,
          reason: notifyError instanceof Error ? notifyError.message : String(notifyError),
        },
        'Falha ao avisar o solicitante sobre a mudanca de status da solicitacao.',
      );
    }
  }
}

// Resposta 200 das acoes do COMEX = projecao COMEX atualizada.
async function respondWithComexRow(
  res: Response,
  requestId: number,
  changes: StatusChange[],
): Promise<Response> {
  // Avisa ANTES de reler: a mudanca ja esta commitada, entao falha na releitura nao pode
  // perder o aviso (a notificacao nunca lanca).
  await notifyRequesters(changes);
  const row = await prisma.commercialRequest.findUnique({
    where: { id: requestId },
    select: comexSelect,
  });
  if (!row) {
    throw new HttpError(404, 'Solicitacao nao encontrada.');
  }
  return res.status(200).json(serializeForComex(row));
}

function requireRequestId(req: Request): number {
  const id = parseId(req.params.id);
  // > Int do Postgres viraria 500 no banco.
  if (!id || id > MAX_DB_INT) {
    throw new HttpError(400, 'Identificador invalido.');
  }
  return id;
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

      // Linhas de catalogo x linhas novas (o schema garante exatamente uma das duas por item).
      const catalogIds = input.items.flatMap((item) =>
        item.catalogItemId !== undefined ? [item.catalogItemId] : [],
      );
      const newNames = input.items.flatMap((item) =>
        item.proposedName !== undefined ? [item.proposedName] : [],
      );

      if (catalogIds.length > 0) {
        const activeItems = await prisma.catalogItem.findMany({
          where: { id: { in: catalogIds }, isActive: true },
          select: { id: true },
        });
        if (activeItems.length !== catalogIds.length) {
          throw new HttpError(400, 'Um ou mais itens nao existem ou estao inativos.');
        }
      }

      // Item novo com o nome de um item ATIVO do catalogo: o comercial deve selecionar o item
      // (o servidor nao normaliza acento: sem unaccent; a UI cobre o caso com acento).
      if (newNames.length > 0) {
        const alreadyInCatalog = await prisma.catalogItem.findMany({
          where: {
            isActive: true,
            OR: newNames.map((name) => ({
              commercialName: { equals: name, mode: 'insensitive' as const },
            })),
          },
          select: { id: true },
        });
        if (alreadyInCatalog.length > 0) {
          throw new HttpError(
            400,
            'Um item novo ja esta cadastrado no catalogo: selecione-o na lista.',
          );
        }
      }
      const isDevelopment = newNames.length > 0;

      const created = await prisma.$transaction(async (tx) => {
        const request = await tx.commercialRequest.create({
          data: {
            requestedById: userId,
            customerName: input.customerName ?? null,
            notes: input.notes ?? null,
            status: 'pending',
            isDevelopment,
            items: {
              create: input.items.map((item) => {
                const hasPrice = item.targetPrice !== undefined && item.targetPrice !== null;
                const isNew = item.proposedName !== undefined;
                return {
                  catalogItemId: isNew ? null : (item.catalogItemId ?? null),
                  proposedName: isNew ? (item.proposedName ?? null) : null,
                  proposedNameKey: isNew && item.proposedName ? normalizeItemNameKey(item.proposedName) : null,
                  notes: item.notes ?? null,
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
              // Sem texto livre dos campos novos: nada de proposedName/notes do item.
              isDevelopment,
              items: request.items.map((item) => ({
                catalogItemId: item.catalogItemId,
                isNewItem: item.proposedName !== null,
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

      // Recem-criada = sempre `pending`: sem preco final, nada a consultar.
      return res.status(201).json(serializeForCommercial(created, new Map()));
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

      // Preco final so em `fulfilled`, calculado na leitura em lote (zero queries sem fulfilled).
      const prices = await computeFinalPrices(prisma, rows);

      return res.status(200).json(
        buildPaginatedResponse(
          rows.map((row) => serializeForCommercial(row, prices)),
          total,
          pagination,
        ),
      );
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
      const { status, requestedById, quoteRequestId } = commercialRequestListQuerySchema.parse(
        req.query,
      );
      const pagination = parsePagination(req);
      const where: Prisma.CommercialRequestWhereInput = {
        ...(status ? { status } : {}),
        ...(requestedById ? { requestedById } : {}),
        ...(quoteRequestId ? { quoteRequestId } : {}),
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

  // (b) Vincula a uma cotacao aberta existente.
  static async linkQuote(req: Request, res: Response): Promise<Response> {
    try {
      const id = requireRequestId(req);
      const userId = requireUserId(req);
      const { quoteRequestId } = commercialRequestLinkQuoteSchema.parse(req.body ?? {});

      const changes = await CommercialRequestWorkflowService.linkToExistingQuote(
        id,
        quoteRequestId,
        userId,
      );
      return await respondWithComexRow(res, id, changes);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  // Vincula um item novo ao catalogo (Comex), antes de cotar. Sem notificacao ao comercial.
  static async linkItemToCatalog(req: Request, res: Response): Promise<Response> {
    try {
      const id = requireRequestId(req);
      const itemId = parseId(req.params.itemId);
      if (!itemId || itemId > MAX_DB_INT) {
        throw new HttpError(400, 'Identificador invalido.');
      }
      const userId = requireUserId(req);
      const { catalogItemId } = commercialRequestLinkCatalogSchema.parse(req.body ?? {});

      await CommercialRequestWorkflowService.linkItemToCatalog(id, itemId, catalogItemId, userId);
      return await respondWithComexRow(res, id, []);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  // (c) Recusa com motivo.
  static async reject(req: Request, res: Response): Promise<Response> {
    try {
      const id = requireRequestId(req);
      const userId = requireUserId(req);
      const { reason } = commercialRequestRejectSchema.parse(req.body ?? {});

      const changes = await CommercialRequestWorkflowService.reject(id, reason, userId);
      return await respondWithComexRow(res, id, changes);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  // (d) Marca atendida (exige vencedor; so admin forca sem preco, com motivo).
  static async fulfill(req: Request, res: Response): Promise<Response> {
    try {
      const id = requireRequestId(req);
      const userId = requireUserId(req);
      // 403 antes da validacao: so admin forca sem preco.
      if ((req.body as { force?: unknown } | undefined)?.force === true && req.user?.role !== 'admin') {
        throw new HttpError(403, 'Somente administradores podem atender sem preco.');
      }
      const input = commercialRequestFulfillSchema.parse(req.body ?? {});

      const changes = await CommercialRequestWorkflowService.fulfill(id, input, {
        id: userId,
        role: req.user?.role ?? '',
      });
      return await respondWithComexRow(res, id, changes);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
