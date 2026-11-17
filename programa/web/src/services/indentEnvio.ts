import { api } from '@/api/client';
import type { IndentQuoteDetail } from '@/services/indentQuotes';

// IQ Indent (PR 4b): envio da cotacao ao fornecedor por e-mail, reenvio do link e secao "Portal do fornecedor". Todas as chamadas vao por
// api/client.ts, no caminho COMPLETO /api/v1/indent/quotes/... O contrato (corpos, 400 com `path`, 409/422/502) e do BACKEND (PR 4a); aqui so se tipa.

const BASE = '/api/v1/indent/quotes';

export const INDENT_SEND_MAX_ATTACHMENTS = 3;
export const INDENT_SEND_MAX_BYTES = 10 * 1024 * 1024;
export const INDENT_MAX_RECIPIENTS = 5;
export const INDENT_MAX_SUPPLIER_EMAILS = 10;

export interface IndentSendContext {
  /** Referencia do processo: "275/26" ou "R2 - 275/26". */
  processRef: string;
  kind: 'REQUEST' | 'REVISION';
  subject: string;
  fromDisplay: string;
  replyTo: string;
  supplier: { id: number; name: string; hasPartnership: boolean; contactEmails: string[] };
  clientName: string | null;
  destinationPort: string | null;
  firstItemName: string;
}

export interface IndentSendInput {
  recipients: string[];
  saveToSupplier: boolean;
  message: string | null;
  showClientName: boolean;
  destinationPort: string;
  attachments?: Array<{ fileName: string; contentBase64: string }>;
  attachmentsConfirmed?: boolean;
}

export type IndentRecipientStatus = 'sent' | 'queued' | 'failed' | 'suppressed';

export interface IndentRecipientResult {
  email: string;
  status: IndentRecipientStatus;
  error?: string;
}

/** 200: ao menos um e-mail saiu (os que falharam vem em `results`). */
export interface IndentSendResponse {
  results: IndentRecipientResult[];
  quote: IndentQuoteDetail;
}

/** Corpo do 502: nenhum e-mail saiu. */
export interface IndentSendFailure {
  message: string;
  results: IndentRecipientResult[];
}

export type IndentPortalStateName = 'NAO_ENVIADO' | 'MARCADA_SEM_EMAIL' | 'AGUARDANDO' | 'RESPONDIDO';

export interface IndentPortalMail {
  id: number;
  kind: 'REQUEST' | 'REVISION' | 'RESEND';
  toEmail: string;
  status: IndentRecipientStatus;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
  attachmentNames: string[];
}

export interface IndentPortalAttachmentRef {
  id: number;
  fileName: string;
  fileSize: number;
  createdAt: string;
}

export interface IndentPortalState {
  state: IndentPortalStateName;
  lastSentAt: string | null;
  recipients: string[];
  lastAccessAt: string | null;
  expiresAt: string | null;
  canResend: boolean;
  mails: IndentPortalMail[];
  response: { version: number | null; submittedAt: string | null; via: 'portal' | 'manual' } | null;
  attachments: IndentPortalAttachmentRef[];
}

export function getIndentSendContext(id: number): Promise<IndentSendContext> {
  return api.get<IndentSendContext>(`${BASE}/${id}/send-context`);
}

export function sendIndentQuote(id: number, input: IndentSendInput): Promise<IndentSendResponse> {
  return api.post<IndentSendResponse>(`${BASE}/${id}/send`, input as unknown as Record<string, unknown>);
}

export function resendIndentQuoteLink(id: number): Promise<IndentSendResponse> {
  return api.post<IndentSendResponse>(`${BASE}/${id}/resend`, {});
}

export async function getIndentPortalState(id: number): Promise<IndentPortalState | null> {
  return normalizePortalState(await api.get<unknown>(`${BASE}/${id}/portal`));
}

const ESTADOS: ReadonlyArray<IndentPortalStateName> = ['NAO_ENVIADO', 'MARCADA_SEM_EMAIL', 'AGUARDANDO', 'RESPONDIDO'];
const STATUS_ENVIO: ReadonlyArray<IndentRecipientStatus> = ['sent', 'queued', 'failed', 'suppressed'];
const TIPOS_EMAIL: ReadonlyArray<IndentPortalMail['kind']> = ['REQUEST', 'REVISION', 'RESEND'];

const ehObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === 'object' && valor !== null && !Array.isArray(valor);
const textoOuNulo = (valor: unknown): string | null => (typeof valor === 'string' ? valor : null);
const lista = (valor: unknown): unknown[] => (Array.isArray(valor) ? valor : []);

/**
 * Tolera qualquer forma (os testes que montam a gaveta respondem `{}`/`[]` a uma URL desconhecida): objeto sem `state` conhecido = `null`.
 * Listas ausentes viram `[]`; itens malformados das listas sao descartados.
 */
export function normalizePortalState(raw: unknown): IndentPortalState | null {
  if (!ehObjeto(raw) || !ESTADOS.includes(raw.state as IndentPortalStateName)) return null;

  const mails: IndentPortalMail[] = [];
  for (const bruto of lista(raw.mails)) {
    if (!ehObjeto(bruto) || typeof bruto.id !== 'number' || typeof bruto.toEmail !== 'string') continue;
    if (!STATUS_ENVIO.includes(bruto.status as IndentRecipientStatus) || typeof bruto.createdAt !== 'string') continue;
    mails.push({
      id: bruto.id,
      kind: TIPOS_EMAIL.includes(bruto.kind as IndentPortalMail['kind']) ? (bruto.kind as IndentPortalMail['kind']) : 'REQUEST',
      toEmail: bruto.toEmail,
      status: bruto.status as IndentRecipientStatus,
      errorMessage: textoOuNulo(bruto.errorMessage),
      createdAt: bruto.createdAt,
      sentAt: textoOuNulo(bruto.sentAt),
      attachmentNames: lista(bruto.attachmentNames).filter((nome): nome is string => typeof nome === 'string'),
    });
  }

  const anexos: IndentPortalAttachmentRef[] = [];
  for (const bruto of lista(raw.attachments)) {
    if (!ehObjeto(bruto) || typeof bruto.id !== 'number' || typeof bruto.fileName !== 'string') continue;
    anexos.push({
      id: bruto.id,
      fileName: bruto.fileName,
      fileSize: typeof bruto.fileSize === 'number' ? bruto.fileSize : 0,
      createdAt: typeof bruto.createdAt === 'string' ? bruto.createdAt : '',
    });
  }

  const resposta = ehObjeto(raw.response) && (raw.response.via === 'portal' || raw.response.via === 'manual')
    ? {
        version: typeof raw.response.version === 'number' ? raw.response.version : null,
        submittedAt: textoOuNulo(raw.response.submittedAt),
        via: raw.response.via as 'portal' | 'manual',
      }
    : null;

  return {
    state: raw.state as IndentPortalStateName,
    lastSentAt: textoOuNulo(raw.lastSentAt),
    recipients: lista(raw.recipients).filter((email): email is string => typeof email === 'string'),
    lastAccessAt: textoOuNulo(raw.lastAccessAt),
    expiresAt: textoOuNulo(raw.expiresAt),
    canResend: raw.canResend === true,
    mails,
    response: resposta,
    attachments: anexos,
  };
}

/** Baixa o PDF anexado pelo fornecedor: GET autenticado binario (api.blob) -> Blob -> <a download>. Nunca abre em aba nem usa URL publica. */
export async function downloadIndentPortalAttachment(quoteId: number, file: IndentPortalAttachmentRef): Promise<void> {
  const blob = await api.blob(`${BASE}/${quoteId}/portal-attachments/${file.id}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}
