import { ChangeEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Modal } from '@/components/Modal';
import {
  CR_ATTACHMENT_ACCEPT,
  CR_ATTACHMENT_KIND_LABELS,
  CR_ATTACHMENT_KINDS,
  CR_ATTACHMENT_MAX_FILE_BYTES,
  CR_ATTACHMENT_MAX_PER_REQUEST,
  CommercialRequestAttachment,
  CommercialRequestAttachmentKind,
  defaultAttachmentKind,
  deleteCommercialRequestAttachment,
  downloadCommercialRequestAttachment,
  resolveAttachmentMime,
  uploadCommercialRequestAttachment,
} from '@/services/commercialRequestAttachments';
import { formatFileSize } from '@/services/supplierDocuments';

export interface PendingAttachment {
  /** Chave local (estavel) da selecao. */
  key: string;
  file: File;
  kind: CommercialRequestAttachmentKind;
}

const HELP_TEXT = 'TDS, MSDS ou outro. PDF, PNG ou JPEG, até 10 MB cada, no máximo 5.';

export function attachmentErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

let selectionSeq = 0;

/**
 * Valida os arquivos escolhidos no cliente (tipo, tamanho, quantidade, repeticao). O servidor
 * valida de novo pelos bytes; aqui so evita o envio inutil e explica o motivo.
 * `alreadyCount` = anexos que a solicitacao ja tem + os ja selecionados.
 */
export function validateSelectedFiles(
  incoming: File[],
  alreadyCount: number,
  selected: PendingAttachment[] = [],
): { accepted: PendingAttachment[]; errors: string[] } {
  const accepted: PendingAttachment[] = [];
  const errors: string[] = [];
  const sameFile = (a: File, b: File) =>
    a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

  for (const file of incoming) {
    if (alreadyCount + accepted.length >= CR_ATTACHMENT_MAX_PER_REQUEST) {
      errors.push(`Máximo de ${CR_ATTACHMENT_MAX_PER_REQUEST} arquivos por solicitação.`);
      break;
    }
    if (resolveAttachmentMime(file) === null) {
      errors.push(`"${file.name}": tipo não permitido. Envie PDF, PNG ou JPEG.`);
    } else if (file.size === 0) {
      errors.push(`"${file.name}": o arquivo está vazio.`);
    } else if (file.size > CR_ATTACHMENT_MAX_FILE_BYTES) {
      errors.push(`"${file.name}": excede o limite de 10 MB.`);
    } else if (
      selected.some((item) => sameFile(item.file, file)) ||
      accepted.some((item) => sameFile(item.file, file))
    ) {
      errors.push(`"${file.name}": já selecionado.`);
    } else {
      selectionSeq += 1;
      accepted.push({ key: `att-${selectionSeq}`, file, kind: defaultAttachmentKind(file.name) });
    }
  }
  return { accepted, errors };
}

/**
 * Envia os arquivos um a um (sequencial). Para no primeiro erro e devolve o indice que falhou,
 * para a tela manter o restante e avisar. `null` = todos enviados.
 */
export async function sendAttachmentsSequentially(
  requestId: number,
  files: PendingAttachment[],
): Promise<{ index: number; fileName: string; error: unknown } | null> {
  for (const [index, item] of files.entries()) {
    try {
      await uploadCommercialRequestAttachment(requestId, { kind: item.kind, file: item.file });
    } catch (error) {
      return { index, fileName: item.file.name, error };
    }
  }
  return null;
}

interface CampoProps {
  files: PendingAttachment[];
  onChange: (files: PendingAttachment[]) => void;
  /** Anexos que a solicitacao ja tem (entra no limite de 5). */
  existingCount?: number;
  disabled?: boolean;
  /** Prefixo dos ids (varios campos na mesma pagina). */
  idPrefix?: string;
}

/** Campo opcional de arquivos tecnicos: selecao multipla, tipo por arquivo, validacao no cliente. */
export function AnexosTecnicosCampo({
  files,
  onChange,
  existingCount = 0,
  disabled = false,
  idPrefix = 'cr-attach',
}: CampoProps) {
  const [errors, setErrors] = useState<string[]>([]);

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files ?? []);
    // Permite escolher o mesmo arquivo de novo depois de removê-lo.
    event.target.value = '';
    if (incoming.length === 0) return;
    const result = validateSelectedFiles(incoming, existingCount + files.length, files);
    setErrors(result.errors);
    if (result.accepted.length > 0) onChange([...files, ...result.accepted]);
  }

  function changeKind(key: string, kind: CommercialRequestAttachmentKind) {
    onChange(files.map((item) => (item.key === key ? { ...item, kind } : item)));
  }

  function removeFromSelection(key: string) {
    setErrors([]);
    onChange(files.filter((item) => item.key !== key));
  }

  return (
    <div className="form-grid__full" style={{ marginTop: 8 }}>
      <label className="field-label" htmlFor={`${idPrefix}-input`}>
        Arquivos técnicos (opcional)
      </label>
      <input
        id={`${idPrefix}-input`}
        className="input"
        type="file"
        multiple
        accept={CR_ATTACHMENT_ACCEPT}
        disabled={disabled}
        onChange={handleSelect}
      />
      <p className="text-sm" style={{ color: 'var(--ink-soft)', margin: '4px 0 0' }}>
        {HELP_TEXT}
      </p>
      {errors.length > 0 && (
        <ul role="alert" className="text-sm" style={{ color: 'var(--danger)', margin: '4px 0 0', paddingLeft: 18 }}>
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul aria-label="Arquivos selecionados" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
          {files.map((item) => (
            <li
              key={item.key}
              style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}
            >
              <span className="text-sm" style={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>
                {item.file.name} · {formatFileSize(item.file.size)}
              </span>
              <select
                className="select"
                style={{ width: 'auto' }}
                aria-label={`Tipo de ${item.file.name}`}
                value={item.kind}
                disabled={disabled}
                onChange={(e) => changeKind(item.key, e.target.value as CommercialRequestAttachmentKind)}
              >
                {CR_ATTACHMENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {CR_ATTACHMENT_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghost-button ghost-button--sm"
                disabled={disabled}
                aria-label={`Remover ${item.file.name} da seleção`}
                onClick={() => removeFromSelection(item.key)}
              >
                Remover da seleção
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ListaProps {
  requestId: number;
  attachments: CommercialRequestAttachment[];
  /** Mostra "Remover" (so o comercial dono, solicitacao pendente). */
  canRemove?: boolean;
}

/** Lista de anexos: nome, tipo, tamanho, "Baixar" (e "Remover" opcional, com confirmacao). */
export function AnexosLista({ requestId, attachments, canRemove = false }: ListaProps) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(attachmentId: number) {
    setError(null);
    setBusyId(attachmentId);
    try {
      await downloadCommercialRequestAttachment(requestId, attachmentId);
    } catch (err) {
      setError(`Não foi possível baixar o anexo: ${attachmentErrorMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(attachmentId: number) {
    setError(null);
    setBusyId(attachmentId);
    try {
      await deleteCommercialRequestAttachment(requestId, attachmentId);
      setConfirmId(null);
      await qc.invalidateQueries({ queryKey: ['commercial-requests'] });
    } catch (err) {
      setError(`Não foi possível remover o anexo: ${attachmentErrorMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  if (attachments.length === 0) return null;

  return (
    <div>
      <ul className="sol-items-list" style={{ listStyle: 'none', paddingLeft: 0 }}>
        {attachments.map((attachment) => {
          const kindLabel =
            CR_ATTACHMENT_KIND_LABELS[attachment.kind as CommercialRequestAttachmentKind] ?? attachment.kind;
          const busy = busyId === attachment.id;
          return (
            <li key={attachment.id} style={{ marginBottom: 4, overflowWrap: 'anywhere' }}>
              <span className="badge">{kindLabel}</span> {attachment.fileName} ·{' '}
              {formatFileSize(attachment.fileSize)}{' '}
              <button
                type="button"
                className="ghost-button ghost-button--sm"
                disabled={busy}
                aria-label={`Baixar ${attachment.fileName}`}
                onClick={() => void handleDownload(attachment.id)}
              >
                Baixar
              </button>
              {canRemove && confirmId !== attachment.id && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="ghost-button ghost-button--sm danger-button"
                    disabled={busy}
                    aria-label={`Remover ${attachment.fileName}`}
                    onClick={() => setConfirmId(attachment.id)}
                  >
                    Remover
                  </button>
                </>
              )}
              {canRemove && confirmId === attachment.id && (
                <>
                  {' '}
                  <span className="text-sm">Remover este anexo?</span>{' '}
                  <button
                    type="button"
                    className="ghost-button ghost-button--sm danger-button"
                    disabled={busy}
                    onClick={() => void handleRemove(attachment.id)}
                  >
                    Confirmar remoção
                  </button>{' '}
                  <button
                    type="button"
                    className="ghost-button ghost-button--sm"
                    disabled={busy}
                    onClick={() => setConfirmId(null)}
                  >
                    Cancelar
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger)', margin: '4px 0 0' }}>
          {error}
        </p>
      )}
    </div>
  );
}

interface AnexarModalProps {
  requestId: number;
  /** Anexos que a solicitacao ja tem. */
  existingCount: number;
  onClose: () => void;
}

/** Anexar depois: solicitacao pendente de desenvolvimento do proprio comercial. */
export function AnexarArquivoModal({ requestId, existingCount, onClose }: AnexarModalProps) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const failure = await sendAttachmentsSequentially(requestId, files);
    setBusy(false);
    await qc.invalidateQueries({ queryKey: ['commercial-requests'] });
    if (!failure) {
      onClose();
      return;
    }
    // Os anteriores ao que falhou ja foram; mantem o restante para tentar de novo.
    setFiles(files.slice(failure.index));
    setError(
      `O anexo "${failure.fileName}" não foi enviado: ${attachmentErrorMessage(failure.error)}.`,
    );
  }

  return (
    <Modal isOpen onClose={busy ? () => undefined : onClose} title={`Anexar arquivos à solicitação #${requestId}`}>
      <div style={{ textAlign: 'left' }}>
        <AnexosTecnicosCampo
          files={files}
          onChange={setFiles}
          existingCount={existingCount}
          disabled={busy}
          idPrefix="cr-attach-later"
        />
        {error && (
          <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
            {error}
          </p>
        )}
        <div className="row-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={files.length === 0 || busy}
            onClick={() => void handleSend()}
          >
            {busy ? 'Enviando…' : 'Enviar anexos'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface ReenvioProps {
  error: string | null;
  files: PendingAttachment[];
  onChange: (files: PendingAttachment[]) => void;
  /** Anexos que a solicitacao ja recebeu (entra no limite de 5). */
  uploaded: number;
  busy: boolean;
  onRetry: () => void;
  onClose: () => void;
}

/** Modo "so anexos" do modal: a solicitacao ja foi criada, mas algum anexo falhou. */
export function AnexosReenvioPainel({ error, files, onChange, uploaded, busy, onRetry, onClose }: ReenvioProps) {
  return (
    <div>
      {error && (
        <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <AnexosTecnicosCampo
          files={files}
          onChange={onChange}
          existingCount={uploaded}
          disabled={busy}
          idPrefix="cr-attach-retry"
        />
      )}
      <div className="row-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
          Fechar
        </button>
        <button type="button" className="primary-button" disabled={files.length === 0 || busy} onClick={onRetry}>
          {busy ? 'Enviando…' : 'Tentar de novo'}
        </button>
      </div>
    </div>
  );
}
