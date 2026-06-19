import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';

interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'comprador' | 'gestor' | 'viewer';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserFormState {
  name: string;
  email: string;
  role: User['role'];
  password: string;
  isActive: boolean;
}

const emptyForm: UserFormState = {
  name: '',
  email: '',
  role: 'comprador',
  password: '',
  isActive: true,
};

function normalize(value: unknown): User {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Resposta inesperada do servidor.');
  }
  const obj = value as Record<string, unknown>;
  return {
    id: Number(obj.id),
    name: String(obj.name ?? ''),
    email: String(obj.email ?? ''),
    role: (obj.role as User['role']) ?? 'viewer',
    isActive: Boolean(obj.isActive),
    createdAt: String(obj.createdAt ?? ''),
    updatedAt: String(obj.updatedAt ?? ''),
  };
}

export default function Usuarios() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<UserFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');

  const list = useQuery({
    queryKey: ['users', search, roleFilter],
    queryFn: async () => {
      const data = await api.get<unknown[] | { items: unknown[] }>('/api/v1/users', {
        search: search || undefined,
        role: roleFilter || undefined,
      });
      const items = Array.isArray(data) ? data : data.items ?? [];
      return items.map(normalize);
    },
  });

  const create = useMutation({
    mutationFn: async (payload: UserFormState) => {
      const created = await api.post<unknown>('/api/v1/users', {
        name: payload.name,
        email: payload.email,
        role: payload.role,
        password: payload.password,
        isActive: payload.isActive,
      });
      return normalize(created);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      closeForm();
    },
    onError: (err) => setFormError(messageOf(err)),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.put<unknown>(`/api/v1/users/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  function closeForm() {
    setShowForm(false);
    setForm(emptyForm);
    setFormError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim() || !form.email.trim()) {
      setFormError('Informe nome e e-mail.');
      return;
    }
    if (form.password.length < 8) {
      setFormError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    create.mutate(form);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Administração</p>
          <h1>Usuários</h1>
          <p>Gerencie os usuários internos e seus perfis de acesso.</p>
        </div>
        <div className="page-header__actions">
          <input
            className="input"
            placeholder="Buscar por nome ou e-mail"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 240 }}
          />
          <select
            className="select"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            style={{ maxWidth: 180 }}
          >
            <option value="">Todos os perfis</option>
            <option value="admin">Admin</option>
            <option value="comprador">Comprador</option>
            <option value="gestor">Gestor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button type="button" className="primary-button" onClick={() => setShowForm(true)}>
            + Novo usuário
          </button>
        </div>
      </div>

      <section className="card">
        {list.isLoading && <p>Carregando usuários…</p>}
        {list.isError && (
          <div className="empty-state">
            <p>Não foi possível carregar a lista de usuários.</p>
          </div>
        )}
        {list.data && list.data.length === 0 && !list.isLoading && (
          <div className="empty-state">
            <strong>Nenhum usuário encontrado</strong>
          </div>
        )}
        {list.data && list.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Status</th>
                <th>Criado em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td>{u.email}</td>
                  <td><span className="badge">{u.role}</span></td>
                  <td>
                    <span className={`badge ${u.isActive ? '' : 'badge--muted'}`}>
                      {u.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => toggleActive.mutate({ id: u.id, isActive: !u.isActive })}
                    >
                      {u.isActive ? 'Desativar' : 'Ativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <h2>Novo usuário</h2>

            <label className="field-label" htmlFor="user-name">Nome</label>
            <input
              id="user-name"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />

            <label className="field-label" htmlFor="user-email" style={{ marginTop: 12 }}>E-mail</label>
            <input
              id="user-email"
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />

            <label className="field-label" htmlFor="user-role" style={{ marginTop: 12 }}>Perfil</label>
            <select
              id="user-role"
              className="select"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}
            >
              <option value="admin">Admin</option>
              <option value="comprador">Comprador</option>
              <option value="gestor">Gestor</option>
              <option value="viewer">Viewer</option>
            </select>

            <label className="field-label" htmlFor="user-password" style={{ marginTop: 12 }}>Senha inicial</label>
            <input
              id="user-password"
              className="input"
              type="password"
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />

            {formError && (
              <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{formError}</p>
            )}

            <div className="modal__actions">
              <button type="button" className="ghost-button" onClick={closeForm}>
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={create.isPending}
              >
                Cadastrar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}
