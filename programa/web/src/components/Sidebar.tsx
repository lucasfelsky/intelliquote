import { NavLink } from 'react-router-dom';
import BrandMark from './BrandMark';
import { Icon } from './icons';
import type { NavItem } from './navConfig';
import ThemeToggle from './ThemeToggle';

interface SidebarProps {
  items: NavItem[];
  adminItems?: NavItem[];
  adminHeader?: boolean;
  /** Contadores por rota (ex.: `{ '/solicitacoes': 3 }`); so renderiza quando > 0. */
  badges?: Record<string, number>;
  /** "Sair" no rodape da sidebar (mock v68: tema + Sair + versao). */
  onLogout?: () => void;
}

export default function Sidebar({
  items,
  adminItems = [],
  adminHeader = false,
  badges = {},
  onLogout,
}: SidebarProps) {
  function renderLink(item: NavItem) {
    const count = badges[item.to] ?? 0;
    return (
      <li key={item.to}>
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
    <aside className="sidebar">
      <div className="sidebar__brand">
        <BrandMark tone="dark" size={40} />
        <span className="sidebar__brand-name">IntelliQuote</span>
      </div>
      <nav className="sidebar__nav" aria-label="Navegação principal">
        <ul>{items.map(renderLink)}</ul>
        {adminHeader && adminItems.length > 0 && (
          <div className="sidebar__group">
            <p className="sidebar__group-title">Administração</p>
            <ul>{adminItems.map(renderLink)}</ul>
          </div>
        )}
      </nav>
      <footer className="sidebar__footer">
        <ThemeToggle variant="navy" />
        <button type="button" className="sidebar__logout" onClick={onLogout}>
          <Icon name="logout" size={16} />
          Sair
        </button>
        <small className="sidebar__version">v0.1 · Build local</small>
      </footer>
    </aside>
  );
}
