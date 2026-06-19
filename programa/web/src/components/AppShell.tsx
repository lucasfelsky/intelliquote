import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '@/auth/AuthProvider';
import { filterNavByRole, PRIMARY_NAV, ADMIN_NAV } from './navConfig';

export default function AppShell() {
  const { user } = useAuth();
  const role = user?.role;
  const mainNav = filterNavByRole(PRIMARY_NAV, role);
  const adminNav = filterNavByRole(ADMIN_NAV, role);
  const adminHeader = adminNav.length > 0;

  return (
    <div className={`app-shell${adminHeader ? ' app-shell--with-admin' : ''}`}>
      <Sidebar
        items={mainNav}
        adminItems={adminNav}
        adminHeader={adminHeader}
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
