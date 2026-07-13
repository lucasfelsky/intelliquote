import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getReportAwardRate,
  getReportLeadTime,
  getReportSavings,
  getReportSummary,
  getReportTopSuppliers,
  getReportSupplierEngagement,
  messageOf,
  type ReportRange,
  type ReportSavingsItem,
  type ReportLeadTimeSupplier,
  type ReportTopSupplier,
  type ReportSupplierEngagementItem,
} from '@/services/reports';

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatInt(value: number | undefined | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR');
}

function formatCurrency(value: number | undefined | null, currency: string): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${formatInt(value)} ${currency}`;
  }
}

function formatPercent(value: number | undefined | null, fractionDigits = 1): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${(value * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export default function Relatorios() {
  const qc = useQueryClient();
  const [from, setFrom] = useState<string>(daysAgoIso(30));
  const [to, setTo] = useState<string>(todayIso());
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const range: ReportRange = useMemo(() => ({ from, to }), [from, to]);
  const queryKey = ['reports', range.from ?? '', range.to ?? ''];

  const summary = useQuery({
    queryKey: [...queryKey, 'summary'],
    queryFn: () => getReportSummary(range),
  });
  const savings = useQuery({
    queryKey: [...queryKey, 'savings'],
    queryFn: () => getReportSavings(range),
  });
  const leadTime = useQuery({
    queryKey: [...queryKey, 'lead-time'],
    queryFn: () => getReportLeadTime(range),
  });
  const topSuppliers = useQuery({
    queryKey: [...queryKey, 'top-suppliers'],
    queryFn: () => getReportTopSuppliers(range),
  });
  const awardRate = useQuery({
    queryKey: [...queryKey, 'award-rate'],
    queryFn: () => getReportAwardRate(range),
  });
  const engagement = useQuery({
    queryKey: [...queryKey, 'supplier-engagement'],
    queryFn: () => getReportSupplierEngagement(range),
  });

  async function refreshAll() {
    setFeedback(null);
    try {
      await qc.invalidateQueries({ queryKey: ['reports'] });
      await qc.refetchQueries({ queryKey });
      setFeedback({ kind: 'ok', text: 'Relatórios atualizados.' });
    } catch (err) {
      setFeedback({ kind: 'err', text: messageOf(err) });
    }
  }

  const summaryData = summary.data;
  const savingsData = savings.data;
  const leadTimeData = leadTime.data;
  const topSuppliersData = topSuppliers.data;
  const awardRateData = awardRate.data;

  // Moeda predominante no card de economia (usa a 1ª que aparecer; default BRL).
  const savingsCurrency = savingsData?.items?.[0]?.currency ?? 'BRL';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operação</p>
          <h1>Relatórios</h1>
          <p>Acompanhe os indicadores operacionais do IntelliQuote.</p>
        </div>
        <div className="page-header__actions" style={{ alignItems: 'flex-end', gap: 8 }}>
          <div>
            <label className="field-label" htmlFor="reports-from">De</label>
            <input
              id="reports-from"
              className="input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={{ minWidth: 150 }}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="reports-to">Até</label>
            <input
              id="reports-to"
              className="input"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={{ minWidth: 150 }}
            />
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={refreshAll}
            disabled={
              summary.isFetching ||
              savings.isFetching ||
              leadTime.isFetching ||
              topSuppliers.isFetching ||
              awardRate.isFetching
            }
          >
            Atualizar
          </button>
        </div>
      </div>

      {feedback && (
        <p style={{
          color: feedback.kind === 'err' ? 'var(--danger)' : 'var(--primary-700)',
          fontSize: 13,
          marginBottom: 8,
        }}>
          {feedback.text}
        </p>
      )}

      {/* Card: Resumo */}
      <section className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Resumo</h2>
          {(summaryData?.range?.from || summaryData?.range?.to) && (
            <span className="chip chip--static">
              {formatDate(summaryData?.range?.from)} – {formatDate(summaryData?.range?.to)}
            </span>
          )}
        </div>
        {summary.isLoading && <p>Carregando resumo…</p>}
        {summary.isError && (
          <div className="empty-state">
            <p>{messageOf(summary.error)}</p>
          </div>
        )}
        {summaryData && (
          <div className="kpi-grid">
            <div className="kpi">
              <span className="field-label">Cotações</span>
              <span className="kpi__value">{formatInt(summaryData.totals.quoteRequests)}</span>
            </div>
            <div className="kpi">
              <span className="field-label">Propostas</span>
              <span className="kpi__value">{formatInt(summaryData.totals.responses)}</span>
            </div>
            <div className="kpi">
              <span className="field-label">Comparações</span>
              <span className="kpi__value">{formatInt(summaryData.totals.comparisons)}</span>
            </div>
            <div className="kpi">
              <span className="field-label">Fornecedores</span>
              <span className="kpi__value">{formatInt(summaryData.totals.suppliers)}</span>
            </div>
            <div className="kpi">
              <span className="field-label">Taxa de adjudicação</span>
              <span className="kpi__value">{formatPercent(summaryData.awardRate.rate)}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                {formatInt(summaryData.awardRate.winners)} vencedoras em {formatInt(summaryData.awardRate.comparisons)} comparações
              </span>
            </div>
          </div>
        )}
        {summaryData && summaryData.totals.quoteRequests === 0 && summaryData.totals.responses === 0 && (
          <p className="empty-state" style={{ marginTop: 12 }}>Sem dados no período.</p>
        )}
      </section>

      {/* Card: Economia estimada */}
      <section className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Economia estimada</h2>
          {savingsData && (
            <span className="chip chip--static">{formatInt(savingsData.comparisons)} comparações</span>
          )}
        </div>
        {savings.isLoading && <p>Carregando economia…</p>}
        {savings.isError && (
          <div className="empty-state">
            <p>{messageOf(savings.error)}</p>
          </div>
        )}
        {savingsData && (
          <div className="kpi-grid">
            <div className="kpi">
              <span className="field-label">Economia absoluta</span>
              <span className="kpi__value">
                {formatCurrency(savingsData.absoluteSaving, savingsCurrency)}
              </span>
            </div>
            <div className="kpi">
              <span className="field-label">% médio de economia</span>
              <span className="kpi__value">{formatPercent(savingsData.averagePercentSaving)}</span>
            </div>
            <div className="kpi">
              <span className="field-label">Comparações analisadas</span>
              <span className="kpi__value">{formatInt(savingsData.comparisons)}</span>
            </div>
          </div>
        )}
        {savingsData && savingsData.items.length > 0 ? (
          <div style={{ marginTop: 16, overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Cotação</th>
                  <th>Produto</th>
                  <th>Fornecedor vencedor</th>
                  <th>Landed vencedor</th>
                  <th>Economia absoluta</th>
                  <th>% economia</th>
                </tr>
              </thead>
              <tbody>
                {savingsData.items.map((item: ReportSavingsItem) => (
                  <tr key={item.comparisonId}>
                    <td><strong>{item.requestCode}</strong></td>
                    <td>{item.productName}</td>
                    <td>Fornecedor #{item.winner.supplierId}</td>
                    <td>{formatCurrency(item.winner.landedCost, item.currency)}</td>
                    <td>{formatCurrency(item.absoluteSaving, item.currency)}</td>
                    <td>{formatPercent(item.percentSaving)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !savings.isLoading && !savings.isError && (
            <p className="empty-state">Sem dados no período.</p>
          )
        )}
      </section>

      {/* Card: Lead-time médio */}
      <section className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Lead-time médio</h2>
          {leadTimeData && (
            <span className="chip chip--static">{formatInt(leadTimeData.responses)} propostas</span>
          )}
        </div>
        {leadTime.isLoading && <p>Carregando lead-time…</p>}
        {leadTime.isError && (
          <div className="empty-state">
            <p>{messageOf(leadTime.error)}</p>
          </div>
        )}
        {leadTimeData && (
          <div className="kpi-grid">
            <div className="kpi">
              <span className="field-label">Lead-time médio geral</span>
              <span className="kpi__value">
                {formatNumberDays(leadTimeData.averageLeadTimeDays)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>em dias</span>
            </div>
          </div>
        )}
        {leadTimeData && leadTimeData.bySupplier.length > 0 ? (
          <div style={{ marginTop: 16, overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Lead-time médio</th>
                  <th>Propostas</th>
                </tr>
              </thead>
              <tbody>
                {leadTimeData.bySupplier.map((row: ReportLeadTimeSupplier) => (
                  <tr key={row.supplierId}>
                    <td><strong>{row.supplierName}</strong></td>
                    <td>{formatNumberDays(row.averageLeadTimeDays)} dias</td>
                    <td>{formatInt(row.responses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !leadTime.isLoading && !leadTime.isError && (
            <p className="empty-state">Sem dados no período.</p>
          )
        )}
      </section>

      {/* Card: Top fornecedores */}
      <section className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Top fornecedores</h2>
          {topSuppliersData && (
            <span className="chip chip--static">{formatInt(topSuppliersData.items.length)} ranqueados</span>
          )}
        </div>
        {topSuppliers.isLoading && <p>Carregando top fornecedores…</p>}
        {topSuppliers.isError && (
          <div className="empty-state">
            <p>{messageOf(topSuppliers.error)}</p>
          </div>
        )}
        {topSuppliersData && topSuppliersData.items.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Vitórias</th>
                  <th>Taxa de vitória</th>
                  <th>Score médio</th>
                  <th>Propostas</th>
                </tr>
              </thead>
              <tbody>
                {topSuppliersData.items.map((row: ReportTopSupplier) => (
                  <tr key={row.supplierId}>
                    <td>
                      <strong>{row.supplierName}</strong>
                      {row.country && (
                        <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--ink-soft)' }}>
                          {row.country}
                        </span>
                      )}
                    </td>
                    <td>{formatInt(row.wins)}</td>
                    <td>{formatPercent(row.winRate)}</td>
                    <td>{formatNumberScore(row.averageScore)}</td>
                    <td>{formatInt(row.responses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !topSuppliers.isLoading && !topSuppliers.isError && (
            <p className="empty-state">Sem dados no período.</p>
          )
        )}
      </section>

      {/* Card: Taxa de adjudicação */}
      <section className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Taxa de adjudicação</h2>
          {awardRateData && (
            <span className="chip chip--static">
              {formatInt(awardRateData.winners)} / {formatInt(awardRateData.comparisons)}
            </span>
          )}
        </div>
        {awardRate.isLoading && <p>Carregando taxa de adjudicação…</p>}
        {awardRate.isError && (
          <div className="empty-state">
            <p>{messageOf(awardRate.error)}</p>
          </div>
        )}
        {awardRateData && (
          <div className="kpi-grid">
            <div className="kpi">
              <span className="field-label">Taxa de adjudicação</span>
              <span className="kpi__value">{formatPercent(awardRateData.rate)}</span>
            </div>
            <div className="kpi">
              <span className="field-label">Comparações</span>
              <span className="kpi__value">{formatInt(awardRateData.comparisons)}</span>
            </div>
            <div className="kpi">
              <span className="field-label">Vencedoras</span>
              <span className="kpi__value">{formatInt(awardRateData.winners)}</span>
            </div>
          </div>
        )}
      </section>

      {/* F7: Card: Engajamento de fornecedores (taxa e tempo de resposta) */}
      <section className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Engajamento de fornecedores</h2>
          <span className="chip chip--static">taxa e tempo de resposta ao portal</span>
        </div>
        {engagement.isLoading && <p>Carregando engajamento…</p>}
        {engagement.isError && (
          <div className="empty-state">
            <p>{messageOf(engagement.error)}</p>
          </div>
        )}
        {engagement.data && engagement.data.items.length > 0 ? (
          <div style={{ marginTop: 8, overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Enviados</th>
                  <th>Respondidos</th>
                  <th>Taxa de resposta</th>
                  <th>Tempo médio</th>
                </tr>
              </thead>
              <tbody>
                {engagement.data.items.map((row: ReportSupplierEngagementItem) => (
                  <tr key={row.supplierId}>
                    <td><strong>{row.supplierName}</strong></td>
                    <td>{formatInt(row.tokensSent)}</td>
                    <td>{formatInt(row.tokensResponded)}</td>
                    <td>{formatPercent(row.responseRate)}</td>
                    <td>
                      {row.avgResponseHours === null
                        ? '—'
                        : row.avgResponseHours < 48
                          ? `${Math.round(row.avgResponseHours)} h`
                          : `${(row.avgResponseHours / 24).toFixed(1)} d`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !engagement.isLoading && !engagement.isError && (
            <p className="empty-state">Sem envios de portal no período.</p>
          )
        )}
      </section>
    </div>
  );
}

function formatNumberDays(value: number | undefined | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatNumberScore(value: number | undefined | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}