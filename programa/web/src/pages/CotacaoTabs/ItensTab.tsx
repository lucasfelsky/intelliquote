import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
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
import {
  ChevronDownIcon,
  ChevronUpIcon,
  GripIcon,
  InfoIcon,
  PencilIcon,
  TrashIcon,
} from './ItensTabIcons';
import { MoveItemModal } from './MoveItemModal';

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
  hasResponsesOrDispatch: boolean;
  onAddItem: (purchaseOrderId: number | null) => void;
  onEditItem: (item: ItensTabItem) => void;
  onRemoveItem: (item: ItensTabItem) => void;
  removePending?: boolean;
}

// Foco programático pós-ação. O DOM só muda depois do refetch: `waitOrder`/`waitItem`
// seguram o foco até a lista refletir o resultado (o React move nós e o foco se perde).
interface FocusTarget {
  key: string;
  waitOrder?: { poId: number; index: number };
  waitItem?: { itemId: number; poId: number | null };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

function formatNumber(value: number): string {
  return Number.isNaN(value) ? '—' : value.toLocaleString('pt-BR');
}

function itensLabel(n: number): string {
  return n === 1 ? '1 item' : `${n} itens`;
}

function itemName(it: ItensTabItem): string {
  return it.catalogItem?.commercialName ?? it.productName;
}

export function ItensTab(props: ItensTabProps) {
  const {
    quoteRequestId, status, canEdit, items, defaultIncoterm, defaultPort,
    hasResponsesOrDispatch, onAddItem, onEditItem, onRemoveItem, removePending,
  } = props;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const editable = canEdit && status === 'open';
  const orders = [...props.purchaseOrders].sort((a, b) => a.position - b.position);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameSubmittedRef = useRef(false);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [movingItem, setMovingItem] = useState<ItensTabItem | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null);
  const focusRefs = useRef(new Map<string, HTMLElement>());

  // PO única não existe: agrupado só com 2+ POs (cotação legada com 1 PO = modo simples).
  const grouped = orders.length >= 2;
  const orderIds = new Set(orders.map((o) => o.id));
  const poIdOf = (it: ItensTabItem): number | null =>
    it.purchaseOrderId !== null && orderIds.has(it.purchaseOrderId) ? it.purchaseOrderId : null;
  const unassigned = items.filter((i) => poIdOf(i) === null);
  const colSpan = editable ? 9 : 8;

  function refFor(key: string) {
    return (el: HTMLElement | null) => {
      if (el) focusRefs.current.set(key, el);
      else focusRefs.current.delete(key);
    };
  }

  // Foca o alvo assim que o elemento existir (e a lista refletir o resultado da ação).
  useEffect(() => {
    if (!pendingFocus) return;
    const { waitOrder, waitItem } = pendingFocus;
    if (waitOrder && orders.findIndex((o) => o.id === waitOrder.poId) !== waitOrder.index) return;
    if (waitItem) {
      const it = items.find((i) => i.id === waitItem.itemId);
      if (!it || poIdOf(it) !== waitItem.poId) return;
    }
    const el = focusRefs.current.get(pendingFocus.key);
    if (!el || (el as HTMLButtonElement).disabled) return;
    el.focus();
    setPendingFocus(null);
  });

  // Descarta um alvo de foco órfão (a lista nunca refletiu a ação): evita roubar o foco depois.
  useEffect(() => {
    if (!pendingFocus) return;
    const timer = setTimeout(() => {
      setPendingFocus((cur) => (cur === pendingFocus ? null : cur));
    }, 5000);
    return () => clearTimeout(timer);
  }, [pendingFocus]);

  // Região de status estável (sempre montada): limpa e escreve no quadro seguinte para o
  // leitor de tela anunciar também mensagens repetidas.
  const announce = useCallback((message: string) => {
    setAnnouncement('');
    const write = () => setAnnouncement(message);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(write);
    else setTimeout(write, 0);
  }, []);

  // Input de renomear abre com foco e texto selecionado (ref estável: roda só na montagem).
  const renameInputRef = useCallback((el: HTMLInputElement | null) => {
    if (el) { el.focus(); el.select(); }
  }, []);

  function refresh() {
    // mesma key de CotacaoDetalhe.tsx (id numérico)
    qc.invalidateQueries({ queryKey: ['quote-request', quoteRequestId] });
  }
  const failWith = (prefix: string) => (err: unknown) => setError(`${prefix} ${errorMessage(err)}`);
  const succeed = () => { setError(null); refresh(); };

  const groupPo = useMutation({
    mutationFn: () => createPurchaseOrder(quoteRequestId, { group: true }),
    onSuccess: (result) => {
      succeed();
      const created = result?.purchaseOrder;
      if (!created) return;
      const first = result.purchaseOrders?.[0];
      setPendingFocus({ key: `heading:${created.id}` });
      announce(`Itens agrupados em “${first?.label ?? 'PO 1'}”. “${created.label}” foi criada vazia.`);
    },
    onError: failWith('Não foi possível agrupar por PO.'),
  });
  const addPo = useMutation({
    mutationFn: () => createPurchaseOrder(quoteRequestId, { adoptUnassigned: false }),
    onSuccess: (result) => {
      succeed();
      const created = result?.purchaseOrder;
      if (!created) return;
      // a nova PO já abre em renomeação inline (o usuário informa o número real)
      renameSubmittedRef.current = false;
      setRenamingId(created.id);
      setRenameValue(created.label);
      announce(`“${created.label}” criada.`);
    },
    onError: failWith('Não foi possível criar a PO.'),
  });
  const renamePo = useMutation({
    mutationFn: ({ id, label }: { id: number; label: string }) => renamePurchaseOrder(id, label),
    onSuccess: (_result, vars) => {
      setRenamingId(null);
      setPendingFocus({ key: `pencil:${vars.id}` });
      succeed();
    },
    onError: failWith('Não foi possível renomear a PO.'),
  });
  const reorderPo = useMutation({
    mutationFn: (v: { orderedIds: number[]; poId: number; label: string; to: number; delta: -1 | 1 }) =>
      reorderPurchaseOrders(quoteRequestId, v.orderedIds),
    onSuccess: (_result, vars) => {
      succeed();
      // Se o botão usado ficou desabilitado (virou a 1ª/última), foca o oposto.
      const lastIndex = orders.length - 1;
      const useOpposite = (vars.delta === -1 && vars.to === 0) || (vars.delta === 1 && vars.to === lastIndex);
      const kind = (vars.delta === -1) !== useOpposite ? 'up' : 'down';
      setPendingFocus({ key: `${kind}:${vars.poId}`, waitOrder: { poId: vars.poId, index: vars.to } });
      announce(`“${vars.label}” agora é a ${vars.to + 1}ª de ${orders.length}.`);
    },
    onError: failWith('Não foi possível reordenar as POs.'),
  });
  const removePo = useMutation({
    mutationFn: (v: { id: number; label: string; count: number; targetId: number | null; targetLabel: string | null }) =>
      deletePurchaseOrder(v.id),
    onSuccess: (result, vars) => {
      succeed();
      if (result?.dissolved) {
        setPendingFocus({ key: 'group' });
        announce('Agrupamento desfeito. Os itens voltaram para a lista única.');
        return;
      }
      if (vars.targetId !== null) setPendingFocus({ key: `heading:${vars.targetId}` });
      announce(
        vars.count > 0 && vars.targetLabel
          ? `“${vars.label}” removida. ${vars.count === 1 ? '1 item foi' : `${vars.count} itens foram`} para “${vars.targetLabel}”.`
          : `“${vars.label}” removida.`,
      );
    },
    onError: failWith('Não foi possível remover a PO.'),
  });
  const moveItem = useMutation({
    mutationFn: (v: { itemId: number; poId: number | null; name: string; destLabel: string; viaModal: boolean }) =>
      moveItemToPurchaseOrder(v.itemId, v.poId),
    onSuccess: (_result, vars) => {
      succeed();
      setMovingItem(null);
      if (vars.viaModal) {
        setPendingFocus({ key: `move:${vars.itemId}`, waitItem: { itemId: vars.itemId, poId: vars.poId } });
      }
      announce(`“${vars.name}” movido para “${vars.destLabel}”.`);
    },
    onError: (err, vars) => {
      setError(`Não foi possível mover o item. ${errorMessage(err)}`);
      if (vars.viaModal) {
        setMovingItem(null);
        setPendingFocus({ key: `move:${vars.itemId}` });
      }
    },
  });

  async function handleRemovePo(po: PurchaseOrder) {
    const idx = orders.findIndex((o) => o.id === po.id);
    const count = items.filter((i) => poIdOf(i) === po.id).length;
    let title: string;
    let message: string;
    let confirmText = 'Remover PO';
    let target: PurchaseOrder | undefined;
    if (orders.length === 2) {
      // 2 -> 1 desfaz o agrupamento: o backend remove as duas POs (PO única não existe).
      const other = orders[idx === 0 ? 1 : 0] as PurchaseOrder;
      const total = items.length;
      const tail = total === 0
        ? '. Nenhum item será movido.'
        : total === 1
          ? ' e o item da cotação volta para a lista única, sem PO.'
          : ` e os ${total} itens da cotação voltam para a lista única, sem PO.`;
      title = `Remover “${po.label}” e desfazer o agrupamento?`;
      message = `Com uma PO só, o agrupamento deixa de existir: “${other.label}” também será removida${tail}`;
      if (hasResponsesOrDispatch) message += ' E-mails já enviados e propostas recebidas não mudam.';
      confirmText = 'Remover e desagrupar';
    } else {
      // mesma regra do backend (resolveReallocationTarget): anterior; se for a primeira, a próxima
      target = idx > 0 ? orders[idx - 1] : orders[idx + 1];
      title = `Remover “${po.label}”?`;
      if (count === 0 || !target) {
        message = 'A PO está vazia. Nenhum item será movido.';
      } else {
        const which = idx > 0 ? 'a PO anterior' : 'a próxima PO';
        message = count === 1
          ? `O item desta PO vai para ${which}, “${target.label}”.`
          : `Os ${count} itens desta PO vão para ${which}, “${target.label}”.`;
      }
    }
    if (await confirm({ title, message, confirmText, tone: 'danger' })) {
      setPendingFocus(null);
      removePo.mutate({
        id: po.id, label: po.label, count, targetId: target?.id ?? null, targetLabel: target?.label ?? null,
      });
    }
  }

  function startRename(po: PurchaseOrder) {
    renameSubmittedRef.current = false;
    setRenamingId(po.id);
    setRenameValue(po.label);
  }

  function cancelRename(po: PurchaseOrder, refocus: boolean) {
    // guarda: Esc/saída não pode virar PATCH por um blur no desmonte do input
    renameSubmittedRef.current = true;
    setRenamingId(null);
    if (refocus) setPendingFocus({ key: `pencil:${po.id}` });
  }

  function submitRename(po: PurchaseOrder, viaKeyboard: boolean) {
    // Enter seguido de onBlur dispararia 2 PATCH: guarda síncrona via ref
    if (renameSubmittedRef.current) return;
    const label = renameValue.trim();
    if (!label || label === po.label) { cancelRename(po, viaKeyboard); return; }
    renameSubmittedRef.current = true;
    renamePo.mutate(
      { id: po.id, label },
      { onError: () => { renameSubmittedRef.current = false; } },
    );
  }

  function moveOrder(index: number, delta: -1 | 1) {
    const ids = orders.map((o) => o.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    const tmp = ids[index] as number;
    ids[index] = ids[j] as number;
    ids[j] = tmp;
    const po = orders[index] as PurchaseOrder;
    setPendingFocus(null);
    reorderPo.mutate({ orderedIds: ids, poId: po.id, label: po.label, to: j, delta });
  }

  function doMove(it: ItensTabItem, poId: number | null, viaModal: boolean) {
    const destLabel = poId === null ? 'Sem PO' : (orders.find((o) => o.id === poId)?.label ?? 'PO');
    setPendingFocus(null);
    moveItem.mutate({ itemId: it.id, poId, name: itemName(it), destLabel, viaModal });
  }

  const draggingItem = draggingId === null ? undefined : items.find((i) => i.id === draggingId);
  const draggingKey = draggingItem ? String(poIdOf(draggingItem) ?? 'none') : null;

  function renderRow(it: ItensTabItem) {
    const moving = moveItem.isPending && moveItem.variables?.itemId === it.id;
    const draggable = grouped && editable;
    return (
      <tr
        key={it.id}
        draggable={draggable}
        className={moving ? 'item-row--dragging' : undefined}
        aria-busy={moving || undefined}
        data-testid={`item-row-${it.id}`}
        onDragStart={(e) => {
          if (!draggable) return;
          e.dataTransfer?.setData('text/plain', String(it.id));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          setDraggingId(it.id);
        }}
        onDragEnd={() => { setDraggingId(null); setDragOverKey(null); }}
      >
        <td>
          {draggable && <span className="item-grip"><GripIcon /></span>}
          <strong>{itemName(it)}</strong>
        </td>
        <td>{it.catalogItem?.marketName ?? '—'}</td>
        <td className="num">{formatNumber(it.quantity)}</td>
        <td>{it.unit}</td>
        <td>{it.desiredIncoterm ?? defaultIncoterm}</td>
        <td>{it.destinationPort ?? defaultPort ?? '—'}</td>
        <td>
          {it.catalogItem?.isDangerousGood ? <span className="badge badge--danger">DG</span> : '—'}
        </td>
        <td className="cell-truncate" title={it.notes ?? undefined}>{it.notes ?? '—'}</td>
        {editable && (
          <td>
            <div className="row-actions row-actions--nowrap">
              <button type="button" className="item-action" onClick={() => onEditItem(it)}>
                Editar
              </button>
              {grouped && (
                <button
                  type="button"
                  className="item-action"
                  ref={refFor(`move:${it.id}`)}
                  onClick={() => setMovingItem(it)}
                >
                  Mover
                </button>
              )}
              <button
                type="button"
                className="item-action item-action--danger"
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

  function dropHandlers(key: string, poId: number | null) {
    return {
      onDragOver: (e: DragEvent) => {
        if (!editable || draggingKey === key) return;
        e.preventDefault();
        setDragOverKey(key);
      },
      onDragLeave: (e: DragEvent) => {
        // saída para um filho não é saída do grupo (senão o destaque pisca entre linhas)
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOverKey((cur) => (cur === key ? null : cur));
      },
      onDrop: (e: DragEvent) => {
        if (!editable) return;
        e.preventDefault();
        setDragOverKey(null);
        setDraggingId(null);
        const itemId = Number(e.dataTransfer?.getData('text/plain'));
        if (!Number.isFinite(itemId) || itemId <= 0) return;
        const item = items.find((i) => i.id === itemId);
        if (!item || poIdOf(item) === poId) return;
        doMove(item, poId, false);
      },
    };
  }

  function renderGroupHead(po: PurchaseOrder | null, index: number, count: number) {
    const key = po ? String(po.id) : 'none';
    const renaming = po !== null && renamingId === po.id;
    return (
      <tr className="po-group-head">
        <th colSpan={colSpan} scope="rowgroup">
          <div className="po-group-head__bar">
            <div className="po-group-head__title">
              {renaming && po ? (
                <input
                  id={`po-title-${key}`}
                  className="input po-rename-input"
                  aria-label="Rótulo da PO"
                  value={renameValue}
                  maxLength={60}
                  ref={renameInputRef}
                  readOnly={renamePo.isPending}
                  aria-busy={renamePo.isPending || undefined}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => submitRename(po, false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename(po, true);
                    if (e.key === 'Escape') cancelRename(po, true);
                  }}
                />
              ) : (
                <h3 id={`po-title-${key}`} tabIndex={-1} ref={po ? refFor(`heading:${po.id}`) : undefined}>
                  {po ? po.label : 'Sem PO'}
                </h3>
              )}
              <span className="badge badge--muted">{itensLabel(count)}</span>
              {po && editable && !renaming && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Renomear ${po.label}`}
                  ref={refFor(`pencil:${po.id}`)}
                  onClick={() => startRename(po)}
                >
                  <PencilIcon />
                </button>
              )}
              {!po && editable && (
                <span className="po-group__hint">Arraste para uma PO ou use “Mover”.</span>
              )}
            </div>
            {po && editable && (
              <div className="po-group-head__tools">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Subir ${po.label}`}
                  ref={refFor(`up:${po.id}`)}
                  disabled={index === 0 || reorderPo.isPending}
                  onClick={() => moveOrder(index, -1)}
                >
                  <ChevronUpIcon />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Descer ${po.label}`}
                  ref={refFor(`down:${po.id}`)}
                  disabled={index === orders.length - 1 || reorderPo.isPending}
                  onClick={() => moveOrder(index, 1)}
                >
                  <ChevronDownIcon />
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  aria-label={`Remover PO ${po.label}`}
                  aria-busy={(removePo.isPending && removePo.variables?.id === po.id) || undefined}
                  disabled={removePo.isPending}
                  onClick={() => handleRemovePo(po)}
                >
                  <TrashIcon />
                </button>
              </div>
            )}
          </div>
        </th>
      </tr>
    );
  }

  function renderGroup(po: PurchaseOrder | null, index: number, rows: ItensTabItem[]) {
    const key = po ? String(po.id) : 'none';
    const isTarget = dragOverKey === key;
    return (
      <tbody
        key={key}
        className={`po-group${po ? '' : ' po-group--none'}${isTarget ? ' po-group--drop-target' : ''}`}
        data-testid={`po-group-${key}`}
        aria-labelledby={`po-title-${key}`}
        {...dropHandlers(key, po ? po.id : null)}
      >
        {renderGroupHead(po, index, rows.length)}
        {rows.length === 0 && po ? (
          <tr className="po-drop-row">
            <td colSpan={colSpan}>
              <div className={`po-drop-empty${editable ? '' : ' po-drop-empty--readonly'}`}>
                {!editable
                  ? 'Nenhum item nesta PO.'
                  : isTarget
                    ? `Soltar em “${po.label}”`
                    : 'PO vazia. Arraste itens para cá ou use “Mover” na linha do item.'}
              </div>
            </td>
          </tr>
        ) : rows.map(renderRow)}
        {po && editable && (
          <tr className="po-group-foot">
            <td colSpan={colSpan}>
              <div className="po-group-foot__bar">
                <button
                  type="button"
                  className="text-button"
                  aria-label={`Adicionar item em ${po.label}`}
                  onClick={() => onAddItem(po.id)}
                >
                  + Adicionar item
                </button>
              </div>
            </td>
          </tr>
        )}
      </tbody>
    );
  }

  const showSpinner = (pending: boolean) =>
    pending ? <span className="spinner spinner--sm" aria-hidden="true" /> : null;

  return (
    <div>
      <div className="itens-tab__header">
        <h2>Itens</h2>
        {editable && (
          <div className="page-header__actions">
            {grouped ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => { setPendingFocus(null); addPo.mutate(); }}
                disabled={addPo.isPending}
              >
                {showSpinner(addPo.isPending)}
                + Adicionar PO
              </button>
            ) : (
              <button
                type="button"
                className="ghost-button"
                ref={refFor('group')}
                onClick={() => { setPendingFocus(null); groupPo.mutate(); }}
                disabled={groupPo.isPending}
              >
                {showSpinner(groupPo.isPending)}
                Agrupar por PO
              </button>
            )}
            <button type="button" className="primary-button" onClick={() => onAddItem(null)}>
              + Adicionar item
            </button>
          </div>
        )}
      </div>
      {items.length > 0 && (
        <p className="itens-tab__summary">
          {itensLabel(items.length)}{grouped ? ` · ${orders.length} POs` : ''}
        </p>
      )}
      {error && (
        <div className="alert alert--error itens-tab__error" role="alert">{error}</div>
      )}
      {grouped && hasResponsesOrDispatch && (
        <div className="alert itens-tab__notice" role="note">
          <InfoIcon />
          <span>
            Esta cotação já tem envio ou respostas: reagrupar POs não altera os e-mails já enviados nem as propostas recebidas.
          </span>
        </div>
      )}
      {items.length === 0 && !grouped ? (
        <div className="empty-state">
          <strong>Nenhum item cadastrado</strong>
          <p>
            {editable
              ? 'Use o botão “Adicionar item” para começar.'
              : 'Esta cotação ainda não possui itens.'}
          </p>
        </div>
      ) : (
        <div className="table-wrapper po-table-wrapper">
          <table className="table po-table">
            <thead>
              <tr>
                <th>Nome comercial</th>
                <th>Nome de mercado</th>
                <th className="num">Qtd</th>
                <th>Unidade</th>
                <th>Incoterm</th>
                <th>Porto</th>
                <th>DG</th>
                <th>Notas</th>
                {editable && <th><span className="sr-only">Ações</span></th>}
              </tr>
            </thead>
            {grouped ? (
              <>
                {orders.map((po, index) => renderGroup(po, index, items.filter((i) => poIdOf(i) === po.id)))}
                {unassigned.length > 0 && renderGroup(null, orders.length, unassigned)}
              </>
            ) : (
              <tbody>{items.map(renderRow)}</tbody>
            )}
          </table>
        </div>
      )}
      {movingItem && (
        <MoveItemModal
          item={{ id: movingItem.id, name: itemName(movingItem) }}
          orders={orders}
          currentPoId={poIdOf(movingItem)}
          pending={moveItem.isPending}
          onCancel={() => {
            const id = movingItem.id;
            setMovingItem(null);
            setPendingFocus({ key: `move:${id}` });
          }}
          onConfirm={(poId) => doMove(movingItem, poId, true)}
        />
      )}
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
    </div>
  );
}
