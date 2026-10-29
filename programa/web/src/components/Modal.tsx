import React, { useEffect, useRef } from 'react';
import { Icon } from './icons';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Linha de apoio abaixo do titulo (ex.: codigo da cotacao). Opcional; sem ela o cabecalho segue como antes. */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  size?: 'default' | 'wide' | 'xl';
}

export function Modal({ isOpen, onClose, title, subtitle, children, size }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mousedownTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleMousedown = (e: MouseEvent) => {
      mousedownTargetRef.current = e.target;
    };

    const handleClick = (e: MouseEvent) => {
      const mousedownTarget = mousedownTargetRef.current;
      mousedownTargetRef.current = null;
      if (e.target === dialog && mousedownTarget === dialog) {
        onClose();
      }
    };

    dialog.addEventListener('mousedown', handleMousedown);
    dialog.addEventListener('click', handleClick);
    return () => {
      dialog.removeEventListener('mousedown', handleMousedown);
      dialog.removeEventListener('click', handleClick);
    };
  }, [onClose]);

  const className =
    size === 'xl' ? 'modal-dialog modal-dialog--xl'
    : size === 'wide' ? 'modal-dialog modal-dialog--wide'
    : 'modal-dialog';

  return (
    <dialog ref={dialogRef} className={className}>
      <div className="modal-content">
        <header className="modal-header">
          {subtitle ? (
            <div className="modal-header__titles">
              <h2>{title}</h2>
              <p className="modal-subtitle">{subtitle}</p>
            </div>
          ) : (
            <h2>{title}</h2>
          )}
          <button type="button" onClick={onClose} className="btn-close" aria-label="Fechar">
            <Icon name="x" size={16} strokeWidth={2} />
          </button>
        </header>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </dialog>
  );
}
