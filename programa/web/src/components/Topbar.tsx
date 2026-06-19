import { useAuth } from '@/auth/AuthProvider';

export default function Topbar() {
  const { user, logout } = useAuth();

  return (
    <header className="topbar">
      <div className="topbar__title">
        <img src="/logo.png" alt="" className="topbar__logo" />
        <span className="badge badge--muted">SSO · Portal COMEX</span>
      </div>
      <div className="topbar__user">
        <div className="topbar__user-info">
          <strong>{user?.name ?? 'Usuário'}</strong>
          <small>{user?.email}</small>
        </div>
        <span className="badge">{user?.role}</span>
        <button type="button" className="ghost-button" onClick={() => void logout()}>
          Sair
        </button>
      </div>
    </header>
  );
}
