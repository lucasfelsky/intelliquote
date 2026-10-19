import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import {
  COMMERCIAL_REQUEST_STATUS_LABELS,
  COMMERCIAL_REQUEST_UNITS,
  CommercialCatalogItem,
  CommercialRequestInput,
  CommercialRequestStatus,
  CommercialRequestUnit,
  createCommercialRequest,
  formatCommercialPrice,
  formatCommercialQuantity,
  listMyCommercialRequests,
  searchCommercialCatalog,
} from '@/services/commercialRequests';

interface LineDraft {
  catalogItemId: number;
  commercialName: string;
  familyName: string | null;
  quantity: string;
  unit: CommercialRequestUnit;
  targetPrice: string;
  targetCurrency: string;
}

const CURRENCIES = ['USD', 'EUR', 'BRL', 'CNY'];
const MAX_ITEMS = 50;
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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchTerm]);

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
    mutationFn: (payload: CommercialRequestInput) => createCommercialRequest(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MINE_KEY });
      setPage(1);
      closeModal();
    },
    onError: (err) => setFormError(messageOf(err)),
  });

  const rows = mine.data?.data ?? [];
  const pagination = mine.data?.pagination;
  const canSubmit =
    lines.length > 0 && lines.every((line) => isValidQuantity(line.quantity)) && !create.isPending;

  function openModal() {
    setCustomerName('');
    setNotes('');
    setLines([]);
    setSearchTerm('');
    setDebouncedTerm('');
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setFormError(null);
  }

  function addItem(item: CommercialCatalogItem) {
    setLines((current) => {
      if (current.length >= MAX_ITEMS) return current;
      if (current.some((line) => line.catalogItemId === item.id)) return current;
      return [
        ...current,
        {
          catalogItemId: item.id,
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

  function updateLine(catalogItemId: number, patch: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line) => (line.catalogItemId === catalogItemId ? { ...line, ...patch } : line)),
    );
  }

  function removeLine(catalogItemId: number) {
    setLines((current) => current.filter((line) => line.catalogItemId !== catalogItemId));
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
      items.push({
        catalogItemId: line.catalogItemId,
        quantity: Number(line.quantity),
        unit: line.unit,
        ...(price !== null ? { targetPrice: price, targetCurrency: line.targetCurrency } : {}),
      });
    }

    setFormError(null);
    create.mutate({
      customerName: customerName.trim() || null,
      notes: notes.trim() || null,
      items,
    });
  }

  const results = search.data ?? [];
  const showSearchHint = searchTerm.trim().length > 0 && searchTerm.trim().length < MIN_SEARCH_LENGTH;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Comercial</p>
          <h1>Solicitações</h1>
          <p className="page-subtitle">Peça ao COMEX a cotação dos itens que seus clientes precisam.</p>
        </div>
        <button type="button" className="primary-button" onClick={openModal}>
          Nova solicitação
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
            <p>Use “Nova solicitação” para pedir a cotação de um ou mais itens.</p>
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
                  <th>Observação do COMEX</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((request) => (
                  <tr key={request.id}>
                    <td data-label="Solicitação">#{request.id}</td>
                    <td data-label="Criada em">{formatDate(request.createdAt)}</td>
                    <td data-label="Cliente">{request.customerName ?? '—'}</td>
                    <td data-label="Itens">
                      <ul className="sol-items-list">
                        {request.items.map((item) => (
                          <li key={item.id}>
                            {item.commercialName} — {formatCommercialQuantity(item.quantity)} {item.unit}
                            {item.targetPrice
                              ? ` — alvo ${formatCommercialPrice(item.targetPrice, item.targetCurrency)}`
                              : ''}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="col-status" data-label="Status">
                      <span className={statusBadgeClass(request.status)}>
                        {COMMERCIAL_REQUEST_STATUS_LABELS[request.status]}
                      </span>
                    </td>
                    <td className="cell-nowrap" data-label="Cotação">{request.quote?.requestCode ?? '—'}</td>
                    <td data-label="Observação do COMEX">
                      {request.status === 'rejected' && request.rejectionReason
                        ? `Motivo: ${request.rejectionReason}`
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

      <Modal isOpen={modalOpen} onClose={closeModal} title="Nova solicitação" size="wide">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-grid__full">
              <label className="field-label" htmlFor="cr-customer">Cliente</label>
              <input
                id="cr-customer"
                className="input"
                value={customerName}
                maxLength={200}
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
            <div className="form-grid__full">
              <label className="field-label" htmlFor="cr-search">Buscar item</label>
              <input
                id="cr-search"
                className="input"
                placeholder="Digite ao menos 2 letras do nome comercial"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoComplete="off"
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
                  Nenhum item encontrado.
                </p>
              )}
              {results.length > 0 && (
                <ul aria-label="Resultados da busca" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
                  {results.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => addItem(item)}
                        disabled={lines.some((line) => line.catalogItemId === item.id)}
                      >
                        {lines.some((line) => line.catalogItemId === item.id)
                          ? <>{labelOf(item)} <span className="sol-added">Adicionado ✓</span></>
                          : <>+ {labelOf(item)}</>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <h3 style={{ margin: '18px 0 8px', fontSize: 15 }}>Itens da solicitação</h3>
          {lines.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
              Nenhum item adicionado. Busque acima e clique no item para incluí-lo.
            </p>
          )}
          {lines.map((line) => (
            <fieldset
              key={line.catalogItemId}
              style={{
                border: '1px solid var(--border, #dde3ea)',
                borderRadius: 8,
                padding: 12,
                margin: '0 0 10px',
                minWidth: 0,
              }}
            >
              <legend className="text-sm" style={{ padding: '0 6px' }}>{labelOf(line)}</legend>
              <div className="form-grid">
                <div>
                  <label className="field-label" htmlFor={`cr-qty-${line.catalogItemId}`}>Quantidade *</label>
                  <input
                    id={`cr-qty-${line.catalogItemId}`}
                    className="input"
                    type="number"
                    min={1}
                    step={1}
                    value={line.quantity}
                    onChange={(e) => updateLine(line.catalogItemId, { quantity: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor={`cr-unit-${line.catalogItemId}`}>Unidade</label>
                  <select
                    id={`cr-unit-${line.catalogItemId}`}
                    className="select"
                    value={line.unit}
                    onChange={(e) =>
                      updateLine(line.catalogItemId, { unit: e.target.value as CommercialRequestUnit })
                    }
                  >
                    {COMMERCIAL_REQUEST_UNITS.map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor={`cr-price-${line.catalogItemId}`}>Preço-alvo</label>
                  <input
                    id={`cr-price-${line.catalogItemId}`}
                    className="input"
                    inputMode="decimal"
                    placeholder="opcional"
                    value={line.targetPrice}
                    onChange={(e) => updateLine(line.catalogItemId, { targetPrice: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor={`cr-cur-${line.catalogItemId}`}>Moeda</label>
                  <select
                    id={`cr-cur-${line.catalogItemId}`}
                    className="select"
                    value={line.targetCurrency}
                    onChange={(e) => updateLine(line.catalogItemId, { targetCurrency: e.target.value })}
                  >
                    {CURRENCIES.map((currency) => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 8, textAlign: 'right' }}>
                <button
                  type="button"
                  className="ghost-button danger-button"
                  onClick={() => removeLine(line.catalogItemId)}
                >
                  Remover item
                </button>
              </div>
            </fieldset>
          ))}

          {formError && (
            <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
              {formError}
            </p>
          )}

          <div className="row-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" className="ghost-button" onClick={closeModal}>
              Cancelar
            </button>
            <button type="submit" className="primary-button" disabled={!canSubmit}>
              {create.isPending ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
