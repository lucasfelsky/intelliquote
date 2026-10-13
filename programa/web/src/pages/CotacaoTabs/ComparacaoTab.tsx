import { useConfirm } from '@/components/useConfirm';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import {
  approveAward,
  candidateKey,
  closeQuoteRequest,
  executeComparison,
  messageOf,
  previewComparison,
  setManualWinner,
  type ExcludedComparisonResponse,
  type QuantityMismatchInfo,
  type ComparisonResult,
  type ComparisonWeights,
  type SupplierReviewInput,
} from '@/services/quoteResponses';
import StarRating from '@/components/StarRating';
import {
  previewQuoteResponseReply,
  replyToQuoteResponse,
  type QuoteResponseReplyPreview,
} from '@/services/dispatch';
import { creditSupportQueryKey } from '@/services/creditSupport';
import { Modal } from '@/components/Modal';
import { InfoPopover } from '@/components/InfoPopover';
import { PurchaseOrderModal, type PurchaseOrderTarget } from './PurchaseOrderModal';

function formatNumber(value: number | undefined | null, fractionDigits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

// Lead time exibido = maior leadTimeDays entre os itens da proposta (quando
// o pedido inteiro chega). Sem dado -> "—".
function formatLeadTime(days: number | undefined | null): string {
  return typeof days === 'number' && days > 0 ? `${days} dias` : '—';
}

// Origem informada pelo fornecedor (informativa; nao entra em score/landed cost):
// "Origem: <geral>" + ate 3 itens com origem propria ("· Produto: Porto") e "+N".
const MAX_ORIGIN_OVERRIDES_SHOWN = 3;
function formatOriginLine(r: ComparisonResult): string {
  const overrides = (r.itemOrigins ?? []).filter((entry) => entry.overridden);
  const shown = overrides.slice(0, MAX_ORIGIN_OVERRIDES_SHOWN).map(
    (entry) => ` · ${entry.productName ?? `Item ${entry.quoteRequestItemId}`}: ${entry.originPort ?? '—'}`,
  );
  const rest = overrides.length - shown.length;
  return `Origem: ${r.originPort ?? '—'}${shown.join('')}${rest > 0 ? ` · +${rest}` : ''}`;
}

// O modal de vencedora manual so precisa destes campos; assim uma proposta fora do ranking
// (item faltando) tambem pode ser escolhida. PR4a: `creditSupportRequestId`/`creditPartner`
// identificam a alternativa via parceiro (Credit Support) da mesma resposta.
type WinnerTarget = Pick<
  ComparisonResult,
  'quoteResponseId' | 'supplierId' | 'supplier' | 'creditSupportRequestId' | 'creditPartner'
>;

// PR4a: linha "via Parceiro" (alternativa de Credit Support). PR4b: a vencedora via parceiro
// recebe a Ordem de Compra (modal com alvo parceiro).
// Alvo do "Responder": linha do ranking ou entrada de "Fora do ranking" (contatos so' na linha).
type ReplyTargetInfo = WinnerTarget & Partial<Pick<ComparisonResult, 'contact' | 'partnerContact'>>;

function isViaPartner(r: { creditSupportRequestId?: number | null }): boolean {
  return typeof r.creditSupportRequestId === 'number' && r.creditSupportRequestId > 0;
}

// Quantidade divergente (todos os itens presentes): entra no ranking com o unitario cotado x
// quantidade PEDIDA; a linha mostra um chip que abre o detalhe. Ausente (historico) ou vazio -> null.
function quantityMismatchList(r: ComparisonResult): QuantityMismatchInfo[] | null {
  const mismatches = r.quantityMismatches ?? [];
  if (!r.quantityAdjusted || mismatches.length === 0) return null;
  return mismatches;
}

const formatQty = (value: number): string => value.toLocaleString('pt-BR');

// Contato (nome · e-mail) em spans separados: o nome nao quebra e o e-mail pode quebrar em qualquer ponto.
function ContactLine({ name, email }: { name?: string | null; email?: string | null }) {
  if (!name && !email) return null;
  return (
    <span className="cmp-row__contact">
      {name && <span className="cmp-row__contact-name">{name}</span>}
      {name && email ? ' · ' : ''}
      {email && <span className="cmp-row__email">{email}</span>}
    </span>
  );
}

// Motivo de uma proposta ter ficado fora do ranking, em portugues, so com as partes presentes.
function excludedReasonText(entry: ExcludedComparisonResponse): string {
  const names = (items: { quoteRequestItemId: number; productName: string }[]) =>
    items.map((item) => item.productName || `Item ${item.quoteRequestItemId}`).join(', ');
  const unavailable = entry.unavailableItems.length
    ? `temporariamente indisponível: ${names(entry.unavailableItems)}`
    : null;
  // PR4a: so alternativas via parceiro ficam 'stale' (o painel de Credit Support mostra o mesmo aviso).
  if (entry.reason === 'stale') {
    return 'a proposta do fornecedor mudou depois do encaminhamento (revogue e encaminhe de novo)';
  }
  if (entry.reason !== 'partial') {
    return `Temporariamente indisponível: ${names(entry.unavailableItems)}`;
  }
  const partial = entry.partial;
  const parts: string[] = [];
  if (partial?.missingItems.length) parts.push(`faltam itens: ${names(partial.missingItems)}`);
  if (partial?.quantityMismatches.length) {
    parts.push(
      `quantidade diferente em ${partial.quantityMismatches
        .map((m) => `${m.productName || `Item ${m.quoteRequestItemId}`} (pedido ${m.requested}, cotado ${m.offered})`)
        .join(', ')}`,
    );
  }
  if (partial?.extraItems.length) parts.push(`item não pertence mais à cotação: ${names(partial.extraItems)}`);
  if (partial?.duplicateItems.length) parts.push(`item duplicado: ${names(partial.duplicateItems)}`);
  if (unavailable) parts.push(unavailable);
  return `Proposta incompleta: ${parts.join('; ')}`;
}

// Proposta parcial so por item faltando pode ser escolhida manualmente como vencedora
// (decisao 2026-10-12); item extra/duplicado (dado inconsistente) nao.
function canPickExcludedAsWinner(entry: ExcludedComparisonResponse): boolean {
  if (entry.reason !== 'partial' || entry.unavailableItems.length > 0) return false;
  const partial = entry.partial;
  return !!partial && partial.extraItems.length === 0 && partial.duplicateItems.length === 0;
}

// Selo DG (informativo; nao entra em score/landed cost): itens que o fornecedor marcou como
// Dangerous Goods. dgItems ausente (historico persistido) ou vazio -> sem selo.
function DgSeal({ result }: { result: ComparisonResult }) {
  const dgItems = result.dgItems ?? [];
  if (dgItems.length === 0) return null;
  const names = dgItems.map((entry) => entry.productName || `Item ${entry.quoteRequestItemId}`).join(', ');
  return (
    <span
      className="badge"
      data-testid="dg-seal"
      title={`Informado como DG pelo fornecedor: ${names}`}
      style={{ alignSelf: 'flex-start', marginTop: 2 }}
    >
      DG · {dgItems.length}
    </span>
  );
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

function WarningIcon() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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
      await qc.invalidateQueries({ queryKey: ['comparison-preview', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['comparisons', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-request', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-responses'] });
      if (data.pendingApproval) {
        if (canConclude) {
          const approved = await confirm({
            title: 'Aprovar adjudicação',
            message: `A alçada de R$ ${formatNumber(data.thresholdValue!)} exige aprovação (limite excedido ou câmbio indisponível). Aprovar a proposta recomendada e continuar?`,
            confirmText: 'Aprovar e continuar',
          });
          if (!approved) return false;
          await approveAward(quoteRequestId, data.comparisonId);
          await qc.invalidateQueries({ queryKey: ['comparison-preview', quoteRequestId] });
          await qc.invalidateQueries({ queryKey: ['comparisons', quoteRequestId] });
          await qc.invalidateQueries({ queryKey: ['quote-responses'] });
          return true;
        }
        setFeedback({
          kind: 'warn',
          text: `Comparação registrada — a alçada de R$ ${formatNumber(data.thresholdValue!)} exige aprovação de gestor/admin (limite excedido ou câmbio indisponível).`,
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
  const [winnerTarget, setWinnerTarget] = useState<WinnerTarget | null>(null);
  const [winnerReason, setWinnerReason] = useState('');
  const [winnerModalError, setWinnerModalError] = useState<string | null>(null);

  const setWinnerMut = useMutation({
    mutationFn: (vars: { quoteResponseId: number; creditSupportRequestId?: number | null; reason: string | null }) =>
      setManualWinner(quoteRequestId, {
        quoteResponseId: vars.quoteResponseId,
        // PR4a: alternativa via parceiro -> envia a identidade composta; direta -> chave ausente.
        ...(vars.creditSupportRequestId ? { creditSupportRequestId: vars.creditSupportRequestId } : {}),
        reason: vars.reason,
      }),
    onSuccess: async () => {
      setFeedback({ kind: 'ok', text: 'Vencedora definida manualmente.' });
      closeWinnerModal();
      await qc.invalidateQueries({ queryKey: ['comparison-preview', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['comparisons', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-request', quoteRequestId] });
      await qc.invalidateQueries({ queryKey: ['quote-responses'] });
    },
    onError: (err) => setWinnerModalError(messageOf(err)),
  });

  function openWinnerModal(r: WinnerTarget) {
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

  const [replyTarget, setReplyTarget] = useState<ReplyTargetInfo | null>(null);
  const [notifyLosers, setNotifyLosers] = useState(false);
  const [priceRating, setPriceRating] = useState(0);
  const [leadTimeRating, setLeadTimeRating] = useState(0);
  const [qualityRating, setQualityRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<WinnerTarget | null>(null);
  const [replySubject, setReplySubject] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [replyPreviewData, setReplyPreviewData] = useState<QuoteResponseReplyPreview | null>(null);
  const [replyModalError, setReplyModalError] = useState<string | null>(null);

  const replyPreviewMutation = useMutation({
    mutationFn: (vars: { id: number; subject: string; message: string }) =>
      previewQuoteResponseReply(vars.id, { subject: vars.subject, message: vars.message }),
    onSuccess: (data) => {
      setReplyPreviewData(data);
      // O assunto padrao (igual ao do envio inicial da cotacao) vem do backend;
      // o que o usuario ja digitou nunca e' sobrescrito.
      setReplySubject((prev) => (prev.trim() ? prev : data.subject));
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

  function openReplyModal(r: ReplyTargetInfo) {
    if (!r.quoteResponseId) return;
    setReplyTarget(r);
    // Assunto padrao vem do backend (mesmo do envio inicial); ver onSuccess do preview.
    setReplySubject('');
    setReplyMessage('');
    setReplyPreviewData(null);
    setReplyModalError(null);
    replyPreviewMutation.mutate({ id: r.quoteResponseId, subject: '', message: '' });
  }

  function closeReplyModal() {
    setReplyTarget(null);
    setReplyPreviewData(null);
    setReplyModalError(null);
  }

  // Botao "Enviar Ordem de Compra" -- so' aparece sobre a proposta vencedora
  // (r.isWinner). O modal (PDF, forwarder, mensagem) vive em PurchaseOrderModal.
  const [poTarget, setPoTarget] = useState<PurchaseOrderTarget | null>(null);

  function openPoModal(r: PurchaseOrderTarget) {
    if (!r.quoteResponseId) return;
    setPoTarget(r);
  }

  function handlePoSent(target: PurchaseOrderTarget) {
    const toPartner = isViaPartner(target);
    setFeedback({
      kind: 'ok',
      text: toPartner
        ? 'Ordem de Compra enviada ao parceiro de crédito.'
        : 'Ordem de Compra enviada ao fornecedor.',
    });
    // O painel Credit Support mostra "PO enviada" (derivado do MailLog).
    if (toPartner) void qc.invalidateQueries({ queryKey: creditSupportQueryKey(quoteRequestId) });
    setReviewTarget(target);
    setReviewOpen(true);
    setPoTarget(null);
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
    if (comparableCount < 2) {
      // Sem 2ª proposta COMPLETA não há comparação a persistir -- persistBeforeAction
      // sempre falharia no gate de "pelo menos duas propostas completas" do backend.
      const ok = await confirm({
        title: 'Concluir com uma só resposta?',
        message:
          excludedResponses.length > 0
            ? 'Esta cotação tem menos de duas propostas completas (as demais têm item indisponível ou estão incompletas e ficaram fora do ranking), então não há comparação. Tem certeza que deseja concluí-la?'
            : 'Esta cotação teve apenas uma resposta, então não há comparação. Tem certeza que deseja concluí-la?',
        confirmText: 'Concluir mesmo assim',
        cancelText: 'Voltar',
      });
      if (!ok) return;
      closeMut.mutate({ notifyLosers, review });
      return;
    }
    const msg = notifyLosers
      ? 'Concluir esta cotação? Ela será fechada e os fornecedores não selecionados receberão um e-mail.'
      : 'Concluir esta cotação? Ela será fechada.';
    if (await confirm(msg)) {
      // Escolha manual vigente: persistBeforeAction regravaria o isWinner pelo score e
      // desfaria a escolha; a vencedora ja esta gravada, entao so' fecha.
      if (manualWinner) {
        closeMut.mutate({ notifyLosers, review });
        return;
      }
      const ok = await persistBeforeAction();
      if (!ok) return;
      closeMut.mutate({ notifyLosers, review });
    }
  }

  // Botão só reage ao gate na tabela do preview (ao vivo, não persistido);
  // no histórico (comparações já persistidas) o clique abre o modal direto.
  async function handleRowReply(r: ReplyTargetInfo, gated: boolean) {
    if (!r.quoteResponseId) return;
    if (gated) {
      const ok = await persistBeforeAction();
      if (!ok) return;
    }
    openReplyModal(r);
  }

  async function handleRowSendPo(r: PurchaseOrderTarget, gated: boolean) {
    if (!r.quoteResponseId) return;
    if (gated) {
      const ok = await persistBeforeAction();
      if (!ok) return;
    }
    openPoModal(r);
  }

  // Linhas-card do ranking do PREVIEW (ao vivo). Vencedora = do score (gated: regrava antes de agir)
  // ou a escolha manual vigente (sem gate: executeComparison desfaria a escolha).
  function renderRankingCards(results: ComparisonResult[]) {
    return results.map((r, idx) => {
      const name = r.supplier?.name ?? `Fornecedor #${r.supplierId}`;
      const viaPartner = isViaPartner(r);
      // PR4a: na linha via parceiro o contato exibido e o do parceiro (quem respondeu).
      const contactSource = viaPartner ? r.partnerContact : r.contact;
      const qtyMismatches = quantityMismatchList(r);
      const percent = scorePercent(r.totalScore);
      // Chave composta: a direta e a via parceiro compartilham o mesmo quoteResponseId.
      const rowKey = candidateKey(r);
      return (
        <div
          key={rowKey}
          ref={(el) => {
            if (el) rowRefs.current.set(rowKey, el);
            else rowRefs.current.delete(rowKey);
          }}
          className={r.isWinner ? 'cmp-row cmp-rankgrid cmp-row--winner' : 'cmp-row cmp-rankgrid'}
        >
          <div className={r.isWinner ? 'cmp-rank cmp-rank--winner' : 'cmp-rank'}>{idx + 1}</div>
          <div className="cmp-row__supplier">
            <div className="cmp-row__name-line">
              <span className="cmp-row__name">{name}</span>
              {viaPartner && (
                <span
                  className="badge"
                  data-testid="via-partner"
                  title="Alternativa de Credit Support: preço e prazo cotados pelo parceiro sobre a proposta deste fornecedor."
                >
                  via {r.creditPartner?.name ?? 'parceiro'} · Credit Support
                </span>
              )}
              {viaPartner && r.validityExpired && (
                <span className="badge badge--warning" data-testid="partner-validity-expired">
                  Validade do parceiro vencida
                </span>
              )}
              {r.isWinner && (
                <span className="cmp-winner-badge">
                  <TrophyIcon />
                  {manualWinner
                    ? 'Vencedora (escolha manual)'
                    : previewPendingApproval
                      ? 'Recomendada · requer aprovação'
                      : 'Vencedora'}
                </span>
              )}
              {qtyMismatches && (
                <InfoPopover
                  testId="qty-adjusted"
                  contentTestId="qty-adjusted-details"
                  label="Qtd divergente: ver itens com quantidade diferente da pedida"
                  trigger={
                    <>
                      <WarningIcon />
                      Qtd divergente
                    </>
                  }
                >
                  <strong>Quantidade divergente</strong>
                  <ul className="info-popover__list">
                    {qtyMismatches.map((m) => (
                      <li key={m.quoteRequestItemId}>
                        <strong>{m.productName || `Item ${m.quoteRequestItemId}`}</strong>: pedido {formatQty(m.requested)}, cotado {formatQty(m.offered)}
                      </li>
                    ))}
                  </ul>
                  <span>O ranking usa o unitário × quantidade pedida.</span>
                </InfoPopover>
              )}
            </div>
            <ContactLine name={contactSource?.name} email={contactSource?.email} />
            <span className="cmp-row__contact">{formatOriginLine(r)}</span>
            <DgSeal result={r} />
          </div>
          <div className="cmp-row__price">{formatNumber(r.offeredPrice)}</div>
          <div>
            <span className="cmp-incoterm-pill">{r.offeredIncoterm}</span>
          </div>
          <div className="cmp-row__payment">{r.paymentTermsDays} dias</div>
          <div className="cmp-row__leadtime">{formatLeadTime(r.leadTimeDays)}</div>
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
                viaPartner ? (
                  // PR4b: PO ao parceiro. Sem "Responder" (o e-mail iria ao fornecedor).
                  <button
                    type="button"
                    className="cmp-btn cmp-btn--primary"
                    onClick={() => handleRowSendPo(r, !manualWinner)}
                    title={`Enviar Ordem de Compra ao parceiro ${r.creditPartner?.name ?? ''} (${r.partnerContact?.email ?? 'contato principal'})`}
                    data-testid="po-partner"
                  >
                    <DocIcon />
                    Enviar Ordem de Compra
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="cmp-btn cmp-btn--primary"
                      onClick={() => handleRowSendPo(r, !manualWinner)}
                      title={`Enviar Ordem de Compra para ${r.contact?.email ?? ''}`}
                    >
                      <DocIcon />
                      Enviar Ordem de Compra
                    </button>
                    <button
                      type="button"
                      className="cmp-btn cmp-btn--ghost"
                      onClick={() => handleRowReply(r, !manualWinner)}
                      title={`Responder ${r.contact?.email ?? ''} para fechar o pedido`}
                    >
                      <EnvelopeIcon />
                      Responder
                    </button>
                  </>
                )
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
    ? `${winnerTarget.supplier?.name ?? `Fornecedor #${winnerTarget.supplierId}`}${
        isViaPartner(winnerTarget) ? ` via ${winnerTarget.creditPartner?.name ?? 'parceiro'}` : ''
      }`
    : '';
  const reviewTargetName = reviewTarget
    ? reviewTarget.supplier?.name ?? `Fornecedor #${reviewTarget.supplierId}`
    : '';
  const reviewRatingStarted = priceRating > 0 || leadTimeRating > 0 || qualityRating > 0;
  const reviewRatingComplete = priceRating > 0 && leadTimeRating > 0 && qualityRating > 0;

  // Tabela principal renderiza o PREVIEW (calculado ao vivo, não persistido),
  // não o histórico. A recomendada mantém suas ações, mas persistBeforeAction
  // exige aprovação explícita de gestor/admin antes de abrir PO/resposta.
  const previewResults = previewQuery.data?.results ?? [];
  const rankingCurrency = previewResults[0]?.currency ?? '';
  const rankingCurrencyLabel = rankingCurrency === 'USD' ? 'US$' : rankingCurrency === 'BRL' ? 'R$' : rankingCurrency;
  const basketLabel = `Total dos itens${rankingCurrencyLabel ? ` (${rankingCurrencyLabel})` : ''}`;
  const responseCount = previewQuery.data?.responseCount ?? 0;
  // Propostas com item "Temporarily unavailable" ficam FORA do ranking (backend).
  const excludedResponses = previewQuery.data?.excluded ?? [];
  // Candidatos que realmente entram no ranking (as excluidas nao contam). PR4a: o backend
  // devolve `candidateCount` (diretas + alternativas via parceiro); fallback = contrato antigo.
  const comparableCount = previewQuery.data?.candidateCount ?? (responseCount - excludedResponses.length);
  const previewPendingApproval = previewQuery.data?.pendingApproval ?? false;
  const previewWinnerId = previewQuery.data?.winnerQuoteResponseId ?? null;
  // PR4a: identidade composta (a direta e a via parceiro compartilham o quoteResponseId).
  const previewWinnerKey = `${previewWinnerId}:${previewQuery.data?.winnerCreditSupportRequestId ?? 0}`;
  // Escolha manual vigente (vencedora gravada via setManualWinner): a tela mostra ESSA vencedora,
  // esteja ela no ranking ou em "Fora do ranking". Gravada automatica => segue o score atual.
  const persistedWinner = previewQuery.data?.persistedWinner ?? null;
  const manualWinner = persistedWinner?.manual ? persistedWinner : null;
  const manualKey = manualWinner
    ? `${manualWinner.quoteResponseId}:${manualWinner.creditSupportRequestId ?? 0}`
    : null;
  const excludedWinner = manualKey
    ? excludedResponses.find((entry) => candidateKey(entry) === manualKey) ?? null
    : null;
  const rankedResults = previewResults.map((r) => ({
    ...r,
    isWinner: manualKey ? candidateKey(r) === manualKey : candidateKey(r) === previewWinnerKey,
  })).sort((a, b) => Number(b.isWinner) - Number(a.isWinner) || b.totalScore - a.totalScore || a.offeredPrice - b.offeredPrice);

  // Animação de reordenação (FLIP leve, CSS puro, sem lib): guarda a posição
  // (getBoundingClientRect) de cada linha por key estável e, quando a ordem
  // muda, aplica um transform inicial que anima até 0 via transition.
  // Desligado sob prefers-reduced-motion.
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const rankOrderKey = rankedResults.map((r) => candidateKey(r)).join('|');
  useLayoutEffect(() => {
    const prevRects = prevRectsRef.current;
    const nextRects = new Map<string, DOMRect>();
    rowRefs.current.forEach((el, key) => nextRects.set(key, el.getBoundingClientRect()));
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReducedMotion) {
      nextRects.forEach((rect, key) => {
        const prev = prevRects.get(key);
        const el = rowRefs.current.get(key);
        if (prev && el) {
          const deltaY = prev.top - rect.top;
          if (deltaY !== 0) {
            el.style.transition = 'none';
            el.style.transform = `translateY(${deltaY}px)`;
            requestAnimationFrame(() => {
              el.style.transition = 'transform 320ms ease';
              el.style.transform = '';
            });
          }
        }
      });
    }
    prevRectsRef.current = nextRects;
  }, [rankOrderKey]);

  // Desfaz a escolha manual: regrava a vencedora pelo score dos criterios ATUAIS (mesmo
  // executeComparison das demais acoes, com o fluxo de alcada/aprovacao do persistBeforeAction).
  async function handleUseScoreWinner() {
    const ok = await confirm({
      title: 'Usar vencedora pelo score?',
      message: 'A escolha manual será descartada e a vencedora passa a ser a 1ª do ranking com os critérios atuais.',
      confirmText: 'Usar vencedora pelo score',
    });
    if (!ok) return;
    const persisted = await persistBeforeAction();
    if (!persisted) return;
    setFeedback({ kind: 'ok', text: 'Vencedora definida pelo score dos critérios atuais.' });
  }

  const [bypassPending, setBypassPending] = useState(false);

  // By-pass de 1 fornecedor: sem comparação, marca vencedor manualmente e
  // abre direto o modal de Ordem de Compra (sem motivo, sem persistir comparação).
  // PR4a: se o único candidato é via parceiro, marca a alternativa (identidade composta);
  // PR4b: o modal de PO abre com alvo parceiro.
  async function handleBypassSendPo() {
    const only = previewResults[0];
    if (!only?.quoteResponseId) return;
    setBypassPending(true);
    try {
      await setManualWinner(quoteRequestId, {
        quoteResponseId: only.quoteResponseId,
        ...(isViaPartner(only) ? { creditSupportRequestId: only.creditSupportRequestId ?? undefined } : {}),
      });
      await qc.invalidateQueries({ queryKey: ['comparison-preview', quoteRequestId] });
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
              {productName && <span className="cmp-head__product">{productName}</span>}
            </div>
          </div>
          <div className="cmp-head__aside">
            <div className="cmp-live">
              <span className="cmp-live__dot" aria-hidden="true" />
              {responseCount} respostas · ao vivo
            </div>
            {canConclude && quoteRequestStatus === 'open' && (
              <button
                type="button"
                className="cmp-btn cmp-btn--ghost"
                onClick={() => {
                  setReviewTarget(rankedResults.find((r) => r.isWinner) ?? excludedWinner ?? null);
                  setReviewOpen(true);
                }}
                title="Avalia a vencedora (opcional) e fecha a cotação."
              >
                Concluir cotação
              </button>
            )}
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
            {' '}Preço considera todos os itens e quantidades na moeda da proposta, sem conversão cambial, frete adicional ou impostos estimados.
          </p>
        </div>

        <div className="cmp-body">
        {previewQuery.isLoading && <p>Calculando comparação…</p>}
        {previewQuery.isError && (
          <div className="empty-state">
            <p>Não foi possível calcular a comparação.</p>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
              {messageOf(previewQuery.error)}
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

        {previewQuery.data && responseCount > 0 && comparableCount === 0 && (
          <div className="cmp-bypass">
            <div className="cmp-bypass-alert">
              <div className="cmp-bypass-alert__icon">
                <AlertIcon />
              </div>
              <div className="cmp-bypass-alert__text">
                <strong>Nenhuma proposta completa para comparar.</strong>
                <span>
                  Todas as propostas têm item indisponível ou estão incompletas e ficaram fora do ranking.
                </span>
              </div>
            </div>
          </div>
        )}

        {previewQuery.data && comparableCount === 1 && (() => {
          const only = previewResults[0];
          const bypassName = only?.supplier?.name ?? (only ? `Fornecedor #${only.supplierId}` : '—');
          const bypassViaPartner = !!only && isViaPartner(only);
          const bypassContactSource = bypassViaPartner ? only?.partnerContact : only?.contact;
          return (
            <div className="cmp-bypass">
              <div className="cmp-bypass-alert">
                <div className="cmp-bypass-alert__icon">
                  <AlertIcon />
                </div>
                <div className="cmp-bypass-alert__text">
                  <strong>
                    {excludedResponses.length > 0
                      ? 'Apenas uma proposta completa — sem comparação.'
                      : 'Apenas um fornecedor respondeu — sem comparação.'}
                  </strong>
                  <span>
                    {excludedResponses.length > 0
                      ? 'As demais propostas têm item indisponível ou estão incompletas e ficaram fora do ranking. '
                      : ''}
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
                      <strong>
                        {bypassName}
                        {bypassViaPartner && (
                          <>
                            {' '}
                            <span className="badge" data-testid="via-partner">
                              via {only.creditPartner?.name ?? 'parceiro'} · Credit Support
                            </span>
                          </>
                        )}
                      </strong>
                      <ContactLine name={bypassContactSource?.name} email={bypassContactSource?.email} />
                      <span className="cmp-row__contact">{formatOriginLine(only)}</span>
                      <DgSeal result={only} />
                    </div>
                  </div>
                  <div className="cmp-bypass-supplier__stats">
                    <div className="cmp-bypass-supplier__stat">
                      <span>{basketLabel}</span>
                      <strong>{formatNumber(only.offeredPrice)}</strong>
                    </div>
                    <div className="cmp-bypass-supplier__stat">
                      <span>Lead time</span>
                      <strong>{formatLeadTime(only.leadTimeDays)}</strong>
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
                  title={
                    bypassViaPartner
                      ? `Enviar Ordem de Compra ao parceiro ${only?.creditPartner?.name ?? ''} (${only?.partnerContact?.email ?? 'contato principal'})`
                      : undefined
                  }
                  data-testid={bypassViaPartner ? 'po-partner' : undefined}
                >
                  <DocIcon />
                  {bypassPending ? 'Processando…' : 'Enviar Ordem de Compra'}
                </button>
              </div>
            </div>
          );
        })()}

        {previewQuery.data && comparableCount >= 2 && (
          <>
            {previewPendingApproval && !manualWinner && (
              <p className="alert alert--warning" style={{ marginBottom: 12 }}>
                A adjudicação exige aprovação de gestor/admin pela alçada de R$ {formatNumber(previewQuery.data?.thresholdValue ?? null)} ou pela ausência de câmbio para verificar esse limite. Essa verificação é separada do ranking dos itens.
              </p>
            )}
            {manualWinner && canCompare && quoteRequestStatus === 'open' && (
              <div style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  className="cmp-btn cmp-btn--ghost"
                  onClick={() => void handleUseScoreWinner()}
                  data-testid="use-score-winner"
                  title="Descarta a escolha manual e usa a 1ª do ranking com os critérios atuais."
                >
                  Usar vencedora pelo score
                </button>
              </div>
            )}
            <div className="cmp-rankgrid cmp-rankgrid--head">
              <div>#</div>
              <div>Fornecedor</div>
              <div>{basketLabel}</div>
              <div>Incoterm</div>
              <div>Pagamento</div>
              <div>Lead time</div>
              <div>Score</div>
              <div></div>
            </div>
            <div className="cmp-rows">{renderRankingCards(rankedResults)}</div>
          </>
        )}

        {previewQuery.data && excludedResponses.length > 0 && (
          <section className="cmp-excluded" aria-labelledby="cmp-excluded-title" style={{ marginTop: 16 }}>
            <h3 id="cmp-excluded-title" style={{ fontSize: 14, margin: '0 0 8px' }}>
              Fora do ranking
            </h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink-soft)' }}>
              {excludedResponses.map((entry) => {
                const isExcludedWinner = entry === excludedWinner;
                const entryViaPartner = isViaPartner(entry);
                const entryTarget: PurchaseOrderTarget & ReplyTargetInfo = {
                  quoteResponseId: entry.quoteResponseId,
                  supplierId: entry.supplierId,
                  supplier: entry.supplier,
                  creditSupportRequestId: entry.creditSupportRequestId,
                  creditPartner: entry.creditPartner,
                };
                return (
                <li key={candidateKey(entry)} style={{ marginBottom: 4 }}>
                  <strong style={{ color: 'var(--ink)' }}>
                    {entry.supplier.name || `Fornecedor #${entry.supplierId}`}
                  </strong>
                  {entryViaPartner && (
                    <>
                      {' '}
                      <span className="badge" data-testid="via-partner">
                        via {entry.creditPartner?.name ?? 'parceiro'}
                      </span>
                    </>
                  )}
                  {isExcludedWinner && (
                    <>
                      {' '}
                      <span className="cmp-winner-badge" data-testid="excluded-winner">
                        <TrophyIcon />
                        Vencedora (escolha manual)
                      </span>
                    </>
                  )}
                  {' — '}
                  {excludedReasonText(entry)}
                  {isExcludedWinner && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                      {entryViaPartner ? (
                        <button
                          type="button"
                          className="cmp-btn cmp-btn--primary"
                          onClick={() => handleRowSendPo(entryTarget, false)}
                          title={`Enviar Ordem de Compra ao parceiro ${entry.creditPartner?.name ?? ''}`}
                          data-testid="po-partner"
                        >
                          <DocIcon />
                          Enviar Ordem de Compra
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="cmp-btn cmp-btn--primary"
                            onClick={() => handleRowSendPo(entryTarget, false)}
                          >
                            <DocIcon />
                            Enviar Ordem de Compra
                          </button>
                          <button
                            type="button"
                            className="cmp-btn cmp-btn--ghost"
                            onClick={() => handleRowReply(entryTarget, false)}
                          >
                            <EnvelopeIcon />
                            Responder
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {!isExcludedWinner && canCompare && canPickExcludedAsWinner(entry) && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="cmp-btn cmp-btn--link"
                        onClick={() =>
                          openWinnerModal({
                            quoteResponseId: entry.quoteResponseId,
                            supplierId: entry.supplierId,
                            supplier: entry.supplier,
                            creditSupportRequestId: entry.creditSupportRequestId,
                            creditPartner: entry.creditPartner,
                          })
                        }
                      >
                        Definir como vencedora mesmo assim
                      </button>
                    </>
                  )}
                </li>
                );
              })}
            </ul>
          </section>
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
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8 }}>
                  Assunto: <strong>{replyPreviewData.subject}</strong>
                </p>
                <iframe
                  sandbox=""
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
        <PurchaseOrderModal
          key={candidateKey(poTarget)}
          target={poTarget}
          requestCode={requestCode}
          productName={productName}
          onClose={() => setPoTarget(null)}
          onSent={handlePoSent}
        />
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
                  creditSupportRequestId: winnerTarget.creditSupportRequestId ?? null,
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
