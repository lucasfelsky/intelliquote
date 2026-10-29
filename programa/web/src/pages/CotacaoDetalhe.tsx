import { useConfirm } from '@/components/useConfirm';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import {
  generatePortalTokens,
  listPortalTokens,
  regeneratePortalToken,
  previewDispatch,
  revokePortalToken,
  sendDispatch,
  type DispatchRecipientPreview,
  type DispatchSendResult,
  type PortalTokenListItem,
} from '@/services/dispatch';
import { Tabs, TabList, Tab, TabPanel } from '@/components/Tabs';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/icons';
import { Stepper } from '@/components/Stepper';
import { CatalogItemPicker, type PickerCatalogItem } from '@/components/CatalogItemPicker';
import { useCatalogItemPickerData } from '@/components/useCatalogItemPickerData';
import { RespostasTab } from './CotacaoTabs/RespostasTab';
import { ComparacaoTab } from './CotacaoTabs/ComparacaoTab';
import { ItensTab } from './CotacaoTabs/ItensTab';
import { SolicitacaoDesenvolvimentoPanel } from './CotacaoTabs/SolicitacaoDesenvolvimentoPanel';
import type { PurchaseOrder } from '@/services/purchaseOrders';

type QuoteStatus = 'open' | 'closed';
type Incoterm = 'EXW' | 'FCA' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP';

interface QuoteRequest {
  id: number;
  requestCode: string;
  productName: string | null;
  quantity: number | null;
  description: string | null;
  desiredIncoterm: Incoterm[];
  destinationPort: string | null;
  originPort: string | null;
  currency: string;
  deadlineAt: string | null;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  createdById: number | null;
  /** Veio de solicitacao de desenvolvimento do comercial (item novo). */
  isDevelopment?: boolean;
  items?: QuoteRequestItem[];
  purchaseOrders?: PurchaseOrder[];
  dispatchCount?: number;
  quoteResponses?: QuoteResponseSummary[];
}

interface CatalogItemLite {
  id: number;
  commercialName: string;
  marketName: string;
  familyId: number | null;
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
  purchaseOrderId: number | null;
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
  freightCost?: number;
  totalLandedCost?: number;
  paymentTermsDays?: number;
  targetPrice?: number | null;
  items?: {
    quoteRequestItemId: number;
    isDangerousGood?: boolean;
    isUnavailable?: boolean;
  }[];
  isWinner?: boolean;
}

// DG vem da resposta do fornecedor (nao do catalogo): quantas respostas ativas marcaram cada item
// como DG; item indisponivel na resposta nao conta.
function buildDgCountByItemId(
  responses: QuoteResponseSummary[] | undefined,
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const response of responses ?? []) {
    for (const item of response.items ?? []) {
      if (item.isDangerousGood && !item.isUnavailable) {
        counts[item.quoteRequestItemId] = (counts[item.quoteRequestItemId] ?? 0) + 1;
      }
    }
  }
  return counts;
}

interface QuoteRequestForm {
  description: string;
  desiredIncoterm: Incoterm[];
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

function parseContactsBySupplier(
  data: { bySupplier?: Record<string, unknown[]> } | undefined,
): Record<number, Array<{ id: number; name: string; email: string; isPrimary: boolean }>> {
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
}

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

function asIncoterms(value: unknown): Incoterm[] {
  const arr = Array.isArray(value) ? value : [];
  const parsed = arr.map(asIncoterm).filter((t, i, self) => self.indexOf(t) === i);
  return parsed.length > 0 ? parsed : ['EXW'];
}

function formatIncoterms(incoterms: Incoterm[]): string {
  return incoterms.join(' / ');
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
    desiredIncoterm: asIncoterms(obj.desiredIncoterm),
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
      purchaseOrders: Array.isArray(obj.purchaseOrders) ? (obj.purchaseOrders as PurchaseOrder[]) : [],
      dispatchCount: Number((obj._count as { dispatchEvents?: unknown } | undefined)?.dispatchEvents ?? 0) || 0,
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
    purchaseOrderId:
      typeof obj.purchaseOrderId === 'number' ? obj.purchaseOrderId : null,
    catalogItem: catalog
      ? {
          id: Number(catalog.id),
          commercialName: String(catalog.commercialName ?? ''),
          marketName: String(catalog.marketName ?? ''),
          familyId: typeof catalog.familyId === 'number' ? catalog.familyId : null,
        }
      : null,
    createdAt: String(obj.createdAt ?? ''),
    updatedAt: String(obj.updatedAt ?? ''),
  };
}

const emptyItemForm: ItemForm = {
  catalogItemId: null,
  quantity: '',
  unit: 'KG',
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

const DISPATCH_PREVIEW_DEBOUNCE_MS = 600;

// Mesma normalizacao que o envio usa (trim no service + `Number(expires) || 7`),
// para o preview refletir exatamente o que "Enviar agora" vai mandar.
function normalizeDispatchPreviewInputs(subject: string, message: string, expires: string) {
  return {
    subject: subject.trim(),
    message: message.trim(),
    expiresInDays: Number(expires) || 7,
  };
}

export default function CotacaoDetalhe() {
  const confirm = useConfirm();
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const id = Number(params.id);

  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<QuoteRequestItem | null>(null);
  const [newItemPoId, setNewItemPoId] = useState<number | null>(null);
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<PickerCatalogItem | null>(null);
  const picker = useCatalogItemPickerData(showItemModal);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm);
  const [itemError, setItemError] = useState<string | null>(null);

    const [showEditModal, setShowEditModal] = useState(false);
    const [editForm, setEditForm] = useState<QuoteRequestForm | null>(null);
    const [editError, setEditError] = useState<string | null>(null);

    const [showDispatchModal, setShowDispatchModal] = useState(false);
    const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);
    const [activeFolderId, setActiveFolderId] = useState<number | 'all' | 'none'>('all');
    const [supplierSearch, setSupplierSearch] = useState('');
    const [dispatchSubject, setDispatchSubject] = useState('');
    const [dispatchMessage, setDispatchMessage] = useState('');
    const [dispatchExpires, setDispatchExpires] = useState('7');
    const [dispatchComexCcFirstOnly, setDispatchComexCcFirstOnly] = useState(true);
    const [dispatchError, setDispatchError] = useState<string | null>(null);
    const [dispatchStep, setDispatchStep] = useState<'select' | 'preview' | 'sent'>('select');
    const [dispatchPreview, setDispatchPreview] = useState<{
      recipients: DispatchRecipientPreview[];
      preview: { subject: string; html: string; text: string } | null;
      cc: Array<{ email: string; name?: string }>;
    } | null>(null);
    const [dispatchPreviewInputs, setDispatchPreviewInputs] = useState<
      ReturnType<typeof normalizeDispatchPreviewInputs> | null
    >(null);
    const [dispatchResult, setDispatchResult] = useState<DispatchSendResult | null>(null);

  // Tokens do portal (links magicos) ja gerados para esta cotacao. Cada
  // entrada eh um link unico por contato de fornecedor; o admin pode
  // copiar a URL e revogar quando quiser.
  const [showTokensModal, setShowTokensModal] = useState(false);
  const [tokenActionError, setTokenActionError] = useState<string | null>(null);
  const [copiedTokenId, setCopiedTokenId] = useState<number | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('resumo');

    const canEdit = user?.role === 'admin' || user?.role === 'comprador';
    const canManageStatus = user?.role === 'admin' || user?.role === 'gestor';
    const canDelete = user?.role === 'admin';
    const canDispatch = canEdit;
    const canManagePortalLinks = canEdit || user?.role === 'gestor';

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
        if (newItemPoId !== null) {
          body.purchaseOrderId = newItemPoId;
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
        // O backend limita pageSize a 100 (utils/http.ts): percorre todas as
        // paginas para nao cortar fornecedores ativos alem do teto.
        type SuppliersPage = {
          data?: unknown[];
          items?: unknown[];
          pagination?: { totalPages?: number };
        };
        const PAGE_SIZE = 100;
        // Guarda contra loop infinito SOMENTE para resposta sem totalPages.
        const MAX_PAGES_WITHOUT_TOTAL = 50;
        const raw: unknown[] = [];
        const seenIds = new Set<unknown>();
        for (let page = 1; ; page += 1) {
          const res = await api.get<unknown[] | SuppliersPage>('/v1/suppliers', {
            status: 'active',
            page: String(page),
            pageSize: String(PAGE_SIZE),
          });
          if (Array.isArray(res)) {
            // Formato legado (lista simples, sem paginacao): ja veio completo.
            raw.push(...res);
            break;
          }
          const rows = Array.isArray(res?.data) ? res.data : (res?.items ?? []);
          for (const row of rows) {
            const rowId = (row as Record<string, unknown> | null)?.id;
            if (rowId != null) {
              if (seenIds.has(rowId)) continue;
              seenIds.add(rowId);
            }
            raw.push(row);
          }
          const totalPages = res?.pagination?.totalPages;
          if (typeof totalPages === 'number') {
            // Servidor informa o total: itera ate a ultima pagina.
            if (page >= totalPages) break;
          } else {
            if (rows.length < PAGE_SIZE) break;
            if (page >= MAX_PAGES_WITHOUT_TOTAL) {
              throw new Error(
                'Resposta de fornecedores sem total de paginas excedeu o limite de seguranca.',
              );
            }
          }
        }
        return raw.map((s) => {
          const obj = s as Record<string, unknown>;
          const familiesRaw = Array.isArray(obj.families) ? obj.families : [];
          return {
            id: Number(obj.id),
            name: String(obj.name ?? ''),
            status: String(obj.status ?? 'active'),
            families: familiesRaw.map((f) => {
              const fo = f as Record<string, unknown>;
              return { id: Number(fo.id), name: String(fo.name ?? '') };
            }),
          };
        });
      },
      enabled: showDispatchModal,
    });

    const itemFamiliesQuery = useQuery({
      queryKey: ['item-families-dispatch'],
      queryFn: async () => {
        const data = await api.get<{ data?: unknown[] }>('/v1/item-families');
        const raw = Array.isArray(data?.data) ? data.data : [];
        const map = new Map<number, string>();
        for (const f of raw) {
          const fo = f as Record<string, unknown>;
          map.set(Number(fo.id), String(fo.name ?? ''));
        }
        return map;
      },
      enabled: showDispatchModal,
    });

    const supplierContacts = useQuery({
      queryKey: ['supplier-contacts-bulk-dispatch', activeSuppliers.data?.map((s) => s.id).join(',')],
      queryFn: async () => {
        const ids = activeSuppliers.data?.map((s) => s.id) ?? [];
        if (ids.length === 0) return {} as Record<number, Array<{ id: number; name: string; email: string; isPrimary: boolean }>>;
        // Lotes de ate 100 ids por chamada (evita estourar o limite de URL);
        // cada resposta traz { bySupplier } e os ids sao disjuntos entre lotes.
        const CONTACTS_BATCH_SIZE = 100;
        const bySupplier: Record<string, unknown[]> = {};
        for (let i = 0; i < ids.length; i += CONTACTS_BATCH_SIZE) {
          const batch = ids.slice(i, i + CONTACTS_BATCH_SIZE);
          const data = await api.get<{ bySupplier?: Record<string, unknown[]> }>(
            '/v1/supplier-contacts',
            { supplierIds: batch.join(',') },
          );
          Object.assign(bySupplier, data?.bySupplier ?? {});
        }
        return parseContactsBySupplier({ bySupplier });
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

    // Master-detail do passo "select": pastas = familias, coluna direita =
    // fornecedores da pasta ativa. quoteFamilyIds vem dos itens da cotacao
    // (catalogItem.familyId); otherFolders sao familias presentes em algum
    // fornecedor ativo mas fora da cotacao.
    const quoteFamilyIds = useMemo(() => {
      const ids = new Set<number>();
      for (const it of detail.data?.items ?? []) {
        const familyId = it.catalogItem?.familyId;
        if (typeof familyId === 'number') ids.add(familyId);
      }
      return Array.from(ids);
    }, [detail.data]);

    const quoteFolders = useMemo(() => {
      const namesMap = itemFamiliesQuery.data;
      return quoteFamilyIds
        .map((fid) => ({ id: fid, name: namesMap?.get(fid) ?? `Família #${fid}` }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }, [quoteFamilyIds, itemFamiliesQuery.data]);

    const otherFolders = useMemo(() => {
      const quoteSet = new Set(quoteFamilyIds);
      const names = new Map<number, string>();
      for (const s of activeSuppliers.data ?? []) {
        for (const f of s.families) {
          if (!quoteSet.has(f.id)) names.set(f.id, f.name);
        }
      }
      return Array.from(names.entries())
        .map(([fid, name]) => ({ id: fid, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }, [activeSuppliers.data, quoteFamilyIds]);

    const folderCounts = useMemo(() => {
      const suppliers = activeSuppliers.data ?? [];
      const counts = new Map<number | 'all' | 'none', number>();
      counts.set('all', suppliers.length);
      let noneCount = 0;
      for (const s of suppliers) {
        if (s.families.length === 0) noneCount += 1;
        for (const f of s.families) {
          counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
        }
      }
      counts.set('none', noneCount);
      return counts;
    }, [activeSuppliers.data]);

    const hasSupplierWithoutFamily = (folderCounts.get('none') ?? 0) > 0;

    const visibleSuppliers = useMemo(() => {
      const suppliers = activeSuppliers.data ?? [];
      const search = supplierSearch.trim().toLowerCase();
      return suppliers.filter((s) => {
        if (activeFolderId === 'none') {
          if (s.families.length !== 0) return false;
        } else if (activeFolderId !== 'all') {
          if (!s.families.some((f) => f.id === activeFolderId)) return false;
        }
        if (search && !s.name.toLowerCase().includes(search)) return false;
        return true;
      });
    }, [activeSuppliers.data, activeFolderId, supplierSearch]);

    const activeFolderLabel = useMemo(() => {
      if (activeFolderId === 'all') return 'Todos';
      if (activeFolderId === 'none') return 'Sem família';
      return (
        quoteFolders.find((f) => f.id === activeFolderId)?.name ??
        otherFolders.find((f) => f.id === activeFolderId)?.name ??
        `Família #${activeFolderId}`
      );
    }, [activeFolderId, quoteFolders, otherFolders]);

    const previewDispatchMutation = useMutation({
      mutationFn: () =>
        previewDispatch(
          id,
          selectedContactIds,
          normalizeDispatchPreviewInputs(dispatchSubject, dispatchMessage, dispatchExpires),
        ),
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
        // Semeia o cache do preview ao vivo com este resultado: entrar no passo
        // preview nao dispara uma requisicao duplicada.
        const normalized = normalizeDispatchPreviewInputs(
          dispatchSubject,
          dispatchMessage,
          dispatchExpires,
        );
        const baseline = {
          ...normalized,
          subject: normalized.subject || data.preview?.subject || '',
        };
        qc.setQueryData(['dispatch-preview', id, selectedContactIds, baseline], data);
        setDispatchPreviewInputs(baseline);
        setDispatchStep('preview');
      },
      onError: (err) => setDispatchError(messageOf(err)),
    });

    // Preview ao vivo: assunto/mensagem/validade (debounce) atualizam o iframe.
    useEffect(() => {
      if (!showDispatchModal || dispatchStep !== 'preview') return;
      const timer = setTimeout(() => {
        setDispatchPreviewInputs(
          normalizeDispatchPreviewInputs(dispatchSubject, dispatchMessage, dispatchExpires),
        );
      }, DISPATCH_PREVIEW_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }, [showDispatchModal, dispatchStep, dispatchSubject, dispatchMessage, dispatchExpires]);

    const dispatchPreviewQuery = useQuery({
      queryKey: ['dispatch-preview', id, selectedContactIds, dispatchPreviewInputs],
      queryFn: () => previewDispatch(id, selectedContactIds, dispatchPreviewInputs!),
      enabled: showDispatchModal && dispatchStep === 'preview' && dispatchPreviewInputs !== null,
      placeholderData: keepPreviousData,
      staleTime: 30_000,
      retry: false,
    });

    // Preview desatualizado: campos atuais != debounced (debounce pendente) ou
    // requisicao da key atual em andamento. Se o refresh da key atual der erro, libera
    // o envio (o aviso de erro ja informa que o preview pode estar desatualizado).
    const currentPreviewInputs = normalizeDispatchPreviewInputs(
      dispatchSubject,
      dispatchMessage,
      dispatchExpires,
    );
    const previewInputsPending =
      dispatchPreviewInputs !== null &&
      (currentPreviewInputs.subject !== dispatchPreviewInputs.subject ||
        currentPreviewInputs.message !== dispatchPreviewInputs.message ||
        currentPreviewInputs.expiresInDays !== dispatchPreviewInputs.expiresInDays);
    const previewStale =
      previewInputsPending ||
      (!dispatchPreviewQuery.isError &&
        (dispatchPreviewQuery.isFetching || dispatchPreviewQuery.isPlaceholderData));

    // `dispatchPreview` continua sendo o ultimo preview bom: se o refresh falhar,
    // o iframe mantem o ultimo HTML valido.
    useEffect(() => {
      const data = dispatchPreviewQuery.data;
      if (data && !dispatchPreviewQuery.isPlaceholderData) {
        setDispatchPreview({
          recipients: data.recipients,
          preview: data.preview,
          cc: data.cc ?? [],
        });
      }
    }, [dispatchPreviewQuery.data, dispatchPreviewQuery.isPlaceholderData]);

    // O Modal abre o <dialog> num efeito do pai (depois dos filhos): foca o campo útil
    // (Quantidade na edição, busca no Novo item) só depois disso.
    useEffect(() => {
      if (!showItemModal) return;
      const timer = setTimeout(() => {
        document.getElementById(editingItem ? 'itemQuantity' : 'catalogItemSearch')?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }, [showItemModal, editingItem]);

    const sendDispatchMutation = useMutation({
      mutationFn: () =>
        sendDispatch(id, selectedContactIds, {
          subject: dispatchSubject,
          message: dispatchMessage,
          expiresInDays: Number(dispatchExpires) || 7,
          comexCcFirstOnly: dispatchComexCcFirstOnly,
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

    const regenerateTokenMutation = useMutation({
      mutationFn: (tokenId: number) => regeneratePortalToken(tokenId),
      onError: (err) => setTokenActionError(messageOf(err)),
    });

    // O raw token só existe no momento da geração (o banco guarda apenas o
    // hash). Por isso o botão gera um link novo, revogando o anterior.
    async function regenerateAndCopy(token: PortalTokenListItem) {
      if (
        !(await confirm(
          `Gerar novo link para ${token.contact.name}? O link anterior deixa de funcionar imediatamente.`,
        ))
      ) {
        return;
      }
      setTokenActionError(null);
      let created: { id: number; portalUrl: string };
      try {
        created = await regenerateTokenMutation.mutateAsync(token.id);
      } catch {
        return;
      }
      qc.invalidateQueries({ queryKey: ['portal-tokens', id] });
      const url = created.portalUrl;
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
        setCopiedTokenId(created.id);
        window.setTimeout(() => {
          setCopiedTokenId((current) => (current === created.id ? null : current));
        }, 2000);
      } catch (err) {
        setTokenActionError(
          err instanceof Error ? err.message : 'Falha ao copiar o link.',
        );
      }
    }

  function openNewItem(purchaseOrderId: number | null = null) {
    setNewItemPoId(purchaseOrderId);
    setEditingItem(null);
    setItemForm(emptyItemForm);
    setItemError(null);
    setSelectedCatalogItem(null);
    picker.reset();
    setShowItemModal(true);
  }

  function openEditItem(item: QuoteRequestItem) {
    setEditingItem(item);
      const hasIncoterm = !!item.desiredIncoterm;
      // O backend materializa o porto da cotação no item: porto igual ao da cotação = herdado.
      const quotePort = (detail.data?.destinationPort ?? '').trim().toLowerCase();
      const itemPort = (item.destinationPort ?? '').trim().toLowerCase();
      const inheritPort = itemPort === '' || itemPort === quotePort;
      setItemForm({
        catalogItemId: item.catalogItemId,
        quantity: String(item.quantity),
        unit: item.unit,
        notes: item.notes ?? '',
        desiredIncoterm: item.desiredIncoterm ?? '',
        destinationPort: inheritPort ? '' : (item.destinationPort ?? ''),
        inheritIncoterm: !hasIncoterm,
        inheritPort,
      });
      setItemError(null);
      picker.reset();
      setSelectedCatalogItem({
        id: item.catalogItem?.id ?? item.catalogItemId ?? 0,
        commercialName: item.catalogItem?.commercialName ?? item.productName,
        marketName: item.catalogItem?.marketName ?? '',
        family: null,
      });
      setShowItemModal(true);
    }

  function closeItemModal() {
    setShowItemModal(false);
    setEditingItem(null);
    setItemForm(emptyItemForm);
    setItemError(null);
    setSelectedCatalogItem(null);
    picker.reset();
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
      setActiveFolderId('all');
      setSupplierSearch('');
      setDispatchSubject('');
      setDispatchMessage('');
      setDispatchExpires('7');
      setDispatchComexCcFirstOnly(true);
      setDispatchPreview(null);
      setDispatchPreviewInputs(null);
      setDispatchResult(null);
      setDispatchError(null);
      setShowDispatchModal(true);
    }

    function closeDispatchModal() {
      setShowDispatchModal(false);
      setDispatchError(null);
    }

    function closeTokensModal() {
      setShowTokensModal(false);
      setTokenActionError(null);
      setCopiedTokenId(null);
    }

    function toggleContactSelection(contactId: number) {
      setSelectedContactIds((current) =>
        current.includes(contactId)
          ? current.filter((id) => id !== contactId)
          : [...current, contactId],
      );
    }

    function selectAllVisibleSuppliers() {
      const idsToAdd: number[] = [];
      for (const supplier of visibleSuppliers) {
        const contacts = supplierContacts.data?.[supplier.id] ?? [];
        if (contacts.length === 0) continue;
        const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
        if (primary && !selectedContactIds.includes(primary.id)) {
          idsToAdd.push(primary.id);
        }
      }
      if (idsToAdd.length > 0) {
        setSelectedContactIds((current) => [...current, ...idsToAdd]);
      }
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

    function toggleEditIncoterm(term: Incoterm) {
      setEditForm((current) => {
        if (!current) return current;
        const has = current.desiredIncoterm.includes(term);
        return {
          ...current,
          desiredIncoterm: has
            ? current.desiredIncoterm.filter((t) => t !== term)
            : [...current.desiredIncoterm, term],
        };
      });
    }

    function handleEditSubmit(e: React.FormEvent) {
      e.preventDefault();
      if (!editForm) return;
      setEditError(null);
      if (!editForm.currency.trim()) {
        setEditError('Informe a moeda (código de 3 letras).');
        return;
      }
      if (editForm.desiredIncoterm.length === 0) {
        setEditError('Selecione ao menos um incoterm aceitável.');
        return;
      }
      updateQuote.mutate(editForm);
    }

  if (!Number.isFinite(id)) {
    return (
      <div className="page cotacao-detalhe-page">
        <h1>Cotação</h1>
        <div className="empty-state cotacao-detalhe__estado">
          <p>Identificador de cotação inválido.</p>
        </div>
      </div>
    );
  }

  if (detail.isLoading) {
    return (
      <div className="page cotacao-detalhe-page">
        <h1>Cotação</h1>
        <div className="empty-state cotacao-detalhe__estado">
          <p className="empty-state__text">Carregando…</p>
        </div>
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="page cotacao-detalhe-page">
        <h1>Cotação</h1>
        <div
          className="empty-state empty-state--erro cotacao-detalhe__estado"
          role="alert"
        >
          <span className="empty-state__icon">
            <Icon name="alert-triangle" size={24} strokeWidth={1.7} />
          </span>
          <strong className="empty-state__title">Não foi possível carregar a cotação.</strong>
          <p className="empty-state__text">Verifique sua conexão e tente novamente.</p>
          <button className="ghost-button" onClick={() => detail.refetch()}>
            <Icon name="refresh" size={14} strokeWidth={2} />
            Tentar novamente
          </button>
        </div>
        <button type="button" className="ghost-button" onClick={() => navigate('/cotacoes')}>
          Voltar para a lista
        </button>
      </div>
    );
  }

  const qr = detail.data;
  const items = (qr.items ?? []).map(normalizeItem);

  return (
    <div className="page cotacao-detalhe-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Cotação #{qr.id}</p>
          <h1>{qr.requestCode}</h1>
          <p>{qr.productName}</p>
        </div>
        <div className="page-header__actions">
          <span className={`badge badge--dot ${qr.status === 'closed' ? 'badge--muted' : 'badge--success'}`}>
            {qr.status === 'open' ? 'Aberta' : 'Fechada'}
          </span>
          {qr.isDevelopment && <span className="badge badge--info">Desenvolvimento</span>}
          {canDispatch && qr.status === 'open' && items.length > 0 && (
            <button
              type="button"
              className="primary-button"
              onClick={openDispatchModal}
            >
              <Icon name="templates" size={16} />
              Enviar cotação
            </button>
          )}
          {canManagePortalLinks && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowTokensModal(true)}
            >
              <Icon name="link" size={16} />
              Links do portal
            </button>
          )}
          {canEdit && qr.status === 'open' && (
            <button type="button" className="ghost-button" onClick={openEditQuote}>
              <Icon name="edit" size={16} />
              Editar
            </button>
          )}
          {canManageStatus && qr.status === 'open' && (
            <button
              type="button"
              className="ghost-button"
              onClick={async () => {
                if (await confirm(`Fechar a cotação ${qr.requestCode}?`)) {
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
              onClick={async () => {
                if (await confirm(`Reabrir a cotação ${qr.requestCode}?`)) {
                  reopenRequest.mutate();
                }
              }}
              disabled={reopenRequest.isPending}
            >
              <Icon name="refresh" size={16} />
              Reabrir
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="ghost-button danger-button"
              onClick={async () => {
                if (await confirm(`Apagar a cotação ${qr.requestCode}?`)) {
                  deleteQuote.mutate();
                }
              }}
              disabled={deleteQuote.isPending}
            >
              <Icon name="trash" size={16} />
              Apagar
            </button>
          )}
        </div>
      </div>

      {qr.isDevelopment && <SolicitacaoDesenvolvimentoPanel quoteRequestId={qr.id} />}

      {actionError && (
        <p className="alert alert--error" role="alert">{actionError}</p>
      )}


      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabList aria-label="Abas da cotação">
          <Tab value="resumo">Resumo</Tab>
          <Tab value="itens">Itens</Tab>
          <Tab value="respostas">Respostas</Tab>
          <Tab value="comparacao">Comparações</Tab>
        </TabList>

        <TabPanel value="resumo">
          <section className="card cotacao-detalhe__painel">
            <div className="cotacao-resumo">
              <h2>Resumo</h2>
              <dl className="cotacao-resumo__grade">
                <div className="cotacao-resumo__item cotacao-resumo__item--inicio">
                  <dt className="eyebrow">Código</dt>
                  <dd className="cotacao-resumo__mono">{qr.requestCode}</dd>
                </div>
                <div className="cotacao-resumo__item">
                  <dt className="eyebrow">Incoterms aceitáveis</dt>
                  <dd>
                    <div className="chip-row">
                      {qr.desiredIncoterm.map((t) => (
                        <span key={t} className="chip chip--static">{t}</span>
                      ))}
                    </div>
                  </dd>
                </div>
                <div className="cotacao-resumo__item">
                  <dt className="eyebrow">Porto de embarque</dt>
                  <dd>{qr.originPort ?? '—'}</dd>
                </div>
                <div className="cotacao-resumo__item cotacao-resumo__item--inicio">
                  <dt className="eyebrow">Porto de destino</dt>
                  <dd>{qr.destinationPort ?? '—'}</dd>
                </div>
                <div className="cotacao-resumo__item">
                  <dt className="eyebrow">Moeda</dt>
                  <dd className="cotacao-resumo__mono">{qr.currency}</dd>
                </div>
                <div className="cotacao-resumo__item">
                  <dt className="eyebrow">Prazo</dt>
                  <dd className="cotacao-resumo__mono">{formatDate(qr.deadlineAt)}</dd>
                </div>
                <div className="cotacao-resumo__item cotacao-resumo__item--cheia">
                  <dt className="eyebrow">Descrição</dt>
                  <dd className="cotacao-resumo__texto">{qr.description ?? '—'}</dd>
                </div>
                <div className="cotacao-resumo__item cotacao-resumo__item--inicio cotacao-resumo__item--fim">
                  <dt className="eyebrow">Criada em</dt>
                  <dd className="cotacao-resumo__mono">{formatDateTime(qr.createdAt)}</dd>
                </div>
                <div className="cotacao-resumo__item cotacao-resumo__item--fim">
                  <dt className="eyebrow">Fechada em</dt>
                  <dd className={qr.closedAt ? 'cotacao-resumo__mono' : 'cotacao-resumo__suave'}>
                    {qr.closedAt ? formatDateTime(qr.closedAt) : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        </TabPanel>

        <TabPanel value="itens">
          <section className="card cotacao-detalhe__painel">
            <ItensTab
              quoteRequestId={qr.id}
              status={qr.status}
              canEdit={canEdit}
              items={items}
              dgCountByItemId={buildDgCountByItemId(qr.quoteResponses)}
              purchaseOrders={qr.purchaseOrders ?? []}
              defaultIncoterm={formatIncoterms(qr.desiredIncoterm)}
              defaultPort={qr.destinationPort}
              hasResponsesOrDispatch={(qr.quoteResponses?.length ?? 0) > 0 || (qr.dispatchCount ?? 0) > 0}
              onAddItem={openNewItem}
              onEditItem={(it) => openEditItem(it as QuoteRequestItem)}
              onRemoveItem={async (it) => {
                if (await confirm(`Remover o item ${it.catalogItem?.commercialName ?? it.productName}?`)) {
                  removeItem.mutate(it.id);
                }
              }}
              removePending={removeItem.isPending}
            />
          </section>
        </TabPanel>

        <TabPanel value="respostas">
          <section className="card cotacao-detalhe__painel">
            <RespostasTab
              quoteRequestId={qr.id}
              quoteRequestStatus={qr.status}
              quoteRequestCurrency={qr.currency}
              productName={qr.productName}
              requestCode={qr.requestCode}
            />
          </section>
        </TabPanel>

        <TabPanel value="comparacao">
          <section className="card cotacao-detalhe__painel">
            <ComparacaoTab
              quoteRequestId={qr.id}
              quoteRequestStatus={qr.status}
              productName={qr.productName}
              requestCode={qr.requestCode}
            />
          </section>
        </TabPanel>
      </Tabs>


      <Modal
        isOpen={showDispatchModal}
        onClose={closeDispatchModal}
        size="wide"
        title="Enviar cotação para fornecedores"
        subtitle={
          <>
            <span className="cotacao-envio__codigo">{qr.requestCode}</span> · {qr.productName}
          </>
        }
      >
        {showDispatchModal && (
          <>
            <div className="cotacao-envio">
              <Stepper
                ariaLabel="Etapas do envio"
                steps={['Fornecedores', 'Mensagem e preview', 'Resultado']}
                current={dispatchStep === 'select' ? 0 : dispatchStep === 'preview' ? 1 : 2}
              />

              {dispatchStep === 'select' && (
                <>
                  <p className="cotacao-envio__ajuda">
                    Escolha uma pasta (família) e selecione os fornecedores. O contato principal
                    vai como &quot;Para&quot;; os demais do mesmo fornecedor entram em cópia.
                  </p>
                  {activeSuppliers.isLoading && <p className="cotacao-envio__ajuda">Carregando fornecedores…</p>}
                  {activeSuppliers.isError && (
                    <div className="empty-state" role="alert">
                      <strong>Não foi possível carregar os fornecedores.</strong>
                      <p>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void activeSuppliers.refetch()}
                        >
                          Tentar de novo
                        </button>
                      </p>
                    </div>
                  )}
                  {!activeSuppliers.isLoading && !activeSuppliers.isError && (activeSuppliers.data ?? []).length === 0 && (
                    <div className="empty-state">
                      <strong>Nenhum fornecedor ativo</strong>
                      <p>Cadastre fornecedores ativos com contatos antes de enviar.</p>
                    </div>
                  )}
                  {!activeSuppliers.isLoading && (activeSuppliers.data ?? []).length > 0 && (
                    <div className="dispatcher-master-detail">
                      <div className="dispatcher-folders">
                        <span className="dispatcher-folders__label">Pastas</span>
                        <button
                          type="button"
                          className={`folder${activeFolderId === 'all' ? ' folder--on' : ''}`}
                          onClick={() => setActiveFolderId('all')}
                        >
                          Todos
                          <span className="fcount">{folderCounts.get('all') ?? 0}</span>
                        </button>

                        {quoteFolders.length > 0 && (
                          <>
                            <span className="dispatcher-folders__group dispatcher-folders__group--quote">
                              Famílias desta cotação
                            </span>
                            {quoteFolders.map((folder) => (
                              <button
                                key={folder.id}
                                type="button"
                                className={`folder${activeFolderId === folder.id ? ' folder--on' : ''}`}
                                onClick={() => setActiveFolderId(folder.id)}
                              >
                                {folder.name}
                                <span className="fcount">{folderCounts.get(folder.id) ?? 0}</span>
                              </button>
                            ))}
                          </>
                        )}

                        {otherFolders.length > 0 && (
                          <>
                            <span className="dispatcher-folders__group">Outras famílias</span>
                            {otherFolders.map((folder) => (
                              <button
                                key={folder.id}
                                type="button"
                                className={`folder${activeFolderId === folder.id ? ' folder--on' : ''}`}
                                onClick={() => setActiveFolderId(folder.id)}
                              >
                                {folder.name}
                                <span className="fcount">{folderCounts.get(folder.id) ?? 0}</span>
                              </button>
                            ))}
                          </>
                        )}

                        {hasSupplierWithoutFamily && (
                          <button
                            type="button"
                            className={`folder${activeFolderId === 'none' ? ' folder--on' : ''}`}
                            onClick={() => setActiveFolderId('none')}
                          >
                            Sem família
                            <span className="fcount">{folderCounts.get('none') ?? 0}</span>
                          </button>
                        )}
                      </div>

                      <div className="dispatcher-suppliers">
                        <div className="cotacao-envio__busca">
                          <Icon name="search" size={16} strokeWidth={1.9} />
                          <input
                            className="cotacao-envio__campo"
                            placeholder="Buscar fornecedor por nome…"
                            value={supplierSearch}
                            onChange={(e) => setSupplierSearch(e.target.value)}
                            aria-label="Buscar fornecedor por nome"
                          />
                        </div>

                        <div className="dispatcher-suppliers__header">
                          <strong>Fornecedores · {activeFolderLabel}</strong>
                          <button type="button" className="ghost-button ghost-button--sm" onClick={selectAllVisibleSuppliers}>
                            Selecionar todos
                          </button>
                        </div>

                        {visibleSuppliers.length === 0 ? (
                          <div className="empty-state">
                            <strong>Nenhum fornecedor nesta pasta</strong>
                            <p>Ajuste a busca ou escolha outra pasta.</p>
                          </div>
                        ) : (
                          <div className="dispatcher-list">
                            {visibleSuppliers.map((supplier) => {
                              const contacts = supplierContacts.data?.[supplier.id] ?? [];
                              if (contacts.length === 0) {
                                return (
                                  <div key={supplier.id} className="dispatcher-row dispatcher-row--vazio">
                                    <span />
                                    <div>
                                      <div className="dispatcher-row__title">{supplier.name}</div>
                                      <div className="dispatcher-row__meta cotacao-envio__sem-contatos">Sem contatos cadastrados</div>
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
                                  <span className="cotacao-envio__destino">
                                    {siblingCount > 0 ? `Para + ${siblingCount} em CC` : 'Para'}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedContactIds.length > 0 && (
                    <div className="recipient-summary">
                      <span className="recipient-summary__pill recipient-summary__pill--total">
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
                    <p className="alert alert--error cotacao-envio__alerta" role="alert">
                      {dispatchError}
                    </p>
                  )}
                </>
              )}

              {dispatchStep === 'preview' && (
                <>
                  <div className="cotacao-envio__campos">
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
                        className="input cotacao-envio__numero"
                        type="number"
                        min="1"
                        max="60"
                        value={dispatchExpires}
                        onChange={(e) => setDispatchExpires(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="field-label" htmlFor="dispatchMessage">
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
                  </div>

                  <div className="cotacao-envio__copia">
                    <label className="cotacao-envio__check">
                      <input
                        type="checkbox"
                        checked={dispatchComexCcFirstOnly}
                        onChange={(e) => setDispatchComexCcFirstOnly(e.target.checked)}
                        aria-describedby="dispatchComexCcHelp"
                      />
                      Equipe COMEX em cópia só no primeiro e-mail
                    </label>
                    <p id="dispatchComexCcHelp" className="cotacao-envio__dica">
                      Ligado: só o 1º e-mail enviado leva a equipe COMEX e o CC fixo da empresa. Os contatos do próprio fornecedor continuam em cópia em todos.
                    </p>
                  </div>

                  <div className="cotacao-envio__resumos">
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
                      <div className="recipient-summary">
                        <span
                          className="recipient-summary__pill recipient-summary__pill--cc"
                          title={companyCcList.join(', ')}
                        >
                          CC fixo da empresa: {companyCcList.join(', ')}
                          {dispatchComexCcFirstOnly ? ' (só no 1º e-mail)' : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="cotacao-envio__previa">
                    <h3>
                      Preview do e-mail
                      {previewStale && (
                        <span className="cotacao-envio__atualizando" role="status">
                          <span className="cotacao-envio__giro" aria-hidden="true" />
                          Atualizando preview…
                        </span>
                      )}
                    </h3>
                    {dispatchPreview?.preview ? (
                      <iframe
                        sandbox=""
                        title="preview-email"
                        className="preview-frame"
                        srcDoc={dispatchPreview.preview.html}
                      />
                    ) : (
                      <p className="cotacao-envio__ajuda">
                        Nenhum preview disponivel (nenhum destinatario selecionado).
                      </p>
                    )}
                    {dispatchPreviewQuery.isError && (
                      <p className="alert alert--warning cotacao-envio__alerta">
                        Não foi possível atualizar o preview ({messageOf(dispatchPreviewQuery.error)}). O envio usa os campos atuais.
                      </p>
                    )}
                  </div>

                  {dispatchError && (
                    <p className="alert alert--error cotacao-envio__alerta" role="alert">
                      {dispatchError}
                    </p>
                  )}
                </>
              )}

              {dispatchStep === 'sent' && dispatchResult && (
                <>
                  <div
                    className={`dispatch-event cotacao-envio__resultado cotacao-envio__resultado--${dispatchResult.status}`}
                    role="status"
                  >
                    <span className="cotacao-envio__resultado-icone">
                      <Icon name={dispatchResult.status === 'completed' ? 'check' : 'alert-triangle'} size={20} />
                    </span>
                    <div className="cotacao-envio__resultado-corpo">
                      <div className="dispatch-event__header">
                        <span className="dispatch-event__subject">Resultado do envio</span>
                        <span
                          className={`badge badge--dot ${
                            dispatchResult.status === 'completed'
                              ? 'badge--success'
                              : dispatchResult.status === 'partial'
                                ? 'badge--warning'
                                : 'badge--danger'
                          }`}
                        >
                          {dispatchResult.status === 'completed'
                            ? 'Enviado'
                            : dispatchResult.status === 'partial'
                              ? 'Parcial'
                              : 'Falhou'}
                        </span>
                      </div>
                      <div className="cotacao-envio__contagem">
                        <span className="cotacao-envio__num">{dispatchResult.sentCount}</span> enviado(s) · <span className="cotacao-envio__num cotacao-envio__num--falha">{dispatchResult.failedCount}</span> falha(s)
                      </div>
                    </div>
                  </div>

                  <div className="table-wrapper cotacao-envio__tabela">
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
                            <tr key={r.supplierContactId} className={r.status === 'sent' ? undefined : 'cotacao-envio__linha-falha'}>
                              <td className="cotacao-envio__contato">{recipient ? `${recipient.supplierName} · ${recipient.contactName}` : `#${r.supplierContactId}`}</td>
                              <td>
                                <span
                                  className={`badge badge--dot ${r.status === 'sent' ? 'badge--success' : 'badge--danger'}`}
                                >
                                  {r.status === 'sent' ? 'Enviado' : 'Falhou'}
                                </span>
                              </td>
                              <td className={r.status === 'sent' ? 'cotacao-envio__detalhe' : 'cotacao-envio__detalhe cotacao-envio__detalhe--falha'}>
                                {r.error ??
                                  (r.status === 'sent'
                                    ? `Link magico gerado${r.ccCount ? ` · +${r.ccCount} CC` : ''}${dispatchComexCcFirstOnly && r.comexCc ? ' · cópia COMEX' : ''}`
                                    : '')}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {dispatchStep === 'select' && (
              <div className="modal-actions">
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
                  <Icon name="arrow-right" size={16} strokeWidth={2} />
                </button>
              </div>
            )}

            {dispatchStep === 'preview' && (
              <div className="modal-actions">
                <button type="button" className="ghost-button" onClick={() => setDispatchStep('select')}>
                  <Icon name="arrow-left" size={16} strokeWidth={2} />
                  Voltar
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={
                    sendDispatchMutation.isPending || selectedContactIds.length === 0 || previewStale
                  }
                  onClick={async () => {
                    if (await confirm(`Enviar a cotacao para ${selectedContactIds.length} destinatario(s)?`)) {
                      sendDispatchMutation.mutate();
                    }
                  }}
                >
                  <Icon name="templates" size={16} />
                  {sendDispatchMutation.isPending ? 'Enviando…' : 'Enviar agora'}
                </button>
              </div>
            )}

            {dispatchStep === 'sent' && dispatchResult && (
              <div className="modal-actions">
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
                  <Icon name="link" size={16} />
                  Gerenciar links
                </button>
                <button type="button" className="ghost-button" onClick={closeDispatchModal}>
                  Concluir
                </button>
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal isOpen={showTokensModal} onClose={closeTokensModal} size="wide" title="Links do portal">
        {showTokensModal && (
          <>
            <div className="cotacao-links">
              <p className="cotacao-links__intro">
                Gere links mágicos para que fornecedores respondam sem precisar de login.
                Cada link é único e expira conforme a validade escolhida.
              </p>

              {canDispatch && (
                <div className="cotacao-links__form">
                  <div className="cotacao-links__validade">
                    <label className="field-label" htmlFor="tokensExpires">
                      Validade (dias)
                    </label>
                    <input
                      id="tokensExpires"
                      className="input cotacao-links__numero"
                      type="number"
                      min={1}
                      max={90}
                      value={dispatchExpires}
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
                    <Icon name="link" size={16} />
                    {generateTokensMutation.isPending ? 'Gerando…' : 'Gerar para todos os fornecedores'}
                  </button>
                </div>
              )}

              {tokenActionError && (
                <p className="alert alert--error cotacao-links__alerta" role="alert">
                  {tokenActionError}
                </p>
              )}
              {generateTokensMutation.data && (
                <p className="cotacao-links__ok" role="status">
                  <Icon name="check" size={16} strokeWidth={2.2} />
                  <span>
                    {generateTokensMutation.data.generatedCount} link(s) novo(s) gerado(s)
                    {generateTokensMutation.data.alreadyActiveCount > 0 &&
                      ` · ${generateTokensMutation.data.alreadyActiveCount} ja estava(m) ativo(s)`}
                    .
                  </span>
                </p>
              )}

              {portalTokensQuery.isLoading && (
                <div className="cotacao-links__carregando" role="status">
                  <span className="cotacao-links__giro" aria-hidden="true" />
                  Carregando links…
                </div>
              )}
              {portalTokensQuery.data && activeTokens.length === 0 && (
                <div className="empty-state">
                  <span className="empty-state__icon">
                    <Icon name="link" size={36} strokeWidth={1.5} />
                  </span>
                  <strong className="empty-state__title">Nenhum link ativo</strong>
                  <p className="empty-state__text">
                    Gere links para que os fornecedores consigam responder esta cotação
                    pelo portal.
                  </p>
                </div>
              )}
              {activeTokens.length > 0 && (
                <div className="table-wrapper cotacao-links__tabela">
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
                              <span className="cotacao-links__contato">
                                <span className="cotacao-links__contato-nome">{token.contact.name}</span>
                                <span className="cotacao-links__contato-email">{token.contact.email}</span>
                              </span>
                            </td>
                            <td className="cotacao-links__expira">
                              {formatDateTime(token.expiresAt)}
                            </td>
                            <td>
                              {token.respondedAt ? (
                                <span className="badge badge--success badge--dot">Respondido</span>
                              ) : expired ? (
                                <span className="badge badge--warning badge--dot">Expirado</span>
                              ) : (
                                <span className="badge badge--muted badge--dot">Pendente</span>
                              )}
                            </td>
                            <td>
                              <div className="cotacao-links__acoes">
                                {canManagePortalLinks && !token.respondedAt && (
                                  <button
                                    type="button"
                                    className={`ghost-button${copiedTokenId === token.id ? ' cotacao-links__copiado' : ''}`}
                                    disabled={regenerateTokenMutation.isPending}
                                    onClick={() => regenerateAndCopy(token)}
                                  >
                                    {copiedTokenId === token.id && <Icon name="check" size={14} strokeWidth={2.2} />}
                                    {copiedTokenId === token.id ? 'Link novo copiado!' : 'Gerar novo link'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="ghost-button danger-button"
                                  disabled={revokePortalTokenMutation.isPending}
                                  onClick={async () => {
                                    if (
                                      await confirm(
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
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="primary-button" onClick={closeTokensModal}>
                Fechar
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        isOpen={showItemModal}
        onClose={closeItemModal}
        title={editingItem ? 'Editar item' : 'Novo item'}
        size={editingItem !== null ? undefined : 'wide'}
      >
        {showItemModal && (
        <form onSubmit={handleItemSubmit}>
          <CatalogItemPicker
            families={picker.families}
            familyItems={picker.familyItems}
            expanded={picker.expanded}
            onToggleFamily={picker.toggleFamily}
            isSearching={picker.isSearching}
            searchItems={picker.searchItems}
            selectedId={itemForm.catalogItemId}
            onSelect={(it) => {
              setItemForm({ ...itemForm, catalogItemId: it.id });
              setSelectedCatalogItem(it);
            }}
            search={picker.search}
            onSearchChange={picker.setSearch}
            selectedItem={selectedCatalogItem}
            disabled={editingItem !== null}
          >
            <div className="form-grid">
              <div>
                <label className="field-label" htmlFor="itemQuantity">Quantidade *</label>
                <input
                  id="itemQuantity"
                  className="input cotacao-item-form__quantidade"
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

            <fieldset className="cotacao-item-form__escopo">
              <legend>Incoterm e destino</legend>
              <label className="cotacao-item-form__opcao">
                <input
                  type="checkbox"
                  checked={itemForm.inheritIncoterm}
                  onChange={(e) => setItemForm({ ...itemForm, inheritIncoterm: e.target.checked })}
                />
                {qr.desiredIncoterm.length > 1 ? 'Usar os INCOTERMS da cotação' : 'Usar o INCOTERM da cotação'} (<span className="cotacao-item-form__incoterms">{formatIncoterms(qr.desiredIncoterm)}</span>)
              </label>
              {!itemForm.inheritIncoterm && (
                <div>
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
              <label className="cotacao-item-form__opcao">
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

            <div>
              <label className="field-label" htmlFor="itemNotes">Notas</label>
              <textarea
                id="itemNotes"
                className="textarea"
                rows={3}
                value={itemForm.notes}
                onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
              />
            </div>
          </CatalogItemPicker>

          {itemError && (
            <p className="alert alert--error item-form__error" role="alert">{itemError}</p>
          )}

          <div className="modal-actions">
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
        )}
      </Modal>

      <Modal isOpen={showEditModal} onClose={closeEditModal} title="Editar cotação">
        {editForm && (
          <form onSubmit={handleEditSubmit}>
            <div className="cotacao-detalhe__edicao">
              <div className="form-grid__full">
                <label className="field-label">Incoterms aceitáveis *</label>
                <div className="chip-row">
                  {INCOTERMS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`chip${editForm.desiredIncoterm.includes(t) ? ' chip--active' : ''}`}
                      onClick={() => toggleEditIncoterm(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
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
                  className="input cotacao-detalhe__moeda"
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

            <label className="field-label cotacao-detalhe__descricao" htmlFor="qrDescription">
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
              <p className="alert alert--error cotacao-detalhe__alerta" role="alert">{editError}</p>
            )}

            <div className="modal-actions">
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
        )}
      </Modal>
    </div>
      );
    }