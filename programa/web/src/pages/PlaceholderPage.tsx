import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

export default function PlaceholderPage({ title, eyebrow }: { title: string; eyebrow?: string }) {
  // ping /api/v1/auth/me para garantir que o token ainda é válido e
  // demonstrar que a página está sendo renderizada dentro do shell autenticado.
  const me = useQuery({
    queryKey: ['me', 'ping'],
    queryFn: () => api.get<{ user: { name: string; email: string; role: string } }>('/api/v1/auth/me'),
    retry: false,
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          <p>Esta página será preenchida na próxima fase de implementação.</p>
        </div>
      </div>

      <section className="card">
        <h2>Status da sessão</h2>
        {me.isLoading && <p>Validando sessão…</p>}
        {me.isError && (
          <div className="empty-state">
            <p>Não foi possível validar a sessão atual.</p>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              Faça login novamente se o problema persistir.
            </p>
          </div>
        )}
        {me.data && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <li><strong>Nome:</strong> {me.data.user.name}</li>
            <li><strong>E-mail:</strong> {me.data.user.email}</li>
            <li><strong>Perfil:</strong> <span className="badge">{me.data.user.role}</span></li>
          </ul>
        )}
      </section>
    </div>
  );
}
