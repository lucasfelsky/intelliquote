import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';

type QuoteStatus = 'open' | 'closed';
type Incoterm = 'EXW' | 'FCA' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP';

interface QuoteRequest {
  id: number;
  requestCode: string;
  productName: string;
  quantity: number;
  description: string | null;
  desiredIncoterm: Incoterm[];
  currency: string;
  deadlineAt: string | null;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  createdById: number | null;
  _count?: { quoteResponses?: number; items?: number };
}

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const;

type StatusFilter = 'todas' | 'abertas' | 'fechadas';

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
    productName: String(obj.productName ?? ''),
    quantity: Number(obj.quantity ?? 0),
    description: (obj.description as string | null) ?? null,
    desiredIncoterm: asIncoterms(obj.desiredIncoterm),
    currency: String(obj.currency ?? 'USD'),
    deadlineAt: (obj.deadlineAt as string | null) ?? null,
    status: (obj.status as QuoteStatus) ?? 'open',
    createdAt: String(obj.createdAt ?? ''),
    updatedAt: String(obj.updatedAt ?? ''),
    closedAt: (obj.closedAt as string | null) ?? null,
    createdById: typeof obj.createdById === 'number' ? obj.createdById : null,
    _count: countObj
      ? {
          quoteResponses: typeof countObj.quoteResponses === 'number' ? countObj.quoteResponses : 0,
          items: typeof countObj.items === 'number' ? countObj.items : 0,
        }
      : undefined,
  };
}

export default function Cotacoes() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todas');
  const [incotermFilter, setIncotermFilter] = useState<Incoterm | 'todos'>('todos');
  const [actionError, setActionError] = useState<string | null>(null);

  const canCreate = user?.role === 'admin' || user?.role === 'comprador';
  const canDelete = user?.role === 'admin' || user?.role === 'comprador';

  const list = useQuery({
    queryKey: ['quote-requests', { search, status: statusFilter, incoterm: incotermFilter }],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (statusFilter !== 'todas') params.status = statusFilter === 'abertas' ? 'open' : 'closed';
      if (incotermFilter !== 'todos') params.incoterm = incotermFilter;
      const data = await api.get<unknown>(`/v1/quote-requests`, params);
      const items = unwrapList(data);
      return items.map(normalize);
    },
  });

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
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Compras</p>
          <h1>Cotações</h1>
          <p>Gerencie as cotações em andamento e as já fechadas.</p>
        </div>
        <div className="page-header__actions">
          <input
            className="input"
            placeholder="Buscar por código ou produto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <select
            className="select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{ maxWidth: 160 }}
          >
            <option value="todas">Todas</option>
            <option value="abertas">Abertas</option>
            <option value="fechadas">Fechadas</option>
          </select>
          <select
            className="select"
            value={incotermFilter}
            onChange={(e) => setIncotermFilter(e.target.value as Incoterm | 'todos')}
            style={{ maxWidth: 160 }}
          >
            <option value="todos">Incoterm: todos</option>
            {INCOTERMS.map((t) => (
              <option key={t} value={t}>Incoterm: {t}</option>
            ))}
          </select>
          {canCreate && (
            <button
              type="button"
              className="primary-button"
              onClick={() => navigate('/cotacoes/nova')}
            >
              + Nova cotação
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{actionError}</p>
      )}

      <section className="card">
        {list.isLoading && <p>Carregando cotações…</p>}
        {list.isError && (
          <div className="empty-state">
            <p>Não foi possível carregar as cotações.</p>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              Verifique sua conexão e tente novamente.
            </p>
          </div>
        )}
        {list.data && list.data.length === 0 && !list.isLoading && (
          <div className="empty-state">
            <strong>Nenhuma cotação encontrada</strong>
            <p>
              {canCreate
                ? 'Use o botão “Nova cotação” para começar.'
                : 'Aguarde o cadastro de novas cotações.'}
            </p>
          </div>
        )}
        {list.data && list.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Código</th>
                <th>Produto</th>
                <th>Qtd</th>
                <th>Incoterm desejado</th>
                <th>Itens</th>
                <th>Respostas</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((qr) => (
                <tr
                  key={qr.id}
                  onClick={() => navigate(`/cotacoes/${qr.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{qr.id}</td>
                  <td><strong>{qr.requestCode}</strong></td>
                  <td>{qr.productName}</td>
                  <td>{formatNumber(qr.quantity)}</td>
                  <td>
                    <div className="chip-row">
                      {qr.desiredIncoterm.map((t) => (
                        <span key={t} className="chip" style={{ cursor: 'default' }}>{t}</span>
                      ))}
                    </div>
                  </td>
                  <td>{formatNumber(qr._count?.items)}</td>
                  <td>{formatNumber(qr._count?.quoteResponses)}</td>
                  <td>
                    <span className={`badge${qr.status === 'closed' ? ' badge--muted' : ''}`}>
                      {qr.status === 'open' ? 'Aberta' : 'Fechada'}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                          onClick={() => {
                            if (window.confirm(`Reabrir a cotação ${qr.requestCode}?`)) {
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
                          onClick={() => {
                            const cascade = qr._count?.quoteResponses ?? 0;
                            const msg = cascade > 0
                              ? `Apagar a cotação ${qr.requestCode}? Todas as ${cascade} resposta(s) e os itens associados também serão removidas. Esta ação não pode ser desfeita.`
                              : `Apagar a cotação ${qr.requestCode}? Esta ação não pode ser desfeita.`;
                            if (window.confirm(msg)) {
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
        )}
      </section>
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

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}