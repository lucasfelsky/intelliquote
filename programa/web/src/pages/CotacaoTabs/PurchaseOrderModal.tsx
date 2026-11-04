import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  messageOf,
  type ComparisonResult,
} from '@/services/quoteResponses';
import {
  getPartnerPurchaseOrderRecipients,
  getPurchaseOrderRecipients,
  sendPurchaseOrder,
  sendPurchaseOrderToPartner,
} from '@/services/dispatch';
import { formatForwarderInfo, listForwarders } from '@/services/forwarders';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/icons';
import { useConfirm } from '@/components/useConfirm';

// Espelha o limite do backend (app.ts / QuoteResponseController) -- valida
// no cliente antes de gastar o upload/base64 num arquivo que sera rejeitado.
const MAX_PO_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Mesmo limite do Zod do backend (quotePurchaseOrderSchema.forwarderInfo).
const MAX_FORWARDER_INFO_LENGTH = 2000;

function formatRecipient(contact: { name: string; email: string }): string {
  return contact.name.trim() ? `${contact.name} <${contact.email}>` : contact.email;
}

// Tamanho do PDF em MB, com virgula decimal (pt-BR), como o resto da tela.
function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Campos do candidato que o modal realmente le (linha do ranking OU entrada de "Fora do ranking").
export type PurchaseOrderTarget = Pick<
  ComparisonResult,
  'quoteResponseId' | 'supplierId' | 'supplier' | 'creditSupportRequestId' | 'creditPartner' | 'partnerContact'
>;

interface PurchaseOrderModalProps {
  target: PurchaseOrderTarget;
  requestCode: string;
  productName: string | null;
  onClose: () => void;
  onSent: (target: PurchaseOrderTarget) => void;
  // PO a uma proposta que nao e a vencedora (o usuario ja confirmou no ComparacaoTab).
  nonWinner?: boolean;
}

// Modal "Enviar Ordem de Compra" -- da proposta vencedora (r.isWinner) ou, apos confirmacao,
// de qualquer proposta direta (nonWinner). Anexo = upload de PDF em base64 (so'-envio, sem storage
// duravel). Forwarder = texto editavel que o seletor PREENCHE a partir do cadastro
// (o e-mail leva so' o texto; forwarderId e' enviado apenas para rastreio).
// O estado nasce a cada abertura (o pai usa key={quoteResponseId}).
export function PurchaseOrderModal({
  target,
  requestCode,
  productName,
  onClose,
  onSent,
  nonWinner = false,
}: PurchaseOrderModalProps) {
  const [poSubject, setPoSubject] = useState(`Purchase Order - ${productName || requestCode}`);
  const [poForwarderInfo, setPoForwarderInfo] = useState('');
  const [poMessage, setPoMessage] = useState('');
  const [poFileName, setPoFileName] = useState('');
  const [poFileBase64, setPoFileBase64] = useState('');
  const [poFileSize, setPoFileSize] = useState(0);
  const [poModalError, setPoModalError] = useState<string | null>(null);
  const [forwarderId, setForwarderId] = useState<number | null>(null);
  const confirm = useConfirm();
  const viaPartner = (target.creditSupportRequestId ?? 0) > 0;
  const supplierName = target.supplier?.name ?? `Fornecedor #${target.supplierId}`;

  const forwardersQuery = useQuery({
    queryKey: ['forwarders', { active: true }],
    queryFn: () => listForwarders({ active: true }),
  });
  const forwarders = forwardersQuery.data ?? [];

  // Lista informativa de quem recebe a PO (Para/Cc); o backend resolve os mesmos destinatarios
  // sozinho no envio, entao um erro aqui NAO bloqueia o botao.
  const recipientsId = viaPartner ? (target.creditSupportRequestId ?? 0) : (target.quoteResponseId ?? 0);
  const recipientsQuery = useQuery({
    queryKey: ['purchase-order-recipients', viaPartner ? 'partner' : 'supplier', recipientsId],
    queryFn: () =>
      viaPartner
        ? getPartnerPurchaseOrderRecipients(recipientsId)
        : getPurchaseOrderRecipients(recipientsId),
    enabled: recipientsId > 0,
    retry: false,
  });
  const recipients = recipientsQuery.data;

  // Ultimo texto escrito pelo seletor: enquanto o textarea ainda for igual a ele, trocar de
  // forwarder sobrescreve sem perguntar. userTouched impede a pre-selecao de pisar no que o
  // usuario ja digitou/escolheu antes da lista chegar.
  const lastAutoTextRef = useRef('');
  const userTouchedRef = useRef(false);
  const initialAppliedRef = useRef(false);

  useEffect(() => {
    if (!forwardersQuery.data || initialAppliedRef.current) return;
    initialAppliedRef.current = true;
    if (userTouchedRef.current) return;
    const preferred = forwardersQuery.data.find((item) => item.isDefault && item.isActive);
    if (!preferred) return;
    const text = formatForwarderInfo(preferred);
    lastAutoTextRef.current = text;
    setForwarderId(preferred.id);
    setPoForwarderInfo(text);
  }, [forwardersQuery.data]);

  async function handleForwarderSelect(rawValue: string) {
    userTouchedRef.current = true;
    if (rawValue === '') {
      // "Digitar manualmente" nunca apaga o texto; so' deixa de rastrear o cadastro.
      setForwarderId(null);
      return;
    }
    const chosen = forwarders.find((item) => item.id === Number(rawValue));
    if (!chosen) return;
    const untouched =
      poForwarderInfo.trim() === '' || poForwarderInfo === lastAutoTextRef.current;
    if (!untouched) {
      const ok = await confirm({
        title: 'Substituir contato do forwarder?',
        message: `O texto editado será substituído pelo cadastro de ${chosen.companyName}.`,
        confirmText: 'Substituir',
      });
      if (!ok) return;
    }
    const text = formatForwarderInfo(chosen);
    lastAutoTextRef.current = text;
    setForwarderId(chosen.id);
    setPoForwarderInfo(text);
  }

  const forwarderInfoLength = poForwarderInfo.trim().length;
  const forwarderInfoTooLong = forwarderInfoLength > MAX_FORWARDER_INFO_LENGTH;

  const poSendMutation = useMutation({
    mutationFn: () => {
      const payload = {
        subject: poSubject,
        message: poMessage,
        forwarderInfo: poForwarderInfo,
        ...(forwarderId !== null ? { forwarderId } : {}),
        fileName: poFileName,
        contentBase64: poFileBase64,
        fileType: 'application/pdf' as const,
        fileSize: poFileSize,
      };
      // PR4b: vencedora via parceiro -> a PO vai ao parceiro (rota do encaminhamento).
      if (viaPartner && target.creditSupportRequestId) {
        return sendPurchaseOrderToPartner(target.creditSupportRequestId, payload);
      }
      if (!target.quoteResponseId) throw new Error('Proposta sem ID.');
      return sendPurchaseOrder(target.quoteResponseId, nonWinner ? { ...payload, nonWinner: true } : payload);
    },
    onSuccess: () => onSent(target),
    onError: (err) => setPoModalError(messageOf(err)),
  });

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

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="wide"
      title={
        viaPartner
          ? `Enviar Ordem de Compra ao parceiro ${target.creditPartner?.name ?? 'de crédito'} — fornecedor ${supplierName}`
          : `Enviar Ordem de Compra — ${supplierName}`
      }
      subtitle={
        <>
          <span className="cmp-codigo">{requestCode}</span> · {productName}
        </>
      }
    >
      <div className="cmp-po">
        {nonWinner && (
          <p className="cmp-po-aviso cmp-po-aviso--atencao cmp-po-nonwinner-notice" data-testid="po-nonwinner-notice">
            <Icon name="alert-triangle" size={16} strokeWidth={1.9} />
            <span>Esta proposta não é a vencedora da cotação. A vencedora continua a mesma.</span>
          </p>
        )}
        {viaPartner && (
          <p className="cmp-po-aviso cmp-po-aviso--info" data-testid="po-partner-notice" role="status">
            <Icon name="info" size={16} strokeWidth={1.9} />
            <span>O fornecedor de origem não é copiado.</span>
          </p>
        )}
        <div data-testid="po-recipients" className="cmp-po__destinatarios">
          {recipientsQuery.isLoading && <p className="cmp-po__destinatarios-estado">Carregando destinatários…</p>}
          {recipientsQuery.isError && (
            <p
              role="alert"
              className="cmp-po__destinatarios-erro"
            >
              <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
              <span>Não foi possível carregar os destinatários: {messageOf(recipientsQuery.error)}</span>
            </p>
          )}
          {recipients && (
            <div className="cmp-po__destinatarios-caixa">
              <p className="cmp-po__linha">
                <strong>Para:</strong> {formatRecipient(recipients.to)}
              </p>
              {recipients.contactCc.length > 0 && (
                <p className="cmp-po__linha">
                  <strong>Cc:</strong>{' '}
                  {recipients.contactCc.map(formatRecipient).join(', ')}
                </p>
              )}
              {recipients.comexCc.length > 0 && (
                <p className="cmp-po__linha cmp-po__linha--suave">
                  Equipe COMEX em cópia ({recipients.comexCc.length}).
                </p>
              )}
              {!recipients.to.name.trim() && (
                <p className="cmp-po__linha cmp-po__linha--suave">Contato sem nome: aparece só o e-mail.</p>
              )}
            </div>
          )}
        </div>

        <div className="cmp-campo">
          <label className="field-label" htmlFor="poSubject">
            Assunto
          </label>
          <input
            id="poSubject"
            className="input"
            value={poSubject}
            onChange={(e) => setPoSubject(e.target.value)}
          />
        </div>

        <div className="cmp-campo cmp-po__arquivo-campo">
          <label className="field-label" htmlFor="poFile">
            PDF da Ordem de Compra
          </label>
          <input
            id="poFile"
            type="file"
            className="cmp-po__arquivo-input"
            accept="application/pdf"
            onChange={(e) => handlePoFileChange(e.target.files?.[0] ?? null)}
          />
          <label
            htmlFor="poFile"
            className={poFileName ? 'cmp-po__arquivo cmp-po__arquivo--ok' : 'cmp-po__arquivo'}
          >
            <span className="cmp-po__arquivo-icone" aria-hidden="true">
              <Icon name={poFileName ? 'file-text' : 'upload'} size={poFileName ? 20 : 18} strokeWidth={1.9} />
            </span>
            <span className="cmp-po__arquivo-texto">
              <strong className={poFileName ? 'cmp-po__arquivo-nome cmp-mono' : 'cmp-po__arquivo-nome'}>
                {poFileName || 'Nenhum arquivo selecionado'}
              </strong>
              <span>Somente PDF, até 10 MB</span>
            </span>
            {poFileName && (
              <span className="cmp-po__arquivo-botao">
                <Icon name="upload" size={14} strokeWidth={2} />
                Escolher arquivo
              </span>
            )}
          </label>
          {poFileName && (
            <p className="cmp-po__selecionado">
              <span>Selecionado: {poFileName}</span>{' '}
              <span>
                (<span className="cmp-mono">{formatMb(poFileSize)}</span> MB)
              </span>
            </p>
          )}
        </div>

        <div className="cmp-campo">
          <label className="field-label" htmlFor="poForwarderSelect">
            Forwarder
          </label>
          <select
            id="poForwarderSelect"
            className="input"
            value={forwarderId === null ? '' : String(forwarderId)}
            disabled={forwardersQuery.isError}
            onChange={(e) => void handleForwarderSelect(e.target.value)}
          >
            <option value="">Digitar manualmente</option>
            {forwarders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.isDefault ? `${item.companyName} (padrão)` : item.companyName}
              </option>
            ))}
          </select>
          {forwardersQuery.isError && (
            <p className="cmp-po__dica">
              Não foi possível carregar os forwarders; digite o contato abaixo.
            </p>
          )}
          {forwardersQuery.isSuccess && forwarders.length === 0 && (
            <p className="cmp-po__dica">
              Nenhum forwarder cadastrado. Cadastre em{' '}
              <a href="/forwarders" target="_blank" rel="noreferrer">
                Forwarders
              </a>
              .
            </p>
          )}
        </div>

        <div className="cmp-campo">
          <label className="field-label" htmlFor="poForwarderInfo">
            Contato do despachante (forwarder)
          </label>
          <textarea
            id="poForwarderInfo"
            className="textarea"
            // Empresa + endereço + 1–2 contatos ocupam ~6 linhas; com 3 o texto preenchido ficava cortado.
            rows={Math.min(10, Math.max(4, poForwarderInfo.split('\n').length + 1))}
            value={poForwarderInfo}
            onChange={(e) => {
              userTouchedRef.current = true;
              setPoForwarderInfo(e.target.value);
            }}
            placeholder="Nome, e-mail e telefone do despachante responsável pelo embarque."
          />
          <p className={forwarderInfoTooLong ? 'cmp-po__contador cmp-po__contador--excedido' : 'cmp-po__contador'}>
            {forwarderInfoLength}/{MAX_FORWARDER_INFO_LENGTH}
          </p>
        </div>

        <div className="cmp-campo">
          <label className="field-label" htmlFor="poMessage">
            Mensagem
          </label>
          <textarea
            id="poMessage"
            className="textarea"
            rows={3}
            value={poMessage}
            onChange={(e) => setPoMessage(e.target.value)}
            placeholder="Opcional. Aparece logo após a saudação, no topo do e-mail."
          />
          <p className="cmp-po__dica">
            Assinatura: definida em{' '}
            <a href="/minha-conta" target="_blank" rel="noreferrer">
              Minha conta
            </a>
            .
          </p>
        </div>

        {poModalError && (
          <p
            role="alert"
            className="cmp-po-aviso cmp-po-aviso--erro cmp-po__erro"
          >
            <Icon name="alert-circle" size={16} strokeWidth={1.9} />
            <span>{poModalError}</span>
          </p>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={
            poSendMutation.isPending ||
            !poSubject.trim() ||
            !poFileBase64 ||
            !poForwarderInfo.trim() ||
            forwarderInfoTooLong
          }
          onClick={() => poSendMutation.mutate()}
        >
          <Icon name="file-text" size={16} strokeWidth={1.9} />
          {poSendMutation.isPending ? 'Enviando…' : 'Enviar Ordem de Compra'}
        </button>
      </div>
    </Modal>
  );
}
