import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { Pagination } from '@/components/Pagination';
import {
  COMMERCIAL_REQUEST_STATUS_LABELS,
  CommercialRequestForComex,
  CommercialRequestItemForComex,
  CommercialRequestStatus,
  customerLabel,
  formatCommercialPrice,
  formatCommercialQuantity,
  listCommercialRequesters,
  listCommercialRequests,
} from '@/services/commercialRequests';
import { AnexosLista } from './AnexosTecnicos';
import { CommercialRequestActions } from './ComexActions';
import { DEVELOPMENT_BADGE, NEW_ITEM_BADGE } from './itemNovo';
import { VincularCatalogoModal } from './VincularCatalogoModal';

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
      return 'badge badge--warning badge--dot';
    case 'quoting':
      return 'badge badge--info badge--dot';
    case 'rejected':
      return 'badge badge--danger badge--dot';
    default:
      return 'badge badge--success badge--dot';
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
  const [linkTarget, setLinkTarget] = useState<{
    request: CommercialRequestForComex;
    item: CommercialRequestItemForComex;
  } | null>(null);

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
    <div className="page solicitacoes-page solicitacoes-page--comex">
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

      <section className="card solicitacoes-lista" aria-label="Lista de solicitações">
        {list.isLoading && (
          <div className="solicitacoes-carregando" role="status">
            <span className="btn-spinner" aria-hidden="true" />
            Carregando solicitações…
          </div>
        )}

        {list.isError && (
          <div className="solicitacoes-estado">
            <div
              className="empty-state empty-state--erro"
              role="alert"
            >
              <span className="empty-state__icon">
                <Icon name="alert-triangle" size={24} strokeWidth={1.7} />
              </span>
              <strong className="empty-state__title">
                Não foi possível carregar as solicitações: {messageOf(list.error)}
              </strong>
            </div>
          </div>
        )}

        {!list.isLoading && !list.isError && rows.length === 0 && (
          <div className="solicitacoes-estado">
            <div className="empty-state">
              <span className="empty-state__icon">
                <Icon name="filter" size={36} strokeWidth={1.5} />
              </span>
              <strong className="empty-state__title">Nenhuma solicitação encontrada</strong>
              <p className="empty-state__text">Ajuste os filtros ou aguarde novos pedidos do comercial.</p>
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className="table-wrapper">
            <table className="table table--dense sol-table solicitacoes-tabela">
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
                      <tr className={expanded ? 'solicitacoes-linha solicitacoes-linha--aberta' : 'solicitacoes-linha'}>
                        <td data-label="Solicitação">
                          <span className="solicitacoes-mono solicitacoes-id">#{request.id}</span>
                        </td>
                        <td className="solicitacoes-data" data-label="Criada em">
                          <span className="solicitacoes-mono">{formatDate(request.createdAt)}</span>
                        </td>
                        <td data-label="Solicitante">{request.requestedBy.name}</td>
                        <td
                          className={request.customerName?.trim() ? 'solicitacoes-cliente' : 'solicitacoes-cliente solicitacoes-cliente--vazio'}
                          data-label="Cliente"
                        >
                          {customerLabel(request.customerName)}
                        </td>
                        <td className="solicitacoes-itens-celula" data-label="Itens">
                          <span className="solicitacoes-itens-conteudo">
                            <span className="solicitacoes-mono">{request.items.length}</span>
                            {request.isDevelopment && (
                              <>
                                {' '}
                                <span className="badge badge--info">{DEVELOPMENT_BADGE}</span>
                              </>
                            )}
                          </span>
                        </td>
                        <td className="col-status" data-label="Status">
                          <span className={statusBadgeClass(request.status)}>
                            {COMMERCIAL_REQUEST_STATUS_LABELS[request.status]}
                          </span>
                        </td>
                        <td className="cell-nowrap" data-label="Cotação">
                          {request.quoteRequest ? (
                            <button
                              type="button"
                              className="ghost-button ghost-button--sm solicitacoes-cotacao"
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
                        <td className="sol-cell-actions solicitacoes-ver">
                          <button
                            type="button"
                            className="ghost-button solicitacoes-ver__botao"
                            aria-expanded={expanded}
                            onClick={() => setExpandedId(expanded ? null : request.id)}
                          >
                            {expanded ? 'Ocultar itens' : 'Ver itens'}
                            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} strokeWidth={2.2} />
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="solicitacoes-linha-detalhe">
                          <td colSpan={canAct ? 9 : 8} className="sol-cell-detail">
                            <div className="solicitacoes-detalhe">
                              {(request.notes ||
                                (request.status === 'rejected' && request.rejectionReason) ||
                                (request.status === 'fulfilled' && request.fulfillmentNote)) && (
                                <div className="solicitacoes-notas">
                                  {request.notes && (
                                    <p className="solicitacoes-nota">
                                      <strong>Observações:</strong> {request.notes}
                                    </p>
                                  )}
                                  {request.status === 'rejected' && request.rejectionReason && (
                                    <p className="solicitacoes-nota">
                                      <strong>Motivo da recusa:</strong> {request.rejectionReason}
                                    </p>
                                  )}
                                  {request.status === 'fulfilled' && request.fulfillmentNote && (
                                    <p className="solicitacoes-nota">
                                      <strong>Atendida sem preço:</strong> {request.fulfillmentNote}
                                    </p>
                                  )}
                                </div>
                              )}
                              <div className="solicitacoes-itens-tabela">
                                <table className="table table--dense sol-table solicitacoes-itens">
                                  <thead>
                                    <tr>
                                      <th>Nome comercial</th>
                                      <th>Item novo</th>
                                      <th>Nome de mercado</th>
                                      <th>Código DBCorp</th>
                                      <th className="solicitacoes-dir">Quantidade</th>
                                      <th className="solicitacoes-dir">Preço-alvo</th>
                                      <th>Observação do item</th>
                                      <th>Na cotação</th>
                                      {canAct && request.status === 'pending' && request.isDevelopment && (
                                        <th>
                                          <span className="sr-only">Catálogo</span>
                                        </th>
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {request.items.map((item) => (
                                      <tr key={item.id}>
                                        <td className="solicitacoes-item-nome" data-label="Nome comercial">{item.commercialName}</td>
                                        <td data-label="Item novo">
                                          {item.isNewItem ? (
                                            <>
                                              <span className="badge badge--info">{NEW_ITEM_BADGE}</span>{' '}
                                              {item.proposedName ?? item.commercialName}
                                            </>
                                          ) : (
                                            '—'
                                          )}
                                        </td>
                                        <td className="solicitacoes-suave" data-label="Nome de mercado">{item.marketName ?? '—'}</td>
                                        <td
                                          className={item.dbcorpCode ? 'solicitacoes-dbcorp' : 'solicitacoes-suave'}
                                          data-label="Código DBCorp"
                                        >
                                          {item.dbcorpCode ?? '—'}
                                        </td>
                                        <td className="solicitacoes-valor" data-label="Quantidade">{formatCommercialQuantity(item.quantity)} {item.unit}</td>
                                        <td className="solicitacoes-valor" data-label="Preço-alvo">
                                          {formatCommercialPrice(item.targetPrice, item.targetCurrency)}
                                        </td>
                                        <td data-label="Observação do item">{item.notes ?? '—'}</td>
                                        <td
                                          className={
                                            item.quoteRequestItemId !== null
                                              ? 'solicitacoes-na-cotacao solicitacoes-na-cotacao--sim'
                                              : 'solicitacoes-na-cotacao'
                                          }
                                          data-label="Na cotação"
                                        >
                                          {item.quoteRequestItemId !== null ? 'Sim' : 'Não'}
                                        </td>
                                        {canAct && request.status === 'pending' && request.isDevelopment && (
                                          <td className="sol-cell-actions" data-label="Catálogo">
                                            {item.isNewItem && (
                                              <button
                                                type="button"
                                                className="ghost-button ghost-button--sm solicitacoes-vincular"
                                                onClick={() => setLinkTarget({ request, item })}
                                              >
                                                <Icon name="link" size={16} strokeWidth={1.9} />
                                                {item.catalogItemId === null ? 'Vincular ao catálogo' : 'Trocar vínculo'}
                                              </button>
                                            )}
                                          </td>
                                        )}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {(request.attachments ?? []).length > 0 ? (
                                <div className="solicitacoes-anexos">
                                  <strong className="solicitacoes-anexos__titulo">Anexos técnicos</strong>
                                  <AnexosLista requestId={request.id} attachments={request.attachments} />
                                </div>
                              ) : (
                                request.isDevelopment && (
                                  <p className="solicitacoes-anexos__vazio">Sem anexos técnicos.</p>
                                )
                              )}
                            </div>
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

      {linkTarget && (
        // O <dialog> herda text-align do td do card mobile (direita): a classe fixa a esquerda.
        <div className="solicitacao-modal">
          <VincularCatalogoModal
            request={linkTarget.request}
            item={linkTarget.item}
            onClose={() => setLinkTarget(null)}
          />
        </div>
      )}
    </div>
  );
}
