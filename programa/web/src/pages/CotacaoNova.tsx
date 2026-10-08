import { useConfirm } from '@/components/useConfirm';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { CatalogItemPicker, type PickerCatalogItem } from '@/components/CatalogItemPicker';
import { Modal } from '@/components/Modal';
import { useCatalogItemPickerData } from '@/components/useCatalogItemPickerData';

type Incoterm = 'EXW' | 'FCA' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP';

interface DraftItem {
  tempId: number;
  catalogItemId: number;
  commercialName: string;
  marketName: string;
  isDangerousGood: boolean;
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
  const confirm = useConfirm();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);

  const [requestCode, setRequestCode] = useState('');
  const [desiredIncoterm, setDesiredIncoterm] = useState<Incoterm[]>(['FOB']);
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
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<PickerCatalogItem | null>(null);

  const picker = useCatalogItemPickerData(showItemModal);

  // O Modal abre o <dialog> num efeito do pai (depois dos filhos): foca o campo útil
  // (Quantidade na edição, busca no Novo item) só depois disso.
  useEffect(() => {
    if (!showItemModal) return;
    const timer = setTimeout(() => {
      document.getElementById(editingTempId !== null ? 'itemQuantity' : 'catalogItemSearch')?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [showItemModal, editingTempId]);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const canCreate = user?.role === 'admin' || user?.role === 'comprador';

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
    picker.reset();
    setSelectedCatalogItem(null);
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
    picker.reset();
    setSelectedCatalogItem({
      id: item.catalogItemId,
      commercialName: item.commercialName,
      marketName: item.marketName,
      isDangerousGood: item.isDangerousGood,
      family: null,
    });
    setShowItemModal(true);
  }

  function closeItemModal() {
    setShowItemModal(false);
    setEditingTempId(null);
    setItemForm(emptyItemForm);
    setItemError(null);
    picker.reset();
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
    const catalogItem =
      selectedCatalogItem && selectedCatalogItem.id === itemForm.catalogItemId ? selectedCatalogItem : null;
    if (!catalogItem) {
      setItemError('Item do catálogo não encontrado.');
      return;
    }
    const draft: DraftItem = {
      tempId: editingTempId ?? tempIdCounter++,
      catalogItemId: catalogItem.id,
      commercialName: catalogItem.commercialName,
      marketName: catalogItem.marketName,
      isDangerousGood: catalogItem.isDangerousGood,
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
  }, [editingTempId, itemForm, selectedCatalogItem]);

  function toggleDesiredIncoterm(term: Incoterm) {
    setDesiredIncoterm((current) =>
      current.includes(term) ? current.filter((t) => t !== term) : [...current, term],
    );
  }

  function handleNextStep() {
    setStepError(null);
    if (!currency.trim()) {
      setStepError('Informe a moeda.');
      return;
    }
    if (desiredIncoterm.length === 0) {
      setStepError('Selecione ao menos um incoterm aceitável.');
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
            <div className="form-grid__full">
              <label className="field-label">Incoterms aceitáveis *</label>
              <div className="chip-row">
                {INCOTERMS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`chip${desiredIncoterm.includes(t) ? ' chip--active' : ''}`}
                    onClick={() => toggleDesiredIncoterm(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
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
            >
              + Adicionar item
            </button>
          </div>

          {items.length === 0 ? (
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
                    <td>{it.isDangerousGood ? 'Sim' : '—'}</td>
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
                          onClick={async () => {
                            if (await confirm(`Remover o item ${it.commercialName}?`)) {
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

      <Modal
        isOpen={showItemModal}
        onClose={closeItemModal}
        title={editingTempId !== null ? 'Editar item' : 'Adicionar item do catálogo'}
        size={editingTempId !== null ? undefined : 'wide'}
      >
        {/* Guard: search/expanded são liftados pro CotacaoNova e zeram em
            open/edit/close explicitamente. Modal renderiza children sempre,
            entao mantemos a desmontagem explicita — mesmo padrao do
            ComparacaoTab (Fase 1). */}
        {showItemModal && (
          <form onSubmit={handleItemSubmit}>
            <CatalogItemPicker
              families={picker.families}
              familyItems={picker.familyItems}
              expanded={picker.expanded}
              onToggleFamily={picker.toggleFamily}
              isSearching={picker.isSearching}
              searchItems={picker.searchItems}
              selectedId={itemForm.catalogItemId}
              onSelect={(item) => {
                setItemForm({ ...itemForm, catalogItemId: item.id });
                setSelectedCatalogItem(item);
              }}
              search={picker.search}
              onSearchChange={picker.setSearch}
              selectedItem={selectedCatalogItem}
              disabled={editingTempId !== null}
            >
              <div className="form-grid">
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

              <div>
                <label className="field-label" htmlFor="itemNotes">Notas</label>
                <textarea
                  id="itemNotes"
                  className="textarea"
                  rows={3}
                  value={itemForm.notes}
                  onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
                />
              </div>
            </CatalogItemPicker>

            {itemError && (
              <p className="alert alert--error item-form__error" role="alert">{itemError}</p>
            )}

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={closeItemModal}>
                Cancelar
              </button>
              <button type="submit" className="primary-button">
                {editingTempId !== null ? 'Salvar alterações' : 'Adicionar'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    const body = (err as Error & { body?: { message?: unknown } }).body;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return 'Erro desconhecido.';
}