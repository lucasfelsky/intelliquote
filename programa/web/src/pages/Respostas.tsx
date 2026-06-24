import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import {
  createQuoteResponse,
  deleteQuoteResponse,
  INCOTERMS,
  listQuoteResponses,
  messageOf,
  updateQuoteResponse,
  type Incoterm,
  type QuoteResponse,
  type QuoteResponsePayload,
} from '@/services/quoteResponses';

interface QuoteRequestSummary {
  id: number;
  requestCode: string;
  productName: string;
  status: 'open' | 'closed';
  currency: string;
}

interface SupplierSummary {
  id: number;
  name: string;
  status: 'active' | 'inactive' | 'blocked';
  country?: string | null;
}

type WinnerFilter = 'todas' | 'vencedoras' | 'nao-vencedoras';

interface ResponseFormState {
  quoteRequestId: string;
  supplierId: string;
  offeredPrice: string;
  currency: string;
  exchangeRate: string;
  freightCost: string;
  insuranceCost: string;
  otherFees: string;
  importDuty: string;
  ipi: string;
  pis: string;
  cofins: string;
  offeredIncoterm: Incoterm;
  paymentTermsDays: string;
  notes: string;
}

const PAGE_SIZE = 20;

const emptyForm: ResponseFormState = {
  quoteRequestId: '',
  supplierId: '',
  offeredPrice: '',
  currency: 'USD',
  exchangeRate: '',
  freightCost: '0',
  insuranceCost: '0',
  otherFees: '0',
  importDuty: '0',
  ipi: '0',
  pis: '0',
  cofins: '0',
  offeredIncoterm: 'FOB',
  paymentTermsDays: '30',
  notes: '',
};

function formatNumber(value: number | undefined | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR');
}

function formatCurrency(value: number | undefined | null, currency: string): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' ' + currency;
}

function normalizeQuoteRequest(raw: unknown): QuoteRequestSummary {
  if (typeof raw !== 'object' || raw === null) throw new Error('Resposta inesperada.');
  const obj = raw as Record<string, unknown>;
  return {
    id: Number(obj.id),
    requestCode: String(obj.requestCode ?? ''),
    productName: String(obj.productName ?? ''),
    status: (obj.status as 'open' | 'closed') ?? 'open',
    currency: String(obj.currency ?? 'USD').toUpperCase(),
  };
}

function normalizeSupplier(raw: unknown): SupplierSummary {
  if (typeof raw !== 'object' || raw === null) throw new Error('Resposta inesperada.');
  const obj = raw as Record<string, unknown>;
  return {
    id: Number(obj.id),
    name: String(obj.name ?? ''),
    status: (obj.status as SupplierSummary['status']) ?? 'active',
    country: (obj.country as string | null) ?? null,
  };
}

function unwrapPaginatedList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as { data?: unknown; items?: unknown };
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.items)) return obj.items;
  }
  return [];
}

export default function Respostas() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const role = user?.role;
  const canManage = role === 'admin' || role === 'comprador';

  const [search, setSearch] = useState('');
  const [winnerFilter, setWinnerFilter] = useState<WinnerFilter>('todas');
  const [quoteRequestFilter, setQuoteRequestFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<QuoteResponse | null>(null);
  const [form, setForm] = useState<ResponseFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const responses = useQuery({
    queryKey: ['quote-responses'],
    queryFn: () => listQuoteResponses(),
  });

  const quoteRequests = useQuery({
    queryKey: ['quote-requests', 'open-closed'],
    queryFn: async () => {
      const data = await api.get<unknown>('/v1/quote-requests');
      const items = unwrapPaginatedList(data);
      return items.map(normalizeQuoteRequest);
    },
  });

  const suppliers = useQuery({
    queryKey: ['suppliers', 'list'],
    queryFn: async () => {
      const data = await api.get<unknown[] | { items: unknown[] }>('/api/v1/suppliers');
      const items = Array.isArray(data) ? data : data.items ?? [];
      return items.map(normalizeSupplier);
    },
  });

  const createMut = useMutation({
    mutationFn: (payload: QuoteResponsePayload) => createQuoteResponse(payload),
    onSuccess: async () => {
      setFeedback({ kind: 'ok', text: 'Proposta cadastrada com sucesso.' });
      await qc.invalidateQueries({ queryKey: ['quote-responses'] });
      await qc.invalidateQueries({ queryKey: ['quote-requests'] });
      closeModal();
    },
    onError: (err) => setFormError(messageOf(err)),
    onSettled: () => setSubmitting(false),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: QuoteResponsePayload }) =>
      updateQuoteResponse(id, payload),
    onSuccess: async () => {
      setFeedback({ kind: 'ok', text: 'Proposta atualizada com sucesso.' });
      await qc.invalidateQueries({ queryKey: ['quote-responses'] });
      closeModal();
    },
    onError: (err) => setFormError(messageOf(err)),
    onSettled: () => setSubmitting(false),
  });

  const removeMut = useMutation({
    mutationFn: (id: number) => deleteQuoteResponse(id),
    onSuccess: async () => {
      setFeedback({ kind: 'ok', text: 'Proposta apagada.' });
      await qc.invalidateQueries({ queryKey: ['quote-responses'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? messageOf(err) : 'Erro ao apagar.';
      setFeedback({ kind: 'err', text: msg });
    },
  });

  const openQuoteRequests = (quoteRequests.data ?? []).filter((q) => q.status === 'open');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = responses.data ?? [];
    return list.filter((r) => {
      const supplierName = r.supplier?.name?.toLowerCase() ?? '';
      const productName = r.quoteRequest?.productName?.toLowerCase() ?? '';
      const matchesSearch = !term || supplierName.includes(term) || productName.includes(term);
      const matchesWinner =
        winnerFilter === 'todas' ||
        (winnerFilter === 'vencedoras' && r.isWinner) ||
        (winnerFilter === 'nao-vencedoras' && !r.isWinner);
      const matchesQuote =
        quoteRequestFilter === 'all' || String(r.quoteRequestId) === quoteRequestFilter;
      return matchesSearch && matchesWinner && matchesQuote;
    });
  }, [responses.data, search, winnerFilter, quoteRequestFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  function openNew() {
    setEditing(null);
    const defaultQuote = openQuoteRequests[0];
    setForm({
      ...emptyForm,
      quoteRequestId: defaultQuote ? String(defaultQuote.id) : '',
      currency: defaultQuote?.currency ?? 'USD',
      exchangeRate: defaultQuote?.currency === 'BRL' ? '1' : '',
    });
    setFormError(null);
    setShowModal(true);
  }

  function openEdit(r: QuoteResponse) {
    setEditing(r);
    setForm({
      quoteRequestId: String(r.quoteRequestId),
      supplierId: String(r.supplierId),
      offeredPrice: String(r.offeredPrice ?? ''),
      currency: r.currency ?? 'USD',
      exchangeRate: r.exchangeRate !== null && r.exchangeRate !== undefined
        ? String(r.exchangeRate)
        : '',
      freightCost: String(r.freightCost ?? 0),
      insuranceCost: String(r.insuranceCost ?? 0),
      otherFees: String(r.otherFees ?? 0),
      importDuty: String(r.importDuty ?? 0),
      ipi: String(r.ipi ?? 0),
      pis: String(r.pis ?? 0),
      cofins: String(r.cofins ?? 0),
      offeredIncoterm: r.offeredIncoterm ?? 'FOB',
      paymentTermsDays: String(r.paymentTermsDays ?? 0),
      notes: r.notes ?? '',
    });
    setFormError(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
  }

  function buildPayload(): QuoteResponsePayload | null {
    const quoteRequestId = Number(form.quoteRequestId);
    const supplierId = Number(form.supplierId);
    const offeredPrice = Number(form.offeredPrice);
    const paymentTermsDays = Number(form.paymentTermsDays);
    if (!Number.isFinite(quoteRequestId) || quoteRequestId <= 0) {
      setFormError('Selecione uma cotação aberta.');
      return null;
    }
    if (!Number.isFinite(supplierId) || supplierId <= 0) {
      setFormError('Selecione um fornecedor.');
      return null;
    }
    if (!Number.isFinite(offeredPrice) || offeredPrice <= 0) {
      setFormError('O preço proposto deve ser maior que zero.');
      return null;
    }
    const currency = form.currency.trim().toUpperCase();
    if (currency.length !== 3) {
      setFormError('Informe uma moeda válida com 3 letras.');
      return null;
    }
    const exchangeRate = form.exchangeRate.trim() ? Number(form.exchangeRate) : null;
    if (currency !== 'BRL' && !(typeof exchangeRate === 'number' && exchangeRate > 0)) {
      setFormError('Informe a taxa de câmbio para propostas fora de BRL.');
      return null;
    }
    const numeric = (v: string): number => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`Valor inválido: ${v}`);
      return n;
    };
    let payload: QuoteResponsePayload;
    try {
      payload = {
        quoteRequestId,
        supplierId,
        offeredPrice,
        currency,
        exchangeRate: exchangeRate ?? undefined,
        freightCost: numeric(form.freightCost || '0'),
        insuranceCost: numeric(form.insuranceCost || '0'),
        otherFees: numeric(form.otherFees || '0'),
        importDuty: numeric(form.importDuty || '0'),
        ipi: numeric(form.ipi || '0'),
        pis: numeric(form.pis || '0'),
        cofins: numeric(form.cofins || '0'),
        offeredIncoterm: form.offeredIncoterm,
        paymentTermsDays: Number.isFinite(paymentTermsDays) && paymentTermsDays >= 0
          ? paymentTermsDays
          : 0,
        notes: form.notes.trim() ? form.notes.trim() : null,
      };
    } catch (err) {
      setFormError(messageOf(err));
      return null;
    }
    if (payload.paymentTermsDays < 0) {
      setFormError('O prazo de pagamento não pode ser negativo.');
      return null;
    }
    return payload;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const payload = buildPayload();
    if (!payload) return;
    setSubmitting(true);
    if (editing) {
      updateMut.mutate({ id: editing.id, payload });
    } else {
      createMut.mutate(payload);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Compras</p>
          <h1>Respostas</h1>
          <p>Gerencie as propostas dos fornecedores e identifique a vencedora.</p>
        </div>
        <div className="page-header__actions">
          {canManage && (
            <button type="button" className="primary-button" onClick={openNew}>
              + Nova resposta
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <p style={{
          color: feedback.kind === 'err' ? 'var(--danger)' : 'var(--primary-700)',
          fontSize: 13,
          marginBottom: 8,
        }}>
          {feedback.text}
        </p>
      )}

      <section className="card">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h2>Propostas</h2>
          <div className="page-header__actions">
            <input
              className="input"
              placeholder="Buscar por fornecedor ou produto"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              style={{ maxWidth: 280 }}
            />
            <select
              className="select"
              value={quoteRequestFilter}
              onChange={(e) => { setQuoteRequestFilter(e.target.value); setPage(1); }}
              style={{ maxWidth: 240 }}
            >
              <option value="all">Todas as cotações</option>
              {(quoteRequests.data ?? []).map((q) => (
                <option key={q.id} value={q.id}>
                  {q.requestCode} · {q.productName} {q.status === 'closed' ? '(fechada)' : ''}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={winnerFilter}
              onChange={(e) => setWinnerFilter(e.target.value as WinnerFilter)}
              style={{ maxWidth: 180 }}
            >
              <option value="todas">Todas</option>
              <option value="vencedoras">Vencedoras</option>
              <option value="nao-vencedoras">Não-vencedoras</option>
            </select>
          </div>
        </div>

        {responses.isLoading && <p>Carregando respostas…</p>}
        {responses.isError && (
          <div className="empty-state">
            <p>Não foi possível carregar as respostas.</p>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              Verifique sua conexão e tente novamente.
            </p>
          </div>
        )}
        {responses.data && filtered.length === 0 && !responses.isLoading && (
          <div className="empty-state">
            <strong>Nenhuma resposta encontrada</strong>
            <p>
              {canManage
                ? 'Use o botão “Nova resposta” para cadastrar uma proposta.'
                : 'Aguarde o cadastro de novas respostas.'}
            </p>
          </div>
        )}
        {pageItems.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Cotação</th>
                <th>Fornecedor</th>
                <th>Preço</th>
                <th>Incoterm</th>
                <th>Pagto · Lead</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => {
                const qrOpen = r.quoteRequest?.status === 'open';
                const qrClosed = r.quoteRequest?.status === 'closed';
                const canEditThis = canManage && qrOpen;
                const currency = r.currency || r.quoteRequest?.currency || 'USD';
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.quoteRequest?.requestCode ?? `#${r.quoteRequestId}`}</strong>
                      <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                        {r.quoteRequest?.productName ?? '—'}
                        {qrClosed && (
                          <span className="badge badge--muted" style={{ marginLeft: 6 }}>
                            fechada
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <strong>{r.supplier?.name ?? `Fornecedor #${r.supplierId}`}</strong>
                      {r.supplier?.country && (
                        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                          {r.supplier.country}
                        </div>
                      )}
                      {r.source === 'portal' && (
                        <span
                          className="badge"
                          style={{
                            marginTop: 4,
                            background: 'rgba(0, 174, 145, 0.15)',
                            color: 'var(--primary-700)',
                          }}
                          title="Proposta enviada via portal do fornecedor"
                        >
                          via portal
                        </span>
                      )}
                    </td>
                    <td>
                      <div>{formatCurrency(r.offeredPrice, currency)}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                        Landed: {formatCurrency(r.totalLandedCost, 'BRL')}
                      </div>
                    </td>
                    <td><span className="badge">{r.offeredIncoterm}</span></td>
                    <td>
                      <div>{formatNumber(r.paymentTermsDays)} dias</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                        Câmbio: {r.exchangeRate ?? '—'} · Lead: {formatNumber(r.leadTimeDays)} dias
                      </div>
                    </td>
                    <td>
                      {r.isWinner
                        ? <span className="badge">Vencedora</span>
                        : <span className="badge badge--muted">—</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {canEditThis && (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => openEdit(r)}
                            disabled={updateMut.isPending}
                          >
                            Editar
                          </button>
                        )}
                        {canEditThis && (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              if (window.confirm('Apagar esta resposta?')) {
                                removeMut.mutate(r.id);
                              }
                            }}
                            disabled={removeMut.isPending}
                          >
                            Apagar
                          </button>
                        )}
                        {!canEditThis && (
                          <span className="chip" title="Cotação fechada ou sem permissão">
                            Leitura
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {pageItems.length > 0 && (
          <div className="page-header__actions" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <small style={{ color: 'var(--ink-soft)' }}>
              Página {safePage} de {totalPages} · {filtered.length} resposta(s)
            </small>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
            >
              Anterior
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
            >
              Próxima
            </button>
          </div>
        )}
      </section>

      {showModal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
            style={{ maxWidth: 640 }}
          >
            <h2>{editing ? 'Editar resposta' : 'Nova resposta'}</h2>

            {!editing && openQuoteRequests.length === 0 && (
              <p style={{ color: 'var(--warning)', fontSize: 13, marginBottom: 12 }}>
                Não há cotações em aberto. Abra uma cotação para cadastrar respostas.
              </p>
            )}

            <div className="form-grid">
              <div className="form-grid__full">
                <label className="field-label" htmlFor="rf-quoteRequest">Cotação *</label>
                <select
                  id="rf-quoteRequest"
                  className="select"
                  value={form.quoteRequestId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const qr = (quoteRequests.data ?? []).find((q) => String(q.id) === id);
                    setForm({
                      ...form,
                      quoteRequestId: id,
                      currency: qr?.currency ?? form.currency,
                      exchangeRate: qr?.currency === 'BRL' ? '1' : form.exchangeRate,
                    });
                  }}
                  disabled={!!editing}
                  required
                >
                  <option value="">Selecione…</option>
                  {(editing ? quoteRequests.data ?? [] : openQuoteRequests).map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.requestCode} · {q.productName} {q.status === 'closed' ? '(fechada)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grid__full">
                <label className="field-label" htmlFor="rf-supplier">Fornecedor *</label>
                <select
                  id="rf-supplier"
                  className="select"
                  value={form.supplierId}
                  onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                  required
                >
                  <option value="">Selecione…</option>
                  {(suppliers.data ?? [])
                    .filter((s) => s.status !== 'blocked')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}{s.country ? ` (${s.country})` : ''}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="rf-price">Preço oferecido *</label>
                <input
                  id="rf-price"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.offeredPrice}
                  onChange={(e) => setForm({ ...form, offeredPrice: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rf-currency">Moeda *</label>
                <input
                  id="rf-currency"
                  className="input"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  maxLength={3}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rf-exchange">Câmbio (BRL/{form.currency || 'USD'})</label>
                <input
                  id="rf-exchange"
                  className="input"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form.exchangeRate}
                  onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rf-incoterm">Incoterm *</label>
                <select
                  id="rf-incoterm"
                  className="select"
                  value={form.offeredIncoterm}
                  onChange={(e) =>
                    setForm({ ...form, offeredIncoterm: e.target.value as Incoterm })
                  }
                  required
                >
                  {INCOTERMS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="rf-payment">Prazo pagamento (dias) *</label>
                <input
                  id="rf-payment"
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  value={form.paymentTermsDays}
                  onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rf-freight">Frete</label>
                <input
                  id="rf-freight"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.freightCost}
                  onChange={(e) => setForm({ ...form, freightCost: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rf-insurance">Seguro</label>
                <input
                  id="rf-insurance"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.insuranceCost}
                  onChange={(e) => setForm({ ...form, insuranceCost: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rf-other">Outras taxas</label>
                <input
                  id="rf-other"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.otherFees}
                  onChange={(e) => setForm({ ...form, otherFees: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rf-ii">II (%)</label>
                <input
                  id="rf-ii"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.importDuty}
                  onChange={(e) => setForm({ ...form, importDuty: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rf-ipi">IPI (%)</label>
                <input
                  id="rf-ipi"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.ipi}
                  onChange={(e) => setForm({ ...form, ipi: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rf-pis">PIS (%)</label>
                <input
                  id="rf-pis"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.pis}
                  onChange={(e) => setForm({ ...form, pis: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rf-cofins">COFINS (%)</label>
                <input
                  id="rf-cofins"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.cofins}
                  onChange={(e) => setForm({ ...form, cofins: e.target.value })}
                />
              </div>
              <div className="form-grid__full">
                <label className="field-label" htmlFor="rf-notes">Observações</label>
                <textarea
                  id="rf-notes"
                  className="textarea"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>

            {formError && (
              <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{formError}</p>
            )}

            <div className="modal__actions">
              <button type="button" className="ghost-button" onClick={closeModal}>
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={submitting || createMut.isPending || updateMut.isPending}
              >
                {submitting
                  ? (editing ? 'Salvando…' : 'Cadastrando…')
                  : (editing ? 'Salvar alterações' : 'Cadastrar resposta')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}