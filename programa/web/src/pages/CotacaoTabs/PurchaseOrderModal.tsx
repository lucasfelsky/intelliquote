import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  messageOf,
  type ComparisonResult,
} from '@/services/quoteResponses';
import { sendPurchaseOrder } from '@/services/dispatch';
import { formatForwarderInfo, listForwarders } from '@/services/forwarders';
import { Modal } from '@/components/Modal';
import { useConfirm } from '@/components/useConfirm';

// Espelha o limite do backend (app.ts / QuoteResponseController) -- valida
// no cliente antes de gastar o upload/base64 num arquivo que sera rejeitado.
const MAX_PO_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Mesmo limite do Zod do backend (quotePurchaseOrderSchema.forwarderInfo).
const MAX_FORWARDER_INFO_LENGTH = 2000;

interface PurchaseOrderModalProps {
  target: ComparisonResult;
  requestCode: string;
  productName: string | null;
  onClose: () => void;
  onSent: (target: ComparisonResult) => void;
}

// Modal "Enviar Ordem de Compra" -- so' aparece sobre a proposta vencedora
// (r.isWinner). Anexo = upload de PDF em base64 (so'-envio, sem storage
// duravel). Forwarder = texto editavel que o seletor PREENCHE a partir do cadastro
// (o e-mail leva so' o texto; forwarderId e' enviado apenas para rastreio).
// O estado nasce a cada abertura (o pai usa key={quoteResponseId}).
export function PurchaseOrderModal({
  target,
  requestCode,
  productName,
  onClose,
  onSent,
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

  const forwardersQuery = useQuery({
    queryKey: ['forwarders', { active: true }],
    queryFn: () => listForwarders({ active: true }),
  });
  const forwarders = forwardersQuery.data ?? [];

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
      if (!target.quoteResponseId) throw new Error('Proposta sem ID.');
      return sendPurchaseOrder(target.quoteResponseId, {
        subject: poSubject,
        message: poMessage,
        forwarderInfo: poForwarderInfo,
        ...(forwarderId !== null ? { forwarderId } : {}),
        fileName: poFileName,
        contentBase64: poFileBase64,
        fileType: 'application/pdf',
        fileSize: poFileSize,
      });
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
      title={`Enviar Ordem de Compra — ${target.supplier?.name ?? `Fornecedor #${target.supplierId}`}`}
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

      <label className="field-label" htmlFor="poForwarderSelect" style={{ marginTop: 12 }}>
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
        <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
          Não foi possível carregar os forwarders; digite o contato abaixo.
        </p>
      )}
      {forwardersQuery.isSuccess && forwarders.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
          Nenhum forwarder cadastrado. Cadastre em{' '}
          <a href="/forwarders" target="_blank" rel="noreferrer">
            Forwarders
          </a>
          .
        </p>
      )}

      <label className="field-label" htmlFor="poForwarderInfo" style={{ marginTop: 12 }}>
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
      <p
        style={{
          fontSize: 12,
          marginTop: 4,
          color: forwarderInfoTooLong ? 'var(--danger)' : 'var(--ink-soft)',
        }}
      >
        {forwarderInfoLength}/{MAX_FORWARDER_INFO_LENGTH}
      </p>

      <label className="field-label" htmlFor="poMessage" style={{ marginTop: 12 }}>
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
      <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
        Assinatura: definida em{' '}
        <a href="/minha-conta" target="_blank" rel="noreferrer">
          Minha conta
        </a>
        .
      </p>

      {poModalError && (
        <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{poModalError}</p>
      )}

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
          {poSendMutation.isPending ? 'Enviando…' : 'Enviar Ordem de Compra'}
        </button>
      </div>
    </Modal>
  );
}
