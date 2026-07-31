import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { api } from '@/api/client';
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

export default function Itens() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [families, setFamilies] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // Import states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState<{ validLines: any[], errorLines: any[] } | null>(null);
  const [importResult, setImportResult] = useState<{ successLines: any[], errorLines: any[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      params.set('includeInactive', String(showInactive));
      params.set('pageSize', '200');
      const data = await api.get<{ data: CatalogItem[] }>(`/v1/catalog-items?${params.toString()}`);
      const list =
        data && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown }).data)
          ? (data as { data: CatalogItem[] }).data
          : [];
      setItems(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, showInactive]);

  useEffect(() => {
    void refresh();
    api.get<{ data: { id: number; name: string }[] }>('/v1/item-families').then(res => {
      if (res && res.data) setFamilies(res.data);
    }).catch(console.error);
  }, [refresh]);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.commercialName.trim() || !form.marketName.trim()) {
      setFeedback({ kind: 'error', message: 'Informe o nome comercial e o nome de mercado.' });
      return;
    }
    if (form.ncm && form.ncm.length !== 8) {
      setFeedback({ kind: 'error', message: 'O NCM deve ter 8 dígitos.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const payload = {
        commercialName: form.commercialName.trim(),
        marketName: form.marketName.trim(),
        ncm: form.ncm.trim() || null,
        dbcorpCode: form.dbcorpCode.trim() || null,
        isDangerousGood: form.isDangerousGood,
        familyId: form.familyId !== '' ? Number(form.familyId) : null,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        await api.put(`/v1/catalog-items/${editing.id}`, payload);
        setFeedback({ kind: 'success', message: `Item "${payload.commercialName}" atualizado.` });
      } else {
        await api.post('/v1/catalog-items', payload);
        setFeedback({ kind: 'success', message: `Item "${payload.commercialName}" criado.` });
        setForm(EMPTY_FORM);
      }
      await refresh();
    } catch (err) {
      setFeedback({ kind: 'error', message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleSoftDelete(item: CatalogItem) {
    if (!confirm(`Inativar o item "${item.commercialName}"?`)) return;
    try {
      await api.del(`/v1/catalog-items/${item.id}`);
      setFeedback({ kind: 'success', message: 'Item inativado.' });
      await refresh();
    } catch (err) {
      setFeedback({ kind: 'error', message: (err as Error).message });
    }
  }

  async function handleReactivate(item: CatalogItem) {
    try {
      await api.put(`/v1/catalog-items/${item.id}`, { isActive: true });
      setFeedback({ kind: 'success', message: 'Item reativado.' });
      await refresh();
    } catch (err) {
      setFeedback({ kind: 'error', message: (err as Error).message });
    }
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
      void refresh();
    }
  }

  async function handlePreviewImport() {
    if (!importFile) return;
    setImportLoading(true);
    setImportError('');
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = (e.target?.result as string).split(',')[1];
        if (!base64) throw new Error('Falha ao ler arquivo');
        try {
          const res = await api.post<{ data: { validLines: any[], errorLines: any[] } }>('/v1/catalog-items/import', { contentBase64: base64 });
          setImportPreview(res.data);
          setImportStep('preview');
        } catch (apiErr: any) {
          setImportError(apiErr.message || 'Erro ao processar arquivo.');
        } finally {
          setImportLoading(false);
        }
      };
      reader.onerror = () => {
        setImportError('Erro ao ler arquivo.');
        setImportLoading(false);
      };
      reader.readAsDataURL(importFile);
    } catch (err: any) {
      setImportError(err.message || 'Erro desconhecido');
      setImportLoading(false);
    }
  }

  async function handleConfirmImport() {
    if (!importPreview?.validLines.length) return;
    setImportLoading(true);
    setImportError('');
    try {
      const res = await api.post<{ data: { successLines: any[], errorLines: any[] } }>('/v1/catalog-items/import/confirm', { items: importPreview.validLines });
      setImportResult(res.data);
      setImportStep('result');
    } catch (apiErr: any) {
      setImportError(apiErr.message || 'Erro ao confirmar importação.');
    } finally {
      setImportLoading(false);
    }
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
          <button type="button" className="secondary-button" onClick={openImportModal}>
            Importar itens
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

          {loading ? (
            <div className="itens-empty">Carregando…</div>
          ) : error ? (
            <div className="itens-empty" style={{ color: 'var(--danger)' }}>{error}</div>
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
                {families.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
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
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? 'Salvando…' : editing ? 'Atualizar item' : 'Cadastrar item'}
              </button>
            </div>
          </form>
        </section>
      </div>

      <Modal isOpen={isImportModalOpen} onClose={closeImportModal} title="Importar Itens do Catálogo">
        <div className="import-modal-content" style={{ minWidth: 500, minHeight: 300, display: 'flex', flexDirection: 'column' }}>
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
                style={{ display: 'block', marginBottom: 16 }}
              />
              {importError && <div className="alert alert--error" style={{ marginBottom: 16 }}>{importError}</div>}
              <div className="modal-actions" style={{ marginTop: 'auto', paddingTop: 16 }}>
                <button type="button" className="btn-secondary" onClick={closeImportModal} disabled={importLoading}>Cancelar</button>
                <button type="button" className="btn-primary" onClick={handlePreviewImport} disabled={!importFile || importLoading}>
                  {importLoading ? 'Processando...' : 'Carregar e Validar'}
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
                <div style={{ marginBottom: 16, maxHeight: 150, overflowY: 'auto', backgroundColor: '#fef2f2', padding: 8, borderRadius: 4 }}>
                  <strong style={{ color: '#991b1b', display: 'block', marginBottom: 8 }}>Linhas com erro (serão ignoradas):</strong>
                  <ul style={{ color: '#991b1b', fontSize: 14, paddingLeft: 20, margin: 0 }}>
                    {importPreview.errorLines.map((e, idx) => (
                      <li key={idx}>Linha {e.row}: {e.reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              {importError && <div className="alert alert--error" style={{ marginBottom: 16 }}>{importError}</div>}

              <div className="modal-actions" style={{ marginTop: 'auto', paddingTop: 16 }}>
                <button type="button" className="btn-secondary" onClick={() => setImportStep('upload')} disabled={importLoading}>Voltar</button>
                <button type="button" className="btn-primary" onClick={handleConfirmImport} disabled={importPreview.validLines.length === 0 || importLoading}>
                  {importLoading ? 'Importando...' : 'Confirmar Importação'}
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
                <div style={{ marginBottom: 16, maxHeight: 150, overflowY: 'auto', backgroundColor: '#fef2f2', padding: 8, borderRadius: 4 }}>
                  <strong style={{ color: '#991b1b', display: 'block', marginBottom: 8 }}>Erros ao salvar no banco:</strong>
                  <ul style={{ color: '#991b1b', fontSize: 14, paddingLeft: 20, margin: 0 }}>
                    {importResult.errorLines.map((e, idx) => (
                      <li key={idx}>Linha {e.row}: {e.reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: 'auto', paddingTop: 16 }}>
                <button type="button" className="btn-primary" onClick={closeImportModal}>Concluir</button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
