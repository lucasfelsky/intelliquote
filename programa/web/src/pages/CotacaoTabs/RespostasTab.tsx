import { useConfirm } from '@/components/useConfirm';
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
import {
  previewQuoteResponseReply,
  replyToQuoteResponse,
  getTargetPriceHistory,
  type QuoteResponseReplyPreview,
} from '@/services/dispatch';

interface SupplierSummary {
  id: number;
  name: string;
  status: 'active' | 'inactive' | 'blocked';
  country?: string | null;
}

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

export function RespostasTab({
  quoteRequestId,
  quoteRequestStatus,
  quoteRequestCurrency,
  productName,
  requestCode,
}: {
  quoteRequestId: number;
  quoteRequestStatus: 'open' | 'closed';
  quoteRequestCurrency: string;
  productName: string | null;
  requestCode: string;
}) {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { user } = useAuth();
  const role = user?.role;
  const canManage = role === 'admin' || role === 'comprador';
  const qrOpen = quoteRequestStatus === 'open';
  const canEditThis = canManage && qrOpen;

  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<QuoteResponse | null>(null);
  const [form, setForm] = useState<ResponseFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reply Modal
  const [replyTarget, setReplyTarget] = useState<QuoteResponse | null>(null);
  const [replySubject, setReplySubject] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [replyTargetPrice, setReplyTargetPrice] = useState('');
  const [replyPreviewData, setReplyPreviewData] = useState<QuoteResponseReplyPreview | null>(null);
  const [replyModalError, setReplyModalError] = useState<string | null>(null);

  const responsesQuery = useQuery({
    queryKey: ['quote-responses'],
    queryFn: () => listQuoteResponses(),
  });

  const historyQuery = useQuery({
    queryKey: ['quote-responses', replyTarget?.id, 'target-price-history'],
    queryFn: () => getTargetPriceHistory(replyTarget!.id),
    enabled: !!replyTarget,
  });

  const suppliers = useQuery({
    queryKey: ['suppliers', 'list'],
    queryFn: async () => {
      const data = await api.get<unknown[] | { items: unknown[] }>('/api/v1/suppliers');
      const items = Array.isArray(data) ? data : data.items ?? [];
      return items.map(normalizeSupplier);
    },
  });

  const responses = useMemo(() => {
    return (responsesQuery.data ?? []).filter((r) => r.quoteRequestId === quoteRequestId);
  }, [responsesQuery.data, quoteRequestId]);

  const createMut = useMutation({
    mutationFn: (payload: QuoteResponsePayload) => createQuoteResponse(payload),
    onSuccess: async () => {
      setFeedback({ kind: 'ok', text: 'Proposta cadastrada com sucesso.' });
      await qc.invalidateQueries({ queryKey: ['quote-responses'] });
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

  const replyPreviewMutation = useMutation({
    mutationFn: (vars: { id: number; subject: string; message: string; targetPrice: number | null }) =>
      previewQuoteResponseReply(vars.id, { subject: vars.subject, message: vars.message, targetPrice: vars.targetPrice }),
    onSuccess: (data) => {
      setReplyPreviewData(data);
      setReplyModalError(null);
    },
    onError: (err) => setReplyModalError(messageOf(err)),
  });

  const replySendMutation = useMutation({
    mutationFn: () => {
      if (!replyTarget) throw new Error('Nenhuma proposta selecionada.');
      const parsedTargetPrice = replyTargetPrice.trim() ? Number(replyTargetPrice) : null;
      return replyToQuoteResponse(replyTarget.id, { subject: replySubject, message: replyMessage, targetPrice: parsedTargetPrice });
    },
    onSuccess: (result) => {
      setFeedback({
        kind: 'ok',
        text: `E-mail enviado para ${result.to}${result.cc.length > 0 ? ` (CC: ${result.cc.join(', ')})` : ''}.`,
      });
      closeReplyModal();
    },
    onError: (err) => setReplyModalError(messageOf(err)),
  });

  function openNew() {
    setEditing(null);
    setForm({
      ...emptyForm,
      quoteRequestId: String(quoteRequestId),
      currency: quoteRequestCurrency,
      exchangeRate: quoteRequestCurrency === 'BRL' ? '1' : '',
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
      exchangeRate: r.exchangeRate !== null && r.exchangeRate !== undefined ? String(r.exchangeRate) : '',
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

  function openReplyModal(r: QuoteResponse) {
    const itemName = productName || requestCode;
    const supplierName = r.supplier?.name ?? `Fornecedor #${r.supplierId}`;
    const defaultSubject = `${itemName} - SQ QUIMICA - ${supplierName}`;
    setReplyTarget(r);
    setReplySubject(defaultSubject);
    setReplyMessage('');
    setReplyTargetPrice(r.targetPrice != null ? String(r.targetPrice) : '');
    setReplyPreviewData(null);
    setReplyModalError(null);
    const initialTargetPrice = r.targetPrice != null ? Number(r.targetPrice) : null;
    replyPreviewMutation.mutate({ id: r.id, subject: defaultSubject, message: '', targetPrice: initialTargetPrice });
  }

  function closeReplyModal() {
    setReplyTarget(null);
    setReplyPreviewData(null);
    setReplyModalError(null);
  }

  function buildPayload(): QuoteResponsePayload | null {
    const qid = Number(form.quoteRequestId);
    const supplierId = Number(form.supplierId);
    const offeredPrice = Number(form.offeredPrice);
    const paymentTermsDays = Number(form.paymentTermsDays);

    if (!Number.isFinite(qid) || qid <= 0) {
      setFormError('Cotação inválida.');
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
        quoteRequestId: qid,
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
        paymentTermsDays: Number.isFinite(paymentTermsDays) && paymentTermsDays >= 0 ? paymentTermsDays : 0,
        notes: form.notes.trim() ? form.notes.trim() : null,
      };
    } catch (err) {
      setFormError(messageOf(err));
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--ink)' }}>Respostas da Cotação</h2>
        {canEditThis && (
          <button type="button" className="primary-button" onClick={openNew}>
            + Nova resposta
          </button>
        )}
      </div>

      {feedback && (
        <p style={{
          color: feedback.kind === 'err' ? 'var(--danger)' : 'var(--primary-700)',
          fontSize: 13,
          background: feedback.kind === 'err' ? 'var(--danger-light, #fee2e2)' : 'var(--primary-50, #f0fdfa)',
          padding: '8px 12px',
          borderRadius: '6px',
        }}>
          {feedback.text}
        </p>
      )}

      {responsesQuery.isLoading && <p>Carregando respostas…</p>}
      {responsesQuery.isError && <p>Erro ao carregar respostas.</p>}
      
      {!responsesQuery.isLoading && responses.length === 0 && (
        <div className="empty-state">
          <strong>Sem respostas ainda</strong>
          <p>
            {canManage && qrOpen
              ? 'Use o botão "+ Nova resposta" para cadastrar uma proposta.'
              : 'Aguarde o cadastro de respostas pelos fornecedores.'}
          </p>
        </div>
      )}

      {responses.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Fornecedor</th>
              <th>Preço</th>
              <th>Incoterm</th>
              <th>Pagto · Lead</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {responses.map((r) => {
              const currency = r.currency || quoteRequestCurrency;
              return (
                <tr key={r.id}>
                  <td>
                    <strong>{r.supplier?.name ?? `Fornecedor #${r.supplierId}`}</strong>
                    {r.supplier?.country && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{r.supplier.country}</div>}
                    {r.source === 'portal' && (
                      <span className="badge" style={{ marginTop: 4, background: 'rgba(0, 174, 145, 0.15)', color: 'var(--primary-700)' }}>
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
                    {r.isWinner ? <span className="badge">Vencedora</span> : <span className="badge badge--muted">Recebida</span>}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => openReplyModal(r)}
                        title="Responder (enviar e-mail ao fornecedor)"
                      >
                        Responder
                      </button>
                      {canEditThis && (
                        <>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => openEdit(r)}
                            disabled={updateMut.isPending}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={async () => {
                              if (await confirm('Apagar esta resposta?')) {
                                removeMut.mutate(r.id);
                              }
                            }}
                            disabled={removeMut.isPending}
                          >
                            Apagar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* MODAL DE NOVA/EDITAR RESPOSTA */}
      {showModal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
            <h2>{editing ? 'Editar resposta' : 'Nova resposta'}</h2>
            
            <div className="form-grid">
              <div className="form-grid__full">
                <label className="field-label" htmlFor="rf-supplier">Fornecedor *</label>
                <select
                  id="rf-supplier"
                  className="select"
                  value={form.supplierId}
                  onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                  required
                  disabled={!!editing}
                >
                  <option value="">Selecione…</option>
                  {(suppliers.data ?? [])
                    .filter((s) => s.status !== 'blocked')
                    .map((s) => (
                      <option key={s.id} value={s.id}>{s.name}{s.country ? ` (${s.country})` : ''}</option>
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
                  onChange={(e) => setForm({ ...form, offeredIncoterm: e.target.value as Incoterm })}
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

            {formError && <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{formError}</p>}

            <div className="modal__actions">
              <button type="button" className="ghost-button" onClick={closeModal}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={submitting || createMut.isPending || updateMut.isPending}>
                {submitting ? (editing ? 'Salvando…' : 'Cadastrando…') : (editing ? 'Salvar alterações' : 'Cadastrar resposta')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL DE RESPONDER E-MAIL */}
      {replyTarget && (
        <div className="modal-backdrop" onClick={closeReplyModal}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <h2>Responder {replyTarget.supplier?.name ?? `Fornecedor #${replyTarget.supplierId}`}</h2>
            <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: -8 }}>
              {requestCode} · {productName}
            </p>

            <label className="field-label" htmlFor="replySubject" style={{ marginTop: 12 }}>
              Assunto
            </label>
            <input
              id="replySubject"
              className="input"
              value={replySubject}
              onChange={(e) => setReplySubject(e.target.value)}
            />

            <label className="field-label" htmlFor="replyMessage" style={{ marginTop: 12 }}>
              Mensagem
            </label>
            <textarea
              id="replyMessage"
              className="textarea"
              rows={4}
              value={replyMessage}
              onChange={(e) => setReplyMessage(e.target.value)}
              placeholder="Opcional. Ex.: confirmando o fechamento do pedido."
            />

            <label className="field-label" htmlFor="replyTargetPrice" style={{ marginTop: 12 }}>
              Preço-alvo (opcional)
            </label>
            <input
              id="replyTargetPrice"
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={replyTargetPrice}
              onChange={(e) => setReplyTargetPrice(e.target.value)}
            />
            <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 4 }}>
              Preencher adiciona o bloco de pedido de redução de preço no e-mail.
            </p>

            {historyQuery.data && historyQuery.data.length > 0 && (
              <div style={{ marginTop: 16, padding: '12px', backgroundColor: 'var(--bg-subtle)', borderRadius: 4 }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: 'var(--ink)' }}>Histórico de negociação</h4>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: 'var(--ink-soft)' }}>
                  {historyQuery.data.map((h) => (
                    <li key={h.id} style={{ marginBottom: 4 }}>
                      {new Date(h.sentAt).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                      })} — {formatCurrency(Number(h.targetPrice), replyTarget.currency || quoteRequestCurrency)} (enviado por {h.sentBy?.name ?? 'desconhecido'})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="modal__actions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
              <button
                type="button"
                className="ghost-button"
                disabled={replyPreviewMutation.isPending}
                onClick={() => {
                  const parsedTargetPrice = replyTargetPrice.trim() ? Number(replyTargetPrice) : null;
                  replyPreviewMutation.mutate({ id: replyTarget.id, subject: replySubject, message: replyMessage, targetPrice: parsedTargetPrice });
                }}
              >
                {replyPreviewMutation.isPending ? 'Atualizando…' : 'Atualizar preview'}
              </button>
            </div>

            <h3 style={{ marginTop: 16, marginBottom: 6 }}>Preview do e-mail</h3>
            {replyPreviewData ? (
              <>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8 }}>
                  Para: <strong>{replyPreviewData.to}</strong>
                  {replyPreviewData.cc.length > 0 && <> · CC: {replyPreviewData.cc.join(', ')}</>}
                </p>
                <iframe
                  key={replyPreviewData.html.length}
                  title="preview-reply-email"
                  className="preview-frame"
                  srcDoc={replyPreviewData.html}
                />
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                {replyPreviewMutation.isPending ? 'Carregando preview…' : 'Sem preview ainda.'}
              </p>
            )}

            {replyModalError && (
              <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{replyModalError}</p>
            )}

            <div className="modal__actions">
              <button type="button" className="ghost-button" onClick={closeReplyModal}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={replySendMutation.isPending || !replySubject.trim()}
                onClick={() => replySendMutation.mutate()}
              >
                {replySendMutation.isPending ? 'Enviando…' : 'Enviar e-mail'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
