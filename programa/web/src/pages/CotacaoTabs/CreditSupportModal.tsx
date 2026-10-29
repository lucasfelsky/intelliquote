import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/icons';
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
    <Modal
      isOpen
      onClose={onClose}
      size="wide"
      title={`Credit Support — ${supplierName}`}
      subtitle={
        <>
          <span className="credit-support__codigo">{requestCode}</span> · Encaminha a proposta do fornecedor a um parceiro de crédito.
        </>
      }
    >
      {result ? (
        <>
          <div className="credit-support-modal" data-testid="credit-support-result">
            <p
              className={result.recipients.some((r) => r.status === 'failed') ? 'alert alert--error' : 'alert alert--success'}
              role={result.recipients.some((r) => r.status === 'failed') ? 'alert' : 'status'}
            >
              {result.recipients.some((r) => r.status === 'failed') ? 'Enviado parcialmente.' : 'Encaminhamento enviado.'}
            </p>
            <ul className="credit-support-modal__destinos">
              {result.recipients.map((r) => (
                <li key={r.email}>
                  <span className="credit-support-modal__email">{r.email}</span>{' '}
                  <span className={r.status === 'failed' ? 'badge badge--danger' : 'badge'}>
                    {r.status === 'failed' ? 'Falhou' : 'Enviado'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="credit-support-modal__linha">
              Validade: <span className="credit-support__mono">{formatDate(result.expiresAt)}</span>
            </p>
            <div className="credit-support-modal__link">
              <input
                className="input credit-support__link-campo"
                readOnly
                value={result.portalUrl}
                aria-label="Link do portal do parceiro"
              />
              <button type="button" className="ghost-button credit-support__copiar" onClick={handleCopy}>
                <Icon name="copy" size={16} strokeWidth={1.9} />
                {copied ? 'Link copiado!' : 'Copiar link'}
              </button>
            </div>
            <p className="credit-support__dica">
              O link só é exibido agora; para obter outro, use Reenviar no painel.
            </p>
            {error && <p className="alert alert--error" role="alert">{error}</p>}
          </div>
          <div className="modal-actions">
            <button type="button" className="primary-button" onClick={onClose}>Fechar</button>
          </div>
        </>
      ) : (
        <>
          <div className="credit-support-modal">
            {partnersQuery.isLoading && <p className="credit-support-modal__estado">Carregando parceiros…</p>}
            {partnersQuery.isError && (
              <p className="alert alert--error" role="alert">
                Não foi possível carregar os parceiros de crédito: {messageOf(partnersQuery.error)}
              </p>
            )}
            {noPartners && (
              <p className="alert alert--error" role="alert">
                Nenhum parceiro de crédito ativo. Cadastre em <Link to="/empresa">Empresa</Link>.
              </p>
            )}

            <div className="credit-support-modal__parceiro">
              <div className="credit-support-modal__campo">
                <label className="field-label" htmlFor="cs-partner">
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
                  <span className="badge badge--dot credit-support-modal__padrao">Padrão</span>
                )}
              </div>

              {selectedPartner && (
                <fieldset className="credit-support-modal__contatos">
                  <legend className="field-label">Contatos *</legend>
                  {selectedPartner.contacts.length === 0 ? (
                    <p className="alert alert--error" role="alert">
                      Este parceiro não tem contatos cadastrados. Cadastre em <Link to="/empresa">Empresa</Link>.
                    </p>
                  ) : (
                    <div className="credit-support-modal__lista">
                      {selectedPartner.contacts.map((contact) => (
                        <label key={contact.id} className="checkbox-field credit-support-modal__contato">
                          <input
                            type="checkbox"
                            checked={contactIds.includes(contact.id)}
                            onChange={(e) => toggleContact(contact.id, e.target.checked)}
                          />
                          <span>
                            {contact.name} — {contact.email}
                            {contact.isPrimary && <span className="badge badge--muted">Principal</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              )}
            </div>

            <div className="credit-support-modal__assunto">
              <div className="credit-support-modal__campo">
                <label className="field-label" htmlFor="cs-subject">Assunto</label>
                <input
                  id="cs-subject"
                  className="input"
                  value={subject}
                  maxLength={255}
                  placeholder="Padrão do servidor"
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              <div className="credit-support-modal__campo">
                <label className="field-label" htmlFor="cs-ttl">Validade do link (dias)</label>
                <input
                  id="cs-ttl"
                  className="input credit-support-modal__mono"
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={ttlDays}
                  onChange={(e) => setTtlDays(e.target.value)}
                />
              </div>
            </div>

            <div className="credit-support-modal__campo">
              <label className="field-label" htmlFor="cs-message">Mensagem</label>
              <textarea
                id="cs-message"
                className="textarea"
                rows={3}
                maxLength={4000}
                value={message}
                placeholder="Opcional. Texto adicional no corpo do e-mail ao parceiro."
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>

            {preview && (
              <>
                <div className="credit-support-modal__previa-cab">
                  <h3 className="credit-support-modal__previa-titulo">Preview do e-mail</h3>
                  <p className="credit-support-modal__linha-previa">
                    Para: <strong>{preview.recipients.map((r) => r.email).join(', ')}</strong>
                    {preview.cc.length > 0 && <> · CC: {preview.cc.join(', ')}</>}
                  </p>
                  <p className="credit-support-modal__linha-previa">
                    Assunto: <strong>{preview.subject}</strong>
                  </p>
                </div>
                <iframe
                  sandbox=""
                  key={preview.html.length}
                  title="preview-credit-support-email"
                  className="preview-frame credit-support-modal__previa"
                  srcDoc={preview.html}
                />
              </>
            )}

            {error && <p className="alert alert--error" role="alert">{error}</p>}
          </div>

          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onClose}>Cancelar</button>
            <button
              type="button"
              className="ghost-button credit-support-modal__previsualizar"
              disabled={!canAct}
              onClick={() => {
                const input = buildInput();
                if (input) previewMutation.mutate(input);
              }}
            >
              <Icon name="eye" size={16} strokeWidth={1.9} />
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
              <Icon name="templates" size={16} strokeWidth={1.9} />
              {sendMutation.isPending ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
