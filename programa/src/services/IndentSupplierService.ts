import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { cleanProposedName, normalizeItemNameKey } from '../utils/commercialItemName';
import { buildPaginatedResponse, HttpError } from '../utils/http';
import type {
  IndentListQuery,
  IndentSupplierCreateInput,
  IndentSupplierUpdateInput,
} from '../validators/indent';
import { AuditLogService } from './AuditLogService';

const ENTITY_TYPE = 'indent_supplier';

const supplierInclude = {
  products: {
    select: { product: { select: { id: true, name: true, isActive: true } } },
  },
} satisfies Prisma.IndentSupplierInclude;

type SupplierRow = Prisma.IndentSupplierGetPayload<{ include: typeof supplierInclude }>;

interface RuleCounts {
  approvedBy: number;
  blockedBy: number;
}

// Forma publica: o vinculo vem como lista plana [{id, name, isActive}], todos os produtos ligados
// (inclusive inativos) em ordem alfabetica.
function serializeSupplier(row: SupplierRow, counts?: RuleCounts) {
  const { products, ...rest } = row;

  return {
    ...rest,
    ...(counts ?? {}),
    products: products
      .map((link) => link.product)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  };
}

function supplierSnapshot(row: {
  name: string;
  country: string | null;
  contactName: string | null;
  type: string;
  defaultCurrency: string;
  defaultIncoterm: string;
  hasPartnership: boolean;
  isActive: boolean;
}) {
  return {
    name: row.name,
    country: row.country,
    contactName: row.contactName,
    type: row.type,
    defaultCurrency: row.defaultCurrency,
    defaultIncoterm: row.defaultIncoterm,
    hasPartnership: row.hasPartnership,
    isActive: row.isActive,
  };
}

function translateConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new HttpError(409, 'Já existe um fornecedor com este nome no Indent.');
  }

  throw error;
}

function sortedIds(ids: number[]): number[] {
  return [...ids].sort((a, b) => a - b);
}

// Substitui o conjunto de produtos do fornecedor DENTRO da transacao do chamador. Produto inativo
// conta como existente (pode continuar vinculado). Conjunto igual ao atual: nao grava nem loga.
async function replaceSupplierProducts(
  tx: Prisma.TransactionClient,
  supplierId: number,
  productIds: number[],
  userId: number | null,
): Promise<boolean> {
  if (productIds.length > 0) {
    const existing = await tx.indentProduct.count({ where: { id: { in: productIds } } });

    if (existing !== productIds.length) {
      throw new HttpError(400, 'Produto inexistente na lista.');
    }
  }

  const current = await tx.indentSupplierProduct.findMany({
    where: { supplierId },
    select: { productId: true },
  });
  const beforeIds = sortedIds(current.map((link) => link.productId));
  const afterIds = sortedIds(productIds);

  if (beforeIds.length === afterIds.length && beforeIds.every((id, index) => id === afterIds[index])) {
    return false;
  }

  await tx.indentSupplierProduct.deleteMany({ where: { supplierId } });

  if (afterIds.length > 0) {
    await tx.indentSupplierProduct.createMany({
      data: afterIds.map((productId) => ({ supplierId, productId })),
      skipDuplicates: true,
    });
  }

  await AuditLogService.log(
    {
      entityType: ENTITY_TYPE,
      entityId: supplierId,
      action: 'indent_supplier.products_updated',
      performedById: userId,
      beforeData: { productIds: beforeIds },
      afterData: { productIds: afterIds },
    },
    tx,
  );

  return true;
}

export class IndentSupplierService {
  static async list(query: IndentListQuery) {
    const where: Prisma.IndentSupplierWhereInput = {
      ...(query.inativos ? {} : { isActive: true }),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { country: { contains: query.q, mode: 'insensitive' } },
              { contactName: { contains: query.q, mode: 'insensitive' } },
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

    const [rows, total] = await Promise.all([
      prisma.indentSupplier.findMany({
        where,
        include: supplierInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.indentSupplier.count({ where }),
    ]);

    // "Aprovado por N" / "Bloqueado por N": clientes ATIVOS com regra para o fornecedor.
    const rules =
      rows.length > 0
        ? await prisma.indentClientSupplierRule.findMany({
            where: {
              supplierId: { in: rows.map((row) => row.id) },
              client: { isActive: true, supplierRuleMode: { in: ['APROVADOS', 'BLOQUEIO'] } },
            },
            select: { supplierId: true, client: { select: { supplierRuleMode: true } } },
          })
        : [];
    const counts = new Map<number, RuleCounts>();

    for (const rule of rules) {
      const entry = counts.get(rule.supplierId) ?? { approvedBy: 0, blockedBy: 0 };
      if (rule.client.supplierRuleMode === 'APROVADOS') {
        entry.approvedBy += 1;
      } else {
        entry.blockedBy += 1;
      }
      counts.set(rule.supplierId, entry);
    }

    return buildPaginatedResponse(
      rows.map((row) => serializeSupplier(row, counts.get(row.id) ?? { approvedBy: 0, blockedBy: 0 })),
      total,
      pagination,
    );
  }

  static async options() {
    return prisma.indentSupplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true, country: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 1000,
    });
  }

  static async create(input: IndentSupplierCreateInput, userId: number | null) {
    const name = cleanProposedName(input.name);

    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.indentSupplier.create({
          data: {
            name,
            nameKey: normalizeItemNameKey(name),
            country: input.country ?? null,
            contactName: input.contactName ?? null,
            type: input.type,
            defaultCurrency: input.defaultCurrency,
            defaultIncoterm: input.defaultIncoterm,
            hasPartnership: input.hasPartnership ?? false,
          },
          include: supplierInclude,
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: created.id,
            action: 'indent_supplier.created',
            performedById: userId,
            afterData: supplierSnapshot(created),
          },
          tx,
        );

        if (input.productIds !== undefined) {
          await replaceSupplierProducts(tx, created.id, input.productIds, userId);
        }

        const fresh = await tx.indentSupplier.findUnique({
          where: { id: created.id },
          include: supplierInclude,
        });

        return serializeSupplier(fresh ?? created);
      });
    } catch (error) {
      return translateConflict(error);
    }
  }

  static async update(id: number, input: IndentSupplierUpdateInput, userId: number | null) {
    try {
      return await prisma.$transaction(async (tx) => {
        const before = await tx.indentSupplier.findUnique({ where: { id }, include: supplierInclude });

        if (!before) {
          throw new HttpError(404, 'Fornecedor não encontrado.');
        }

        const data: Prisma.IndentSupplierUpdateInput = {
          ...(input.name !== undefined
            ? { name: cleanProposedName(input.name), nameKey: normalizeItemNameKey(input.name) }
            : {}),
          ...(input.country !== undefined ? { country: input.country } : {}),
          ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.defaultCurrency !== undefined ? { defaultCurrency: input.defaultCurrency } : {}),
          ...(input.defaultIncoterm !== undefined ? { defaultIncoterm: input.defaultIncoterm } : {}),
          ...(input.hasPartnership !== undefined ? { hasPartnership: input.hasPartnership } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        };

        let current: SupplierRow = before;

        if (Object.keys(data).length > 0) {
          current = await tx.indentSupplier.update({
            where: { id },
            data,
            include: supplierInclude,
          });

          await AuditLogService.log(
            {
              entityType: ENTITY_TYPE,
              entityId: id,
              action: 'indent_supplier.updated',
              performedById: userId,
              beforeData: supplierSnapshot(before),
              afterData: supplierSnapshot(current),
            },
            tx,
          );

          if (current.hasPartnership !== before.hasPartnership) {
            await AuditLogService.log(
              {
                entityType: ENTITY_TYPE,
                entityId: id,
                action: 'indent_supplier.partnership_changed',
                performedById: userId,
                beforeData: { hasPartnership: before.hasPartnership },
                afterData: { hasPartnership: current.hasPartnership },
              },
              tx,
            );
          }
        }

        if (input.productIds !== undefined) {
          const changed = await replaceSupplierProducts(tx, id, input.productIds, userId);

          if (changed) {
            const fresh = await tx.indentSupplier.findUnique({ where: { id }, include: supplierInclude });
            current = fresh ?? current;
          }
        }

        return serializeSupplier(current);
      });
    } catch (error) {
      return translateConflict(error);
    }
  }

  static async setProducts(id: number, productIds: number[], userId: number | null) {
    return prisma.$transaction(async (tx) => {
      const exists = await tx.indentSupplier.findUnique({ where: { id }, select: { id: true } });

      if (!exists) {
        throw new HttpError(404, 'Fornecedor não encontrado.');
      }

      await replaceSupplierProducts(tx, id, productIds, userId);

      const fresh = await tx.indentSupplier.findUnique({ where: { id }, include: supplierInclude });

      if (!fresh) {
        throw new HttpError(404, 'Fornecedor não encontrado.');
      }

      return serializeSupplier(fresh);
    });
  }
}
