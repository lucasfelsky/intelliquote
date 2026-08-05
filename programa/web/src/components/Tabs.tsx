import { createContext, useContext, ReactNode, KeyboardEvent, useRef, useCallback } from 'react';

interface TabsContextValue {
  value: string;
  onValueChange: (val: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function Tabs({
  value,
  onValueChange,
  children,
  baseId = 'tabs',
}: {
  value: string;
  onValueChange: (val: string) => void;
  children: ReactNode;
  baseId?: string;
}) {
  return (
    <TabsContext.Provider value={{ value, onValueChange, baseId }}>
      <div className="tabs-root">{children}</div>
    </TabsContext.Provider>
  );
}

export function TabList({ children, 'aria-label': ariaLabel }: { children: ReactNode; 'aria-label'?: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const ctx = useContext(TabsContext);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (!listRef.current || !ctx) return;
    const buttons = Array.from(listRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
    if (buttons.length === 0) return;

    const idx = buttons.findIndex((b) => b === document.activeElement);
    if (idx === -1) return;

    let nextIdx = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIdx = (idx + 1) % buttons.length;
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIdx = (idx - 1 + buttons.length) % buttons.length;
      e.preventDefault();
    } else if (e.key === 'Home') {
      nextIdx = 0;
      e.preventDefault();
    } else if (e.key === 'End') {
      nextIdx = buttons.length - 1;
      e.preventDefault();
    }

    if (nextIdx !== idx) {
      const nextBtn = buttons[nextIdx];
      if (nextBtn) {
        nextBtn.focus();
        // Opcional: ativar automaticamente a aba ao navegar.
        nextBtn.click();
      }
    }
  }, [ctx]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className="tabs-list"
      onKeyDown={onKeyDown}
      style={{
        display: 'flex',
        gap: '24px',
        borderBottom: '1px solid var(--border)',
        marginBottom: '16px',
        overflowX: 'auto',
      }}
    >
      {children}
    </div>
  );
}

export function Tab({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tab must be inside Tabs');

  const isSelected = ctx.value === value;

  return (
    <button
      role="tab"
      aria-selected={isSelected}
      aria-controls={`${ctx.baseId}-panel-${value}`}
      id={`${ctx.baseId}-tab-${value}`}
      tabIndex={isSelected ? 0 : -1}
      onClick={() => ctx.onValueChange(value)}
      style={{
        background: 'none',
        border: 'none',
        borderBottom: isSelected ? '2px solid var(--primary-700)' : '2px solid transparent',
        color: isSelected ? 'var(--primary-700)' : 'var(--ink-soft)',
        padding: '8px 4px',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: isSelected ? 600 : 400,
        whiteSpace: 'nowrap',
        transition: 'all 0.2s ease',
      }}
      className={`tabs-trigger ${isSelected ? 'tabs-trigger--active' : ''}`}
    >
      {children}
    </button>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('TabPanel must be inside Tabs');

  const isSelected = ctx.value === value;

  if (!isSelected) return null;

  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-tab-${value}`}
      tabIndex={0}
      className="tabs-panel"
      style={{ outline: 'none' }}
    >
      {children}
    </div>
  );
}
