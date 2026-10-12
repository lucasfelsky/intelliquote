import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { listCreditPartners, type CreditPartner } from '@/services/creditPartners';
import { messageOf, type QuoteResponse } from '@/services/quoteResponses';
import {
  creditSupportQueryKey,
  forwardCreditSupport,
  previewCreditSupport,
  type CreditSupportForwardInput,
  type CreditSupportPreview,
  type CreditSupportSendResult,
} from '@/services/creditSupport';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

function defaultContactIds(partner: CreditPartner | undefined): number[] {
  if (!partner || partner.contacts.length === 0) return [];
  const primary = partner.contacts.find((contact) => contact.isPrimary) ?? partner.contacts[0]!;
  return [primary.id];
}

export function CreditSupportModal({
  response,
  quoteRequestId,
  requestCode,
  onClose,
}: {
  response: QuoteResponse;
  quoteRequestId: number;
  requestCode: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const supplierName = response.supplier?.name ?? `Fornecedor #${response.supplierId}`;

  const partnersQuery = useQuery({
    queryKey: ['credit-partners', 'active'],
    queryFn: () => listCreditPartners({ active: true }),
  });
  const partners = partnersQuery.data ?? [];

  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [contactIds, setContactIds] = useState<number[]>([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [ttlDays, setTtlDays] = useState('14');
  const [preview, setPreview] = useState<CreditSupportPreview | null>(null);
  // O link bruto vive so' aqui: "Fechar" descarta (P7).
  const [result, setResult] = useState<CreditSupportSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 1 parceiro ativo = pre-selecionado; 2+ = select obrigatorio.
  useEffect(() => {
    if (!partnersQuery.data) return;
    const only = partnersQuery.data.length === 1 ? partnersQuery.data[0]! : null;
    setPartnerId(only ? only.id : null);
    setContactIds(defaultContactIds(only ?? undefined));
  }, [partnersQuery.data]);

  const selectedPartner = partners.find((partner) => partner.id === partnerId);
  const noPartners = partnersQuery.isSuccess && partners.length === 0;

  function choosePartner(value: string) {
    const id = value ? Number(value) : null;
    setPartnerId(id);
    setContactIds(defaultContactIds(partners.find((partner) => partner.id === id)));
    setPreview(null);
    setError(null);
  }

  function toggleContact(id: number, checked: boolean) {
    setContactIds((prev) => (checked ? [...prev.filter((c) => c !== id), id] : prev.filter((c) => c !== id)));
  }

  function buildInput(): CreditSupportForwardInput | null {
    if (partnerId === null) {
      setError('Selecione o parceiro de crédito.');
      return null;
    }
    if (contactIds.length === 0) {
      setError('Selecione ao menos um contato.');
      return null;
    }
    const ttl = Number(ttlDays);
    if (!ttlDays.trim() || !Number.isInteger(ttl) || ttl < 1 || ttl > 60) {
      setError('Validade entre 1 e 60 dias.');
      return null;
    }
    setError(null);
    return { creditPartnerId: partnerId, contactIds, subject, message, ttlDays: ttl };
  }

  const previewMutation = useMutation({
    mutationFn: (input: CreditSupportForwardInput) => previewCreditSupport(response.id, input),
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
    },
    onError: (err) => setError(messageOf(err)),
  });

  const sendMutation = useMutation({
    mutationFn: (input: CreditSupportForwardInput) => forwardCreditSupport(response.id, input),
    onSuccess: async (data) => {
      setResult(data);
      setError(null);
      await qc.invalidateQueries({ queryKey: creditSupportQueryKey(quoteRequestId) });
    },
    onError: (err) => setError(messageOf(err)),
  });

  async function handleCopy() {
    if (!result) return;
    try {
      await copyToClipboard(result.portalUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao copiar o link.');
    }
  }

  const busy = previewMutation.isPending || sendMutation.isPending;
  const canAct = !noPartners && !partnersQuery.isLoading && !busy;

  return (
    <Modal isOpen onClose={onClose} size="wide" title={`Credit Support — ${supplierName}`}>
      <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 0 }}>
        {requestCode} · Encaminha a proposta do fornecedor a um parceiro de crédito.
      </p>

      {result ? (
        <div data-testid="credit-support-result">
          <p className={result.recipients.some((r) => r.status === 'failed') ? 'alert alert--error' : 'alert alert--success'}>
            {result.recipients.some((r) => r.status === 'failed') ? 'Enviado parcialmente.' : 'Encaminhamento enviado.'}
          </p>
          <ul style={{ margin: '8px 0', paddingLeft: 16, fontSize: 13 }}>
            {result.recipients.map((r) => (
              <li key={r.email} style={{ marginBottom: 4 }}>
                {r.email}{' '}
                <span className={r.status === 'failed' ? 'badge badge--danger' : 'badge'}>
                  {r.status === 'failed' ? 'Falhou' : 'Enviado'}
                </span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 13, margin: '8px 0' }}>Validade: {formatDate(result.expiresAt)}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              readOnly
              value={result.portalUrl}
              aria-label="Link do portal do parceiro"
              style={{ flex: '1 1 240px', minWidth: 0 }}
            />
            <button type="button" className="ghost-button" onClick={handleCopy}>
              {copied ? 'Link copiado!' : 'Copiar link'}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            O link só é exibido agora; para obter outro, use Reenviar no painel.
          </p>
          {error && <p className="alert alert--error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="primary-button" onClick={onClose}>Fechar</button>
          </div>
        </div>
      ) : (
        <>
          {partnersQuery.isLoading && <p className="muted">Carregando parceiros…</p>}
          {partnersQuery.isError && (
            <p className="alert alert--error">
              Não foi possível carregar os parceiros de crédito: {messageOf(partnersQuery.error)}
            </p>
          )}
          {noPartners && (
            <p className="alert alert--error">
              Nenhum parceiro de crédito ativo. Cadastre em <Link to="/empresa">Empresa</Link>.
            </p>
          )}

          <label className="field-label" htmlFor="cs-partner" style={{ marginTop: 12 }}>
            Parceiro de crédito *
          </label>
          <select
            id="cs-partner"
            className="select"
            value={partnerId ?? ''}
            onChange={(e) => choosePartner(e.target.value)}
            disabled={noPartners || partnersQuery.isLoading}
          >
            <option value="">Selecione…</option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
          {selectedPartner && partners.length === 1 && (
            <span className="badge" style={{ marginTop: 6 }}>Padrão</span>
          )}

          {selectedPartner && (
            <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
              <legend className="field-label">Contatos *</legend>
              {selectedPartner.contacts.length === 0 ? (
                <p className="alert alert--error">
                  Este parceiro não tem contatos cadastrados. Cadastre em <Link to="/empresa">Empresa</Link>.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selectedPartner.contacts.map((contact) => (
                    <label key={contact.id} className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={contactIds.includes(contact.id)}
                        onChange={(e) => toggleContact(contact.id, e.target.checked)}
                      />
                      <span>
                        {contact.name} — {contact.email}
                        {contact.isPrimary && <span className="badge badge--muted" style={{ marginLeft: 6 }}>Principal</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          <label className="field-label" htmlFor="cs-subject" style={{ marginTop: 12 }}>Assunto</label>
          <input
            id="cs-subject"
            className="input"
            value={subject}
            maxLength={255}
            placeholder="Padrão do servidor"
            onChange={(e) => setSubject(e.target.value)}
          />

          <label className="field-label" htmlFor="cs-message" style={{ marginTop: 12 }}>Mensagem</label>
          <textarea
            id="cs-message"
            className="textarea"
            rows={4}
            maxLength={4000}
            value={message}
            placeholder="Opcional. Texto adicional no corpo do e-mail ao parceiro."
            onChange={(e) => setMessage(e.target.value)}
          />

          <label className="field-label" htmlFor="cs-ttl" style={{ marginTop: 12 }}>Validade do link (dias)</label>
          <input
            id="cs-ttl"
            className="input"
            type="number"
            min={1}
            max={60}
            step={1}
            value={ttlDays}
            onChange={(e) => setTtlDays(e.target.value)}
            style={{ maxWidth: 160 }}
          />

          {preview && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0, marginBottom: 6 }}>Preview do e-mail</h3>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8 }}>
                Para: <strong>{preview.recipients.map((r) => r.email).join(', ')}</strong>
                {preview.cc.length > 0 && <> · CC: {preview.cc.join(', ')}</>}
              </p>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8 }}>
                Assunto: <strong>{preview.subject}</strong>
              </p>
              <iframe
                key={preview.html.length}
                title="preview-credit-support-email"
                className="preview-frame"
                srcDoc={preview.html}
              />
            </div>
          )}

          {error && <p className="alert alert--error" style={{ marginTop: 12 }}>{error}</p>}

          <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="ghost-button" onClick={onClose}>Cancelar</button>
            <button
              type="button"
              className="ghost-button"
              disabled={!canAct}
              onClick={() => {
                const input = buildInput();
                if (input) previewMutation.mutate(input);
              }}
            >
              {previewMutation.isPending ? 'Gerando…' : 'Pré-visualizar e-mail'}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canAct}
              onClick={() => {
                const input = buildInput();
                if (input) sendMutation.mutate(input);
              }}
            >
              {sendMutation.isPending ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
