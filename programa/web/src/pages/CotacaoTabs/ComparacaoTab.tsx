import { useConfirm } from '@/components/useConfirm';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import {
  closeQuoteRequest,
  executeComparison,
  messageOf,
  previewComparison,
  setManualWinner,
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

// --- Restyle visual (só apresentação) das linhas-card do preview/by-pass ---

// Iniciais do avatar do card by-pass: 1ª letra das 2 primeiras palavras, ou as
// 2 primeiras letras quando o nome é uma única palavra.
function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

// Percentual da mini-bar de score (totalScore já é limitado a 0-100 pelo backend).
function scorePercent(total: number): number {
  if (typeof total !== 'number' || Number.isNaN(total)) return 0;
  return Math.min(100, Math.max(0, total));
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function EnvelopeIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v16H4z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <rect x="7" y="12" width="3" height="6" rx="1" />
      <rect x="12" y="8" width="3" height="10" rx="1" />
      <rect x="17" y="14" width="3" height="4" rx="1" />
    </svg>
  );
}

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
          text: `Comparação registrada — adjudicação acima de R$ ${formatNumber(data.thresholdValue!)} requer aprovação de um gestor/admin antes de prosseguir.`,
        });
        return false;
      }
      return true;
    } catch (err) {
      setFeedback({ kind: 'err', text: messageOf(err) });
      return false;
    }
  }

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
      closeReviewModal();
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<ComparisonResult | null>(null);
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
      if (poTarget) {
        setReviewTarget(poTarget);
        setReviewOpen(true);
      }
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

  function closeReviewModal() {
    setReviewOpen(false);
    setReviewTarget(null);
    setPriceRating(0);
    setLeadTimeRating(0);
    setQualityRating(0);
    setReviewComment('');
    setNotifyLosers(false);
  }

  async function handleConcludeReview() {
    const ratingComplete = priceRating > 0 && leadTimeRating > 0 && qualityRating > 0;
    const review: SupplierReviewInput | null = reviewTarget && ratingComplete
      ? {
          supplierId: reviewTarget.supplierId,
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

  // Linhas-card do ranking do PREVIEW (ao vivo, gated=true sempre).
  function renderRankingCards(results: ComparisonResult[]) {
    return results.map((r, idx) => {
      const name = r.supplier?.name ?? `Fornecedor #${r.supplierId}`;
      const contactBits = [r.contact?.name, r.contact?.email].filter(Boolean) as string[];
      const contactLine = contactBits.length ? contactBits.join(' · ') : null;
      const percent = scorePercent(r.totalScore);
      return (
        <div
          key={`${r.quoteResponseId ?? r.supplierId}-${idx}`}
          className={r.isWinner ? 'cmp-row cmp-rankgrid cmp-row--winner' : 'cmp-row cmp-rankgrid'}
        >
          <div className={r.isWinner ? 'cmp-rank cmp-rank--winner' : 'cmp-rank'}>{idx + 1}</div>
          <div className="cmp-row__supplier">
            <div className="cmp-row__name-line">
              <span className="cmp-row__name">{name}</span>
              {r.isWinner && (
                <span className="cmp-winner-badge">
                  <TrophyIcon />
                  Vencedora
                </span>
              )}
            </div>
            {contactLine && <span className="cmp-row__contact">{contactLine}</span>}
          </div>
          <div className="cmp-row__price">{formatNumber(r.offeredPrice)}</div>
          <div>
            <span className="cmp-incoterm-pill">{r.offeredIncoterm}</span>
          </div>
          <div className="cmp-row__payment">{r.paymentTermsDays} dias</div>
          <div className="cmp-row__landed">{formatCurrency(r.totalLandedCost, 'BRL')}</div>
          <div className="cmp-scorebar">
            <div className="cmp-scorebar__row">
              <span>Score</span>
              <strong>{formatNumber(r.totalScore, 1)}</strong>
            </div>
            <div className="cmp-scorebar__track">
              <div className="cmp-scorebar__fill" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <div className={r.isWinner ? 'cmp-row__actions cmp-row__actions--stacked' : 'cmp-row__actions'}>
            {r.quoteResponseId ? (
              r.isWinner ? (
                <>
                  <button
                    type="button"
                    className="cmp-btn cmp-btn--primary"
                    onClick={() => handleRowSendPo(r, true)}
                    title={`Enviar Ordem de Compra para ${r.contact?.email ?? ''}`}
                  >
                    <DocIcon />
                    Enviar Ordem de Compra
                  </button>
                  <button
                    type="button"
                    className="cmp-btn cmp-btn--ghost"
                    onClick={() => handleRowReply(r, true)}
                    title={`Responder ${r.contact?.email ?? ''} para fechar o pedido`}
                  >
                    <EnvelopeIcon />
                    Responder
                  </button>
                </>
              ) : (
                canCompare && (
                  <button
                    type="button"
                    className="cmp-btn cmp-btn--link"
                    onClick={() => openWinnerModal(r)}
                  >
                    Definir como vencedora
                  </button>
                )
              )
            ) : (
              <span className="cmp-row__no-email" title="Sem proposta vinculada para responder.">
                Sem e-mail do fornecedor
              </span>
            )}
          </div>
        </div>
      );
    });
  }

  const replyTargetName = replyTarget
    ? replyTarget.supplier?.name ?? `Fornecedor #${replyTarget.supplierId}`
    : '';
  const winnerTargetName = winnerTarget
    ? winnerTarget.supplier?.name ?? `Fornecedor #${winnerTarget.supplierId}`
    : '';
  const reviewTargetName = reviewTarget
    ? reviewTarget.supplier?.name ?? `Fornecedor #${reviewTarget.supplierId}`
    : '';
  const reviewRatingStarted = priceRating > 0 || leadTimeRating > 0 || qualityRating > 0;
  const reviewRatingComplete = priceRating > 0 && leadTimeRating > 0 && qualityRating > 0;

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

      <div className="cmp-card">
        <div className="cmp-head">
          <div className="cmp-head__info">
            <span className="cmp-eyebrow">SQ Química · Comparação</span>
            <h2 className="cmp-title">Comparação de fornecedores</h2>
            <div className="cmp-head__meta">
              <span className="cmp-pill">{requestCode}</span>
              {productName && <span className="cmp-head__product">{productName}</span>}
            </div>
          </div>
          <div className="cmp-live">
            <span className="cmp-live__dot" aria-hidden="true" />
            {responseCount} respostas · ao vivo
          </div>
        </div>

        <div className="cmp-criteria">
          <div className="cmp-criteria__head">
            <span className="cmp-criteria__label">Critérios de comparação</span>
            <span className="cmp-criteria__hint">Escolha até 2 — o ranking recalcula sozinho</span>
          </div>
          <div className="cmp-criteria__toggles" role="group" aria-label="Critérios de comparação">
            {CRITERIA.map((c) => {
              const isSelected = criteria.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="switch"
                  aria-checked={isSelected}
                  className={isSelected ? 'cmp-toggle cmp-toggle--active' : 'cmp-toggle'}
                  onClick={() => toggleCriterion(c.id)}
                  title={c.id === 'quality' ? 'Fornecedores sem avaliações prévias recebem nota 0 neste critério.' : undefined}
                >
                  {isSelected && <CheckIcon />}
                  {c.label}
                </button>
              );
            })}
          </div>
          <p className="cmp-criteria__note">
            Selecione de 1 a 2 critérios. A comparação recalcula automaticamente.
          </p>
        </div>

        <div className="cmp-body">
        {canConclude && quoteRequestStatus === 'open' && (
          <div className="cmp-conclude-bar">
            <button
              type="button"
              className="cmp-btn cmp-btn--ghost"
              onClick={() => {
                setReviewTarget(rankedResults.find((r) => r.isWinner) ?? null);
                setReviewOpen(true);
              }}
              title="Avalia a vencedora (opcional) e fecha a cotação."
            >
              Concluir cotação
            </button>
          </div>
        )}

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
          <div className="cmp-empty">
            <div className="cmp-empty__icon">
              <ChartIcon />
            </div>
            <div className="cmp-empty__text">
              <strong>Nenhuma resposta ainda</strong>
              <span>
                Assim que os fornecedores responderem pelo portal, o ranking aparece aqui e recalcula
                sozinho conforme os critérios.
              </span>
            </div>
          </div>
        )}

        {previewQuery.data && responseCount === 1 && (() => {
          const only = previewResults[0];
          const bypassName = only?.supplier?.name ?? (only ? `Fornecedor #${only.supplierId}` : '—');
          const bypassContactBits = only
            ? ([only.contact?.name, only.contact?.email].filter(Boolean) as string[])
            : [];
          const bypassContactLine = bypassContactBits.length ? bypassContactBits.join(' · ') : null;
          return (
            <div className="cmp-bypass">
              <div className="cmp-bypass-alert">
                <div className="cmp-bypass-alert__icon">
                  <AlertIcon />
                </div>
                <div className="cmp-bypass-alert__text">
                  <strong>Apenas um fornecedor respondeu — sem comparação.</strong>
                  <span>
                    Não há como comparar sem uma segunda proposta. Você pode seguir com este
                    fornecedor enviando a Ordem de Compra diretamente.
                  </span>
                </div>
              </div>

              {only && (
                <div className="cmp-bypass-supplier">
                  <div className="cmp-bypass-supplier__info">
                    <div className="cmp-bypass-supplier__avatar">{initialsOf(bypassName)}</div>
                    <div className="cmp-bypass-supplier__name">
                      <strong>{bypassName}</strong>
                      {bypassContactLine && <span>{bypassContactLine}</span>}
                    </div>
                  </div>
                  <div className="cmp-bypass-supplier__stats">
                    <div className="cmp-bypass-supplier__stat">
                      <span>Preço</span>
                      <strong>{formatNumber(only.offeredPrice)}</strong>
                    </div>
                    <div className="cmp-bypass-supplier__stat">
                      <span>Landed</span>
                      <strong>{formatCurrency(only.totalLandedCost, 'BRL')}</strong>
                    </div>
                  </div>
                </div>
              )}

              <div className="cmp-bypass-actions">
                <button
                  type="button"
                  className="cmp-btn cmp-btn--primary"
                  onClick={() => handleBypassSendPo()}
                  disabled={bypassPending}
                >
                  <DocIcon />
                  {bypassPending ? 'Processando…' : 'Enviar Ordem de Compra'}
                </button>
              </div>
            </div>
          );
        })()}

        {previewQuery.data && responseCount >= 2 && (
          <>
            {previewPendingApproval && (
              <p className="alert alert--warning" style={{ marginBottom: 12 }}>
                A vencedora calculada tem landed cost acima de R$ {formatNumber(previewQuery.data?.thresholdValue ?? null)} e exigirá aprovação de um gestor/admin ao prosseguir com uma ação.
              </p>
            )}
            <div className="cmp-rankgrid cmp-rankgrid--head">
              <div>#</div>
              <div>Fornecedor</div>
              <div>Preço</div>
              <div>Incoterm</div>
              <div>Pagamento</div>
              <div>Landed (BRL)</div>
              <div>Score</div>
              <div></div>
            </div>
            <div className="cmp-rows">{renderRankingCards(rankedResults)}</div>
          </>
        )}
        </div>
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

      <Modal
        isOpen={reviewOpen}
        onClose={closeReviewModal}
        title={reviewTarget ? `Avaliar ${reviewTargetName}` : 'Concluir cotação'}
      >
        <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 0 }}>
          {requestCode} · {productName}
        </p>

        {reviewTarget && (
          <div className="cmp-review">
            <div className="cmp-review__hint">Avaliação (opcional)</div>
            <div className="cmp-review__grid">
              <span>Preço</span>
              <StarRating value={priceRating} onChange={setPriceRating} label="Preço" />
              <span>Prazo</span>
              <StarRating value={leadTimeRating} onChange={setLeadTimeRating} label="Prazo" />
              <span>Qualidade</span>
              <StarRating value={qualityRating} onChange={setQualityRating} label="Qualidade" />
            </div>
            <textarea
              className="textarea cmp-review__comment"
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder="Comentário (opcional)"
              rows={2}
            />
            {reviewRatingStarted && !reviewRatingComplete && (
              <div className="cmp-review__warn">
                Dê nota nas três dimensões ou deixe todas em branco.
              </div>
            )}
          </div>
        )}

        <label className="cmp-review__notify">
          <input
            type="checkbox"
            checked={notifyLosers}
            onChange={(e) => setNotifyLosers(e.target.checked)}
          />
          Avisar não selecionados
        </label>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={closeReviewModal}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleConcludeReview}
            disabled={closeMut.isPending || (reviewRatingStarted && !reviewRatingComplete)}
            title="Fecha a cotação (ação separada da comparação)."
          >
            {closeMut.isPending ? 'Concluindo…' : 'Concluir cotação'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
