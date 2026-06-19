// Tipos compartilhados para a navegação principal.
export interface NavItem {
  to: string;
  label: string;
  icon: string;       // glifo unicode (sem dependencia de icone lib)
  end?: boolean;
  group?: 'main' | 'admin';
  roles?: string[];   // se vazio/ausente, todos os papeis veem
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/',          label: 'Overview',           icon: '◎', end: true,  group: 'main' },
  { to: '/cotacoes',  label: 'Cotações',           icon: '✦',             group: 'main' },
  { to: '/itens',     label: 'Itens',              icon: '◇',             group: 'main' },
  { to: '/fornecedores', label: 'Fornecedores',    icon: '⬢',             group: 'main' },
  { to: '/respostas', label: 'Respostas',          icon: '⇄',             group: 'main' },
    { to: '/comparacoes', label: 'Comparações',      icon: '⚖',             group: 'main' },
    { to: '/relatorios',label: 'Relatórios',         icon: '▥',             group: 'main' },
  { to: '/ajuda',     label: 'Ajuda',              icon: '?',             group: 'main' },
];

export const ADMIN_NAV: NavItem[] = [
  { to: '/usuarios',       label: 'Usuários',         icon: '◉', group: 'admin', roles: ['admin'] },
  { to: '/empresa',        label: 'Empresa',          icon: '⌂', group: 'admin', roles: ['admin', 'comprador', 'gestor'] },
  { to: '/auditoria',      label: 'Auditoria',        icon: '⌘', group: 'admin', roles: ['admin', 'gestor'] },
];

export function filterNavByRole(items: NavItem[], role: string | undefined | null): NavItem[] {
  if (!role) return items.filter((i) => !i.roles || i.roles.length === 0);
  return items.filter((i) => !i.roles || i.roles.length === 0 || i.roles.includes(role));
}
