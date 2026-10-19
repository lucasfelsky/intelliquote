import { CSSProperties, FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Modal } from '@/components/Modal';
import { useConfirm } from '@/components/useConfirm';
import {
  SUPPLIER_DOCUMENT_ALLOWED_MIME,
  SUPPLIER_DOCUMENT_MAX_FILE_BYTES,
  SupplierDocument,
  SupplierDocumentMime,
  createSupplierDocument,
  deleteSupplierDocument,
  downloadSupplierDocument,
  formatDateKeyBR,
  formatFileSize,
  listSupplierDocuments,
  readFileAsBase64,
  replaceSupplierDocumentFile,
  statusLabel,
  updateSupplierDocument,
  type UpdateSupplierDocumentInput,
} from '@/services/supplierDocuments';

interface SupplierDocumentsSectionProps {
  supplierId: number;
  supplierName: string;
}

type FormMode =
  | { kind: 'new' }
  | { kind: 'edit'; doc: SupplierDocument }
  | { kind: 'replace'; doc: SupplierDocument };

const MIME_BY_EXTENSION: Record<string, SupplierDocumentMime> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

const TYPE_ERROR = 'Tipo de arquivo não permitido. Envie PDF, PNG ou JPEG.';
const SIZE_ERROR = 'O arquivo excede o limite de 10 MB.';

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

function buildActionErrorMessage(prefix: string, err: unknown): string {
  return `${prefix} (${messageOf(err)})`;
}

/** Valida tamanho e tipo no cliente (o backend revalida pelos magic bytes). */
function resolveMime(file: File): { mime: SupplierDocumentMime } | { error: string } {
  if (file.size > SUPPLIER_DOCUMENT_MAX_FILE_BYTES) return { error: SIZE_ERROR };
  if (file.size === 0) return { error: 'O arquivo selecionado está vazio.' };

  const declared = SUPPLIER_DOCUMENT_ALLOWED_MIME.find((mime) => mime === file.type);
  if (declared) return { mime: declared };

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const byExtension = MIME_BY_EXTENSION[extension];
  if (byExtension && file.type === '') return { mime: byExtension };

  return { error: TYPE_ERROR };
}

function stripExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(0, index) : fileName;
}

// Abaixo de 720px os documentos viram cards empilhados (a tabela de fornecedores que
// contem esta secao rola na horizontal e jogaria as acoes para fora da tela). Sem
// matchMedia (jsdom) fica na tabela.
const NARROW_QUERY = '(max-width: 719px)';

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(NARROW_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  return narrow;
}

interface NarrowBox {
  width: number;
  left: number;
}

// Ancestral mais proximo que rola na horizontal (na pagina: o .table-wrapper da tabela de
// fornecedores que contem esta secao).
function findHorizontalScroller(from: HTMLElement): HTMLElement | null {
  for (let el = from.parentElement; el; el = el.parentElement) {
    if (/(auto|scroll|hidden)/.test(window.getComputedStyle(el).overflowX)) return el;
  }
  return null;
}

// Em modo cards, mede o clientWidth real do ancestral rolavel para que a secao inteira
// (titulo + botao + cards) caiba na area visivel, colada a esquerda em qualquer posicao de
// rolagem. Sem ancestral rolavel (ou sem layout): null -> 100%.
function useNarrowBox(active: boolean, rootRef: { current: HTMLDivElement | null }): NarrowBox | null {
  const [box, setBox] = useState<NarrowBox | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!active || !root) {
      setBox(null);
      return;
    }
    const scroller = findHorizontalScroller(root);
    if (!scroller) {
      setBox(null);
      return;
    }
    const cell = root.closest('td');
    const pad = cell ? parseFloat(window.getComputedStyle(cell).paddingLeft) || 0 : 0;

    const measure = () => {
      const width = scroller.clientWidth - 2 * pad;
      setBox(width > 0 ? { width, left: pad } : null);
    };
    measure();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(scroller);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active, rootRef]);

  return box;
}

export function SupplierDocumentsSection({ supplierId, supplierName }: SupplierDocumentsSectionProps) {
  const isNarrow = useIsNarrow();
  const rootRef = useRef<HTMLDivElement>(null);
  const narrowBox = useNarrowBox(isNarrow, rootRef);
  const { user } = useAuth();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const canManage = user?.role === 'admin' || user?.role === 'comprador';

  const queryKey = ['supplier-documents', supplierId] as const;
  const documents = useQuery({
    queryKey,
    queryFn: () => listSupplierDocuments(supplierId),
  });

  const [mode, setMode] = useState<FormMode | null>(null);
  const [name, setName] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function invalidate() {
    void qc.invalidateQueries({ queryKey });
    void qc.invalidateQueries({ queryKey: ['supplier-documents-summary'] });
  }

  function closeForm() {
    setMode(null);
    setFile(null);
    setFormError(null);
  }

  const save = useMutation({
    mutationFn: async (currentMode: FormMode) => {
      if (currentMode.kind === 'edit') {
        const { doc } = currentMode;
        const patch: UpdateSupplierDocumentInput = {};
        if (name.trim() !== doc.name) patch.name = name.trim();
        if (expiresOn !== doc.expiresOn) patch.expiresOn = expiresOn;
        if (notes.trim() !== (doc.notes ?? '')) patch.notes = notes.trim() === '' ? null : notes.trim();
        if (Object.keys(patch).length === 0) return;
        await updateSupplierDocument(doc.id, patch);
        return;
      }

      if (!file) throw new Error('Selecione o arquivo.');
      const resolved = resolveMime(file);
      if ('error' in resolved) throw new Error(resolved.error);
      const contentBase64 = await readFileAsBase64(file);

      if (currentMode.kind === 'replace') {
        await replaceSupplierDocumentFile(currentMode.doc.id, {
          fileName: file.name,
          mimeType: resolved.mime,
          contentBase64,
          expiresOn,
        });
        return;
      }

      await createSupplierDocument({
        supplierId,
        name: name.trim(),
        expiresOn,
        notes: notes.trim() === '' ? null : notes.trim(),
        fileName: file.name,
        mimeType: resolved.mime,
        contentBase64,
      });
    },
    onSuccess: () => {
      invalidate();
      closeForm();
    },
    onError: (err) => setFormError(messageOf(err)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteSupplierDocument(id),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) => setActionError(buildActionErrorMessage('Não foi possível excluir o documento', err)),
  });

  const download = useMutation({
    mutationFn: (id: number) => downloadSupplierDocument(id),
    onSuccess: () => setActionError(null),
    onError: (err) => setActionError(buildActionErrorMessage('Não foi possível baixar o documento', err)),
  });

  function openNew() {
    setName('');
    setExpiresOn('');
    setNotes('');
    setFile(null);
    setFormError(null);
    setMode({ kind: 'new' });
  }

  function openEdit(doc: SupplierDocument) {
    setName(doc.name);
    setExpiresOn(doc.expiresOn);
    setNotes(doc.notes ?? '');
    setFile(null);
    setFormError(null);
    setMode({ kind: 'edit', doc });
  }

  function openReplace(doc: SupplierDocument) {
    setName(doc.name);
    setExpiresOn(doc.expiresOn);
    setNotes(doc.notes ?? '');
    setFile(null);
    setFormError(null);
    setMode({ kind: 'replace', doc });
  }

  function handleFileChange(selected: File | null) {
    if (!selected) {
      setFile(null);
      return;
    }
    const resolved = resolveMime(selected);
    if ('error' in resolved) {
      setFile(null);
      setFormError(resolved.error);
      return;
    }
    setFormError(null);
    setFile(selected);
    if (mode?.kind === 'new' && name.trim() === '') setName(stripExtension(selected.name));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!mode) return;

    if (mode.kind !== 'replace' && name.trim() === '') {
      setFormError('Informe o nome do documento.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
      setFormError('Informe a data de vencimento.');
      return;
    }
    if (mode.kind !== 'edit') {
      if (!file) {
        setFormError('Selecione o arquivo (PDF, PNG ou JPEG de até 10 MB).');
        return;
      }
      const resolved = resolveMime(file);
      if ('error' in resolved) {
        setFormError(resolved.error);
        return;
      }
    }

    setFormError(null);
    save.mutate(mode);
  }

  async function handleDelete(doc: SupplierDocument) {
    const ok = await confirm({
      title: 'Excluir documento',
      message: `Excluir o documento "${doc.name}" de ${supplierName}?`,
      confirmText: 'Excluir',
      tone: 'danger',
    });
    if (ok) remove.mutate(doc.id);
  }

  function renderActions(doc: SupplierDocument): ReactNode {
    return (
      <div className="row-actions">
        <button
          type="button"
          className="ghost-button"
          onClick={() => download.mutate(doc.id)}
          disabled={download.isPending}
        >
          Baixar
        </button>
        {canManage && (
          <>
            <button type="button" className="ghost-button" onClick={() => openEdit(doc)}>
              Editar
            </button>
            <button type="button" className="ghost-button" onClick={() => openReplace(doc)}>
              Substituir
            </button>
            <button
              type="button"
              className="ghost-button danger-button"
              onClick={() => void handleDelete(doc)}
              disabled={remove.isPending}
            >
              Excluir
            </button>
          </>
        )}
      </div>
    );
  }

  const rows = documents.data ?? [];
  const modalTitle =
    mode?.kind === 'edit'
      ? 'Editar documento'
      : mode?.kind === 'replace'
        ? 'Substituir arquivo'
        : 'Novo documento';

  // Tabela (>= 720px): width 0 + min-width 100% tira a secao do calculo de largura
  // intrinseca da tabela de fornecedores (ela nao pode alarga-la). Cards (< 720px): secao
  // inteira sticky, com a largura visivel do ancestral rolavel.
  const rootStyle: CSSProperties = isNarrow
    ? {
        marginTop: 16,
        position: 'sticky',
        left: narrowBox?.left ?? 0,
        width: narrowBox ? narrowBox.width : '100%',
        boxSizing: 'border-box',
      }
    : { marginTop: 16, width: 0, minWidth: '100%' };

  return (
    <div ref={rootRef} style={rootStyle}>
      <div className="page-header" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Documentos</h3>
        {canManage && (
          <button type="button" className="ghost-button" onClick={openNew}>
            Novo documento
          </button>
        )}
      </div>

      {actionError && (
        <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
          {actionError}
        </p>
      )}

      {documents.isLoading && <p className="text-sm">Carregando documentos…</p>}

      {documents.isError && (
        <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
          Não foi possível carregar os documentos: {messageOf(documents.error)}
        </p>
      )}

      {!documents.isLoading && !documents.isError && rows.length === 0 && (
        <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>Nenhum documento cadastrado.</p>
      )}

      {rows.length > 0 && !isNarrow && (
        <div className="table-wrapper">
          <table className="table table--dense" style={{ tableLayout: 'fixed', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: '24%' }}>Documento</th>
                <th style={{ width: '11%' }}>Vencimento</th>
                <th style={{ width: '15%' }}>Situação</th>
                <th style={{ width: '13%' }}>Observação</th>
                <th style={{ width: '13%' }}>Arquivo</th>
                <th style={{ width: '24%' }}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((doc) => {
                const status = statusLabel(doc);
                return (
                  <tr key={doc.id}>
                    <td style={{ overflowWrap: 'anywhere' }}>
                      <strong>{doc.name}</strong>
                    </td>
                    <td className="cell-nowrap">{formatDateKeyBR(doc.expiresOn)}</td>
                    <td>
                      <span className={status.badgeClass}>{status.text}</span>
                    </td>
                    <td className="cell-truncate" title={doc.notes ?? undefined}>
                      {doc.notes ?? '—'}
                    </td>
                    <td className="cell-truncate" title={doc.fileName}>
                      {doc.fileName} · {formatFileSize(doc.fileSize)}
                    </td>
                    <td>{renderActions(doc)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && isNarrow && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((doc) => {
            const status = statusLabel(doc);
            return (
              <article
                key={doc.id}
                aria-label={doc.name}
                style={{
                  border: '1px solid var(--border, #dde3ea)',
                  borderRadius: 8,
                  padding: 12,
                  background: 'var(--surface, #fff)',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <strong style={{ overflowWrap: 'anywhere' }}>{doc.name}</strong>
                  <span className={status.badgeClass}>{status.text}</span>
                </div>
                <div className="text-sm" style={{ marginTop: 6 }}>
                  Vencimento: {formatDateKeyBR(doc.expiresOn)}
                </div>
                {doc.notes && (
                  <div className="text-sm" style={{ color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>
                    {doc.notes}
                  </div>
                )}
                <div className="text-sm" style={{ color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>
                  {doc.fileName} · {formatFileSize(doc.fileSize)}
                </div>
                <div style={{ marginTop: 8 }}>{renderActions(doc)}</div>
              </article>
            );
          })}
        </div>
      )}

      {/* Montado só com o formulário aberto: o Modal sempre renderiza <dialog> e o
          Fornecedores.test.tsx localiza os dialogs da página por índice. */}
      {mode && (
        <Modal isOpen onClose={closeForm} title={modalTitle}>
          <form onSubmit={handleSubmit}>
            <p className="text-sm" style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
              Fornecedor: {supplierName}
            </p>
            {mode.kind === 'replace' && (
              <div className="text-sm" style={{ marginBottom: 12 }}>
                <div>
                  Documento: <strong>{mode.doc.name}</strong>
                </div>
                <div style={{ color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>
                  Arquivo atual: {mode.doc.fileName} · {formatFileSize(mode.doc.fileSize)}
                </div>
              </div>
            )}
            <div className="form-grid">
              {mode.kind !== 'replace' && (
                <div className="form-grid__full">
                  <label className="field-label" htmlFor="sd-name">Nome do documento *</label>
                  <input
                    id="sd-name"
                    className="input"
                    value={name}
                    maxLength={120}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              )}
              <div>
                <label className="field-label" htmlFor="sd-expires">Vencimento *</label>
                <input
                  id="sd-expires"
                  className="input"
                  type="date"
                  value={expiresOn}
                  onChange={(e) => setExpiresOn(e.target.value)}
                />
                <p className="text-sm" style={{ color: 'var(--ink-soft)', margin: '4px 0 0' }}>
                  Último dia de validade.
                </p>
              </div>
              {mode.kind !== 'edit' && (
                <div>
                  <label className="field-label" htmlFor="sd-file">Arquivo *</label>
                  <input
                    id="sd-file"
                    className="input"
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
                    onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-sm" style={{ color: 'var(--ink-soft)', margin: '4px 0 0' }}>
                    PDF, PNG ou JPEG, até 10 MB.
                  </p>
                </div>
              )}
              {mode.kind !== 'replace' && (
                <div className="form-grid__full">
                  <label className="field-label" htmlFor="sd-notes">Observação</label>
                  <textarea
                    id="sd-notes"
                    className="input"
                    rows={2}
                    maxLength={1000}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              )}
            </div>

            {formError && (
              <p role="alert" style={{ color: 'var(--danger)', marginTop: 12 }} className="text-sm">
                {formError}
              </p>
            )}

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={closeForm}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={save.isPending}>
                {save.isPending ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
