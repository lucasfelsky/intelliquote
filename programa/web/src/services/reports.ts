// Helpers e tipos para os endpoints de Relatórios.
// Os serviços retornam o JSON cru (sem normalizar) para preservar a forma
// entregue pelo backend; quem precisar de números tipados pode fazer o cast
// localmente (Prisma Decimal chega como string em alguns campos).

import { api } from '@/api/client';

export type ReportRange = { from?: string; to?: string };

export interface ReportRangeBounds {
  from: string | null;
  to: string | null;
}

export interface ReportTotals {
  quoteRequests: number;
  responses: number;
  comparisons: number;
  suppliers: number;
}

export interface ReportAwardRateSummary {
  comparisons: number;
  winners: number;
  rate: number;
}

export interface ReportSummary {
  totals: ReportTotals;
  awardRate: ReportAwardRateSummary;
  range: ReportRangeBounds;
}

export interface ReportSavingsLeg {
  supplierId: number;
  landedCost: number;
  offeredPrice: number;
}

export interface ReportSavingsItem {
  comparisonId: number;
  quoteRequestId: number;
  requestCode: string;
  productName: string;
  currency: string;
  winner: ReportSavingsLeg;
  mostExpensive: ReportSavingsLeg;
  absoluteSaving: number;
  percentSaving: number;
}

export interface ReportSavings {
  comparisons: number;
  absoluteSaving: number;
  averagePercentSaving: number;
  items: ReportSavingsItem[];
  range: ReportRangeBounds;
}

export interface ReportLeadTimeSupplier {
  supplierId: number;
  supplierName: string;
  averageLeadTimeDays: number;
  responses: number;
}

export interface ReportLeadTime {
  responses: number;
  averageLeadTimeDays: number;
  bySupplier: ReportLeadTimeSupplier[];
  range: ReportRangeBounds;
}

export interface ReportTopSupplier {
  supplierId: number;
  supplierName: string;
  country: string | null;
  responses: number;
  wins: number;
  totalScore: number;
  winRate: number;
  averageScore: number;
}

export interface ReportTopSuppliers {
  items: ReportTopSupplier[];
  range: ReportRangeBounds;
}

export interface ReportAwardRate {
  comparisons: number;
  winners: number;
  rate: number;
  range: ReportRangeBounds;
}

// F7 (backlog 2026-07-12): engajamento por fornecedor.
export interface ReportSupplierEngagementItem {
  supplierId: number;
  supplierName: string;
  tokensSent: number;
  tokensResponded: number;
  responseRate: number;
  avgResponseHours: number | null;
}

export interface ReportSupplierEngagement {
  items: ReportSupplierEngagementItem[];
  range: ReportRangeBounds;
}

// F7: historico de preco por item de catalogo.
export interface ReportPriceHistoryPoint {
  month: string;
  currency: string;
  min: number;
  max: number;
  avg: number;
  count: number;
  bestSupplier: { supplierId: number; supplierName: string; price: number } | null;
}

export interface ReportPriceHistory {
  catalogItemId: number;
  series: ReportPriceHistoryPoint[];
  range: ReportRangeBounds;
}

export function dateRangeQuery(range?: ReportRange): {
  from?: string;
  to?: string;
} {
  if (!range) return {};
  const query: { from?: string; to?: string } = {};
  if (range.from) query.from = range.from;
  if (range.to) query.to = range.to;
  return query;
}

export async function getReportSummary(range?: ReportRange): Promise<ReportSummary> {
  return api.get<ReportSummary>('/v1/reports/summary', dateRangeQuery(range));
}

export async function getReportSavings(range?: ReportRange): Promise<ReportSavings> {
  return api.get<ReportSavings>('/v1/reports/savings', dateRangeQuery(range));
}

export async function getReportLeadTime(range?: ReportRange): Promise<ReportLeadTime> {
  return api.get<ReportLeadTime>('/v1/reports/lead-time', dateRangeQuery(range));
}

export async function getReportTopSuppliers(range?: ReportRange): Promise<ReportTopSuppliers> {
  return api.get<ReportTopSuppliers>('/v1/reports/top-suppliers', dateRangeQuery(range));
}

export async function getReportAwardRate(range?: ReportRange): Promise<ReportAwardRate> {
  return api.get<ReportAwardRate>('/v1/reports/award-rate', dateRangeQuery(range));
}

export async function getReportSupplierEngagement(
  range?: ReportRange,
): Promise<ReportSupplierEngagement> {
  return api.get<ReportSupplierEngagement>('/v1/reports/supplier-engagement', dateRangeQuery(range));
}

export async function getReportPriceHistory(
  catalogItemId: number,
  range?: ReportRange,
): Promise<ReportPriceHistory> {
  return api.get<ReportPriceHistory>('/v1/reports/price-history', {
    ...dateRangeQuery(range),
    catalogItemId: String(catalogItemId),
  });
}

export { messageOf } from '@/services/quoteResponses';