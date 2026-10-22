// Tipos compartilhados para a navegação principal.
export interface NavItem {
  to: string;
  label: string;
  icon: string;       // glifo unicode (sem dependencia de icone lib)
  end?: boolean;
  group?: 'main' | 'admin';
  roles?: string[];   // se vazio/ausente, todos os papeis veem
  tag?: string;       // selo curto ao lado do rotulo (ex.: 'Beta')
}

// Papeis da equipe COMEX (acesso interno). `comercial` fica de fora: so ve /solicitacoes.
export const COMEX_ROLES = ['admin', 'comprador', 'gestor', 'viewer'];

export function isComercialRole(role?: string | null): boolean {
  return role === 'comercial';
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/',          label: 'Overview',           icon: '◎', end: true,  group: 'main', roles: COMEX_ROLES },
  { to: '/cotacoes',  label: 'Cotações',           icon: '✦',             group: 'main', roles: COMEX_ROLES },
  { to: '/solicitacoes', label: 'Solicitações',    icon: '✎',             group: 'main', roles: [...COMEX_ROLES, 'comercial'] },
  { to: '/itens',     label: 'Itens',              icon: '◇',             group: 'main', roles: COMEX_ROLES },
  { to: '/fornecedores', label: 'Fornecedores',    icon: '⬢',             group: 'main', roles: COMEX_ROLES },
  { to: '/forecast',  label: 'Forecast',           icon: '◔',             group: 'main', roles: COMEX_ROLES, tag: 'Beta' },
  { to: '/forwarders', label: 'Forwarders',       icon: '⇄',             group: 'main', roles: COMEX_ROLES },
  { to: '/familias',  label: 'Famílias',           icon: '⬡',             group: 'main', roles: COMEX_ROLES },
  { to: '/relatorios',label: 'Relatórios',         icon: '▥',             group: 'main', roles: COMEX_ROLES },
  { to: '/ajuda',     label: 'Ajuda',              icon: '?',             group: 'main', roles: COMEX_ROLES },
];

export const ADMIN_NAV: NavItem[] = [
  { to: '/usuarios',       label: 'Usuários',         icon: '◉', group: 'admin', roles: ['admin'] },
  { to: '/empresa',        label: 'Empresa',          icon: '⌂', group: 'admin', roles: ['admin', 'comprador', 'gestor'] },
  { to: '/auditoria',      label: 'Auditoria',        icon: '⌘', group: 'admin', roles: ['admin', 'gestor'] },
  { to: '/templates',      label: 'Templates de e-mail', icon: '✉', group: 'admin', roles: ['admin', 'comprador', 'gestor', 'viewer'] },
];

export function filterNavByRole(items: NavItem[], role: string | undefined | null): NavItem[] {
  if (!role) return items.filter((i) => !i.roles || i.roles.length === 0);
  return items.filter((i) => !i.roles || i.roles.length === 0 || i.roles.includes(role));
}
