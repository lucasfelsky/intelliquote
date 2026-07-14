import { Prisma, QuoteRequest } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { reportQuerySchema } from '../validators/domain';
import { handleControllerError, HttpError } from '../utils/http';

interface DateRange {
  from?: Date;
  to?: Date;
}

interface ComparisonWithDetails {
  id: number;
  quoteRequestId: number;
  results: Array<{
    supplierId: number;
    isWinner: boolean;
    totalLandedCost: { toNumber?: () => number } | number | null;
    offeredPrice: { toNumber?: () => number } | number | null;
  }>;
  quoteRequest: Pick<QuoteRequest, 'requestCode' | 'productName' | 'currency'>;
}

export class ReportController {
  static async summary(req: Request, res: Response): Promise<Response> {
    try {
      const range = parseRange(req);
      const [quoteRequests, responses, comparisons, suppliers] = await Promise.all([
        prisma.quoteRequest.count({ where: buildRequestWhere(range) }),
        prisma.quoteResponse.count({ where: buildResponseWhere(range) }),
        prisma.quoteComparison.count({ where: buildComparisonWhere(range) }),
        prisma.supplier.count(),
      ]);

      const awardRate = await computeAwardRate(range);

      return res.status(200).json({
        totals: { quoteRequests, responses, comparisons, suppliers },
        awardRate,
        range: serializeRange(range),
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async savings(req: Request, res: Response): Promise<Response> {
    try {
      const range = parseRange(req);
      const comparisons = (await prisma.quoteComparison.findMany({
        where: buildComparisonWhere(range),
        include: {
          results: { orderBy: { totalScore: 'desc' } },
          quoteRequest: { select: { requestCode: true, productName: true, currency: true } },
        },
      })) as unknown as ComparisonWithDetails[];

      const items = comparisons
        .map((comparison) => buildSavingsEntry(comparison))
        .filter((item): item is SavingsEntry => item !== null);

      const totals = items.reduce(
        (acc, item) => {
          acc.absoluteSaving += item.absoluteSaving;
          acc.percentSaving += item.percentSaving;
          acc.comparisons += 1;
          return acc;
        },
        { absoluteSaving: 0, percentSaving: 0, comparisons: 0 },
      );

      const averagePercent =
        totals.comparisons > 0 ? totals.percentSaving / totals.comparisons : 0;

      return res.status(200).json({
        comparisons: totals.comparisons,
        absoluteSaving: round2(totals.absoluteSaving),
        averagePercentSaving: Number(averagePercent.toFixed(2)),
        items,
        range: serializeRange(range),
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async leadTime(req: Request, res: Response): Promise<Response> {
    try {
      const range = parseRange(req);
      const responses = await prisma.quoteResponse.findMany({
        where: {
          leadTimeDays: { not: null },
          submittedAt: buildDateFilter(range),
        },
        select: {
          leadTimeDays: true,
          supplierId: true,
          submittedAt: true,
          supplier: { select: { name: true } },
        },
      });

      const counts = responses.length;
      const averageLeadTime =
        counts > 0
          ? responses.reduce((sum, item) => sum + Number(item.leadTimeDays ?? 0), 0) / counts
          : 0;

      const bySupplier = new Map<number, { supplierName: string; total: number; count: number }>();
      for (const response of responses) {
        const entry = bySupplier.get(response.supplierId) ?? {
          supplierName: response.supplier?.name ?? 'Fornecedor nao identificado',
          total: 0,
          count: 0,
        };
        entry.total += Number(response.leadTimeDays ?? 0);
        entry.count += 1;
        bySupplier.set(response.supplierId, entry);
      }

      return res.status(200).json({
        responses: counts,
        averageLeadTimeDays: Number(averageLeadTime.toFixed(1)),
        bySupplier: Array.from(bySupplier.entries())
          .map(([supplierId, data]) => ({
            supplierId,
            supplierName: data.supplierName,
            averageLeadTimeDays: Number((data.total / data.count).toFixed(1)),
            responses: data.count,
          }))
          .sort((a, b) => a.averageLeadTimeDays - b.averageLeadTimeDays),
        range: serializeRange(range),
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async topSuppliers(req: Request, res: Response): Promise<Response> {
    try {
      const range = parseRange(req);
      const responses = await prisma.quoteResponse.findMany({
        where: buildResponseWhere(range),
        include: {
          wonComparisons: {
            where: buildComparisonWhere(range),
            include: {
              results: {
                where: { quoteResponseId: { not: null } },
                select: { isWinner: true, totalScore: true, quoteResponseId: true },
              },
            },
          },
          supplier: { select: { id: true, name: true, country: true } },
        },
      });

      // F12 (backlog 2026-07-12): media de avaliacao por fornecedor (media das
      // 3 dimensoes) juntada ao ranking. Nao filtra por range — reflete todo o
      // historico de reviews do fornecedor.
      const supplierIds = Array.from(new Set(responses.map((response) => response.supplierId)));
      const reviewAggregates = supplierIds.length
        ? await prisma.supplierReview.groupBy({
            by: ['supplierId'],
            where: { supplierId: { in: supplierIds } },
            _avg: { priceRating: true, leadTimeRating: true, qualityRating: true },
            _count: { _all: true },
          })
        : [];
      const ratingBySupplier = new Map(
        reviewAggregates.map((entry) => {
          const avgPrice = entry._avg.priceRating ?? 0;
          const avgLeadTime = entry._avg.leadTimeRating ?? 0;
          const avgQuality = entry._avg.qualityRating ?? 0;
          return [
            entry.supplierId,
            {
              reviewCount: entry._count._all,
              avgRating: Number(((avgPrice + avgLeadTime + avgQuality) / 3).toFixed(2)),
            },
          ];
        }),
      );

      const aggregate = new Map<
        number,
        {
          supplierId: number;
          supplierName: string;
          country: string | null;
          responses: number;
          wins: number;
          totalScore: number;
        }
      >();

      for (const response of responses) {
        const key = response.supplierId;
        const supplier = response.supplier;
        const entry = aggregate.get(key) ?? {
          supplierId: key,
          supplierName: supplier.name,
          country: supplier.country,
          responses: 0,
          wins: 0,
          totalScore: 0,
        };
        entry.responses += 1;
        for (const comparison of response.wonComparisons) {
          for (const result of comparison.results) {
            if (result.isWinner) entry.wins += 1;
            entry.totalScore += Number(result.totalScore ?? 0);
          }
        }
        aggregate.set(key, entry);
      }

      const items = Array.from(aggregate.values())
        .map((entry) => ({
          ...entry,
          winRate: entry.responses > 0 ? Number(((entry.wins / entry.responses) * 100).toFixed(2)) : 0,
          averageScore:
            entry.responses > 0 ? Number((entry.totalScore / entry.responses).toFixed(2)) : 0,
          avgRating: ratingBySupplier.get(entry.supplierId)?.avgRating ?? null,
          reviewCount: ratingBySupplier.get(entry.supplierId)?.reviewCount ?? 0,
        }))
        .sort((a, b) => b.wins - a.wins || b.averageScore - a.averageScore)
        .slice(0, 10);

      return res.status(200).json({ items, range: serializeRange(range) });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  static async awardRate(req: Request, res: Response): Promise<Response> {
    try {
      const range = parseRange(req);
      const data = await computeAwardRate(range);
      return res.status(200).json({ ...data, range: serializeRange(range) });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  // F7 (backlog 2026-07-12): engajamento por fornecedor — quantos tokens de
  // portal foram enviados, quantos foram respondidos (respondedAt), a taxa e
  // o tempo medio de resposta (respondedAt - createdAt). Dados que ja existem
  // em SupplierPortalToken mas nenhum relatorio computava. Filtro por periodo
  // sobre a EMISSAO do token (createdAt).
  static async supplierEngagement(req: Request, res: Response): Promise<Response> {
    try {
      const range = parseRange(req);
      const dateFilter = buildDateFilter(range);

      const tokens = await prisma.supplierPortalToken.findMany({
        where: dateFilter ? { createdAt: dateFilter } : {},
        select: {
          supplierId: true,
          createdAt: true,
          respondedAt: true,
          supplier: { select: { name: true } },
        },
      });

      const bySupplier = new Map<
        number,
        { supplierId: number; supplierName: string; sent: number; responded: number; totalResponseHours: number }
      >();

      for (const token of tokens) {
        const entry = bySupplier.get(token.supplierId) ?? {
          supplierId: token.supplierId,
          supplierName: token.supplier?.name ?? `Fornecedor #${token.supplierId}`,
          sent: 0,
          responded: 0,
          totalResponseHours: 0,
        };
        entry.sent += 1;
        if (token.respondedAt) {
          entry.responded += 1;
          entry.totalResponseHours +=
            (token.respondedAt.getTime() - token.createdAt.getTime()) / (60 * 60 * 1000);
        }
        bySupplier.set(token.supplierId, entry);
      }

      const items = [...bySupplier.values()]
        .map((entry) => ({
          supplierId: entry.supplierId,
          supplierName: entry.supplierName,
          tokensSent: entry.sent,
          tokensResponded: entry.responded,
          responseRate: entry.sent > 0 ? Number(((entry.responded / entry.sent) * 100).toFixed(1)) : 0,
          avgResponseHours:
            entry.responded > 0 ? Number((entry.totalResponseHours / entry.responded).toFixed(1)) : null,
        }))
        .sort((a, b) => b.responseRate - a.responseRate || b.tokensSent - a.tokensSent);

      return res.status(200).json({ items, range: serializeRange(range) });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }

  // F7: historico de preco unitario por item de catalogo ao longo do tempo,
  // agrupado por mes (YYYY-MM). Fonte: SupplierPortalResponseItem (unitPrice
  // real por item) -> QuoteRequestItem (catalogItemId). Por mes devolve
  // min/avg/max e o fornecedor do melhor preco (o comprador ve tendencia e
  // quem tem sido mais competitivo).
  static async priceHistory(req: Request, res: Response): Promise<Response> {
    try {
      const catalogItemId = Number(req.query.catalogItemId);
      if (!Number.isInteger(catalogItemId) || catalogItemId <= 0) {
        throw new HttpError(400, 'catalogItemId invalido.');
      }
      const range = parseRange(req);
      const dateFilter = buildDateFilter(range);

      const responseItems = await prisma.supplierPortalResponseItem.findMany({
        where: {
          deletedAt: null,
          quoteRequestItem: { catalogItemId },
          response: {
            deletedAt: null,
            ...(dateFilter ? { submittedAt: dateFilter } : {}),
          },
        },
        select: {
          unitPrice: true,
          response: {
            select: {
              submittedAt: true,
              currency: true,
              supplierId: true,
              supplier: { select: { name: true } },
            },
          },
        },
      });

      const byMonth = new Map<
        string,
        { month: string; prices: number[]; best: { supplierId: number; supplierName: string; price: number } | null; currency: string }
      >();

      for (const item of responseItems) {
        const submittedAt = item.response.submittedAt;
        const month = `${submittedAt.getUTCFullYear()}-${String(submittedAt.getUTCMonth() + 1).padStart(2, '0')}`;
        const price = Number(item.unitPrice);
        const entry = byMonth.get(month) ?? {
          month,
          prices: [],
          best: null,
          currency: item.response.currency,
        };
        entry.prices.push(price);
        if (!entry.best || price < entry.best.price) {
          entry.best = {
            supplierId: item.response.supplierId,
            supplierName: item.response.supplier?.name ?? `Fornecedor #${item.response.supplierId}`,
            price,
          };
        }
        byMonth.set(month, entry);
      }

      const series = [...byMonth.values()]
        .map((entry) => ({
          month: entry.month,
          currency: entry.currency,
          min: Math.min(...entry.prices),
          max: Math.max(...entry.prices),
          avg: Number((entry.prices.reduce((sum, p) => sum + p, 0) / entry.prices.length).toFixed(2)),
          count: entry.prices.length,
          bestSupplier: entry.best,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));

      return res.status(200).json({ catalogItemId, series, range: serializeRange(range) });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  }
}

function parseRange(req: Request): DateRange {
  const parsed = reportQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, 'Periodo invalido para o relatorio.');
  }
  return { from: parsed.data.from, to: parsed.data.to };
}

function buildDateFilter(range: DateRange): Prisma.DateTimeFilter | undefined {
  if (!range.from && !range.to) {
    return undefined;
  }
  const filter: Prisma.DateTimeFilter = {};
  if (range.from) filter.gte = range.from;
  if (range.to) filter.lte = range.to;
  return filter;
}

function buildRequestWhere(range: DateRange): Prisma.QuoteRequestWhereInput {
  const filter = buildDateFilter(range);
  return filter ? { createdAt: filter } : {};
}

function buildResponseWhere(range: DateRange): Prisma.QuoteResponseWhereInput {
  const filter = buildDateFilter(range);
  return filter ? { submittedAt: filter } : {};
}

function buildComparisonWhere(range: DateRange): Prisma.QuoteComparisonWhereInput {
  const filter = buildDateFilter(range);
  return filter ? { createdAt: filter } : {};
}

function serializeRange(range: DateRange) {
  return {
    from: range.from?.toISOString() ?? null,
    to: range.to?.toISOString() ?? null,
  };
}

async function computeAwardRate(range: DateRange) {
  const whereComparison = buildComparisonWhere(range);
  const whereResult: Prisma.QuoteComparisonResultWhereInput = { isWinner: true };
  const dateFilter = buildDateFilter(range);
  if (dateFilter) {
    whereResult.comparison = { is: { createdAt: dateFilter } };
  }

  const [totalComparisons, winners] = await Promise.all([
    prisma.quoteComparison.count({ where: whereComparison }),
    prisma.quoteComparisonResult.count({ where: whereResult }),
  ]);

  const rate = totalComparisons > 0 ? Number(((winners / totalComparisons) * 100).toFixed(2)) : 0;
  return { comparisons: totalComparisons, winners, rate };
}

interface SavingsEntry {
  comparisonId: number;
  quoteRequestId: number;
  requestCode: string;
  productName: string;
  currency: string;
  winner: { supplierId: number; landedCost: number; offeredPrice: number };
  mostExpensive: { supplierId: number; landedCost: number; offeredPrice: number };
  absoluteSaving: number;
  percentSaving: number;
}

function buildSavingsEntry(comparison: ComparisonWithDetails): SavingsEntry | null {
  if (!comparison.results || comparison.results.length < 2) {
    return null;
  }
  const winner = comparison.results.find((result) => result.isWinner);
  if (!winner) {
    return null;
  }
  const sortedByLanded = [...comparison.results].sort(
    (a, b) => numeric(a.totalLandedCost) - numeric(b.totalLandedCost),
  );
  const mostExpensive = sortedByLanded[sortedByLanded.length - 1];
  const winnerLanded = numeric(winner.totalLandedCost);
  const worstLanded = numeric(mostExpensive.totalLandedCost);
  const absoluteSaving = Math.max(worstLanded - winnerLanded, 0);
  const percentSaving =
    worstLanded > 0 ? Number(((absoluteSaving / worstLanded) * 100).toFixed(2)) : 0;

  return {
    comparisonId: comparison.id,
    quoteRequestId: comparison.quoteRequestId,
    requestCode: comparison.quoteRequest.requestCode,
    productName:
      comparison.quoteRequest.productName ?? comparison.quoteRequest.requestCode,
    currency: comparison.quoteRequest.currency,
    winner: {
      supplierId: winner.supplierId,
      landedCost: round2(winnerLanded),
      offeredPrice: round2(numeric(winner.offeredPrice)),
    },
    mostExpensive: {
      supplierId: mostExpensive.supplierId,
      landedCost: round2(worstLanded),
      offeredPrice: round2(numeric(mostExpensive.offeredPrice)),
    },
    absoluteSaving: round2(absoluteSaving),
    percentSaving,
  };
}

function numeric(value: { toNumber?: () => number } | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return Number(value);
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
