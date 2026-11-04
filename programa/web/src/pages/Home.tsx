import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon, type IconName } from '@/components/icons';

interface ReportSummary {
  totals?: {
    quoteRequests?: number;
    responses?: number;
    comparisons?: number;
    suppliers?: number;
  };
  awardRate?: {
    comparisons?: number;
    winners?: number;
    rate?: number;
  };
  range?: { from: string | null; to: string | null };
}

interface SavingsSummary {
  comparisons?: number;
  absoluteSaving?: number;
  averagePercentSaving?: number;
}

interface TopSupplier {
  supplierId: number;
  supplierName: string;
  country?: string | null;
  responses: number;
  wins: number;
  winRate: number;
  averageScore: number;
}

function formatNumber(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('pt-BR').format(value);
}

function formatCurrency(value: number | undefined, currency = 'USD'): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
}

function formatScore(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// Rotulo do KPI (o eyebrow de antes) com o icone em quadro (mock v68, Overview).
function KpiTopo({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className="kpi__topo">
      <span className="kpi__rotulo">{children}</span>
      <span className="kpi__icone" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
    </span>
  );
}

export default function Home() {
  const { user } = useAuth();

  const summary = useQuery({
    queryKey: ['reports', 'summary'],
    queryFn: () => api.get<ReportSummary>('/api/v1/reports/summary'),
  });

  const savings = useQuery({
    queryKey: ['reports', 'savings'],
    queryFn: () => api.get<SavingsSummary>('/api/v1/reports/savings'),
  });

  const topSuppliers = useQuery({
    queryKey: ['reports', 'top-suppliers'],
    queryFn: () => api.get<{ items: TopSupplier[] }>('/api/v1/reports/top-suppliers'),
  });

  const awardRate = useQuery({
    queryKey: ['reports', 'award-rate'],
    queryFn: () => api.get<{ rate: number; comparisons: number; winners: number }>('/api/v1/reports/award-rate'),
  });

  const totals = summary.data?.totals;
  const rate = awardRate.data?.rate ?? summary.data?.awardRate?.rate;
  const topItems = topSuppliers.data?.items?.slice(0, 5) ?? [];

  return (
    <div className="page overview-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Visão geral</p>
          <h1>Bem-vindo, {user?.name?.split(' ')[0] ?? 'usuário'}</h1>
          <p>Acompanhe o status das suas cotações, fornecedores e economia gerada.</p>
        </div>
      </div>

      <section className="kpi-grid" aria-label="Indicadores">
        <article className="kpi">
          <KpiTopo icon="cotacoes">Cotações</KpiTopo>
          <strong className="kpi__value">{formatNumber(totals?.quoteRequests)}</strong>
          <small>
            {formatNumber(totals?.responses)} {totals?.responses === 1 ? 'resposta recebida' : 'respostas recebidas'}
          </small>
        </article>
        <article className="kpi">
          <KpiTopo icon="relatorios">Comparações</KpiTopo>
          <strong className="kpi__value">{formatNumber(totals?.comparisons)}</strong>
          <small>taxa de adjudicação: {typeof rate === 'number' ? `${rate}%` : '—'}</small>
        </article>
        <article className="kpi">
          <KpiTopo icon="fornecedores">Fornecedores</KpiTopo>
          <strong className="kpi__value">{formatNumber(totals?.suppliers)}</strong>
          <small>cadastrados e ativos</small>
        </article>
        <article className="kpi">
          <KpiTopo icon="dollar">Economia gerada</KpiTopo>
          <strong className="kpi__value">
            {formatCurrency(savings.data?.absoluteSaving, 'USD')}
          </strong>
          <small>
            {typeof savings.data?.averagePercentSaving === 'number'
              ? `${formatNumber(savings.data.averagePercentSaving)}% em média por comparação`
              : 'sem dados no período'}
          </small>
        </article>
      </section>

      <section className="card overview-top">
        <div className="overview-top__cabecalho">
          <h2 className="overview-top__titulo">Top fornecedores</h2>
        </div>
        {topSuppliers.isLoading && (
          <p className="overview-carregando" role="status">
            <span className="btn-spinner" aria-hidden="true" />
            Carregando…
          </p>
        )}
        {topSuppliers.isError && (
          <div className="overview-estado">
            <div
              className="empty-state empty-state--erro"
              role="alert"
            >
              <span className="empty-state__icon">
                <Icon name="alert-triangle" size={24} strokeWidth={1.7} />
              </span>
              <strong className="empty-state__title">Não foi possível carregar o ranking.</strong>
              <p className="empty-state__text">Verifique sua conexão e tente novamente.</p>
              <button type="button" className="ghost-button" onClick={() => topSuppliers.refetch()}>
                <Icon name="refresh" size={14} strokeWidth={2} />
                Tentar novamente
              </button>
            </div>
          </div>
        )}
        {topSuppliers.data && topItems.length > 0 ? (
          <div className="table-wrapper">
            <table className="table overview-tabela">
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>País</th>
                  <th className="overview-num">Respostas</th>
                  <th className="overview-num">Vitórias</th>
                  <th>Taxa</th>
                  <th className="overview-num">Score médio</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map((s) => (
                  <tr key={s.supplierId}>
                    <td><strong>{s.supplierName}</strong></td>
                    <td className="overview-pais">{s.country ?? '—'}</td>
                    <td className="overview-num overview-mono">{s.responses}</td>
                    <td className="overview-num overview-mono">{s.wins}</td>
                    <td>
                      <span className={`badge overview-taxa ${s.winRate >= 50 ? '' : 'badge--muted'}`}>
                        {s.winRate}%
                      </span>
                    </td>
                    <td className="overview-num overview-mono overview-score">{formatScore(s.averageScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !topSuppliers.isLoading && !topSuppliers.isError && (
            <div className="overview-estado">
              <div className="empty-state">
                <span className="empty-state__icon">
                  <Icon name="fornecedores" size={36} strokeWidth={1.5} />
                </span>
                <strong className="empty-state__title">Nenhuma resposta de fornecedor registrada ainda.</strong>
              </div>
            </div>
          )
        )}
      </section>
    </div>
  );
}
