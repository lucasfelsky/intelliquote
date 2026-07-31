import React, { useEffect, useRef } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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

  return (
    <dialog ref={dialogRef} className="modal-dialog">
      <div className="modal-content">
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} className="btn-close" aria-label="Fechar">
            &times;
          </button>
        </header>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </dialog>
  );
}
