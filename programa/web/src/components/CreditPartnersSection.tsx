import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Modal } from '@/components/Modal';
import { useConfirm } from '@/components/useConfirm';
import { Icon } from '@/components/icons';
import {
  CreditPartner,
  CreditPartnerInput,
  createCreditPartner,
  deleteCreditPartner,
  listCreditPartners,
  updateCreditPartner,
} from '@/services/creditPartners';

interface ContactDraft {
  key: string;
  id?: number;
  name: string;
  email: string;
  phone: string;
  position: string;
}

interface PartnerDraft {
  name: string;
  taxId: string;
  website: string;
  country: string;
  notes: string;
  isActive: boolean;
  contacts: ContactDraft[];
  primaryKey: string;
}

const QUERY_KEY = ['credit-partners'] as const;
const MAX_CONTACTS = 20;

let contactKeySeq = 0;
function nextContactKey(): string {
  contactKeySeq += 1;
  return `contact-${contactKeySeq}`;
}

function emptyContact(): ContactDraft {
  return { key: nextContactKey(), name: '', email: '', phone: '', position: '' };
}

function emptyDraft(): PartnerDraft {
  const first = emptyContact();
  return {
    name: '',
    taxId: '',
    website: '',
    country: '',
    notes: '',
    isActive: true,
    contacts: [first],
    primaryKey: first.key,
  };
}

function draftFromPartner(partner: CreditPartner): PartnerDraft {
  const contacts: ContactDraft[] = partner.contacts.map((contact) => ({
    key: nextContactKey(),
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone ?? '',
    position: contact.position ?? '',
  }));
  const primaryIndex = Math.max(
    0,
    partner.contacts.findIndex((contact) => contact.isPrimary),
  );
  if (contacts.length === 0) contacts.push(emptyContact());
  return {
    name: partner.name,
    taxId: partner.taxId ?? '',
    website: partner.website ?? '',
    country: partner.country ?? '',
    notes: partner.notes ?? '',
    isActive: partner.isActive,
    contacts,
    primaryKey: (contacts[primaryIndex] ?? contacts[0])?.key ?? '',
  };
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function buildPayload(draft: PartnerDraft): CreditPartnerInput {
  return {
    name: draft.name.trim(),
    taxId: toNullable(draft.taxId),
    website: toNullable(draft.website),
    country: toNullable(draft.country),
    notes: toNullable(draft.notes),
    isActive: draft.isActive,
    contacts: draft.contacts.map((contact) => ({
      ...(contact.id !== undefined ? { id: contact.id } : {}),
      name: contact.name.trim(),
      email: contact.email.trim(),
      phone: toNullable(contact.phone),
      position: toNullable(contact.position),
      isPrimary: contact.key === draft.primaryKey,
    })),
  };
}

function validateDraft(draft: PartnerDraft): string | null {
  if (draft.name.trim().length === 0) return 'Informe o nome do parceiro.';
  if (draft.contacts.length === 0) return 'Informe ao menos um contato.';
  const seen = new Set<string>();
  for (const contact of draft.contacts) {
    if (contact.name.trim().length === 0) return 'Informe o nome de todos os contatos.';
    if (!isLikelyEmail(contact.email)) return `E-mail inválido: ${contact.email || '(vazio)'}.`;
    const email = contact.email.trim().toLowerCase();
    if (seen.has(email)) return 'Há e-mails duplicados entre os contatos.';
    seen.add(email);
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

export function CreditPartnersSection() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const canWrite = ['admin', 'gestor'].includes(user?.role ?? '');

  const partners = useQuery({ queryKey: QUERY_KEY, queryFn: () => listCreditPartners() });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PartnerDraft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (payload: CreditPartnerInput) =>
      editingId === null ? createCreditPartner(payload) : updateCreditPartner(editingId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
      closeModal();
    },
    onError: (err) => setFormError(messageOf(err)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteCreditPartner(id),
    onSuccess: () => {
      setActionError(null);
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => setActionError(messageOf(err)),
  });

  const rows = partners.data ?? [];
  const activeCount = rows.filter((partner) => partner.isActive).length;

  function openCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(partner: CreditPartner) {
    setEditingId(partner.id);
    setDraft(draftFromPartner(partner));
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setFormError(null);
  }

  function updateField<K extends keyof PartnerDraft>(field: K, value: PartnerDraft[K]) {
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
    setDraft((current) => {
      if (current.contacts.length <= 1) return current;
      const contacts = current.contacts.filter((contact) => contact.key !== key);
      return {
        ...current,
        contacts,
        primaryKey: current.primaryKey === key ? (contacts[0]?.key ?? '') : current.primaryKey,
      };
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validateDraft(draft);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    save.mutate(buildPayload(draft));
  }

  async function handleDelete(partner: CreditPartner) {
    const ok = await confirm({
      title: 'Excluir parceiro de crédito',
      message: `Excluir ${partner.name}? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      tone: 'danger',
    });
    if (ok) remove.mutate(partner.id);
  }

  return (
    <section className="card parceiros-credito" aria-labelledby="credit-partners-title">
      <div className="parceiros-credito__cabecalho">
        <div className="parceiros-credito__titulos">
          <h2 id="credit-partners-title" className="parceiros-credito__titulo">
            Parceiros de crédito (Credit Support)
          </h2>
          <p className="parceiros-credito__subtitulo">
            Empresas que podem oferecer prazo de pagamento estendido sobre a proposta de um fornecedor.
          </p>
        </div>
        {canWrite && (
          <button type="button" className="primary-button" onClick={openCreate}>
            <Icon name="plus" size={16} strokeWidth={2.2} />
            Novo parceiro
          </button>
        )}
      </div>

      {!canWrite && (
        <p className="parceiros-credito__aviso">
          Apenas consulta - seu perfil não pode alterar os parceiros de crédito.
        </p>
      )}

      {actionError && (
        <p role="alert" className="alert alert--error parceiros-credito__alerta">
          {actionError}
        </p>
      )}

      {partners.isLoading && (
        <p className="parceiros-credito__carregando" role="status">
          <span className="btn-spinner" aria-hidden="true" />
          Carregando parceiros…
        </p>
      )}

      {partners.isError && (
        <p role="alert" className="alert alert--error parceiros-credito__alerta">
          Não foi possível carregar os parceiros de crédito: {messageOf(partners.error)}
        </p>
      )}

      {!partners.isLoading && !partners.isError && rows.length === 0 && (
        <p className="parceiros-credito__vazio">
          Nenhum parceiro de crédito cadastrado.
        </p>
      )}

      {rows.length > 0 && (
        <div className="table-wrapper parceiros-credito__tabela">
          <table className="table parceiros-credito__grade">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Contato principal</th>
                <th className="col-status">Status</th>
                {canWrite && (
                  <th className="parceiros-credito__acoes-cab">
                    <span className="sr-only">Ações</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((partner) => {
                const primary = partner.contacts.find((contact) => contact.isPrimary);
                const isDefault = activeCount === 1 && partner.isActive;
                return (
                  <tr key={partner.id}>
                    <td>
                      <span className="parceiro-credito__nome">
                        <strong>{partner.name}</strong>
                        {isDefault && (
                          <span className="badge badge--info parceiro-credito__padrao">
                            Padrão
                          </span>
                        )}
                      </span>
                      {partner.country && (
                        <span className="parceiro-credito__pais">
                          {partner.country}
                        </span>
                      )}
                    </td>
                    <td
                      className="cell-truncate parceiro-credito__contato"
                      title={primary ? `${primary.name} <${primary.email}>` : undefined}
                    >
                      {primary ? (
                        <>
                          {`${primary.name} · `}
                          <span className="parceiro-credito__email">{primary.email}</span>
                        </>
                      ) : '—'}
                    </td>
                    <td className="col-status">
                      <span className={`badge badge--dot ${partner.isActive ? '' : 'badge--muted'}`}>
                        {partner.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="parceiro-credito__acoes">
                        <div className="row-actions row-actions--nowrap">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => openEdit(partner)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="ghost-button danger-button"
                            onClick={() => void handleDelete(partner)}
                            disabled={remove.isPending}
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingId === null ? 'Novo parceiro de crédito' : 'Editar parceiro de crédito'}
        size="wide"
      >
        <form onSubmit={handleSubmit}>
          <div className="parceiro-credito-form">
            <div className="parceiro-credito-grade">
              <div className="parceiro-credito-campo parceiro-credito-campo--cheio">
                <label className="field-label" htmlFor="cp-name">Nome *</label>
                <input
                  id="cp-name"
                  className="input"
                  value={draft.name}
                  maxLength={200}
                  onChange={(e) => updateField('name', e.target.value)}
                  required
                />
              </div>
              <div className="parceiro-credito-campo">
                <label className="field-label" htmlFor="cp-taxId">CNPJ / Tax ID</label>
                <input
                  id="cp-taxId"
                  className="input parceiro-credito-campo__mono"
                  value={draft.taxId}
                  onChange={(e) => updateField('taxId', e.target.value)}
                />
              </div>
              <div className="parceiro-credito-campo">
                <label className="field-label" htmlFor="cp-country">País</label>
                <input
                  id="cp-country"
                  className="input"
                  value={draft.country}
                  onChange={(e) => updateField('country', e.target.value)}
                />
              </div>
              <div className="parceiro-credito-campo parceiro-credito-campo--cheio">
                <label className="field-label" htmlFor="cp-website">Website</label>
                <input
                  id="cp-website"
                  className="input"
                  value={draft.website}
                  onChange={(e) => updateField('website', e.target.value)}
                />
              </div>
              <div className="parceiro-credito-campo parceiro-credito-campo--cheio">
                <label className="field-label" htmlFor="cp-notes">Observações</label>
                <textarea
                  id="cp-notes"
                  className="input"
                  rows={2}
                  value={draft.notes}
                  onChange={(e) => updateField('notes', e.target.value)}
                />
              </div>
            </div>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => updateField('isActive', e.target.checked)}
              />
              Parceiro ativo
            </label>

            <h3 className="parceiro-credito-titulo">Contatos</h3>
            {draft.contacts.map((contact, index) => (
              <fieldset key={contact.key} className="parceiro-credito-contato">
                <legend>
                  Contato {index + 1}
                </legend>
                <div className="parceiro-credito-contato__grade">
                  <div className="parceiro-credito-campo">
                    <label className="field-label" htmlFor={`${contact.key}-name`}>Nome *</label>
                    <input
                      id={`${contact.key}-name`}
                      className="input"
                      value={contact.name}
                      onChange={(e) => updateContact(contact.key, { name: e.target.value })}
                    />
                  </div>
                  <div className="parceiro-credito-campo">
                    <label className="field-label" htmlFor={`${contact.key}-email`}>E-mail *</label>
                    <input
                      id={`${contact.key}-email`}
                      className="input"
                      type="email"
                      value={contact.email}
                      onChange={(e) => updateContact(contact.key, { email: e.target.value })}
                    />
                  </div>
                  <div className="parceiro-credito-campo">
                    <label className="field-label" htmlFor={`${contact.key}-phone`}>Telefone</label>
                    <input
                      id={`${contact.key}-phone`}
                      className="input parceiro-credito-campo__mono"
                      value={contact.phone}
                      onChange={(e) => updateContact(contact.key, { phone: e.target.value })}
                    />
                  </div>
                  <div className="parceiro-credito-campo">
                    <label className="field-label" htmlFor={`${contact.key}-position`}>Cargo</label>
                    <input
                      id={`${contact.key}-position`}
                      className="input"
                      value={contact.position}
                      onChange={(e) => updateContact(contact.key, { position: e.target.value })}
                    />
                  </div>
                </div>
                <div className="parceiro-credito-contato__rodape">
                  <label className="checkbox-field">
                    <input
                      type="radio"
                      name="cp-primary-contact"
                      checked={draft.primaryKey === contact.key}
                      onChange={() => updateField('primaryKey', contact.key)}
                    />
                    Contato principal
                  </label>
                  {draft.contacts.length > 1 && (
                    <button
                      type="button"
                      className="ghost-button danger-button"
                      onClick={() => removeContact(contact.key)}
                    >
                      Remover contato
                    </button>
                  )}
                </div>
              </fieldset>
            ))}
            <div>
              <button
                type="button"
                className="ghost-button parceiro-credito-adicionar"
                onClick={addContact}
                disabled={draft.contacts.length >= MAX_CONTACTS}
              >
                <Icon name="plus" size={16} strokeWidth={2.2} />
                Adicionar contato
              </button>
            </div>

            {formError && (
              <p role="alert" className="parceiro-credito-erro">
                {formError}
              </p>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={closeModal}>
              Cancelar
            </button>
            <button type="submit" className="primary-button" disabled={save.isPending}>
              {save.isPending ? 'Salvando…' : 'Salvar parceiro'}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
