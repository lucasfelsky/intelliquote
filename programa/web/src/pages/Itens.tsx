import { useConfirm } from '@/components/useConfirm';
import { useMemo, useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';
import { Modal } from '@/components/Modal';

interface CatalogItem {
  id: number;
  commercialName: string;
  marketName: string;
  ncm: string | null;
  dbcorpCode: string | null;
  isDangerousGood: boolean;
  notes: string | null;
  isActive: boolean;
  familyId: number | null;
  family: { id: number; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

type FormState = {
  commercialName: string;
  marketName: string;
  ncm: string;
  dbcorpCode: string;
  isDangerousGood: boolean;
  familyId: number | '';
  notes: string;
};

const EMPTY_FORM: FormState = {
  commercialName: '',
  marketName: '',
  ncm: '',
  dbcorpCode: '',
  isDangerousGood: false,
  familyId: '',
  notes: '',
};

function normalizeNcm(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8);
}

interface CatalogItemPayload extends Record<string, unknown> {
  commercialName: string;
  marketName: string;
  ncm: string | null;
  dbcorpCode: string | null;
  isDangerousGood: boolean;
  familyId: number | null;
  notes: string | null;
}

interface ImportErrorLine {
  row: number;
  reason: string;
}

interface ImportPreview {
  validLines: Record<string, unknown>[];
  errorLines: ImportErrorLine[];
}

interface ImportResult {
  successLines: Record<string, unknown>[];
  errorLines: ImportErrorLine[];
}

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

export default function Itens() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // Import states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const itemsQuery = useQuery({
    queryKey: ['catalog-items', { search: search.trim(), includeInactive: showInactive }],
    queryFn: async () => {
      const data = await api.get<{ data?: CatalogItem[] }>('/v1/catalog-items', {
        ...(search.trim() ? { search: search.trim() } : {}),
        includeInactive: showInactive,
        pageSize: 200,
      });
      return Array.isArray(data?.data) ? data.data : [];
    },
  });
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);

  const familiesQuery = useQuery({
    queryKey: ['item-families', { includeInactive: false }],
    queryFn: async () => {
      const res = await api.get<{ data?: { id: number; name: string }[] }>('/v1/item-families', { includeInactive: false });
      return res?.data ?? [];
    },
  });
  const families = familiesQuery.data ?? [];

  const familyOptions = useMemo(() => {
    const options: { id: number; name: string; disabled?: boolean }[] = families.map((f) => ({
      id: f.id,
      name: f.name,
    }));
    const currentFamily = editing?.family;
    if (currentFamily && !families.some((f) => f.id === currentFamily.id)) {
      options.push({
        id: currentFamily.id,
        name: `${currentFamily.name} (inativa)`,
        disabled: true,
      });
    }
    return options;
  }, [families, editing]);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.commercialName.localeCompare(b.commercialName, 'pt-BR')),
    [items],
  );

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((i) => i.isActive).length;
    const inactive = total - active;
    const dg = items.filter((i) => i.isDangerousGood).length;
    return { total, active, inactive, dg };
  }, [items]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFeedback(null);
  }

  function openEdit(item: CatalogItem) {
    setEditing(item);
    setForm({
      commercialName: item.commercialName,
      marketName: item.marketName,
      ncm: item.ncm ?? '',
      dbcorpCode: item.dbcorpCode ?? '',
      isDangerousGood: item.isDangerousGood,
      familyId: item.familyId ?? '',
      notes: item.notes ?? '',
    });
    setFeedback(null);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  const save = useMutation({
    mutationFn: async (vars: { id: number | null; payload: CatalogItemPayload }) =>
      vars.id === null
        ? api.post<unknown>('/v1/catalog-items', vars.payload)
        : api.put<unknown>(`/v1/catalog-items/${vars.id}`, vars.payload),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['catalog-items'] });
      if (vars.id === null) {
        setFeedback({ kind: 'success', message: `Item "${vars.payload.commercialName}" criado.` });
        setForm(EMPTY_FORM);
      } else {
        setFeedback({ kind: 'success', message: `Item "${vars.payload.commercialName}" atualizado.` });
      }
    },
    onError: (err) => setFeedback({ kind: 'error', message: messageOf(err) }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.commercialName.trim() || !form.marketName.trim()) {
      setFeedback({ kind: 'error', message: 'Informe o nome comercial e o nome de mercado.' });
      return;
    }
    if (form.ncm && form.ncm.length !== 8) {
      setFeedback({ kind: 'error', message: 'O NCM deve ter 8 dígitos.' });
      return;
    }
    setFeedback(null);
    const payload: CatalogItemPayload = {
      commercialName: form.commercialName.trim(),
      marketName: form.marketName.trim(),
      ncm: form.ncm.trim() || null,
      dbcorpCode: form.dbcorpCode.trim() || null,
      isDangerousGood: form.isDangerousGood,
      familyId: form.familyId !== '' ? Number(form.familyId) : null,
      notes: form.notes.trim() || null,
    };
    save.mutate({ id: editing ? editing.id : null, payload });
  }

  const softDelete = useMutation({
    mutationFn: (item: CatalogItem) => api.del(`/v1/catalog-items/${item.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalog-items'] });
      setFeedback({ kind: 'success', message: 'Item inativado.' });
    },
    onError: (err) => setFeedback({ kind: 'error', message: messageOf(err) }),
  });

  const reactivate = useMutation({
    mutationFn: (item: CatalogItem) => api.put(`/v1/catalog-items/${item.id}`, { isActive: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalog-items'] });
      setFeedback({ kind: 'success', message: 'Item reativado.' });
    },
    onError: (err) => setFeedback({ kind: 'error', message: messageOf(err) }),
  });

  async function handleSoftDelete(item: CatalogItem) {
    if (!(await confirm(`Inativar o item "${item.commercialName}"?`))) return;
    softDelete.mutate(item);
  }

  function handleReactivate(item: CatalogItem) {
    reactivate.mutate(item);
  }

  function openImportModal() {
    setIsImportModalOpen(true);
    setImportStep('upload');
    setImportFile(null);
    setImportError('');
    setImportPreview(null);
    setImportResult(null);
  }

  function closeImportModal() {
    setIsImportModalOpen(false);
    if (importStep === 'result') {
      qc.invalidateQueries({ queryKey: ['catalog-items'] });
    }
  }

  const previewImport = useMutation({
    mutationFn: async (file: File) => {
      const contentBase64 = await readFileAsBase64(file);
      const res = await api.post<{ data: ImportPreview }>('/v1/catalog-items/import', { contentBase64 });
      return res.data;
    },
    onSuccess: (data) => {
      setImportPreview(data);
      setImportStep('preview');
    },
    onError: (err) => setImportError(messageOf(err) || 'Erro ao processar arquivo.'),
  });

  const confirmImport = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: ImportResult }>('/v1/catalog-items/import/confirm', {
        items: importPreview?.validLines ?? [],
      });
      return res.data;
    },
    onSuccess: (data) => {
      setImportResult(data);
      setImportStep('result');
      qc.invalidateQueries({ queryKey: ['catalog-items'] });
    },
    onError: (err) => setImportError(messageOf(err) || 'Erro ao confirmar importação.'),
  });

  function handlePreviewImport() {
    if (!importFile) return;
    setImportError('');
    previewImport.mutate(importFile);
  }

  function handleConfirmImport() {
    if (!importPreview?.validLines.length) return;
    setImportError('');
    confirmImport.mutate();
  }

  return (
    <div className="page itens-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1>Itens</h1>
          <p className="page-subtitle">
            Catálogo de itens utilizado nas cotações. O nome comercial fica visível para o time
            interno; o nome de mercado é o que o fornecedor vê no portal.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" className="ghost-button" onClick={openImportModal}>
            Importar
          </button>
          <button type="button" className="primary-button" onClick={openCreate}>
            + Novo item
          </button>
        </div>
      </header>

      <section className="itens-filters" aria-label="Filtros do catálogo">
        <div className="itens-filters__search">
          <span className="itens-filters__search-icon" aria-hidden="true">🔎</span>
          <input
            type="search"
            placeholder="Buscar por nome comercial, de mercado, NCM ou código DBCorp"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar item"
          />
        </div>
        <div className="itens-filters__stats" aria-live="polite">
          <span><strong>{stats.total}</strong> no total</span>
          <span>•</span>
          <span><strong>{stats.active}</strong> ativos</span>
          <span>•</span>
          <span><strong>{stats.dg}</strong> DG</span>
        </div>
        <label className={`itens-filters__toggle${showInactive ? ' itens-filters__toggle--active' : ''}`}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Mostrar inativos
        </label>
      </section>

      {feedback && (
        <div className={`alert alert--${feedback.kind}`} role="status">
          {feedback.message}
        </div>
      )}

      <section className="itens-summary" aria-label="Resumo do catálogo">
        <div className="itens-summary__cell itens-summary__cell--accent">
          <span>Itens ativos</span>
          <strong>{stats.active}</strong>
        </div>
        <div className="itens-summary__cell">
          <span>Itens inativos</span>
          <strong>{stats.inactive}</strong>
        </div>
        <div className="itens-summary__cell">
          <span>Marcados como DG</span>
          <strong>{stats.dg}</strong>
        </div>
        <div className="itens-summary__cell">
          <span>Total cadastrado</span>
          <strong>{stats.total}</strong>
        </div>
      </section>

      <div className="itens-page__split">
        <section className="card" aria-label="Lista de itens do catálogo">
          <header className="page-header" style={{ marginBottom: 12 }}>
            <div>
              <h2>Catálogo</h2>
              <p className="muted">Clique em um cartão para editar.</p>
            </div>
          </header>

          {itemsQuery.isLoading ? (
            <div className="itens-empty">Carregando…</div>
          ) : itemsQuery.isError ? (
            <div className="itens-empty" style={{ color: 'var(--danger)' }}>{messageOf(itemsQuery.error)}</div>
          ) : sortedItems.length === 0 ? (
            <div className="itens-empty">
              <strong>Nenhum item encontrado</strong>
              <p>
                {search.trim()
                  ? 'Tente ajustar a busca ou limpar os filtros.'
                  : 'Cadastre o primeiro item do catálogo para começar.'}
              </p>
            </div>
          ) : (
            <div className="itens-grid">
              {sortedItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`itens-card${item.isActive ? '' : ' itens-card--inactive'}`}
                  onClick={() => openEdit(item)}
                  aria-label={`Editar item ${item.commercialName}`}
                >
                  <div className="itens-card__head">
                    <div>
                      <div className="itens-card__name">{item.commercialName}</div>
                      <div className="itens-card__market">{item.marketName}</div>
                    </div>
                    <div className="itens-card__badges">
                      {item.isDangerousGood && <span className="itens-card__badge itens-card__badge--dg">DG</span>}
                      <span
                        className={`itens-card__badge ${
                          item.isActive ? 'itens-card__badge--active' : 'itens-card__badge--inactive'
                        }`}
                      >
                        {item.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                      {item.family && (
                        <span className="itens-card__badge" style={{ backgroundColor: '#e2e8f0', color: '#475569' }}>
                          {item.family.name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="itens-card__meta">
                    {item.ncm && (
                      <span>NCM <strong>{item.ncm}</strong></span>
                    )}
                    {item.dbcorpCode && (
                      <span>DBCorp <strong>{item.dbcorpCode}</strong></span>
                    )}
                    {!item.ncm && !item.dbcorpCode && <span>Sem NCM nem DBCorp</span>}
                  </div>

                  {item.notes && <div className="itens-card__notes">{item.notes}</div>}

                  <div className="itens-card__actions">
                    <span
                      role="button"
                      tabIndex={0}
                      className="itens-card__action"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(item);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          openEdit(item);
                        }
                      }}
                    >
                      Editar
                    </span>
                    {item.isActive ? (
                      <span
                        role="button"
                        tabIndex={0}
                        className="itens-card__action itens-card__action--danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleSoftDelete(item);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleSoftDelete(item);
                          }
                        }}
                      >
                        Inativar
                      </span>
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        className="itens-card__action"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleReactivate(item);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleReactivate(item);
                          }
                        }}
                      >
                        Reativar
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card itens-form-card" aria-label="Formulário de item">
          <h2>
            <span className="eyebrow">{editing ? 'Editando' : 'Novo'}</span>
            {editing ? `Editar ${editing.commercialName}` : 'Cadastrar item'}
          </h2>
          <p className="itens-form__hint">
            Preencha os dados abaixo. O NCM é validado com 8 dígitos e o nome de mercado
            deve ser único.
          </p>
          <form onSubmit={handleSubmit} className="form">
            <label className="field">
              <span>Nome comercial *</span>
              <input
                type="text"
                className="input"
                value={form.commercialName}
                onChange={(e) => setForm({ ...form, commercialName: e.target.value })}
                placeholder="Ex.: Poliisobutileno TPO"
                required
              />
            </label>
            <label className="field">
              <span>Nome de mercado / fornecedor *</span>
              <input
                type="text"
                className="input"
                value={form.marketName}
                onChange={(e) => setForm({ ...form, marketName: e.target.value })}
                placeholder="Ex.: TPO PIB 3500"
                required
              />
            </label>
            <label className="field">
              <span>Família</span>
              <select
                className="input"
                value={form.familyId}
                onChange={(e) => setForm({ ...form, familyId: e.target.value ? Number(e.target.value) : '' })}
              >
                <option value="">Sem família</option>
                {familyOptions.map(f => (
                  <option key={f.id} value={f.id} disabled={f.disabled}>{f.name}</option>
                ))}
              </select>
            </label>
            <div className="itens-form__row">
              <label className="field">
                <span>NCM</span>
                <input
                  type="text"
                  className="input"
                  value={form.ncm}
                  onChange={(e) => setForm({ ...form, ncm: normalizeNcm(e.target.value) })}
                  placeholder="8 dígitos"
                  inputMode="numeric"
                  maxLength={8}
                />
              </label>
              <label className="field">
                <span>Código DBCorp</span>
                <input
                  type="text"
                  className="input"
                  value={form.dbcorpCode}
                  onChange={(e) => setForm({ ...form, dbcorpCode: e.target.value })}
                  placeholder="Ex.: PI-TPO"
                />
              </label>
            </div>
            <label
              className={`itens-form__switch${form.isDangerousGood ? ' itens-form__switch--active' : ''}`}
            >
              <input
                type="checkbox"
                checked={form.isDangerousGood}
                onChange={(e) => setForm({ ...form, isDangerousGood: e.target.checked })}
              />
              <span>{form.isDangerousGood ? 'Mercadoria perigosa (DG) — ativo' : 'Marcar como mercadoria perigosa (DG)'}</span>
            </label>
            <label className="field" style={{ marginTop: 12 }}>
              <span>Observações</span>
              <textarea
                className="textarea"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Anotações internas, contexto, restrições…"
              />
            </label>
            <div className="itens-form__actions">
              {editing && (
                <button type="button" className="ghost-button" onClick={openCreate}>
                  Cancelar
                </button>
              )}
              <button type="submit" className="primary-button" disabled={save.isPending}>
                {save.isPending ? 'Salvando…' : editing ? 'Atualizar item' : 'Cadastrar item'}
              </button>
            </div>
          </form>
        </section>
      </div>

      <Modal isOpen={isImportModalOpen} onClose={closeImportModal} title="Importar Itens do Catálogo">
        <div className="import-modal-content" style={{ minHeight: 300, display: 'flex', flexDirection: 'column' }}>
          {importStep === 'upload' && (
            <div style={{ flex: 1 }}>
              <p style={{ marginBottom: 16 }}>
                Selecione uma planilha (xlsx) com as colunas na seguinte ordem:<br/>
                <strong>1. Nome Comercial, 2. Nome de Mercado, 3. NCM, 4. Código DB, 5. Família, 6. Carga Perigosa (Sim/Não), 7. Notas</strong>
              </p>
              <input
                type="file"
                accept=".xlsx"
                ref={fileInputRef}
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                className="file-input"
              />
              {importError && <div className="alert alert--error" style={{ marginBottom: 16 }}>{importError}</div>}
              <div className="modal-actions" style={{ marginTop: 'auto', paddingTop: 16 }}>
                <button type="button" className="ghost-button" onClick={closeImportModal} disabled={previewImport.isPending}>Cancelar</button>
                <button type="button" className="primary-button" onClick={handlePreviewImport} disabled={!importFile || previewImport.isPending}>
                  {previewImport.isPending ? 'Processando...' : 'Carregar e Validar'}
                </button>
              </div>
            </div>
          )}

          {importStep === 'preview' && importPreview && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <p style={{ marginBottom: 16 }}>
                Encontramos <strong>{importPreview.validLines.length}</strong> itens válidos e <strong>{importPreview.errorLines.length}</strong> linhas com erro.
              </p>
              
              {importPreview.errorLines.length > 0 && (
                <div className="alert alert--error" style={{ marginBottom: 16, maxHeight: 150, overflowY: 'auto' }}>
                  <strong style={{ display: 'block', marginBottom: 8 }}>Linhas com erro (serão ignoradas):</strong>
                  <ul style={{ fontSize: 14, paddingLeft: 20, margin: 0 }}>
                    {importPreview.errorLines.map((e, idx) => (
                      <li key={idx}>Linha {e.row}: {e.reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              {importError && <div className="alert alert--error" style={{ marginBottom: 16 }}>{importError}</div>}

              <div className="modal-actions" style={{ marginTop: 'auto', paddingTop: 16 }}>
                <button type="button" className="ghost-button" onClick={() => setImportStep('upload')} disabled={confirmImport.isPending}>Voltar</button>
                <button type="button" className="primary-button" onClick={handleConfirmImport} disabled={importPreview.validLines.length === 0 || confirmImport.isPending}>
                  {confirmImport.isPending ? 'Importando...' : 'Confirmar Importação'}
                </button>
              </div>
            </div>
          )}

          {importStep === 'result' && importResult && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="alert alert--success" style={{ marginBottom: 16 }}>
                <strong>{importResult.successLines.length}</strong> itens importados com sucesso!
              </div>

              {importResult.errorLines.length > 0 && (
                <div className="alert alert--error" style={{ marginBottom: 16, maxHeight: 150, overflowY: 'auto' }}>
                  <strong style={{ display: 'block', marginBottom: 8 }}>Erros ao salvar no banco:</strong>
                  <ul style={{ fontSize: 14, paddingLeft: 20, margin: 0 }}>
                    {importResult.errorLines.map((e, idx) => (
                      <li key={idx}>Linha {e.row}: {e.reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: 'auto', paddingTop: 16 }}>
                <button type="button" className="primary-button" onClick={closeImportModal}>Concluir</button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
