import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '@/auth/AuthProvider';
import { getCommercialRequestsPendingCount } from '@/services/commercialRequests';
import { COMEX_ROLES, filterNavByRole, PRIMARY_NAV, ADMIN_NAV } from './navConfig';

export default function AppShell() {
  const { user } = useAuth();
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
    <div className={`app-shell${adminHeader ? ' app-shell--with-admin' : ''}`}>
      <Sidebar
        items={mainNav}
        adminItems={adminNav}
        adminHeader={adminHeader}
        badges={badges}
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
