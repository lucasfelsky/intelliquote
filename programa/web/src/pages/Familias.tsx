import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
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
    <div className="page itens-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1>Famílias de Itens</h1>
          <p className="page-subtitle">
            Gerencie as famílias utilizadas no catálogo.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={() => setIsModalOpen(true)}>
          + Nova Família
        </button>
      </header>

      <section className="card" aria-label="Lista de famílias">
        {feedback && (
          <div
            className={`alert ${feedback.kind === 'success' ? 'alert--success' : 'alert--error'}`}
            style={{ marginBottom: 16 }}
          >
            {feedback.message}
          </div>
        )}
        {familiesQuery.isLoading && <p>Carregando famílias…</p>}
        {familiesQuery.isError && (
          <div className="empty-state">
            <p>Não foi possível carregar a lista de famílias.</p>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
              Verifique sua conexão e tente novamente.
            </p>
            <button className="ghost-button" onClick={() => familiesQuery.refetch()}>
              Tentar novamente
            </button>
          </div>
        )}
        {!familiesQuery.isLoading && !familiesQuery.isError && families.length === 0 && (
          <div className="empty-state">
            <strong>Nenhuma família encontrada</strong>
            <p>Cadastre a primeira família para começar.</p>
          </div>
        )}
        {families.length > 0 && (
          <div className="table-wrapper">
            <table className="table">
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
                    <td>{f.id}</td>
                    <td><strong>{f.name}</strong></td>
                    <td>
                      <span className={`badge ${f.isActive ? '' : 'badge--muted'}`}>
                        {f.isActive ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
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
        <form onSubmit={handleSubmit} className="form">
          <label className="field">
            <span>Nome da Família *</span>
            <input
              type="text"
              className="input"
              value={newFamilyName}
              onChange={(e) => setNewFamilyName(e.target.value)}
              placeholder="Ex: Embalagens"
              autoFocus
            />
          </label>
          {errorMsg && <div className="alert alert--error" style={{ marginBottom: 16 }}>{errorMsg}</div>}
          <div className="modal-actions" style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
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
    </div>
  );
}
