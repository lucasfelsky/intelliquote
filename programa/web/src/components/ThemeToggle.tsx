import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { setThemePreference, useThemePreference, type ThemePreference } from '@/theme/theme';
import { Icon } from './icons';

// Segmented control de 3 estados (Claro / Escuro / Automatico), so com icones. Padrao WAI-ARIA
// radiogroup: tabindex "roving" e setas movem a selecao. CSS: .theme-toggle* (variant="navy": sobre a sidebar, mock v68).
// Icones de traco do mock (icons.tsx), 16px / traco 2.

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: ReactNode }> = [
  { value: 'light', label: 'Claro', icon: <Icon name="sun" size={16} strokeWidth={2} /> },
  { value: 'dark', label: 'Escuro', icon: <Icon name="moon" size={16} strokeWidth={2} /> },
  { value: 'auto', label: 'Automático (segue o sistema)', icon: <Icon name="monitor" size={16} strokeWidth={2} /> },
];

interface ThemeToggleProps {
  /** `navy`: segmento sobre o fundo navy da sidebar (CSS .theme-toggle--navy). */
  variant?: 'default' | 'navy';
}

export default function ThemeToggle({ variant = 'default' }: ThemeToggleProps = {}) {
  const preference = useThemePreference();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function select(index: number) {
    const target = (index + OPTIONS.length) % OPTIONS.length;
    const next = OPTIONS[target];
    if (!next) return;
    setThemePreference(next.value);
    buttons.current[target]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      select(index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      select(index - 1);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tema da interface"
      className={variant === 'navy' ? 'theme-toggle theme-toggle--navy' : 'theme-toggle'}
    >
      {OPTIONS.map((option, index) => {
        const checked = option.value === preference;
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            title={option.label}
            tabIndex={checked ? 0 : -1}
            className="theme-toggle__option"
            onClick={() => setThemePreference(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
