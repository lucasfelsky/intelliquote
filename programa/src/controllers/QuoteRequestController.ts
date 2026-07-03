import { Request, Response } from 'express';
import { Incoterm, Prisma, QuoteRequestStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  quoteRequestCreateSchema,
  quoteRequestUpdateSchema,
} from '../validators/domain';
import {
  handleControllerError,
  buildPaginatedResponse,
  hasListQuery,
  HttpError,
  parseId,
  parseOptionalQueryString,
  parsePagination,
} from '../utils/http';
import { buildRequestCode } from '../utils/requestCode';

export class QuoteRequestController {
  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const { status } = req.body as Record<string, unknown>;
      const parsedBody = quoteRequestCreateSchema.safeParse(req.body);

      if (
        !parsedBody.success ||
        (status !== undefined && status !== QuoteRequestStatus.open)
      ) {
        return res.status(400).json({
          message:
            'Informe desiredIncoterm e demais dados operacionais validos. Produto e quantidade passam a ser definidos pelos itens do catalogo.',
        });
      }

      const payload = parsedBody.data;

      const quoteRequest = await prisma.quoteRequest.create({
        data: {
          requestCode: payload.requestCode ?? buildRequestCode(),
          productName: payload.productName ?? null,
          quantity: payload.quantity ?? null,
          description: payload.description ?? null,
          desiredIncoterm: payload.desiredIncoterm,
          destinationPort: payload.destinationPort ?? null,
          originPort: payload.originPort ?? 'Shanghai',
          currency: payload.currency ?? 'USD',
          deadlineAt: payload.deadlineAt ?? null,
          status: QuoteRequestStatus.open,
          createdById: req.user?.id ?? null,
        },
        include: {
          items: {
            include: { catalogItem: true },
            orderBy: { createdAt: 'asc' },
          },
          quoteResponses: true,
        },
      });

      await AuditLogService.log({
        entityType: 'quote_request',
        entityId: quoteRequest.id,
        action: 'create',
        performedById: req.user?.id ?? null,
        afterData: quoteRequest,
      });

      return res.status(201).json(quoteRequest);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getAll(req: Request, res: Response): Promise<Response> {
    try {
      const where = buildQuoteRequestWhere(req);
      const include = {
        _count: {
          select: { items: true, quoteResponses: true },
        },
        items: {
          include: { catalogItem: true },
          orderBy: { createdAt: 'asc' as const },
        },
        quoteResponses: true,
      };
      const orderBy = { createdAt: 'desc' } as const;

      if (!hasListQuery(req)) {
        const quoteRequests = await prisma.quoteRequest.findMany({
          where,
          include,
          orderBy,
        });

        return res.status(200).json(quoteRequests);
      }

      const pagination = parsePagination(req);
      const [quoteRequests, totalItems] = await prisma.$transaction([
        prisma.quoteRequest.findMany({
          where,
          include,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.quoteRequest.count({ where }),
      ]);

      return res
        .status(200)
        .json(buildPaginatedResponse(quoteRequests, totalItems, pagination));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({
          message: 'ID da cotacao invalido.',
        });
      }

      const quoteRequest = await prisma.quoteRequest.findFirst({
        where: { id, deletedAt: null },
        include: {
          items: {
            include: { catalogItem: true },
            orderBy: { createdAt: 'asc' },
          },
          quoteResponses: {
            include: {
              supplier: true,
            },
          },
        },
      });

      if (!quoteRequest) {
        return res.status(404).json({
          message: 'Cotacao nao encontrada.',
        });
      }

      return res.status(200).json(quoteRequest);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      const { status } = req.body as Record<string, unknown>;

      if (!id) {
        return res.status(400).json({
          message: 'ID da cotacao invalido.',
        });
      }

      if (status !== undefined) {
        return res.status(400).json({
          message:
            'O status da cotacao deve ser alterado pelas acoes de fechar ou reabrir.',
        });
      }

      const parsedBody = quoteRequestUpdateSchema.safeParse(req.body);

      if (!parsedBody.success) {
        return res.status(400).json({
          message: 'Os dados enviados para atualizar a cotacao sao invalidos.',
        });
      }

      const payload = parsedBody.data;

      const existingQuoteRequest = await prisma.quoteRequest.findUnique({
        where: { id },
      });

      if (!existingQuoteRequest) {
        return res.status(404).json({
          message: 'Cotacao nao encontrada.',
        });
      }

      ensureQuoteRequestOpen(
        existingQuoteRequest.status,
        'Reabra a cotacao antes de alterar os seus dados.',
      );

      const quoteRequest = await prisma.quoteRequest.update({
        where: { id },
        data: {
          requestCode: payload.requestCode,
          productName:
            payload.productName === undefined ? undefined : payload.productName,
          quantity: payload.quantity === undefined ? undefined : payload.quantity,
          description: payload.description,
          desiredIncoterm: payload.desiredIncoterm,
          destinationPort:
            payload.destinationPort === undefined ? undefined : payload.destinationPort,
          originPort: payload.originPort === undefined ? undefined : payload.originPort,
          currency: payload.currency,
          deadlineAt: payload.deadlineAt,
        },
        include: {
          items: {
            include: { catalogItem: true },
            orderBy: { createdAt: 'asc' as const },
          },
          quoteResponses: true,
        },
      });

      await AuditLogService.log({
        entityType: 'quote_request',
        entityId: quoteRequest.id,
        action: 'update',
        performedById: req.user?.id ?? null,
        beforeData: existingQuoteRequest,
        afterData: quoteRequest,
      });

      return res.status(200).json(quoteRequest);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async close(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({
          message: 'ID da cotacao invalido.',
        });
      }

      const quoteRequest = await prisma.quoteRequest.findUnique({
        where: { id },
      });

      if (!quoteRequest) {
        return res.status(404).json({
          message: 'Cotacao nao encontrada.',
        });
      }

      if (quoteRequest.status === QuoteRequestStatus.closed) {
        return res.status(400).json({
          message: 'A cotacao ja esta fechada.',
        });
      }

      const updatedQuoteRequest = await prisma.$transaction(async (tx) => {
        const closedQuoteRequest = await tx.quoteRequest.update({
          where: { id },
          data: {
            status: QuoteRequestStatus.closed,
            closedAt: new Date(),
          },
        });

        await AuditLogService.log(
          {
            entityType: 'quote_request',
            entityId: closedQuoteRequest.id,
            action: 'close',
            performedById: req.user?.id ?? null,
            beforeData: quoteRequest,
            afterData: closedQuoteRequest,
          },
          tx,
        );

        return closedQuoteRequest;
      });

      return res.status(200).json(updatedQuoteRequest);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async reopen(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({
          message: 'ID da cotacao invalido.',
        });
      }

      const quoteRequest = await prisma.quoteRequest.findUnique({
        where: { id },
      });

      if (!quoteRequest) {
        return res.status(404).json({
          message: 'Cotacao nao encontrada.',
        });
      }

      if (quoteRequest.status === QuoteRequestStatus.open) {
        return res.status(400).json({
          message: 'A cotacao ja esta aberta.',
        });
      }

      const reopenedQuoteRequest = await prisma.$transaction(async (tx) => {
        await tx.quoteResponse.updateMany({
          where: { quoteRequestId: id },
          data: { isWinner: false },
        });

        const reopenedQuoteRequest = await tx.quoteRequest.update({
          where: { id },
          data: {
            status: QuoteRequestStatus.open,
            closedAt: null,
          },
        });

        await AuditLogService.log(
          {
            entityType: 'quote_request',
            entityId: reopenedQuoteRequest.id,
            action: 'reopen',
            performedById: req.user?.id ?? null,
            beforeData: quoteRequest,
            afterData: reopenedQuoteRequest,
            metadata: {
              clearedWinners: true,
            },
          },
          tx,
        );

        return reopenedQuoteRequest;
      });

      return res.status(200).json(reopenedQuoteRequest);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async delete(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({
          message: 'ID da cotacao invalido.',
        });
      }

      const existingQuoteRequest = await prisma.quoteRequest.findFirst({
        where: { id, deletedAt: null },
        include: {
          items: { select: { id: true, catalogItemId: true } },
          quoteResponses: { select: { id: true } },
        },
      });

      if (!existingQuoteRequest) {
        return res.status(404).json({
          message: 'Cotacao nao encontrada.',
        });
      }

      const deletedAt = new Date();

      // Cascade soft delete: ao remover a cotacao, todas as respostas
      // (e os itens do portal vinculados a cada resposta), os itens
      // da cotacao e os tokens do portal sao marcados como removidos
      // para manter integridade referencial e impedir acessos futuros.
      await prisma.$transaction(async (tx) => {
        const responseIds = existingQuoteRequest.quoteResponses.map((r) => r.id);

        if (responseIds.length > 0) {
          // Itens das respostas primeiro (FK -> SupplierPortalResponse.responseId).
          // Eles referenciam QuoteRequestItem via quoteRequestItemId; marcamos
          // tambem para evitar contagens orfas em relatorios futuros.
          await tx.supplierPortalResponseItem.updateMany({
            where: { response: { quoteRequestId: id } },
            data: { deletedAt },
          });

          await tx.supplierPortalResponse.updateMany({
            where: { quoteRequestId: id },
            data: { deletedAt },
          });

          await tx.quoteResponse.updateMany({
            where: { id: { in: responseIds } },
            data: { deletedAt },
          });
        }

        await tx.quoteRequestItem.updateMany({
          where: { quoteRequestId: id },
          data: { deletedAt },
        });

        // Revogar tokens do portal vinculados para impedir novos acessos.
        await tx.supplierPortalToken.updateMany({
          where: { quoteRequestId: id, revokedAt: null },
          data: { revokedAt: deletedAt },
        });

        await tx.quoteRequest.update({
          where: { id },
          data: { deletedAt, status: QuoteRequestStatus.closed, closedAt: deletedAt },
        });
      });

      await AuditLogService.log({
        entityType: 'quote_request',
        entityId: existingQuoteRequest.id,
        action: 'soft_delete',
        performedById: req.user?.id ?? null,
        beforeData: existingQuoteRequest,
        afterData: {
          deletedAt,
          status: QuoteRequestStatus.closed,
          cascadedResponses: existingQuoteRequest.quoteResponses.length,
          cascadedItems: existingQuoteRequest.items.length,
        },
        metadata: {
          cascade: 'quote_responses+items+portal_tokens',
        },
      });

      return res.status(200).json({
        ok: true,
        id,
        deletedAt,
        cascadedResponses: existingQuoteRequest.quoteResponses.length,
        cascadedItems: existingQuoteRequest.items.length,
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}

function ensureQuoteRequestOpen(
  status: QuoteRequestStatus,
  message: string,
): void {
  if (status === QuoteRequestStatus.closed) {
    throw new HttpError(400, message);
  }
}

function buildQuoteRequestWhere(req: Request): Prisma.QuoteRequestWhereInput {
  const search = parseOptionalQueryString(req.query.search);
  const status = parseOptionalQueryString(req.query.status);
  const incoterm = parseOptionalQueryString(req.query.incoterm);
  const includeDeleted = parseOptionalQueryString(req.query.includeDeleted) === 'true';
  const where: Prisma.QuoteRequestWhereInput = {};

  if (!includeDeleted) {
    where.deletedAt = null;
  }

  if (search) {
    where.OR = [
      { productName: { contains: search, mode: 'insensitive' } },
      { requestCode: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (status && status !== 'all') {
    where.status = status as QuoteRequestStatus;
  }

  if (incoterm && (Object.values(Incoterm) as string[]).includes(incoterm)) {
    where.desiredIncoterm = { has: incoterm as Incoterm };
  }

  return where;
}
