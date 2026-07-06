import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';

interface CatalogItem {
  id: number;
  commercialName: string;
  marketName: string;
  ncm: string | null;
  dbcorpCode: string | null;
  isDangerousGood: boolean;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type FormState = {
  commercialName: string;
  marketName: string;
  ncm: string;
  dbcorpCode: string;
  isDangerousGood: boolean;
  notes: string;
};

const EMPTY_FORM: FormState = {
  commercialName: '',
  marketName: '',
  ncm: '',
  dbcorpCode: '',
  isDangerousGood: false,
  notes: '',
};

function normalizeNcm(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8);
}

export default function Itens() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

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
        <button type="button" className="primary-button" onClick={openCreate}>
          + Novo item
        </button>
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
    </div>
  );
}
