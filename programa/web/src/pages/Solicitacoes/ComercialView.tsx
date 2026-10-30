import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import {
  AnexarArquivoModal,
  AnexosLista,
  AnexosReenvioPainel,
  AnexosTecnicosCampo,
  attachmentErrorMessage,
  PendingAttachment,
  sendAttachmentsSequentially,
} from './AnexosTecnicos';
import { CR_ATTACHMENT_MAX_PER_REQUEST } from '@/services/commercialRequestAttachments';
import { cleanProposedName, DEVELOPMENT_BADGE, hasExactCatalogMatch, NEW_ITEM_BADGE, normalizeItemNameKey } from './itemNovo';
import {
  COMMERCIAL_REQUEST_STATUS_LABELS,
  COMMERCIAL_REQUEST_UNITS,
  CommercialCatalogItem,
  CommercialRequestInput,
  CommercialRequestStatus,
  CommercialRequestUnit,
  createCommercialRequest,
  customerLabel,
  formatCommercialPrice,
  formatCommercialQuantity,
  formatFinalPrice,
  listMyCommercialRequests,
  searchCommercialCatalog,
} from '@/services/commercialRequests';

interface LineDraft {
  /** Chave local da linha: `c:<catalogItemId>` (catalogo) ou `n:<nome normalizado>` (item novo). */
  key: string;
  catalogItemId: number | null;
  /** Nome digitado (item novo); null em item de catalogo. */
  proposedName: string | null;
  /** Observacao do item novo (opcional). */
  notes: string;
  commercialName: string;
  familyName: string | null;
  quantity: string;
  unit: CommercialRequestUnit;
  targetPrice: string;
  targetCurrency: string;
}

const CURRENCIES = ['USD', 'EUR', 'BRL', 'CNY'];
const MAX_ITEMS = 50;
const MAX_ITEM_NOTES = 500;
const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;
const MINE_KEY = ['commercial-requests', 'mine'] as const;

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

function isValidQuantity(raw: string): boolean {
  const value = Number(raw);
  return raw.trim() !== '' && Number.isInteger(value) && value > 0;
}

const PRICE_FORMAT_HINT = 'Use vírgula para decimais (ex.: 1.234,50).';
const THOUSANDS_ONLY = /^\d{1,3}(\.\d{3})+$/;

// "1,234.5" (ponto E virgula na ordem americana) e' ambiguo: rejeitamos em vez de adivinhar.
function isAmericanPriceFormat(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.includes('.') && trimmed.includes(',') && trimmed.lastIndexOf(',') < trimmed.lastIndexOf('.');
}

// "1.500" -> 1500 (milhar); "1.500,25" -> 1500.25; "1,85" -> 1.85; "1.85" -> 1.85 (decimal).
function parsePrice(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (isAmericanPriceFormat(trimmed)) return Number.NaN;

  let normalized: string;
  if (trimmed.includes(',')) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else if (THOUSANDS_ONLY.test(trimmed)) {
    normalized = trimmed.replace(/\./g, '');
  } else {
    normalized = trimmed;
  }
  // O banco guarda 2 casas (Decimal(12,2)); mais que isso seria arredondado em silencio.
  if (/\.\d{3,}$/.test(normalized)) return Number.NaN;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : Number.NaN;
}

// Nome · familia, com a familia em tom suave (o textContent e o mesmo de sempre).
function ItemLabel({ item }: { item: { commercialName: string; familyName: string | null } }) {
  return (
    <>
      {item.commercialName}
      {item.familyName && (
        <>
          {' '}
          <span className="solicitacao-item__familia">· {item.familyName}</span>
        </>
      )}
    </>
  );
}

// "1,85 USD" -> o numero em mono e o resto (moeda, unidade, incoterm) no corpo; o textContent nao muda.
function ValorMono({ texto }: { texto: string }) {
  const cut = texto.indexOf(' ');
  if (cut < 0) return <span className="solicitacoes-mono">{texto}</span>;
  return (
    <>
      <span className="solicitacoes-mono">{texto.slice(0, cut)}</span>
      {texto.slice(cut)}
    </>
  );
}

export default function ComercialView() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  // A busca fecha ao escolher um item (o foco vai para a quantidade dele) e
  // reabre pelo "Adicionar outro item". Sem itens, ela fica sempre aberta.
  const [searchOpen, setSearchOpen] = useState(true);
  const [focusQtyId, setFocusQtyId] = useState<string | null>(null);
  const [focusAfterRemove, setFocusAfterRemove] = useState(false);
  // Anexos tecnicos (so com item novo). Enviados em sequencia DEPOIS de criar a solicitacao.
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  // Solicitacao criada, mas algum anexo falhou: o modal passa a mostrar so os anexos restantes.
  const [attachOnly, setAttachOnly] = useState<{ requestId: number; uploaded: number } | null>(null);
  const [attachTarget, setAttachTarget] = useState<{ id: number; count: number } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (focusQtyId === null) return;
    const input = document.getElementById(`cr-qty-${focusQtyId}`) as HTMLInputElement | null;
    input?.focus();
    input?.select();
    setFocusQtyId(null);
  }, [focusQtyId, lines]);

  useEffect(() => {
    if (!focusAfterRemove) return;
    const target =
      (document.getElementById('cr-search') as HTMLElement | null) ??
      (document.getElementById('cr-add-more') as HTMLElement | null);
    target?.focus();
    setFocusAfterRemove(false);
  }, [focusAfterRemove, lines]);

  const mine = useQuery({
    queryKey: [...MINE_KEY, page],
    queryFn: () => listMyCommercialRequests({ page }),
  });

  const search = useQuery({
    queryKey: ['commercial-requests', 'catalog-search', debouncedTerm],
    queryFn: () => searchCommercialCatalog(debouncedTerm),
    enabled: modalOpen && debouncedTerm.length >= MIN_SEARCH_LENGTH,
  });

  const create = useMutation({
    mutationFn: ({ payload }: { payload: CommercialRequestInput; files: PendingAttachment[] }) =>
      createCommercialRequest(payload),
    onSuccess: (created, { files }) => {
      void qc.invalidateQueries({ queryKey: MINE_KEY });
      setPage(1);
      if (files.length === 0) {
        closeModal();
        return;
      }
      void sendAttachments(created.id, files, 0);
    },
    onError: (err) => setFormError(messageOf(err)),
  });

  // Anexos em sequencia; o primeiro que falhar interrompe e deixa o restante para reenvio.
  async function sendAttachments(requestId: number, files: PendingAttachment[], alreadyUploaded: number) {
    setAttachBusy(true);
    setFormError(null);
    const failure = await sendAttachmentsSequentially(requestId, files);
    setAttachBusy(false);
    void qc.invalidateQueries({ queryKey: MINE_KEY });
    if (!failure) {
      closeModal();
      return;
    }
    setAttachOnly({ requestId, uploaded: alreadyUploaded + failure.index });
    setPendingFiles(files.slice(failure.index));
    const reason = attachmentErrorMessage(failure.error).replace(/\.$/, '');
    setFormError(
      `Solicitação #${requestId} criada, mas o anexo "${failure.fileName}" não foi enviado: ${reason}. Reenvie pela lista.`,
    );
  }

  const rows = mine.data?.data ?? [];
  const pagination = mine.data?.pagination;
  const canSubmit =
    lines.length > 0 &&
    lines.every((line) => isValidQuantity(line.quantity)) &&
    !create.isPending &&
    !attachBusy;

  function openModal() {
    setCustomerName('');
    setNotes('');
    setLines([]);
    setPendingFiles([]);
    setAttachOnly(null);
    setAttachBusy(false);
    setSearchTerm('');
    setDebouncedTerm('');
    setFormError(null);
    setSearchOpen(true);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setFormError(null);
    setAttachOnly(null);
  }

  function addItem(item: CommercialCatalogItem) {
    const key = `c:${item.id}`;
    if (lines.length >= MAX_ITEMS || lines.some((line) => line.key === key)) return;
    setSearchTerm('');
    setDebouncedTerm('');
    setSearchOpen(false);
    setFocusQtyId(key);
    setLines((current) => {
      if (current.length >= MAX_ITEMS) return current;
      if (current.some((line) => line.key === key)) return current;
      return [
        ...current,
        {
          key,
          catalogItemId: item.id,
          proposedName: null,
          notes: '',
          commercialName: item.commercialName,
          familyName: item.familyName,
          quantity: '1',
          unit: 'KG',
          targetPrice: '',
          targetCurrency: 'USD',
        },
      ];
    });
  }

  // Nenhum item cadastrado corresponde ao nome: o comercial inclui um item novo (desenvolvimento).
  function addNewItem(rawName: string) {
    const name = cleanProposedName(rawName);
    const key = `n:${normalizeItemNameKey(name)}`;
    if (name === '' || lines.length >= MAX_ITEMS || lines.some((line) => line.key === key)) return;
    setSearchTerm('');
    setDebouncedTerm('');
    setSearchOpen(false);
    setFocusQtyId(key);
    setLines((current) => {
      if (current.length >= MAX_ITEMS) return current;
      if (current.some((line) => line.key === key)) return current;
      return [
        ...current,
        {
          key,
          catalogItemId: null,
          proposedName: name,
          notes: '',
          commercialName: name,
          familyName: null,
          quantity: '1',
          unit: 'KG',
          targetPrice: '',
          targetCurrency: 'USD',
        },
      ];
    });
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string) {
    const remaining = lines.filter((line) => line.key !== key);
    // Sem item novo nao ha solicitacao de desenvolvimento: descarta os arquivos escolhidos.
    if (!remaining.some((line) => line.catalogItemId === null)) setPendingFiles([]);
    setLines((current) => current.filter((line) => line.key !== key));
    // O botão clicado some: devolve o foco para a busca (se reaparecer) ou para "Adicionar outro item".
    setFocusAfterRemove(true);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (lines.length === 0) {
      setFormError('Adicione ao menos um item.');
      return;
    }
    if (!lines.every((line) => isValidQuantity(line.quantity))) {
      setFormError('A quantidade deve ser um número inteiro maior que zero.');
      return;
    }

    const items: CommercialRequestInput['items'] = [];
    for (const line of lines) {
      const price = parsePrice(line.targetPrice);
      if (price !== null && Number.isNaN(price)) {
        setFormError(
          isAmericanPriceFormat(line.targetPrice)
            ? `Preço-alvo de ${line.commercialName}: ${PRICE_FORMAT_HINT}`
            : `Preço-alvo inválido para ${line.commercialName}. ${PRICE_FORMAT_HINT}`,
        );
        return;
      }
      const common = {
        quantity: Number(line.quantity),
        unit: line.unit,
        ...(price !== null ? { targetPrice: price, targetCurrency: line.targetCurrency } : {}),
      };
      if (line.catalogItemId !== null) {
        items.push({ catalogItemId: line.catalogItemId, ...common });
      } else {
        const lineNotes = line.notes.trim();
        items.push({
          proposedName: line.proposedName ?? line.commercialName,
          ...(lineNotes !== '' ? { notes: lineNotes } : {}),
          ...common,
        });
      }
    }

    setFormError(null);
    create.mutate({
      payload: {
        customerName: customerName.trim() || null,
        notes: notes.trim() || null,
        items,
      },
      files: hasNewItem ? pendingFiles : [],
    });
  }

  const results = search.data ?? [];
  const showSearchHint = searchTerm.trim().length > 0 && searchTerm.trim().length < MIN_SEARCH_LENGTH;
  const showSearch = searchOpen || lines.length === 0;
  const hasNewItem = lines.some((line) => line.catalogItemId === null);
  const searchedLongEnough = debouncedTerm.length >= MIN_SEARCH_LENGTH && search.isSuccess;
  const newItemKey = `n:${normalizeItemNameKey(debouncedTerm)}`;
  const exactMatch = searchedLongEnough && hasExactCatalogMatch(debouncedTerm, results);
  const canOfferNewItem =
    searchedLongEnough &&
    !exactMatch &&
    lines.length < MAX_ITEMS &&
    !lines.some((line) => line.key === newItemKey);

  return (
    <div className="page solicitacoes-page solicitacoes-page--comercial">
      <header className="page-header">
        <div>
          <p className="eyebrow">Comercial</p>
          <h1>Solicitações</h1>
          <p className="page-subtitle">Peça ao COMEX a cotação dos itens que seus clientes precisam.</p>
        </div>
        <button type="button" className="primary-button" onClick={openModal}>
          <Icon name="plus" size={16} strokeWidth={2} />
          Solicitar uma cotação
        </button>
      </header>

      <section className="card solicitacoes-lista" aria-label="Minhas solicitações">
        {mine.isLoading && (
          <div className="solicitacoes-carregando" role="status">
            <span className="btn-spinner" aria-hidden="true" />
            Carregando solicitações…
          </div>
        )}

        {mine.isError && (
          <div className="solicitacoes-estado">
            <div
              className="empty-state empty-state--erro"
              role="alert"
            >
              <span className="empty-state__icon">
                <Icon name="alert-triangle" size={24} strokeWidth={1.7} />
              </span>
              <strong className="empty-state__title">
                Não foi possível carregar as solicitações: {messageOf(mine.error)}
              </strong>
            </div>
          </div>
        )}

        {!mine.isLoading && !mine.isError && rows.length === 0 && (
          <div className="solicitacoes-estado">
            <div className="empty-state">
              <span className="empty-state__icon">
                <Icon name="solicitacoes" size={36} strokeWidth={1.5} />
              </span>
              <strong className="empty-state__title">Nenhuma solicitação ainda</strong>
              <p className="empty-state__text">Use “Solicitar uma cotação” para pedir a cotação de um ou mais itens.</p>
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
                  <th>Cliente</th>
                  <th>Itens</th>
                  <th className="col-status">Status</th>
                  <th>Cotação</th>
                  <th>Anexos</th>
                  <th>Observação do COMEX</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((request) => (
                  <tr key={request.id} className="solicitacoes-linha">
                    <td data-label="Solicitação">
                      <span className="solicitacoes-mono solicitacoes-id">#{request.id}</span>
                    </td>
                    <td className="solicitacoes-data" data-label="Criada em">
                      <span className="solicitacoes-mono">{formatDate(request.createdAt)}</span>
                    </td>
                    <td
                      className={request.customerName?.trim() ? 'solicitacoes-cliente' : 'solicitacoes-cliente solicitacoes-cliente--vazio'}
                      data-label="Cliente"
                    >
                      {customerLabel(request.customerName)}
                    </td>
                    <td data-label="Itens">
                      <ul className="sol-items-list">
                        {request.items.map((item) => (
                          <li key={item.id} className="sol-item-linha">
                            {item.isNewItem && (
                              <>
                                <span className="badge badge--info">{NEW_ITEM_BADGE}</span>{' '}
                              </>
                            )}
                            {item.commercialName} — <span className="solicitacoes-mono">{formatCommercialQuantity(item.quantity)}</span> {item.unit}
                            {item.targetPrice ? (
                              <>
                                {' — alvo '}
                                <ValorMono texto={formatCommercialPrice(item.targetPrice, item.targetCurrency)} />
                              </>
                            ) : (
                              ''
                            )}
                            {request.status === 'fulfilled' ? (
                              item.finalPrice ? (
                                <strong className="sol-item-final">
                                  {' — preço final '}
                                  <ValorMono texto={formatFinalPrice(item.finalPrice)} />
                                </strong>
                              ) : (
                                <span className="solicitacoes-suave">{' — sem preço final'}</span>
                              )
                            ) : (
                              ''
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="col-status" data-label="Status">
                      <span className={statusBadgeClass(request.status)}>
                        {COMMERCIAL_REQUEST_STATUS_LABELS[request.status]}
                      </span>
                      {request.isDevelopment && (
                        <>
                          {' '}
                          <span className="badge badge--info">{DEVELOPMENT_BADGE}</span>
                        </>
                      )}
                    </td>
                    <td className="cell-nowrap solicitacoes-codigo" data-label="Cotação">{request.quote?.requestCode ?? '—'}</td>
                    <td data-label="Anexos">
                      {(() => {
                        const attachments = request.attachments ?? [];
                        const canEdit = request.status === 'pending' && request.isDevelopment;
                        if (!canEdit && attachments.length === 0) return '—';
                        return (
                          <>
                            <AnexosLista requestId={request.id} attachments={attachments} canRemove={canEdit} />
                            {canEdit && attachments.length < CR_ATTACHMENT_MAX_PER_REQUEST && (
                              <button
                                type="button"
                                className="ghost-button ghost-button--sm solicitacoes-anexar"
                                aria-label={`Anexar arquivo à solicitação #${request.id}`}
                                onClick={() => setAttachTarget({ id: request.id, count: attachments.length })}
                              >
                                <Icon name="plus" size={16} strokeWidth={1.9} />
                                Anexar
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td className="solicitacoes-observacao" data-label="Observação do COMEX">
                      {request.status === 'rejected' && request.rejectionReason
                        ? `Motivo: ${request.rejectionReason}`
                        : request.status === 'fulfilled' && request.fulfillmentNote
                          ? request.fulfillmentNote
                          : '—'}
                    </td>
                  </tr>
                ))}
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

      <Modal
        isOpen={modalOpen}
        onClose={attachBusy ? () => undefined : closeModal}
        title="Solicitar uma cotação"
        size="wide"
      >
        {attachOnly ? (
          <AnexosReenvioPainel
            error={formError}
            files={pendingFiles}
            onChange={setPendingFiles}
            uploaded={attachOnly.uploaded}
            busy={attachBusy}
            onRetry={() => void sendAttachments(attachOnly.requestId, pendingFiles, attachOnly.uploaded)}
            onClose={closeModal}
          />
        ) : (
        <form className="solicitacao-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-grid__full">
              <label className="field-label" htmlFor="cr-customer">Cliente (opcional)</label>
              <input
                id="cr-customer"
                className="input"
                value={customerName}
                maxLength={200}
                placeholder="Ex.: nome do cliente (opcional)"
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="form-grid__full">
              <label className="field-label" htmlFor="cr-notes">Observações</label>
              <textarea
                id="cr-notes"
                className="textarea"
                rows={2}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <h3 className="solicitacao-form__titulo">Itens da solicitação</h3>
          {lines.length === 0 && (
            <p className="solicitacao-form__vazio">
              Nenhum item adicionado. Busque abaixo e clique no item para incluí-lo.
            </p>
          )}
          {lines.map((line) => (
            <fieldset key={line.key} className="solicitacao-item">
              <legend className="solicitacao-item__legenda">
                {line.catalogItemId === null ? (
                  <>
                    {line.commercialName} <span className="solicitacao-item__familia">· </span>
                    <span className="badge badge--info">{NEW_ITEM_BADGE}</span>
                  </>
                ) : (
                  <ItemLabel item={line} />
                )}
              </legend>
              <div className="solicitacao-item__grade">
                <div>
                  <label className="field-label" htmlFor={`cr-qty-${line.key}`}>Quantidade *</label>
                  <input
                    id={`cr-qty-${line.key}`}
                    className="input solicitacao-item__numero"
                    type="number"
                    min={1}
                    step={1}
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor={`cr-unit-${line.key}`}>Unidade</label>
                  <select
                    id={`cr-unit-${line.key}`}
                    className="select"
                    value={line.unit}
                    onChange={(e) =>
                      updateLine(line.key, { unit: e.target.value as CommercialRequestUnit })
                    }
                  >
                    {COMMERCIAL_REQUEST_UNITS.map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor={`cr-price-${line.key}`}>Preço-alvo</label>
                  <input
                    id={`cr-price-${line.key}`}
                    className="input solicitacao-item__numero"
                    inputMode="decimal"
                    placeholder="opcional"
                    value={line.targetPrice}
                    onChange={(e) => updateLine(line.key, { targetPrice: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor={`cr-cur-${line.key}`}>Moeda</label>
                  <select
                    id={`cr-cur-${line.key}`}
                    className="select"
                    value={line.targetCurrency}
                    onChange={(e) => updateLine(line.key, { targetCurrency: e.target.value })}
                  >
                    {CURRENCIES.map((currency) => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="ghost-button danger-button solicitacao-item__remover"
                  onClick={() => removeLine(line.key)}
                >
                  <Icon name="trash" size={16} strokeWidth={1.9} />
                  Remover item
                </button>
              </div>
              {line.catalogItemId === null && (
                <div className="solicitacao-item__obs">
                  <label className="field-label" htmlFor={`cr-item-notes-${line.key}`}>Observação do item</label>
                  <textarea
                    id={`cr-item-notes-${line.key}`}
                    className="textarea"
                    rows={2}
                    maxLength={MAX_ITEM_NOTES}
                    placeholder="Opcional: aplicação, especificação, concorrente de referência…"
                    value={line.notes}
                    onChange={(e) => updateLine(line.key, { notes: e.target.value })}
                  />
                </div>
              )}
            </fieldset>
          ))}

          {hasNewItem && (
            <p role="status" className="solicitacoes-alerta alert--info solicitacao-form__aviso">
              <Icon name="info" size={18} strokeWidth={1.9} />
              Item novo: esta solicitação será de desenvolvimento. O COMEX cadastra o item antes de cotar.
            </p>
          )}
          {hasNewItem && (
            <AnexosTecnicosCampo files={pendingFiles} onChange={setPendingFiles} disabled={create.isPending} />
          )}

          {showSearch ? (
            <div className="solicitacao-busca">
              <div className="solicitacao-busca__topo">
                <label className="field-label" htmlFor="cr-search">Buscar item</label>
                {lines.length > 0 && (
                  <button
                    type="button"
                    className="link-button solicitacao-busca__fechar"
                    onClick={() => {
                      setSearchTerm('');
                      setDebouncedTerm('');
                      setSearchOpen(false);
                    }}
                  >
                    Fechar busca
                  </button>
                )}
              </div>
              <div className="solicitacao-busca__campo">
                <Icon name="search" size={16} strokeWidth={1.9} />
                <input
                  id="cr-search"
                  className="solicitacao-busca__input"
                  placeholder="Digite o nome comercial do item"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoComplete="off"
                  // Reaberta pelo "Adicionar outro item": já vem com o cursor.
                  autoFocus={lines.length > 0}
                />
              </div>
              {showSearchHint && (
                <p className="solicitacao-busca__dica">
                  Digite ao menos {MIN_SEARCH_LENGTH} caracteres.
                </p>
              )}
              {search.isError && (
                <p role="alert" className="solicitacoes-alerta alert--error">
                  <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
                  {messageOf(search.error)}
                </p>
              )}
              {debouncedTerm.length >= MIN_SEARCH_LENGTH && search.isSuccess && results.length === 0 && (
                <p className="solicitacao-busca__aviso">
                  Nenhum item cadastrado com esse nome.
                </p>
              )}
              {debouncedTerm.length >= MIN_SEARCH_LENGTH && results.length > 0 && (
                <ul aria-label="Resultados da busca" className="solicitacao-busca__lista">
                  {results.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="solicitacao-busca__resultado"
                        onClick={() => addItem(item)}
                        disabled={lines.some((line) => line.key === `c:${item.id}`)}
                      >
                        {lines.some((line) => line.key === `c:${item.id}`)
                          ? (
                            <>
                              <ItemLabel item={item} />{' '}
                              <span className="sol-added">
                                Adicionado
                                <Icon name="check" size={14} strokeWidth={2.4} />
                              </span>
                            </>
                          )
                          : (
                            <>
                              <Icon name="plus" size={14} strokeWidth={2.4} />
                              <ItemLabel item={item} />
                            </>
                          )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {canOfferNewItem && (
                <button
                  type="button"
                  className="solicitacao-busca__incluir"
                  onClick={() => addNewItem(debouncedTerm)}
                >
                  <Icon name="plus" size={14} strokeWidth={2.4} />
                  Incluir &quot;{cleanProposedName(debouncedTerm)}&quot; como item novo
                </button>
              )}
              {exactMatch && (
                <p className="solicitacao-busca__aviso">
                  Esse item já está cadastrado: selecione-o acima.
                </p>
              )}
            </div>
          ) : (
            lines.length < MAX_ITEMS && (
              <button id="cr-add-more" type="button" className="ghost-button solicitacao-form__outro" onClick={() => setSearchOpen(true)}>
                <Icon name="plus" size={16} strokeWidth={2.2} />
                Adicionar outro item
              </button>
            )
          )}

          {formError && (
            <p role="alert" className="solicitacoes-alerta alert--error">
              <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
              {formError}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={closeModal} disabled={attachBusy}>
              Cancelar
            </button>
            <button type="submit" className="primary-button" disabled={!canSubmit}>
              {create.isPending || attachBusy ? (
                <>
                  <span className="btn-spinner" aria-hidden="true" />
                  Enviando…
                </>
              ) : (
                'Enviar'
              )}
            </button>
          </div>
        </form>
        )}
      </Modal>

      {attachTarget && (
        <AnexarArquivoModal
          requestId={attachTarget.id}
          existingCount={attachTarget.count}
          onClose={() => setAttachTarget(null)}
        />
      )}
    </div>
  );
}
