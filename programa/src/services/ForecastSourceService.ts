import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  FORECAST_DBCORP_ETA_POR_ETD_DIAS,
  FORECAST_ORIGIN_DBCORP,
  FORECAST_PRAZO_REAL_JANELA_DIAS,
  FORECAST_PRAZO_REAL_MIN_CHEGADAS,
} from '../constants/forecast';
import type { ForecastSourcePatchInput } from '../validators/forecast';
import { HttpError } from '../utils/http';
import type { MudancaDePrazo } from '../utils/forecastDbcorpRegras';
import { prazoRealPorFonte, type PrazoRealDaFonte } from '../utils/forecastPrazoReal';
import type { AmostraPrazoFup } from '../utils/forecastTypes';
import { dbDateToKey, isValidDateKey } from '../utils/supplierDocumentDates';
import { normalizeProductCode, type ForecastWorkbookSource } from '../utils/forecastWorkbook';
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

// Elemento de `inputs.prazosFup` no formato esperado: JSON corrompido nao pode derrubar a rota (500).
function ehAmostraPrazoFup(v: unknown): v is AmostraPrazoFup {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const a = v as Record<string, unknown>;
  const dias = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x));
  return (
    typeof a.codigo === 'string' &&
    a.codigo !== '' &&
    typeof a.etaFinal === 'string' &&
    isValidDateKey(a.etaFinal) &&
    dias(a.poDias) &&
    dias(a.etdDias)
  );
}

// `inputs.prazosFup` ausente (quinzena gravada antes do 3C) -> null; lista vazia e historico valido; elemento fora
// do formato e descartado (so reduz as chegadas).
function amostrasDoSnapshot(inputs: unknown): AmostraPrazoFup[] | null {
  if (typeof inputs !== 'object' || inputs === null) return null;
  const prazos = (inputs as { prazosFup?: unknown }).prazosFup;
  return Array.isArray(prazos) ? prazos.filter(ehAmostraPrazoFup) : null;
}

export type ForecastPrazoRealMotivo = 'sem_quinzena_dbcorp' | 'quinzena_sem_historico';

export interface ForecastPrazoRealData {
  quinzena: { id: number; label: string; baseDate: string } | null;
  disponivel: boolean;
  motivo: ForecastPrazoRealMotivo | null;
  janelaDias: number;
  minChegadas: number;
  padraoEtdDias: number;
  fontes: Array<{
    sourceId: number;
    nome: string;
    leadTimeDays: number | null;
    clearanceDays: number | null;
    etdDiasUsado: number;
    real: PrazoRealDaFonte | null;
  }>;
  semFonte: { chegadas: number };
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

  // Prazo real medio por fonte, calculado EM LEITURA da ultima quinzena DBCorp (amostras congeladas em
  // `inputs.prazosFup`) e do cadastro ATUAL (codigo -> produto ativo -> fonte ativa). Nada e gravado.
  static async prazoReal(): Promise<ForecastPrazoRealData> {
    const [snapshot, sources, products] = await Promise.all([
      prisma.forecastSnapshot.findFirst({
        where: { origin: FORECAST_ORIGIN_DBCORP, deletedAt: null },
        orderBy: [{ baseDate: 'desc' }, { id: 'desc' }],
        select: { id: true, label: true, baseDate: true, inputs: true },
      }),
      prisma.forecastSource.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, leadTimeDays: true, clearanceDays: true, arrivalFromEtdDays: true },
      }),
      prisma.forecastProduct.findMany({
        where: { isActive: true, sourceId: { not: null } },
        orderBy: [{ sheetOrder: 'asc' }, { id: 'asc' }],
        select: { sourceId: true, codes: { select: { code: true } } },
      }),
    ]);

    const amostras = amostrasDoSnapshot(snapshot?.inputs);
    const disponivel = amostras !== null;
    const motivo: ForecastPrazoRealMotivo | null = !snapshot
      ? 'sem_quinzena_dbcorp'
      : amostras === null
        ? 'quinzena_sem_historico'
        : null;

    // Mesma regra de ForecastDbcorpService.buildQuinzena: so fontes ativas, primeiro produto vence.
    const idsDeFontes = new Set(sources.map((s) => s.id));
    const fonteDoCodigo = new Map<string, number>();
    for (const p of products) {
      if (!p.sourceId || !idsDeFontes.has(p.sourceId)) continue;
      for (const c of p.codes) {
        const code = normalizeProductCode(c.code);
        if (!fonteDoCodigo.has(code)) fonteDoCodigo.set(code, p.sourceId);
      }
    }
    const agrupado = amostras ? prazoRealPorFonte(amostras, fonteDoCodigo) : null;

    return {
      quinzena: snapshot
        ? { id: snapshot.id, label: snapshot.label, baseDate: dbDateToKey(snapshot.baseDate) }
        : null,
      disponivel,
      motivo,
      janelaDias: FORECAST_PRAZO_REAL_JANELA_DIAS,
      minChegadas: FORECAST_PRAZO_REAL_MIN_CHEGADAS,
      padraoEtdDias: FORECAST_DBCORP_ETA_POR_ETD_DIAS,
      fontes: sources.map((s) => ({
        sourceId: s.id,
        nome: s.name,
        leadTimeDays: s.leadTimeDays,
        clearanceDays: s.clearanceDays,
        etdDiasUsado: s.arrivalFromEtdDays ?? FORECAST_DBCORP_ETA_POR_ETD_DIAS,
        real: agrupado ? (agrupado.porFonte.get(s.id) ?? { po: null, etd: null }) : null,
      })),
      semFonte: agrupado ? agrupado.semFonte : { chegadas: 0 },
    };
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
