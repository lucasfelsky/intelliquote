import { useEffect, useState, type CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';
import BrandMark from './BrandMark';
import { Icon } from './icons';
import type { NavItem } from './navConfig';
import SqLogo from './SqLogo';
import ThemeToggle from './ThemeToggle';

interface SidebarProps {
  items: NavItem[];
  adminItems?: NavItem[];
  adminHeader?: boolean;
  /** Contadores por rota (ex.: `{ '/solicitacoes': 3 }`); so renderiza quando > 0. */
  badges?: Record<string, number>;
  /** "Sair" no rodape da sidebar (canvas v72: tema + Sair + assinatura + versao). */
  onLogout?: () => void;
  /** Sidebar recolhida (so icones). O botao de recolher so aparece quando `onAlternar` e passado. */
  colapsada?: boolean;
  onAlternar?: () => void;
}

export default function Sidebar({
  items,
  adminItems = [],
  adminHeader = false,
  badges = {},
  onLogout,
  colapsada = false,
  onAlternar,
}: SidebarProps) {
  // Dica do icone quando recolhida: fixa (position: fixed), porque a sidebar rola e cortaria uma dica absoluta.
  const [dica, setDica] = useState<{ texto: string; top: number; left: number } | null>(null);
  useEffect(() => {
    if (!colapsada) setDica(null);
  }, [colapsada]);
  function mostrarDica(texto: string, el: HTMLElement) {
    if (!colapsada) return;
    const r = el.getBoundingClientRect();
    setDica({ texto, top: r.top + r.height / 2, left: r.right + 12 });
  }
  const dicaProps = (texto: string) => ({
    onMouseEnter: (e: { currentTarget: HTMLElement }) => mostrarDica(texto, e.currentTarget),
    onMouseLeave: () => setDica(null),
    onFocus: (e: { currentTarget: HTMLElement }) => mostrarDica(texto, e.currentTarget),
    onBlur: () => setDica(null),
  });

  // `k` = posicao do item: o texto volta em cascata (CSS: --k)
  function renderLink(item: NavItem, k: number) {
    const count = badges[item.to] ?? 0;
    return (
      <li key={item.to} style={{ '--k': k } as CSSProperties} {...dicaProps(item.label)}>
        <NavLink
          to={item.to}
          end={item.end}
          className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
        >
          <Icon name={item.icon} className="sidebar__icon" />
          <span className="sidebar__label">{item.label}</span>
          {item.tag && (
            <span className="sidebar__tag">
              <span className="sr-only">, </span>
              {item.tag}
            </span>
          )}
          {count > 0 && (
            <span className="sidebar__badge" aria-label={`${count} pendentes`}>
              {count}
            </span>
          )}
        </NavLink>
      </li>
    );
  }

  return (
    <aside className={`sidebar${colapsada ? ' sidebar--colapsada' : ''}`}>
      <div className="sidebar__brand">
        <BrandMark tone="dark" size={40} />
        <span className="sidebar__brand-name">IntelliQuote</span>
        {onAlternar && (
          <button
            type="button"
            className="sidebar__alternar"
            aria-label={colapsada ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            aria-expanded={!colapsada}
            aria-controls="sidebar-nav"
            title={colapsada ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            onClick={onAlternar}
          >
            <Icon name="chevron-right" size={16} />
          </button>
        )}
      </div>
      <nav id="sidebar-nav" className="sidebar__nav" aria-label="Navegação principal">
        <ul>{items.map((item, i) => renderLink(item, i))}</ul>
        {adminHeader && adminItems.length > 0 && (
          <div className="sidebar__group">
            <p className="sidebar__group-title">Administração</p>
            <ul>{adminItems.map((item, i) => renderLink(item, items.length + i))}</ul>
          </div>
        )}
      </nav>
      <footer className="sidebar__footer" style={{ '--k': items.length + adminItems.length } as CSSProperties}>
        <ThemeToggle />
        <button type="button" className="sidebar__logout" onClick={onLogout} {...dicaProps('Sair')}>
          <Icon name="logout" size={16} />
          <span className="sidebar__logout-texto">Sair</span>
        </button>
        <div className="sidebar__signature">
          <SqLogo size={32} />
        </div>
      </footer>
      {dica && (
        <div className="sidebar__dica" role="presentation" aria-hidden="true" style={{ top: dica.top, left: dica.left }}>
          {dica.texto}
        </div>
      )}
    </aside>
  );
}
