import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import {
  generatePortalTokens,
  listPortalTokens,
  previewDispatch,
  revokePortalToken,
  sendDispatch,
  type DispatchRecipientPreview,
  type DispatchSendResult,
  type PortalTokenListItem,
} from '@/services/dispatch';

type QuoteStatus = 'open' | 'closed';
type Incoterm = 'EXW' | 'FCA' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP';

interface QuoteRequest {
  id: number;
  requestCode: string;
  productName: string | null;
  quantity: number | null;
  description: string | null;
  desiredIncoterm: Incoterm;
  destinationPort: string | null;
  originPort: string | null;
  currency: string;
  deadlineAt: string | null;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  createdById: number | null;
  items?: QuoteRequestItem[];
  quoteResponses?: QuoteResponseSummary[];
}

interface CatalogItemLite {
  id: number;
  commercialName: string;
  marketName: string;
  isDangerousGood: boolean;
}

interface QuoteRequestItem {
  id: number;
  quoteRequestId: number;
  itemCode: string | null;
  productName: string;
  description: string | null;
  quantity: number;
  unit: string;
  targetPrice: number | null;
  notes: string | null;
  desiredIncoterm: Incoterm | null;
  destinationPort: string | null;
  catalogItemId: number | null;
  catalogItem?: CatalogItemLite | null;
  createdAt: string;
  updatedAt: string;
}

interface QuoteResponseSummary {
  id: number;
  supplierId: number;
  supplier?: { id: number; name: string; country?: string | null };
  offeredPrice: number;
  currency: string;
  offeredIncoterm: string;
  isWinner?: boolean;
}

interface QuoteRequestForm {
  description: string;
  desiredIncoterm: Incoterm;
  destinationPort: string;
  originPort: string;
  currency: string;
  deadlineAt: string;
}

interface ItemForm {
  catalogItemId: number | null;
  quantity: string;
  unit: string;
  notes: string;
  desiredIncoterm: Incoterm | '';
  destinationPort: string;
  inheritIncoterm: boolean;
  inheritPort: boolean;
}

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const;
const UNITS = ['KG', 'UN', 'M3', 'L', 'TON', 'BOX'] as const;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatNumber(value: number | undefined | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR');
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function asIncoterm(value: unknown): Incoterm {
  const v = String(value ?? '');
  return (INCOTERMS as readonly string[]).includes(v) ? (v as Incoterm) : 'EXW';
}

function normalize(qr: unknown): QuoteRequest {
  if (typeof qr !== 'object' || qr === null) {
    throw new Error('Resposta inesperada do servidor.');
  }
  const obj = qr as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? (obj.items as QuoteRequestItem[]) : [];
  const responses = Array.isArray(obj.quoteResponses) ? (obj.quoteResponses as QuoteResponseSummary[]) : [];
  return {
    id: Number(obj.id),
    requestCode: String(obj.requestCode ?? ''),
    productName: (obj.productName as string | null) ?? '',
    quantity: typeof obj.quantity === 'number' ? obj.quantity : 0,
    description: (obj.description as string | null) ?? null,
    desiredIncoterm: asIncoterm(obj.desiredIncoterm),
      destinationPort: (obj.destinationPort as string | null) ?? null,
      originPort: (obj.originPort as string | null) ?? 'Shanghai',
      currency: String(obj.currency ?? 'USD'),
      deadlineAt: (obj.deadlineAt as string | null) ?? null,
      status: (obj.status as QuoteStatus) ?? 'open',
      createdAt: String(obj.createdAt ?? ''),
      updatedAt: String(obj.updatedAt ?? ''),
      closedAt: (obj.closedAt as string | null) ?? null,
      createdById: typeof obj.createdById === 'number' ? obj.createdById : null,
      items,
      quoteResponses: responses,
    };
  }

function normalizeItem(it: unknown): QuoteRequestItem {
  if (typeof it !== 'object' || it === null) {
    throw new Error('Resposta inesperada do servidor.');
  }
  const obj = it as Record<string, unknown>;
  const catalog = obj.catalogItem as Record<string, unknown> | null | undefined;
  return {
    id: Number(obj.id),
    quoteRequestId: Number(obj.quoteRequestId ?? 0),
    itemCode: (obj.itemCode as string | null) ?? null,
    productName: String(obj.productName ?? ''),
    description: (obj.description as string | null) ?? null,
    quantity: Number(obj.quantity ?? 0),
    unit: String(obj.unit ?? ''),
    targetPrice: typeof obj.targetPrice === 'number' ? obj.targetPrice : null,
    notes: (obj.notes as string | null) ?? null,
    desiredIncoterm: obj.desiredIncoterm
      ? asIncoterm(obj.desiredIncoterm)
      : null,
    destinationPort: (obj.destinationPort as string | null) ?? null,
    catalogItemId:
      typeof obj.catalogItemId === 'number' ? obj.catalogItemId : null,
    catalogItem: catalog
      ? {
          id: Number(catalog.id),
          commercialName: String(catalog.commercialName ?? ''),
          marketName: String(catalog.marketName ?? ''),
          isDangerousGood: Boolean(catalog.isDangerousGood),
        }
      : null,
    createdAt: String(obj.createdAt ?? ''),
    updatedAt: String(obj.updatedAt ?? ''),
  };
}

const emptyItemForm: ItemForm = {
  catalogItemId: null,
  quantity: '',
  unit: 'UN',
  notes: '',
  desiredIncoterm: '',
  destinationPort: '',
  inheritIncoterm: true,
  inheritPort: true,
};

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    const body = (err as Error & { body?: { message?: unknown } }).body;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return 'Erro desconhecido.';
}

export default function CotacaoDetalhe() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const id = Number(params.id);

  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<QuoteRequestItem | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm);
  const [itemError, setItemError] = useState<string | null>(null);

    const [showEditModal, setShowEditModal] = useState(false);
    const [editForm, setEditForm] = useState<QuoteRequestForm | null>(null);
    const [editError, setEditError] = useState<string | null>(null);

    const [showDispatchModal, setShowDispatchModal] = useState(false);
    const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);
    const [dispatchSubject, setDispatchSubject] = useState('');
    const [dispatchMessage, setDispatchMessage] = useState('');
    const [dispatchExpires, setDispatchExpires] = useState('7');
    const [dispatchError, setDispatchError] = useState<string | null>(null);
    const [dispatchStep, setDispatchStep] = useState<'select' | 'preview' | 'sent'>('select');
    const [dispatchPreview, setDispatchPreview] = useState<{
      recipients: DispatchRecipientPreview[];
      preview: { subject: string; html: string; text: string } | null;
      cc: Array<{ email: string; name?: string }>;
    } | null>(null);
    const [dispatchResult, setDispatchResult] = useState<DispatchSendResult | null>(null);

  // Tokens do portal (links magicos) ja gerados para esta cotacao. Cada
  // entrada eh um link unico por contato de fornecedor; o admin pode
  // copiar a URL e revogar quando quiser.
  const [showTokensModal, setShowTokensModal] = useState(false);
  const [tokenActionError, setTokenActionError] = useState<string | null>(null);
  const [copiedTokenId, setCopiedTokenId] = useState<number | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

    const canEdit = user?.role === 'admin' || user?.role === 'comprador';
    const canManageStatus = user?.role === 'admin' || user?.role === 'gestor';
    const canDelete = user?.role === 'admin';
    const canDispatch = canEdit;

  const detail = useQuery({
    queryKey: ['quote-request', id],
    queryFn: async () => {
      const data = await api.get<unknown>(`/v1/quote-requests/${id}`);
      return normalize(data);
    },
    enabled: Number.isFinite(id),
  });

  const closeRequest = useMutation({
    mutationFn: () => api.post<unknown>(`/v1/quote-requests/${id}/close`, {}),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['quote-request', id] });
      qc.invalidateQueries({ queryKey: ['quote-requests'] });
    },
    onError: (err) => setActionError(messageOf(err)),
  });

  const reopenRequest = useMutation({
    mutationFn: () => api.post<unknown>(`/v1/quote-requests/${id}/reopen`, {}),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['quote-request', id] });
      qc.invalidateQueries({ queryKey: ['quote-requests'] });
    },
    onError: (err) => setActionError(messageOf(err)),
  });

  const updateQuote = useMutation({
    mutationFn: (payload: QuoteRequestForm) => {
      const body: Record<string, unknown> = {
        description: payload.description.trim() || null,
        desiredIncoterm: payload.desiredIncoterm,
          destinationPort: payload.destinationPort.trim() || null,
          originPort: payload.originPort.trim() || 'Shanghai',
          currency: payload.currency.trim().toUpperCase() || 'USD',
          deadlineAt: payload.deadlineAt ? new Date(`${payload.deadlineAt}T00:00:00`).toISOString() : null,
        };
        return api.put<unknown>(`/v1/quote-requests/${id}`, body);
      },
      onSuccess: () => {
        setEditError(null);
        qc.invalidateQueries({ queryKey: ['quote-request', id] });
        qc.invalidateQueries({ queryKey: ['quote-requests'] });
        setShowEditModal(false);
        setEditForm(null);
      },
      onError: (err) => setEditError(messageOf(err)),
    });

    const createItem = useMutation({
      mutationFn: (payload: ItemForm) => {
        const body: Record<string, unknown> = {
          quantity: Number(payload.quantity),
          unit: payload.unit,
          notes: payload.notes.trim() || null,
        };
        if (payload.catalogItemId !== null) {
          body.catalogItemId = payload.catalogItemId;
        }
        if (!payload.inheritIncoterm && payload.desiredIncoterm) {
          body.desiredIncoterm = payload.desiredIncoterm;
        }
        if (!payload.inheritPort && payload.destinationPort.trim()) {
          body.destinationPort = payload.destinationPort.trim();
        }
        return api.post<unknown>(`/v1/quote-requests/${id}/items`, body);
      },
      onSuccess: () => {
        setItemError(null);
        qc.invalidateQueries({ queryKey: ['quote-request', id] });
        qc.invalidateQueries({ queryKey: ['quote-request-items'] });
        closeItemModal();
      },
      onError: (err) => setItemError(messageOf(err)),
    });

    const updateItem = useMutation({
      mutationFn: ({ itemId, payload }: { itemId: number; payload: ItemForm }) => {
        const body: Record<string, unknown> = {
          quantity: Number(payload.quantity),
          unit: payload.unit,
          notes: payload.notes.trim() || null,
        };
        if (payload.catalogItemId !== null) {
          body.catalogItemId = payload.catalogItemId;
        }
        if (payload.inheritIncoterm) {
          body.desiredIncoterm = null;
        } else if (payload.desiredIncoterm) {
          body.desiredIncoterm = payload.desiredIncoterm;
        } else {
          body.desiredIncoterm = null;
        }
        if (payload.inheritPort) {
          body.destinationPort = null;
        } else if (payload.destinationPort.trim()) {
          body.destinationPort = payload.destinationPort.trim();
        } else {
          body.destinationPort = null;
        }
        return api.put<unknown>(`/v1/quote-request-items/${itemId}`, body);
      },
      onSuccess: () => {
        setItemError(null);
        qc.invalidateQueries({ queryKey: ['quote-request', id] });
        qc.invalidateQueries({ queryKey: ['quote-request-items'] });
        closeItemModal();
      },
      onError: (err) => setItemError(messageOf(err)),
    });

  const removeItem = useMutation({
    mutationFn: (itemId: number) => api.del<void>(`/v1/quote-request-items/${itemId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quote-request', id] });
      qc.invalidateQueries({ queryKey: ['quote-request-items'] });
    },
    onError: (err) => setActionError(messageOf(err)),
  });

  const deleteQuote = useMutation({
    mutationFn: () => api.del<void>(`/v1/quote-requests/${id}`),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['quote-requests'] });
      navigate('/cotacoes');
    },
    onError: (err) => setActionError(messageOf(err)),
  });

    const activeSuppliers = useQuery({
      queryKey: ['suppliers-active'],
      queryFn: async () => {
        const data = await api.get<unknown[] | { data?: unknown[]; items?: unknown[] }>(
          '/v1/suppliers',
          { status: 'active', pageSize: '200' },
        );
        const raw = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : data?.items ?? [];
        return raw.map((s) => {
          const obj = s as Record<string, unknown>;
          return {
            id: Number(obj.id),
            name: String(obj.name ?? ''),
            status: String(obj.status ?? 'active'),
          };
        });
      },
      enabled: showDispatchModal,
    });

    const activeCatalog = useQuery({
      queryKey: ['catalog-items-active-detail'],
      queryFn: async () => {
        const data = await api.get<unknown[] | { data?: unknown[]; items?: unknown[] }>(
          '/v1/catalog-items',
          { pageSize: '200' },
        );
        const raw = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : data?.items ?? [];
        return (raw as Array<Record<string, unknown>>).map((c) => ({
          id: Number(c.id),
          commercialName: String(c.commercialName ?? ''),
          marketName: String(c.marketName ?? ''),
          isDangerousGood: Boolean(c.isDangerousGood),
          isActive: Boolean(c.isActive ?? true),
        }));
      },
      enabled: showItemModal,
    });

    const supplierContacts = useQuery({
      queryKey: ['supplier-contacts-bulk-dispatch', activeSuppliers.data?.map((s) => s.id).join(',')],
      queryFn: async () => {
        const ids = activeSuppliers.data?.map((s) => s.id) ?? [];
        if (ids.length === 0) return {} as Record<number, Array<{ id: number; name: string; email: string; isPrimary: boolean }>>;
        const data = await api.get<{ bySupplier?: Record<string, unknown[]> }>(
          '/v1/supplier-contacts',
          { supplierIds: ids.join(',') },
        );
        const map: Record<number, Array<{ id: number; name: string; email: string; isPrimary: boolean }>> = {};
        const bySupplier = data?.bySupplier ?? {};
        for (const [key, list] of Object.entries(bySupplier)) {
          map[Number(key)] = (Array.isArray(list) ? list : []).map((c) => {
            const obj = c as Record<string, unknown>;
            return {
              id: Number(obj.id),
              name: String(obj.name ?? ''),
              email: String(obj.email ?? ''),
              isPrimary: Boolean(obj.isPrimary),
            };
          });
        }
        return map;
      },
      enabled: showDispatchModal && Boolean(activeSuppliers.data),
    });

    // CC automatico configurado pela empresa (CompanyProfile.dispatchCc).
    // Igual ao backend: ja chega deduplicado e lowercase, mas usamos Set
    // aqui tambem para garantir caso o usuario adicione o mesmo e-mail
    // em outra fonte.
    const companyProfileQuery = useQuery({
      queryKey: ['company-profile-cc-hint'],
      queryFn: () => api.get<{ dispatchCc?: string[] | null }>('/api/v1/company-profile'),
      enabled: showDispatchModal,
      staleTime: 60_000,
    });
    const companyCcList = useMemo(() => {
      const raw = companyProfileQuery.data?.dispatchCc;
      if (!Array.isArray(raw)) return [] as string[];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of raw) {
        if (typeof item !== 'string') continue;
        const lower = item.trim().toLowerCase();
        if (!lower || seen.has(lower)) continue;
        seen.add(lower);
        out.push(lower);
      }
      return out;
    }, [companyProfileQuery.data]);

    const siblingCcCount = useMemo(() => {
      const contactsMap = supplierContacts.data ?? {};
      const total = selectedContactIds.reduce((acc, id) => {
        const supplierEntry = Object.entries(contactsMap).find(([, list]) =>
          list.some((c) => c.id === id),
        );
        if (!supplierEntry) return acc;
        const [, list] = supplierEntry;
        return acc + Math.max(0, list.length - 1);
      }, 0);
      return total;
    }, [selectedContactIds, supplierContacts.data]);

    const previewDispatchMutation = useMutation({
      mutationFn: () =>
        previewDispatch(id, selectedContactIds),
      onSuccess: (data) => {
        setDispatchError(null);
        setDispatchPreview({
          recipients: data.recipients,
          preview: data.preview,
          cc: data.cc ?? [],
        });
        if (!dispatchSubject.trim() && data.preview?.subject) {
          setDispatchSubject(data.preview.subject);
        }
        setDispatchStep('preview');
      },
      onError: (err) => setDispatchError(messageOf(err)),
    });

    const sendDispatchMutation = useMutation({
      mutationFn: () =>
        sendDispatch(id, selectedContactIds, {
          subject: dispatchSubject,
          message: dispatchMessage,
          expiresInDays: Number(dispatchExpires) || 7,
        }),
      onSuccess: (data) => {
        setDispatchError(null);
        setDispatchResult(data);
        setDispatchStep('sent');
        qc.invalidateQueries({ queryKey: ['quote-request', id] });
      },
      onError: (err) => setDispatchError(messageOf(err)),
    });

    const revokePortalTokenMutation = useMutation({
      mutationFn: (tokenId: number) => revokePortalToken(tokenId),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['portal-tokens', id] });
        setTokenActionError(null);
      },
      onError: (err) => setTokenActionError(messageOf(err)),
    });

    const portalTokensQuery = useQuery({
      queryKey: ['portal-tokens', id],
      queryFn: () => listPortalTokens(id),
      enabled: showTokensModal,
    });

    const generateTokensMutation = useMutation({
      mutationFn: (payload: { contactIds: number[]; expiresInDays: number }) =>
        generatePortalTokens(id, payload.contactIds, payload.expiresInDays),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['portal-tokens', id] });
        setTokenActionError(null);
      },
      onError: (err) => setTokenActionError(messageOf(err)),
    });

    const activeTokens: PortalTokenListItem[] = portalTokensQuery.data ?? [];

    function buildPortalUrl(token: string): string {
      const base = (
        (import.meta.env.VITE_PORTAL_URL as string | undefined) ??
        'https://intelliquote.portal-comex.com'
      ).replace(/\/$/, '');
      // Cache-buster idêntico ao backend (DispatchController.buildPortalLink)
      // para que o navegador sempre carregue a versão mais recente do
      // portal.html ao colar o link.
      return `${base}/portal?token=${encodeURIComponent(token)}&v=${Date.now()}`;
    }

    async function copyTokenToClipboard(token: PortalTokenListItem) {
      const url = buildPortalUrl(token.token);
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = url;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        setCopiedTokenId(token.id);
        window.setTimeout(() => {
          setCopiedTokenId((current) => (current === token.id ? null : current));
        }, 2000);
      } catch (err) {
        setTokenActionError(
          err instanceof Error ? err.message : 'Falha ao copiar o link.',
        );
      }
    }

  function openNewItem() {
    setEditingItem(null);
    setItemForm(emptyItemForm);
    setItemError(null);
    setShowItemModal(true);
  }

  function openEditItem(item: QuoteRequestItem) {
    setEditingItem(item);
      const hasIncoterm = !!item.desiredIncoterm;
      const hasPort = !!item.destinationPort;
      setItemForm({
        catalogItemId: item.catalogItemId,
        quantity: String(item.quantity),
        unit: item.unit,
        notes: item.notes ?? '',
        desiredIncoterm: item.desiredIncoterm ?? '',
        destinationPort: item.destinationPort ?? '',
        inheritIncoterm: !hasIncoterm,
        inheritPort: !hasPort,
      });
      setItemError(null);
      setShowItemModal(true);
    }

  function closeItemModal() {
    setShowItemModal(false);
    setEditingItem(null);
    setItemForm(emptyItemForm);
    setItemError(null);
  }

  function openEditQuote() {
    if (!detail.data) return;
    setEditForm({
      description: detail.data.description ?? '',
      desiredIncoterm: detail.data.desiredIncoterm,
        destinationPort: detail.data.destinationPort ?? '',
        originPort: detail.data.originPort ?? 'Shanghai',
        currency: detail.data.currency,
        deadlineAt: toDateInput(detail.data.deadlineAt),
      });
      setEditError(null);
      setShowEditModal(true);
    }

  function closeEditModal() {
    setShowEditModal(false);
    setEditForm(null);
    setEditError(null);
  }

    function openDispatchModal() {
      setDispatchStep('select');
      setSelectedContactIds([]);
      setDispatchSubject('');
      setDispatchMessage('');
      setDispatchExpires('7');
      setDispatchPreview(null);
      setDispatchResult(null);
      setDispatchError(null);
      setShowDispatchModal(true);
    }

    function closeDispatchModal() {
      setShowDispatchModal(false);
      setDispatchError(null);
    }

    function toggleContactSelection(contactId: number) {
      setSelectedContactIds((current) =>
        current.includes(contactId)
          ? current.filter((id) => id !== contactId)
          : [...current, contactId],
      );
    }

  function handleItemSubmit(e: React.FormEvent) {
    e.preventDefault();
    setItemError(null);
    if (itemForm.catalogItemId === null) {
      setItemError('Selecione um item do catálogo.');
      return;
    }
    if (!itemForm.unit.trim()) {
      setItemError('Informe a unidade.');
      return;
    }
      if (!itemForm.inheritIncoterm && !itemForm.desiredIncoterm) {
        setItemError('Escolha o INCOTERM do item ou marque "usar o da cotação".');
        return;
      }
      if (!itemForm.inheritPort && !itemForm.destinationPort.trim()) {
        setItemError('Informe o porto de destino do item ou marque "usar o da cotação".');
        return;
      }
      const qty = Number(itemForm.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        setItemError('Quantidade deve ser maior que zero.');
        return;
      }
      if (editingItem) {
        updateItem.mutate({ itemId: editingItem.id, payload: itemForm });
      } else {
        createItem.mutate(itemForm);
      }
    }

    function handleEditSubmit(e: React.FormEvent) {
      e.preventDefault();
      if (!editForm) return;
      setEditError(null);
      if (!editForm.currency.trim()) {
        setEditError('Informe a moeda (código de 3 letras).');
        return;
      }
      updateQuote.mutate(editForm);
    }

  if (!Number.isFinite(id)) {
    return (
      <div className="page">
        <h1>Cotação</h1>
        <div className="empty-state">
          <p>Identificador de cotação inválido.</p>
        </div>
      </div>
    );
  }

  if (detail.isLoading) {
    return (
      <div className="page">
        <h1>Cotação</h1>
        <p>Carregando…</p>
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="page">
        <h1>Cotação</h1>
        <div className="empty-state">
          <p>Não foi possível carregar a cotação.</p>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            Verifique sua conexão e tente novamente.
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={() => navigate('/cotacoes')}>
          Voltar para a lista
        </button>
      </div>
    );
  }

  const qr = detail.data;
  const items = (qr.items ?? []).map(normalizeItem);
  const responses = qr.quoteResponses ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Cotação #{qr.id}</p>
          <h1>{qr.requestCode}</h1>
          <p>{qr.productName}</p>
        </div>
        <div className="page-header__actions" style={{ alignItems: 'center' }}>
          <span className={`badge${qr.status === 'closed' ? ' badge--muted' : ''}`}>
            {qr.status === 'open' ? 'Aberta' : 'Fechada'}
          </span>
          {canDispatch && qr.status === 'open' && items.length > 0 && (
            <button
              type="button"
              className="primary-button"
              onClick={openDispatchModal}
            >
              Enviar cotacao
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowTokensModal(true)}
            >
              Links do portal
            </button>
          )}
          {canEdit && qr.status === 'open' && (
            <button type="button" className="ghost-button" onClick={openEditQuote}>
              Editar
            </button>
          )}
          {canManageStatus && qr.status === 'open' && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                if (window.confirm(`Fechar a cotação ${qr.requestCode}?`)) {
                  closeRequest.mutate();
                }
              }}
              disabled={closeRequest.isPending}
            >
              Fechar cotação
            </button>
          )}
          {canManageStatus && qr.status === 'closed' && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                if (window.confirm(`Reabrir a cotação ${qr.requestCode}?`)) {
                  reopenRequest.mutate();
                }
              }}
              disabled={reopenRequest.isPending}
            >
              Reabrir
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                if (window.confirm(`Apagar a cotação ${qr.requestCode}?`)) {
                  deleteQuote.mutate();
                }
              }}
              disabled={deleteQuote.isPending}
            >
              Apagar
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{actionError}</p>
      )}

      <section className="card">
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Resumo</h2>
        </div>
        <div className="form-grid">
          <div>
            <p className="eyebrow">Código</p>
            <p><strong>{qr.requestCode}</strong></p>
          </div>
          <div>
            <p className="eyebrow">Produto</p>
            <p>{qr.productName}</p>
          </div>
          <div>
            <p className="eyebrow">Quantidade</p>
            <p>{formatNumber(qr.quantity)}</p>
          </div>
          <div>
            <p className="eyebrow">Incoterm desejado</p>
            <p>{qr.desiredIncoterm}</p>
          </div>
          <div>
                      <p className="eyebrow">Porto de embarque</p>
                      <p>{qr.originPort ?? '—'}</p>
          </div>
          <div>
                      <p className="eyebrow">Porto de destino</p>
                      <p>{qr.destinationPort ?? '—'}</p>
          </div>
                    <div>
                      <p className="eyebrow">Moeda</p>
                      <p>{qr.currency}</p>
                    </div>
          <div>
            <p className="eyebrow">Prazo</p>
            <p>{formatDate(qr.deadlineAt)}</p>
          </div>
          <div className="form-grid__full">
            <p className="eyebrow">Descrição</p>
            <p>{qr.description ?? '—'}</p>
          </div>
          <div>
            <p className="eyebrow">Criada em</p>
            <p>{formatDateTime(qr.createdAt)}</p>
          </div>
          <div>
            <p className="eyebrow">Fechada em</p>
            <p>{qr.closedAt ? formatDateTime(qr.closedAt) : '—'}</p>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Itens</h2>
          {canEdit && qr.status === 'open' && (
            <button type="button" className="primary-button" onClick={openNewItem}>
              + Adicionar item
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhum item cadastrado</strong>
            <p>
              {canEdit && qr.status === 'open'
                ? 'Use o botão “Adicionar item” para começar.'
                : 'Esta cotação ainda não possui itens.'}
            </p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nome comercial</th>
                <th>Nome de mercado</th>
                <th>Qtd</th>
                <th>Unidade</th>
                          <th>Incoterm</th>
                          <th>Porto</th>
                          <th>DG</th>
                          <th>Notas</th>
                          {canEdit && qr.status === 'open' && <th>Ações</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => (
                          <tr key={it.id}>
                            <td><strong>{it.catalogItem?.commercialName ?? it.productName}</strong></td>
                            <td>{it.catalogItem?.marketName ?? '—'}</td>
                            <td>{formatNumber(it.quantity)}</td>
                            <td>{it.unit}</td>
                            <td>{it.desiredIncoterm ?? qr.desiredIncoterm}</td>
                            <td>{it.destinationPort ?? qr.destinationPort ?? '—'}</td>
                            <td>{it.catalogItem?.isDangerousGood ? 'Sim' : '—'}</td>
                            <td>{it.notes ?? '—'}</td>
                  {canEdit && qr.status === 'open' && (
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => openEditItem(it)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => {
                            if (window.confirm(`Remover o item ${it.catalogItem?.commercialName ?? it.productName}?`)) {
                              removeItem.mutate(it.id);
                            }
                          }}
                          disabled={removeItem.isPending}
                        >
                          Remover
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2>Respostas</h2>
        </div>
        {responses.length === 0 ? (
          <div className="empty-state">
            <strong>Sem respostas ainda</strong>
            <p>Quando os fornecedores responderem, elas aparecerão aqui.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Preço</th>
                <th>Moeda</th>
                <th>Incoterm</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.supplier?.name ?? `Fornecedor #${r.supplierId}`}</strong></td>
                  <td>{formatNumber(r.offeredPrice)}</td>
                  <td>{r.currency}</td>
                  <td>{r.offeredIncoterm}</td>
                  <td>
                    {r.isWinner ? (
                      <span className="badge">Vencedor</span>
                    ) : (
                      <span className="badge badge--muted">Recebida</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showDispatchModal && (
        <div className="modal-backdrop" onClick={closeDispatchModal}>
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Enviar cotacao para fornecedores</h2>
            <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: -8 }}>
              {qr.requestCode} · {qr.productName}
            </p>

            {dispatchStep === 'select' && (
              <>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                              Selecione o contato principal de cada fornecedor. Os demais contatos
                              cadastrados no mesmo fornecedor serao adicionados automaticamente
                              como copia (CC), para que a equipe comercial inteira visualize o envio.
                            </p>
                            {activeSuppliers.isLoading && <p>Carregando fornecedores…</p>}
                            {!activeSuppliers.isLoading && (activeSuppliers.data ?? []).length === 0 && (
                              <div className="empty-state">
                                <strong>Nenhum fornecedor ativo</strong>
                                <p>Cadastre fornecedores ativos com contatos antes de enviar.</p>
                              </div>
                            )}
                            <div className="dispatcher-list">
                              {(activeSuppliers.data ?? []).map((supplier) => {
                                const contacts = supplierContacts.data?.[supplier.id] ?? [];
                                if (contacts.length === 0) {
                                  return (
                                    <div key={supplier.id} className="dispatcher-row">
                                      <span />
                                      <div>
                                        <div className="dispatcher-row__title">{supplier.name}</div>
                                        <div className="dispatcher-row__meta">Sem contatos cadastrados</div>
                                      </div>
                                      <span />
                                    </div>
                                  );
                                }
                                const primary =
                                  contacts.find((c) => c.isPrimary) ?? contacts[0];
                                const siblingCount = Math.max(0, contacts.length - 1);
                                const checked = Boolean(primary && selectedContactIds.includes(primary.id));
                                const contactNames = contacts
                                  .map((c) => (c.isPrimary ? `${c.name} (principal)` : c.name))
                                  .join(', ');
                                return (
                                  <label
                                    key={supplier.id}
                                    className={`dispatcher-row${checked ? ' dispatcher-row--selected' : ''}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => primary && toggleContactSelection(primary.id)}
                                    />
                                    <div>
                                      <div className="dispatcher-row__title">{supplier.name}</div>
                                      <div className="dispatcher-row__meta">Contatos: {contactNames}</div>
                                    </div>
                                    <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                                      {siblingCount > 0 ? `Para + ${siblingCount} em CC` : 'Para'}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>

                            {selectedContactIds.length > 0 && (
                              <div className="recipient-summary">
                                <span className="recipient-summary__pill">
                                  {selectedContactIds.length} destinatario(s) selecionado(s)
                                </span>
                                {companyCcList.length > 0 && (
                                  <span
                                    className="recipient-summary__pill recipient-summary__pill--cc"
                                    title={`Copia automatica configurada pela empresa (${companyCcList.length}): ${companyCcList.join(', ')}`}
                                  >
                                    +{companyCcList.length} CC empresa
                                  </span>
                                )}
                                {siblingCcCount > 0 && (
                                  <span
                                    className="recipient-summary__pill recipient-summary__pill--cc"
                                    title="Contatos secundarios do mesmo fornecedor"
                                  >
                                    +{siblingCcCount} CC fornecedores
                                  </span>
                                )}
                              </div>
                            )}

                            {dispatchError && (
                              <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>
                                {dispatchError}
                              </p>
                            )}

                            <div className="modal__actions">
                              <button type="button" className="ghost-button" onClick={closeDispatchModal}>
                                Cancelar
                              </button>
                              <button
                                type="button"
                                className="primary-button"
                                disabled={selectedContactIds.length === 0 || previewDispatchMutation.isPending}
                                onClick={() => previewDispatchMutation.mutate()}
                              >
                                {previewDispatchMutation.isPending ? 'Gerando preview…' : 'Continuar'}
                              </button>
                            </div>
                          </>
                        )}

            {dispatchStep === 'preview' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label className="field-label" htmlFor="dispatchSubject">Assunto</label>
                    <input
                      id="dispatchSubject"
                      className="input"
                      value={dispatchSubject}
                      onChange={(e) => setDispatchSubject(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="dispatchExpires">Validade do link (dias)</label>
                    <input
                      id="dispatchExpires"
                      className="input"
                      type="number"
                      min="1"
                      max="60"
                      value={dispatchExpires}
                      onChange={(e) => setDispatchExpires(e.target.value)}
                    />
                  </div>
                </div>

                <label className="field-label" htmlFor="dispatchMessage" style={{ marginTop: 12 }}>
                  Mensagem adicional para o fornecedor
                </label>
                <textarea
                  id="dispatchMessage"
                  className="textarea"
                  rows={3}
                  value={dispatchMessage}
                  onChange={(e) => setDispatchMessage(e.target.value)}
                  placeholder="Opcional. Esta mensagem sera exibida no topo do e-mail."
                />

                <div className="recipient-summary">
                  {dispatchPreview?.recipients.map((r) => (
                    <span key={r.supplierContactId} className="recipient-summary__pill">
                      {r.supplierName} · {r.contactName}
                                      {r.ccCount > 0 && (
                                        <span className="recipient-summary__pill__hint">
                                          +{r.ccCount} em CC
                                        </span>
                                      )}
                                    </span>
                                  ))}
                                </div>

                {companyCcList.length > 0 && (
                  <div className="recipient-summary" style={{ marginTop: 8 }}>
                    <span
                      className="recipient-summary__pill recipient-summary__pill--cc"
                      title={companyCcList.join(', ')}
                    >
                      CC fixo da empresa: {companyCcList.join(', ')}
                    </span>
                  </div>
                )}

                <h3 style={{ marginTop: 16, marginBottom: 6 }}>Preview do e-mail</h3>
                {dispatchPreview?.preview ? (
                  <iframe
                    title="preview-email"
                    className="preview-frame"
                    srcDoc={dispatchPreview.preview.html}
                  />
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                    Nenhum preview disponivel (nenhum destinatario selecionado).
                  </p>
                )}

                {dispatchError && (
                  <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>
                    {dispatchError}
                  </p>
                )}

                <div className="modal__actions">
                  <button type="button" className="ghost-button" onClick={() => setDispatchStep('select')}>
                    Voltar
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={sendDispatchMutation.isPending || selectedContactIds.length === 0}
                    onClick={() => {
                      if (window.confirm(`Enviar a cotacao para ${selectedContactIds.length} destinatario(s)?`)) {
                        sendDispatchMutation.mutate();
                      }
                    }}
                  >
                    {sendDispatchMutation.isPending ? 'Enviando…' : 'Enviar agora'}
                  </button>
                </div>
              </>
            )}

            {dispatchStep === 'sent' && dispatchResult && (
              <>
                <div className="dispatch-event">
                  <div className="dispatch-event__header">
                    <span className="dispatch-event__subject">Resultado do envio</span>
                    <span className={`dispatch-status dispatch-status--${dispatchResult.status}`}>
                      {dispatchResult.status === 'completed'
                        ? 'Enviado'
                        : dispatchResult.status === 'partial'
                          ? 'Parcial'
                          : 'Falhou'}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                    {dispatchResult.sentCount} enviado(s) · {dispatchResult.failedCount} falha(s)
                  </div>
                </div>

                <table className="table">
                  <thead>
                    <tr>
                      <th>Contato</th>
                      <th>Status</th>
                      <th>Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispatchResult.results.map((r) => {
                      const recipient = dispatchPreview?.recipients.find(
                        (rc) => rc.supplierContactId === r.supplierContactId,
                      );
                      return (
                        <tr key={r.supplierContactId}>
                          <td>{recipient ? `${recipient.supplierName} · ${recipient.contactName}` : `#${r.supplierContactId}`}</td>
                          <td>
                            <span
                              className={`dispatch-status dispatch-status--${r.status === 'sent' ? 'completed' : 'failed'}`}
                            >
                              {r.status === 'sent' ? 'Enviado' : 'Falhou'}
                            </span>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                                              {r.error ??
                                                (r.status === 'sent'
                                                  ? `Link magico gerado${r.ccCount ? ` · +${r.ccCount} CC` : ''}`
                                                  : '')}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                </table>

                <div className="modal__actions">
                  <button type="button" className="ghost-button" onClick={closeDispatchModal}>
                    Fechar
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      setShowTokensModal(true);
                    }}
                  >
                    Gerenciar links
                  </button>
                  <button type="button" className="ghost-button" onClick={closeDispatchModal}>
                    Concluir
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showTokensModal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowTokensModal(false);
            setTokenActionError(null);
            setCopiedTokenId(null);
          }}
        >
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Links do portal</h2>
            <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: -8 }}>
              Gere links mágicos para que fornecedores respondam sem precisar de login.
              Cada link é único e expira conforme a validade escolhida.
            </p>

            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-end',
                marginTop: 16,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: '1 1 220px' }}>
                <label className="field-label" htmlFor="tokensExpires">
                  Validade (dias)
                </label>
                <input
                  id="tokensExpires"
                  className="input"
                  type="number"
                  min={1}
                  max={90}
                  defaultValue={dispatchExpires}
                  onChange={(e) => setDispatchExpires(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="primary-button"
                disabled={generateTokensMutation.isPending}
                onClick={() => {
                  // Gera tokens para TODOS os fornecedores com pelo menos um
                  // contato ativo. E mais simples para o admin e
                  // aproveita a deduplicacao (contatos que ja tem token
                  // ativo sao ignorados pelo backend).
                  const ids = (activeSuppliers.data ?? []).flatMap(
                    (s) => supplierContacts.data?.[s.id]?.map((c) => c.id) ?? [],
                  );
                  if (ids.length === 0) return;
                  generateTokensMutation.mutate({
                    contactIds: ids,
                    expiresInDays: Number(dispatchExpires) || 14,
                  });
                }}
              >
                {generateTokensMutation.isPending ? 'Gerando…' : 'Gerar para todos os fornecedores'}
              </button>
            </div>

            {tokenActionError && (
              <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>
                {tokenActionError}
              </p>
            )}
            {generateTokensMutation.data && (
              <p
                style={{
                  color: 'var(--primary-700)',
                  marginTop: 12,
                  fontSize: 13,
                }}
              >
                {generateTokensMutation.data.generatedCount} link(s) novo(s) gerado(s)
                {generateTokensMutation.data.alreadyActiveCount > 0 &&
                  ` · ${generateTokensMutation.data.alreadyActiveCount} ja estava(m) ativo(s)`}
                .
              </p>
            )}

            <div style={{ marginTop: 16, maxHeight: 360, overflowY: 'auto' }}>
              {portalTokensQuery.isLoading && <p>Carregando links…</p>}
              {portalTokensQuery.data && activeTokens.length === 0 && (
                <div className="empty-state">
                  <strong>Nenhum link ativo</strong>
                  <p>
                    Gere links para que os fornecedores consigam responder esta cotação
                    pelo portal.
                  </p>
                </div>
              )}
              {activeTokens.length > 0 && (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fornecedor</th>
                      <th>Contato</th>
                      <th>Expira</th>
                      <th>Status</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTokens.map((token) => {
                      const expired =
                        new Date(token.expiresAt).getTime() < Date.now();
                      return (
                        <tr key={token.id}>
                          <td><strong>{token.supplier.name}</strong></td>
                          <td>
                            {token.contact.name}
                            <br />
                            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                              {token.contact.email}
                            </span>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                            {formatDateTime(token.expiresAt)}
                          </td>
                          <td>
                            {token.respondedAt ? (
                              <span className="badge">Respondido</span>
                            ) : expired ? (
                              <span className="badge badge--muted">Expirado</span>
                            ) : (
                              <span className="badge badge--muted">Pendente</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() => copyTokenToClipboard(token)}
                              >
                                {copiedTokenId === token.id ? 'Copiado!' : 'Copiar link'}
                              </button>
                              <button
                                type="button"
                                className="ghost-button"
                                disabled={revokePortalTokenMutation.isPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Revogar o link de ${token.contact.name}? O fornecedor não conseguirá mais responder.`,
                                    )
                                  ) {
                                    revokePortalTokenMutation.mutate(token.id);
                                  }
                                }}
                              >
                                Revogar
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="modal__actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setShowTokensModal(false);
                  setTokenActionError(null);
                  setCopiedTokenId(null);
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {showItemModal && (
        <div className="modal-backdrop" onClick={closeItemModal}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleItemSubmit}
          >
            <h2>{editingItem ? 'Editar item' : 'Novo item'}</h2>

            <label className="field-label" htmlFor="itemCatalog">Item do catálogo *</label>
            <select
              id="itemCatalog"
              className="select"
              value={itemForm.catalogItemId ?? ''}
              onChange={(e) =>
                setItemForm({
                  ...itemForm,
                  catalogItemId: e.target.value ? Number(e.target.value) : null,
                })
              }
              required
              disabled={editingItem !== null}
            >
              <option value="">Selecione…</option>
              {(activeCatalog.data ?? [])
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.commercialName} — {c.marketName}
                    {c.isDangerousGood ? ' (DG)' : ''}
                  </option>
                ))}
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div>
                <label className="field-label" htmlFor="itemQuantity">Quantidade *</label>
                <input
                  id="itemQuantity"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={itemForm.quantity}
                  onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="itemUnit">Unidade *</label>
                <select
                  id="itemUnit"
                  className="select"
                  value={itemForm.unit}
                  onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                  required
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>

            <label className="field-label" htmlFor="itemNotes" style={{ marginTop: 12 }}>
              Notas
            </label>
            <textarea
              id="itemNotes"
              className="textarea"
              rows={3}
              value={itemForm.notes}
              onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
            />

                        <fieldset style={{ marginTop: 16, padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
                          <legend style={{ padding: '0 6px', fontSize: 12, fontWeight: 600 }}>Incoterm e destino por item</legend>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13 }}>
                            <input
                              type="checkbox"
                              checked={itemForm.inheritIncoterm}
                              onChange={(e) => setItemForm({ ...itemForm, inheritIncoterm: e.target.checked })}
                            />
                            Usar o INCOTERM da cotação ({qr.desiredIncoterm})
                          </label>
                          {!itemForm.inheritIncoterm && (
                            <div style={{ marginBottom: 8 }}>
                              <label className="field-label" htmlFor="itemIncoterm">INCOTERM deste item *</label>
                              <select
                                id="itemIncoterm"
                                className="select"
                                value={itemForm.desiredIncoterm}
                                onChange={(e) =>
                                  setItemForm({ ...itemForm, desiredIncoterm: e.target.value as Incoterm })
                                }
                              >
                                <option value="">Selecione…</option>
                                {INCOTERMS.map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13 }}>
                            <input
                              type="checkbox"
                              checked={itemForm.inheritPort}
                              onChange={(e) => setItemForm({ ...itemForm, inheritPort: e.target.checked })}
                            />
                            Usar o porto da cotação ({qr.destinationPort || 'não definido'})
                          </label>
                          {!itemForm.inheritPort && (
                            <div>
                              <label className="field-label" htmlFor="itemPort">Porto de destino deste item *</label>
                              <input
                                id="itemPort"
                                className="input"
                                value={itemForm.destinationPort}
                                onChange={(e) => setItemForm({ ...itemForm, destinationPort: e.target.value })}
                                placeholder="Ex.: Porto de Santos"
                                maxLength={120}
                              />
                            </div>
                          )}
                        </fieldset>

                        {itemError && (
              <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{itemError}</p>
            )}

            <div className="modal__actions">
              <button type="button" className="ghost-button" onClick={closeItemModal}>
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={createItem.isPending || updateItem.isPending}
              >
                {editingItem ? 'Salvar alterações' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showEditModal && editForm && (
        <div className="modal-backdrop" onClick={closeEditModal}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleEditSubmit}
          >
            <h2>Editar cotação</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="field-label" htmlFor="qrIncoterm">Incoterm desejado *</label>
                <select
                  id="qrIncoterm"
                  className="select"
                  value={editForm.desiredIncoterm}
                  onChange={(e) =>
                    setEditForm({ ...editForm, desiredIncoterm: e.target.value as Incoterm })
                  }
                >
                  {INCOTERMS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="qrOriginPort">Porto de embarque</label>
                <input
                  id="qrOriginPort"
                  className="input"
                  value={editForm.originPort}
                  onChange={(e) => setEditForm({ ...editForm, originPort: e.target.value })}
                  placeholder="Ex.: Shanghai"
                  maxLength={120}
                />
              </div>
              <div>
                              <label className="field-label" htmlFor="qrDestinationPort">Porto de destino</label>
                <input
                                id="qrDestinationPort"
                  className="input"
                                value={editForm.destinationPort}
                                onChange={(e) => setEditForm({ ...editForm, destinationPort: e.target.value })}
                                placeholder="Ex.: Porto de Santos"
                                maxLength={120}
                />
              </div>
                            <div>
                              <label className="field-label" htmlFor="qrCurrency">Moeda *</label>
                              <input
                                id="qrCurrency"
                                className="input"
                                value={editForm.currency}
                                onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })}
                                maxLength={3}
                                required
                              />
                            </div>
              <div>
                <label className="field-label" htmlFor="qrDeadline">Prazo</label>
                <input
                  id="qrDeadline"
                  className="input"
                  type="date"
                  value={editForm.deadlineAt}
                  onChange={(e) => setEditForm({ ...editForm, deadlineAt: e.target.value })}
                />
              </div>
            </div>

            <label className="field-label" htmlFor="qrDescription" style={{ marginTop: 12 }}>
              Descrição
            </label>
            <textarea
              id="qrDescription"
              className="textarea"
              rows={3}
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            />

            {editError && (
              <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{editError}</p>
            )}

            <div className="modal__actions">
              <button type="button" className="ghost-button" onClick={closeEditModal}>
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={updateQuote.isPending}
              >
                {updateQuote.isPending ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
      );
    }