import { useConfirm } from '@/components/useConfirm';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import StarRating from '@/components/StarRating';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import SupplierImportModal from '@/components/SupplierImportModal';
import { SupplierDocumentsSection } from '@/components/SupplierDocumentsSection';
import { getSupplierDocumentsSummary } from '@/services/supplierDocuments';
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

interface SupplierReviewStats {
  count: number;
  avgPrice: number | null;
  avgLeadTime: number | null;
  avgQuality: number | null;
  avgRating: number | null;
}

interface ItemFamilyOption {
  id: number;
  name: string;
}

interface Supplier {
  id: number;
  name: string;
  website?: string | null;
  status: 'active' | 'inactive' | 'blocked';
  country?: string | null;
  notes?: string | null;
  acceptedIncoterms: string[];
  paymentTermsDays?: number | null;
  tags: string[];
  reviewStats?: SupplierReviewStats | null;
  families: ItemFamilyOption[];
}

interface SupplierFormState {
  name: string;
  website: string;
  country: string;
  notes: string;
  status: 'active' | 'inactive' | 'blocked';
  acceptedIncoterms: string[];
  paymentTermsDays: number;
  tags: string[];
  familyIds: number[];
}

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

// Fornecedor que aceita todos os Incoterms (nenhum chip marcado no modal).
const coversAllIncoterms = (list: string[]) => INCOTERMS.every((t) => list.includes(t));

const emptyForm: SupplierFormState = {
  name: '',
  website: '',
  country: '',
  notes: '',
  status: 'active',
  acceptedIncoterms: [],
  paymentTermsDays: 30,
  tags: [],
  familyIds: [],
};

function normalizeReviewStats(value: unknown): SupplierReviewStats | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    count: typeof obj.count === 'number' ? obj.count : 0,
    avgPrice: num(obj.avgPrice),
    avgLeadTime: num(obj.avgLeadTime),
    avgQuality: num(obj.avgQuality),
    avgRating: num(obj.avgRating),
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asFamilyArray(value: unknown): ItemFamilyOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((v) => ({ id: Number(v.id), name: String(v.name ?? '') }))
    .filter((f) => Number.isFinite(f.id));
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
    tags: asStringArray(obj.tags),
    reviewStats: normalizeReviewStats(obj.reviewStats),
    families: asFamilyArray(obj.families),
  };
}

export default function Fornecedores() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierFormState>(emptyForm);
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  // F12: input livre de tag no form + filtro por tag na lista.
  const [tagInput, setTagInput] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

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

  // Familias ATIVAS disponiveis pro bloco de chips do form.
  const familiesQuery = useQuery({
    queryKey: ['item-families'],
    queryFn: async () => {
      const data = await api.get<{ data?: unknown[] }>('/api/v1/item-families');
      return asFamilyArray(data?.data ?? []);
    },
  });

  // Guarda contra perda silenciosa: a lista de chips do form e' a UNIAO das
  // familias ATIVAS + as JA VINCULADAS ao fornecedor em edicao (mesmo se
  // inativas), senao um re-save sem ve-las no form as desvincularia (o
  // update usa `set`). Ao cadastrar um fornecedor novo, so entram as ativas.
  const familyOptions = useMemo(() => {
    const options = new Map<number, ItemFamilyOption>();
    for (const f of familiesQuery.data ?? []) options.set(f.id, f);
    for (const f of editing?.families ?? []) if (!options.has(f.id)) options.set(f.id, f);
    return Array.from(options.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [familiesQuery.data, editing]);

  // F12: universo de tags (pra barra de filtro) + lista filtrada por tag.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of list.data ?? []) for (const t of s.tags) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [list.data]);

  const displayedSuppliers = useMemo(() => {
    const data = list.data ?? [];
    return tagFilter ? data.filter((s) => s.tags.includes(tagFilter)) : data;
  }, [list.data, tagFilter]);

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

  // Resumo de documentos por fornecedor (indicador na lista). Defensivo: qualquer forma
  // diferente de `{ bySupplier }` vira mapa vazio.
  const documentsSummary = useQuery({
    queryKey: ['supplier-documents-summary'],
    queryFn: getSupplierDocumentsSummary,
  });
  const documentsSummaryBySupplier = documentsSummary.data ?? {};

  // Deep link `/fornecedores?supplier=<id>` (link do e-mail de aviso): le o parametro uma
  // vez, expande a linha quando a lista traz o id e rola ate ela.
  const deepLinkHandledRef = useRef(false);
  const pendingScrollRef = useRef<number | null>(null);
  useEffect(() => {
    if (deepLinkHandledRef.current || !list.data) return;
    deepLinkHandledRef.current = true;
    const raw = new URLSearchParams(window.location.search).get('supplier');
    const id = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
    if (id !== null && list.data.some((s) => s.id === id)) {
      pendingScrollRef.current = id;
      setExpandedSupplierId(id);
    }
  }, [list.data]);
  useEffect(() => {
    if (expandedSupplierId === null || pendingScrollRef.current !== expandedSupplierId) return;
    pendingScrollRef.current = null;
    document.getElementById(`supplier-row-${expandedSupplierId}`)?.scrollIntoView?.({
      block: 'start',
    });
  }, [expandedSupplierId]);

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
        tags: payload.tags,
        familyIds: payload.familyIds,
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
        tags: payload.tags,
        familyIds: payload.familyIds,
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
      acceptedIncoterms: coversAllIncoterms(supplier.acceptedIncoterms)
        ? []
        : supplier.acceptedIncoterms,
      paymentTermsDays: supplier.paymentTermsDays ?? 30,
      tags: supplier.tags ?? [],
      familyIds: (supplier.families ?? []).map((f) => f.id),
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

  function toggleFamily(id: number) {
    setForm((current) => {
      const has = current.familyIds.includes(id);
      return {
        ...current,
        familyIds: has
          ? current.familyIds.filter((f) => f !== id)
          : [...current.familyIds, id],
      };
    });
  }

  // F12: edicao de tags (etiquetas livres). Dedup case-insensitive.
  function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    setForm((current) => {
      if (current.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return current;
      return { ...current, tags: [...current.tags, tag] };
    });
  }

  function removeTag(tag: string) {
    setForm((current) => ({ ...current, tags: current.tags.filter((t) => t !== tag) }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Informe o nome do fornecedor.');
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

  const isContactModalOpen = showContactForm && expandedSupplierId !== null;
  const contactSupplierName =
    expandedSupplierId === null
      ? ''
      : list.data?.find((s) => s.id === expandedSupplierId)?.name ?? `Fornecedor #${expandedSupplierId}`;

  return (
    <div className="page fornecedores-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Cadastros</p>
          <h1>Fornecedores</h1>
          <p className="page-subtitle">Gerencie a base de fornecedores, Incoterms aceitos e status.</p>
        </div>
        <div className="page-header__actions">
          <div className="fornecedores-busca">
            <Icon name="search" size={16} strokeWidth={1.9} />
          <input
              className="fornecedores-busca__campo"
            placeholder="Buscar por nome ou país"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          </div>
          <button type="button" className="ghost-button" onClick={() => setIsImportOpen(true)}>
            <Icon name="upload" size={16} strokeWidth={1.9} />
            Importar planilha
          </button>
          <button type="button" className="primary-button" onClick={openNew}>
            <Icon name="plus" size={16} strokeWidth={2.2} />
            Novo fornecedor
          </button>
        </div>
      </header>

      <section className="card fornecedores-lista" aria-label="Lista de fornecedores">
        {list.isLoading && <p className="fornecedores-carregando">Carregando fornecedores…</p>}
        {list.isError && (
          <div className="empty-state">
            <p>Não foi possível carregar os fornecedores.</p>
            <p className="fornecedores-dica">Verifique sua conexão e tente novamente.</p>
            <button className="ghost-button" onClick={() => list.refetch()}>Tentar novamente</button>
          </div>
        )}
        {list.data && list.data.length === 0 && !list.isLoading && (
          <div className="empty-state">
            <strong>Nenhum fornecedor cadastrado</strong>
            <p>Use o botão “Novo fornecedor” para começar.</p>
          </div>
        )}
        {allTags.length > 0 && (
          <div className="fornecedores-filtro" role="group" aria-label="Filtrar por etiqueta">
            <button
              type="button"
              className={`chip${tagFilter === null ? ' chip--active' : ''}`}
              aria-pressed={tagFilter === null}
              onClick={() => setTagFilter(null)}
            >
              Todas
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`chip${tagFilter === tag ? ' chip--active' : ''}`}
                aria-pressed={tagFilter === tag}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        {list.data && list.data.length > 0 && displayedSuppliers.length === 0 && (
          <div className="empty-state">
            <p>Nenhum fornecedor com a etiqueta “{tagFilter}”.</p>
          </div>
        )}
        {displayedSuppliers.length > 0 && (
          <div className="table-wrapper">
            <table className="table table--dense fornecedores-tabela">
            <thead>
              <tr>
                <th></th>
                <th>Nome</th>
                <th>País</th>
                <th>Incoterms</th>
                <th>Avaliação</th>
                <th>Contato principal</th>
                <th className="col-status">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {displayedSuppliers.map((s) => {
                const supplierContacts = contactsForSupplier(s.id);
                const primary = supplierContacts.find((c) => c.isPrimary);
                const isExpanded = expandedSupplierId === s.id;
                const docSummary = documentsSummaryBySupplier[String(s.id)];
                return (
                  <>
                    <tr
                      key={s.id}
                      id={`supplier-row-${s.id}`}
                      className={isExpanded ? 'fornecedores-linha fornecedores-linha--aberta' : 'fornecedores-linha'}
                    >
                      <td className="fornecedores-expandir">
                        <button
                          type="button"
                          className="fornecedores-expandir__botao"
                          aria-label={isExpanded ? 'Ocultar contatos' : 'Mostrar contatos'}
                          aria-expanded={isExpanded}
                          onClick={() => toggleExpanded(s.id)}
                          disabled={contactsBySupplier.isLoading}
                        >
                          <Icon name={isExpanded ? 'minus' : 'plus'} size={16} strokeWidth={2.2} />
                        </button>
                      </td>
                      <td>
                        <div className="fornecedores-nome">
                        <strong>{s.name}</strong>
                        {docSummary && docSummary.expired > 0 ? (
                            <span className="badge badge--danger fornecedores-doc">
                              <Icon name="file" size={12} strokeWidth={2.2} />
                            Doc. vencido
                          </span>
                        ) : docSummary && docSummary.expiring > 0 ? (
                            <span className="badge badge--warning fornecedores-doc">
                              <Icon name="file" size={12} strokeWidth={2.2} />
                            {typeof docSummary.nextDaysLeft === 'number'
                              ? `Doc. vence em ${docSummary.nextDaysLeft} d`
                              : 'Doc. a vencer'}
                          </span>
                        ) : null}
                        </div>
                        {s.tags.length > 0 && (
                          <div className="fornecedores-tags">
                            {s.tags.map((tag) => (
                              <span className="fornecedores-tag" key={tag}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{s.country ?? '—'}</td>
                      <td
                        className={
                          coversAllIncoterms(s.acceptedIncoterms)
                            ? 'fornecedores-incoterms fornecedores-incoterms--todos'
                            : 'fornecedores-incoterms'
                        }
                      >
                                {coversAllIncoterms(s.acceptedIncoterms)
                                  ? 'Todos'
                                  : s.acceptedIncoterms.length > 0
                                    ? s.acceptedIncoterms.join(', ')
                                    : '—'}
                              </td>
                              <td>
                                {s.reviewStats && s.reviewStats.count > 0 && s.reviewStats.avgRating !== null ? (
                          <span className="fornecedores-avaliacao">
                                    <StarRating value={s.reviewStats.avgRating} readOnly showValue />
                            <span className="fornecedores-avaliacao__n">
                                      ({s.reviewStats.count})
                                    </span>
                                  </span>
                                ) : (
                          <span className="fornecedores-sem-dado">—</span>
                                )}
                              </td>
                              <td
                                className="cell-truncate"
                                title={primary ? `${primary.name} <${primary.email}>` : undefined}
                              >
                                {primary ? primary.name : '—'}
                              </td>
                              <td className="col-status">
                                <span
                          className={`badge badge--dot ${
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
                                <div className="row-actions row-actions--nowrap">
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
                                    onClick={async () => {
                                      if (await confirm(`Remover ${s.name}? Esta ação não pode ser desfeita.`)) {
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
                      <tr key={`${s.id}-contacts`} className="fornecedores-linha-detalhe">
                        <td colSpan={8} className="fornecedores-expandida">
                          <div className="fornecedores-expandida__grade">
                            <section className="fornecedores-secao">
                              <div className="fornecedores-secao__cabecalho">
                                <h3>Contatos</h3>
                                    <button
                                      type="button"
                                      className="ghost-button"
                                      onClick={() => openNewContact(s.id)}
                                    >
                                  <Icon name="plus" size={14} strokeWidth={2.2} />
                                  Adicionar contato
                                    </button>
                                  </div>
                                  {contactsQuery.isLoading && contactsQuery.data === undefined ? (
                                <p className="fornecedores-secao__vazio">Carregando contatos…</p>
                                  ) : supplierContacts.length === 0 ? (
                                <p className="fornecedores-secao__vazio">
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
                                      <div className="contact-row__info">
                                            <div className="contact-row__name">
                                              {c.name}
                                              {c.isPrimary && (
                                            <span className="badge badge--success contact-row__principal">
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
                                      <span className="contact-row__data">
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
                                              onClick={async () => {
                                                if (await confirm(`Remover ${c.name}?`)) {
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
                            </section>
                                  <SupplierDocumentsSection supplierId={s.id} supplierName={s.name} />
                          </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
          </div>
                )}
      </section>

      <Modal
        isOpen={isContactModalOpen}
        onClose={closeContactForm}
        title={editingContact ? 'Editar contato' : 'Novo contato'}
      >
        {/* Guard: o corpo faz deref de expandedSupplierId; sem isso renderizaria
            "Fornecedor #null" com o modal fechado. */}
        {isContactModalOpen && (
          <form className="fornecedor-form" onSubmit={handleContactSubmit}>
            <p className="fornecedor-form__fornecedor">
              Fornecedor: <strong>{contactSupplierName}</strong>
            </p>

            <div className="fornecedor-campo">
            <label className="field-label" htmlFor="contactName">Nome *</label>
            <input
              id="contactName"
              className="input"
              value={contactForm.name}
              onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
              required
            />
            </div>

            <div className="fornecedor-campo">
              <label className="field-label" htmlFor="contactEmail">
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
            </div>

            <div className="fornecedor-form__duplo">
              <div className="fornecedor-campo">
                <label className="field-label" htmlFor="contactPhone">Telefone</label>
                <input
                  id="contactPhone"
                  className="input"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                />
              </div>
              <div className="fornecedor-campo">
                <label className="field-label" htmlFor="contactPosition">Cargo</label>
                <input
                  id="contactPosition"
                  className="input"
                  value={contactForm.position}
                  onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })}
                />
              </div>
            </div>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={contactForm.isPrimary}
                onChange={(e) => setContactForm({ ...contactForm, isPrimary: e.target.checked })}
              />
              Marcar como contato principal
            </label>

            {contactError && (
              <p
                role="alert"
                className="fornecedor-form__erro"
              >
                {contactError}
              </p>
            )}

            <div className="modal-actions">
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
        )}
      </Modal>

      <Modal
        isOpen={showForm}
        onClose={closeForm}
        title={editing ? 'Editar fornecedor' : 'Novo fornecedor'}
      >
        <form className="fornecedor-form" onSubmit={handleSubmit}>
            <div className="fornecedor-campo">
            <label className="field-label" htmlFor="name">Nome *</label>
            <input
              id="name"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
              <p className="fornecedor-dica">
              Cadastre os contatos do fornecedor logo abaixo — cada contato possui seu próprio
              e-mail, que sera usado para o envio das cotacoes.
            </p>
            </div>

            <div className="fornecedor-form__duplo">
              <div className="fornecedor-campo">
                <label className="field-label" htmlFor="website">Website</label>
                <input
                  id="website"
                  className="input"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                />
              </div>
              <div className="fornecedor-campo">
                <label className="field-label" htmlFor="country">País</label>
                <input
                  id="country"
                  className="input"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              </div>
            </div>

            <div className="fornecedor-form__duplo">
              <div className="fornecedor-campo">
                <label className="field-label" htmlFor="status">Status</label>
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
              </div>
              <div className="fornecedor-campo">
                <label className="field-label" htmlFor="paymentTermsDays">
              Prazo de pagamento (dias)
            </label>
            <input
              id="paymentTermsDays"
                  className="input fornecedor-form__numero"
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
                <p className="fornecedor-dica">
              Pré-preenchido no portal do fornecedor ao enviar a cotação.
            </p>
              </div>
            </div>

            <div className="fornecedor-campo fornecedor-grupo">
              <span className="fornecedor-grupo__titulo">
              Incoterms aceitos
              </span>
              <div className="fornecedor-chips fornecedor-chips--mono">
              {INCOTERMS.map((term) => {
                const active = form.acceptedIncoterms.includes(term);
                return (
                  <button
                    key={term}
                    type="button"
                    className={`chip${active ? ' chip--active' : ''}`}
                      aria-pressed={active}
                    onClick={() => toggleIncoterm(term)}
                  >
                      {active && <Icon name="check" size={12} strokeWidth={2.6} />}
                    {term}
                  </button>
                );
              })}
            </div>
              <p className="fornecedor-dica">
              Nenhum selecionado = todos os Incoterms.
            </p>
            </div>

            <div className="fornecedor-campo fornecedor-grupo fornecedor-grupo--familias">
              <span className="fornecedor-grupo__titulo">
              Famílias que este fornecedor cota
              </span>
              <p className="fornecedor-dica">
              Usado para pré-selecionar os fornecedores certos ao enviar uma cotação.
            </p>
              <div className="fornecedor-chips">
              {familyOptions.map((family) => {
                const active = form.familyIds.includes(family.id);
                return (
                  <button
                    key={family.id}
                    type="button"
                    className={`chip${active ? ' chip--active' : ''}`}
                      aria-pressed={active}
                    onClick={() => toggleFamily(family.id)}
                  >
                      {active && <Icon name="check" size={12} strokeWidth={2.6} />}
                    {family.name}
                  </button>
                );
              })}
              {familyOptions.length === 0 && (
                  <span className="fornecedor-dica">
                  Nenhuma família cadastrada.
                </span>
              )}
            </div>
            </div>

            <div className="fornecedor-campo">
              <label className="field-label" htmlFor="tagInput">
              Etiquetas
            </label>
              <div className="fornecedor-chips">
              {form.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                    className="chip chip--active fornecedor-etiqueta"
                  onClick={() => removeTag(tag)}
                  title="Remover etiqueta"
                >
                    {tag}
                    <Icon name="x" size={14} strokeWidth={2.2} />
                </button>
              ))}
              {form.tags.length === 0 && (
                  <span className="fornecedor-dica">Nenhuma etiqueta.</span>
              )}
            </div>
            <input
              id="tagInput"
              className="input"
              type="text"
              value={tagInput}
              placeholder="Digite e Enter (ex.: confiável, prazo curto)"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag(tagInput);
                  setTagInput('');
                }
              }}
              onBlur={() => {
                if (tagInput.trim()) {
                  addTag(tagInput);
                  setTagInput('');
                }
              }}
            />
            </div>

            <div className="fornecedor-campo">
              <label className="field-label" htmlFor="notes">Observações</label>
            <textarea
              id="notes"
              className="textarea"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            </div>

            {formError && (
              <p
                role="alert"
                className="fornecedor-form__erro"
              >
                {formError}
              </p>
            )}

            <div className="modal-actions">
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
      </Modal>

      {isImportOpen && <SupplierImportModal onClose={() => setIsImportOpen(false)} />}
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
