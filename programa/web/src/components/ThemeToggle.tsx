import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { setThemePreference, useThemePreference, type ThemePreference } from '@/theme/theme';

// Segmented control de 3 estados (Claro / Escuro / Automatico), so com icones. Padrao WAI-ARIA
// radiogroup: tabindex "roving" e setas movem a selecao. CSS: .theme-toggle*.

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function SunIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </Svg>
  );
}

function MoonIcon() {
  return (
    <Svg>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Svg>
  );
}

function MonitorIcon() {
  return (
    <Svg>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </Svg>
  );
}

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: ReactNode }> = [
  { value: 'light', label: 'Claro', icon: <SunIcon /> },
  { value: 'dark', label: 'Escuro', icon: <MoonIcon /> },
  { value: 'auto', label: 'Automático (segue o sistema)', icon: <MonitorIcon /> },
];

export default function ThemeToggle() {
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
    <div role="radiogroup" aria-label="Tema da interface" className="theme-toggle">
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
