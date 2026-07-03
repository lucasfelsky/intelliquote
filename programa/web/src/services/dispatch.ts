import { api, ApiError } from '@/api/client';

export interface SupplierContact {
  id: number;
  supplierId: number;
  name: string;
  email: string;
  phone?: string | null;
  position?: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierContactForm {
  name: string;
  email: string;
  phone: string;
  position: string;
  isPrimary: boolean;
}

const emptyForm: SupplierContactForm = {
  name: '',
  email: '',
  phone: '',
  position: '',
  isPrimary: false,
};

export function getEmptyContactForm(): SupplierContactForm {
  return { ...emptyForm };
}

export function normalizeContact(raw: unknown): SupplierContact {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Resposta inesperada do servidor.');
  }
  const obj = raw as Record<string, unknown>;
  return {
    id: Number(obj.id),
    supplierId: Number(obj.supplierId),
    name: String(obj.name ?? ''),
    email: String(obj.email ?? ''),
    phone: (obj.phone as string | null) ?? null,
    position: (obj.position as string | null) ?? null,
    isPrimary: Boolean(obj.isPrimary),
    createdAt: String(obj.createdAt ?? ''),
    updatedAt: String(obj.updatedAt ?? ''),
  };
}

export async function listSupplierContacts(supplierId: number): Promise<SupplierContact[]> {
  const data = await api.get<unknown[]>(
    `/v1/suppliers/${supplierId}/contacts`,
  );
  return (Array.isArray(data) ? data : []).map(normalizeContact);
}

export async function listSupplierContactsBulk(supplierIds: number[]) {
  if (supplierIds.length === 0) return {} as Record<number, SupplierContact[]>;
  const data = await api.get<{ bySupplier?: Record<string, unknown[]> }>(
    `/v1/supplier-contacts`,
    { supplierIds: supplierIds.join(',') },
  );
  const map: Record<number, SupplierContact[]> = {};
  const bySupplier = data?.bySupplier ?? {};
  for (const [key, list] of Object.entries(bySupplier)) {
    map[Number(key)] = (Array.isArray(list) ? list : []).map(normalizeContact);
  }
  return map;
}

export async function createSupplierContact(
  supplierId: number,
  payload: SupplierContactForm,
): Promise<SupplierContact> {
  const data = await api.post<unknown>(`/v1/suppliers/${supplierId}/contacts`, {
    name: payload.name.trim(),
    email: payload.email.trim(),
    phone: payload.phone.trim() || null,
    position: payload.position.trim() || null,
    isPrimary: payload.isPrimary,
  });
  return normalizeContact(data);
}

export async function updateSupplierContact(
  supplierId: number,
  contactId: number,
  payload: SupplierContactForm,
): Promise<SupplierContact> {
  const data = await api.put<unknown>(
    `/v1/suppliers/${supplierId}/contacts/${contactId}`,
    {
      name: payload.name.trim(),
      email: payload.email.trim(),
      phone: payload.phone.trim() || null,
      position: payload.position.trim() || null,
      isPrimary: payload.isPrimary,
    },
  );
  return normalizeContact(data);
}

export async function deleteSupplierContact(supplierId: number, contactId: number): Promise<void> {
  await api.del<void>(`/v1/suppliers/${supplierId}/contacts/${contactId}`);
}

export interface DispatchRecipientPreview {
  supplierContactId: number;
  supplierId: number;
  supplierName: string;
  contactName: string;
  contactEmail: string;
  ccCount: number;
  cc: Array<{ contactId: number; email: string; name: string }>;
}

export interface DispatchPreviewResult {
  recipientCount: number;
  recipients: DispatchRecipientPreview[];
  preview: { subject: string; html: string; text: string } | null;
  cc: Array<{ email: string; name?: string }>;
  // E-mails fixos em copia automatica configurados no perfil da empresa
  // (CompanyProfile.dispatchCc). Serao adicionados como CC em todos os
  // envios desta empresa, independente dos recipients selecionados.
  companyCc: string[];
}

export async function previewDispatch(
  quoteRequestId: number,
  recipientContactIds: number[],
): Promise<DispatchPreviewResult> {
  return api.post<DispatchPreviewResult>(
    `/v1/quote-requests/${quoteRequestId}/dispatch/preview`,
    { recipientContactIds },
  );
}

export interface DispatchTokenResult {
  supplierContactId: number;
  status: 'sent' | 'failed';
  error?: string;
  tokenId?: number;
  dispatchEventId: number;
  ccCount?: number;
}

export interface DispatchSendResult {
  dispatchEventId: number;
  status: 'completed' | 'partial' | 'failed';
  recipientsCount: number;
  sentCount: number;
  failedCount: number;
  results: DispatchTokenResult[];
}

export async function sendDispatch(
  quoteRequestId: number,
  recipientContactIds: number[],
  options: { subject?: string; message?: string; expiresInDays?: number } = {},
): Promise<DispatchSendResult> {
  return api.post<DispatchSendResult>(
    `/v1/quote-requests/${quoteRequestId}/dispatch`,
    {
      recipientContactIds,
      subject: options.subject?.trim() || undefined,
      message: options.message?.trim() || undefined,
      expiresInDays: options.expiresInDays ?? 7,
    },
  );
}

export interface DispatchEventListItem {
  id: number;
  recipientsCount: number;
  subject: string;
  ccList: string | null;
  status: 'in_progress' | 'completed' | 'partial' | 'failed';
  createdAt: string;
  tokens: Array<{
    id: number;
    supplier: { id: number; name: string };
    contact: { id: number; name: string; email: string };
    expiresAt: string;
    revokedAt: string | null;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    accessCount: number;
    respondedAt: string | null;
    response: {
      id: number;
      submittedAt: string;
      totalPrice: string;
      currency: string;
      totalPriceCurrency: string;
    } | null;
  }>;
}

export async function listDispatches(quoteRequestId: number): Promise<DispatchEventListItem[]> {
  const data = await api.get<unknown[]>(`/v1/quote-requests/${quoteRequestId}/dispatches`);
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const obj = raw as Record<string, unknown>;
    return {
      id: Number(obj.id),
      recipientsCount: Number(obj.recipientsCount ?? 0),
      subject: String(obj.subject ?? ''),
      ccList: (obj.ccList as string | null) ?? null,
      status: (obj.status as DispatchEventListItem['status']) ?? 'in_progress',
      createdAt: String(obj.createdAt ?? ''),
      tokens: Array.isArray(obj.tokens) ? (obj.tokens as DispatchEventListItem['tokens']) : [],
    };
  });
}

export interface PortalTokenListItem {
  id: number;
  supplier: { id: number; name: string };
  contact: { id: number; name: string; email: string };
  token: string;
  expiresAt: string;
  revokedAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  accessCount: number;
  respondedAt: string | null;
  createdAt: string;
}

export interface PortalTokenGenerateResult {
  tokens: Array<{
    supplierContactId: number;
    supplierName: string;
    contactName: string;
    contactEmail: string;
    token: PortalTokenListItem;
  }>;
  alreadyActiveCount: number;
  generatedCount: number;
}

export async function listPortalTokens(
  quoteRequestId: number,
): Promise<PortalTokenListItem[]> {
  const data = await api.get<unknown[]>(
    `/v1/quote-requests/${quoteRequestId}/portal-tokens`,
  );
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const obj = raw as Record<string, unknown>;
    const supplier = (obj.supplier as Record<string, unknown> | null) ?? null;
    const contact = (obj.contact as Record<string, unknown> | null) ?? null;
    return {
      id: Number(obj.id),
      supplier: {
        id: Number(supplier?.id ?? 0),
        name: String(supplier?.name ?? ''),
      },
      contact: {
        id: Number(contact?.id ?? 0),
        name: String(contact?.name ?? ''),
        email: String(contact?.email ?? ''),
      },
      token: String(obj.token ?? ''),
      expiresAt: String(obj.expiresAt ?? ''),
      revokedAt: (obj.revokedAt as string | null) ?? null,
      firstSeenAt: (obj.firstSeenAt as string | null) ?? null,
      lastSeenAt: (obj.lastSeenAt as string | null) ?? null,
      accessCount: Number(obj.accessCount ?? 0),
      respondedAt: (obj.respondedAt as string | null) ?? null,
      createdAt: String(obj.createdAt ?? ''),
    };
  });
}

export async function generatePortalTokens(
  quoteRequestId: number,
  supplierContactIds: number[],
  expiresInDays: number,
): Promise<PortalTokenGenerateResult> {
  return api.post<PortalTokenGenerateResult>(
    `/v1/quote-requests/${quoteRequestId}/portal-tokens`,
    { supplierContactIds, expiresInDays },
  );
}

export async function revokePortalToken(tokenId: number): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/v1/portal-tokens/${tokenId}/revoke`, {});
}

export interface QuoteResponseReplyResult {
  status: 'sent' | 'failed';
  to: string;
  cc: string[];
}

export async function replyToQuoteResponse(quoteResponseId: number): Promise<QuoteResponseReplyResult> {
  return api.post<QuoteResponseReplyResult>(`/v1/quote-responses/${quoteResponseId}/reply`, {});
}

export { ApiError };