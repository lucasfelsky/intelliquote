import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { FORECAST_ORIGIN_WORKBOOK } from '../constants/forecast';
import { HttpError } from '../utils/http';
import type { Lancamento } from '../utils/forecastTypes';
import {
  normalizeProductCode,
  parseForecastWorkbook,
  type ParsedForecastWorkbook,
} from '../utils/forecastWorkbook';
import { todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import { AuditLogService } from './AuditLogService';
import { ForecastProductService, toProductDrafts, type ProductPlan } from './ForecastProductService';
import { ForecastSnapshotService, conferenciaDaQuinzena, halfDoRotulo } from './ForecastSnapshotService';
import type { ForecastConferencia, FrozenProduct } from './ForecastSnapshotService';
import { ForecastSourceService, type SourcePlan } from './ForecastSourceService';

type Db = Prisma.TransactionClient;

const SALES_CHUNK = 5000;

export interface ForecastWorkbookInput {
  contentBase64: string;
  fileName: string;
  label: string;
  baseDate: string;
}

export interface ForecastImportOptions {
  atualizarCadastro: boolean;
  gravarHistorico: boolean;
  criarQuinzena: boolean;
}

export interface ForecastImportSummary {
  label: string;
  baseDate: string;
  half: 1 | 2;
  produtos: ProductPlan['resumo']['produtos'];
  codigos: ProductPlan['resumo']['codigos'];
  fontes: SourcePlan['resumo'];
  historico: {
    yearMonth: string | null;
    linhas: number;
    novas: number;
    alteradas: number;
    removidas: number;
  };
  conferencia: ForecastConferencia;
  avisos: string[];
  erros: string[];
}

interface SalesPlan {
  yearMonth: string | null;
  rows: Array<{ code: string; quantity: number }>;
  resumo: ForecastImportSummary['historico'];
}

const roundQty = (value: number) => Math.round(value * 1e6) / 1e6;

// Soma por codigo (maiusculas): a VENDAS MENSAL pode ter varias linhas do mesmo codigo e o historico
// tem uma linha por (codigo, mes).
function aggregateSales(linhas: Lancamento[]): Array<{ code: string; quantity: number }> {
  const sums = new Map<string, number>();
  for (const { codigo, qtd } of linhas) {
    const code = normalizeProductCode(codigo);
    if (!code) continue;
    sums.set(code, (sums.get(code) ?? 0) + qtd);
  }
  return [...sums.entries()].map(([code, quantity]) => ({ code, quantity: roundQty(quantity) }));
}

const EMPTY_CONFERENCIA: ForecastConferencia = {
  celulas: 0,
  batem: 0,
  porColuna: {},
  totalDivergencias: 0,
  divergencias: [],
};

function decodeBase64(contentBase64: string): Buffer {
  const buffer = Buffer.from(contentBase64, 'base64');
  if (buffer.length === 0) {
    throw new HttpError(400, 'O arquivo enviado esta vazio.');
  }
  return buffer;
}

export class ForecastImportService {
  private static async planSales(db: Db, parsed: ParsedForecastWorkbook): Promise<SalesPlan> {
    const yearMonth = parsed.vendasMensal.yearMonth;
    const rows = aggregateSales(parsed.vendasMensal.linhas);
    if (yearMonth === null) {
      return { yearMonth, rows, resumo: { yearMonth, linhas: rows.length, novas: 0, alteradas: 0, removidas: 0 } };
    }
    const existing = await db.forecastMonthlySale.findMany({
      where: { yearMonth },
      select: { code: true, quantity: true },
    });
    const existingByCode = new Map(existing.map((r) => [r.code, Number(r.quantity)]));
    const incoming = new Set(rows.map((r) => r.code));
    let novas = 0;
    let alteradas = 0;
    for (const row of rows) {
      const current = existingByCode.get(row.code);
      if (current === undefined) novas++;
      else if (Math.abs(current - row.quantity) > 1e-6) alteradas++;
    }
    const removidas = existing.filter((r) => !incoming.has(r.code)).length;
    return { yearMonth, rows, resumo: { yearMonth, linhas: rows.length, novas, alteradas, removidas } };
  }

  // Diff do arquivo contra o banco, sem escrita. `db` = prisma (preview) ou a transacao (confirm).
  private static async diff(db: Db, parsed: ParsedForecastWorkbook) {
    const sourcePlan = await ForecastSourceService.plan(db, parsed.fontes);
    const productPlan = await ForecastProductService.plan(
      db,
      toProductDrafts(parsed.quinzena.produtos),
      sourcePlan.knownKeys,
    );
    const salesPlan = await ForecastImportService.planSales(db, parsed);
    const conferencia = conferenciaDaQuinzena(parsed.quinzena, todayKeyInSaoPaulo(new Date()));

    const summary: ForecastImportSummary = {
      label: parsed.quinzena.id,
      baseDate: parsed.quinzena.dataBase,
      half: halfDoRotulo(parsed.quinzena.id),
      produtos: productPlan.resumo.produtos,
      codigos: productPlan.resumo.codigos,
      fontes: sourcePlan.resumo,
      historico: salesPlan.resumo,
      conferencia,
      avisos: [...parsed.avisos, ...productPlan.avisos],
      erros: parsed.erros,
    };
    return { sourcePlan, productPlan, salesPlan, summary };
  }

  // Resposta do preview quando o parser achou erros: nada e comparado com o banco.
  private static summaryWithErrors(
    parsed: ParsedForecastWorkbook,
    input: ForecastWorkbookInput,
  ): ForecastImportSummary {
    let half: 1 | 2 = 2;
    try {
      half = halfDoRotulo(input.label);
    } catch {
      // rotulo invalido ja esta em parsed.erros
    }
    return {
      label: input.label,
      baseDate: input.baseDate,
      half,
      produtos: { total: parsed.quinzena.produtos.length, novos: 0, alterados: 0, inativados: 0 },
      codigos: { total: 0, vinculadosCatalogo: 0, movidos: 0 },
      fontes: { total: parsed.fontes.length, novas: 0, alteradas: 0, comFornecedor: 0 },
      historico: {
        yearMonth: parsed.vendasMensal.yearMonth,
        linhas: 0,
        novas: 0,
        alteradas: 0,
        removidas: 0,
      },
      conferencia: EMPTY_CONFERENCIA,
      avisos: parsed.avisos,
      erros: parsed.erros,
    };
  }

  static async preview(input: ForecastWorkbookInput): Promise<ForecastImportSummary> {
    const buffer = decodeBase64(input.contentBase64);
    const parsed = await parseForecastWorkbook(buffer, {
      label: input.label,
      baseDate: input.baseDate,
      fileName: input.fileName,
    });
    if (parsed.erros.length > 0) {
      return ForecastImportService.summaryWithErrors(parsed, input);
    }
    const { summary } = await ForecastImportService.diff(prisma, parsed);
    return summary;
  }

  static async confirm(
    input: ForecastWorkbookInput & { options: ForecastImportOptions },
    userId: number | null,
  ): Promise<ForecastImportSummary & { snapshotId: number | null; options: ForecastImportOptions }> {
    const buffer = decodeBase64(input.contentBase64);
    // Re-parse no servidor: nunca confia em linhas vindas do cliente.
    const parsed = await parseForecastWorkbook(buffer, {
      label: input.label,
      baseDate: input.baseDate,
      fileName: input.fileName,
    });
    if (parsed.erros.length > 0) {
      throw new HttpError(400, `Planilha com erros: ${parsed.erros.slice(0, 5).join(' ')}`);
    }
    const { options } = input;
    const fileInfo = {
      kind: 'planilha',
      fileName: input.fileName,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      rows: parsed.quinzena.produtos.length,
    };

    return prisma.$transaction(
      async (tx) => {
        // Imports concorrentes sao serializados (primeiro statement da transacao).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'forecast:import'}))`;
        if (options.criarQuinzena) {
          await ForecastSnapshotService.assertLabelFree(tx, parsed.quinzena.id);
        }

        const { sourcePlan, productPlan, salesPlan, summary } = await ForecastImportService.diff(
          tx,
          parsed,
        );

        let productIds = new Map<string, number>();
        if (options.atualizarCadastro) {
          await ForecastSourceService.apply(tx, sourcePlan, userId);
          const sources = await tx.forecastSource.findMany({
            select: { id: true, normalizedName: true },
          });
          productIds = await ForecastProductService.apply(
            tx,
            productPlan,
            new Map(sources.map((s) => [s.normalizedName, s.id])),
            userId,
          );
        } else if (options.criarQuinzena) {
          const known = await tx.forecastProduct.findMany({
            where: { normalizedName: { in: productPlan.items.map((i) => i.draft.normalizedName) } },
            select: { id: true, normalizedName: true },
          });
          productIds = new Map(known.map((p) => [p.normalizedName, p.id]));
        }

        let snapshotId: number | null = null;
        if (options.criarQuinzena) {
          const quinzena = {
            ...parsed.quinzena,
            produtos: parsed.quinzena.produtos.map((p, index): FrozenProduct => {
              const productId = productIds.get(productPlan.items[index].draft.normalizedName);
              return productId === undefined ? p : { ...p, productId };
            }),
          };
          const snapshot = await ForecastSnapshotService.createFromParsed(
            tx,
            quinzena,
            FORECAST_ORIGIN_WORKBOOK,
            [fileInfo],
            userId,
          );
          snapshotId = snapshot.id;
          await AuditLogService.log(
            {
              entityType: 'forecast_snapshot',
              entityId: snapshot.id,
              action: 'create',
              performedById: userId,
              metadata: {
                label: parsed.quinzena.id,
                origin: FORECAST_ORIGIN_WORKBOOK,
                conferencia: { celulas: summary.conferencia.celulas, batem: summary.conferencia.batem },
              },
            },
            tx,
          );
        }

        if (options.gravarHistorico && salesPlan.yearMonth !== null) {
          const { yearMonth } = salesPlan;
          // A VENDAS MENSAL e o relatorio completo do mes: substitui o mes inteiro.
          await tx.forecastMonthlySale.deleteMany({ where: { yearMonth } });
          const sourceLabel = `planilha ${parsed.quinzena.id}`;
          for (let i = 0; i < salesPlan.rows.length; i += SALES_CHUNK) {
            await tx.forecastMonthlySale.createMany({
              data: salesPlan.rows.slice(i, i + SALES_CHUNK).map((r) => ({
                code: r.code,
                yearMonth,
                quantity: r.quantity,
                sourceLabel,
                snapshotId,
              })),
            });
          }
          await AuditLogService.log(
            {
              entityType: 'forecast_sales',
              entityId: yearMonth,
              action: 'replace_month',
              performedById: userId,
              metadata: {
                yearMonth,
                linhas: salesPlan.resumo.linhas,
                novas: salesPlan.resumo.novas,
                alteradas: salesPlan.resumo.alteradas,
                removidas: salesPlan.resumo.removidas,
              },
            },
            tx,
          );
        }

        return { ...summary, snapshotId, options };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
}
