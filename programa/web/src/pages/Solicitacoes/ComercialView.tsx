import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
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

function labelOf(item: { commercialName: string; familyName: string | null }): string {
  return item.familyName ? `${item.commercialName} · ${item.familyName}` : item.commercialName;
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
  // reabre pelo "+ Adicionar outro item". Sem itens, ela fica sempre aberta.
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
    // O botão clicado some: devolve o foco para a busca (se reaparecer) ou para "+ Adicionar outro item".
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
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Comercial</p>
          <h1>Solicitações</h1>
          <p className="page-subtitle">Peça ao COMEX a cotação dos itens que seus clientes precisam.</p>
        </div>
        <button type="button" className="primary-button" onClick={openModal}>
          Solicitar uma cotação
        </button>
      </header>

      <section className="card" aria-label="Minhas solicitações">
        {mine.isLoading && (
          <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
            Carregando solicitações…
          </p>
        )}

        {mine.isError && (
          <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
            Não foi possível carregar as solicitações: {messageOf(mine.error)}
          </p>
        )}

        {!mine.isLoading && !mine.isError && rows.length === 0 && (
          <div className="empty-state">
            <strong>Nenhuma solicitação ainda</strong>
            <p>Use “Solicitar uma cotação” para pedir a cotação de um ou mais itens.</p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="table-wrapper">
            <table className="table table--dense sol-table">
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
                  <tr key={request.id}>
                    <td data-label="Solicitação">#{request.id}</td>
                    <td data-label="Criada em">{formatDate(request.createdAt)}</td>
                    <td data-label="Cliente">{customerLabel(request.customerName)}</td>
                    <td data-label="Itens">
                      <ul className="sol-items-list">
                        {request.items.map((item) => (
                          <li key={item.id}>
                            {item.isNewItem && (
                              <>
                                <span className="badge badge--info">{NEW_ITEM_BADGE}</span>{' '}
                              </>
                            )}
                            {item.commercialName} — {formatCommercialQuantity(item.quantity)} {item.unit}
                            {item.targetPrice
                              ? ` — alvo ${formatCommercialPrice(item.targetPrice, item.targetCurrency)}`
                              : ''}
                            {request.status === 'fulfilled'
                              ? item.finalPrice
                                ? ` — preço final ${formatFinalPrice(item.finalPrice)}`
                                : ' — sem preço final'
                              : ''}
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
                    <td className="cell-nowrap" data-label="Cotação">{request.quote?.requestCode ?? '—'}</td>
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
                                className="ghost-button ghost-button--sm"
                                aria-label={`Anexar arquivo à solicitação #${request.id}`}
                                onClick={() => setAttachTarget({ id: request.id, count: attachments.length })}
                              >
                                Anexar
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td data-label="Observação do COMEX">
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
        <form onSubmit={handleSubmit}>
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

          <h3 style={{ margin: '18px 0 8px', fontSize: 15 }}>Itens da solicitação</h3>
          {lines.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
              Nenhum item adicionado. Busque abaixo e clique no item para incluí-lo.
            </p>
          )}
          {lines.map((line) => (
            <fieldset
              key={line.key}
              style={{
                border: '1px solid var(--border, #dde3ea)',
                borderRadius: 8,
                padding: 12,
                margin: '0 0 10px',
                minWidth: 0,
              }}
            >
              <legend className="text-sm" style={{ padding: '0 6px' }}>
                {line.catalogItemId === null ? (
                  <>
                    {line.commercialName} · <span className="badge badge--info">{NEW_ITEM_BADGE}</span>
                  </>
                ) : (
                  labelOf(line)
                )}
              </legend>
              <div className="form-grid">
                <div>
                  <label className="field-label" htmlFor={`cr-qty-${line.key}`}>Quantidade *</label>
                  <input
                    id={`cr-qty-${line.key}`}
                    className="input"
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
                    className="input"
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
              </div>
              {line.catalogItemId === null && (
                <div style={{ marginTop: 8 }}>
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
              <div style={{ marginTop: 8, textAlign: 'right' }}>
                <button
                  type="button"
                  className="ghost-button danger-button"
                  onClick={() => removeLine(line.key)}
                >
                  Remover item
                </button>
              </div>
            </fieldset>
          ))}

          {hasNewItem && (
            <p
              role="status"
              className="text-sm"
              style={{
                margin: '0 0 10px',
                padding: '8px 12px',
                background: 'var(--primary-50)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
            >
              Item novo: esta solicitação será de desenvolvimento. O COMEX cadastra o item antes de cotar.
            </p>
          )}
          {hasNewItem && (
            <AnexosTecnicosCampo files={pendingFiles} onChange={setPendingFiles} disabled={create.isPending} />
          )}

          {showSearch ? (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <label className="field-label" htmlFor="cr-search">Buscar item</label>
                {lines.length > 0 && (
                  <button
                    type="button"
                    className="link-button text-sm"
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ink-soft)', cursor: 'pointer' }}
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
              <input
                id="cr-search"
                className="input"
                placeholder="Digite o nome comercial do item"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoComplete="off"
                // Reaberta pelo "+ Adicionar outro item": já vem com o cursor.
                autoFocus={lines.length > 0}
              />
              {showSearchHint && (
                <p className="text-sm" style={{ color: 'var(--ink-soft)', margin: '4px 0 0' }}>
                  Digite ao menos {MIN_SEARCH_LENGTH} caracteres.
                </p>
              )}
              {search.isError && (
                <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
                  {messageOf(search.error)}
                </p>
              )}
              {debouncedTerm.length >= MIN_SEARCH_LENGTH && search.isSuccess && results.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--ink-soft)', margin: '4px 0 0' }}>
                  Nenhum item cadastrado com esse nome.
                </p>
              )}
              {debouncedTerm.length >= MIN_SEARCH_LENGTH && results.length > 0 && (
                <ul aria-label="Resultados da busca" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
                  {results.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="ghost-button"
                        style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}
                        onClick={() => addItem(item)}
                        disabled={lines.some((line) => line.key === `c:${item.id}`)}
                      >
                        {lines.some((line) => line.key === `c:${item.id}`)
                          ? <>{labelOf(item)} <span className="sol-added">Adicionado ✓</span></>
                          : <>+ {labelOf(item)}</>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {canOfferNewItem && (
                <button
                  type="button"
                  className="ghost-button"
                  style={{ width: '100%', textAlign: 'left', marginTop: 4 }}
                  onClick={() => addNewItem(debouncedTerm)}
                >
                  + Incluir &quot;{cleanProposedName(debouncedTerm)}&quot; como item novo
                </button>
              )}
              {exactMatch && (
                <p className="text-sm" style={{ color: 'var(--ink-soft)', margin: '4px 0 0' }}>
                  Esse item já está cadastrado: selecione-o acima.
                </p>
              )}
            </div>
          ) : (
            lines.length < MAX_ITEMS && (
              <button id="cr-add-more" type="button" className="ghost-button" onClick={() => setSearchOpen(true)}>
                + Adicionar outro item
              </button>
            )
          )}

          {formError && (
            <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
              {formError}
            </p>
          )}

          <div className="row-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" className="ghost-button" onClick={closeModal} disabled={attachBusy}>
              Cancelar
            </button>
            <button type="submit" className="primary-button" disabled={!canSubmit}>
              {create.isPending || attachBusy ? 'Enviando…' : 'Enviar'}
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
