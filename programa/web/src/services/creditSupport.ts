import { api } from '@/api/client';

// Credit Support: encaminhamento de uma resposta de fornecedor a um parceiro de
// credito (PR2a/PR2b no backend). O link bruto do portal do parceiro aparece
// SOMENTE no retorno de `forward`/`resend` e nunca e persistido no front.

export type CreditSupportStatus = 'sent' | 'responded' | 'expired' | 'revoked';

export const STATUS_LABELS: Record<CreditSupportStatus, string> = {
  sent: 'Enviado',
  responded: 'Respondido',
  expired: 'Expirado',
  revoked: 'Revogado',
};

export interface CreditSupportItem {
  quoteRequestItemId: number;
  position: number;
  productName: string;
  itemCode: string | null;
  unit: string;
  quantity: number;
  isUnavailable: boolean;
  originPort: string | null;
  isDangerousGood: boolean;
  // Decimais chegam como string com 2 casas (money()); null = indisponivel/sem preco.
  originalUnitPrice: string;
  originalTotalPrice: string;
  partnerUnitPrice: string | null;
  partnerTotalPrice: string | null;
  markupPercent: string | null;
}

export interface CreditSupportRequest {
  id: number;
  quoteResponseId: number;
  supplier: { id: number; name: string; country: string | null };
  partner: { id: number; name: string };
  recipientEmails: string[];
  status: CreditSupportStatus;
  isStale: boolean;
  expiresAt: string;
  createdAt: string;
  createdBy: { id: number; name: string };
  respondedAt: string | null;
  responseVersion: number;
  currency: string;
  offeredIncoterm: string;
  originPort: string | null;
  originalPaymentTermsDays: number;
  partnerPaymentTermsDays: number | null;
  partnerValidityDays: number | null;
  partnerNotes: string | null;
  totals: { original: string; partner: string | null; markupPercent: string | null };
  items: CreditSupportItem[];
}

export interface CreditSupportForwardInput {
  creditPartnerId?: number;
  contactIds?: number[];
  subject?: string;
  message?: string;
  ttlDays?: number;
}

export interface CreditSupportPreview {
  subject: string;
  html: string;
  text: string;
  partner: { id: number; name: string };
  recipients: { email: string; name: string }[];
  cc: string[];
  items: number;
}

export interface CreditSupportRecipientResult {
  email: string;
  status: 'sent' | 'failed';
}

export interface CreditSupportSendResult {
  id: number;
  status: CreditSupportStatus;
  expiresAt: string;
  portalUrl: string;
  recipients: CreditSupportRecipientResult[];
}

export interface CreditSupportResendResult {
  id: number;
  expiresAt: string;
  portalUrl: string;
  recipients: CreditSupportRecipientResult[];
}

export interface CreditSupportRevokeResult {
  id: number;
  status?: 'revoked';
  alreadyRevoked?: boolean;
}

export function creditSupportQueryKey(quoteRequestId: number) {
  return ['credit-support', quoteRequestId] as const;
}

// O Zod do backend rejeita `subject: ''` (min 1) e `contactIds: []` (min 1):
// chaves vazias/undefined sao omitidas do body.
export function buildForwardBody(input: CreditSupportForwardInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.creditPartnerId !== undefined) body.creditPartnerId = input.creditPartnerId;
  if (input.contactIds && input.contactIds.length > 0) body.contactIds = input.contactIds;
  const subject = input.subject?.trim();
  if (subject) body.subject = subject;
  const message = input.message?.trim();
  if (message) body.message = message;
  if (input.ttlDays !== undefined) body.ttlDays = input.ttlDays;
  return body;
}

export async function listCreditSupport(quoteRequestId: number): Promise<CreditSupportRequest[]> {
  const data = await api.get<unknown>(`/v1/quote-requests/${quoteRequestId}/credit-support`);
  return Array.isArray(data) ? (data as CreditSupportRequest[]) : [];
}

export function previewCreditSupport(
  quoteResponseId: number,
  input: CreditSupportForwardInput,
): Promise<CreditSupportPreview> {
  return api.post<CreditSupportPreview>(
    `/v1/quote-responses/${quoteResponseId}/credit-support/preview`,
    buildForwardBody(input),
  );
}

export function forwardCreditSupport(
  quoteResponseId: number,
  input: CreditSupportForwardInput,
): Promise<CreditSupportSendResult> {
  return api.post<CreditSupportSendResult>(
    `/v1/quote-responses/${quoteResponseId}/credit-support`,
    buildForwardBody(input),
  );
}

export function revokeCreditSupport(id: number): Promise<CreditSupportRevokeResult> {
  return api.post<CreditSupportRevokeResult>(`/v1/credit-support-requests/${id}/revoke`);
}

export function resendCreditSupport(id: number, ttlDays?: number): Promise<CreditSupportResendResult> {
  return api.post<CreditSupportResendResult>(
    `/v1/credit-support-requests/${id}/resend`,
    ttlDays ? { ttlDays } : {},
  );
}
