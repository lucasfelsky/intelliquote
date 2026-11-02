// Tipos compartilhados para a navegação principal.
import type { IconName } from './icons';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;     // chave de ICONS (icons.tsx): icone de traco do mock v68
  end?: boolean;
  group?: 'main' | 'admin';
  roles?: string[];   // se vazio/ausente, todos os papeis veem
  tag?: string;       // selo curto ao lado do rotulo (ex.: 'Beta')
}

// Papeis da equipe COMEX (acesso interno). `comercial` fica de fora: so ve /solicitacoes e o Manual (/manual, so o capitulo Solicitacoes).
export const COMEX_ROLES = ['admin', 'comprador', 'gestor', 'viewer'];

export function isComercialRole(role?: string | null): boolean {
  return role === 'comercial';
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/',          label: 'Overview',           icon: 'overview', end: true,  group: 'main', roles: COMEX_ROLES },
  { to: '/cotacoes',  label: 'Cotações',           icon: 'cotacoes',             group: 'main', roles: COMEX_ROLES },
  { to: '/solicitacoes', label: 'Solicitações',    icon: 'solicitacoes',             group: 'main', roles: [...COMEX_ROLES, 'comercial'] },
  { to: '/itens',     label: 'Itens',              icon: 'itens',             group: 'main', roles: COMEX_ROLES },
  { to: '/fornecedores', label: 'Fornecedores',    icon: 'fornecedores',             group: 'main', roles: COMEX_ROLES },
  { to: '/forecast',  label: 'Forecast',           icon: 'forecast',             group: 'main', roles: COMEX_ROLES, tag: 'Beta' },
  { to: '/forwarders', label: 'Forwarders',       icon: 'forwarders',             group: 'main', roles: COMEX_ROLES },
  { to: '/familias',  label: 'Famílias',           icon: 'familias',             group: 'main', roles: COMEX_ROLES },
  { to: '/relatorios',label: 'Relatórios',         icon: 'relatorios',             group: 'main', roles: COMEX_ROLES },
  { to: '/manual',    label: 'Manual',             icon: 'ajuda',             group: 'main', roles: [...COMEX_ROLES, 'comercial'] },
];

export const ADMIN_NAV: NavItem[] = [
  { to: '/usuarios',       label: 'Usuários',         icon: 'usuarios', group: 'admin', roles: ['admin'] },
  { to: '/empresa',        label: 'Empresa',          icon: 'empresa', group: 'admin', roles: ['admin', 'comprador', 'gestor'] },
  { to: '/auditoria',      label: 'Auditoria',        icon: 'auditoria', group: 'admin', roles: ['admin', 'gestor'] },
  { to: '/templates',      label: 'Templates de e-mail', icon: 'templates', group: 'admin', roles: ['admin', 'comprador', 'gestor', 'viewer'] },
];

export function filterNavByRole(items: NavItem[], role: string | undefined | null): NavItem[] {
  if (!role) return items.filter((i) => !i.roles || i.roles.length === 0);
  return items.filter((i) => !i.roles || i.roles.length === 0 || i.roles.includes(role));
}
