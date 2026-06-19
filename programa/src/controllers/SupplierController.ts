import { Request, Response } from 'express';
import { Incoterm, Prisma, SupplierStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import { supplierCreateSchema, supplierUpdateSchema } from '../validators/domain';
import {
  buildPaginatedResponse,
  handleControllerError,
  hasListQuery,
  parseId,
  parseOptionalQueryString,
  parsePagination,
} from '../utils/http';

export class SupplierController {
  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const parsedBody = supplierCreateSchema.safeParse(req.body);

      if (!parsedBody.success) {
        return res.status(400).json({
          message:
            'Informe name, acceptedIncoterms e dados operacionais validos para o fornecedor.',
        });
      }

      const payload = parsedBody.data;

      const supplier = await prisma.supplier.create({
        data: {
          name: payload.name,
          website: payload.website ?? null,
          status: payload.status ?? SupplierStatus.active,
          country: payload.country ?? null,
          notes: payload.notes ?? null,
          paymentTermsDays: payload.paymentTermsDays ?? 30,
          createdById: req.user?.id ?? null,
          acceptedIncoterms: payload.acceptedIncoterms as Incoterm[],
        },
      });

      await AuditLogService.log({
        entityType: 'supplier',
        entityId: supplier.id,
        action: 'create',
        performedById: req.user?.id ?? null,
        afterData: supplier,
      });

      return res.status(201).json(supplier);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getAll(req: Request, res: Response): Promise<Response> {
    try {
      const where = buildSupplierWhere(req);
      const orderBy = { name: 'asc' } as const;

      if (!hasListQuery(req)) {
        const suppliers = await prisma.supplier.findMany({
          where,
          orderBy,
        });

        return res.status(200).json(suppliers);
      }

      const pagination = parsePagination(req);
      const [suppliers, totalItems] = await prisma.$transaction([
        prisma.supplier.findMany({
          where,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.supplier.count({ where }),
      ]);

      return res
        .status(200)
        .json(buildPaginatedResponse(suppliers, totalItems, pagination));
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
          message: 'ID do fornecedor invalido.',
        });
      }

      const supplier = await prisma.supplier.findUnique({
        where: { id },
      });

      if (!supplier) {
        return res.status(404).json({
          message: 'Fornecedor nao encontrado.',
        });
      }

      return res.status(200).json(supplier);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);

      if (!id) {
        return res.status(400).json({
          message: 'ID do fornecedor invalido.',
        });
      }

      const parsedBody = supplierUpdateSchema.safeParse(req.body);

      if (!parsedBody.success) {
        return res.status(400).json({
          message: 'Os dados operacionais enviados para o fornecedor sao invalidos.',
        });
      }

      const payload = parsedBody.data;

      const existingSupplier = await prisma.supplier.findUnique({
        where: { id },
      });

      if (!existingSupplier) {
        return res.status(404).json({
          message: 'Fornecedor nao encontrado.',
        });
      }

      const supplier = await prisma.supplier.update({
        where: { id },
        data: {
          name: payload.name,
          website: payload.website,
          status: payload.status as SupplierStatus | undefined,
          country: payload.country,
          notes: payload.notes,
          paymentTermsDays: payload.paymentTermsDays,
          acceptedIncoterms: payload.acceptedIncoterms as Incoterm[] | undefined,
        },
      });

      await AuditLogService.log({
        entityType: 'supplier',
        entityId: supplier.id,
        action: 'update',
        performedById: req.user?.id ?? null,
        beforeData: existingSupplier,
        afterData: supplier,
      });

      return res.status(200).json(supplier);
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
          message: 'ID do fornecedor invalido.',
        });
      }

      const existingSupplier = await prisma.supplier.findUnique({
        where: { id },
      });

      if (!existingSupplier) {
        return res.status(404).json({
          message: 'Fornecedor nao encontrado.',
        });
      }

      const linkedQuoteResponse = await prisma.quoteResponse.findFirst({
        where: { supplierId: id },
        select: {
          id: true,
        },
      });

      if (linkedQuoteResponse) {
        return res.status(400).json({
          message:
            'Nao e permitido apagar um fornecedor com propostas registadas ou historico operacional. Inative ou bloqueie o fornecedor em vez de o apagar.',
        });
      }

      await prisma.supplier.delete({
        where: { id },
      });

      await AuditLogService.log({
        entityType: 'supplier',
        entityId: existingSupplier.id,
        action: 'delete',
        performedById: req.user?.id ?? null,
        beforeData: existingSupplier,
        afterData: null,
      });

      return res.status(204).send();
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}

function buildSupplierWhere(req: Request): Prisma.SupplierWhereInput {
  const search = parseOptionalQueryString(req.query.search);
  const status = parseOptionalQueryString(req.query.status);
  const where: Prisma.SupplierWhereInput = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { country: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (status && status !== 'all') {
    where.status = status as SupplierStatus;
  }

  return where;
}
