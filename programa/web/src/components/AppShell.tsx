import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '@/auth/AuthProvider';
import { getCommercialRequestsPendingCount } from '@/services/commercialRequests';
import { COMEX_ROLES, filterNavByRole, PRIMARY_NAV, ADMIN_NAV } from './navConfig';

// Sidebar recolhida (so icones): a escolha fica no navegador. Storage pode falhar (modo privado, bloqueio): nunca quebra a tela.
export const CHAVE_SIDEBAR_COLAPSADA = 'iq-sidebar-colapsada';

function lerColapsada(): boolean {
  try {
    return localStorage.getItem(CHAVE_SIDEBAR_COLAPSADA) === '1';
  } catch {
    return false;
  }
}

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
  const badges: Record<string, number> = { '/solicitacoes': pending.data?.count ?? 0 };
  const mainNav = filterNavByRole(PRIMARY_NAV, role);
  const adminNav = filterNavByRole(ADMIN_NAV, role);
  const adminHeader = adminNav.length > 0;

  return (
    <div className={`app-shell${adminHeader ? ' app-shell--with-admin' : ''}${colapsada ? ' app-shell--colapsada' : ''}`}>
      <Sidebar
        items={mainNav}
        adminItems={adminNav}
        adminHeader={adminHeader}
        badges={badges}
        onLogout={() => void logout()}
        colapsada={colapsada}
        onAlternar={alternarSidebar}
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
