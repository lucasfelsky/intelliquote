import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useConfirm } from '@/components/useConfirm';
import { Icon } from '@/components/icons';
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
      <div className="page minha-conta-page">
        <h1>Minha conta</h1>
        <p className="minha-conta-carregando" role="status">
          <span className="btn-spinner" aria-hidden="true" />
          Carregando…
        </p>
      </div>
    );
  }

  if (signature.isError || !signature.data) {
    return (
      <div className="page minha-conta-page">
        <h1>Minha conta</h1>
        <div
          className="empty-state empty-state--erro"
          role="alert"
        >
          <span className="empty-state__icon">
            <Icon name="alert-triangle" size={24} strokeWidth={1.7} />
          </span>
          <strong className="empty-state__title">Não foi possível carregar a sua assinatura.</strong>
          <button type="button" className="ghost-button" onClick={() => void signature.refetch()}>
            <Icon name="refresh" size={14} strokeWidth={2} />
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
    <div className="page minha-conta-page">
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

      <div className="minha-conta-grade">
        <div className="minha-conta-coluna">
          <section className="card assinatura-cartao" aria-labelledby="sig-text-title">
            <h2 id="sig-text-title" className="assinatura-cartao__titulo">Texto da assinatura</h2>
            <div className="assinatura-campo">
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
              <p className={`assinatura-contador ${textTooLong ? 'assinatura-contador--excedido' : ''}`}>
                {draft.length}/{SIGNATURE_TEXT_MAX_LENGTH}
              </p>
            </div>
            {textMessage && (
              <p
                role={textMessage.kind === 'error' ? 'alert' : 'status'}
                className={`alert alert--${textMessage.kind === 'error' ? 'error' : 'success'}`}
              >
                {textMessage.text}
              </p>
            )}
            <div className="assinatura-acoes">
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

          <section className="card assinatura-cartao" aria-labelledby="sig-image-title">
            <h2 id="sig-image-title" className="assinatura-cartao__titulo">Imagem da assinatura</h2>
            <p className="assinatura-dica">
              PNG ou JPEG, até 300 KB e no máximo{' '}
              <span className="assinatura-mono assinatura-mono--dica">
                {SIGNATURE_IMAGE_MAX_WIDTH}×{SIGNATURE_IMAGE_MAX_HEIGHT}
              </span>{' '}
              px. A imagem não é redimensionada: envie já no tamanho final.
            </p>
            {image && (
              <p className="assinatura-atual">
                <Icon name="image" size={16} />
                Imagem atual:{' '}
                <span className="assinatura-mono assinatura-mono--atual">
                  {image.width}×{image.height} px · {(image.size / 1024).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB
                </span>
              </p>
            )}
            <div className="assinatura-arquivo">
              <input
                id="signatureImage"
                className="assinatura-arquivo__input"
                type="file"
                accept="image/png,image/jpeg"
                disabled={uploadImage.isPending}
                onChange={(e) => void handleFileChange(e)}
              />
              <label className="ghost-button assinatura-arquivo__botao" htmlFor="signatureImage">
                <Icon name="upload" size={14} strokeWidth={1.9} />
                {image ? 'Substituir imagem' : 'Enviar imagem'}
              </label>
              <span className="assinatura-arquivo__estado">Nenhum arquivo escolhido</span>
            </div>
            {uploadImage.isPending && <p className="assinatura-enviando" role="status">Enviando…</p>}
            {imageMessage && (
              <p
                role={imageMessage.kind === 'error' ? 'alert' : 'status'}
                className={`alert alert--${imageMessage.kind === 'error' ? 'error' : 'success'}`}
              >
                {imageMessage.text}
              </p>
            )}
            {image && (
              <div className="assinatura-acoes">
                <button
                  type="button"
                  className="ghost-button danger-button"
                  disabled={removeImage.isPending}
                  onClick={() => void handleRemoveImage()}
                >
                  <Icon name="trash" size={16} />
                  Remover imagem
                </button>
              </div>
            )}
          </section>
        </div>

        <section className="card assinatura-cartao assinatura-cartao--previa" aria-labelledby="sig-preview-title">
          <h2 id="sig-preview-title" className="assinatura-cartao__titulo">Como sai no e-mail</h2>
          <div
            className="paper-surface"
            data-testid="signature-preview"
            style={{
              background: '#fff',
              backgroundClip: 'padding-box',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '20px 24px',
              fontFamily: 'Arial, sans-serif',
              fontSize: 15,
              lineHeight: '22px',
              color: '#1F2933',
            }}
          >
            <p style={{ margin: '0 0 12px 0' }}>Dear all,</p>
            <p style={{ margin: '0 0 12px 0', color: '#4A5560', fontStyle: 'italic' }}>… corpo do e-mail …</p>
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
    </div>
  );
}
