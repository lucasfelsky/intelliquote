import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { cleanProposedName, normalizeItemNameKey } from '../utils/commercialItemName';
import { buildPaginatedResponse } from '../utils/http';
import { AuditLogService } from './AuditLogService';

// Importacao SOMENTE LEITURA do IntelliQuote: copia dados escolhidos para o cadastro do Indent.
// Nunca escreve em Supplier, SupplierContact ou CatalogItem. Nao cria vinculo fornecedor x produto.

const ENTITY_TYPE = 'indent_import';
const CANDIDATE_PAGE_SIZE = 100;
const COPIED_NOTE = 'Copiado do IntelliQuote, sem vínculo';

export type ImportSkipReason = 'duplicado' | 'nao_encontrado';

export interface ImportSkip {
  sourceId: number;
  reason: ImportSkipReason;
}

export interface ImportResult {
  created: number;
  skipped: ImportSkip[];
}

function pagination(page: number) {
  return {
    page,
    pageSize: CANDIDATE_PAGE_SIZE,
    skip: (page - 1) * CANDIDATE_PAGE_SIZE,
    take: CANDIDATE_PAGE_SIZE,
  };
}

export class IndentImportService {
  static async supplierCandidates(query: { q?: string; page: number }) {
    const where = {
      deletedAt: null,
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };
    const paging = pagination(query.page);

    const [rows, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        select: { id: true, name: true, country: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: paging.skip,
        take: paging.take,
      }),
      prisma.supplier.count({ where }),
    ]);

    const taken = await existingKeys(
      rows.map((row) => normalizeItemNameKey(row.name)),
      'supplier',
    );

    return buildPaginatedResponse(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        country: row.country,
        alreadyInIndent: taken.has(normalizeItemNameKey(row.name)),
      })),
      total,
      paging,
    );
  }

  static async productCandidates(query: { q?: string; page: number }) {
    const where = {
      isActive: true,
      ...(query.q
        ? {
            OR: [
              { commercialName: { contains: query.q, mode: 'insensitive' as const } },
              { marketName: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const paging = pagination(query.page);

    const [rows, total] = await Promise.all([
      prisma.catalogItem.findMany({
        where,
        select: { id: true, commercialName: true, marketName: true },
        orderBy: [{ commercialName: 'asc' }, { id: 'asc' }],
        skip: paging.skip,
        take: paging.take,
      }),
      prisma.catalogItem.count({ where }),
    ]);

    const taken = await existingKeys(
      rows.map((row) => normalizeItemNameKey(row.commercialName)),
      'product',
    );

    return buildPaginatedResponse(
      rows.map((row) => ({
        id: row.id,
        name: row.commercialName,
        marketName: row.marketName,
        alreadyInIndent: taken.has(normalizeItemNameKey(row.commercialName)),
      })),
      total,
      paging,
    );
  }

  static async importSuppliers(ids: number[], userId: number | null): Promise<ImportResult> {
    return prisma.$transaction(async (tx) => {
      const sources = await tx.supplier.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: {
          id: true,
          name: true,
          country: true,
          contacts: { where: { isPrimary: true }, select: { name: true }, take: 1 },
        },
      });
      const byId = new Map(sources.map((source) => [source.id, source]));
      const taken = new Set(
        (
          await tx.indentSupplier.findMany({
            where: { nameKey: { in: sources.map((source) => normalizeItemNameKey(source.name)) } },
            select: { nameKey: true },
          })
        ).map((row) => row.nameKey),
      );

      const skipped: ImportSkip[] = [];
      const pending: Array<{ sourceId: number; nameKey: string; data: Prisma.IndentSupplierCreateManyInput }> = [];

      for (const sourceId of ids) {
        const source = byId.get(sourceId);

        if (!source) {
          skipped.push({ sourceId, reason: 'nao_encontrado' });
          continue;
        }

        const nameKey = normalizeItemNameKey(source.name);

        if (taken.has(nameKey)) {
          skipped.push({ sourceId, reason: 'duplicado' });
          continue;
        }

        taken.add(nameKey);
        pending.push({
          sourceId,
          nameKey,
          data: {
            name: cleanProposedName(source.name),
            nameKey,
            country: source.country ?? null,
            contactName: source.contacts[0]?.name ?? null,
            type: 'IMPORTADO',
            defaultCurrency: 'USD',
            defaultIncoterm: 'CFR',
            importedFromIq: true,
          },
        });
      }

      const created =
        pending.length > 0
          ? await tx.indentSupplier.createManyAndReturn({
              data: pending.map((entry) => entry.data),
              skipDuplicates: true,
              select: { id: true, nameKey: true },
            })
          : [];

      // Corrida: o @unique + skipDuplicates descartou o que outro pedido criou no meio.
      const createdKeys = new Set(created.map((row) => row.nameKey));
      for (const entry of pending) {
        if (!createdKeys.has(entry.nameKey)) {
          skipped.push({ sourceId: entry.sourceId, reason: 'duplicado' });
        }
      }

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: 'suppliers',
          action: 'indent_import.suppliers',
          performedById: userId,
          metadata: { sourceIds: ids, createdIds: created.map((row) => row.id), skipped },
        },
        tx,
      );

      return { created: created.length, skipped };
    });
  }

  static async importProducts(ids: number[], userId: number | null): Promise<ImportResult> {
    return prisma.$transaction(async (tx) => {
      const sources = await tx.catalogItem.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { id: true, commercialName: true, marketName: true },
      });
      const byId = new Map(sources.map((source) => [source.id, source]));
      const taken = new Set(
        (
          await tx.indentProduct.findMany({
            where: {
              nameKey: { in: sources.map((source) => normalizeItemNameKey(source.commercialName)) },
            },
            select: { nameKey: true },
          })
        ).map((row) => row.nameKey),
      );

      const skipped: ImportSkip[] = [];
      const pending: Array<{ sourceId: number; nameKey: string; data: Prisma.IndentProductCreateManyInput }> = [];

      for (const sourceId of ids) {
        const source = byId.get(sourceId);

        if (!source) {
          skipped.push({ sourceId, reason: 'nao_encontrado' });
          continue;
        }

        const nameKey = normalizeItemNameKey(source.commercialName);

        if (taken.has(nameKey)) {
          skipped.push({ sourceId, reason: 'duplicado' });
          continue;
        }

        taken.add(nameKey);

        // O nome de mercado vira sinonimo so quando difere do nome comercial (sem acento/caixa).
        const synonyms =
          normalizeItemNameKey(source.marketName) !== nameKey ? [cleanProposedName(source.marketName)] : [];

        pending.push({
          sourceId,
          nameKey,
          data: {
            name: cleanProposedName(source.commercialName),
            nameKey,
            synonyms,
            notes: COPIED_NOTE,
            origin: 'CADASTRADO',
            importedFromIq: true,
          },
        });
      }

      const created =
        pending.length > 0
          ? await tx.indentProduct.createManyAndReturn({
              data: pending.map((entry) => entry.data),
              skipDuplicates: true,
              select: { id: true, nameKey: true },
            })
          : [];

      const createdKeys = new Set(created.map((row) => row.nameKey));
      for (const entry of pending) {
        if (!createdKeys.has(entry.nameKey)) {
          skipped.push({ sourceId: entry.sourceId, reason: 'duplicado' });
        }
      }

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: 'products',
          action: 'indent_import.products',
          performedById: userId,
          metadata: { sourceIds: ids, createdIds: created.map((row) => row.id), skipped },
        },
        tx,
      );

      return { created: created.length, skipped };
    });
  }
}

async function existingKeys(keys: string[], kind: 'supplier' | 'product'): Promise<Set<string>> {
  if (keys.length === 0) {
    return new Set();
  }

  const rows =
    kind === 'supplier'
      ? await prisma.indentSupplier.findMany({ where: { nameKey: { in: keys } }, select: { nameKey: true } })
      : await prisma.indentProduct.findMany({ where: { nameKey: { in: keys } }, select: { nameKey: true } });

  return new Set(rows.map((row) => row.nameKey));
}
