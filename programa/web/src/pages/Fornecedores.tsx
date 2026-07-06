import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import {
  createSupplierContact,
  deleteSupplierContact,
  getEmptyContactForm,
  listSupplierContacts,
  normalizeContact,
  updateSupplierContact,
  type SupplierContact,
  type SupplierContactForm,
} from '@/services/dispatch';

interface Supplier {
  id: number;
  name: string;
  website?: string | null;
  status: 'active' | 'inactive' | 'blocked';
  country?: string | null;
  notes?: string | null;
  acceptedIncoterms: string[];
  paymentTermsDays?: number | null;
}

interface SupplierFormState {
  name: string;
  website: string;
  country: string;
  notes: string;
  status: 'active' | 'inactive' | 'blocked';
  acceptedIncoterms: string[];
  paymentTermsDays: number;
}

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

const emptyForm: SupplierFormState = {
  name: '',
  website: '',
  country: '',
  notes: '',
  status: 'active',
  acceptedIncoterms: [],
  paymentTermsDays: 30,
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function normalize(supplier: unknown): Supplier {
  if (typeof supplier !== 'object' || supplier === null) {
    throw new Error('Resposta inesperada do servidor.');
  }
  const obj = supplier as Record<string, unknown>;
  return {
    id: Number(obj.id),
    name: String(obj.name ?? ''),
    website: (obj.website as string | null) ?? null,
    status: (obj.status as Supplier['status']) ?? 'active',
    country: (obj.country as string | null) ?? null,
    notes: (obj.notes as string | null) ?? null,
    acceptedIncoterms: asStringArray(obj.acceptedIncoterms),
    paymentTermsDays: typeof obj.paymentTermsDays === 'number' ? obj.paymentTermsDays : null,
  };
}

export default function Fornecedores() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierFormState>(emptyForm);
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [expandedSupplierId, setExpandedSupplierId] = useState<number | null>(null);
  const [contactForm, setContactForm] = useState<SupplierContactForm>(getEmptyContactForm());
  const [editingContact, setEditingContact] = useState<SupplierContact | null>(null);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['suppliers', search],
    queryFn: async () => {
      const data = await api.get<unknown[] | { data?: unknown[]; items?: unknown[] }>(
        '/api/v1/suppliers',
        search ? { search } : undefined,
      );
      const raw = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : data?.items ?? [];
      return raw.map(normalize);
    },
  });

  const supplierIds = useMemo(
    () => (list.data ?? []).map((s) => s.id),
    [list.data],
  );

  const contactsBySupplier = useQuery({
    queryKey: ['supplier-contacts-bulk', supplierIds.join(',')],
    queryFn: async () => {
      const data = await api.get<{ bySupplier?: Record<string, unknown[]> }>(
        '/api/v1/supplier-contacts',
        { supplierIds: supplierIds.join(',') },
      );
      const map: Record<number, SupplierContact[]> = {};
      const bySupplier = data?.bySupplier ?? {};
      for (const [key, contacts] of Object.entries(bySupplier)) {
        map[Number(key)] = (Array.isArray(contacts) ? contacts : []).map(normalizeContact);
      }
      return map;
    },
    enabled: supplierIds.length > 0,
  });

  const contactsQuery = useQuery({
    queryKey: ['supplier-contacts', expandedSupplierId],
    queryFn: () => listSupplierContacts(expandedSupplierId as number),
    enabled: expandedSupplierId !== null,
  });

  const create = useMutation({
    mutationFn: async (payload: SupplierFormState) => {
      const created = await api.post<unknown>('/api/v1/suppliers', {
        name: payload.name,
        website: payload.website || null,
        country: payload.country || null,
        notes: payload.notes || null,
        status: payload.status,
        acceptedIncoterms: payload.acceptedIncoterms,
        paymentTermsDays: payload.paymentTermsDays,
      });
      return normalize(created);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      closeForm();
    },
    onError: (err) => setFormError(messageOf(err)),
  });

  const update = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: SupplierFormState }) => {
      const updated = await api.put<unknown>(`/api/v1/suppliers/${id}`, {
        name: payload.name,
        website: payload.website || null,
        country: payload.country || null,
        notes: payload.notes || null,
        status: payload.status,
        acceptedIncoterms: payload.acceptedIncoterms,
        paymentTermsDays: payload.paymentTermsDays,
      });
      return normalize(updated);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      closeForm();
    },
    onError: (err) => setFormError(messageOf(err)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/v1/suppliers/${id}`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      const note = (data as { message?: string } | undefined)?.message;
      if (note) setFormError(null);
    },
    onError: (err) => setFormError(messageOf(err)),
  });

    const createContact = useMutation({
      mutationFn: ({ supplierId, payload }: { supplierId: number; payload: SupplierContactForm }) =>
        createSupplierContact(supplierId, payload),
      onSuccess: () => {
        setContactError(null);
        qc.invalidateQueries({ queryKey: ['supplier-contacts'] });
        qc.invalidateQueries({ queryKey: ['supplier-contacts-bulk'] });
        closeContactForm();
      },
      onError: (err) => setContactError(messageOf(err)),
    });

    const updateContact = useMutation({
      mutationFn: ({
        supplierId,
        contactId,
        payload,
      }: {
        supplierId: number;
        contactId: number;
        payload: SupplierContactForm;
      }) => updateSupplierContact(supplierId, contactId, payload),
      onSuccess: () => {
        setContactError(null);
        qc.invalidateQueries({ queryKey: ['supplier-contacts'] });
        qc.invalidateQueries({ queryKey: ['supplier-contacts-bulk'] });
        closeContactForm();
      },
      onError: (err) => setContactError(messageOf(err)),
    });

    const removeContact = useMutation({
      mutationFn: ({ supplierId, contactId }: { supplierId: number; contactId: number }) =>
        deleteSupplierContact(supplierId, contactId),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['supplier-contacts'] });
        qc.invalidateQueries({ queryKey: ['supplier-contacts-bulk'] });
      },
      onError: (err) => setContactError(messageOf(err)),
    });

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(supplier: Supplier) {
    setEditing(supplier);
    setForm({
      name: supplier.name,
      website: supplier.website ?? '',
      country: supplier.country ?? '',
      notes: supplier.notes ?? '',
      status: supplier.status,
      acceptedIncoterms: supplier.acceptedIncoterms,
      paymentTermsDays: supplier.paymentTermsDays ?? 30,
    });
    setFormError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
  }

  function toggleIncoterm(term: string) {
    setForm((current) => {
      const has = current.acceptedIncoterms.includes(term);
      return {
        ...current,
        acceptedIncoterms: has
          ? current.acceptedIncoterms.filter((t) => t !== term)
          : [...current.acceptedIncoterms, term],
      };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Informe o nome do fornecedor.');
      return;
    }
    if (form.acceptedIncoterms.length === 0) {
      setFormError('Selecione pelo menos um Incoterm aceito.');
      return;
    }
    if (editing) {
      update.mutate({ id: editing.id, payload: form });
    } else {
      create.mutate(form);
    }
  }

    function openNewContact(supplierId: number) {
      setEditingContact(null);
      setContactForm({ ...getEmptyContactForm(), isPrimary: contactsForSupplier(supplierId).length === 0 });
      setContactError(null);
      setExpandedSupplierId(supplierId);
      setShowContactForm(true);
    }

    function openEditContact(supplierId: number, contact: SupplierContact) {
      setEditingContact(contact);
      setContactForm({
        name: contact.name,
        email: contact.email,
        phone: contact.phone ?? '',
        position: contact.position ?? '',
        isPrimary: contact.isPrimary,
      });
      setContactError(null);
      setExpandedSupplierId(supplierId);
      setShowContactForm(true);
    }

    function closeContactForm() {
      setShowContactForm(false);
      setEditingContact(null);
      setContactForm(getEmptyContactForm());
      setContactError(null);
    }

    function contactsForSupplier(supplierId: number): SupplierContact[] {
      return contactsBySupplier.data?.[supplierId] ?? [];
    }

    function toggleExpanded(supplierId: number) {
      setExpandedSupplierId((current) => (current === supplierId ? null : supplierId));
    }

    function handleContactSubmit(e: React.FormEvent) {
      e.preventDefault();
      if (expandedSupplierId === null) return;
      setContactError(null);
      if (!contactForm.name.trim() || !contactForm.email.trim()) {
        setContactError('Informe nome e e-mail do contato.');
        return;
      }
      if (editingContact) {
        updateContact.mutate({
          supplierId: expandedSupplierId,
          contactId: editingContact.id,
          payload: contactForm,
        });
      } else {
        createContact.mutate({
          supplierId: expandedSupplierId,
          payload: contactForm,
        });
      }
    }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Cadastros</p>
          <h1>Fornecedores</h1>
          <p>Gerencie a base de fornecedores, Incoterms aceitos e status.</p>
        </div>
        <div className="page-header__actions">
          <input
            className="input"
            placeholder="Buscar por nome ou país"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <button type="button" className="primary-button" onClick={openNew}>
            + Novo fornecedor
          </button>
        </div>
      </div>

      <section className="card">
        {list.isLoading && <p>Carregando fornecedores…</p>}
        {list.isError && (
          <div className="empty-state">
            <p>Não foi possível carregar os fornecedores.</p>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              Verifique sua conexão e tente novamente.
            </p>
          </div>
        )}
        {list.data && list.data.length === 0 && !list.isLoading && (
          <div className="empty-state">
            <strong>Nenhum fornecedor cadastrado</strong>
            <p>Use o botão “Novo fornecedor” para começar.</p>
          </div>
        )}
        {list.data && list.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th>Nome</th>
                <th>País</th>
                <th>Incoterms</th>
                <th>Contato principal</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => {
                const supplierContacts = contactsForSupplier(s.id);
                const primary = supplierContacts.find((c) => c.isPrimary);
                const isExpanded = expandedSupplierId === s.id;
                return (
                  <>
                    <tr key={s.id}>
                      <td style={{ width: 32 }}>
                        <button
                          type="button"
                          className="ghost-button"
                          aria-label={isExpanded ? 'Ocultar contatos' : 'Mostrar contatos'}
                          onClick={() => toggleExpanded(s.id)}
                          disabled={contactsBySupplier.isLoading}
                          style={{ padding: '4px 8px', fontSize: 12 }}
                        >
                          {isExpanded ? '−' : '+'}
                        </button>
                      </td>
                      <td><strong>{s.name}</strong></td>
                      <td>{s.country ?? '—'}</td>
                              <td>
                                {s.acceptedIncoterms.length > 0
                                  ? s.acceptedIncoterms.join(', ')
                                  : '—'}
                              </td>
                              <td>
                                {primary
                                  ? `${primary.name} <${primary.email}>`
                                  : supplierContacts.length > 0
                                    ? '—'
                                    : '—'}
                              </td>
                              <td>
                                <span
                                  className={`badge ${
                                    s.status === 'active'
                                      ? ''
                                      : s.status === 'blocked'
                                        ? 'badge--danger'
                                        : 'badge--muted'
                                  }`}
                                >
                                  {s.status === 'active'
                                    ? 'Ativo'
                                    : s.status === 'blocked'
                                      ? 'Bloqueado'
                                      : 'Inativo'}
                                </span>
                              </td>
                              <td>
                                <div className="row-actions">
                                  <button
                                    type="button"
                                    className="ghost-button"
                                    onClick={() => openEdit(s)}
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost-button danger-button"
                                    onClick={() => {
                                      if (window.confirm(`Remover ${s.name}? Esta ação não pode ser desfeita.`)) {
                                        remove.mutate(s.id);
                                      }
                                    }}
                                  >
                                    Remover
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${s.id}-contacts`}>
                                <td colSpan={7} style={{ background: 'var(--surface-alt)', padding: 12 }}>
                                  <div className="page-header" style={{ marginBottom: 8 }}>
                                    <h3 style={{ margin: 0 }}>Contatos</h3>
                                    <button
                                      type="button"
                                      className="ghost-button"
                                      onClick={() => openNewContact(s.id)}
                                    >
                                      + Adicionar contato
                                    </button>
                                  </div>
                                  {contactsQuery.isLoading && contactsQuery.data === undefined ? (
                                    <p>Carregando contatos…</p>
                                  ) : supplierContacts.length === 0 ? (
                                    <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>
                                      Nenhum contato cadastrado. Adicione ao menos um para poder
                                      enviar cotacoes para este fornecedor.
                                    </p>
                                  ) : (
                                    <div className="contact-list">
                                      {supplierContacts.map((c) => (
                                        <div key={c.id} className="contact-row">
                                          <input
                                            type="checkbox"
                                            checked={c.isPrimary}
                                            disabled
                                            aria-label="Contato principal"
                                          />
                                          <div>
                                            <div className="contact-row__name">
                                              {c.name}
                                              {c.isPrimary && (
                                                <span
                                                  className="badge"
                                                  style={{ marginLeft: 8, fontSize: 10 }}
                                                >
                                                  Principal
                                                </span>
                                              )}
                                            </div>
                                            <div className="contact-row__meta">
                                              {c.email}
                                              {c.phone ? ` · ${c.phone}` : ''}
                                              {c.position ? ` · ${c.position}` : ''}
                                            </div>
                                          </div>
                                          <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                                            {new Date(c.updatedAt).toLocaleDateString('pt-BR')}
                                          </span>
                                          <div className="contact-row__actions">
                                            <button
                                              type="button"
                                              className="ghost-button"
                                              onClick={() => openEditContact(s.id, c)}
                                            >
                                              Editar
                                            </button>
                                            <button
                                              type="button"
                                              className="ghost-button"
                                              onClick={() => {
                                                if (window.confirm(`Remover ${c.name}?`)) {
                                                  removeContact.mutate({
                                                    supplierId: s.id,
                                                    contactId: c.id,
                                                  });
                                                }
                                              }}
                                              disabled={removeContact.isPending}
                                            >
                                              Remover
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                )}
      </section>

      {showContactForm && expandedSupplierId !== null && (
        <div className="modal-backdrop" onClick={closeContactForm}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleContactSubmit}
          >
            <h2>{editingContact ? 'Editar contato' : 'Novo contato'}</h2>
            <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: -8 }}>
              Fornecedor: <strong>{list.data?.find((s) => s.id === expandedSupplierId)?.name ?? `Fornecedor #${expandedSupplierId}`}</strong>
            </p>

            <label className="field-label" htmlFor="contactName">Nome *</label>
            <input
              id="contactName"
              className="input"
              value={contactForm.name}
              onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
              required
            />

            <label className="field-label" htmlFor="contactEmail" style={{ marginTop: 12 }}>
              E-mail *
            </label>
            <input
              id="contactEmail"
              className="input"
              type="email"
              value={contactForm.email}
              onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
              required
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div>
                <label className="field-label" htmlFor="contactPhone">Telefone</label>
                <input
                  id="contactPhone"
                  className="input"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="contactPosition">Cargo</label>
                <input
                  id="contactPosition"
                  className="input"
                  value={contactForm.position}
                  onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })}
                />
              </div>
            </div>

            <label className="checkbox-field" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={contactForm.isPrimary}
                onChange={(e) => setContactForm({ ...contactForm, isPrimary: e.target.checked })}
              />
              Marcar como contato principal
            </label>

            {contactError && (
              <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>
                {contactError}
              </p>
            )}

            <div className="modal__actions">
              <button type="button" className="ghost-button" onClick={closeContactForm}>
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={createContact.isPending || updateContact.isPending}
              >
                {editingContact ? 'Salvar alteracoes' : 'Adicionar contato'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <h2>{editing ? 'Editar fornecedor' : 'Novo fornecedor'}</h2>

            <label className="field-label" htmlFor="name">Nome *</label>
            <input
              id="name"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />

            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Cadastre os contatos do fornecedor logo abaixo — cada contato possui seu próprio
              e-mail, que sera usado para o envio das cotacoes.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div>
                <label className="field-label" htmlFor="website">Website</label>
                <input
                  id="website"
                  className="input"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="country">País</label>
                <input
                  id="country"
                  className="input"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              </div>
            </div>

            <label className="field-label" htmlFor="status" style={{ marginTop: 12 }}>Status</label>
            <select
              id="status"
              className="select"
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as SupplierFormState['status'] })
              }
            >
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
              <option value="blocked">Bloqueado</option>
            </select>

            <label className="field-label" htmlFor="paymentTermsDays" style={{ marginTop: 12 }}>
              Prazo de pagamento (dias)
            </label>
            <input
              id="paymentTermsDays"
              className="input"
              type="number"
              min={0}
              max={365}
              value={form.paymentTermsDays}
              onChange={(e) =>
                setForm({
                  ...form,
                  paymentTermsDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)),
                })
              }
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Pré-preenchido no portal do fornecedor ao enviar a cotação.
            </p>

            <label className="field-label" style={{ marginTop: 12 }}>
              Incoterms aceitos
            </label>
            <div className="chip-row">
              {INCOTERMS.map((term) => {
                const active = form.acceptedIncoterms.includes(term);
                return (
                  <button
                    key={term}
                    type="button"
                    className={`chip${active ? ' chip--active' : ''}`}
                    onClick={() => toggleIncoterm(term)}
                  >
                    {term}
                  </button>
                );
              })}
            </div>

            <label className="field-label" htmlFor="notes" style={{ marginTop: 12 }}>Observações</label>
            <textarea
              id="notes"
              className="textarea"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />

            {formError && (
              <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>
                {formError}
              </p>
            )}

            <div className="modal__actions">
              <button type="button" className="ghost-button" onClick={closeForm}>
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={create.isPending || update.isPending}
              >
                {editing ? 'Salvar alterações' : 'Cadastrar'}
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
