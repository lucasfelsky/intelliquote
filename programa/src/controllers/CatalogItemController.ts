import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  handleControllerError,
  HttpError,
  isNonEmptyString,
  parseId,
  parsePagination,
  buildPaginatedResponse,
} from '../utils/http';

const NCM_REGEX = /^\d{8}$/;

export class CatalogItemController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const pagination = parsePagination(req);
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const onlyDg = req.query.onlyDg === 'true';
      const includeInactive = req.query.includeInactive === 'true';

      const where: Record<string, unknown> = {};
      if (!includeInactive) {
        where.isActive = true;
      }
      if (onlyDg) {
        where.isDangerousGood = true;
      }
      if (search) {
        where.OR = [
          { commercialName: { contains: search, mode: 'insensitive' } },
          { marketName: { contains: search, mode: 'insensitive' } },
          { ncm: { contains: search } },
          { dbcorpCode: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [total, items] = await Promise.all([
        prisma.catalogItem.count({ where }),
        prisma.catalogItem.findMany({
          where,
          orderBy: [{ marketName: 'asc' }],
          skip: pagination.skip,
          take: pagination.take,
        }),
      ]);

      return res.status(200).json(buildPaginatedResponse(items, total, pagination));
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async getById(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID do item invalido.' });
      }

      const item = await prisma.catalogItem.findUnique({ where: { id } });
      if (!item) {
        return res.status(404).json({ message: 'Item de catalogo nao encontrado.' });
      }

      return res.status(200).json(item);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const body = req.body as Record<string, unknown>;
      const commercialName = isNonEmptyString(body.commercialName) ? body.commercialName.trim() : null;
      const marketName = isNonEmptyString(body.marketName) ? body.marketName.trim() : null;
      const ncm = isNonEmptyString(body.ncm) ? body.ncm.trim() : null;
      const dbcorpCode = isNonEmptyString(body.dbcorpCode) ? body.dbcorpCode.trim().toUpperCase() : null;
      const isDangerousGood = body.isDangerousGood === true;
      const notes = isNonEmptyString(body.notes) ? body.notes.trim() : null;
      const isActive = body.isActive === undefined ? true : body.isActive !== false;

      if (!commercialName || !marketName) {
        return res.status(400).json({
          message: 'Informe nome comercial e nome de mercado do item.',
        });
      }

      if (ncm && !NCM_REGEX.test(ncm)) {
        return res.status(400).json({
          message: 'NCM invalido. Use 8 digitos (ex: 29141100).',
        });
      }

      const existing = await prisma.catalogItem.findUnique({ where: { marketName } });
      if (existing) {
        return res.status(409).json({
          message: 'Ja existe um item cadastrado com esse nome de mercado.',
        });
      }

      const item = await prisma.catalogItem.create({
        data: {
          commercialName,
          marketName,
          ncm,
          dbcorpCode,
          isDangerousGood,
          notes,
          isActive,
        },
      });

      await AuditLogService.log({
        entityType: 'catalog_item',
        entityId: item.id,
        action: 'create',
        performedById: req.user?.id ?? null,
        afterData: item,
      });

      return res.status(201).json(item);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID do item invalido.' });
      }
      const body = req.body as Record<string, unknown>;

      const existing = await prisma.catalogItem.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: 'Item de catalogo nao encontrado.' });
      }

      const data: Record<string, unknown> = {};
      if (isNonEmptyString(body.commercialName)) {
        data.commercialName = body.commercialName.trim();
      }
      if (isNonEmptyString(body.marketName)) {
        const next = body.marketName.trim();
        if (next !== existing.marketName) {
          const conflict = await prisma.catalogItem.findUnique({ where: { marketName: next } });
          if (conflict && conflict.id !== id) {
            return res.status(409).json({
              message: 'Ja existe um item cadastrado com esse nome de mercado.',
            });
          }
          data.marketName = next;
        }
      }
      if (body.ncm !== undefined) {
        if (body.ncm === null || body.ncm === '') {
          data.ncm = null;
        } else if (isNonEmptyString(body.ncm)) {
          const ncm = body.ncm.trim();
          if (!NCM_REGEX.test(ncm)) {
            return res.status(400).json({
              message: 'NCM invalido. Use 8 digitos (ex: 29141100).',
            });
          }
          data.ncm = ncm;
        }
      }
      if (body.dbcorpCode !== undefined) {
        if (body.dbcorpCode === null || body.dbcorpCode === '') {
          data.dbcorpCode = null;
        } else if (isNonEmptyString(body.dbcorpCode)) {
          data.dbcorpCode = body.dbcorpCode.trim().toUpperCase();
        }
      }
      if (body.isDangerousGood !== undefined) {
        data.isDangerousGood = body.isDangerousGood === true;
      }
      if (body.notes !== undefined) {
        data.notes = isNonEmptyString(body.notes) ? body.notes.trim() : null;
      }
      if (body.isActive !== undefined) {
        data.isActive = body.isActive !== false;
      }

      const item = await prisma.catalogItem.update({ where: { id }, data });

      await AuditLogService.log({
        entityType: 'catalog_item',
        entityId: item.id,
        action: 'update',
        performedById: req.user?.id ?? null,
        beforeData: existing,
        afterData: item,
      });

      return res.status(200).json(item);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async softDelete(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID do item invalido.' });
      }

      const existing = await prisma.catalogItem.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ message: 'Item de catalogo nao encontrado.' });
      }

      // Impede soft-delete se ha QuoteRequestItem vinculado.
      const linkedCount = await prisma.quoteRequestItem.count({
        where: { catalogItemId: id },
      });
      if (linkedCount > 0) {
        throw new HttpError(
          409,
          `Nao e possivel remover: item vinculado a ${linkedCount} cotacao(oes). Inative-o em vez de remover.`,
        );
      }

      const item = await prisma.catalogItem.update({
        where: { id },
        data: { isActive: false },
      });

      await AuditLogService.log({
        entityType: 'catalog_item',
        entityId: item.id,
        action: 'soft_delete',
        performedById: req.user?.id ?? null,
        beforeData: existing,
        afterData: item,
      });

      return res.status(200).json(item);
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}
