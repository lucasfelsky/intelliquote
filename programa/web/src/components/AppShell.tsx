import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '@/auth/AuthProvider';
import { getCommercialRequestsPendingCount } from '@/services/commercialRequests';
import { getIndentRequestsNewCount } from '@/services/indentRequests';
import { COMEX_ROLES, filterNavByRole, INDENT_NAV, PRIMARY_NAV, ADMIN_NAV, type NavItem } from './navConfig';

// Sidebar recolhida (so icones): a escolha fica no navegador. Storage pode falhar (modo privado, bloqueio): nunca quebra a tela.
export const CHAVE_SIDEBAR_COLAPSADA = 'iq-sidebar-colapsada';

function lerColapsada(): boolean {
  try {
    return localStorage.getItem(CHAVE_SIDEBAR_COLAPSADA) === '1';
  } catch {
    return false;
  }
}

// "Voltar ao IntelliQuote" da variante Indent: link comum da sidebar (NavLink end em "/", nunca ativo dentro de /indent/*).
const VOLTAR_AO_IQ: NavItem = { to: '/', label: 'Voltar ao IntelliQuote', icon: 'arrow-left', end: true };

export default function AppShell() {
  const [colapsada, setColapsada] = useState(lerColapsada);
  const alternarSidebar = () => {
    const proxima = !colapsada;
    setColapsada(proxima);
    try {
      if (proxima) localStorage.setItem(CHAVE_SIDEBAR_COLAPSADA, '1');
      else localStorage.removeItem(CHAVE_SIDEBAR_COLAPSADA);
    } catch {
      // sem persistencia: o estado vale so ate recarregar
    }
  };
  // Em /indent/* a sidebar troca para a variante do IQ Indent (selo na marca, "Voltar", Solicitacoes e as 3 paginas de cadastro).
  const indent = /^\/indent(\/|$)/.test(useLocation().pathname);
  const { user, logout } = useAuth();
  const role = user?.role;
  const isComex = !!role && COMEX_ROLES.includes(role);

  // Badge de solicitacoes pendentes (so equipe COMEX; o comercial nao tem acesso a este endpoint).
  const pending = useQuery({
    queryKey: ['commercial-requests', 'pending-count'],
    queryFn: getCommercialRequestsPendingCount,
    enabled: isComex,
    refetchInterval: 60_000,
  });
  // Badge das solicitacoes NOVAS do Indent (com cliente; cliente pendente nao conta). So dentro de /indent/*.
  const novasIndent = useQuery({
    queryKey: ['indent', 'requests', 'new-count'],
    queryFn: getIndentRequestsNewCount,
    enabled: isComex && indent,
    refetchInterval: 60_000,
  });
  const badges: Record<string, number> = indent
    ? { '/indent/solicitacoes': novasIndent.data?.count ?? 0 }
    : { '/solicitacoes': pending.data?.count ?? 0 };
  const mainNav = indent ? filterNavByRole(INDENT_NAV, role) : filterNavByRole(PRIMARY_NAV, role);
  const adminNav = indent ? [] : filterNavByRole(ADMIN_NAV, role);
  const adminHeader = adminNav.length > 0;

  return (
    <div className={`app-shell${adminHeader ? ' app-shell--with-admin' : ''}${colapsada ? ' app-shell--colapsada' : ''}${indent ? ' app-shell--indent' : ''}`}>
      <Sidebar
        items={mainNav}
        adminItems={adminNav}
        adminHeader={adminHeader}
        badges={badges}
        onLogout={() => void logout()}
        colapsada={colapsada}
        onAlternar={alternarSidebar}
        {...(indent
          ? { variant: 'indent' as const, brandTag: 'Indent', backLink: VOLTAR_AO_IQ, sectionTitle: 'Indent', navLabel: 'Indent' }
          : {})}
      />
      <div className="app-shell__main">
        <Topbar />
        <main className="app-shell__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
