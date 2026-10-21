import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { FORECAST_MAX_DETAIL_WARNINGS } from '../constants/forecast';
import type { Produto } from '../utils/forecastTypes';
import {
  normalizeProductCode,
  normalizeProductName,
  normalizeSourceName,
} from '../utils/forecastWorkbook';
import { AuditLogService } from './AuditLogService';

type Db = Prisma.TransactionClient;

const ENTITY_TYPE = 'forecast_product';

export interface ProductDraft {
  name: string;
  normalizedName: string;
  sheetOrder: number | null; // coluna A
  sourceKey: string | null; // fonte (AU) normalizada; null quando vazia
  notes: string | null; // AT
  fixedPriceFlag: boolean; // AV = "X"
  packaging: string | null; // AW
  noFractioning: boolean; // AX = "X"
  sampleQty: string | null; // AY
  sampleRequestNote: string | null; // AZ
  codes: Array<{ position: number; code: string }>; // EMB.1..EMB.7 (position 1..7)
}

interface ProductFields {
  name: string;
  sheetOrder: number | null;
  sourceKey: string | null;
  notes: string | null;
  fixedPriceFlag: boolean;
  packaging: string | null;
  noFractioning: boolean;
  sampleQty: string | null;
  sampleRequestNote: string | null;
  familyId: number | null;
  isActive: boolean;
}

interface CodeFields {
  position: number;
  code: string;
  catalogItemId: number | null;
}

export type ProductChange = 'novo' | 'alterado' | 'igual';

export interface ProductPlanItem {
  draft: ProductDraft;
  existingId: number | null;
  desired: ProductFields;
  desiredCodes: CodeFields[];
  before: (ProductFields & { codes: CodeFields[] }) | null;
  fieldsChanged: boolean;
  codesChanged: boolean;
  change: ProductChange;
}

export interface ProductPlan {
  items: ProductPlanItem[];
  inativados: Array<{ id: number; name: string; before: ProductFields & { codes: CodeFields[] } }>;
  codigosMovidos: string[]; // codigos que estavam em outro produto
  avisos: string[];
  resumo: {
    produtos: { total: number; novos: number; alterados: number; inativados: number };
    codigos: { total: number; vinculadosCatalogo: number; movidos: number };
  };
}

const flagX = (value: string) => value.trim().toUpperCase() === 'X';
const textOrNull = (value: string) => (value.trim() === '' ? null : value.trim());

// Produto do motor (coluna da planilha) -> rascunho de cadastro.
export function toProductDrafts(produtos: Produto[]): ProductDraft[] {
  return produtos.map((p) => ({
    name: p.item.replace(/\s+/g, ' ').trim(),
    normalizedName: normalizeProductName(p.item),
    sheetOrder: p.n,
    sourceKey: p.fonte.trim() ? normalizeSourceName(p.fonte) : null,
    notes: textOrNull(p.obs),
    fixedPriceFlag: flagX(p.precoFechado),
    packaging: textOrNull(p.embalagem),
    noFractioning: flagX(p.naoFraciona),
    sampleQty: textOrNull(p.qtdAmostra),
    sampleRequestNote: textOrNull(p.solicitarAmostra),
    codes: p.codigos
      .map((code, index) => ({ position: index + 1, code: normalizeProductCode(code) }))
      .filter((entry) => entry.code !== ''),
  }));
}

function sameFields(a: ProductFields, b: ProductFields): boolean {
  return (
    a.name === b.name &&
    a.sheetOrder === b.sheetOrder &&
    a.sourceKey === b.sourceKey &&
    a.notes === b.notes &&
    a.fixedPriceFlag === b.fixedPriceFlag &&
    a.packaging === b.packaging &&
    a.noFractioning === b.noFractioning &&
    a.sampleQty === b.sampleQty &&
    a.sampleRequestNote === b.sampleRequestNote &&
    a.familyId === b.familyId &&
    a.isActive === b.isActive
  );
}

const codesKey = (codes: CodeFields[]) =>
  codes
    .map((c) => `${c.position}:${c.code}:${c.catalogItemId ?? ''}`)
    .sort()
    .join('|');

export class ForecastProductService {
  // Compara o cadastro da planilha com o banco (sem escrita). `knownSourceKeys` = fontes que existem
  // (as da LEADTIME da planilha + as ja cadastradas); fonte desconhecida deixa o produto sem fonte.
  static async plan(
    db: Db,
    drafts: ProductDraft[],
    knownSourceKeys: Set<string>,
  ): Promise<ProductPlan> {
    const [existing, catalogRows] = await Promise.all([
      db.forecastProduct.findMany({
        include: {
          codes: true,
          source: { select: { normalizedName: true } },
        },
      }),
      db.catalogItem.findMany({
        where: { isActive: true, dbcorpCode: { not: null } },
        select: { id: true, dbcorpCode: true, familyId: true },
      }),
    ]);

    // codigo (maiusculas) -> itens de catalogo ativos com aquele dbcorpCode (so vale se for exatamente 1).
    const catalogByCode = new Map<string, Array<{ id: number; familyId: number | null }>>();
    for (const row of catalogRows) {
      if (!row.dbcorpCode) continue;
      const key = normalizeProductCode(row.dbcorpCode);
      if (!key) continue;
      catalogByCode.set(key, [...(catalogByCode.get(key) ?? []), { id: row.id, familyId: row.familyId }]);
    }

    const existingByName = new Map(existing.map((p) => [p.normalizedName, p]));
    const ownerByCode = new Map<string, { id: number; name: string; normalizedName: string }>();
    for (const product of existing) {
      for (const code of product.codes) {
        ownerByCode.set(code.code, {
          id: product.id,
          name: product.name,
          normalizedName: product.normalizedName,
        });
      }
    }

    const draftNames = new Set(drafts.map((d) => d.normalizedName));
    const codigosMovidos: string[] = [];
    const avisos: string[] = [];
    let vinculadosCatalogo = 0;
    let totalCodigos = 0;

    const items: ProductPlanItem[] = drafts.map((draft) => {
      const found = existingByName.get(draft.normalizedName) ?? null;

      const desiredCodes: CodeFields[] = draft.codes.map(({ position, code }) => {
        const matches = catalogByCode.get(code) ?? [];
        return { position, code, catalogItemId: matches.length === 1 ? matches[0].id : null };
      });
      totalCodigos += desiredCodes.length;
      vinculadosCatalogo += desiredCodes.filter((c) => c.catalogItemId !== null).length;

      for (const { code } of desiredCodes) {
        const owner = ownerByCode.get(code);
        if (owner && owner.normalizedName !== draft.normalizedName) {
          codigosMovidos.push(code);
          avisos.push(`Codigo ${code} movido de "${owner.name}" para "${draft.name}".`);
        }
      }

      // Familia do produto = familia comum a todos os itens de catalogo vinculados (senao nenhuma).
      const linked = desiredCodes
        .filter((c) => c.catalogItemId !== null)
        .map((c) => catalogByCode.get(c.code)![0]);
      const families = new Set(linked.map((l) => l.familyId));
      const familyId =
        linked.length > 0 && families.size === 1 && linked[0].familyId !== null
          ? linked[0].familyId
          : null;

      const desired: ProductFields = {
        name: draft.name,
        sheetOrder: draft.sheetOrder,
        sourceKey:
          draft.sourceKey !== null && knownSourceKeys.has(draft.sourceKey) ? draft.sourceKey : null,
        notes: draft.notes,
        fixedPriceFlag: draft.fixedPriceFlag,
        packaging: draft.packaging,
        noFractioning: draft.noFractioning,
        sampleQty: draft.sampleQty,
        sampleRequestNote: draft.sampleRequestNote,
        familyId,
        isActive: true,
      };

      if (!found) {
        return {
          draft,
          existingId: null,
          desired,
          desiredCodes,
          before: null,
          fieldsChanged: true,
          codesChanged: true,
          change: 'novo',
        };
      }

      const before = ForecastProductService.snapshotOf(found);
      const { codes: beforeCodes, ...beforeFields } = before;
      const fieldsChanged = !sameFields(beforeFields, desired);
      const codesChanged = codesKey(beforeCodes) !== codesKey(desiredCodes);
      return {
        draft,
        existingId: found.id,
        desired,
        desiredCodes,
        before,
        fieldsChanged,
        codesChanged,
        change: fieldsChanged || codesChanged ? 'alterado' : 'igual',
      };
    });

    const inativados = existing
      .filter((p) => p.isActive && !draftNames.has(p.normalizedName))
      .map((p) => ({ id: p.id, name: p.name, before: ForecastProductService.snapshotOf(p) }));

    return {
      items,
      inativados,
      codigosMovidos,
      avisos: capWarnings(avisos),
      resumo: {
        produtos: {
          total: items.length,
          novos: items.filter((i) => i.change === 'novo').length,
          alterados: items.filter((i) => i.change === 'alterado').length,
          inativados: inativados.length,
        },
        codigos: {
          total: totalCodigos,
          vinculadosCatalogo,
          movidos: codigosMovidos.length,
        },
      },
    };
  }

  private static snapshotOf(product: {
    name: string;
    sheetOrder: number | null;
    notes: string | null;
    fixedPriceFlag: boolean;
    packaging: string | null;
    noFractioning: boolean;
    sampleQty: string | null;
    sampleRequestNote: string | null;
    familyId: number | null;
    isActive: boolean;
    source?: { normalizedName: string } | null;
    codes: Array<{ position: number; code: string; catalogItemId: number | null }>;
  }): ProductFields & { codes: CodeFields[] } {
    return {
      name: product.name,
      sheetOrder: product.sheetOrder,
      sourceKey: product.source?.normalizedName ?? null,
      notes: product.notes,
      fixedPriceFlag: product.fixedPriceFlag,
      packaging: product.packaging,
      noFractioning: product.noFractioning,
      sampleQty: product.sampleQty,
      sampleRequestNote: product.sampleRequestNote,
      familyId: product.familyId,
      isActive: product.isActive,
      codes: product.codes
        .map((c) => ({ position: c.position, code: c.code, catalogItemId: c.catalogItemId }))
        .sort((a, b) => a.position - b.position),
    };
  }

  // Grava o plano (dentro da transacao do import): produtos, codigos (substituidos pelo conjunto da
  // planilha; um codigo que estava em outro produto e movido) e inativacao dos ausentes.
  // Devolve normalizedName -> id de TODOS os produtos da planilha.
  static async apply(
    tx: Db,
    plan: ProductPlan,
    sourceIdByKey: Map<string, number>,
    userId: number | null,
  ): Promise<Map<string, number>> {
    const productIds = new Map<string, number>();
    const codeOwners: Array<{ productId: number; codes: CodeFields[] }> = [];

    for (const item of plan.items) {
      const { sourceKey, ...scalar } = item.desired;
      const data = {
        ...scalar,
        normalizedName: item.draft.normalizedName,
        sourceId: sourceKey !== null ? (sourceIdByKey.get(sourceKey) ?? null) : null,
      };

      let productId: number;
      if (item.existingId === null) {
        const created = await tx.forecastProduct.create({ data });
        productId = created.id;
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: productId,
            action: 'create',
            performedById: userId,
            afterData: { ...item.desired, codes: item.desiredCodes },
            metadata: { source: 'workbook_import' },
          },
          tx,
        );
      } else {
        productId = item.existingId;
        if (item.fieldsChanged) {
          await tx.forecastProduct.update({ where: { id: productId }, data });
        }
        if (item.fieldsChanged || item.codesChanged) {
          await AuditLogService.log(
            {
              entityType: ENTITY_TYPE,
              entityId: productId,
              action: 'update',
              performedById: userId,
              beforeData: item.before,
              afterData: { ...item.desired, codes: item.desiredCodes },
              metadata: { source: 'workbook_import' },
            },
            tx,
          );
        }
      }
      productIds.set(item.draft.normalizedName, productId);
      if (item.codesChanged) {
        codeOwners.push({ productId, codes: item.desiredCodes });
      }
    }

    if (codeOwners.length > 0) {
      const allCodes = codeOwners.flatMap((o) => o.codes.map((c) => c.code));
      // Apaga os codigos dos produtos alterados e qualquer codigo que va para outro dono (movido).
      await tx.forecastProductCode.deleteMany({
        where: {
          OR: [
            { productId: { in: codeOwners.map((o) => o.productId) } },
            ...(allCodes.length > 0 ? [{ code: { in: allCodes } }] : []),
          ],
        },
      });
      const rows = codeOwners.flatMap((o) =>
        o.codes.map((c) => ({
          productId: o.productId,
          position: c.position,
          code: c.code,
          catalogItemId: c.catalogItemId,
        })),
      );
      if (rows.length > 0) {
        await tx.forecastProductCode.createMany({ data: rows });
      }
    }

    for (const gone of plan.inativados) {
      await tx.forecastProduct.update({ where: { id: gone.id }, data: { isActive: false } });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: gone.id,
          action: 'deactivate',
          performedById: userId,
          beforeData: gone.before,
          afterData: { ...gone.before, isActive: false },
          metadata: { source: 'workbook_import', reason: 'ausente da planilha' },
        },
        tx,
      );
    }

    return productIds;
  }

  static async list() {
    return prisma.forecastProduct.findMany({
      orderBy: [{ sheetOrder: 'asc' }, { id: 'asc' }],
      include: {
        codes: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            position: true,
            code: true,
            catalogItemId: true,
            catalogItem: { select: { id: true, commercialName: true, marketName: true } },
          },
        },
        source: { select: { id: true, name: true, leadTimeDays: true } },
        family: { select: { id: true, name: true } },
      },
    });
  }
}

function capWarnings(avisos: string[]): string[] {
  if (avisos.length <= FORECAST_MAX_DETAIL_WARNINGS) return avisos;
  return [
    ...avisos.slice(0, FORECAST_MAX_DETAIL_WARNINGS),
    `... e mais ${avisos.length - FORECAST_MAX_DETAIL_WARNINGS} avisos de codigo movido.`,
  ];
}
