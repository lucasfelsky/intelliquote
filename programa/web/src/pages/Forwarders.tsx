import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Modal } from '@/components/Modal';
import { useConfirm } from '@/components/useConfirm';
import {
  Forwarder,
  ForwarderInput,
  createForwarder,
  deleteForwarder,
  listForwarders,
  updateForwarder,
} from '@/services/forwarders';

interface ContactDraft {
  key: string;
  id?: number;
  name: string;
  email: string;
  phone: string;
}

interface ForwarderDraft {
  companyName: string;
  address: string;
  website: string;
  notes: string;
  isActive: boolean;
  isDefault: boolean;
  contacts: ContactDraft[];
}

const QUERY_KEY = ['forwarders'] as const;
const MAX_CONTACTS = 20;

let contactKeySeq = 0;
function nextContactKey(): string {
  contactKeySeq += 1;
  return `fw-contact-${contactKeySeq}`;
}

function emptyContact(): ContactDraft {
  return { key: nextContactKey(), name: '', email: '', phone: '' };
}

function emptyDraft(): ForwarderDraft {
  return {
    companyName: '',
    address: '',
    website: '',
    notes: '',
    isActive: true,
    isDefault: false,
    contacts: [emptyContact()],
  };
}

function draftFromForwarder(forwarder: Forwarder): ForwarderDraft {
  const contacts: ContactDraft[] = forwarder.contacts.map((contact) => ({
    key: nextContactKey(),
    id: contact.id,
    name: contact.name,
    email: contact.email ?? '',
    phone: contact.phone ?? '',
  }));
  if (contacts.length === 0) contacts.push(emptyContact());
  return {
    companyName: forwarder.companyName,
    address: forwarder.address ?? '',
    website: forwarder.website ?? '',
    notes: forwarder.notes ?? '',
    isActive: forwarder.isActive,
    isDefault: forwarder.isDefault,
    contacts,
  };
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function buildPayload(draft: ForwarderDraft): ForwarderInput {
  return {
    companyName: draft.companyName.trim(),
    address: toNullable(draft.address),
    website: toNullable(draft.website),
    notes: toNullable(draft.notes),
    isActive: draft.isActive,
    isDefault: draft.isActive && draft.isDefault,
    contacts: draft.contacts.map((contact) => ({
      ...(contact.id !== undefined ? { id: contact.id } : {}),
      name: contact.name.trim(),
      email: toNullable(contact.email),
      phone: toNullable(contact.phone),
    })),
  };
}

function validateDraft(draft: ForwarderDraft): string | null {
  if (draft.companyName.trim().length === 0) return 'Informe o nome da empresa.';
  if (draft.contacts.length === 0) return 'Informe ao menos um contato.';
  const seen = new Set<string>();
  for (const contact of draft.contacts) {
    if (contact.name.trim().length === 0) return 'Informe o nome de todos os contatos.';
    const email = contact.email.trim();
    if (email.length === 0) continue;
    if (!isLikelyEmail(email)) return `E-mail inválido: ${email}.`;
    const normalized = email.toLowerCase();
    if (seen.has(normalized)) return 'Há e-mails duplicados entre os contatos.';
    seen.add(normalized);
  }
  return null;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}

export default function Forwarders() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const canWrite = ['admin', 'comprador'].includes(user?.role ?? '');

  const forwarders = useQuery({ queryKey: QUERY_KEY, queryFn: () => listForwarders() });

  const [modalOpen, setModalOpen] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ForwarderDraft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (payload: ForwarderInput) =>
      editingId === null ? createForwarder(payload) : updateForwarder(editingId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
      closeModal();
    },
    onError: (err) => setFormError(messageOf(err)),
  });

  const makeDefault = useMutation({
    mutationFn: (id: number) => updateForwarder(id, { isDefault: true }),
    onSuccess: () => {
      setActionError(null);
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => setActionError(messageOf(err)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteForwarder(id),
    onSuccess: () => {
      setActionError(null);
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => setActionError(messageOf(err)),
  });

  const rows = forwarders.data ?? [];

  function openCreate() {
    setEditingId(null);
    setReadOnly(false);
    setDraft(emptyDraft());
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(forwarder: Forwarder, view = false) {
    setEditingId(forwarder.id);
    setReadOnly(view);
    setDraft(draftFromForwarder(forwarder));
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setReadOnly(false);
    setFormError(null);
  }

  function updateField<K extends keyof ForwarderDraft>(field: K, value: ForwarderDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateContact(key: string, patch: Partial<ContactDraft>) {
    setDraft((current) => ({
      ...current,
      contacts: current.contacts.map((contact) =>
        contact.key === key ? { ...contact, ...patch } : contact,
      ),
    }));
  }

  function addContact() {
    setDraft((current) =>
      current.contacts.length >= MAX_CONTACTS
        ? current
        : { ...current, contacts: [...current.contacts, emptyContact()] },
    );
  }

  function removeContact(key: string) {
    setDraft((current) =>
      current.contacts.length <= 1
        ? current
        : { ...current, contacts: current.contacts.filter((contact) => contact.key !== key) },
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    const problem = validateDraft(draft);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    save.mutate(buildPayload(draft));
  }

  async function handleDelete(forwarder: Forwarder) {
    const ok = await confirm({
      title: 'Excluir forwarder',
      message: `Excluir ${forwarder.companyName}? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      tone: 'danger',
    });
    if (ok) remove.mutate(forwarder.id);
  }

  function contactsSummary(forwarder: Forwarder): string {
    const [first] = forwarder.contacts;
    if (!first) return '—';
    const extra = forwarder.contacts.length - 1;
    return extra > 0 ? `${first.name} +${extra}` : first.name;
  }

  const modalTitle = readOnly
    ? 'Forwarder'
    : editingId === null
      ? 'Novo forwarder'
      : 'Editar forwarder';

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Cadastros</p>
          <h1>Forwarders</h1>
          <p className="page-subtitle">Agentes de carga usados no e-mail da Ordem de Compra.</p>
        </div>
        {canWrite && (
          <button type="button" className="primary-button" onClick={openCreate}>
            + Novo forwarder
          </button>
        )}
      </header>

      <section className="card" aria-label="Lista de forwarders">
        {!canWrite && (
          <p className="text-sm" style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
            Apenas consulta - seu perfil não pode alterar os forwarders.
          </p>
        )}

        {actionError && (
          <p role="alert" style={{ color: 'var(--danger)', marginTop: 0 }} className="text-sm">
            {actionError}
          </p>
        )}

        {forwarders.isLoading && (
          <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
            Carregando forwarders…
          </p>
        )}

        {forwarders.isError && (
          <p role="alert" style={{ color: 'var(--danger)' }} className="text-sm">
            Não foi possível carregar os forwarders: {messageOf(forwarders.error)}
          </p>
        )}

        {!forwarders.isLoading && !forwarders.isError && rows.length === 0 && (
          <div className="empty-state">
            <strong>Nenhum forwarder cadastrado</strong>
            <p>Cadastre o primeiro para preencher o contato do despachante no envio da PO.</p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="table-wrapper">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Endereço</th>
                  <th>Contatos</th>
                  <th className="col-status">Status</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((forwarder) => (
                  <tr key={forwarder.id}>
                    <td>
                      <strong>{forwarder.companyName}</strong>
                      {forwarder.isDefault && (
                        <span className="badge" style={{ marginLeft: 8 }}>
                          Padrão
                        </span>
                      )}
                    </td>
                    <td className="cell-truncate" title={forwarder.address ?? undefined}>
                      {forwarder.address ?? '—'}
                    </td>
                    <td>{contactsSummary(forwarder)}</td>
                    <td className="col-status">
                      <span className={`badge ${forwarder.isActive ? '' : 'badge--muted'}`}>
                        {forwarder.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions row-actions--nowrap">
                        {canWrite ? (
                          <>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => openEdit(forwarder)}
                            >
                              Editar
                            </button>
                            {forwarder.isActive && !forwarder.isDefault && (
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => makeDefault.mutate(forwarder.id)}
                                disabled={makeDefault.isPending}
                              >
                                Definir como padrão
                              </button>
                            )}
                            <button
                              type="button"
                              className="ghost-button danger-button"
                              onClick={() => void handleDelete(forwarder)}
                              disabled={remove.isPending}
                            >
                              Excluir
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => openEdit(forwarder, true)}
                          >
                            Ver
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal isOpen={modalOpen} onClose={closeModal} title={modalTitle} size="wide">
        <form onSubmit={handleSubmit}>
          <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="form-grid">
              <div className="form-grid__full">
                <label className="field-label" htmlFor="fw-company">Empresa *</label>
                <input
                  id="fw-company"
                  className="input"
                  value={draft.companyName}
                  maxLength={200}
                  onChange={(e) => updateField('companyName', e.target.value)}
                  required
                />
              </div>
              <div className="form-grid__full">
                <label className="field-label" htmlFor="fw-address">Endereço</label>
                <textarea
                  id="fw-address"
                  className="textarea"
                  rows={2}
                  maxLength={500}
                  value={draft.address}
                  onChange={(e) => updateField('address', e.target.value)}
                />
              </div>
              <div className="form-grid__full">
                <label className="field-label" htmlFor="fw-website">Website</label>
                <input
                  id="fw-website"
                  className="input"
                  value={draft.website}
                  placeholder="https://"
                  onChange={(e) => updateField('website', e.target.value)}
                />
              </div>
              <div className="form-grid__full">
                <label className="field-label" htmlFor="fw-notes">Observações</label>
                <textarea
                  id="fw-notes"
                  className="textarea"
                  rows={2}
                  maxLength={2000}
                  value={draft.notes}
                  onChange={(e) => updateField('notes', e.target.value)}
                />
                <p className="text-sm" style={{ color: 'var(--ink-soft)', margin: '4px 0 0' }}>
                  Uso interno; não vai no e-mail.
                </p>
              </div>
            </div>

            <label className="checkbox-field" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    isActive: e.target.checked,
                    isDefault: e.target.checked ? current.isDefault : false,
                  }))
                }
              />
              Forwarder ativo
            </label>
            <label className="checkbox-field" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={draft.isDefault}
                disabled={!draft.isActive}
                onChange={(e) => updateField('isDefault', e.target.checked)}
              />
              Padrão no envio da PO
            </label>

            <h3 style={{ margin: '18px 0 8px', fontSize: 15 }}>Contatos</h3>
            {draft.contacts.map((contact, index) => (
              <fieldset
                key={contact.key}
                style={{
                  border: '1px solid var(--border, #dde3ea)',
                  borderRadius: 8,
                  padding: 12,
                  margin: '0 0 10px',
                  minWidth: 0,
                }}
              >
                <legend className="text-sm" style={{ padding: '0 6px' }}>
                  Contato {index + 1}
                </legend>
                <div className="form-grid">
                  <div>
                    <label className="field-label" htmlFor={`${contact.key}-name`}>Nome *</label>
                    <input
                      id={`${contact.key}-name`}
                      className="input"
                      value={contact.name}
                      maxLength={200}
                      onChange={(e) => updateContact(contact.key, { name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`${contact.key}-email`}>E-mail</label>
                    <input
                      id={`${contact.key}-email`}
                      className="input"
                      type="email"
                      value={contact.email}
                      onChange={(e) => updateContact(contact.key, { email: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`${contact.key}-phone`}>Telefone</label>
                    <input
                      id={`${contact.key}-phone`}
                      className="input"
                      value={contact.phone}
                      maxLength={40}
                      onChange={(e) => updateContact(contact.key, { phone: e.target.value })}
                    />
                  </div>
                </div>
                {!readOnly && draft.contacts.length > 1 && (
                  <div style={{ marginTop: 8, textAlign: 'right' }}>
                    <button
                      type="button"
                      className="ghost-button danger-button"
                      onClick={() => removeContact(contact.key)}
                    >
                      Remover contato
                    </button>
                  </div>
                )}
              </fieldset>
            ))}
            {!readOnly && (
              <button
                type="button"
                className="ghost-button"
                onClick={addContact}
                disabled={draft.contacts.length >= MAX_CONTACTS}
              >
                Adicionar contato
              </button>
            )}
          </fieldset>

          {formError && (
            <p role="alert" style={{ color: 'var(--danger)', marginTop: 12 }} className="text-sm">
              {formError}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={closeModal}>
              {readOnly ? 'Fechar' : 'Cancelar'}
            </button>
            {!readOnly && (
              <button type="submit" className="primary-button" disabled={save.isPending}>
                {save.isPending ? 'Salvando…' : 'Salvar forwarder'}
              </button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}
