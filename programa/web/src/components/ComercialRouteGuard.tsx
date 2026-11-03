import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { isComercialRole } from './navConfig';

// O papel `comercial` so enxerga /solicitacoes e o Manual (so o capitulo Solicitacoes): qualquer outra rota volta para /solicitacoes.
// /ajuda segue liberada porque so redireciona para /manual.
function rotaLiberadaAoComercial(pathname: string): boolean {
  const caminho = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return pathname.startsWith('/solicitacoes') || caminho === '/manual' || caminho === '/ajuda';
}

export default function ComercialRouteGuard() {
  const { user } = useAuth();
  const location = useLocation();

  if (isComercialRole(user?.role) && !rotaLiberadaAoComercial(location.pathname)) {
    return <Navigate to="/solicitacoes" replace />;
  }
  return <Outlet />;
}
