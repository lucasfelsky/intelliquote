import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '@/components/useConfirm';
import {
  createPurchaseOrder,
  deletePurchaseOrder,
  moveItemToPurchaseOrder,
  renamePurchaseOrder,
  reorderPurchaseOrders,
  type PurchaseOrder,
} from '@/services/purchaseOrders';

export interface ItensTabItem {
  id: number;
  productName: string;
  quantity: number;
  unit: string;
  notes: string | null;
  desiredIncoterm: string | null;
  destinationPort: string | null;
  purchaseOrderId: number | null;
  catalogItem?: { commercialName: string; marketName: string; isDangerousGood: boolean } | null;
}

interface ItensTabProps {
  quoteRequestId: number;
  status: 'open' | 'closed';
  canEdit: boolean;
  items: ItensTabItem[];
  purchaseOrders: PurchaseOrder[];
  defaultIncoterm: string;
  defaultPort: string | null;
  hasResponses: boolean;
  onAddItem: (purchaseOrderId: number | null) => void;
  onEditItem: (item: ItensTabItem) => void;
  onRemoveItem: (item: ItensTabItem) => void;
  removePending?: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

function formatNumber(value: number): string {
  return Number.isNaN(value) ? '—' : value.toLocaleString('pt-BR');
}

export function ItensTab(props: ItensTabProps) {
  const {
    quoteRequestId, status, canEdit, items, defaultIncoterm, defaultPort,
    hasResponses, onAddItem, onEditItem, onRemoveItem, removePending,
  } = props;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const editable = canEdit && status === 'open';
  const orders = [...props.purchaseOrders].sort((a, b) => a.position - b.position);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameSubmittedRef = useRef(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  function refresh() {
    // mesma key de CotacaoDetalhe.tsx (id numérico)
    qc.invalidateQueries({ queryKey: ['quote-request', quoteRequestId] });
  }
  const onError = (err: unknown) => setError(errorMessage(err));
  const onSuccess = () => { setError(null); refresh(); };

  const addPo = useMutation({
    mutationFn: () =>
      createPurchaseOrder(quoteRequestId, { adoptUnassigned: orders.length === 0 }),
    onSuccess, onError,
  });
  const renamePo = useMutation({
    mutationFn: ({ id, label }: { id: number; label: string }) => renamePurchaseOrder(id, label),
    onSuccess: () => { setRenamingId(null); onSuccess(); },
    onError,
  });
  const reorderPo = useMutation({
    mutationFn: (orderedIds: number[]) => reorderPurchaseOrders(quoteRequestId, orderedIds),
    onSuccess, onError,
  });
  const removePo = useMutation({
    mutationFn: (id: number) => deletePurchaseOrder(id),
    onSuccess, onError,
  });
  const moveItem = useMutation({
    mutationFn: ({ itemId, poId }: { itemId: number; poId: number | null }) =>
      moveItemToPurchaseOrder(itemId, poId),
    onSuccess, onError,
  });

  const orderIds = new Set(orders.map((o) => o.id));
  const unassigned = items.filter((i) => i.purchaseOrderId === null || !orderIds.has(i.purchaseOrderId));
  const legacy = orders.length === 0;
  const showUnassigned = legacy || unassigned.length > 0;

  async function handleRemovePo(po: PurchaseOrder) {
    const idx = orders.findIndex((o) => o.id === po.id);
    const count = items.filter((i) => i.purchaseOrderId === po.id).length;
    const target = idx > 0 ? orders[idx - 1] : orders[idx + 1];
    // mesma regra do backend (resolveReallocationTarget): anterior; se for a primeira, a próxima; se for a única, "Sem PO"
    const destination = !target
      ? 'para “Sem PO”'
      : idx > 0
        ? `para a PO anterior “${target.label}”`
        : `para a próxima PO “${target.label}” (por ser a primeira)`;
    const message = `Remover “${po.label}”? Os ${count} item(ns) irão ${destination}.`;
    if (await confirm({ title: 'Remover PO', message, confirmText: 'Remover' })) {
      removePo.mutate(po.id);
    }
  }

  function submitRename(po: PurchaseOrder) {
    // Enter seguido de onBlur dispararia 2 PATCH: guarda síncrona via ref
    if (renameSubmittedRef.current) return;
    const label = renameValue.trim();
    if (!label || label === po.label) { setRenamingId(null); return; }
    renameSubmittedRef.current = true;
    renamePo.mutate(
      { id: po.id, label },
      { onError: () => { renameSubmittedRef.current = false; }, onSuccess: () => { renameSubmittedRef.current = false; } },
    );
  }

  function moveOrder(index: number, delta: -1 | 1) {
    const ids = orders.map((o) => o.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    const tmp = ids[index] as number;
    ids[index] = ids[j] as number;
    ids[j] = tmp;
    reorderPo.mutate(ids);
  }

  function renderRow(it: ItensTabItem) {
    return (
      <tr
        key={it.id}
        draggable={editable}
        data-testid={`item-row-${it.id}`}
        onDragStart={(e) => {
          if (!editable) return;
          e.dataTransfer?.setData('text/plain', String(it.id));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <td><strong>{it.catalogItem?.commercialName ?? it.productName}</strong></td>
        <td>{it.catalogItem?.marketName ?? '—'}</td>
        <td>{formatNumber(it.quantity)}</td>
        <td>{it.unit}</td>
        <td>{it.desiredIncoterm ?? defaultIncoterm}</td>
        <td>{it.destinationPort ?? defaultPort ?? '—'}</td>
        <td>{it.catalogItem?.isDangerousGood ? 'Sim' : '—'}</td>
        <td>{it.notes ?? '—'}</td>
        {editable && (
          <td>
            <div style={{ display: 'flex', gap: 6 }}>
              {!legacy && (
                <select
                  aria-label="Mover para PO"
                  value={it.purchaseOrderId !== null && orderIds.has(it.purchaseOrderId) ? String(it.purchaseOrderId) : ''}
                  disabled={moveItem.isPending}
                  onChange={(e) =>
                    moveItem.mutate({
                      itemId: it.id,
                      poId: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">Sem PO</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              )}
              <button type="button" className="ghost-button" onClick={() => onEditItem(it)}>
                Editar
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => onRemoveItem(it)}
                disabled={removePending}
              >
                Remover
              </button>
            </div>
          </td>
        )}
      </tr>
    );
  }

  function renderTable(rows: ItensTabItem[], key: string, poId: number | null) {
    return (
      <div
        className="table-wrapper"
        data-testid={`drop-${key}`}
        onDragOver={(e) => {
          if (!editable || legacy) return;
          e.preventDefault();
          setDragOverKey(key);
        }}
        onDragLeave={() => setDragOverKey((cur) => (cur === key ? null : cur))}
        onDrop={(e) => {
          if (!editable || legacy) return;
          e.preventDefault();
          setDragOverKey(null);
          const itemId = Number(e.dataTransfer?.getData('text/plain'));
          if (!Number.isFinite(itemId) || itemId <= 0) return;
          const item = items.find((i) => i.id === itemId);
          if (!item || (item.purchaseOrderId ?? null) === poId) return;
          moveItem.mutate({ itemId, poId });
        }}
        style={dragOverKey === key ? { outline: '2px dashed var(--accent, #2563eb)' } : undefined}
      >
        <table className="table">
          <thead>
            <tr>
              <th>Nome comercial</th>
              <th>Nome de mercado</th>
              <th>Qtd</th>
              <th>Unidade</th>
              <th>Incoterm</th>
              <th>Porto</th>
              <th>DG</th>
              <th>Notas</th>
              {editable && <th>Ações</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={editable ? 9 : 8}>Nenhum item. Arraste itens para cá.</td></tr>
            ) : rows.map(renderRow)}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h2>Itens</h2>
        {editable && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="ghost-button"
              onClick={() => addPo.mutate()}
              disabled={addPo.isPending}
            >
              + Adicionar PO
            </button>
            <button type="button" className="primary-button" onClick={() => onAddItem(null)}>
              + Adicionar item
            </button>
          </div>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {hasResponses && !legacy && (
        <p className="muted">
          Cotação já tem respostas/envio: reagrupar POs não altera e-mails já enviados nem propostas.
        </p>
      )}
      {items.length === 0 && legacy ? (
        <div className="empty-state">
          <strong>Nenhum item cadastrado</strong>
          <p>
            {editable
              ? 'Use o botão “Adicionar item” para começar.'
              : 'Esta cotação ainda não possui itens.'}
          </p>
        </div>
      ) : legacy ? (
        renderTable(items, 'none', null)
      ) : (
        <>
          {orders.map((po, index) => {
            const rows = items.filter((i) => i.purchaseOrderId === po.id);
            return (
              <section key={po.id} data-testid={`po-group-${po.id}`} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {renamingId === po.id ? (
                    <input
                      aria-label="Rótulo da PO"
                      value={renameValue}
                      maxLength={60}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => submitRename(po)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename(po);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <h3 style={{ margin: 0 }}>{po.label}</h3>
                  )}
                  <span className="muted">({rows.length})</span>
                  {editable && (
                    <>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => { setRenamingId(po.id); setRenameValue(po.label); }}
                      >
                        Renomear
                      </button>
                      <button type="button" className="ghost-button" onClick={() => onAddItem(po.id)}>
                        + Item nesta PO
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        aria-label={`Subir ${po.label}`}
                        disabled={index === 0 || reorderPo.isPending}
                        onClick={() => moveOrder(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        aria-label={`Descer ${po.label}`}
                        disabled={index === orders.length - 1 || reorderPo.isPending}
                        onClick={() => moveOrder(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        aria-label={`Remover PO ${po.label}`}
                        disabled={removePo.isPending}
                        onClick={() => handleRemovePo(po)}
                      >
                        Remover PO
                      </button>
                    </>
                  )}
                </div>
                {renderTable(rows, String(po.id), po.id)}
              </section>
            );
          })}
          {showUnassigned && (
            <section data-testid="po-group-none" style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 6px' }}>Sem PO <span className="muted">({unassigned.length})</span></h3>
              {renderTable(unassigned, 'none', null)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
