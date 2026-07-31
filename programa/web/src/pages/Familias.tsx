import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Modal } from '@/components/Modal';

interface ItemFamily {
  id: number;
  name: string;
  isActive: boolean;
}

export default function Familias() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const { data: families = [], isLoading } = useQuery<ItemFamily[]>({
    queryKey: ['item-families'],
    queryFn: async () => {
      const res = await api.get<{ data: ItemFamily[] }>('/v1/item-families');
      // @ts-ignore
      return res.data;
    },
  });

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
        {isLoading ? (
          <div className="itens-empty">Carregando…</div>
        ) : families.length === 0 ? (
          <div className="itens-empty">
            <strong>Nenhuma família encontrada</strong>
            <p>Cadastre a primeira família para começar.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nome</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.id}>
                  <td>{f.id}</td>
                  <td>{f.name}</td>
                  <td>
                    <span className={`itens-card__badge ${f.isActive ? 'itens-card__badge--active' : 'itens-card__badge--inactive'}`}>
                      {f.isActive ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
