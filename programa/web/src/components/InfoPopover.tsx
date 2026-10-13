import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Popover informativo acessivel: chip (botao) que abre um balao com detalhes em hover/foco/clique
// (clique fixa; tap no celular = focus + click), fecha com Esc, clique fora e blur/mouseleave
// (quando nao fixado). O balao e renderizado em portal no body, com position:fixed, para nao ser
// cortado por ancestrais com overflow:hidden. Nao usar dentro de <dialog>: o portal no body fica
// abaixo do top layer do dialog modal.

type InfoPopoverProps = {
  /** aria-label do botao; deve COMECAR pelo texto visivel. */
  label: string;
  /** Conteudo visivel do botao. */
  trigger: ReactNode;
  /** Conteudo do popover (so texto/lista, nada interativo). */
  children: ReactNode;
  tone?: 'warning' | 'info';
  className?: string;
  testId?: string;
  contentTestId?: string;
};

const CLOSE_DELAY_MS = 120;
const MARGIN = 8;
const GAP = 6;

export function InfoPopover({
  label,
  trigger,
  children,
  tone = 'warning',
  className,
  testId,
  contentTestId,
}: InfoPopoverProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Esc devolve o foco ao botao; sem isso o onFocus reabriria o popover recem-fechado.
  const skipFocusOpen = useRef(false);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openNow = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const closeAll = useCallback(() => {
    clearCloseTimer();
    setOpen(false);
    setPinned(false);
  }, [clearCloseTimer]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  const reposition = useCallback(() => {
    const btn = buttonRef.current;
    const pop = popoverRef.current;
    if (!btn || !pop) return;
    const b = btn.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const maxLeft = window.innerWidth - p.width - MARGIN;
    const left = Math.max(MARGIN, Math.min(b.left, maxLeft));
    let top = b.bottom + GAP;
    if (top + p.height > window.innerHeight - MARGIN && b.top - p.height - GAP >= MARGIN) {
      top = b.top - p.height - GAP;
    }
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAll();
        skipFocusOpen.current = true;
        buttonRef.current?.focus();
        skipFocusOpen.current = false;
      }
    };
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (target && (buttonRef.current?.contains(target) || popoverRef.current?.contains(target))) return;
      closeAll();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, closeAll]);

  const handleClick = () => {
    if (pinned) {
      closeAll();
      return;
    }
    clearCloseTimer();
    setPinned(true);
    setOpen(true);
  };

  const handleFocus = () => {
    if (!skipFocusOpen.current) openNow();
  };

  const handleLeave = () => {
    if (!pinned) scheduleClose();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`info-chip info-chip--${tone}${className ? ` ${className}` : ''}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-describedby={open ? id : undefined}
        data-testid={testId}
        onMouseEnter={openNow}
        onMouseLeave={handleLeave}
        onFocus={handleFocus}
        // Foco saiu do botao (ex.: Tab): fecha mesmo fixado; o balao nao tem conteudo focavel.
        onBlur={closeAll}
        onClick={handleClick}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={id}
            role="tooltip"
            className={`info-popover info-popover--${tone}`}
            data-testid={contentTestId}
            style={{
              position: 'fixed',
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
            onMouseEnter={openNow}
            onMouseLeave={handleLeave}
            // Clicar no balao nao tira o foco do botao (senao o onBlur fecharia).
            onMouseDown={(event) => event.preventDefault()}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
