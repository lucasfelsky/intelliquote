import { useConfirm } from '@/components/useConfirm';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { Pagination } from '@/components/Pagination';

type QuoteStatus = 'open' | 'closed';
type Incoterm = 'EXW' | 'FCA' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP';

interface QuoteRequest {
  id: number;
  requestCode: string;
  description: string | null;
  desiredIncoterm: Incoterm[];
  currency: string;
  deadlineAt: string | null;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  reopenedAt: string | null;
  purchaseOrderSentAt: string | null;
  createdById: number | null;
  isDevelopment: boolean;
  _count?: { quoteResponses?: number; items?: number };
}

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const;

const PAGE_SIZE = 50;

interface QuoteRequestsPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

type StatusFilter = 'todas' | 'abertas' | 'fechadas';
type PoFilter = 'todas' | 'enviada' | 'nao-enviada';

const MONTH_LABELS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Mês atual + 11 anteriores no fuso de São Paulo (valor AAAA-MM, igual ao `month` da API).
function lastMonthsSaoPaulo(now: Date, count = 12): { value: string; label: string }[] {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  let year = Number(parts.find((p) => p.type === 'year')?.value);
  let month = Number(parts.find((p) => p.type === 'month')?.value);
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      value: `${year}-${String(month).padStart(2, '0')}`,
      label: `${MONTH_LABELS[month - 1]}/${year}`,
    });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

// Data local dd/mm/aaaa (formatacao local; nunca converter para UTC, que vira o dia anterior em BRT).
function formatPoSentDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// Data dd/mm/aaaa no fuso de Sao Paulo, independente do fuso do navegador.
function formatSaoPauloDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatNumber(value: number | undefined | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR');
}

function asIncoterm(value: unknown): Incoterm {
  const v = String(value ?? '');
  return (INCOTERMS as readonly string[]).includes(v) ? (v as Incoterm) : 'EXW';
}

function asIncoterms(value: unknown): Incoterm[] {
  const arr = Array.isArray(value) ? value : [];
  const parsed = arr.map(asIncoterm).filter((t, i, self) => self.indexOf(t) === i);
  return parsed.length > 0 ? parsed : ['EXW'];
}

function normalize(qr: unknown): QuoteRequest {
  if (typeof qr !== 'object' || qr === null) {
    throw new Error('Resposta inesperada do servidor.');
  }
  const obj = qr as Record<string, unknown>;
  const countObj = obj._count as { quoteResponses?: number; items?: number } | undefined;
  return {
    id: Number(obj.id),
    requestCode: String(obj.requestCode ?? ''),
    description: (obj.description as string | null) ?? null,
    desiredIncoterm: asIncoterms(obj.desiredIncoterm),
    currency: String(obj.currency ?? 'USD'),
    deadlineAt: (obj.deadlineAt as string | null) ?? null,
    status: (obj.status as QuoteStatus) ?? 'open',
    createdAt: String(obj.createdAt ?? ''),
    updatedAt: String(obj.updatedAt ?? ''),
    closedAt: (obj.closedAt as string | null) ?? null,
    reopenedAt: (obj.reopenedAt as string | null) ?? null,
    purchaseOrderSentAt: (obj.purchaseOrderSentAt as string | null) ?? null,
    createdById: typeof obj.createdById === 'number' ? obj.createdById : null,
    isDevelopment: obj.isDevelopment === true,
    _count: countObj
      ? {
          quoteResponses: typeof countObj.quoteResponses === 'number' ? countObj.quoteResponses : 0,
          items: typeof countObj.items === 'number' ? countObj.items : 0,
        }
      : undefined,
  };
}

export default function Cotacoes() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todas');
  const [incotermFilter, setIncotermFilter] = useState<Incoterm | 'todos'>('todos');
  const [poFilter, setPoFilter] = useState<PoFilter>('todas');
  const [monthFilter, setMonthFilter] = useState<string>('todos');
  const [monthOptions] = useState(() => lastMonthsSaoPaulo(new Date()));
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const canCreate = user?.role === 'admin' || user?.role === 'comprador';
  const canDelete = user?.role === 'admin' || user?.role === 'comprador';

  const list = useQuery({
    queryKey: [
      'quote-requests',
      {
        search,
        status: statusFilter,
        incoterm: incotermFilter,
        poSent: poFilter,
        month: monthFilter,
        page,
      },
    ],
    // Volta atualizada (PO enviada no detalhe) sem invalidar de dentro do modal.
    refetchOnMount: 'always',
    queryFn: async () => {
      const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
      if (search.trim()) params.search = search.trim();
      if (statusFilter !== 'todas') params.status = statusFilter === 'abertas' ? 'open' : 'closed';
      if (incotermFilter !== 'todos') params.incoterm = incotermFilter;
      if (poFilter !== 'todas') params.poSent = poFilter === 'enviada' ? 'true' : 'false';
      if (monthFilter !== 'todos') params.month = monthFilter;
      const data = await api.get<unknown>(`/v1/quote-requests`, params);
      return { items: unwrapList(data).map(normalize), pagination: readPagination(data) };
    },
    placeholderData: keepPreviousData,
  });

  const rows = list.data?.items ?? [];
  const hasFilters =
    search.trim() !== '' ||
    statusFilter !== 'todas' ||
    incotermFilter !== 'todos' ||
    poFilter !== 'todas' ||
    monthFilter !== 'todos';
  const totalItems = list.data?.pagination?.totalItems ?? rows.length;
  const totalPages = list.data?.pagination?.totalPages ?? 1;

  useEffect(() => {
    const tp = list.data?.pagination?.totalPages;
    if (tp && page > tp) setPage(tp);
  }, [list.data, page]);

  const reopen = useMutation({
    mutationFn: (id: number) => api.post<unknown>(`/v1/quote-requests/${id}/reopen`, {}),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['quote-requests'] });
      qc.invalidateQueries({ queryKey: ['quote-request'] });
    },
    onError: (err) => setActionError(messageOf(err)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.del<void>(`/v1/quote-requests/${id}`),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['quote-requests'] });
    },
    onError: (err) => setActionError(messageOf(err)),
  });

  return (
    <div className="page cotacoes-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Compras</p>
          <h1>Cotações</h1>
          <p>Gerencie as cotações em andamento e as já fechadas.</p>
        </div>
        {canCreate && (
          <div className="page-header__actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => navigate('/cotacoes/nova')}
            >
              <Icon name="plus" size={16} strokeWidth={2.2} />
              Nova cotação
            </button>
          </div>
        )}
      </div>

      <section className="cotacoes-filtros" aria-label="Filtros">
        <div className="cotacoes-filtro cotacoes-filtro--busca">
          <label className="cotacoes-filtro__rotulo" htmlFor="cotacoesBusca">Buscar</label>
          <div className="cotacoes-busca">
            <Icon name="search" size={16} />
            <input
              id="cotacoesBusca"
              className="cotacoes-busca__campo"
              placeholder="Buscar por código ou produto"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="cotacoes-filtro">
          <label className="cotacoes-filtro__rotulo" htmlFor="cotacoesStatus">Status</label>
          <select
            id="cotacoesStatus"
            className="select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setPage(1);
            }}
          >
            <option value="todas">Todas</option>
            <option value="abertas">Abertas</option>
            <option value="fechadas">Fechadas</option>
          </select>
        </div>
        <div className="cotacoes-filtro">
          <label className="cotacoes-filtro__rotulo" htmlFor="cotacoesIncoterm">Incoterm</label>
          <select
            id="cotacoesIncoterm"
            className="select"
            value={incotermFilter}
            onChange={(e) => {
              setIncotermFilter(e.target.value as Incoterm | 'todos');
              setPage(1);
            }}
          >
            <option value="todos">Incoterm: todos</option>
            {INCOTERMS.map((t) => (
              <option key={t} value={t}>Incoterm: {t}</option>
            ))}
          </select>
        </div>
        <div className="cotacoes-filtro">
          <label className="cotacoes-filtro__rotulo" htmlFor="cotacoesPo">PO</label>
          <select
            id="cotacoesPo"
            className="select"
            aria-label="Filtro de PO enviada"
            value={poFilter}
            onChange={(e) => {
              setPoFilter(e.target.value as PoFilter);
              setPage(1);
            }}
          >
            <option value="todas">PO: todas</option>
            <option value="enviada">PO enviada</option>
            <option value="nao-enviada">PO não enviada</option>
          </select>
        </div>
        <div className="cotacoes-filtro">
          <label className="cotacoes-filtro__rotulo" htmlFor="cotacoesMes">Mês</label>
          <select
            id="cotacoesMes"
            className="select"
            aria-label="Filtro de mês"
            value={monthFilter}
            onChange={(e) => {
              setMonthFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="todos">Mês: todos</option>
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>Mês: {m.label}</option>
            ))}
          </select>
        </div>
      </section>

      {actionError && (
        <p className="alert alert--error" role="alert">{actionError}</p>
      )}

      {list.isLoading ? (
        <section className="card cotacoes-tabela-card" aria-busy="true">
          <div className="cotacoes-carregando" role="status">
            <span className="btn-spinner" aria-hidden="true" />
            Carregando cotações…
          </div>
          <div className="cotacoes-skeleton__cab" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6].map((k) => (
              <div key={k} className="cotacoes-skeleton__linha">
                <span className="skeleton cotacoes-skeleton__id" />
                <span className="skeleton cotacoes-skeleton__texto" />
                <span className="cotacoes-skeleton__selos">
                  <span className="skeleton cotacoes-skeleton__selo" />
                  <span className="skeleton cotacoes-skeleton__selo" />
                </span>
                <span className="skeleton cotacoes-skeleton__num" />
                <span className="skeleton cotacoes-skeleton__status" />
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="card cotacoes-tabela-card">
          {list.isError && (
            <div className="cotacoes-estado">
              <div
                className="empty-state empty-state--erro"
                role="alert"
              >
                <span className="empty-state__icon">
                  <Icon name="alert-triangle" size={24} strokeWidth={1.7} />
                </span>
                <strong className="empty-state__title">Não foi possível carregar as cotações.</strong>
                <p className="empty-state__text">Verifique sua conexão e tente novamente.</p>
                <button type="button" className="ghost-button" onClick={() => list.refetch()}>
                  <Icon name="refresh" size={14} strokeWidth={2} />
                  Tentar novamente
                </button>
              </div>
            </div>
          )}
          {list.data && rows.length === 0 && (
            <div className="cotacoes-estado">
              <div className="empty-state">
                <span className="empty-state__icon">
                  <Icon name="filter" size={36} strokeWidth={1.5} />
                </span>
                <strong className="empty-state__title">Nenhuma cotação encontrada</strong>
                <p className="empty-state__text">
                  {hasFilters
                    ? 'Ajuste ou limpe os filtros para ver outras cotações.'
                    : canCreate
                      ? 'Use o botão “Nova cotação” para começar.'
                      : 'Aguarde o cadastro de novas cotações.'}
                </p>
              </div>
            </div>
          )}
          {list.data && rows.length > 0 && (
            <>
              <div className="table-wrapper">
                <table className="table cotacoes-tabela">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Código</th>
                      <th>Incoterm desejado</th>
                      <th className="cotacoes-dir">Itens</th>
                      <th className="cotacoes-dir">Respostas</th>
                      <th>PO</th>
                      <th className="col-status">Status</th>
                      <th className="cotacoes-dir">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((qr) => (
                      <tr key={qr.id}>
                        <td className="cotacoes-id">{qr.id}</td>
                        <td className="cell-nowrap">
                          <span className="cotacoes-codigo">{qr.requestCode}</span>
                          {qr.isDevelopment && (
                            <>
                              {' '}
                              <span className="badge badge--info">Desenvolvimento</span>
                            </>
                          )}
                        </td>
                        <td>
                          <div className="chip-row">
                            {qr.desiredIncoterm.map((t) => (
                              <span key={t} className="chip chip--static">{t}</span>
                            ))}
                          </div>
                        </td>
                        <td className="cotacoes-dir cotacoes-num">{formatNumber(qr._count?.items)}</td>
                        <td className="cotacoes-dir cotacoes-num">{formatNumber(qr._count?.quoteResponses)}</td>
                        <td>
                          {qr.purchaseOrderSentAt ? (
                            <span
                              className="badge badge--info badge--dot"
                              title={`PO enviada em ${formatPoSentDate(qr.purchaseOrderSentAt)}`}
                              aria-label={`PO enviada em ${formatPoSentDate(qr.purchaseOrderSentAt)}`}
                            >
                              PO enviada
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="col-status">
                          {/* Reaberta substitui o "Aberta" (ela tambem esta aberta). */}
                          {qr.status === 'open' && qr.reopenedAt ? (
                            <span
                              className="badge badge--warning badge--dot"
                              title={`Reaberta em ${formatSaoPauloDate(qr.reopenedAt)}`}
                            >
                              Reaberta
                              <span className="sr-only"> em {formatSaoPauloDate(qr.reopenedAt)}</span>
                            </span>
                          ) : (
                            <span className={`badge badge--dot${qr.status === 'closed' ? ' badge--muted' : ''}`}>
                              {qr.status === 'open' ? 'Aberta' : 'Fechada'}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions row-actions--nowrap">
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => navigate(`/cotacoes/${qr.id}`)}
                            >
                              Ver
                            </button>
                            {canCreate && qr.status === 'open' && (
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => navigate(`/cotacoes/${qr.id}`, { state: { edit: true } })}
                              >
                                Editar
                              </button>
                            )}
                            {(user?.role === 'admin' || user?.role === 'gestor') && qr.status === 'closed' && (
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={async () => {
                                  if (await confirm(`Reabrir a cotação ${qr.requestCode}?`)) {
                                    reopen.mutate(qr.id);
                                  }
                                }}
                                disabled={reopen.isPending}
                              >
                                Reabrir
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                className="ghost-button danger-button"
                                onClick={async () => {
                                  const cascade = qr._count?.quoteResponses ?? 0;
                                  const msg = cascade > 0
                                    ? `Apagar a cotação ${qr.requestCode}? Todas as ${cascade} resposta(s) e os itens associados também serão removidas. Esta ação não pode ser desfeita.`
                                    : `Apagar a cotação ${qr.requestCode}? Esta ação não pode ser desfeita.`;
                                  if (await confirm(msg)) {
                                    remove.mutate(qr.id);
                                  }
                                }}
                                disabled={remove.isPending}
                              >
                                Apagar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={totalItems}
                itemLabel={{ singular: 'cotação', plural: 'cotações' }}
                onPrevious={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}

function unwrapList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as { data?: unknown; items?: unknown };
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.items)) return obj.items;
  }
  return [];
}

function readPagination(data: unknown): QuoteRequestsPagination | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const p = (data as { pagination?: unknown }).pagination as Partial<QuoteRequestsPagination> | null | undefined;
  if (!p || typeof p !== 'object') return null;
  const { page, pageSize, totalItems, totalPages } = p;
  if (
    typeof page !== 'number' ||
    typeof pageSize !== 'number' ||
    typeof totalItems !== 'number' ||
    typeof totalPages !== 'number'
  ) {
    return null;
  }
  return { page, pageSize, totalItems, totalPages };
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}