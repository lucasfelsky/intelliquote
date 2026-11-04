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
import StarRating from '@/components/StarRating';
import { Icon } from '@/components/icons';

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
    <div className="page relatorios-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operação</p>
          <h1>Relatórios</h1>
          <p>Acompanhe os indicadores operacionais do IntelliQuote.</p>
        </div>
        <div className="page-header__actions">
          <div className="relatorios-campo">
            <label className="field-label" htmlFor="reports-from">De</label>
            <input
              id="reports-from"
              className="input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="relatorios-campo">
            <label className="field-label" htmlFor="reports-to">Até</label>
            <input
              id="reports-to"
              className="input"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
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
            <Icon name="refresh" size={16} />
            Atualizar
          </button>
        </div>
      </div>

      {feedback && (
        <p
          className={`relatorios-feedback ${feedback.kind === 'err' ? 'relatorios-feedback--erro' : ''}`}
          role={feedback.kind === 'err' ? 'alert' : 'status'}
        >
          <Icon name={feedback.kind === 'err' ? 'alert-circle' : 'check'} size={14} strokeWidth={2.2} />
          {feedback.text}
        </p>
      )}

      {/* Card: Resumo */}
      <section className="card relatorios-cartao" aria-labelledby="r-resumo">
        <div className="relatorios-cartao__cabecalho">
          <h2 id="r-resumo" className="relatorios-cartao__titulo">Resumo</h2>
          {(summaryData?.range?.from || summaryData?.range?.to) && (
            <span className="chip chip--static relatorios-chip relatorios-chip--mono">
              {formatDate(summaryData?.range?.from)} – {formatDate(summaryData?.range?.to)}
            </span>
          )}
        </div>
        {summary.isLoading && (
          <p className="relatorios-carregando" role="status">
            <span className="btn-spinner" aria-hidden="true" />
            Carregando resumo…
          </p>
        )}
        {summary.isError && <p className="alert alert--error" role="alert">{messageOf(summary.error)}</p>}
        {summaryData && (
          <div className="kpi-grid kpi-grid--resumo">
            <div className="kpi">
              <span className="kpi__rotulo">Cotações</span>
              <span className="kpi__value">{formatInt(summaryData.totals.quoteRequests)}</span>
            </div>
            <div className="kpi">
              <span className="kpi__rotulo">Propostas</span>
              <span className="kpi__value">{formatInt(summaryData.totals.responses)}</span>
            </div>
            <div className="kpi">
              <span className="kpi__rotulo">Comparações</span>
              <span className="kpi__value">{formatInt(summaryData.totals.comparisons)}</span>
            </div>
            <div className="kpi">
              <span className="kpi__rotulo">Fornecedores</span>
              <span className="kpi__value">{formatInt(summaryData.totals.suppliers)}</span>
            </div>
            <div className="kpi kpi--destaque">
              <span className="kpi__rotulo">Taxa de adjudicação</span>
              <span className="kpi__value">{formatPercent(summaryData.awardRate.rate)}</span>
              <span className="kpi__legenda">
                <span className="relatorios-mono">{formatInt(summaryData.awardRate.winners)}</span> vencedoras em{' '}
                <span className="relatorios-mono">{formatInt(summaryData.awardRate.comparisons)}</span> comparações
              </span>
            </div>
          </div>
        )}
        {summaryData && summaryData.totals.quoteRequests === 0 && summaryData.totals.responses === 0 && (
          <p className="relatorios-vazio">Sem dados no período.</p>
        )}
      </section>

      {/* Card: Economia estimada */}
      <section className="card relatorios-cartao" aria-labelledby="r-economia">
        <div className="relatorios-cartao__cabecalho">
          <h2 id="r-economia" className="relatorios-cartao__titulo">Economia estimada</h2>
          {savingsData && (
            <span className="chip chip--static relatorios-chip">
              <span className="relatorios-mono">{formatInt(savingsData.comparisons)}</span> comparações
            </span>
          )}
        </div>
        {savings.isLoading && (
          <p className="relatorios-carregando" role="status">
            <span className="btn-spinner" aria-hidden="true" />
            Carregando economia…
          </p>
        )}
        {savings.isError && <p className="alert alert--error" role="alert">{messageOf(savings.error)}</p>}
        {savingsData && (
          <div className="kpi-grid kpi-grid--economia">
            <div className="kpi kpi--destaque">
              <span className="kpi__rotulo">Economia absoluta</span>
              <span className="kpi__value">
                {formatCurrency(savingsData.absoluteSaving, savingsCurrency)}
              </span>
            </div>
            <div className="kpi">
              <span className="kpi__rotulo">% médio de economia</span>
              <span className="kpi__value">{formatPercent(savingsData.averagePercentSaving)}</span>
            </div>
            <div className="kpi">
              <span className="kpi__rotulo">Comparações analisadas</span>
              <span className="kpi__value">{formatInt(savingsData.comparisons)}</span>
            </div>
          </div>
        )}
        {savingsData && savingsData.items.length > 0 ? (
          <div className="table-wrapper relatorios-tabela">
            <table className="table relatorios-tabela__tabela relatorios-tabela__tabela--economia">
              <thead>
                <tr>
                  <th>Cotação</th>
                  <th>Produto</th>
                  <th>Fornecedor vencedor</th>
                  <th className="relatorios-num">Landed vencedor</th>
                  <th className="relatorios-num">Economia absoluta</th>
                  <th className="relatorios-num">% economia</th>
                </tr>
              </thead>
              <tbody>
                {savingsData.items.map((item: ReportSavingsItem) => (
                  <tr key={item.comparisonId}>
                    <td className="relatorios-codigo">{item.requestCode}</td>
                    <td>{item.productName}</td>
                    <td className="relatorios-suave">
                      Fornecedor <span className="relatorios-mono">#{item.winner.supplierId}</span>
                    </td>
                    <td className="relatorios-num relatorios-mono relatorios-valor">
                      {formatCurrency(item.winner.landedCost, item.currency)}
                    </td>
                    <td className="relatorios-num relatorios-mono relatorios-valor relatorios-ganho">
                      {formatCurrency(item.absoluteSaving, item.currency)}
                    </td>
                    <td className="relatorios-num relatorios-mono relatorios-ganho">{formatPercent(item.percentSaving)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !savings.isLoading && !savings.isError && (
            <p className="relatorios-vazio">Sem dados no período.</p>
          )
        )}
      </section>

      <div className="relatorios-linha">
        {/* Card: Lead-time médio */}
        <section className="card relatorios-cartao" aria-labelledby="r-lead">
          <div className="relatorios-cartao__cabecalho">
            <h2 id="r-lead" className="relatorios-cartao__titulo">Lead-time médio</h2>
            {leadTimeData && (
              <span className="chip chip--static relatorios-chip">
                <span className="relatorios-mono">{formatInt(leadTimeData.responses)}</span> propostas
              </span>
            )}
          </div>
          {leadTime.isLoading && (
            <p className="relatorios-carregando" role="status">
              <span className="btn-spinner" aria-hidden="true" />
              Carregando lead-time…
            </p>
          )}
          {leadTime.isError && <p className="alert alert--error" role="alert">{messageOf(leadTime.error)}</p>}
          {leadTimeData && (
            <div className="kpi-grid kpi-grid--lead">
              <div className="kpi">
                <span className="kpi__rotulo">Lead-time médio geral</span>
                <span className="kpi__value">
                  {formatNumberDays(leadTimeData.averageLeadTimeDays)}
                </span>
                <span className="kpi__legenda">em dias</span>
              </div>
            </div>
          )}
          {leadTimeData && leadTimeData.bySupplier.length > 0 ? (
            <div className="table-wrapper relatorios-tabela">
              <table className="table relatorios-tabela__tabela relatorios-tabela__tabela--lead">
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th className="relatorios-num">Lead-time médio</th>
                    <th className="relatorios-num">Propostas</th>
                  </tr>
                </thead>
                <tbody>
                  {leadTimeData.bySupplier.map((row: ReportLeadTimeSupplier) => (
                    <tr key={row.supplierId}>
                      <td className="relatorios-nome">{row.supplierName}</td>
                      <td className="relatorios-num relatorios-nowrap">
                        <span className="relatorios-mono">{formatNumberDays(row.averageLeadTimeDays)}</span> dias
                      </td>
                      <td className="relatorios-num relatorios-mono">{formatInt(row.responses)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !leadTime.isLoading && !leadTime.isError && (
              <p className="relatorios-vazio">Sem dados no período.</p>
            )
          )}
        </section>

        {/* Card: Top fornecedores */}
        <section className="card relatorios-cartao" aria-labelledby="r-top">
          <div className="relatorios-cartao__cabecalho">
            <h2 id="r-top" className="relatorios-cartao__titulo">Top fornecedores</h2>
            {topSuppliersData && (
              <span className="chip chip--static relatorios-chip">
                <span className="relatorios-mono">{formatInt(topSuppliersData.items.length)}</span> ranqueados
              </span>
            )}
          </div>
          {topSuppliers.isLoading && (
            <p className="relatorios-carregando" role="status">
              <span className="btn-spinner" aria-hidden="true" />
              Carregando top fornecedores…
            </p>
          )}
          {topSuppliers.isError && <p className="alert alert--error" role="alert">{messageOf(topSuppliers.error)}</p>}
          {topSuppliersData && topSuppliersData.items.length > 0 ? (
            <div className="table-wrapper relatorios-tabela">
              <table className="table relatorios-tabela__tabela relatorios-tabela__tabela--compacta">
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th className="relatorios-num">Vitórias</th>
                    <th className="relatorios-num">Taxa de vitória</th>
                    <th className="relatorios-num">Score médio</th>
                    <th>Avaliação</th>
                    <th className="relatorios-num">Propostas</th>
                  </tr>
                </thead>
                <tbody>
                  {topSuppliersData.items.map((row: ReportTopSupplier) => (
                    <tr key={row.supplierId}>
                      <td>
                        <strong>{row.supplierName}</strong>
                        {row.country && <span className="relatorios-pais">{row.country}</span>}
                      </td>
                      <td className="relatorios-num relatorios-mono">{formatInt(row.wins)}</td>
                      <td className="relatorios-num relatorios-mono">{formatPercent(row.winRate)}</td>
                      <td className="relatorios-num relatorios-mono">{formatNumberScore(row.averageScore)}</td>
                      <td className="relatorios-nowrap">
                        {row.avgRating !== null && row.reviewCount > 0 ? (
                          <span className="relatorios-avaliacao">
                            <StarRating value={row.avgRating} readOnly showValue />
                            <span className="relatorios-avaliacao__n">
                              (<span className="relatorios-mono">{row.reviewCount}</span>)
                            </span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="relatorios-num relatorios-mono">{formatInt(row.responses)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !topSuppliers.isLoading && !topSuppliers.isError && (
              <p className="relatorios-vazio">Sem dados no período.</p>
            )
          )}
        </section>
      </div>

      <div className="relatorios-linha relatorios-linha--topo">
        {/* Card: Taxa de adjudicação */}
        <section className="card relatorios-cartao" aria-labelledby="r-adj">
          <div className="relatorios-cartao__cabecalho">
            <h2 id="r-adj" className="relatorios-cartao__titulo">Taxa de adjudicação</h2>
            {awardRateData && (
              <span className="chip chip--static relatorios-chip relatorios-chip--mono">
                {formatInt(awardRateData.winners)} / {formatInt(awardRateData.comparisons)}
              </span>
            )}
          </div>
          {awardRate.isLoading && (
            <p className="relatorios-carregando" role="status">
              <span className="btn-spinner" aria-hidden="true" />
              Carregando taxa de adjudicação…
            </p>
          )}
          {awardRate.isError && <p className="alert alert--error" role="alert">{messageOf(awardRate.error)}</p>}
          {awardRateData && (
            <div className="kpi-grid kpi-grid--adjudicacao">
              <div className="kpi kpi--destaque">
                <span className="kpi__rotulo">Taxa de adjudicação</span>
                <span className="kpi__value">{formatPercent(awardRateData.rate)}</span>
              </div>
              <div className="kpi">
                <span className="kpi__rotulo">Comparações</span>
                <span className="kpi__value">{formatInt(awardRateData.comparisons)}</span>
              </div>
              <div className="kpi">
                <span className="kpi__rotulo">Vencedoras</span>
                <span className="kpi__value">{formatInt(awardRateData.winners)}</span>
              </div>
            </div>
          )}
        </section>

        {/* F7: Card: Engajamento de fornecedores (taxa e tempo de resposta) */}
        <section className="card relatorios-cartao" aria-labelledby="r-eng">
          <div className="relatorios-cartao__cabecalho">
            <h2 id="r-eng" className="relatorios-cartao__titulo">Engajamento de fornecedores</h2>
            <span className="chip chip--static relatorios-chip">taxa e tempo de resposta ao portal</span>
          </div>
          {engagement.isLoading && (
            <p className="relatorios-carregando" role="status">
              <span className="btn-spinner" aria-hidden="true" />
              Carregando engajamento…
            </p>
          )}
          {engagement.isError && <p className="alert alert--error" role="alert">{messageOf(engagement.error)}</p>}
          {engagement.data && engagement.data.items.length > 0 ? (
            <div className="table-wrapper relatorios-tabela">
              <table className="table relatorios-tabela__tabela relatorios-tabela__tabela--compacta">
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th className="relatorios-num">Enviados</th>
                    <th className="relatorios-num">Respondidos</th>
                    <th className="relatorios-num">Taxa de resposta</th>
                    <th className="relatorios-num">Tempo médio</th>
                  </tr>
                </thead>
                <tbody>
                  {engagement.data.items.map((row: ReportSupplierEngagementItem) => (
                    <tr key={row.supplierId}>
                      <td className="relatorios-nome">{row.supplierName}</td>
                      <td className="relatorios-num relatorios-mono">{formatInt(row.tokensSent)}</td>
                      <td className="relatorios-num relatorios-mono">{formatInt(row.tokensResponded)}</td>
                      <td className="relatorios-num relatorios-mono">{formatPercent(row.responseRate)}</td>
                      <td className="relatorios-num relatorios-mono">
                        {row.avgResponseHours === null
                          ? '—'
                          : row.avgResponseHours < 48
                            ? `${Math.round(row.avgResponseHours)} h`
                            : `${formatNumberDays(row.avgResponseHours / 24)} d`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !engagement.isLoading && !engagement.isError && (
              <p className="relatorios-vazio">Sem envios de portal no período.</p>
            )
          )}
        </section>
      </div>
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