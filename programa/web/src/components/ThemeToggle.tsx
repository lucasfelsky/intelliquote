import { useState } from 'react';
import { setThemePreference, useThemePreference, type ThemePreference } from '@/theme/theme';
import { Icon, type IconName } from './icons';

// Botao de tema UNICO (canvas v72): cada clique avanca automatico -> noturno -> claro -> automatico. A logica de tema e a de
// theme.ts (grava 'iq-theme', remove a chave em automatico, aplica data-theme e segue o sistema); aqui so a apresentacao.
// Texto visivel "Tema: <estado>", icone do estado atual (16px, traco 1,9) e anuncio por role="status" depois do clique.
// CSS: .sidebar__theme (shell, sobre o navy da sidebar).

const CYCLE: readonly ThemePreference[] = ['auto', 'dark', 'light'];
const LABEL: Record<ThemePreference, string> = { auto: 'automático', dark: 'noturno', light: 'claro' };
const ICON: Record<ThemePreference, IconName> = { auto: 'theme-half', dark: 'moon', light: 'sun' };

export default function ThemeToggle() {
  const preference = useThemePreference();
  // Vazio ate o primeiro clique: o leitor de tela anuncia o novo tema so quando o usuario o troca.
  const [announcement, setAnnouncement] = useState('');
  const label = LABEL[preference];

  function cycle() {
    const next = CYCLE[(CYCLE.indexOf(preference) + 1) % CYCLE.length] ?? 'auto';
    setThemePreference(next);
    setAnnouncement(`Tema: ${LABEL[next]}`);
  }

  return (
    <>
      <button
        type="button"
        className="sidebar__theme"
        onClick={cycle}
        aria-label={`Tema: ${label} — alternar tema`}
        title="Alternar tema (automático / noturno / claro)"
      >
        <Icon name={ICON[preference]} size={16} strokeWidth={1.9} />
        <span>{`Tema: ${label}`}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
