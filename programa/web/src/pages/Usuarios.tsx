import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/icons';

interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';
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
  // null = cadastro novo; preenchido = edição de nome/perfil desse usuário.
  const [editing, setEditing] = useState<User | null>(null);
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

  const update = useMutation({
    mutationFn: ({ id, name, role }: { id: number; name: string; role: User['role'] }) =>
      api.put<unknown>(`/api/v1/users/${id}`, { name, role }),
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
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
  }

  const saving = create.isPending || update.isPending;

  // Fechar pelo usuario (Cancelar/×/Esc) fica bloqueado enquanto salva: assim os
  // callbacks da mutation sempre agem sobre o mesmo formulario que foi enviado.
  function requestClose() {
    if (saving) return;
    closeForm();
  }

  function openEdit(user: User) {
    setEditing(user);
    setForm({ ...emptyForm, name: user.name, email: user.email, role: user.role });
    setFormError(null);
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (editing) {
      if (!form.name.trim()) {
        setFormError('Informe o nome.');
        return;
      }
      update.mutate({ id: editing.id, name: form.name.trim(), role: form.role });
      return;
    }
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

  const senhaInvalida = formError === 'A senha deve ter pelo menos 8 caracteres.';

  return (
    <div className="page usuarios-page">
      <div className="page-header">
        <div>
          <h1>Usuários</h1>
          <p>Gerencie os usuários internos e seus perfis de acesso.</p>
        </div>
        <div className="page-header__actions">
          <div className="usuarios-busca">
            <Icon name="search" size={16} />
            <input
              className="usuarios-busca__campo"
              aria-label="Buscar por nome ou e-mail"
              placeholder="Buscar por nome ou e-mail"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="select usuarios-filtro"
            aria-label="Filtrar por perfil"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="">Todos os perfis</option>
            <option value="admin">Admin</option>
            <option value="comprador">Comprador</option>
            <option value="gestor">Gestor</option>
            <option value="viewer">Viewer</option>
            <option value="comercial">Comercial</option>
          </select>
          <button type="button" className="primary-button" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={16} strokeWidth={2.2} />
            Novo usuário
          </button>
        </div>
      </div>

      <section className="card usuarios-lista" aria-label="Usuários">
        {list.isLoading && (
          <div className="usuarios-carregando" role="status">
            <span className="btn-spinner" aria-hidden="true" />
            Carregando usuários…
          </div>
        )}
        {list.isError && (
          <div className="usuarios-estado">
            <div
              className="empty-state empty-state--erro"
              role="alert"
            >
              <span className="empty-state__icon">
                <Icon name="alert-triangle" size={24} strokeWidth={1.7} />
              </span>
              <strong className="empty-state__title">Não foi possível carregar a lista de usuários.</strong>
              <p className="empty-state__text">Verifique sua conexão e tente novamente.</p>
              <button type="button" className="ghost-button" onClick={() => list.refetch()}>
                <Icon name="refresh" size={14} strokeWidth={2} />
                Tentar novamente
              </button>
            </div>
          </div>
        )}
        {list.data && list.data.length === 0 && !list.isLoading && (
          <div className="usuarios-estado">
            <div className="empty-state">
              <span className="empty-state__icon">
                <Icon name="usuarios" size={36} strokeWidth={1.5} />
              </span>
              <strong className="empty-state__title">Nenhum usuário encontrado</strong>
            </div>
          </div>
        )}
        {list.data && list.data.length > 0 && (
          <div className="table-wrapper">
            <table className="table usuarios-tabela">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Status</th>
                  <th>Criado em</th>
                  <th className="usuarios-acoes-cab"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((u) => (
                  <tr key={u.id}>
                    <td className="usuarios-nome">{u.name}</td>
                    <td className="usuarios-email">{u.email}</td>
                    <td><span className="badge badge--muted">{u.role}</span></td>
                    <td className="usuarios-status">
                      <span className={`badge badge--dot ${u.isActive ? '' : 'badge--muted'}`}>
                        {u.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="usuarios-data">{u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '—'}</td>
                    <td className="usuarios-acoes">
                      <div className="row-actions row-actions--nowrap">
                        <button
                          type="button"
                          className="ghost-button"
                          aria-label={`Editar ${u.name}`}
                          onClick={() => openEdit(u)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => toggleActive.mutate({ id: u.id, isActive: !u.isActive })}
                        >
                          {u.isActive ? 'Desativar' : 'Ativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal isOpen={showForm} onClose={requestClose} title={editing ? 'Editar usuário' : 'Novo usuário'}>
        <form onSubmit={handleSubmit}>
          <div className="usuario-form">
            <div className="usuario-campo">
              <label className="field-label" htmlFor="user-name">Nome</label>
              <input
                id="user-name"
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>

            <div className="usuario-campo">
              <label className="field-label" htmlFor="user-email">E-mail</label>
              <div className="usuario-campo__controle">
                <input
                  id="user-email"
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  // O e-mail liga o usuário ao login do Portal COMEX: não muda na edição.
                  disabled={editing !== null}
                  required
                />
                {editing && <Icon name="lock" size={16} className="usuario-campo__cadeado" aria-hidden="true" />}
              </div>
            </div>

            <div className="usuario-campo">
              <label className="field-label" htmlFor="user-role">Perfil</label>
              <select
                id="user-role"
                className="select"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}
                aria-describedby={editing ? 'user-role-hint' : undefined}
              >
                <option value="admin">Admin</option>
                <option value="comprador">Comprador</option>
                <option value="gestor">Gestor</option>
                <option value="viewer">Viewer</option>
                <option value="comercial">Comercial</option>
              </select>
              {editing && (
                <p className="usuario-dica" id="user-role-hint">
                  Para quem entra pelo Portal COMEX, só o perfil Comercial fica fixo; os demais são
                  reajustados pelo perfil do Portal a cada login.
                </p>
              )}
            </div>

            {!editing && (
              <div className="usuario-campo">
                <label className="field-label" htmlFor="user-password">Senha inicial</label>
                <input
                  id="user-password"
                  className="input"
                  type="password"
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  aria-invalid={senhaInvalida ? true : undefined}
                  aria-describedby={senhaInvalida ? 'user-form-error' : undefined}
                  required
                />
              </div>
            )}

            {formError && (
              <p
                className="usuario-erro"
                id="user-form-error"
                role="alert"
              >
                <Icon name="alert-triangle" size={16} />
                {formError}
              </p>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={requestClose} disabled={saving}>
              Cancelar
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={saving}
            >
              {editing ? 'Salvar' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </Modal>
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
