import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ICONS, ICON_FILLS, ICON_NAMES, Icon, type IconName } from './icons';

// Paths publicos do mock (canvas v72: boards Sidebar e Topbar), copiados identicos. Se o mock mudar, mude aqui E em icons.tsx.
// O circulo do icone automatico (r=9) e o do sol (r=4) viram path no app; o board os desenha como <circle>.
const MOCK: Record<string, string> = {
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
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  'file-text': 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  'chevron-up': 'm18 15-6-6-6 6',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  'alert-circle': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v4M12 16h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  minus: 'M5 12h14',
  'file-plus': 'M14 3H6v18h12V7zM14 3v4h4M12 11v6M9 14h6',
  ship: 'M3 17h18l-2 3H5zM5 17V9h14v8M9 9V5h6v4',
  dollar: 'M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.7 5 3.2 5 1.4 5 3.3-2.2 3-5 3-5-1.1-5-3',
  package: 'M12 3 3 7.5v9L12 21l9-4.5v-9zM3 7.5l9 4.5 9-4.5M12 12v9M7.5 5.2l9 4.6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  code: 'm8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14',
  maximize: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5',
  ellipsis: 'M5 12h.01M12 12h.01M19 12h.01',
  'file-x': 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13l4 5M13 13l-4 5',
  printer: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z',
};

describe('icons', () => {
  it('tem os 61 icones do mock (14 de navegacao, logout, theme-half, sun, moon, shield, user, x, star, os 12 da F5, os 10 da F6/F7, os 3 da F8/F9 os 10 da F10/F11 e os 4 da F13-C)', () => {
    expect(ICON_NAMES).toHaveLength(62);
    expect([...ICON_NAMES].sort()).toEqual(Object.keys(MOCK).sort());
    for (const name of [
      'overview', 'cotacoes', 'solicitacoes', 'itens', 'fornecedores', 'forecast', 'forwarders', 'familias',
      'relatorios', 'ajuda', 'usuarios', 'empresa', 'auditoria', 'templates', 'logout', 'theme-half', 'sun', 'moon',
      'shield', 'user', 'x', 'star', 'plus', 'search', 'filter', 'alert-triangle', 'refresh', 'arrow-right', 'arrow-left', 'check',
      'link', 'lock', 'chevron-down', 'chevron-right',
    ]) {
      expect(ICONS, name).toHaveProperty(name);
    }
  });

  it('o d de cada icone e IGUAL ao do mock', () => {
    for (const name of ICON_NAMES) expect(ICONS[name], name).toBe(MOCK[name]);
  });

  it('os 3 icones do botao de tema (theme-half, sun, moon) sao os do canvas v72 e o monitor saiu', () => {
    expect(ICONS['theme-half']).toBe('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z');
    expect(ICON_FILLS['theme-half']).toBe('M12 3a9 9 0 0 0 0 18z');
    expect(ICONS.moon).toBe('M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z');
    expect(ICONS.sun).toBe(
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    );
    expect(ICON_NAMES).not.toContain('monitor');
    expect(ICONS).not.toHaveProperty('monitor');
  });

  it('so o theme-half tem camada preenchida (currentColor); os demais 60 so tem traco', () => {
    expect(Object.keys(ICON_FILLS)).toEqual(['theme-half']);
    const meio = render(<Icon name="theme-half" />).container.querySelectorAll('svg path');
    expect(meio).toHaveLength(2);
    expect(meio[0]?.getAttribute('fill')).toBeNull();
    expect(meio[1]?.getAttribute('fill')).toBe('currentColor');
    expect(meio[1]?.getAttribute('d')).toBe('M12 3a9 9 0 0 0 0 18z');
    for (const name of ICON_NAMES.filter((n) => n !== 'theme-half')) {
      const paths = render(<Icon name={name as IconName} />).container.querySelectorAll('svg path');
      expect(paths, name).toHaveLength(1);
      expect(paths[0]?.hasAttribute('fill'), name).toBe(false);
    }
  });

  it('nenhum icone repete o path de outro', () => {
    expect(new Set(Object.values(ICONS)).size).toBe(62);
  });

  it.each(ICON_NAMES)('<Icon name="%s"> renderiza svg decorativo de traco com currentColor', (name) => {
    const { container } = render(<Icon name={name as IconName} />);
    const svg = container.querySelector('svg[aria-hidden="true"][viewBox="0 0 24 24"][fill="none"][stroke="currentColor"]');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.getAttribute('stroke-linecap')).toBe('round');
    expect(svg?.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(MOCK[name]);
  });

  it('tamanho e traco padrao 18 / 1,9; ajustaveis (o botao de tema usa 16 / 1,9)', () => {
    const padrao = render(<Icon name="overview" />).container.querySelector('svg');
    expect(padrao?.getAttribute('width')).toBe('18');
    expect(padrao?.getAttribute('height')).toBe('18');
    expect(padrao?.getAttribute('stroke-width')).toBe('1.9');
    const tema = render(<Icon name="sun" size={16} strokeWidth={1.9} />).container.querySelector('svg');
    expect(tema?.getAttribute('width')).toBe('16');
    expect(tema?.getAttribute('stroke-width')).toBe('1.9');
    const maior = render(<Icon name="shield" size={20} strokeWidth={2} />).container.querySelector('svg');
    expect(maior?.getAttribute('width')).toBe('20');
    expect(maior?.getAttribute('stroke-width')).toBe('2');
  });
});
