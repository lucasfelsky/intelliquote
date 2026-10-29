import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { useConfirm } from '@/components/useConfirm';
import { messageOf, type QuoteResponse } from '@/services/quoteResponses';
import {
  creditSupportQueryKey,
  listCreditSupport,
  resendCreditSupport,
  revokeCreditSupport,
  STATUS_LABELS,
  type CreditSupportRequest,
  type CreditSupportResendResult,
  type CreditSupportStatus,
} from '@/services/creditSupport';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatMoney(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;
}

// Delta absoluto calculado no front (P5): subtracao simples, com sinal.
function formatDelta(partner: string | null, original: string | null, currency: string): string {
  if (partner === null || original === null) return '—';
  const diff = Number(partner) - Number(original);
  if (Number.isNaN(diff)) return '—';
  const abs = Math.abs(diff).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${diff < 0 ? '-' : '+'}${abs} ${currency}`;
}

// A porcentagem vem pronta do servidor ("10.00" / "-5.00"); so' troca o separador
// e prefixa "+" quando nao negativa. Nunca recalculada aqui.
function formatPercent(value: string | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = value.replace('.', ',');
  return `${text.startsWith('-') ? '' : '+'}${text} %`;
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

const STATUS_CLASS: Record<CreditSupportStatus, string> = {
  sent: 'badge badge--info',
  responded: 'badge',
  expired: 'badge badge--muted',
  revoked: 'badge badge--danger',
};

function CreditSupportCard({
  row,
  quoteRequestId,
  canManageLinks,
  showSupplier = false,
}: {
  row: CreditSupportRequest;
  quoteRequestId: number;
  canManageLinks: boolean;
  showSupplier?: boolean;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [actionError, setActionError] = useState<string | null>(null);
  // Link bruto do Reenviar: so' neste estado local, some ao desmontar.
  const [resendResult, setResendResult] = useState<CreditSupportResendResult | null>(null);
  const [copied, setCopied] = useState(false);

  const revokeMutation = useMutation({
    mutationFn: () => revokeCreditSupport(row.id),
    onSuccess: async () => {
      setActionError(null);
      setResendResult(null);
      await qc.invalidateQueries({ queryKey: creditSupportQueryKey(quoteRequestId) });
    },
    onError: (err) => setActionError(messageOf(err)),
  });

  const resendMutation = useMutation({
    mutationFn: () => resendCreditSupport(row.id),
    onSuccess: async (data) => {
      setActionError(null);
      setResendResult(data);
      await qc.invalidateQueries({ queryKey: creditSupportQueryKey(quoteRequestId) });
    },
    onError: (err) => setActionError(messageOf(err)),
  });

  async function handleRevoke() {
    const ok = await confirm({
      message: 'Revogar este encaminhamento? O link do parceiro deixa de funcionar.',
      tone: 'danger',
    });
    if (ok) revokeMutation.mutate();
  }

  async function handleCopy() {
    if (!resendResult) return;
    try {
      await copyToClipboard(resendResult.portalUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao copiar o link.');
    }
  }

  const showRevoke = row.status !== 'revoked';
  const showResend = row.status === 'sent' || row.status === 'expired';
  const busy = revokeMutation.isPending || resendMutation.isPending;
  const unavailableCount = row.items.filter((item) => item.isUnavailable).length;
  const responded = row.status === 'responded';

  return (
    <article className="credit-support__cartao" data-testid={`credit-support-request-${row.id}`}>
      <div className="credit-support__cabecalho">
        <div className="credit-support__info">
          <div className="credit-support__titulo">
            {showSupplier && <span className="credit-support__fornecedor">{row.supplier.name} ·</span>}
            <strong className="credit-support__parceiro">{row.partner.name}</strong>
            <span className={`${STATUS_CLASS[row.status] ?? 'badge'} badge--dot`}>{STATUS_LABELS[row.status] ?? row.status}</span>
            {row.isWinner && (
              <span className="badge badge--success">
                <Icon name="trophy" size={13} strokeWidth={2} />
                Vencedora
              </span>
            )}
            {row.purchaseOrderSentAt && (
              <span
                className="badge badge--info badge--dot"
                data-testid="po-sent-badge"
                title={`Ordem de Compra enviada ao parceiro em ${formatDateTime(row.purchaseOrderSentAt)}`}
              >
                PO enviada
              </span>
            )}
            {row.isStale && (
              <span className="badge badge--warning">
                <Icon name="alert-triangle" size={13} strokeWidth={1.9} />
                Proposta do fornecedor mudou
              </span>
            )}
            <span className="credit-support__validade">
              Validade: <span className="credit-support__mono">{formatDate(row.expiresAt)}</span>
            </span>
          </div>
          <p className="credit-support__meta">
            Enviado em <span className="credit-support__mono">{formatDateTime(row.createdAt)}</span> por {row.createdBy?.name ?? '—'}
          </p>
          <p className="credit-support__meta credit-support__destinatarios">
            Destinatários: {row.recipientEmails.join(', ')}
          </p>
        </div>

        {canManageLinks && (showRevoke || showResend) && (
          <div className="credit-support__acoes">
            {showRevoke && (
              <button type="button" className="ghost-button ghost-button--sm danger-button" disabled={busy} onClick={handleRevoke}>
                Revogar
              </button>
            )}
            {showResend && (
              <button
                type="button"
                className="ghost-button credit-support__reenviar"
                disabled={busy || row.isStale}
                title={row.isStale ? 'A proposta do fornecedor mudou: revogue e encaminhe de novo.' : 'Gerar novo link e reenviar o e-mail'}
                onClick={() => resendMutation.mutate()}
              >
                <Icon name="refresh" size={14} strokeWidth={1.9} />
                {resendMutation.isPending ? 'Reenviando…' : 'Reenviar'}
              </button>
            )}
          </div>
        )}
      </div>

      {actionError && <p className="alert alert--error" role="alert">{actionError}</p>}

      {resendResult && (
        <div className="credit-support__novo-link">
          <div className="credit-support__novo-link-info">
            <p className="alert alert--success" role="status">Novo link gerado.</p>
            <ul className="credit-support__destinos">
              {resendResult.recipients.map((r) => (
                <li key={r.email}>
                  {r.email}{' '}
                  <span className={r.status === 'failed' ? 'badge badge--danger' : 'badge'}>
                    {r.status === 'failed' ? 'Falhou' : 'Enviado'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="credit-support__linha">
              Validade: <span className="credit-support__mono">{formatDate(resendResult.expiresAt)}</span>
            </p>
          </div>
          <div className="credit-support__novo-link-acao">
            <div className="credit-support__link">
              <input
                className="input credit-support__link-campo"
                readOnly
                value={resendResult.portalUrl}
                aria-label="Link do portal do parceiro"
              />
              <button type="button" className="ghost-button credit-support__copiar" onClick={handleCopy}>
                <Icon name="copy" size={16} strokeWidth={1.9} />
                {copied ? 'Link copiado!' : 'Copiar link'}
              </button>
            </div>
            <p className="credit-support__dica">O link só é exibido agora.</p>
          </div>
        </div>
      )}

      {responded ? (
        <>
          <div className="table-wrapper credit-support__tabela">
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="credit-support__num">Qtd/Unid</th>
                  <th className="credit-support__num">Unit. fornecedor</th>
                  <th className="credit-support__num">Total fornecedor</th>
                  <th className="credit-support__num">Unit. parceiro</th>
                  <th className="credit-support__num">Total parceiro</th>
                  <th className="credit-support__num">Δ</th>
                  <th className="credit-support__num">%</th>
                </tr>
              </thead>
              <tbody>
                {row.items.map((item) => (
                  <tr key={item.quoteRequestItemId} className={item.isUnavailable ? 'credit-support__linha--indisponivel' : undefined}>
                    <td>
                      <div className="credit-support__produto">
                        <span className="credit-support__produto-nome">{item.productName}</span>
                        {item.itemCode && <span className="credit-support__produto-codigo">{item.itemCode}</span>}
                        {(item.isUnavailable || item.isDangerousGood) && (
                          <span className="credit-support__selos">
                            {item.isUnavailable && <span className="badge badge--warning">Indisponível</span>}
                            {item.isDangerousGood && !item.isUnavailable && (
                              <span className="badge badge--danger">DG</span>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="credit-support__num credit-support__valor">{item.isUnavailable ? '—' : `${item.quantity.toLocaleString('pt-BR')} ${item.unit}`}</td>
                    <td className="credit-support__num credit-support__valor">{item.isUnavailable ? '—' : formatMoney(item.originalUnitPrice, row.currency)}</td>
                    <td className="credit-support__num credit-support__valor">{item.isUnavailable ? '—' : formatMoney(item.originalTotalPrice, row.currency)}</td>
                    <td className="credit-support__num credit-support__valor">{formatMoney(item.partnerUnitPrice, row.currency)}</td>
                    <td className="credit-support__num credit-support__valor">{formatMoney(item.partnerTotalPrice, row.currency)}</td>
                    <td className="credit-support__num credit-support__valor">{item.isUnavailable ? '—' : formatDelta(item.partnerTotalPrice, item.originalTotalPrice, row.currency)}</td>
                    <td className="credit-support__num credit-support__valor">{formatPercent(item.markupPercent)}</td>
                  </tr>
                ))}
                <tr className="credit-support__totais" data-testid={`credit-support-totals-${row.id}`}>
                  <td colSpan={3}><strong>Totais</strong></td>
                  <td className="credit-support__num credit-support__valor"><strong>{formatMoney(row.totals.original, row.currency)}</strong></td>
                  <td />
                  <td className="credit-support__num credit-support__valor"><strong>{formatMoney(row.totals.partner, row.currency)}</strong></td>
                  <td className="credit-support__num credit-support__valor"><strong>{formatDelta(row.totals.partner, row.totals.original, row.currency)}</strong></td>
                  <td className="credit-support__num credit-support__valor"><strong>{formatPercent(row.totals.markupPercent)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul className="credit-support__detalhes">
            <li>
              Prazo de pagamento: fornecedor {row.originalPaymentTermsDays} dias × parceiro{' '}
              {row.partnerPaymentTermsDays ?? '—'} dias
            </li>
            <li>Validade da proposta do parceiro: {row.partnerValidityDays ?? '—'} dias</li>
            <li>Respondido em {formatDateTime(row.respondedAt)} (versão {row.responseVersion})</li>
            {row.partnerNotes && <li className="credit-support__detalhes-cheio">Observações do parceiro: {row.partnerNotes}</li>}
            <li>Moeda/Incoterm: {row.currency} {row.offeredIncoterm}</li>
          </ul>
        </>
      ) : (
        <p className="credit-support__linha">
          Itens encaminhados: <span className="credit-support__mono">{row.items.length}</span> (<span className="credit-support__mono">{unavailableCount}</span> {unavailableCount === 1 ? 'indisponível' : 'indisponíveis'})
        </p>
      )}
    </article>
  );
}

export function CreditSupportPanel({
  quoteRequestId,
  responses,
}: {
  quoteRequestId: number;
  responses: QuoteResponse[];
}) {
  const { user } = useAuth();
  const role = user?.role;
  const canManageLinks = role === 'admin' || role === 'comprador' || role === 'gestor';

  const query = useQuery({
    queryKey: creditSupportQueryKey(quoteRequestId),
    queryFn: () => listCreditSupport(quoteRequestId),
  });

  if (query.isError) {
    return (
      <p className="alert alert--error" role="alert">
        Não foi possível carregar os encaminhamentos de Credit Support: {messageOf(query.error)}
      </p>
    );
  }

  const rows = query.data ?? [];
  if (rows.length === 0) return null;

  const byResponse = new Map<number, CreditSupportRequest[]>();
  for (const row of rows) {
    const list = byResponse.get(row.quoteResponseId) ?? [];
    list.push(row);
    byResponse.set(row.quoteResponseId, list);
  }

  const groups: { key: string; title: string; rows: CreditSupportRequest[]; responseId: number | null }[] = [];
  for (const response of responses) {
    const list = byResponse.get(response.id);
    if (!list) continue;
    byResponse.delete(response.id);
    const name = response.supplier?.name ?? list[0]?.supplier.name ?? `Fornecedor #${response.supplierId}`;
    groups.push({ key: String(response.id), title: `Credit Support — ${name}`, rows: list, responseId: response.id });
  }
  const orphan = Array.from(byResponse.values()).flat();
  if (orphan.length > 0) {
    groups.push({ key: 'removed', title: 'Credit Support — Respostas removidas', rows: orphan, responseId: null });
  }

  return (
    <div className="credit-support">
      {groups.map((group) => (
        <section
          key={group.key}
          className="credit-support__grupo"
          data-testid={group.responseId === null ? 'credit-support-removed' : `credit-support-${group.responseId}`}
        >
          <h3 className="credit-support__titulo-grupo">{group.title}</h3>
          {group.rows.map((row) => (
            <CreditSupportCard
              key={row.id}
              row={row}
              quoteRequestId={quoteRequestId}
              canManageLinks={canManageLinks}
              showSupplier={group.responseId === null}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
