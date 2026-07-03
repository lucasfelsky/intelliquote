import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';

type Incoterm = 'EXW' | 'FCA' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP';

interface CatalogItem {
  id: number;
  commercialName: string;
  marketName: string;
  ncm: string | null;
  dbcorpCode: string | null;
  isDangerousGood: boolean;
  notes: string | null;
  isActive: boolean;
}

interface DraftItem {
  tempId: number;
  catalogItemId: number;
  commercialName: string;
  marketName: string;
  quantity: number;
  unit: string;
  notes: string;
}

interface ItemFormState {
  catalogItemId: number | null;
  quantity: string;
  unit: string;
  notes: string;
}

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const;
const UNITS = ['KG', 'UN', 'M3', 'L', 'TON', 'BOX'] as const;

const emptyItemForm: ItemFormState = {
  catalogItemId: null,
  quantity: '',
  unit: 'KG',
  notes: '',
};

function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR');
}

let tempIdCounter = 1;

export default function CotacaoNova() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);

  const [requestCode, setRequestCode] = useState('');
  const [desiredIncoterm, setDesiredIncoterm] = useState<Incoterm>('FOB');
    const [destinationPort, setDestinationPort] = useState('');
    const [originPort, setOriginPort] = useState('Shanghai');
    const [currency, setCurrency] = useState('USD');
    const [deadlineAt, setDeadlineAt] = useState('');
    const [description, setDescription] = useState('');

  const [stepError, setStepError] = useState<string | null>(null);

  const [items, setItems] = useState<DraftItem[]>([]);
  const [showItemModal, setShowItemModal] = useState(false);
  const [itemForm, setItemForm] = useState<ItemFormState>(emptyItemForm);
  const [itemError, setItemError] = useState<string | null>(null);
  const [editingTempId, setEditingTempId] = useState<number | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const canCreate = user?.role === 'admin' || user?.role === 'comprador';

  const catalogQuery = useQuery({
    queryKey: ['catalog-items-active'],
    queryFn: async () => {
      const data = await api.get<unknown>('/v1/catalog-items', { pageSize: '200' });
      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as { data?: unknown[] })?.data)
          ? (data as { data: unknown[] }).data
          : (data as { items?: unknown[] })?.items ?? [];
      return (list as Array<Record<string, unknown>>).map((c) => ({
        id: Number(c.id),
        commercialName: String(c.commercialName ?? ''),
        marketName: String(c.marketName ?? ''),
        ncm: (c.ncm as string | null) ?? null,
        dbcorpCode: (c.dbcorpCode as string | null) ?? null,
        isDangerousGood: Boolean(c.isDangerousGood),
        notes: (c.notes as string | null) ?? null,
        isActive: Boolean(c.isActive ?? true),
      })) as CatalogItem[];
    },
  });

  const activeCatalog = useMemo(
    () => (catalogQuery.data ?? []).filter((c) => c.isActive),
    [catalogQuery.data],
  );

  const createQuote = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        desiredIncoterm,
            destinationPort: destinationPort.trim() || null,
            originPort: originPort.trim() || 'Shanghai',
            currency: currency.trim().toUpperCase() || 'USD',
            deadlineAt: deadlineAt ? new Date(`${deadlineAt}T00:00:00`).toISOString() : null,
            description: description.trim() || null,
          };
      if (requestCode.trim()) body.requestCode = requestCode.trim();
      const created = await api.post<{ id: number; requestCode?: string }>(`/v1/quote-requests`, body);
      return created;
    },
    onSuccess: async (created) => {
      try {
        for (const it of items) {
          await api.post<unknown>(`/v1/quote-requests/${created.id}/items`, {
            catalogItemId: it.catalogItemId,
            quantity: it.quantity,
            unit: it.unit,
            notes: it.notes || null,
          });
        }
        qc.invalidateQueries({ queryKey: ['quote-requests'] });
        qc.invalidateQueries({ queryKey: ['quote-request', created.id] });
        qc.invalidateQueries({ queryKey: ['quote-request-items'] });
        navigate(`/cotacoes/${created.id}`);
      } catch (err) {
        setSubmitError(`Cotação criada, mas houve erro ao salvar itens: ${messageOf(err)}`);
        qc.invalidateQueries({ queryKey: ['quote-requests'] });
        qc.invalidateQueries({ queryKey: ['quote-request', created.id] });
        navigate(`/cotacoes/${created.id}`);
      }
    },
    onError: (err) => setSubmitError(messageOf(err)),
  });

  function openNewItem() {
    setEditingTempId(null);
    setItemForm(emptyItemForm);
    setItemError(null);
    setShowItemModal(true);
  }

  function openEditItem(item: DraftItem) {
    setEditingTempId(item.tempId);
    setItemForm({
      catalogItemId: item.catalogItemId,
      quantity: String(item.quantity),
      unit: item.unit,
      notes: item.notes,
    });
    setItemError(null);
    setShowItemModal(true);
  }

  function closeItemModal() {
    setShowItemModal(false);
    setEditingTempId(null);
    setItemForm(emptyItemForm);
    setItemError(null);
  }

  const handleItemSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setItemError(null);
    if (itemForm.catalogItemId === null) {
      setItemError('Selecione um item do catálogo.');
      return;
    }
    if (!itemForm.unit.trim()) {
      setItemError('Informe a unidade.');
      return;
    }
    const qty = Number(itemForm.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setItemError('Quantidade deve ser maior que zero.');
      return;
    }
    const catalogItem = activeCatalog.find((c) => c.id === itemForm.catalogItemId);
    if (!catalogItem) {
      setItemError('Item do catálogo não encontrado.');
      return;
    }
    const draft: DraftItem = {
      tempId: editingTempId ?? tempIdCounter++,
      catalogItemId: catalogItem.id,
      commercialName: catalogItem.commercialName,
      marketName: catalogItem.marketName,
      quantity: qty,
      unit: itemForm.unit,
      notes: itemForm.notes.trim(),
    };
    if (editingTempId !== null) {
      setItems((current) => current.map((it) => (it.tempId === editingTempId ? draft : it)));
    } else {
      setItems((current) => [...current, draft]);
    }
    closeItemModal();
  }, [activeCatalog, editingTempId, itemForm]);

  function handleNextStep() {
    setStepError(null);
    if (!currency.trim()) {
      setStepError('Informe a moeda.');
      return;
    }
    setStep(2);
  }

  function handleCreate() {
    setSubmitError(null);
    if (createQuote.isPending) return;
    createQuote.mutate();
  }

  if (!canCreate) {
    return (
      <div className="page">
        <h1>Nova cotação</h1>
        <div className="empty-state">
          <p>Seu perfil não tem permissão para criar cotações.</p>
        </div>
        <button type="button" className="ghost-button" onClick={() => navigate('/cotacoes')}>
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Compras</p>
          <h1>Nova cotação</h1>
          <p>Crie uma cotação e, opcionalmente, adicione itens iniciais.</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="ghost-button" onClick={() => navigate('/cotacoes')}>
            Cancelar
          </button>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            className={`badge${step === 1 ? '' : ' badge--muted'}`}
            style={{ minWidth: 32, textAlign: 'center' }}
          >
            1
          </span>
          <strong style={{ color: step === 1 ? 'var(--ink)' : 'var(--ink-soft)' }}>Cotação</strong>
          <span style={{ color: 'var(--ink-soft)' }}>→</span>
          <span
            className={`badge${step === 2 ? '' : ' badge--muted'}`}
            style={{ minWidth: 32, textAlign: 'center' }}
          >
            2
          </span>
          <strong style={{ color: step === 2 ? 'var(--ink)' : 'var(--ink-soft)' }}>
            Itens do catálogo
          </strong>
        </div>
      </section>

      {step === 1 && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            handleNextStep();
          }}
        >
          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="requestCode">Código</label>
              <input
                id="requestCode"
                className="input"
                value={requestCode}
                onChange={(e) => setRequestCode(e.target.value)}
                placeholder="Será gerado automaticamente"
              />
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
                Será gerado automaticamente se ficar em branco.
              </p>
            </div>
            <div>
              <label className="field-label" htmlFor="incoterm">Incoterm desejado *</label>
              <select
                id="incoterm"
                className="select"
                value={desiredIncoterm}
                onChange={(e) => setDesiredIncoterm(e.target.value as Incoterm)}
              >
                {INCOTERMS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="originPort">Porto de embarque</label>
              <input
                id="originPort"
                className="input"
                value={originPort}
                onChange={(e) => setOriginPort(e.target.value)}
                placeholder="Ex.: Shanghai"
                maxLength={120}
              />
            </div>
            <div>
                          <label className="field-label" htmlFor="destinationPort">Porto de destino</label>
              <input
                            id="destinationPort"
                className="input"
                            value={destinationPort}
                            onChange={(e) => setDestinationPort(e.target.value)}
                            placeholder="Ex.: Porto de Santos"
                            maxLength={120}
              />
            </div>
                        <div>
                          <label className="field-label" htmlFor="currency">Moeda *</label>
                          <input
                            id="currency"
                            className="input"
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value)}
                            maxLength={3}
                            required
                          />
                        </div>
            <div>
              <label className="field-label" htmlFor="deadline">Prazo</label>
              <input
                id="deadline"
                className="input"
                type="date"
                value={deadlineAt}
                onChange={(e) => setDeadlineAt(e.target.value)}
              />
            </div>
            <div className="form-grid__full">
              <label className="field-label" htmlFor="description">Descrição</label>
              <textarea
                id="description"
                className="textarea"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          {stepError && (
            <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{stepError}</p>
          )}

          <div className="page-header__actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
            <button type="submit" className="primary-button">Próximo</button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="card">
          <div className="page-header" style={{ marginBottom: 8 }}>
            <h2>Itens do catálogo</h2>
            <button
              type="button"
              className="primary-button"
              onClick={openNewItem}
              disabled={catalogQuery.isLoading}
            >
              + Adicionar item
            </button>
          </div>

          {catalogQuery.isLoading ? (
            <p>Carregando catálogo…</p>
          ) : catalogQuery.isError ? (
            <p className="alert alert--error">Não foi possível carregar o catálogo.</p>
          ) : activeCatalog.length === 0 ? (
            <div className="empty-state">
              <strong>Nenhum item no catálogo</strong>
              <p>
                Cadastre itens na aba <a href="/itens">Itens</a> antes de montar uma cotação.
              </p>
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <strong>Nenhum item adicionado</strong>
              <p>
                Você pode criar a cotação sem itens e adicioná-los depois na aba de detalhes.
              </p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Nome comercial</th>
                  <th>Nome de mercado</th>
                  <th>Qtd</th>
                  <th>Unidade</th>
                  <th>DG</th>
                  <th>Notas</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.tempId}>
                    <td><strong>{it.commercialName}</strong></td>
                    <td>{it.marketName}</td>
                    <td>{formatNumber(it.quantity)}</td>
                    <td>{it.unit}</td>
                    <td>{isDangerousFlag(activeCatalog, it.catalogItemId) ? 'Sim' : '—'}</td>
                    <td>{it.notes || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => openEditItem(it)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => {
                            if (window.confirm(`Remover o item ${it.commercialName}?`)) {
                              setItems((current) => current.filter((x) => x.tempId !== it.tempId));
                            }
                          }}
                        >
                          Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {submitError && (
            <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{submitError}</p>
          )}

          <div className="page-header__actions" style={{ marginTop: 18, justifyContent: 'space-between' }}>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setStep(1)}
              disabled={createQuote.isPending}
            >
              Voltar
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleCreate}
              disabled={createQuote.isPending}
            >
              {createQuote.isPending ? 'Criando…' : 'Criar cotação'}
            </button>
          </div>
        </div>
      )}

      {showItemModal && (
        <div className="modal-backdrop" onClick={closeItemModal}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleItemSubmit}
          >
            <h2>{editingTempId !== null ? 'Editar item' : 'Adicionar item do catálogo'}</h2>

            <label className="field-label" htmlFor="itemCatalog">Item *</label>
            <select
              id="itemCatalog"
              className="select"
              value={itemForm.catalogItemId ?? ''}
              onChange={(e) =>
                setItemForm({
                  ...itemForm,
                  catalogItemId: e.target.value ? Number(e.target.value) : null,
                })
              }
              required
              disabled={editingTempId !== null}
            >
              <option value="">Selecione…</option>
              {activeCatalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.commercialName} — {c.marketName}
                  {c.isDangerousGood ? ' (DG)' : ''}
                </option>
              ))}
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div>
                <label className="field-label" htmlFor="itemQuantity">Quantidade *</label>
                <input
                  id="itemQuantity"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={itemForm.quantity}
                  onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="itemUnit">Unidade *</label>
                <select
                  id="itemUnit"
                  className="select"
                  value={itemForm.unit}
                  onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                  required
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>

            <label className="field-label" htmlFor="itemNotes" style={{ marginTop: 12 }}>
              Notas
            </label>
            <textarea
              id="itemNotes"
              className="textarea"
              rows={3}
              value={itemForm.notes}
              onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
            />

            {itemError && (
              <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{itemError}</p>
            )}

            <div className="modal__actions">
              <button type="button" className="ghost-button" onClick={closeItemModal}>
                Cancelar
              </button>
              <button type="submit" className="primary-button">
                {editingTempId !== null ? 'Salvar alterações' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function isDangerousFlag(items: CatalogItem[], id: number): boolean {
  return items.some((c) => c.id === id && c.isDangerousGood);
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    const body = (err as Error & { body?: { message?: unknown } }).body;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return 'Erro desconhecido.';
}