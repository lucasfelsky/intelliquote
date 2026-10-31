import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { Icon } from '@/components/icons';
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
  contacts: SupplierImportContact[];
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
      <div className="import-modal-content importacao-fornecedores">
        {step === 'upload' && (
          <div className="importacao-passo">
            <p className="importacao-texto">
              Selecione uma planilha (.xlsx) com as colunas, nesta ordem:
            </p>
            <ol className="importacao-colunas importacao-colunas--grade">
              <li>Nome*</li>
              <li>País</li>
              <li>Website</li>
              <li>Incoterms</li>
              <li>Prazo pagamento (dias)</li>
              <li>Famílias</li>
              <li>Tags</li>
              <li>Observações</li>
              <li>Contato nome</li>
              <li>Contato e-mail</li>
              <li>Contato telefone</li>
              <li>Contato cargo</li>
            </ol>
            <button
              type="button"
              className="ghost-button importacao-modelo"
              onClick={() => downloadTemplate.mutate()}
              disabled={downloadTemplate.isPending}
            >
              <Icon name="download" size={14} strokeWidth={2} />
              {downloadTemplate.isPending ? 'Baixando…' : 'Baixar modelo'}
            </button>
            <label className="importacao-arquivo">
            <input
              type="file"
              accept=".xlsx"
              ref={fileInputRef}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="importacao-arquivo__input"
            />
              <span className="importacao-arquivo__icone">
                <Icon name="file-text" size={18} strokeWidth={1.9} />
              </span>
              <span className="importacao-arquivo__texto">
                <span className="importacao-arquivo__nome">{file ? file.name : 'Nenhum arquivo escolhido'}</span>
                <span className="importacao-arquivo__acao">{file ? 'Escolher outro arquivo' : 'Escolher arquivo'}</span>
              </span>
            </label>
            {error && (
              <div
                role="alert"
                className="importacao-alerta alert--error"
              >
                <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
                <div className="importacao-alerta__corpo">{error}</div>
              </div>
            )}
            <div className="modal-actions">
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
          <div className="importacao-passo">
            <p className="importacao-resumo">
              Encontramos <strong className="importacao-resumo__ok">{preview.validLines.length}</strong> fornecedores válidos e{' '}
              <strong className="importacao-resumo__erro">{preview.errorLines.length}</strong> linhas com erro.
            </p>

            {preview.errorLines.length > 0 && (
              <div
                role="alert"
                className="importacao-alerta alert--error"
              >
                <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
                <div className="importacao-alerta__corpo">
                  <strong className="importacao-alerta__titulo">
                  Linhas com erro (serão ignoradas):
                </strong>
                  <ul className="importacao-alerta__lista">
                  {preview.errorLines.map((e, idx) => (
                    <li key={idx}>
                        Linha <span className="importacao-mono">{e.row}</span> ({e.name || '—'}): {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="importacao-alerta alert--error"
              >
                <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
                <div className="importacao-alerta__corpo">{error}</div>
              </div>
            )}

            <div className="modal-actions">
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
          <div className="importacao-passo">
            <div
              role="status"
              className="importacao-alerta importacao-alerta--centro alert--success"
            >
              <Icon name="check" size={18} strokeWidth={2} />
              <span>
                <strong className="importacao-mono">{result.successLines.length}</strong> fornecedores importados com sucesso.
              </span>
            </div>

            {result.errorLines.length > 0 && (
              <div
                role="alert"
                className="importacao-alerta alert--error"
              >
                <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
                <div className="importacao-alerta__corpo">
                  <strong className="importacao-alerta__titulo">Erros ao salvar:</strong>
                  <ul className="importacao-alerta__lista">
                  {result.errorLines.map((e, idx) => (
                    <li key={idx}>
                        Linha <span className="importacao-mono">{e.row}</span> ({e.name || '—'}): {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
              </div>
            )}

            <div className="modal-actions">
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
