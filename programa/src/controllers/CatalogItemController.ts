import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuditLogService } from '../services/AuditLogService';
import {
  executarComVinculo,
  liberarVinculoAntigo,
  listarSemForecast,
  vincularNaTransacao,
} from '../services/CatalogItemForecastLinkService';
import { normalizeProductCode } from '../utils/forecastWorkbook';
import {
  catalogItemForecastFieldSchema,
  catalogItemForecastLinkSchema,
  catalogItemSemForecastQuerySchema,
} from '../validators/domain';
import {
  handleControllerError,
  HttpError,
  isNonEmptyString,
  parseId,
  parsePagination,
  buildPaginatedResponse,
} from '../utils/http';

const NCM_REGEX = /^\d{8}$/;
const SEM_CODIGO_MESSAGE = 'Informe o código DBCorp para vincular o item ao Forecast.';
const SEM_ITEM_ATIVO_MESSAGE = 'Reative o item para vinculá-lo ao Forecast.';

export class CatalogItemController {
  static async list(req: Request, res: Response): Promise<Response> {
    try {
      const pagination = parsePagination(req);
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const familyIdStr = typeof req.query.family === 'string' ? req.query.family.trim() : '';
      const includeInactive = req.query.includeInactive === 'true';

      const where: Record<string, unknown> = {};
      if (!includeInactive) {
        where.isActive = true;
      }
      if (search) {
        where.OR = [
          { commercialName: { contains: search, mode: 'insensitive' } },
          { marketName: { contains: search, mode: 'insensitive' } },
          { ncm: { contains: search } },
          { dbcorpCode: { contains: search, mode: 'insensitive' } },
          { family: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }
      if (familyIdStr) {
        where.familyId = Number(familyIdStr);
      }

      const [total, items] = await Promise.all([
        prisma.catalogItem.count({ where }),
        prisma.catalogItem.findMany({
          where,
          include: { family: true },
          orderBy: [{ commercialName: 'asc' }],
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

      const item = await prisma.catalogItem.findUnique({ 
        where: { id },
        include: { family: true }
      });
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
      const notes = isNonEmptyString(body.notes) ? body.notes.trim() : null;
      const familyId = typeof body.familyId === 'number' ? body.familyId : null;
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

      const forecast = catalogItemForecastFieldSchema.parse(body.forecast) ?? null;
      if (forecast && !dbcorpCode) {
        return res.status(400).json({ message: SEM_CODIGO_MESSAGE });
      }

      const data = {
        commercialName,
        marketName,
        ncm,
        dbcorpCode,
        familyId,
        notes,
        isActive,
      };

      // Sem codigo DBCorp nao ha o que vincular: caminho atual, sem transacao.
      if (!dbcorpCode) {
        const item = await prisma.catalogItem.create({ data, include: { family: true } });

        await AuditLogService.log({
          entityType: 'catalog_item',
          entityId: item.id,
          action: 'create',
          performedById: req.user?.id ?? null,
          afterData: item,
        });

        return res.status(201).json(item);
      }

      // Item + codigo no Forecast na MESMA transacao (com a lock do import): falha no vinculo desfaz o item.
      const userId = req.user?.id ?? null;
      const { item, vinculo } = await executarComVinculo(async (tx) => {
        const created = await tx.catalogItem.create({ data, include: { family: true } });
        await AuditLogService.log(
          {
            entityType: 'catalog_item',
            entityId: created.id,
            action: 'create',
            performedById: userId,
            afterData: created,
          },
          tx,
        );
        const resultado = await vincularNaTransacao(tx, {
          catalogItemId: created.id,
          code: dbcorpCode,
          vinculo: forecast,
          exigido: isActive,
          userId,
          origem: 'catalogo',
        });
        return { item: created, vinculo: resultado };
      });

      return res.status(201).json({ ...item, forecastVinculo: vinculo });
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
      if (body.notes !== undefined) {
        data.notes = isNonEmptyString(body.notes) ? body.notes.trim() : null;
      }
      if (body.familyId !== undefined) {
        data.familyId = typeof body.familyId === 'number' ? body.familyId : null;
      }
      if (body.isActive !== undefined) {
        data.isActive = body.isActive !== false;
      }

      const forecast = catalogItemForecastFieldSchema.parse(body.forecast) ?? null;
      const codeAntes = (existing.dbcorpCode ? normalizeProductCode(existing.dbcorpCode) : '') || null;
      const codeDepois = data.dbcorpCode !== undefined ? (data.dbcorpCode as string | null) : codeAntes;
      const ativoDepois = data.isActive !== undefined ? (data.isActive as boolean) : existing.isActive;
      const mudouCodigo = codeDepois !== codeAntes;
      const reativou = !existing.isActive && ativoDepois === true;

      if (forecast && !codeDepois) {
        return res.status(400).json({ message: SEM_CODIGO_MESSAGE });
      }
      if (forecast && !ativoDepois) {
        return res.status(400).json({ message: SEM_ITEM_ATIVO_MESSAGE });
      }

      // Editar nota/NCM/nome sem mexer no codigo (D2) e reativar item sem codigo: caminho atual, sem transacao.
      if (!forecast && !mudouCodigo && !(reativou && codeDepois)) {
        const item = await prisma.catalogItem.update({
          where: { id },
          data,
          include: { family: true },
        });

        await AuditLogService.log({
          entityType: 'catalog_item',
          entityId: item.id,
          action: 'update',
          performedById: req.user?.id ?? null,
          beforeData: existing,
          afterData: item,
        });

        return res.status(200).json(item);
      }

      const userId = req.user?.id ?? null;
      const { item, vinculo } = await executarComVinculo(async (tx) => {
        const updated = await tx.catalogItem.update({ where: { id }, data, include: { family: true } });
        await AuditLogService.log(
          {
            entityType: 'catalog_item',
            entityId: updated.id,
            action: 'update',
            performedById: userId,
            beforeData: existing,
            afterData: updated,
          },
          tx,
        );
        // Trocou ou zerou o codigo: o antigo so perde o vinculo com este item (continua no Forecast, D1).
        if (mudouCodigo && codeAntes) {
          await liberarVinculoAntigo(tx, { catalogItemId: id, codeAntigo: codeAntes, userId });
        }
        const resultado =
          codeDepois && ativoDepois
            ? await vincularNaTransacao(tx, {
                catalogItemId: id,
                code: codeDepois,
                vinculo: forecast,
                exigido: mudouCodigo || reativou,
                userId,
                origem: 'catalogo',
              })
            : null;
        return { item: updated, vinculo: resultado };
      });

      return res.status(200).json({ ...item, forecastVinculo: vinculo });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  // Itens ATIVOS cujo codigo DBCorp nao esta no Forecast (nao entram no calculo ate serem vinculados).
  static async semForecast(req: Request, res: Response): Promise<Response> {
    try {
      catalogItemSemForecastQuerySchema.parse(req.query);
      const { itens, total } = await listarSemForecast(prisma);
      return res.status(200).json({ data: itens, total });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  // Vincula um item ATIVO ja existente (painel "Catalogo sem Forecast" e reativacao).
  static async vincularForecast(req: Request, res: Response): Promise<Response> {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(400).json({ message: 'ID do item invalido.' });
      }
      const vinculo = catalogItemForecastLinkSchema.parse(req.body);

      const item = await prisma.catalogItem.findUnique({ where: { id } });
      if (!item) {
        return res.status(404).json({ message: 'Item de catalogo nao encontrado.' });
      }
      if (!item.isActive) {
        return res.status(400).json({ message: SEM_ITEM_ATIVO_MESSAGE });
      }
      const code = item.dbcorpCode ? normalizeProductCode(item.dbcorpCode) : '';
      if (!code) {
        return res.status(400).json({ message: 'O item não tem código DBCorp.' });
      }

      const userId = req.user?.id ?? null;
      const resultado = await executarComVinculo((tx) =>
        vincularNaTransacao(tx, { catalogItemId: id, code, vinculo, exigido: true, userId, origem: 'catalogo' }),
      );
      return res.status(200).json({ data: resultado });
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
