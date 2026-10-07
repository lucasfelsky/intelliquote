import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useConfirm } from '@/components/useConfirm';
import {
  SIGNATURE_IMAGE_MAX_HEIGHT,
  SIGNATURE_IMAGE_MAX_WIDTH,
  SIGNATURE_TEXT_MAX_LENGTH,
  deleteEmailSignatureImage,
  getEmailSignature,
  precheckSignatureFile,
  readImageDimensions,
  saveEmailSignatureText,
  uploadEmailSignatureImage,
  type EmailSignature,
} from '@/services/account';

// Escopo por usuario: o QueryClient e' compartilhado e o logout nao o limpa;
// sem o id, outro usuario logado no mesmo SPA veria (e poderia salvar) a
// assinatura em cache do anterior.
function signatureQueryKey(userId: number | null | undefined) {
  return ['account', 'email-signature', userId ?? null] as const;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function MinhaConta() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const signatureKey = signatureQueryKey(userId);

  const [textDraft, setTextDraft] = useState<string | null>(null);
  const [textMessage, setTextMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [imageMessage, setImageMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [draftOwner, setDraftOwner] = useState<number | null>(userId);

  // Troca de usuario sem recarregar: descarta rascunho e mensagens do anterior.
  if (draftOwner !== userId) {
    setDraftOwner(userId);
    setTextDraft(null);
    setTextMessage(null);
    setImageMessage(null);
  }

  const signature = useQuery({
    queryKey: signatureKey,
    queryFn: getEmailSignature,
    enabled: userId !== null,
  });

  // Hidrata o rascunho do texto uma vez por usuario, quando os dados chegam.
  useEffect(() => {
    if (signature.data && textDraft === null) {
      setTextDraft(signature.data.text ?? '');
    }
  }, [signature.data, textDraft]);

  const saveText = useMutation({
    mutationFn: (text: string | null) => saveEmailSignatureText(text),
    onSuccess: (result) => {
      qc.setQueryData<EmailSignature>(signatureKey, (current) =>
        current ? { ...current, text: result.text } : current,
      );
      setTextDraft(result.text ?? '');
      setTextMessage({ kind: 'success', text: 'Texto da assinatura salvo.' });
    },
    onError: (error) =>
      setTextMessage({ kind: 'error', text: errorMessage(error, 'Não foi possível salvar o texto.') }),
  });

  const uploadImage = useMutation({
    mutationFn: (file: File) => uploadEmailSignatureImage(file),
    onSuccess: (result) => {
      qc.setQueryData<EmailSignature>(signatureKey, (current) =>
        current ? { ...current, image: result.image } : current,
      );
      setImageMessage({ kind: 'success', text: 'Imagem da assinatura salva.' });
    },
    onError: (error) =>
      setImageMessage({ kind: 'error', text: errorMessage(error, 'Não foi possível enviar a imagem.') }),
  });

  const removeImage = useMutation({
    mutationFn: () => deleteEmailSignatureImage(),
    onSuccess: () => {
      qc.setQueryData<EmailSignature>(signatureKey, (current) =>
        current ? { ...current, image: null } : current,
      );
      setImageMessage({ kind: 'success', text: 'Imagem removida.' });
    },
    onError: (error) =>
      setImageMessage({ kind: 'error', text: errorMessage(error, 'Não foi possível remover a imagem.') }),
  });

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    setImageMessage(null);

    // Pre-checagem so' para UX: o backend valida tudo de novo.
    const precheck = precheckSignatureFile(file);
    if (precheck) {
      setImageMessage({ kind: 'error', text: precheck });
      input.value = '';
      return;
    }
    const dimensions = await readImageDimensions(file);
    if (
      dimensions &&
      (dimensions.width > SIGNATURE_IMAGE_MAX_WIDTH || dimensions.height > SIGNATURE_IMAGE_MAX_HEIGHT)
    ) {
      setImageMessage({
        kind: 'error',
        text: `Redimensione para no máximo ${SIGNATURE_IMAGE_MAX_WIDTH}×${SIGNATURE_IMAGE_MAX_HEIGHT} px (a imagem tem ${dimensions.width}×${dimensions.height} px).`,
      });
      input.value = '';
      return;
    }
    uploadImage.mutate(file, { onSettled: () => { input.value = ''; } });
  }

  async function handleRemoveImage() {
    const ok = await confirm({
      title: 'Remover imagem',
      message: 'Remover a imagem da assinatura? Os próximos e-mails sairão sem ela.',
      confirmText: 'Remover',
      tone: 'danger',
    });
    if (ok) removeImage.mutate();
  }

  function handleSaveText() {
    setTextMessage(null);
    const trimmed = (textDraft ?? '').trim();
    saveText.mutate(trimmed.length > 0 ? trimmed : null);
  }

  if (signature.isLoading) {
    return (
      <div className="page">
        <h1>Minha conta</h1>
        <p>Carregando…</p>
      </div>
    );
  }

  if (signature.isError || !signature.data) {
    return (
      <div className="page">
        <h1>Minha conta</h1>
        <div className="empty-state">
          <p>Não foi possível carregar a sua assinatura.</p>
          <button className="ghost-button" onClick={() => void signature.refetch()}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const data = signature.data;
  const draft = textDraft ?? '';
  const draftTrimmed = draft.trim();
  const savedText = data.text ?? '';
  const textDirty = draftTrimmed !== savedText.trim();
  const textTooLong = draftTrimmed.length > SIGNATURE_TEXT_MAX_LENGTH;
  const image = data.image;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Minha conta</p>
          <h1>Assinatura de e-mail</h1>
          <p>
            Aparece no final do e-mail da Ordem de Compra enviado por você. Sem texto nem imagem, o
            e-mail sai com “Best regards,” + seu nome e e-mail.
          </p>
        </div>
      </div>

      <section className="card" aria-labelledby="sig-text-title">
        <h2 id="sig-text-title" style={{ marginTop: 0 }}>Texto da assinatura</h2>
        <label className="field-label" htmlFor="signatureText">
          Texto (opcional)
        </label>
        <textarea
          id="signatureText"
          className="textarea"
          rows={5}
          value={draft}
          onChange={(e) => setTextDraft(e.target.value)}
          placeholder={'Ex.:\nMaria Santos\nCompras | SQ Quimica\n+55 47 99999-0000'}
        />
        <p
          style={{
            fontSize: 12,
            marginTop: 4,
            color: textTooLong ? 'var(--danger)' : 'var(--ink-soft)',
          }}
        >
          {draft.length}/{SIGNATURE_TEXT_MAX_LENGTH}
        </p>
        {textMessage && (
          <p
            role={textMessage.kind === 'error' ? 'alert' : 'status'}
            className={`alert alert--${textMessage.kind === 'error' ? 'error' : 'success'}`}
          >
            {textMessage.text}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="primary-button"
            disabled={saveText.isPending || textTooLong || !textDirty}
            onClick={handleSaveText}
          >
            {saveText.isPending ? 'Salvando…' : 'Salvar texto'}
          </button>
        </div>
      </section>

      <section className="card" aria-labelledby="sig-image-title">
        <h2 id="sig-image-title" style={{ marginTop: 0 }}>Imagem da assinatura</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
          PNG ou JPEG, até 300 KB e no máximo {SIGNATURE_IMAGE_MAX_WIDTH}×{SIGNATURE_IMAGE_MAX_HEIGHT} px.
          A imagem não é redimensionada: envie já no tamanho final.
        </p>
        {image && (
          <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            Imagem atual: {image.width}×{image.height} px · {(image.size / 1024).toFixed(1)} KB
          </p>
        )}
        <label className="field-label" htmlFor="signatureImage">
          {image ? 'Substituir imagem' : 'Enviar imagem'}
        </label>
        <input
          id="signatureImage"
          type="file"
          accept="image/png,image/jpeg"
          disabled={uploadImage.isPending}
          onChange={(e) => void handleFileChange(e)}
        />
        {uploadImage.isPending && <p style={{ fontSize: 12 }}>Enviando…</p>}
        {imageMessage && (
          <p
            role={imageMessage.kind === 'error' ? 'alert' : 'status'}
            className={`alert alert--${imageMessage.kind === 'error' ? 'error' : 'success'}`}
          >
            {imageMessage.text}
          </p>
        )}
        {image && (
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button danger-button"
              disabled={removeImage.isPending}
              onClick={() => void handleRemoveImage()}
            >
              Remover imagem
            </button>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="sig-preview-title">
        <h2 id="sig-preview-title" style={{ marginTop: 0 }}>Como sai no e-mail</h2>
        <div
          data-testid="signature-preview"
          style={{
            background: '#fff',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '16px 24px',
            fontFamily: 'Arial, sans-serif',
            fontSize: 15,
            lineHeight: '22px',
            color: '#1F2933',
          }}
        >
          <p style={{ margin: '0 0 12px 0' }}>Dear all,</p>
          <p style={{ margin: '0 0 12px 0', color: '#7A848C' }}>… corpo do e-mail …</p>
          {draftTrimmed ? (
            <div style={{ whiteSpace: 'pre-wrap', marginBottom: image ? 8 : 0 }}>{draftTrimmed}</div>
          ) : image ? (
            <div style={{ marginBottom: 8 }}>Best regards,</div>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap' }}>{data.fallbackSignature}</div>
          )}
          {image && (
            <img
              src={image.dataUri}
              alt="Imagem da assinatura"
              width={image.width}
              height={image.height}
              style={{ display: 'block', border: 0, maxWidth: '100%', height: 'auto' }}
            />
          )}
        </div>
      </section>
    </div>
  );
}
