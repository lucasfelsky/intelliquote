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

const MSG_CORRIDA =
  'Não é possível excluir: o produto passou a ser usado por um fornecedor ou item de solicitação. Inative o produto para tirá-lo das listas de escolha.';

function usageMessage(suppliers: number, items: number): string {
  const partes: string[] = [];

  if (suppliers > 0) {
    partes.push(suppliers === 1 ? `${suppliers} fornecedor` : `${suppliers} fornecedores`);
  }

  if (items > 0) {
    partes.push(items === 1 ? `${items} item de solicitação` : `${items} itens de solicitação`);
  }

  return `Não é possível excluir: o produto está vinculado a ${partes.join(' e ')}. Inative o produto para tirá-lo das listas de escolha.`;
}

// Vinculo criado depois da contagem: a FK (onDelete Restrict) barra e vira 409.
function translateDeleteError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2003' || error.code === 'P2014')
  ) {
    throw new HttpError(409, MSG_CORRIDA);
  }

  throw error;
}

export class IndentProductService {
  static async list(query: IndentProductListQuery) {
    const scope: Prisma.IndentProductWhereInput = query.inativos ? {} : { isActive: true };
    const where: Prisma.IndentProductWhereInput = {
      ...scope,
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
      prisma.indentProduct.count({ where: { ...scope, origin: 'CADASTRADO' } }),
      prisma.indentProduct.count({ where: { ...scope, origin: 'LIVRE' } }),
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

  // Exclusao fisica, so de produto sem vinculo (fornecedor ou item de solicitacao).
  static async remove(id: number, userId: number | null): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        const before = await tx.indentProduct.findUnique({ where: { id } });

        if (!before) {
          throw new HttpError(404, 'Produto não encontrado.');
        }

        const suppliers = await tx.indentSupplierProduct.count({ where: { productId: id } });
        const items = await tx.indentRequestItem.count({ where: { productId: id } });

        if (suppliers > 0 || items > 0) {
          throw new HttpError(409, usageMessage(suppliers, items));
        }

        await tx.indentProduct.delete({ where: { id } });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'indent_product.deleted',
            performedById: userId,
            beforeData: productSnapshot(before),
          },
          tx,
        );
      });
    } catch (error) {
      translateDeleteError(error);
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
