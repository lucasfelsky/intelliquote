import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Pagination } from '@/components/Pagination';
import {
  COMMERCIAL_REQUEST_STATUS_LABELS,
  CommercialRequestStatus,
  customerLabel,
  formatCommercialPrice,
  formatCommercialQuantity,
  listCommercialRequesters,
  listCommercialRequests,
} from '@/services/commercialRequests';
import { CommercialRequestActions } from './ComexActions';

const STATUS_OPTIONS: CommercialRequestStatus[] = ['pending', 'quoting', 'fulfilled', 'rejected'];

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

function statusBadgeClass(status: CommercialRequestStatus): string {
  switch (status) {
    case 'pending':
      return 'badge badge--warning';
    case 'quoting':
      return 'badge badge--info';
    case 'rejected':
      return 'badge badge--danger';
    default:
      return 'badge';
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
}

// Visao do COMEX. Acoes (criar/vincular cotacao, recusar, atender) so para admin e comprador;
// gestor e viewer so leem.
export default function ComexView() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canAct = user?.role === 'admin' || user?.role === 'comprador';
  const [status, setStatus] = useState<CommercialRequestStatus | ''>('');
  const [requestedById, setRequestedById] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const requesters = useQuery({
    queryKey: ['commercial-requests', 'requesters'],
    queryFn: listCommercialRequesters,
  });

  const list = useQuery({
    queryKey: ['commercial-requests', 'list', { status, requestedById, page }],
    queryFn: () => listCommercialRequests({ page, status, requestedById }),
  });

  const rows = list.data?.data ?? [];
  const pagination = list.data?.pagination;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Comercial</p>
          <h1>Solicitações</h1>
          <p className="page-subtitle">Pedidos de cotação registrados pelo time comercial{canAct ? '.' : ' (somente leitura).'}</p>
        </div>
        <div className="page-header__actions sol-filters">
          <select
            className="select sol-filter"
            aria-label="Filtrar por status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as CommercialRequestStatus | '');
              setPage(1);
            }}
          >
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>{COMMERCIAL_REQUEST_STATUS_LABELS[option]}</option>
            ))}
          </select>
          <select
            className="select sol-filter"
            aria-label="Filtrar por solicitante"
            value={requestedById}
            onChange={(e) => {
              setRequestedById(e.target.value ? Number(e.target.value) : '');
              setPage(1);
            }}
          >
            <option value="">Todos os solicitantes</option>
            {(requesters.data ?? []).map((requester) => (
              <option key={requester.id} value={requester.id}>{requester.name}</option>
            ))}
          </select>
        </div>
      </header>

      <section className="card" aria-label="Lista de solicitações">
        {list.isLoading && (
          <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
            Carregando solicitações…
          </p>
        )}

        {list.isError && (
          <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
            Não foi possível carregar as solicitações: {messageOf(list.error)}
          </p>
        )}

        {!list.isLoading && !list.isError && rows.length === 0 && (
          <div className="empty-state">
            <strong>Nenhuma solicitação encontrada</strong>
            <p>Ajuste os filtros ou aguarde novos pedidos do comercial.</p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="table-wrapper">
            <table className="table table--dense sol-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Criada em</th>
                  <th>Solicitante</th>
                  <th>Cliente</th>
                  <th>Itens</th>
                  <th className="col-status">Status</th>
                  <th>Cotação</th>
                  {canAct && <th>Ações</th>}
                  <th>
                    <span className="sr-only">Detalhes</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((request) => {
                  const expanded = expandedId === request.id;
                  return (
                    <Fragment key={request.id}>
                      <tr>
                        <td data-label="Solicitação">#{request.id}</td>
                        <td data-label="Criada em">{formatDate(request.createdAt)}</td>
                        <td data-label="Solicitante">{request.requestedBy.name}</td>
                        <td data-label="Cliente">{customerLabel(request.customerName)}</td>
                        <td data-label="Itens">{request.items.length}</td>
                        <td className="col-status" data-label="Status">
                          <span className={statusBadgeClass(request.status)}>
                            {COMMERCIAL_REQUEST_STATUS_LABELS[request.status]}
                          </span>
                        </td>
                        <td className="cell-nowrap" data-label="Cotação">
                          {request.quoteRequest ? (
                            <button
                              type="button"
                              className="ghost-button ghost-button--sm"
                              onClick={() => navigate('/cotacoes/' + request.quoteRequest!.id)}
                            >
                              {request.quoteRequest.requestCode}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        {canAct && (
                          <td className="sol-cell-actions" data-label="Ações">
                            <CommercialRequestActions request={request} role={user?.role} />
                          </td>
                        )}
                        <td className="sol-cell-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            aria-expanded={expanded}
                            onClick={() => setExpandedId(expanded ? null : request.id)}
                          >
                            {expanded ? 'Ocultar itens' : 'Ver itens'}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={canAct ? 9 : 8} className="sol-cell-detail">
                            {request.notes && (
                              <p className="text-sm" style={{ marginTop: 0 }}>
                                <strong>Observações:</strong> {request.notes}
                              </p>
                            )}
                            {request.status === 'rejected' && request.rejectionReason && (
                              <p className="text-sm" style={{ marginTop: 0 }}>
                                <strong>Motivo da recusa:</strong> {request.rejectionReason}
                              </p>
                            )}
                            {request.status === 'fulfilled' && request.fulfillmentNote && (
                              <p className="text-sm" style={{ marginTop: 0 }}>
                                <strong>Atendida sem preço:</strong> {request.fulfillmentNote}
                              </p>
                            )}
                            <table className="table table--dense sol-table">
                              <thead>
                                <tr>
                                  <th>Nome comercial</th>
                                  <th>Nome de mercado</th>
                                  <th>Código DBCorp</th>
                                  <th>Quantidade</th>
                                  <th>Preço-alvo</th>
                                  <th>Na cotação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {request.items.map((item) => (
                                  <tr key={item.id}>
                                    <td data-label="Nome comercial">{item.commercialName}</td>
                                    <td data-label="Nome de mercado">{item.marketName}</td>
                                    <td data-label="Código DBCorp">{item.dbcorpCode ?? '—'}</td>
                                    <td data-label="Quantidade">{formatCommercialQuantity(item.quantity)} {item.unit}</td>
                                    <td data-label="Preço-alvo">
                                      {formatCommercialPrice(item.targetPrice, item.targetCurrency)}
                                    </td>
                                    <td data-label="Na cotação">
                                      {item.quoteRequestItemId !== null ? 'Sim' : 'Não'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            itemLabel={{ singular: 'solicitação', plural: 'solicitações' }}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
          />
        )}
      </section>
    </div>
  );
}
