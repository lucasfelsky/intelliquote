import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from './icons';
import { isComercialRole } from './navConfig';

// Inicial do avatar: nome sem colchetes (placeholders), primeira letra em maiuscula; `U` se faltar.
function avatarInitial(name: string | undefined): string {
  return (name ?? '').replace(/[[\]]/g, '').trim().charAt(0).toUpperCase() || 'U';
}

// Cabecalho do mock v68: chip SSO, bloco do usuario e "Minha conta". Sem logo, tema, Sair nem titulo
// (tema e Sair moraram para a sidebar). O espacador a esquerda empurra tudo para a direita.
export default function Topbar() {
  const { user } = useAuth();

  return (
    <header className="topbar">
      <div className="topbar__spacer" />
      <span className="topbar__sso" title="Login único com o Portal COMEX">
        <Icon name="shield" size={14} strokeWidth={2} />
        SSO · Portal COMEX
      </span>
      <div className="topbar__user">
        <span className="topbar__avatar" aria-hidden="true">
          {avatarInitial(user?.name)}
        </span>
        <div className="topbar__user-info">
          <strong>{user?.name ?? 'Usuário'}</strong>
          <small>{user?.email}</small>
        </div>
        <span className="topbar__role">{user?.role}</span>
      </div>
      {!isComercialRole(user?.role) && (
        <Link to="/minha-conta" className="topbar__account">
          <Icon name="user" size={16} />
          Minha conta
        </Link>
      )}
    </header>
  );
}
