import { useConfirm } from '@/components/useConfirm';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import {
  approveAward,
  closeQuoteRequest,
  executeComparison,
  listComparisons,
  messageOf,
  previewComparison,
  setManualWinner,
  type ComparisonRecord,
  type ComparisonResult,
  type ComparisonWeights,
  type SupplierReviewInput,
} from '@/services/quoteResponses';
import StarRating from '@/components/StarRating';
import {
  previewQuoteResponseReply,
  replyToQuoteResponse,
  sendPurchaseOrder,
  type QuoteResponseReplyPreview,
} from '@/services/dispatch';
import { Modal } from '@/components/Modal';

function formatNumber(value: number | undefined | null, fractionDigits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatCurrency(value: number | undefined | null, currency = 'BRL'): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Espelha o limite do backend (app.ts / QuoteResponseController) -- valida
// no cliente antes de gastar o upload/base64 num arquivo que sera rejeitado.
const MAX_PO_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Toggles de critério: padrão só Preço; regra mín 1 / máx 2 selecionados. Cada
// selecionado entra com peso 1, os demais com peso 0 (os 4 sempre são enviados).
type Criterion = 'price' | 'payment' | 'incoterm' | 'quality';

const CRITERIA: { id: Criterion; label: string }[] = [
  { id: 'price', label: 'Preço' },
  { id: 'payment', label: 'Condição de pagamento' },
  { id: 'incoterm', label: 'Incoterm' },
  { id: 'quality', label: 'Qualidade' },
];

function computeWeights(criteria: Criterion[]): ComparisonWeights {
  return {
    priceWeight: criteria.includes('price') ? 1 : 0,
    paymentTermsWeight: criteria.includes('payment') ? 1 : 0,
    incotermWeight: criteria.includes('incoterm') ? 1 : 0,
    qualityWeight: criteria.includes('quality') ? 1 : 0,
  };
}

// Debounce ~350ms pro recálculo automático da comparação ao vivo.
const PREVIEW_DEBOUNCE_MS = 350;

export function ComparacaoTab({
  quoteRequestId,
  quoteRequestStatus,
  productName,
  requestCode,
}: {
  quoteRequestId: number;
  quoteRequestStatus: 'open' | 'closed';
  productName: string | null;
  requestCode: string;
}) {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { user } = useAuth();
  const role = user?.role;
  const canCompare = role === 'admin' || role === 'comprador' || role === 'gestor';
  const canConclude = role === 'admin' || role === 'gestor';

  const [criteria, setCriteria] = useState<Criterion[]>(['price']);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set());

  const history = useQuery({
    queryKey: ['comparisons', quoteRequestId],
    queryFn: () => listComparisons(quoteRequestId),
  });

  const weights = computeWeights(criteria);
  const [debouncedWeights, setDebouncedWeights] = useState<ComparisonWeights>(weights);

  // Recalculo automatico ao vivo: a primeira busca acontece no mount (o
  // estado inicial já reflete os pesos default); mudanças de toggle depois
  // do mount entram no debounce de ~350ms antes de disparar o preview de novo.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedWeights(computeWeights(criteria));
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [criteria]);

  const previewQuery = useQuery({
    queryKey: ['comparison-preview', quoteRequestId, debouncedWeights],
    queryFn: () => previewComparison(quoteRequestId, debouncedWeights),
    staleTime: 30_000,
  });

  function toggleCriterion(id: Criterion) {
    setCriteria((current) => {
      const isSelected = current.includes(id);
      if (isSelected) {
        if (current.length <= 1) {
          setFeedback({ kind: 'warn', text: 'Selecione ao menos 1 critério.' });
          return current;
        }
        return current.filter((c) => c !== id);
      }
      if (current.length >= 2) {
        setFeedback({ kind: 'warn', text: 'Selecione no máximo 2 critérios.' });
        return current;
      }
      return [...current, id];
    });
  }

  // Executa e persiste a comparação com os pesos atuais (cria QuoteComparison
  // de fato). Chamado só na ação (Enviar PO / Responder / Concluir) -- o
  // recálculo ao vivo usa somente o preview, que não persiste nada.
  async function persistBeforeAction(): Promise<boolean> {
    try {
      const data = await executeComparison(quoteRequestId, weights);
      await qc.invalidateQueries({ queryKey: ['comparisons', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-request', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-responses'] });
      if (data.pendingApproval) {
        setFeedback({
          kind: 'warn',
          text: `Comparação registrada — adjudicação acima de R$ ${formatNumber(data.thresholdValue!)} requer aprovação de um gestor/admin antes de prosseguir. Aprove no histórico de comparações abaixo.`,
        });
        return false;
      }
      return true;
    } catch (err) {
      setFeedback({ kind: 'err', text: messageOf(err) });
      return false;
    }
  }

  const approveMut = useMutation({
    mutationFn: (comparisonId: number) => approveAward(quoteRequestId, comparisonId),
    onSuccess: async () => {
      setFeedback({ kind: 'ok', text: 'Adjudicação aprovada com sucesso.' });
      await qc.invalidateQueries({ queryKey: ['comparisons', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-request', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-responses'] });
    },
    onError: (err) => setFeedback({ kind: 'err', text: messageOf(err) }),
  });

  // Vencedor manual (override): permite escolher uma proposta diferente da
  // calculada pela comparação, exigindo motivo quando ela diverge.
  const [winnerTarget, setWinnerTarget] = useState<ComparisonResult | null>(null);
  const [winnerReason, setWinnerReason] = useState('');
  const [winnerModalError, setWinnerModalError] = useState<string | null>(null);

  const setWinnerMut = useMutation({
    mutationFn: (vars: { quoteResponseId: number; reason: string | null }) =>
      setManualWinner(quoteRequestId, { quoteResponseId: vars.quoteResponseId, reason: vars.reason }),
    onSuccess: async () => {
      setFeedback({ kind: 'ok', text: 'Vencedora definida manualmente.' });
      closeWinnerModal();
      await qc.invalidateQueries({ queryKey: ['comparisons', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-request', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-responses'] });
    },
    onError: (err) => setWinnerModalError(messageOf(err)),
  });

  function openWinnerModal(r: ComparisonResult) {
    setWinnerTarget(r);
    setWinnerReason('');
    setWinnerModalError(null);
  }

  function closeWinnerModal() {
    setWinnerTarget(null);
    setWinnerReason('');
    setWinnerModalError(null);
  }

  // F12: Concluir cotação (fechar).
  const closeMut = useMutation({
    mutationFn: (vars: { notifyLosers: boolean; review?: SupplierReviewInput | null }) =>
      closeQuoteRequest(quoteRequestId, { notifyLosers: vars.notifyLosers, review: vars.review }),
    onSuccess: async (_data, vars) => {
      setFeedback({
        kind: 'ok',
        text: vars.notifyLosers
          ? 'Cotação concluída. Fornecedores não selecionados foram avisados.'
          : 'Cotação concluída (fechada).',
      });
      await qc.invalidateQueries({ queryKey: ['comparisons', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-request', quoteRequestId] });
    },
    onError: (err) => setFeedback({ kind: 'err', text: messageOf(err) }),
  });

  const [replyTarget, setReplyTarget] = useState<ComparisonResult | null>(null);
  const [notifyLosers, setNotifyLosers] = useState(false);
  const [priceRating, setPriceRating] = useState(0);
  const [leadTimeRating, setLeadTimeRating] = useState(0);
  const [qualityRating, setQualityRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [replyPreviewData, setReplyPreviewData] = useState<QuoteResponseReplyPreview | null>(null);
  const [replyModalError, setReplyModalError] = useState<string | null>(null);

  const replyPreviewMutation = useMutation({
    mutationFn: (vars: { id: number; subject: string; message: string }) =>
      previewQuoteResponseReply(vars.id, { subject: vars.subject, message: vars.message }),
    onSuccess: (data) => {
      setReplyPreviewData(data);
      setReplyModalError(null);
    },
    onError: (err) => setReplyModalError(messageOf(err)),
  });

  const replySendMutation = useMutation({
    mutationFn: () => {
      if (!replyTarget?.quoteResponseId) throw new Error('Proposta sem ID.');
      return replyToQuoteResponse(replyTarget.quoteResponseId, { subject: replySubject, message: replyMessage });
    },
    onSuccess: () => {
      setFeedback({
        kind: 'ok',
        text: 'E-mail enviado ao fornecedor. Após o retorno, clique em “Concluir cotação” para fechá-la.',
      });
      closeReplyModal();
    },
    onError: (err) => setReplyModalError(messageOf(err)),
  });

  function openReplyModal(r: ComparisonResult) {
    if (!r.quoteResponseId) return;
    const itemName = productName || requestCode;
    const defaultSubject = `${itemName} - SQ QUIMICA - ${r.supplier?.name}`;
    setReplyTarget(r);
    setReplySubject(defaultSubject);
    setReplyMessage('');
    setReplyPreviewData(null);
    setReplyModalError(null);
    replyPreviewMutation.mutate({ id: r.quoteResponseId, subject: defaultSubject, message: '' });
  }

  function closeReplyModal() {
    setReplyTarget(null);
    setReplyPreviewData(null);
    setReplyModalError(null);
  }

  // Botao "Enviar Ordem de Compra" -- so' aparece sobre a proposta vencedora
  // (r.isWinner). Anexo = upload de PDF em base64 (so'-envio, sem storage
  // duravel). Forwarder = texto digitado na hora, no modal.
  const [poTarget, setPoTarget] = useState<ComparisonResult | null>(null);
  const [poSubject, setPoSubject] = useState('');
  const [poForwarderInfo, setPoForwarderInfo] = useState('');
  const [poMessage, setPoMessage] = useState('');
  const [poFileName, setPoFileName] = useState('');
  const [poFileBase64, setPoFileBase64] = useState('');
  const [poFileSize, setPoFileSize] = useState(0);
  const [poModalError, setPoModalError] = useState<string | null>(null);

  const poSendMutation = useMutation({
    mutationFn: () => {
      if (!poTarget?.quoteResponseId) throw new Error('Proposta sem ID.');
      return sendPurchaseOrder(poTarget.quoteResponseId, {
        subject: poSubject,
        message: poMessage,
        forwarderInfo: poForwarderInfo,
        fileName: poFileName,
        contentBase64: poFileBase64,
        fileType: 'application/pdf',
        fileSize: poFileSize,
      });
    },
    onSuccess: () => {
      setFeedback({ kind: 'ok', text: 'Ordem de Compra enviada ao fornecedor.' });
      closePoModal();
    },
    onError: (err) => setPoModalError(messageOf(err)),
  });

  function openPoModal(r: ComparisonResult) {
    if (!r.quoteResponseId) return;
    const itemName = productName || requestCode;
    setPoTarget(r);
    setPoSubject(`Purchase Order - ${itemName}`);
    setPoForwarderInfo('');
    setPoMessage('');
    setPoFileName('');
    setPoFileBase64('');
    setPoFileSize(0);
    setPoModalError(null);
  }

  function closePoModal() {
    setPoTarget(null);
    setPoFileName('');
    setPoFileBase64('');
    setPoFileSize(0);
    setPoModalError(null);
  }

  function handlePoFileChange(file: File | null) {
    if (!file) {
      setPoFileName('');
      setPoFileBase64('');
      setPoFileSize(0);
      return;
    }
    if (file.type !== 'application/pdf') {
      setPoModalError('Selecione um arquivo PDF.');
      return;
    }
    if (file.size > MAX_PO_FILE_SIZE_BYTES) {
      setPoModalError('O PDF excede o limite de 10MB.');
      return;
    }
    setPoModalError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setPoFileName(file.name);
      setPoFileBase64(String(reader.result ?? ''));
      setPoFileSize(file.size);
    };
    reader.onerror = () => setPoModalError('Não foi possível ler o arquivo selecionado.');
    reader.readAsDataURL(file);
  }

  function toggleExpanded(id: number) {
    setExpandedHistory((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Botão só reage ao gate na tabela do preview (ao vivo, não persistido);
  // no histórico (comparações já persistidas) o clique abre o modal direto.
  async function handleRowReply(r: ComparisonResult, gated: boolean) {
    if (!r.quoteResponseId) return;
    if (gated) {
      const ok = await persistBeforeAction();
      if (!ok) return;
    }
    openReplyModal(r);
  }

  async function handleRowSendPo(r: ComparisonResult, gated: boolean) {
    if (!r.quoteResponseId) return;
    if (gated) {
      const ok = await persistBeforeAction();
      if (!ok) return;
    }
    openPoModal(r);
  }

  function renderResultRows(
    results: ComparisonResult[],
    comparison?: ComparisonRecord,
    options?: { gated?: boolean },
  ) {
    if (results.length === 0) {
      return (
        <tr>
          <td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>
            Sem resultados registrados.
          </td>
        </tr>
      );
    }
    return results.map((r, idx) => (
      <tr key={`${r.quoteResponseId ?? r.supplierId}-${idx}`}>
        <td>{idx + 1}</td>
        <td>
          <strong>{r.supplier?.name ?? `Fornecedor #${r.supplierId}`}</strong>
        </td>
        <td>{formatNumber(r.offeredPrice)}</td>
        <td><span className="badge">{r.offeredIncoterm}</span></td>
        <td>{r.paymentTermsDays} dias</td>
        <td>
          <div>{formatCurrency(r.totalLandedCost, 'BRL')}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            CIF: {formatCurrency(r.cifValue, 'BRL')}
          </div>
        </td>
        <td>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            Preço {formatNumber(r.priceScore, 2)} · Pagto {formatNumber(r.paymentTermsScore, 2)} ·
            Inc {formatNumber(r.incotermScore, 2)} · Qual {formatNumber(r.qualityScore, 2)}
          </div>
          <strong>{formatNumber(r.totalScore, 2)}</strong>
        </td>
        <td>
          {r.isWinner ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
              <span className="badge">Vencedora</span>
              {r.quoteResponseId ? (
                <>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => handleRowReply(r, Boolean(options?.gated))}
                    style={{ fontSize: 12, padding: '2px 10px' }}
                    title={`Responder ${r.contact?.email ?? ''} para fechar o pedido`}
                  >
                    Responder
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => handleRowSendPo(r, Boolean(options?.gated))}
                    style={{ fontSize: 12, padding: '2px 10px' }}
                    title={`Enviar Ordem de Compra para ${r.contact?.email ?? ''}`}
                  >
                    Enviar Ordem de Compra
                  </button>
                </>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--ink-soft)' }} title="Sem proposta vinculada para responder.">
                  Sem e-mail do fornecedor
                </span>
              )}
            </div>
          ) : comparison?.approvalStatus === 'pending' && r.quoteResponseId === comparison.winnerQuoteResponseId ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
              <span className="badge badge--warn">Aguardando aprovação</span>
              {(role === 'admin' || role === 'gestor') && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => approveMut.mutate(comparison.id)}
                  style={{ fontSize: 12, padding: '2px 10px' }}
                  disabled={approveMut.isPending}
                >
                  {approveMut.isPending ? 'Aprovando...' : 'Aprovar adjudicação'}
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
              <span className="badge badge--muted">—</span>
              {canCompare && r.quoteResponseId && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => openWinnerModal(r)}
                  style={{ fontSize: 12, padding: '2px 10px' }}
                >
                  Definir como vencedora
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
    ));
  }

  const records = history.data?.comparisons ?? [];
  const latest = records[0];
  const replyTargetName = replyTarget
    ? replyTarget.supplier?.name ?? `Fornecedor #${replyTarget.supplierId}`
    : '';
  const winnerTargetName = winnerTarget
    ? winnerTarget.supplier?.name ?? `Fornecedor #${winnerTarget.supplierId}`
    : '';

  // Tabela principal renderiza o PREVIEW (calculado ao vivo, não persistido),
  // não o histórico. isWinner é derivado do winnerQuoteResponseId + pendingApproval
  // -- enquanto a adjudicação depender de aprovação, nenhuma linha marca "Vencedora".
  const previewResults = previewQuery.data?.results ?? [];
  const responseCount = previewQuery.data?.responseCount ?? 0;
  const previewPendingApproval = previewQuery.data?.pendingApproval ?? false;
  const previewWinnerId = previewQuery.data?.winnerQuoteResponseId ?? null;
  const rankedResults = previewResults.map((r) => ({
    ...r,
    isWinner: !previewPendingApproval && r.quoteResponseId === previewWinnerId,
  }));

  const [bypassPending, setBypassPending] = useState(false);

  // By-pass de 1 fornecedor: sem comparação, marca vencedor manualmente e
  // abre direto o modal de Ordem de Compra (sem motivo, sem persistir comparação).
  async function handleBypassSendPo() {
    const only = previewResults[0];
    if (!only?.quoteResponseId) return;
    setBypassPending(true);
    try {
      await setManualWinner(quoteRequestId, { quoteResponseId: only.quoteResponseId });
      await qc.invalidateQueries({ queryKey: ['quote-request', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-responses'] });
      openPoModal(only);
    } catch (err) {
      setFeedback({ kind: 'err', text: messageOf(err) });
    } finally {
      setBypassPending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {feedback && (
        <p className={feedback.kind === 'err' ? 'alert alert--error' : 'alert alert--success'}>
          {feedback.text}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--ink)' }}>Critérios de comparação</h2>
      </div>

      <div className="form-grid" role="group" aria-label="Critérios de comparação" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {CRITERIA.map((c) => {
          const isSelected = criteria.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              role="switch"
              aria-checked={isSelected}
              className={isSelected ? 'chip chip--active' : 'chip'}
              onClick={() => toggleCriterion(c.id)}
              title={c.id === 'quality' ? 'Fornecedores sem avaliações prévias recebem nota 0 neste critério.' : undefined}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>
        Selecione de 1 a 2 critérios. A comparação recalcula automaticamente.
      </p>

      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>Comparação atual</h2>

        {canConclude && quoteRequestStatus === 'open' && latest && (() => {
          const winner = latest.results.find((r) => r.isWinner);
          const winnerName = winner?.supplier?.name ?? `Fornecedor #${winner?.supplierId ?? ''}`;
          const ratingStarted = priceRating > 0 || leadTimeRating > 0 || qualityRating > 0;
          const ratingComplete = priceRating > 0 && leadTimeRating > 0 && qualityRating > 0;

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', marginBottom: 16 }}>
              {winner && (
                <div className="card" style={{ padding: 12, width: '100%', maxWidth: 360, background: 'var(--surface-alt)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Avaliar {winnerName} <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>(opcional)</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 6, alignItems: 'center', fontSize: 13 }}>
                    <span>Preço</span>
                    <StarRating value={priceRating} onChange={setPriceRating} label="Preço" />
                    <span>Prazo</span>
                    <StarRating value={leadTimeRating} onChange={setLeadTimeRating} label="Prazo" />
                    <span>Qualidade</span>
                    <StarRating value={qualityRating} onChange={setQualityRating} label="Qualidade" />
                  </div>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Comentário (opcional)"
                    rows={2}
                    style={{ width: '100%', marginTop: 8, fontSize: 13 }}
                  />
                  {ratingStarted && !ratingComplete && (
                    <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
                      Dê nota nas três dimensões ou deixe todas em branco.
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={notifyLosers}
                    onChange={(e) => setNotifyLosers(e.target.checked)}
                  />
                  Avisar não selecionados
                </label>
                <button
                  type="button"
                  className="primary-button"
                  onClick={async () => {
                    const review: SupplierReviewInput | null = winner && ratingComplete
                      ? {
                          supplierId: winner.supplierId,
                          priceRating,
                          leadTimeRating,
                          qualityRating,
                          comment: reviewComment.trim() || null,
                        }
                      : null;
                    const msg = notifyLosers
                      ? 'Concluir esta cotação? Ela será fechada e os fornecedores não selecionados receberão um e-mail.'
                      : 'Concluir esta cotação? Ela será fechada.';
                    if (await confirm(msg)) {
                      const ok = await persistBeforeAction();
                      if (!ok) return;
                      closeMut.mutate({ notifyLosers, review });
                    }
                  }}
                  disabled={closeMut.isPending || (ratingStarted && !ratingComplete)}
                  title="Fecha a cotação (ação separada da comparação)."
                >
                  {closeMut.isPending ? 'Concluindo…' : 'Concluir cotação'}
                </button>
              </div>
            </div>
          );
        })()}

        {previewQuery.isLoading && <p>Calculando comparação…</p>}
        {previewQuery.isError && (
          <div className="empty-state">
            <p>Não foi possível calcular a comparação.</p>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
              Verifique sua conexão e tente novamente.
            </p>
            <button className="ghost-button" onClick={() => previewQuery.refetch()}>Tentar novamente</button>
          </div>
        )}

        {previewQuery.data && responseCount === 0 && (
          <div className="empty-state">
            <strong>Nenhuma proposta recebida ainda.</strong>
            <p>A comparação aparece aqui assim que houver ao menos uma resposta de fornecedor.</p>
          </div>
        )}

        {previewQuery.data && responseCount === 1 && (
          <div className="card" style={{ padding: 16 }}>
            <p style={{ marginTop: 0 }}>
              <strong>Apenas um fornecedor respondeu — sem comparação.</strong>
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => handleBypassSendPo()}
              disabled={bypassPending}
            >
              {bypassPending ? 'Processando…' : 'Enviar Ordem de Compra'}
            </button>
          </div>
        )}

        {previewQuery.data && responseCount >= 2 && (
          <>
            {previewPendingApproval && (
              <p className="alert alert--warning" style={{ marginBottom: 12 }}>
                A vencedora calculada tem landed cost acima de R$ {formatNumber(previewQuery.data?.thresholdValue ?? null)} e exigirá aprovação de um gestor/admin ao prosseguir com uma ação.
              </p>
            )}
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Fornecedor</th>
                  <th>Preço</th>
                  <th>Incoterm</th>
                  <th>Pagto</th>
                  <th>Landed (BRL)</th>
                  <th>Scores</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>{renderResultRows(rankedResults, undefined, { gated: true })}</tbody>
            </table>
          </>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>Histórico de comparações</h2>
        
        {records.length === 0 && !history.isLoading && !history.isError && (
          <div className="empty-state">
            <strong>Sem histórico</strong>
            <p>Quando comparações forem executadas, o histórico aparecerá aqui.</p>
          </div>
        )}

        {records.map((rec: ComparisonRecord) => {
          const winner = rec.results.find((r) => r.isWinner);
          const isOpen = expandedHistory.has(rec.id);
          return (
            <article
              key={rec.id}
              className="card"
              style={{ marginBottom: 12, background: 'var(--surface-alt)', borderStyle: 'dashed' }}
            >
              <div className="page-header" style={{ marginBottom: 8 }}>
                <div>
                  <p className="eyebrow">Comparação #{rec.id}</p>
                  <h3>{formatDateTime(rec.createdAt)}</h3>
                  <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                    Executada por {rec.executedBy?.name ?? 'Sistema'}.
                  </p>
                </div>
                <div className="page-header__actions">
                  <span className="chip chip--static">Preço {formatNumber(rec.priceWeight, 2)}</span>
                  <span className="chip chip--static">Pagto {formatNumber(rec.paymentTermsWeight, 2)}</span>
                  <span className="chip chip--static">Inc {formatNumber(rec.incotermWeight, 2)}</span>
                  <span className="chip chip--static">{rec.results.length} propostas</span>
                  {winner ? (
                    <span className="badge">{`Vencedora: ${winner.supplier?.name ?? `Fornecedor #${winner.supplierId}`}`}</span>
                  ) : (
                    <span className="badge badge--muted">Sem vencedora</span>
                  )}
                </div>
              </div>
              <button type="button" className="ghost-button" onClick={() => toggleExpanded(rec.id)}>
                {isOpen ? 'Ocultar detalhes' : 'Ver detalhes'}
              </button>
              {isOpen && (
                <div style={{ marginTop: 12 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Fornecedor</th>
                        <th>Preço</th>
                        <th>Incoterm</th>
                        <th>Pagto</th>
                        <th>Landed (BRL)</th>
                        <th>Scores</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>{renderResultRows(rec.results, rec)}</tbody>
                  </table>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <Modal
        isOpen={replyTarget !== null}
        onClose={closeReplyModal}
        size="wide"
        title={replyTarget ? `Responder ${replyTargetName}` : ''}
      >
        {replyTarget && (
          <>
            <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 0 }}>
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
              placeholder="Opcional. Ex.: confirmando o fechamento do pedido. Aparece no corpo do e-mail."
            />

            <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
              <button
                type="button"
                className="ghost-button"
                disabled={replyPreviewMutation.isPending}
                onClick={() =>
                  replyTarget.quoteResponseId &&
                  replyPreviewMutation.mutate({
                    id: replyTarget.quoteResponseId,
                    subject: replySubject,
                    message: replyMessage,
                  })
                }
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
                {replySendMutation.isPending ? 'Enviando…' : 'Enviar e-mail'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {poTarget && (
        <Modal
          isOpen
          onClose={closePoModal}
          size="wide"
          title={`Enviar Ordem de Compra — ${poTarget.supplier?.name ?? `Fornecedor #${poTarget.supplierId}`}`}
        >
          <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 0 }}>
            {requestCode} · {productName}
          </p>

          <label className="field-label" htmlFor="poSubject" style={{ marginTop: 12 }}>
            Assunto
          </label>
          <input
            id="poSubject"
            className="input"
            value={poSubject}
            onChange={(e) => setPoSubject(e.target.value)}
          />

          <label className="field-label" htmlFor="poFile" style={{ marginTop: 12 }}>
            PDF da Ordem de Compra
          </label>
          <input
            id="poFile"
            type="file"
            accept="application/pdf"
            onChange={(e) => handlePoFileChange(e.target.files?.[0] ?? null)}
          />
          {poFileName && (
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
              Selecionado: {poFileName} ({(poFileSize / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}

          <label className="field-label" htmlFor="poForwarderInfo" style={{ marginTop: 12 }}>
            Contato do despachante (forwarder)
          </label>
          <textarea
            id="poForwarderInfo"
            className="textarea"
            rows={3}
            value={poForwarderInfo}
            onChange={(e) => setPoForwarderInfo(e.target.value)}
            placeholder="Nome, e-mail e telefone do despachante responsável pelo embarque."
          />

          <label className="field-label" htmlFor="poMessage" style={{ marginTop: 12 }}>
            Mensagem
          </label>
          <textarea
            id="poMessage"
            className="textarea"
            rows={3}
            value={poMessage}
            onChange={(e) => setPoMessage(e.target.value)}
            placeholder="Opcional. Aparece no corpo do e-mail, acima da referência da cotação."
          />

          {poModalError && (
            <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{poModalError}</p>
          )}

          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={closePoModal}>
              Cancelar
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={
                poSendMutation.isPending ||
                !poSubject.trim() ||
                !poFileBase64 ||
                !poForwarderInfo.trim()
              }
              onClick={() => poSendMutation.mutate()}
            >
              {poSendMutation.isPending ? 'Enviando…' : 'Enviar Ordem de Compra'}
            </button>
          </div>
        </Modal>
      )}

      {winnerTarget && (
        <Modal
          isOpen
          onClose={closeWinnerModal}
          title={`Definir ${winnerTargetName} como vencedora`}
        >
          <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 0 }}>
            {requestCode} · {productName}
          </p>

          <label className="field-label" htmlFor="winnerReason" style={{ marginTop: 12 }}>
            Motivo
          </label>
          <textarea
            id="winnerReason"
            className="textarea"
            rows={4}
            value={winnerReason}
            onChange={(e) => setWinnerReason(e.target.value)}
            placeholder="Obrigatório se esta proposta divergir da vencedora calculada pela comparação."
          />

          {winnerModalError && (
            <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{winnerModalError}</p>
          )}

          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={closeWinnerModal}>
              Cancelar
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={setWinnerMut.isPending || !winnerTarget.quoteResponseId}
              onClick={() =>
                winnerTarget.quoteResponseId &&
                setWinnerMut.mutate({
                  quoteResponseId: winnerTarget.quoteResponseId,
                  reason: winnerReason.trim() || null,
                })
              }
            >
              {setWinnerMut.isPending ? 'Salvando…' : 'Definir como vencedora'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
