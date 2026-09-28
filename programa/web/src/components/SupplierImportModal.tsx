import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { Modal } from '@/components/Modal';

interface SupplierImportContact {
  name: string;
  email: string;
  phone: string | null;
  position: string | null;
}

interface SupplierImportRow {
  name: string;
  country: string | null;
  website: string | null;
  acceptedIncoterms: string[];
  paymentTermsDays: number;
  familyIds: number[];
  familyNames: string[];
  tags: string[];
  notes: string | null;
  contact: SupplierImportContact | null;
}

interface ImportErrorLine {
  row: number;
  name: string;
  reason: string;
}

interface ImportPreview {
  validLines: Array<{ row: number } & SupplierImportRow>;
  errorLines: ImportErrorLine[];
}

interface ImportResultLine {
  row: number;
  supplierId: number;
  name: string;
}

interface ImportResult {
  successLines: ImportResultLine[];
  errorLines: ImportErrorLine[];
}

// Mesma implementacao de `readFileAsBase64` de `web/src/pages/Itens.tsx`
// (copia local proposital — nao vira util compartilhado, ver PLAN.md).
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result ?? '').split(',')[1];
      if (!base64) reject(new Error('Falha ao ler arquivo'));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

// Copia local da mesma logica de `messageOf` em `Fornecedores.tsx` L1006.
function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

interface SupplierImportModalProps {
  onClose: () => void;
}

export default function SupplierImportModal({ onClose }: SupplierImportModalProps) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleClose() {
    // Enquanto o confirm roda, o servidor segue criando fornecedores: fechar
    // perderia o resultado e induziria a reimportar achando que cancelou.
    if (confirmImport.isPending) return;
    if (step === 'result') {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['supplier-contacts-bulk'] });
    }
    onClose();
  }

  const downloadTemplate = useMutation({
    mutationFn: async () => {
      const res = await api.get<{ data: { fileName: string; contentBase64: string } }>(
        '/v1/suppliers/import/template',
      );
      return res.data;
    },
    onSuccess: ({ fileName, contentBase64 }) => {
      const binary = atob(contentBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: (err) => setError(messageOf(err) || 'Erro ao baixar o modelo.'),
  });

  const previewImport = useMutation({
    mutationFn: async (selectedFile: File) => {
      const contentBase64 = await readFileAsBase64(selectedFile);
      const res = await api.post<{ data: ImportPreview }>('/v1/suppliers/import', {
        contentBase64,
      });
      return res.data;
    },
    onSuccess: (data) => {
      setPreview(data);
      setStep('preview');
    },
    onError: (err) => setError(messageOf(err) || 'Erro ao processar arquivo.'),
  });

  const confirmImport = useMutation({
    mutationFn: async () => {
      const rows = (preview?.validLines ?? []).map(({ row, familyNames: _familyNames, ...data }) => ({
        row,
        data,
      }));
      const res = await api.post<{ data: ImportResult }>('/v1/suppliers/import/confirm', { rows });
      return res.data;
    },
    onSuccess: (data) => {
      setResult(data);
      setStep('result');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['supplier-contacts-bulk'] });
    },
    onError: (err) => setError(messageOf(err) || 'Erro ao confirmar importação.'),
  });

  function handlePreview() {
    if (!file) return;
    setError('');
    previewImport.mutate(file);
  }

  function handleConfirm() {
    if (!preview?.validLines.length) return;
    setError('');
    confirmImport.mutate();
  }

  return (
    <Modal isOpen onClose={handleClose} title="Importar fornecedores" size="wide">
      <div className="import-modal-content" style={{ minHeight: 300, display: 'flex', flexDirection: 'column' }}>
        {step === 'upload' && (
          <div style={{ flex: 1 }}>
            <p style={{ marginBottom: 8 }}>
              Selecione uma planilha (.xlsx) com as colunas, nesta ordem:
            </p>
            <p style={{ marginBottom: 16, fontSize: 13, color: 'var(--ink-soft)' }}>
              Nome*, País, Website, Incoterms*, Prazo pagamento (dias), Famílias, Tags,
              Observações, Contato nome, Contato e-mail, Contato telefone, Contato cargo.
            </p>
            <button
              type="button"
              className="ghost-button"
              onClick={() => downloadTemplate.mutate()}
              disabled={downloadTemplate.isPending}
              style={{ marginBottom: 16 }}
            >
              {downloadTemplate.isPending ? 'Baixando…' : 'Baixar modelo'}
            </button>
            <input
              type="file"
              accept=".xlsx"
              ref={fileInputRef}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="file-input"
            />
            {error && (
              <div className="alert alert--error" style={{ marginTop: 16, marginBottom: 16 }}>
                {error}
              </div>
            )}
            <div className="modal-actions" style={{ marginTop: 'auto', paddingTop: 16 }}>
              <button type="button" className="ghost-button" onClick={handleClose} disabled={previewImport.isPending}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handlePreview}
                disabled={!file || previewImport.isPending}
              >
                {previewImport.isPending ? 'Processando…' : 'Carregar e validar'}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && preview && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <p style={{ marginBottom: 16 }}>
              Encontramos <strong>{preview.validLines.length}</strong> fornecedores válidos e{' '}
              <strong>{preview.errorLines.length}</strong> linhas com erro.
            </p>

            {preview.errorLines.length > 0 && (
              <div className="alert alert--error" style={{ marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
                <strong style={{ display: 'block', marginBottom: 8 }}>
                  Linhas com erro (serão ignoradas):
                </strong>
                <ul style={{ fontSize: 14, paddingLeft: 20, margin: 0 }}>
                  {preview.errorLines.map((e, idx) => (
                    <li key={idx}>
                      Linha {e.row} ({e.name || '—'}): {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <div className="alert alert--error" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="modal-actions" style={{ marginTop: 'auto', paddingTop: 16 }}>
              <button type="button" className="ghost-button" onClick={() => setStep('upload')} disabled={confirmImport.isPending}>
                Voltar
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleConfirm}
                disabled={preview.validLines.length === 0 || confirmImport.isPending}
              >
                {confirmImport.isPending ? 'Importando…' : 'Confirmar importação'}
              </button>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="alert alert--success" style={{ marginBottom: 16 }}>
              <strong>{result.successLines.length}</strong> fornecedores importados com sucesso.
            </div>

            {result.errorLines.length > 0 && (
              <div className="alert alert--error" style={{ marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
                <strong style={{ display: 'block', marginBottom: 8 }}>Erros ao salvar:</strong>
                <ul style={{ fontSize: 14, paddingLeft: 20, margin: 0 }}>
                  {result.errorLines.map((e, idx) => (
                    <li key={idx}>
                      Linha {e.row} ({e.name || '—'}): {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 'auto', paddingTop: 16 }}>
              <button type="button" className="primary-button" onClick={handleClose}>
                Concluir
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
