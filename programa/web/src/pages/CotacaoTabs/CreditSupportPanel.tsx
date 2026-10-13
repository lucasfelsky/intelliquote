import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
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
    <div className="dispatch-event" data-testid={`credit-support-request-${row.id}`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {showSupplier && <span style={{ color: 'var(--ink-soft)' }}>{row.supplier.name} ·</span>}
        <strong>{row.partner.name}</strong>
        <span className={STATUS_CLASS[row.status] ?? 'badge'}>{STATUS_LABELS[row.status] ?? row.status}</span>
        {row.isWinner && <span className="badge badge--success">Vencedora</span>}
        {row.purchaseOrderSentAt && (
          <span
            className="badge badge--success"
            data-testid="po-sent-badge"
            title={`Ordem de Compra enviada ao parceiro em ${formatDateTime(row.purchaseOrderSentAt)}`}
          >
            PO enviada
          </span>
        )}
        {row.isStale && <span className="badge badge--warning">Proposta do fornecedor mudou</span>}
        <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Validade: {formatDate(row.expiresAt)}</span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '6px 0 0' }}>
        Enviado em {formatDateTime(row.createdAt)} por {row.createdBy?.name ?? '—'}
      </p>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '2px 0 0', overflowWrap: 'anywhere' }}>
        Destinatários: {row.recipientEmails.join(', ')}
      </p>

      {canManageLinks && (showRevoke || showResend) && (
        <div className="row-actions" style={{ marginTop: 10 }}>
          {showRevoke && (
            <button type="button" className="ghost-button" disabled={busy} onClick={handleRevoke}>
              Revogar
            </button>
          )}
          {showResend && (
            <button
              type="button"
              className="ghost-button"
              disabled={busy || row.isStale}
              title={row.isStale ? 'A proposta do fornecedor mudou: revogue e encaminhe de novo.' : 'Gerar novo link e reenviar o e-mail'}
              onClick={() => resendMutation.mutate()}
            >
              {resendMutation.isPending ? 'Reenviando…' : 'Reenviar'}
            </button>
          )}
        </div>
      )}

      {actionError && <p className="alert alert--error" style={{ marginTop: 10 }}>{actionError}</p>}

      {resendResult && (
        <div style={{ marginTop: 10 }}>
          <p className="alert alert--success" style={{ marginBottom: 8 }}>Novo link gerado.</p>
          <ul style={{ margin: '0 0 8px', paddingLeft: 16, fontSize: 13 }}>
            {resendResult.recipients.map((r) => (
              <li key={r.email} style={{ marginBottom: 4 }}>
                {r.email}{' '}
                <span className={r.status === 'failed' ? 'badge badge--danger' : 'badge'}>
                  {r.status === 'failed' ? 'Falhou' : 'Enviado'}
                </span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 13, margin: '0 0 8px' }}>Validade: {formatDate(resendResult.expiresAt)}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              readOnly
              value={resendResult.portalUrl}
              aria-label="Link do portal do parceiro"
              style={{ flex: '1 1 240px', minWidth: 0 }}
            />
            <button type="button" className="ghost-button" onClick={handleCopy}>
              {copied ? 'Link copiado!' : 'Copiar link'}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>O link só é exibido agora.</p>
        </div>
      )}

      {responded ? (
        <div style={{ marginTop: 12 }}>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Qtd/Unid</th>
                  <th>Unit. fornecedor</th>
                  <th>Total fornecedor</th>
                  <th>Unit. parceiro</th>
                  <th>Total parceiro</th>
                  <th>Δ</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {row.items.map((item) => (
                  <tr key={item.quoteRequestItemId}>
                    <td>
                      {item.productName}
                      {item.itemCode && <div className="muted" style={{ margin: 0 }}>{item.itemCode}</div>}
                      {item.isUnavailable && <span className="badge badge--muted" style={{ marginLeft: 6 }}>Indisponível</span>}
                      {item.isDangerousGood && !item.isUnavailable && (
                        <span className="badge" style={{ marginLeft: 6 }}>DG</span>
                      )}
                    </td>
                    <td>{item.isUnavailable ? '—' : `${item.quantity.toLocaleString('pt-BR')} ${item.unit}`}</td>
                    <td>{item.isUnavailable ? '—' : formatMoney(item.originalUnitPrice, row.currency)}</td>
                    <td>{item.isUnavailable ? '—' : formatMoney(item.originalTotalPrice, row.currency)}</td>
                    <td>{formatMoney(item.partnerUnitPrice, row.currency)}</td>
                    <td>{formatMoney(item.partnerTotalPrice, row.currency)}</td>
                    <td>{item.isUnavailable ? '—' : formatDelta(item.partnerTotalPrice, item.originalTotalPrice, row.currency)}</td>
                    <td>{formatPercent(item.markupPercent)}</td>
                  </tr>
                ))}
                <tr data-testid={`credit-support-totals-${row.id}`}>
                  <td colSpan={3}><strong>Totais</strong></td>
                  <td><strong>{formatMoney(row.totals.original, row.currency)}</strong></td>
                  <td />
                  <td><strong>{formatMoney(row.totals.partner, row.currency)}</strong></td>
                  <td><strong>{formatDelta(row.totals.partner, row.totals.original, row.currency)}</strong></td>
                  <td><strong>{formatPercent(row.totals.markupPercent)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul style={{ margin: '10px 0 0', paddingLeft: 16, fontSize: 13 }}>
            <li>
              Prazo de pagamento: fornecedor {row.originalPaymentTermsDays} dias × parceiro{' '}
              {row.partnerPaymentTermsDays ?? '—'} dias
            </li>
            <li>Validade da proposta do parceiro: {row.partnerValidityDays ?? '—'} dias</li>
            <li>Respondido em {formatDateTime(row.respondedAt)} (versão {row.responseVersion})</li>
            {row.partnerNotes && <li>Observações do parceiro: {row.partnerNotes}</li>}
            <li>Moeda/Incoterm: {row.currency} {row.offeredIncoterm}</li>
          </ul>
        </div>
      ) : (
        <p style={{ fontSize: 13, margin: '8px 0 0' }}>
          Itens encaminhados: {row.items.length} ({unavailableCount} {unavailableCount === 1 ? 'indisponível' : 'indisponíveis'})
        </p>
      )}
    </div>
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
      <p className="alert alert--error">
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {groups.map((group) => (
        <section
          key={group.key}
          className="card"
          data-testid={group.responseId === null ? 'credit-support-removed' : `credit-support-${group.responseId}`}
        >
          <h3 style={{ marginTop: 0, fontSize: 16 }}>{group.title}</h3>
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
