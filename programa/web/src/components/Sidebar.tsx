import { NavLink } from 'react-router-dom';
import type { NavItem } from './navConfig';

interface SidebarProps {
  items: NavItem[];
  adminItems?: NavItem[];
  adminHeader?: boolean;
}

export default function Sidebar({ items, adminItems = [], adminHeader = false }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <img src="/logo.png" alt="IntelliQuote" className="sidebar__brand-logo" />
        <div>
          <strong>IntelliQuote</strong>
          <small>Portal COMEX</small>
        </div>
      </div>
      <nav className="sidebar__nav" aria-label="Navegação principal">
        <ul>
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
                }
              >
                <span className="sidebar__icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        {adminHeader && adminItems.length > 0 && (
          <div className="sidebar__group">
            <p className="sidebar__group-title">Administração</p>
            <ul>
              {adminItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
                    }
                  >
                    <span className="sidebar__icon" aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
      <footer className="sidebar__footer">
        <img src="/logo.png" alt="" className="sidebar__footer-mark" />
        <small>v0.1 · Build local</small>
      </footer>
    </aside>
  );
}
