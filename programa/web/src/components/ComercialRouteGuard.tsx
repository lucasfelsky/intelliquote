import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { isComercialRole } from './navConfig';

// O papel `comercial` so enxerga /solicitacoes: qualquer outra rota volta para la.
export default function ComercialRouteGuard() {
  const { user } = useAuth();
  const location = useLocation();

  if (isComercialRole(user?.role) && !location.pathname.startsWith('/solicitacoes')) {
    return <Navigate to="/solicitacoes" replace />;
  }
  return <Outlet />;
}
