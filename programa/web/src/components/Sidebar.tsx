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
  /** Variante do IQ Indent (selo "Indent" na marca, "Voltar ao IntelliQuote" e titulo de secao). Sem estas props o markup e o do IQ, byte a byte. */
  variant?: 'indent';
  /** Selo curto abaixo do nome da marca (ex.: "Indent"). Recolhida, vira a pilula das 3 primeiras letras ("IND") sob o icone. */
  brandTag?: string;
  /** Link "Voltar" numa navegacao propria acima da principal (renderizado como os demais links). */
  backLink?: NavItem;
  /** Titulo de secao (estilo do rotulo Administracao) acima da lista principal. */
  sectionTitle?: string;
  /** aria-label da navegacao principal (padrao: "Navegação principal"). */
  navLabel?: string;
}

export default function Sidebar({
  items,
  adminItems = [],
  adminHeader = false,
  badges = {},
  onLogout,
  colapsada = false,
  onAlternar,
  variant,
  brandTag,
  backLink,
  sectionTitle,
  navLabel,
}: SidebarProps) {
  // Dica do icone quando recolhida: fixa (position: fixed), porque a sidebar rola e cortaria uma dica absoluta.
  const [dica, setDica] = useState<{ texto: string; top: number; left: number } | null>(null);
  useEffect(() => {
    if (!colapsada) setDica(null);
  }, [colapsada]);
  function mostrarDica(texto: string, el: HTMLElement) {
    // abaixo de 880px a sidebar empilha (o estado salvo e ignorado): nada de dica
    if (!colapsada || (typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 881px)').matches)) return;
    const r = el.getBoundingClientRect();
    setDica({ texto, top: r.top + r.height / 2, left: r.right + 12 });
  }
  const dicaProps = (texto: string) => ({
    onMouseEnter: (e: { currentTarget: HTMLElement }) => mostrarDica(texto, e.currentTarget),
    onMouseLeave: () => setDica(null),
    onFocus: (e: { currentTarget: HTMLElement }) => mostrarDica(texto, e.currentTarget),
    onBlur: () => setDica(null),
    // WCAG 1.4.13: a dica se dispensa sem mover o ponteiro nem o foco
    onKeyDown: (e: { key: string }) => {
      if (e.key === 'Escape') setDica(null);
    },
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

  // O link "Voltar" abre a cascata do texto (--k = 0); os itens principais seguem a partir de 1.
  const deslocamento = backLink ? 1 : 0;
  const principais = items.map((item, i) => renderLink(item, i + deslocamento));

  return (
    <aside className={`sidebar${colapsada ? ' sidebar--colapsada' : ''}${variant === 'indent' ? ' sidebar--indent' : ''}`}>
      <div className="sidebar__brand" title={brandTag && colapsada ? `IntelliQuote ${brandTag}` : undefined}>
        <BrandMark tone="dark" size={40} />
        {brandTag ? (
          <span className="sidebar__brand-text">
            <span className="sidebar__brand-name">IntelliQuote</span>
            <span className="sidebar__brand-tag">{brandTag}</span>
          </span>
        ) : (
          <span className="sidebar__brand-name">IntelliQuote</span>
        )}
        {brandTag && colapsada && (
          <span className="sidebar__brand-pill" aria-hidden="true">
            {brandTag.slice(0, 3).toUpperCase()}
          </span>
        )}
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
      {backLink && (
        <nav className="sidebar__nav sidebar__nav--voltar" aria-label="Voltar">
          <ul>{renderLink(backLink, 0)}</ul>
        </nav>
      )}
      <nav id="sidebar-nav" className="sidebar__nav" aria-label={navLabel ?? 'Navegação principal'}>
        {sectionTitle ? (
          <div className="sidebar__group">
            <p className="sidebar__group-title">{sectionTitle}</p>
            <ul>{principais}</ul>
          </div>
        ) : (
          <ul>{principais}</ul>
        )}
        {adminHeader && adminItems.length > 0 && (
          <div className="sidebar__group">
            <p className="sidebar__group-title">Administração</p>
            <ul>{adminItems.map((item, i) => renderLink(item, items.length + deslocamento + i))}</ul>
          </div>
        )}
      </nav>
      <footer className="sidebar__footer" style={{ '--k': items.length + adminItems.length + deslocamento } as CSSProperties}>
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
