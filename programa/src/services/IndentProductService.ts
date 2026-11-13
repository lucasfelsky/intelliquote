import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { cleanProposedName, normalizeItemNameKey } from '../utils/commercialItemName';
import { buildPaginatedResponse, HttpError } from '../utils/http';
import type {
  IndentProductCreateInput,
  IndentProductListQuery,
  IndentProductUpdateInput,
} from '../validators/indent';
import { AuditLogService } from './AuditLogService';

const ENTITY_TYPE = 'indent_product';

export const PROMOTED_NOTE = 'Promovido do item livre. Completar CAS e sinônimos';

// supplierCount: so fornecedores ATIVOS vinculados.
const productListSelect = {
  id: true,
  name: true,
  acronym: true,
  manufacturer: true,
  cas: true,
  unit: true,
  synonyms: true,
  notes: true,
  origin: true,
  sourceRequestNumber: true,
  importedFromIq: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { suppliers: { where: { supplier: { isActive: true } } } } },
} satisfies Prisma.IndentProductSelect;

type ProductListRow = Prisma.IndentProductGetPayload<{ select: typeof productListSelect }>;

function serializeListRow(row: ProductListRow) {
  const { _count, ...rest } = row;
  return { ...rest, supplierCount: _count.suppliers };
}

function productSnapshot(row: {
  name: string;
  acronym: string | null;
  manufacturer: string | null;
  cas: string | null;
  unit: string;
  synonyms: string[];
  notes: string | null;
  origin: string;
  isActive: boolean;
}) {
  return {
    name: row.name,
    acronym: row.acronym,
    manufacturer: row.manufacturer,
    cas: row.cas,
    unit: row.unit,
    synonyms: row.synonyms,
    notes: row.notes,
    origin: row.origin,
    isActive: row.isActive,
  };
}

function translateConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new HttpError(409, 'Já existe um produto com este nome no Indent.');
  }

  throw error;
}

export class IndentProductService {
  static async list(query: IndentProductListQuery) {
    const where: Prisma.IndentProductWhereInput = {
      ...(query.inativos ? {} : { isActive: true }),
      ...(query.origin ? { origin: query.origin } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { cas: { contains: query.q, mode: 'insensitive' } },
              { acronym: { contains: query.q, mode: 'insensitive' } },
              { synonyms: { has: query.q } },
            ],
          }
        : {}),
    };
    const pagination = {
      page: query.page,
      pageSize: query.pageSize,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    };

    const [rows, total, cadastrado, livre] = await Promise.all([
      prisma.indentProduct.findMany({
        where,
        select: productListSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.indentProduct.count({ where }),
      prisma.indentProduct.count({ where: { isActive: true, origin: 'CADASTRADO' } }),
      prisma.indentProduct.count({ where: { isActive: true, origin: 'LIVRE' } }),
    ]);

    return {
      ...buildPaginatedResponse(rows.map(serializeListRow), total, pagination),
      counts: { total: cadastrado + livre, cadastrado, livre },
    };
  }

  static async options() {
    return prisma.indentProduct.findMany({
      where: { isActive: true },
      select: { id: true, name: true, cas: true, isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 2000,
    });
  }

  static async create(input: IndentProductCreateInput, userId: number | null) {
    const name = cleanProposedName(input.name);

    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.indentProduct.create({
          data: {
            name,
            nameKey: normalizeItemNameKey(name),
            acronym: input.acronym ?? null,
            manufacturer: input.manufacturer ?? null,
            cas: input.cas ?? null,
            unit: input.unit,
            synonyms: input.synonyms,
            notes: input.notes ?? null,
            origin: 'CADASTRADO',
          },
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: created.id,
            action: 'indent_product.created',
            performedById: userId,
            afterData: productSnapshot(created),
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      return translateConflict(error);
    }
  }

  static async update(id: number, input: IndentProductUpdateInput, userId: number | null) {
    try {
      return await prisma.$transaction(async (tx) => {
        const before = await tx.indentProduct.findUnique({ where: { id } });

        if (!before) {
          throw new HttpError(404, 'Produto não encontrado.');
        }

        const updated = await tx.indentProduct.update({
          where: { id },
          data: {
            ...(input.name !== undefined
              ? { name: cleanProposedName(input.name), nameKey: normalizeItemNameKey(input.name) }
              : {}),
            ...(input.acronym !== undefined ? { acronym: input.acronym } : {}),
            ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer } : {}),
            ...(input.cas !== undefined ? { cas: input.cas } : {}),
            ...(input.unit !== undefined ? { unit: input.unit } : {}),
            ...(input.synonyms !== undefined ? { synonyms: input.synonyms } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'indent_product.updated',
            performedById: userId,
            beforeData: productSnapshot(before),
            afterData: productSnapshot(updated),
          },
          tx,
        );

        return updated;
      });
    } catch (error) {
      return translateConflict(error);
    }
  }

  // LIVRE -> CADASTRADO. A nota padrao so entra se o produto nao tinha nota.
  static async promote(id: number, userId: number | null) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.indentProduct.findUnique({ where: { id } });

      if (!before) {
        throw new HttpError(404, 'Produto não encontrado.');
      }

      if (before.origin === 'CADASTRADO') {
        throw new HttpError(409, 'O produto já está no catálogo.');
      }

      const updated = await tx.indentProduct.update({
        where: { id },
        data: { origin: 'CADASTRADO', ...(before.notes === null ? { notes: PROMOTED_NOTE } : {}) },
      });

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'indent_product.promoted',
          performedById: userId,
          beforeData: productSnapshot(before),
          afterData: productSnapshot(updated),
        },
        tx,
      );

      return updated;
    });
  }
}
