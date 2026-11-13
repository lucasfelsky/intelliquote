import React, { useEffect, useId, useRef } from 'react';
import { Icon } from './icons';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Linha de apoio abaixo do titulo (ex.: codigo da cotacao). Opcional; sem ela o cabecalho segue como antes. */
  subtitle?: React.ReactNode;
  /** Linha curta ACIMA do titulo (ex.: "Restricao de fornecedores"). Opcional; sem ela o cabecalho segue como antes. */
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
  size?: 'default' | 'wide' | 'xl';
  /** Classe EXTRA no <dialog> (ex.: raiz de portal do Forecast). Opcional; sem ela o className segue como antes. */
  className?: string;
  /** Opt-in: devolve o foco a quem o tinha antes de abrir (botao ou linha) quando o modal fecha ou desmonta. Padrao false: nada muda. */
  restoreFocus?: boolean;
  /** Opt-in: no cabecalho, ANTES do botao Fechar (ex.: badge de status da gaveta de cotacao). Sem ela o cabecalho segue como antes. */
  headerAside?: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, subtitle, eyebrow, children, size, className: extra, restoreFocus = false, headerAside }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;
  const origemRef = useRef<HTMLElement | null>(null);
  const tituloId = useId();
  const mousedownTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    // Opt-in (restoreFocus): guarda quem tinha o foco ANTES do showModal() e o devolve quando o modal fecha ou desmonta.
    // A origem fica num ref (nao numa variavel do efeito): sob React.StrictMode o efeito roda duas vezes e na 2a o dialog ja esta aberto.
    const devolverFoco = () => {
      const origem = origemRef.current;
      origemRef.current = null;
      // `isConnected`: o botao/linha que abriu pode ter sumido (ex.: a tela navegou depois de criar).
      if (origem?.isConnected) origem.focus();
    };

    if (isOpen && !dialog.open) {
      if (restoreFocusRef.current && origemRef.current === null && document.activeElement instanceof HTMLElement) {
        origemRef.current = document.activeElement;
      }
      dialog.showModal();
      // O autoFocus do React age com o <dialog> ainda fechado e o showModal() depois foca o 1o focavel (o Fechar): quem quer o foco
      // inicial num campo marca o elemento com data-autofocus. Sem o atributo nada muda.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!isOpen && dialog.open) {
      dialog.close();
      devolverFoco();
    }

    return () => {
      // Desmontagem de verdade: o <dialog> ja saiu do DOM. (A limpeza simulada do StrictMode roda com ele ainda conectado e nao devolve nada.)
      if (!dialog.isConnected) devolverFoco();
    };
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

  const base =
    size === 'xl' ? 'modal-dialog modal-dialog--xl'
    : size === 'wide' ? 'modal-dialog modal-dialog--wide'
    : 'modal-dialog';
  const className = extra ? `${base} ${extra}` : base;

  return (
    <dialog ref={dialogRef} className={className} aria-labelledby={tituloId}>
      <div className="modal-content">
        <header className="modal-header">
          {subtitle || eyebrow ? (
            <div className="modal-header__titles">
              {eyebrow && <p className="modal-eyebrow">{eyebrow}</p>}
              <h2 id={tituloId}>{title}</h2>
              {subtitle && <p className="modal-subtitle">{subtitle}</p>}
            </div>
          ) : (
            <h2 id={tituloId}>{title}</h2>
          )}
          {headerAside}
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
