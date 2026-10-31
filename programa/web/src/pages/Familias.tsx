import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { useConfirm } from '@/components/useConfirm';
import { messageOf } from '@/services/quoteResponses';

interface ItemFamily {
  id: number;
  name: string;
  isActive: boolean;
}

export default function Familias() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [editing, setEditing] = useState<ItemFamily | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');

  const familiesQuery = useQuery<ItemFamily[]>({
    queryKey: ['item-families', { includeInactive: true }],
    queryFn: async () => {
      const res = await api.get<{ data: ItemFamily[] }>('/v1/item-families', { includeInactive: true });
      // @ts-ignore
      return res.data;
    },
  });
  const families = familiesQuery.data ?? [];

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await api.post('/v1/item-families', { name });
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item-families'] });
      setIsModalOpen(false);
      setNewFamilyName('');
      setErrorMsg('');
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Erro ao criar família');
    },
  });

  const toggleActive = useMutation({
    mutationFn: (family: ItemFamily) =>
      api.put(`/v1/item-families/${family.id}`, { isActive: !family.isActive }),
    onSuccess: (_data, family) => {
      queryClient.invalidateQueries({ queryKey: ['item-families'] });
      setFeedback({
        kind: 'success',
        message: family.isActive
          ? `Família "${family.name}" inativada.`
          : `Família "${family.name}" reativada.`,
      });
    },
    onError: (err) => setFeedback({ kind: 'error', message: messageOf(err) }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.put(`/v1/item-families/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item-families'] });
      setEditing(null);
      setEditName('');
      setEditError('');
      setFeedback({ kind: 'success', message: 'Família atualizada.' });
    },
    onError: (err) => setEditError(messageOf(err)),
  });

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      setEditError('O nome é obrigatório');
      return;
    }
    if (!editing) return;
    renameMutation.mutate({ id: editing.id, name: editName.trim() });
  };

  async function handleToggleActive(family: ItemFamily) {
    if (family.isActive) {
      if (!(await confirm(`Inativar a família "${family.name}"?`))) return;
    }
    setFeedback(null);
    toggleActive.mutate(family);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFamilyName.trim()) {
      setErrorMsg('O nome é obrigatório');
      return;
    }
    createMutation.mutate(newFamilyName.trim());
  };

  return (
    <div className="page familias-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1>Famílias de Itens</h1>
          <p className="page-subtitle">
            Gerencie as famílias utilizadas no catálogo.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={() => setIsModalOpen(true)}>
          <Icon name="plus" size={16} strokeWidth={2.2} />
          Nova Família
        </button>
      </header>

      <section className="card familias-lista" aria-label="Lista de famílias">
        {feedback && (
          <div className="familias-lista__aviso">
          <div
              role={feedback.kind === 'success' ? 'status' : 'alert'}
              className={`familias-alerta ${feedback.kind === 'success' ? 'alert--success' : 'alert--error'}`}
          >
              <Icon
                name={feedback.kind === 'success' ? 'check' : 'alert-triangle'}
                size={18}
                strokeWidth={feedback.kind === 'success' ? 2 : 1.9}
              />
            {feedback.message}
          </div>
          </div>
        )}
        {familiesQuery.isLoading && (
          <div className="familias-carregando" role="status">
            <span className="btn-spinner" aria-hidden="true" />
            Carregando famílias…
          </div>
        )}
        {familiesQuery.isError && (
          <div className="familias-estado">
            <div
              className="empty-state empty-state--erro"
              role="alert"
            >
              <span className="empty-state__icon">
                <Icon name="alert-triangle" size={24} strokeWidth={1.7} />
              </span>
              <strong className="empty-state__title">Não foi possível carregar a lista de famílias.</strong>
              <p className="empty-state__text">
              Verifique sua conexão e tente novamente.
            </p>
            <button className="ghost-button" onClick={() => familiesQuery.refetch()}>
              Tentar novamente
            </button>
          </div>
          </div>
        )}
        {!familiesQuery.isLoading && !familiesQuery.isError && families.length === 0 && (
          <div className="familias-estado">
          <div className="empty-state">
              <span className="empty-state__icon">
                <Icon name="familias" size={36} strokeWidth={1.5} />
              </span>
              <strong className="empty-state__title">Nenhuma família encontrada</strong>
              <p className="empty-state__text">Cadastre a primeira família para começar.</p>
            </div>
          </div>
        )}
        {families.length > 0 && (
          <div className="table-wrapper">
            <table className="table familias-tabela">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nome</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {families.map((f) => (
                  <tr key={f.id}>
                    <td className="familias-id">{f.id}</td>
                    <td><strong>{f.name}</strong></td>
                    <td>
                      <span className={`badge badge--dot ${f.isActive ? '' : 'badge--muted'}`}>
                        {f.isActive ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => {
                            setEditing(f);
                            setEditName(f.name);
                            setEditError('');
                          }}
                        >
                          <Icon name="edit" size={14} strokeWidth={1.9} />
                          Editar
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => handleToggleActive(f)}
                          disabled={toggleActive.isPending}
                        >
                          {f.isActive ? 'Inativar' : 'Reativar'}
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

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Nova Família"
      >
        <form className="familias-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Nome da Família *</span>
            <input
              type="text"
              className="input"
              value={newFamilyName}
              onChange={(e) => setNewFamilyName(e.target.value)}
              placeholder="Ex: Embalagens"
              aria-invalid={errorMsg ? 'true' : undefined}
              autoFocus
            />
          </label>
          {errorMsg && (
            <div
              role="alert"
              className="familias-alerta alert--error"
            >
              <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
              {errorMsg}
            </div>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setIsModalOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title="Editar Família"
      >
        <form className="familias-form" onSubmit={handleEditSubmit}>
          <label className="field">
            <span>Nome da Família *</span>
            <input
              type="text"
              className="input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Ex: Embalagens"
              aria-invalid={editError ? 'true' : undefined}
              autoFocus
            />
          </label>
          {editError && (
            <div
              role="alert"
              className="familias-alerta alert--error"
            >
              <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
              {editError}
            </div>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setEditing(null)}
              disabled={renameMutation.isPending}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={renameMutation.isPending}
            >
              {renameMutation.isPending ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
