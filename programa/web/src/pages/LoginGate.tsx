import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { ApiError } from '@/api/client';
import LoginBackdrop, { LoginPainel } from '@/components/LoginBackdrop';

export default function LoginGate() {
  const { login, status, exchangeError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') {
    queueMicrotask(() => navigate(from, { replace: true }));
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      let msg: string;
      if (err instanceof ApiError) {
        const body = err.body as { message?: unknown } | null;
        msg = body && typeof body.message === 'string' ? body.message : err.message;
      } else {
        msg = (err as Error).message ?? 'Falha ao entrar.';
      }
      if (/invalid-login-credential|invalid email|wrong-password|user-not-found/i.test(msg)) {
        setError('E-mail ou senha inválidos.');
      } else if (/token|credential|auth|signature|expired|verify/i.test(msg)) {
        setError(`Falha de autenticação no servidor: ${msg.slice(0, 240)}`);
      } else {
        setError(msg || 'Falha ao entrar. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-gate">
      <LoginBackdrop />
      <LoginPainel />
      <div className="auth-gate__area">
        <form className="auth-card" onSubmit={handleSubmit} aria-busy={submitting}>
          <div className="auth-card__cabecalho">
            <p className="eyebrow auth-card__eyebrow">IntelliQuote</p>
            <h1>Entrar</h1>
            <p className="auth-card__texto">Use a mesma conta do Portal COMEX. Acesso via Firebase Authentication.</p>
          </div>

          <div className="auth-card__campo">
            <label className="field-label" htmlFor="email">E-mail</label>
            <input
              id="email" className="input" type="email" required autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@sqquimica.com" autoComplete="email"
            />
          </div>

          <div className="auth-card__campo">
            <label className="field-label" htmlFor="password">Senha</label>
            <input
              id="password" className="input" type="password" required minLength={6}
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="alert alert--error auth-card__erro" role="alert">
              {error}
            </p>
          )}

          {exchangeError && !error && (
            <p className="auth-card__detalhe">
              Detalhe: {exchangeError.slice(0, 300)}
            </p>
          )}

          <div className="auth-card__actions">
            <button type="submit" className="primary-button auth-card__submit" disabled={submitting}>
              {submitting && <span className="btn-spinner" aria-hidden="true" />}
              {submitting ? 'Entrando…' : 'Entrar'}
            </button>
            <a
              className="ghost-button auth-card__portal"
              href={import.meta.env.VITE_PORTAL_URL ?? 'https://portal-comex.com'}
              rel="noopener"
            >
              Voltar ao Portal COMEX
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
