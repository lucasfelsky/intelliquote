import type { SVGAttributes } from 'react';

// Icones de traco do mock (Suite COMEX): 24x24, sem preenchimento, `currentColor` (a cor vem do CSS do contexto).
// 14 de navegacao (navConfig), Sair, os 3 do botao de tema (automatico, noturno, claro; canvas v72) e os 2 da topbar
// (escudo SSO e usuario). F5: +12 (plus, search, filter, alert-triangle, refresh, arrow-right/left, check, link, lock, chevron-down/right). F3-0: `x` (fechar do Modal, F3c) e `star` (StarRating, F3d) entram ja, sem uso ate la, para as frentes
// paralelas nao editarem este objeto. Unica excecao ao "sem preenchimento": o meio-disco do icone automatico (ICON_FILLS).
export const ICONS = {
  overview: 'M3 4h7v8H3zM14 4h7v5h-7zM14 13h7v7h-7zM3 16h7v4H3z',
  cotacoes: 'M9 3h6v3H9zM6 4.5H5v16.5h14V4.5h-1M9 11h6M9 15h6M9 19h3',
  solicitacoes: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
  itens: 'M12 3 3 7.5v9L12 21l9-4.5v-9zM3 7.5l9 4.5 9-4.5M12 12v9',
  fornecedores: 'M3 21V9l6 3V9l6 3V5h6v16zM7 17h2M12 17h2M17 17h2',
  forecast: 'M21 12a9 9 0 1 1-9-9M12 3v9h9',
  forwarders: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.1M17 19a2 2 0 1 0 0-.1',
  familias: 'M3 6h6l2 2h10v11H3zM3 10h18',
  relatorios: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  ajuda: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01',
  usuarios: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  empresa: 'M6 22V4l6-2v20M12 8h6v14M2 22h20M9 7h.01M9 11h.01M9 15h.01M15 12h.01M15 16h.01',
  auditoria: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  templates: 'M4 5h16v14H4zM4 7l8 6 8-6',
  'theme-half': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  x: 'M6 6l12 12M18 6 6 18',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  'alert-triangle': 'M12 3 2 20h20zM12 10v4M12 17h.01',
  refresh: 'M20 11A8 8 0 0 0 5.3 6.3L3 8M3 3v5h5M4 13a8 8 0 0 0 14.7 4.7L21 16M21 21v-5h-5',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  check: 'm5 12 5 5 9-10',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-right': 'm9 6 6 6-6 6',
} as const;

// Camada preenchida (currentColor) por cima do traco: so o meio-disco do icone "automatico" do botao de tema.
export const ICON_FILLS: Partial<Record<keyof typeof ICONS, string>> = {
  'theme-half': 'M12 3a9 9 0 0 0 0 18z',
};

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, 'name' | 'strokeWidth'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, strokeWidth = 1.9, ...rest }: IconProps) {
  return (
    <svg
      {...rest}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name]} />
      {ICON_FILLS[name] && <path d={ICON_FILLS[name]} fill="currentColor" />}
    </svg>
  );
}
