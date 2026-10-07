import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import type { PurchaseOrder } from '@/services/purchaseOrders';

interface MoveItemModalProps {
  item: { id: number; name: string };
  orders: PurchaseOrder[];
  /** PO atual do item (null = sem PO). A opção correspondente fica desabilitada. */
  currentPoId: number | null;
  onCancel: () => void;
  onConfirm: (purchaseOrderId: number | null) => void;
  pending: boolean;
}

const NONE = 'none';

// Modal "Mover" (DESIGN §4.6): rádios em vez de select; sem o texto "Mover para PO".
export function MoveItemModal({
  item, orders, currentPoId, onCancel, onConfirm, pending,
}: MoveItemModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const firstEnabledRef = useRef<HTMLInputElement | null>(null);

  const options = [
    ...orders.map((po) => ({ value: String(po.id), label: po.label, isCurrent: po.id === currentPoId })),
    { value: NONE, label: 'Sem PO', isCurrent: currentPoId === null },
  ];
  const firstEnabledValue = options.find((o) => !o.isCurrent)?.value;

  // O Modal abre o <dialog> num efeito do pai (depois dos filhos): foca o 1º rádio habilitado
  // só depois disso.
  useEffect(() => {
    const timer = setTimeout(() => firstEnabledRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);

  function confirm() {
    if (selected === null) return;
    onConfirm(selected === NONE ? null : Number(selected));
  }

  return (
    <Modal isOpen title={`Mover “${item.name}”`} onClose={onCancel}>
      <div className="move-item-modal">
        <fieldset>
          <legend>Destino</legend>
          {options.map((o) => (
            <label key={o.value} className="move-item-modal__option">
              <input
                ref={o.value === firstEnabledValue ? firstEnabledRef : undefined}
                type="radio"
                name="move-item-destination"
                value={o.value}
                checked={selected === o.value}
                disabled={o.isCurrent || pending}
                onChange={() => setSelected(o.value)}
              />
              <span>{o.label}{o.isCurrent ? ' (atual)' : ''}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onCancel} disabled={pending}>
          Cancelar
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={confirm}
          disabled={selected === null || pending}
        >
          Mover item
        </button>
      </div>
    </Modal>
  );
}
