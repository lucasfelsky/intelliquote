import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { ForecastSourcePatchInput } from '../validators/forecast';
import { HttpError } from '../utils/http';
import type { MudancaDePrazo } from '../utils/forecastDbcorpRegras';
import type { ForecastWorkbookSource } from '../utils/forecastWorkbook';
import { normalizeSupplierName } from '../utils/supplierImport';
import { AuditLogService } from './AuditLogService';

type Db = Prisma.TransactionClient;

const ENTITY_TYPE = 'forecast_source';

interface SourceFields {
  name: string;
  readinessDays: number | null;
  holidaysDays: number | null;
  shippingDays: number | null;
  transitDays: number | null;
  clearanceDays: number | null;
  leadTimeDays: number | null;
  supplierId: number | null;
}

export type SourceChange = 'nova' | 'alterada' | 'igual';

export interface SourcePlanItem {
  draft: ForecastWorkbookSource;
  existingId: number | null;
  before: SourceFields | null;
  after: SourceFields;
  change: SourceChange;
}

export interface SourcePlan {
  items: SourcePlanItem[];
  // Fontes que existem depois do import: as da LEADTIME da planilha + as ja cadastradas.
  knownKeys: Set<string>;
  resumo: { total: number; novas: number; alteradas: number; comFornecedor: number };
}

function fieldsOf(row: SourceFields): SourceFields {
  return {
    name: row.name,
    readinessDays: row.readinessDays,
    holidaysDays: row.holidaysDays,
    shippingDays: row.shippingDays,
    transitDays: row.transitDays,
    clearanceDays: row.clearanceDays,
    leadTimeDays: row.leadTimeDays,
    supplierId: row.supplierId,
  };
}

function sameFields(a: SourceFields, b: SourceFields): boolean {
  return (
    a.name === b.name &&
    a.readinessDays === b.readinessDays &&
    a.holidaysDays === b.holidaysDays &&
    a.shippingDays === b.shippingDays &&
    a.transitDays === b.transitDays &&
    a.clearanceDays === b.clearanceDays &&
    a.leadTimeDays === b.leadTimeDays &&
    a.supplierId === b.supplierId
  );
}

export class ForecastSourceService {
  // Compara as fontes da LEADTIME com o banco (sem escrita). O vinculo com Supplier so e feito
  // por igualdade exata de nome normalizado com UM unico Supplier ativo (deletedAt: null); um
  // vinculo ja existente (inclusive editado a mao) nunca e sobrescrito.
  static async plan(db: Db, drafts: ForecastWorkbookSource[]): Promise<SourcePlan> {
    const [existing, suppliers] = await Promise.all([
      db.forecastSource.findMany(),
      db.supplier.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    ]);
    const existingByKey = new Map(existing.map((s) => [s.normalizedName, s]));
    const suppliersByName = new Map<string, number[]>();
    for (const supplier of suppliers) {
      const key = normalizeSupplierName(supplier.name);
      suppliersByName.set(key, [...(suppliersByName.get(key) ?? []), supplier.id]);
    }

    const items: SourcePlanItem[] = drafts.map((draft) => {
      const found = existingByKey.get(draft.normalizedName) ?? null;
      const matches = suppliersByName.get(normalizeSupplierName(draft.name)) ?? [];
      const matchedSupplierId = matches.length === 1 ? matches[0] : null;
      const after: SourceFields = {
        name: draft.name,
        readinessDays: draft.readinessDays,
        holidaysDays: draft.holidaysDays,
        shippingDays: draft.shippingDays,
        transitDays: draft.transitDays,
        clearanceDays: draft.clearanceDays,
        leadTimeDays: draft.total,
        supplierId: found?.supplierId ?? matchedSupplierId,
      };
      if (!found) {
        return { draft, existingId: null, before: null, after, change: 'nova' };
      }
      const before = fieldsOf(found);
      return {
        draft,
        existingId: found.id,
        before,
        after,
        change: sameFields(before, after) ? 'igual' : 'alterada',
      };
    });

    return {
      items,
      knownKeys: new Set([...existingByKey.keys(), ...items.map((i) => i.draft.normalizedName)]),
      resumo: {
        total: items.length,
        novas: items.filter((i) => i.change === 'nova').length,
        alteradas: items.filter((i) => i.change === 'alterada').length,
        comFornecedor: items.filter((i) => i.after.supplierId !== null).length,
      },
    };
  }

  // Grava o plano (dentro da transacao do import) e devolve normalizedName -> id de TODAS as fontes
  // da planilha (inclusive as que nao mudaram).
  static async apply(
    tx: Db,
    plan: SourcePlan,
    userId: number | null,
  ): Promise<Map<string, number>> {
    const ids = new Map<string, number>();
    for (const item of plan.items) {
      if (item.change === 'igual' && item.existingId !== null) {
        ids.set(item.draft.normalizedName, item.existingId);
        continue;
      }
      const data = { ...item.after, normalizedName: item.draft.normalizedName };
      if (item.existingId === null) {
        const created = await tx.forecastSource.create({ data });
        ids.set(item.draft.normalizedName, created.id);
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: created.id,
            action: 'create',
            performedById: userId,
            afterData: item.after,
            metadata: { source: 'workbook_import' },
          },
          tx,
        );
      } else {
        await tx.forecastSource.update({ where: { id: item.existingId }, data: item.after });
        ids.set(item.draft.normalizedName, item.existingId);
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: item.existingId,
            action: 'update',
            performedById: userId,
            beforeData: item.before,
            afterData: item.after,
            metadata: { source: 'workbook_import' },
          },
          tx,
        );
      }
    }
    return ids;
  }

  // Prazo das chegadas estimadas do FUP (PR 5A): o prazo usado no confirm da importacao DBCorp vira o padrao da fonte.
  // Roda dentro da transacao do confirm; so as colunas que mudaram. Auditoria so com ids e nomes de campo (sem dias).
  static async salvarPrazosChegada(
    tx: Db,
    mudancas: readonly MudancaDePrazo[],
    userId: number | null,
    label: string,
  ): Promise<void> {
    for (const { sourceId, ...dias } of mudancas) {
      await tx.forecastSource.update({ where: { id: sourceId }, data: dias });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: sourceId,
          action: 'update',
          performedById: userId,
          metadata: { source: 'dbcorp_import_prazo', label, campos: Object.keys(dias) },
        },
        tx,
      );
    }
  }

  static async list() {
    return prisma.forecastSource.findMany({
      orderBy: { name: 'asc' },
      include: {
        supplier: { select: { id: true, name: true } },
        _count: { select: { products: true } },
      },
    });
  }

  static async patch(id: number, input: ForecastSourcePatchInput, userId: number | null) {
    const existing = await prisma.forecastSource.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpError(404, 'Fonte nao encontrada.');
    }

    if (input.supplierId !== undefined && input.supplierId !== null) {
      const supplier = await prisma.supplier.findFirst({
        where: { id: input.supplierId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) {
        throw new HttpError(400, 'Fornecedor nao encontrado.');
      }
    }

    const data: Prisma.ForecastSourceUncheckedUpdateInput = {};
    if (input.readinessDays !== undefined) data.readinessDays = input.readinessDays;
    if (input.holidaysDays !== undefined) data.holidaysDays = input.holidaysDays;
    if (input.shippingDays !== undefined) data.shippingDays = input.shippingDays;
    if (input.transitDays !== undefined) data.transitDays = input.transitDays;
    if (input.clearanceDays !== undefined) data.clearanceDays = input.clearanceDays;
    if (input.leadTimeDays !== undefined) data.leadTimeDays = input.leadTimeDays;
    if (input.supplierId !== undefined) data.supplierId = input.supplierId;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return prisma.$transaction(async (tx) => {
      const updated = await tx.forecastSource.update({
        where: { id },
        data,
        include: {
          supplier: { select: { id: true, name: true } },
          _count: { select: { products: true } },
        },
      });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'update',
          performedById: userId,
          beforeData: existing,
          afterData: updated,
          metadata: { source: 'manual_patch' },
        },
        tx,
      );
      return updated;
    });
  }
}
