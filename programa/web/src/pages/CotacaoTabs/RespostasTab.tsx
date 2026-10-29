import { useConfirm } from '@/components/useConfirm';
import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import {
  createQuoteResponse,
  deleteQuoteResponse,
  effectiveOriginPort,
  INCOTERMS,
  isOriginOverride,
  listQuoteResponses,
  messageOf,
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
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { SupplierNotes } from '@/components/SupplierNotes';
import { CreditSupportModal } from './CreditSupportModal';
import { CreditSupportPanel } from './CreditSupportPanel';
import { PriceHistoryModal } from './PriceHistoryModal';

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

// Preco-alvo e' campo de texto (inputMode decimal): aceita virgula ou ponto.
// Vazio ou texto invalido vira null (igual ao antigo type="number", que entregava '').
function parseTargetPriceInput(value: string | undefined): number | null {
  const normalized = (value ?? '').trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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
  const [form, setForm] = useState<ResponseFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reply Modal
  const [replyTarget, setReplyTarget] = useState<QuoteResponse | null>(null);
  const [replySubject, setReplySubject] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [replyTargetPrice, setReplyTargetPrice] = useState('');
  // Target price POR ITEM (cotacoes multi-item) -- so' usado quando
  // `replyTarget.items.length > 1`; chave = QuoteResponseItem.id.
  const [replyItemTargets, setReplyItemTargets] = useState<Record<number, string>>({});
  const [replyPreviewData, setReplyPreviewData] = useState<QuoteResponseReplyPreview | null>(null);
  const [replyModalError, setReplyModalError] = useState<string | null>(null);

  // Modal de itens (pop-up ao clicar no fornecedor)
  const [itemsTarget, setItemsTarget] = useState<QuoteResponse | null>(null);
  const [creditTarget, setCreditTarget] = useState<QuoteResponse | null>(null); // modal montado so' quando aberto
  const [historyTarget, setHistoryTarget] = useState<QuoteResponse | null>(null); // idem: historico de precos

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
    mutationFn: (vars: {
      id: number;
      subject: string;
      message: string;
      targetPrice?: number | null;
      itemTargets?: { quoteResponseItemId: number; targetPrice: number | null }[];
    }) =>
      previewQuoteResponseReply(vars.id, {
        subject: vars.subject,
        message: vars.message,
        targetPrice: vars.targetPrice,
        itemTargets: vars.itemTargets,
      }),
    onSuccess: (data) => {
      setReplyPreviewData(data);
      // O assunto padrao (igual ao do envio inicial da cotacao) vem do backend;
      // o que o usuario ja digitou nunca e' sobrescrito.
      setReplySubject((prev) => (prev.trim() ? prev : data.subject));
      setReplyModalError(null);
    },
    onError: (err) => setReplyModalError(messageOf(err)),
  });

  // Multi-item (2+ QuoteResponseItem) troca o campo unico agregado por um
  // por item; caminho de 0/1 item continua no `targetPrice` agregado.
  function isMultiItemReply(r: QuoteResponse | null): boolean {
    return (r?.items?.length ?? 0) > 1;
  }

  function buildItemTargetsPayload(
    r: QuoteResponse,
    values: Record<number, string>,
  ): { quoteResponseItemId: number; targetPrice: number | null }[] {
    // Item indisponivel nao recebe preco-alvo (o backend tambem ignora).
    return (r.items ?? [])
      .filter((item) => !item.isUnavailable)
      .map((item) => ({
        quoteResponseItemId: item.id,
        targetPrice: parseTargetPriceInput(values[item.id]),
      }));
  }

  const replySendMutation = useMutation({
    mutationFn: () => {
      if (!replyTarget) throw new Error('Nenhuma proposta selecionada.');
      if (isMultiItemReply(replyTarget)) {
        return replyToQuoteResponse(replyTarget.id, {
          subject: replySubject,
          message: replyMessage,
          itemTargets: buildItemTargetsPayload(replyTarget, replyItemTargets),
        });
      }
      const parsedTargetPrice = parseTargetPriceInput(replyTargetPrice);
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
    setForm({
      ...emptyForm,
      quoteRequestId: String(quoteRequestId),
      currency: quoteRequestCurrency,
      exchangeRate: quoteRequestCurrency === 'BRL' ? '1' : '',
    });
    setFormError(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setForm(emptyForm);
    setFormError(null);
  }

  function openReplyModal(r: QuoteResponse) {
    setReplyTarget(r);
    // Assunto padrao vem do backend (mesmo do envio inicial); ver onSuccess do preview.
    setReplySubject('');
    setReplyMessage('');
    setReplyPreviewData(null);
    setReplyModalError(null);

    if (isMultiItemReply(r)) {
      const initialValues: Record<number, string> = {};
      (r.items ?? []).forEach((item) => {
        initialValues[item.id] = item.targetPrice != null ? String(item.targetPrice) : '';
      });
      setReplyItemTargets(initialValues);
      setReplyTargetPrice('');
      replyPreviewMutation.mutate({
        id: r.id,
        subject: '',
        message: '',
        itemTargets: buildItemTargetsPayload(r, initialValues),
      });
      return;
    }

    setReplyItemTargets({});
    setReplyTargetPrice(r.targetPrice != null ? String(r.targetPrice) : '');
    const initialTargetPrice = r.targetPrice != null ? Number(r.targetPrice) : null;
    replyPreviewMutation.mutate({ id: r.id, subject: '', message: '', targetPrice: initialTargetPrice });
  }

  function closeReplyModal() {
    setReplyTarget(null);
    setReplyItemTargets({});
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
    createMut.mutate(payload);
  }

  const replyTargetName = replyTarget
    ? replyTarget.supplier?.name ?? `Fornecedor #${replyTarget.supplierId}`
    : '';

  return (
    <div className="respostas-tab">
      <div className="respostas-tab__cabecalho">
        <h2 className="respostas-tab__titulo">Respostas da Cotação</h2>
        {canEditThis && (
          <button type="button" className="primary-button" onClick={openNew}>
            <Icon name="plus" size={16} strokeWidth={2.2} />
            Nova resposta
          </button>
        )}
      </div>

      {feedback && (
        <p
          className={feedback.kind === 'err' ? 'alert alert--error' : 'alert alert--success'}
          role={feedback.kind === 'err' ? 'alert' : 'status'}
        >
          {feedback.text}
        </p>
      )}

      {responsesQuery.isLoading && (
        <div className="empty-state">
          <p className="empty-state__text">Carregando respostas…</p>
        </div>
      )}
      {responsesQuery.isError && (
        <div
          className="empty-state empty-state--erro"
          role="alert"
        >
          <span className="empty-state__icon">
            <Icon name="alert-triangle" size={24} strokeWidth={1.7} />
          </span>
          <p className="empty-state__text">Erro ao carregar respostas.</p>
        </div>
      )}

      {!responsesQuery.isLoading && responses.length === 0 && (
        <div className="empty-state">
          <strong className="empty-state__title">Sem respostas ainda</strong>
          <p className="empty-state__text">
            {canManage && qrOpen
              ? 'Use o botão "+ Nova resposta" para cadastrar uma proposta.'
              : 'Aguarde o cadastro de respostas pelos fornecedores.'}
          </p>
        </div>
      )}

      {responses.length > 0 && (
        <div className="table-wrapper respostas-tab__tabela">
        <table className="table">
          <thead>
            <tr>
              <th>Fornecedor</th>
              <th>Incoterm</th>
              <th className="respostas-tab__num respostas-tab__th-pagamento">Condições de pagamento</th>
              <th className="respostas-tab__num">Lead time</th>
              <th className="respostas-tab__num">Ações</th>
            </tr>
          </thead>
          <tbody>
            {responses.map((r) => {
              const overrides = (r.items ?? []).filter((item) =>
                isOriginOverride(item.originPort, r.originPort),
              ).length;
              const allItems = r.items ?? [];
              const unavailable = allItems.filter((item) => item.isUnavailable).length;
              // DG informado pelo fornecedor (item indisponivel nunca conta como DG).
              const dg = allItems.filter((item) => item.isDangerousGood && !item.isUnavailable).length;
              return (
                <tr key={r.id}>
                  <td className="respostas-tab__fornecedor">
                    <div className="resposta-linha">
                      <button
                        type="button"
                        className="link-button resposta-fornecedor"
                        onClick={() => setItemsTarget(r)}
                      >
                        {r.supplier?.name ?? `Fornecedor #${r.supplierId}`}
                      </button>
                      {r.isWinner && (
                        <span className="badge badge--success resposta-vencedora">
                          <Icon name="trophy" size={12} strokeWidth={2} />
                          Vencedora
                        </span>
                      )}
                    </div>
                    <div className="resposta-meta">
                      {r.supplier?.country && (
                        <>
                          <span>{r.supplier.country}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <span>Origem: {r.originPort ?? '—'}</span>
                      {r.source === 'portal' && <span className="badge badge--info resposta-portal">via portal</span>}
                    </div>
                    <SupplierNotes notes={r.notes} />
                    {(overrides > 0 || unavailable > 0 || dg > 0) && (
                      <div className="resposta-tags" data-testid="response-alert-tags">
                        {overrides > 0 && (
                          <span className="badge badge--muted">
                            {overrides} {overrides === 1 ? 'item' : 'itens'} de outra origem
                          </span>
                        )}
                        {unavailable > 0 && (
                          <span className="badge badge--warning">
                            {unavailable === allItems.length
                              ? 'Todos os itens indisponíveis'
                              : `${unavailable} ${unavailable === 1 ? 'item indisponível' : 'itens indisponíveis'}`}
                          </span>
                        )}
                        {dg > 0 && (
                          <span className="badge badge--danger" data-testid="dg-count-badge">
                            {dg} {dg === 1 ? 'item DG' : 'itens DG'}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td><span className="chip chip--static">{r.offeredIncoterm}</span></td>
                  <td className="respostas-tab__num">
                    <span className="respostas-tab__mono">{formatNumber(r.paymentTermsDays)}</span> dias
                  </td>
                  <td className="respostas-tab__num">
                    {r.leadTimeDays != null ? (
                      <>
                        <span className="respostas-tab__mono">{formatNumber(r.leadTimeDays)}</span> dias
                      </>
                    ) : (
                      <span className="respostas-tab__vazio">—</span>
                    )}
                  </td>
                  <td className="respostas-tab__acoes">
                    <div className="row-actions row-actions--nowrap">
                      <button
                        type="button"
                        className="ghost-button ghost-button--sm"
                        onClick={() => openReplyModal(r)}
                        title="Responder (enviar e-mail ao fornecedor)"
                      >
                        Responder
                      </button>
                      <button
                        type="button"
                        className="ghost-button ghost-button--sm"
                        onClick={() => setHistoryTarget(r)}
                        title="Histórico de preços desta resposta"
                      >
                        Histórico
                      </button>
                      {canEditThis && (
                        <button type="button" className="ghost-button ghost-button--sm" onClick={() => setCreditTarget(r)}
                          disabled={!(r.items ?? []).some((item) => !item.isUnavailable)}
                          title={(r.items ?? []).some((item) => !item.isUnavailable) ? 'Encaminhar ao parceiro de crédito' : 'Resposta sem itens disponíveis'}>
                          Credit Support
                        </button>
                      )}
                      {canEditThis && (
                        <button
                          type="button"
                          className="ghost-button ghost-button--sm danger-button"
                          onClick={async () => {
                            if (await confirm('Apagar esta resposta?')) {
                              removeMut.mutate(r.id);
                            }
                          }}
                          disabled={removeMut.isPending}
                        >
                          Apagar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      <CreditSupportPanel quoteRequestId={quoteRequestId} responses={responses} />

      {/* MODAL DE NOVA RESPOSTA */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        size="wide"
        title="Nova resposta"
      >
        <form onSubmit={handleSubmit}>
          <div className="resposta-form">
            <div className="resposta-campo">
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
                    <option key={s.id} value={s.id}>{s.name}{s.country ? ` (${s.country})` : ''}</option>
                  ))}
              </select>
            </div>
            <div className="resposta-form__grade">
              <div className="resposta-campo">
                <label className="field-label" htmlFor="rf-price">Preço oferecido *</label>
                <input
                  id="rf-price"
                  className="input resposta-form__mono"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.offeredPrice}
                  onChange={(e) => setForm({ ...form, offeredPrice: e.target.value })}
                  required
                />
              </div>
              <div className="resposta-campo">
                <label className="field-label" htmlFor="rf-currency">Moeda *</label>
                <input
                  id="rf-currency"
                  className="input resposta-form__mono"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  maxLength={3}
                  required
                />
              </div>
              <div className="resposta-campo">
                <label className="field-label" htmlFor="rf-exchange">Câmbio (BRL/{form.currency || 'USD'})</label>
                <input
                  id="rf-exchange"
                  className="input resposta-form__mono"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form.exchangeRate}
                  onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
                />
              </div>
              <div className="resposta-campo">
                <label className="field-label" htmlFor="rf-incoterm">Incoterm *</label>
                <select
                  id="rf-incoterm"
                  className="select resposta-form__mono"
                  value={form.offeredIncoterm}
                  onChange={(e) => setForm({ ...form, offeredIncoterm: e.target.value as Incoterm })}
                  required
                >
                  {INCOTERMS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="resposta-campo">
                <label className="field-label" htmlFor="rf-payment">Prazo pagamento (dias) *</label>
                <input
                  id="rf-payment"
                  className="input resposta-form__mono"
                  type="number"
                  min="0"
                  step="1"
                  value={form.paymentTermsDays}
                  onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="resposta-form__grupos">
              <fieldset className="resposta-form__grupo">
                <legend>Custos</legend>
                <div className="resposta-form__grade resposta-form__grade--custos">
                  <div className="resposta-campo">
                    <label className="field-label" htmlFor="rf-freight">Frete</label>
                    <input
                      id="rf-freight"
                      className="input resposta-form__mono"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.freightCost}
                      onChange={(e) => setForm({ ...form, freightCost: e.target.value })}
                    />
                  </div>
                  <div className="resposta-campo">
                    <label className="field-label" htmlFor="rf-insurance">Seguro</label>
                    <input
                      id="rf-insurance"
                      className="input resposta-form__mono"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.insuranceCost}
                      onChange={(e) => setForm({ ...form, insuranceCost: e.target.value })}
                    />
                  </div>
                  <div className="resposta-campo">
                    <label className="field-label" htmlFor="rf-other">Outras taxas</label>
                    <input
                      id="rf-other"
                      className="input resposta-form__mono"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.otherFees}
                      onChange={(e) => setForm({ ...form, otherFees: e.target.value })}
                    />
                  </div>
                </div>
              </fieldset>
              <fieldset className="resposta-form__grupo">
                <legend>Impostos</legend>
                <div className="resposta-form__grade resposta-form__grade--impostos">
                  <div className="resposta-campo">
                    <label className="field-label" htmlFor="rf-ii">II (%)</label>
                    <input
                      id="rf-ii"
                      className="input resposta-form__mono"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.importDuty}
                      onChange={(e) => setForm({ ...form, importDuty: e.target.value })}
                    />
                  </div>
                  <div className="resposta-campo">
                    <label className="field-label" htmlFor="rf-ipi">IPI (%)</label>
                    <input
                      id="rf-ipi"
                      className="input resposta-form__mono"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.ipi}
                      onChange={(e) => setForm({ ...form, ipi: e.target.value })}
                    />
                  </div>
                  <div className="resposta-campo">
                    <label className="field-label" htmlFor="rf-pis">PIS (%)</label>
                    <input
                      id="rf-pis"
                      className="input resposta-form__mono"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.pis}
                      onChange={(e) => setForm({ ...form, pis: e.target.value })}
                    />
                  </div>
                  <div className="resposta-campo">
                    <label className="field-label" htmlFor="rf-cofins">COFINS (%)</label>
                    <input
                      id="rf-cofins"
                      className="input resposta-form__mono"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.cofins}
                      onChange={(e) => setForm({ ...form, cofins: e.target.value })}
                    />
                  </div>
                </div>
              </fieldset>
            </div>
            <div className="resposta-campo">
              <label className="field-label" htmlFor="rf-notes">Observações</label>
              <textarea
                id="rf-notes"
                className="textarea"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            {formError && <p className="alert alert--error" role="alert">{formError}</p>}
          </div>

          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={closeModal}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={submitting || createMut.isPending}>
              <Icon name="check" size={16} strokeWidth={2} />
              {submitting ? 'Cadastrando…' : 'Cadastrar resposta'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL DE RESPONDER E-MAIL */}
      <Modal
        isOpen={replyTarget !== null}
        onClose={closeReplyModal}
        size="wide"
        title={replyTarget ? `Responder ${replyTargetName}` : ''}
        subtitle={
          replyTarget ? (
            <>
              <span className="resposta-codigo">{requestCode}</span> · {productName}
            </>
          ) : undefined
        }
      >
        {replyTarget && (
          <>
            <div className="resposta-responder">
              <div className="resposta-campo">
                <label className="field-label" htmlFor="replySubject">
                  Assunto
                </label>
                <input
                  id="replySubject"
                  className="input"
                  value={replySubject}
                  onChange={(e) => setReplySubject(e.target.value)}
                />
              </div>

              <div className="resposta-responder__colunas">
                <div className="resposta-responder__coluna">
                  <div className="resposta-campo">
                    <label className="field-label" htmlFor="replyMessage">
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
                  </div>

                  {historyQuery.data && historyQuery.data.length > 0 && (
                    <div className="resposta-historico">
                      <h4 className="resposta-historico__titulo">Histórico de negociação</h4>
                      <ul className="resposta-historico__lista">
                        {historyQuery.data.map((h) => (
                          <li key={h.id}>
                            <span className="resposta-mono">
                              {new Date(h.sentAt).toLocaleString('pt-BR', {
                                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                              })}
                            </span>{' '}
                            —{' '}
                            <span className="resposta-mono resposta-historico__valor">
                              {formatCurrency(Number(h.targetPrice), replyTarget.currency || quoteRequestCurrency)}
                            </span>{' '}
                            (enviado por {h.sentBy?.name ?? 'desconhecido'})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {isMultiItemReply(replyTarget) ? (
                  <fieldset className="resposta-responder__alvos">
                    <legend>Preço-alvo por item (opcional)</legend>
                    <div className="resposta-responder__alvos-grade">
                      {(replyTarget.items ?? []).map((item) => (
                        <Fragment key={item.id}>
                          <label
                            className={
                              item.isUnavailable
                                ? 'field-label resposta-responder__alvo-rotulo resposta-responder__alvo-rotulo--indisponivel'
                                : 'field-label resposta-responder__alvo-rotulo'
                            }
                            htmlFor={`replyItemTarget-${item.id}`}
                          >
                            {item.productName || productName || requestCode}
                            {item.isUnavailable ? ' (temporariamente indisponível)' : ''}
                          </label>
                          <input
                            id={`replyItemTarget-${item.id}`}
                            className="input resposta-responder__alvo"
                            type="text"
                            inputMode="decimal"
                            disabled={Boolean(item.isUnavailable)}
                            value={item.isUnavailable ? '' : (replyItemTargets[item.id] ?? '')}
                            onChange={(e) =>
                              setReplyItemTargets((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                          />
                        </Fragment>
                      ))}
                    </div>
                    <p className="resposta-dica">
                      Preencher adiciona o pedido de redução de preço por item no e-mail.
                    </p>
                  </fieldset>
                ) : (
                  <div className="resposta-campo">
                    <label className="field-label" htmlFor="replyTargetPrice">
                      {replyTarget.items?.length === 1
                        ? `Preço-alvo — ${replyTarget.items[0]?.productName || productName || requestCode} (opcional)`
                        : 'Preço-alvo (opcional)'}
                    </label>
                    <input
                      id="replyTargetPrice"
                      className="input resposta-form__mono"
                      type="text"
                      inputMode="decimal"
                      value={replyTargetPrice}
                      onChange={(e) => setReplyTargetPrice(e.target.value)}
                    />
                    <p className="resposta-dica">
                      Preencher adiciona o bloco de pedido de redução de preço no e-mail.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <button
                  type="button"
                  className="ghost-button resposta-responder__atualizar"
                  disabled={replyPreviewMutation.isPending}
                  onClick={() => {
                    if (isMultiItemReply(replyTarget)) {
                      replyPreviewMutation.mutate({
                        id: replyTarget.id,
                        subject: replySubject,
                        message: replyMessage,
                        itemTargets: buildItemTargetsPayload(replyTarget, replyItemTargets),
                      });
                      return;
                    }
                    const parsedTargetPrice = parseTargetPriceInput(replyTargetPrice);
                    replyPreviewMutation.mutate({ id: replyTarget.id, subject: replySubject, message: replyMessage, targetPrice: parsedTargetPrice });
                  }}
                >
                  <Icon name="refresh" size={14} strokeWidth={1.9} />
                  {replyPreviewMutation.isPending ? 'Atualizando…' : 'Atualizar preview'}
                </button>
              </div>

              <div className="resposta-responder__previa-cab">
                <h3 className="resposta-responder__previa-titulo">Preview do e-mail</h3>
                {replyPreviewData ? (
                  <>
                    <p className="resposta-responder__linha">
                      Para: <strong>{replyPreviewData.to}</strong>
                      {replyPreviewData.cc.length > 0 && <> · CC: {replyPreviewData.cc.join(', ')}</>}
                    </p>
                    <p className="resposta-responder__linha">
                      Assunto: <strong>{replyPreviewData.subject}</strong>
                    </p>
                  </>
                ) : (
                  <p className="resposta-responder__linha">
                    {replyPreviewMutation.isPending ? 'Carregando preview…' : 'Sem preview ainda.'}
                  </p>
                )}
              </div>
              {replyPreviewData && (
                <iframe
                  sandbox=""
                  key={replyPreviewData.html.length}
                  title="preview-reply-email"
                  className="preview-frame resposta-previa"
                  srcDoc={replyPreviewData.html}
                />
              )}

              {replyModalError && (
                <p className="alert alert--error" role="alert">{replyModalError}</p>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={closeReplyModal}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={replySendMutation.isPending || !replySubject.trim()}
                onClick={() => replySendMutation.mutate()}
              >
                <Icon name="templates" size={16} strokeWidth={1.9} />
                {replySendMutation.isPending ? 'Enviando…' : 'Enviar e-mail'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* MODAL DE ITENS DA RESPOSTA */}
      <Modal
        isOpen={itemsTarget !== null}
        onClose={() => setItemsTarget(null)}
        size="wide"
        title={itemsTarget ? `Itens — ${itemsTarget.supplier?.name ?? `Fornecedor #${itemsTarget.supplierId}`}` : ''}
        subtitle={
          itemsTarget ? (
            <>
              <span className="resposta-codigo">{requestCode}</span> · {productName}
            </>
          ) : undefined
        }
      >
        {itemsTarget && (() => {
          const currency = itemsTarget.currency || quoteRequestCurrency;
          const rows = itemsTarget.items && itemsTarget.items.length > 0
            ? itemsTarget.items.map((item) => ({
                key: String(item.id),
                productName: item.productName || productName || requestCode,
                unavailable: Boolean(item.isUnavailable),
                dg: item.isUnavailable ? '—' : item.isDangerousGood ? 'DG' : 'Não',
                // Item indisponivel: valores gravados (0) nao sao exibidos.
                quantity: item.isUnavailable ? '—' : formatNumber(item.quantity),
                unitPrice: item.isUnavailable ? '—' : formatCurrency(item.unitPrice, currency),
                totalPrice: item.isUnavailable ? '—' : formatCurrency(item.totalPrice, currency),
                leadTimeDays: item.leadTimeDays != null && !item.isUnavailable ? formatNumber(item.leadTimeDays) : '—',
                origin: item.isUnavailable ? '—' : effectiveOriginPort(item.originPort, itemsTarget.originPort) ?? '—',
                originOverride: !item.isUnavailable && isOriginOverride(item.originPort, itemsTarget.originPort),
                incotermPrices:
                  !item.isUnavailable && item.incotermPrices && item.incotermPrices.length >= 2
                    ? item.incotermPrices
                        .map((p) => `${p.incoterm}: ${formatCurrency(Number(p.unitPrice), currency)}`)
                        .join(' · ')
                    : '—',
                notes: item.notes ?? null,
              }))
            : [{
                key: 'fallback',
                productName: productName || requestCode,
                unavailable: false,
                dg: 'Não',
                quantity: '—',
                unitPrice: formatCurrency(itemsTarget.offeredPrice, currency),
                totalPrice: formatCurrency(itemsTarget.offeredPrice, currency),
                leadTimeDays: itemsTarget.leadTimeDays != null ? formatNumber(itemsTarget.leadTimeDays) : '—',
                origin: itemsTarget.originPort ?? '—',
                originOverride: false,
                incotermPrices: '—',
                notes: null,
              }];
          const showDg = (itemsTarget.items ?? []).some(
            (item) => item.isDangerousGood && !item.isUnavailable,
          );
          const showIncotermPrices = (itemsTarget.items ?? []).some(
            (item) => !item.isUnavailable && (item.incotermPrices?.length ?? 0) >= 2,
          );
          const showOrigin = (itemsTarget.items ?? []).some(
            (item) =>
              !item.isUnavailable &&
              effectiveOriginPort(item.originPort, itemsTarget.originPort) !== null,
          );
          const showNotes = (itemsTarget.items ?? []).some((item) => (item.notes ?? '').trim() !== '');
          return (
            <div className="resposta-itens">
            <SupplierNotes notes={itemsTarget.notes} collapsible={false} testId="items-modal-notes" />
            <div className="table-wrapper resposta-itens__tabela">
              <table className="table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="resposta-itens__num">Qtd</th>
                    <th className="resposta-itens__num">Preço unit.</th>
                    <th className="resposta-itens__num">Total</th>
                    <th className="resposta-itens__num">Lead time</th>
                    {showDg && <th>DG</th>}
                    {showOrigin && <th>Origem</th>}
                    {showIncotermPrices && <th>Preços por incoterm</th>}
                    {showNotes && <th>Obs.</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className={row.unavailable ? 'resposta-itens__linha--indisponivel' : undefined}>
                      <td className="resposta-itens__produto">
                        <span className="resposta-itens__produto-linha">
                          {row.productName}
                          {row.unavailable && (
                            <span className="badge badge--warning">Temporariamente indisponível</span>
                          )}
                        </span>
                      </td>
                      <td className="resposta-itens__num resposta-itens__valor">{row.quantity}</td>
                      <td className="resposta-itens__num resposta-itens__valor">{row.unitPrice}</td>
                      <td className="resposta-itens__num resposta-itens__valor">{row.totalPrice}</td>
                      <td className="resposta-itens__num resposta-itens__valor">{row.leadTimeDays}</td>
                      {showDg && (
                        <td>
                          {row.dg === 'DG' ? <span className="badge badge--danger" data-testid="dg-item-badge">DG</span> : row.dg}
                        </td>
                      )}
                      {showOrigin && (
                        <td>
                          <span className="resposta-itens__produto-linha">
                            {row.origin}
                            {row.originOverride && (
                              <span className="badge badge--muted">difere da geral</span>
                            )}
                          </span>
                        </td>
                      )}
                      {showIncotermPrices && <td className="resposta-itens__incoterms">{row.incotermPrices}</td>}
                      {showNotes && <td className="resposta-itens__obs"><SupplierNotes notes={row.notes} label={null} testId="item-notes" /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          );
        })()}
      </Modal>

      {creditTarget && (
        <CreditSupportModal response={creditTarget} quoteRequestId={quoteRequestId} requestCode={requestCode} onClose={() => setCreditTarget(null)} />
      )}
      {historyTarget && (
        <PriceHistoryModal response={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
    </div>
  );
}
