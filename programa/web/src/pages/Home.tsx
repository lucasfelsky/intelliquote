import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';

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

interface HelpArticle {
  id: number | string;
  title: string;
  category: string;
  readMinutes?: number;
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

  const help = useQuery({
    queryKey: ['help', 'list'],
    queryFn: () => api.get<HelpArticle[]>('/api/v1/help/articles'),
  });

  const totals = summary.data?.totals;
  const rate = awardRate.data?.rate ?? summary.data?.awardRate?.rate;
  const topItems = topSuppliers.data?.items?.slice(0, 5) ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Visão geral</p>
          <h1>Bem-vindo, {user?.name?.split(' ')[0] ?? 'usuário'}</h1>
          <p>Acompanhe o status das suas cotações, fornecedores e economia gerada.</p>
        </div>
      </div>

      <section className="kpi-grid">
        <article className="card kpi">
          <p className="eyebrow">Cotações</p>
          <strong className="kpi__value">{formatNumber(totals?.quoteRequests)}</strong>
          <small>{formatNumber(totals?.responses)} respostas recebidas</small>
        </article>
        <article className="card kpi">
          <p className="eyebrow">Comparações</p>
          <strong className="kpi__value">{formatNumber(totals?.comparisons)}</strong>
          <small>taxa de adjudicação: {typeof rate === 'number' ? `${rate}%` : '—'}</small>
        </article>
        <article className="card kpi">
          <p className="eyebrow">Fornecedores</p>
          <strong className="kpi__value">{formatNumber(totals?.suppliers)}</strong>
          <small>cadastrados e ativos</small>
        </article>
        <article className="card kpi">
          <p className="eyebrow">Economia gerada</p>
          <strong className="kpi__value">
            {formatCurrency(savings.data?.absoluteSaving, 'USD')}
          </strong>
          <small>
            {typeof savings.data?.averagePercentSaving === 'number'
              ? `${savings.data.averagePercentSaving}% em média por comparação`
              : 'sem dados no período'}
          </small>
        </article>
      </section>

      <section className="card">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h2>Top fornecedores</h2>
        </div>
        {topSuppliers.isLoading && <p>Carregando…</p>}
        {topSuppliers.isError && (
          <div className="empty-state">
            <p>Não foi possível carregar o ranking de fornecedores.</p>
          </div>
        )}
        {topSuppliers.data && topItems.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>País</th>
                <th>Respostas</th>
                <th>Vitórias</th>
                <th>Taxa</th>
                <th>Score médio</th>
              </tr>
            </thead>
            <tbody>
              {topItems.map((s) => (
                <tr key={s.supplierId}>
                  <td><strong>{s.supplierName}</strong></td>
                  <td>{s.country ?? '—'}</td>
                  <td>{s.responses}</td>
                  <td>{s.wins}</td>
                  <td>
                    <span className={`badge ${s.winRate >= 50 ? '' : 'badge--muted'}`}>
                      {s.winRate}%
                    </span>
                  </td>
                  <td>{s.averageScore.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !topSuppliers.isLoading && !topSuppliers.isError && (
            <p className="empty-state">Nenhuma resposta de fornecedor registrada ainda.</p>
          )
        )}
      </section>

      <section className="card">
        <h2>Artigos de ajuda</h2>
        {help.isLoading && <p>Carregando…</p>}
        {help.isError && <p className="empty-state">Sem artigos no momento.</p>}
        {help.data && help.data.length > 0 && (
          <ul className="help-list">
            {help.data.slice(0, 5).map((a) => (
              <li key={a.id}>
                <strong>{a.title}</strong>
                <span className="badge badge--muted" style={{ marginLeft: 8 }}>
                  {a.category}
                </span>
                {typeof a.readMinutes === 'number' && (
                  <small style={{ marginLeft: 8, color: 'var(--ink-soft)' }}>
                    {a.readMinutes} min de leitura
                  </small>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
