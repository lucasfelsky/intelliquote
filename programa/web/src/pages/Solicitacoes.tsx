import { useAuth } from '@/auth/AuthProvider';
import { isComercialRole } from '@/components/navConfig';
import ComercialView from './Solicitacoes/ComercialView';
import ComexView from './Solicitacoes/ComexView';

// Uma rota, duas visoes: o comercial cria/acompanha as proprias; o COMEX so le (PR1).
export default function Solicitacoes() {
  const { user } = useAuth();
  return isComercialRole(user?.role) ? <ComercialView /> : <ComexView />;
}
