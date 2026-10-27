import { api } from '@/api/client';
import { readFileAsBase64 } from '@/services/supplierDocuments';

// Anexos tecnicos (TDS/MSDS) da solicitacao de desenvolvimento. Limites espelham o backend
// (constants/commercialRequestAttachments.ts); o servidor continua sendo a fonte da verdade.
export const CR_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CR_ATTACHMENT_MAX_PER_REQUEST = 5;
export const CR_ATTACHMENT_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

export const CR_ATTACHMENT_KINDS = ['TDS', 'MSDS', 'OUTRO'] as const;
export type CommercialRequestAttachmentKind = (typeof CR_ATTACHMENT_KINDS)[number];

export const CR_ATTACHMENT_KIND_LABELS: Record<CommercialRequestAttachmentKind, string> = {
  TDS: 'TDS',
  MSDS: 'MSDS',
  OUTRO: 'Outro',
};

/** Metadados de um anexo (a lista nunca traz o conteudo). */
export interface CommercialRequestAttachment {
  id: number;
  kind: CommercialRequestAttachmentKind | string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};
const ALLOWED_MIME = new Set(Object.values(MIME_BY_EXTENSION));

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/**
 * Tipo do arquivo para o upload: o do navegador quando for um dos permitidos; sem tipo (alguns
 * sistemas), o da extensao. Tipo informado fora da lista ou extensao fora da lista = null.
 */
export function resolveAttachmentMime(file: { name: string; type: string }): string | null {
  const byExtension = MIME_BY_EXTENSION[extensionOf(file.name)];
  if (!byExtension) return null;
  if (file.type === '') return byExtension;
  return ALLOWED_MIME.has(file.type) ? file.type : null;
}

/** Tipo inicial sugerido pelo nome: "tds" -> TDS; "msds"/"sds" -> MSDS; senao Outro. */
export function defaultAttachmentKind(fileName: string): CommercialRequestAttachmentKind {
  const lower = fileName.toLowerCase();
  if (lower.includes('tds')) return 'TDS';
  if (lower.includes('msds') || lower.includes('sds')) return 'MSDS';
  return 'OUTRO';
}

const BASE = '/api/v1/commercial-requests';

/** Envia 1 arquivo (base64 puro no JSON). Devolve os metadados gravados. */
export async function uploadCommercialRequestAttachment(
  requestId: number,
  input: { kind: CommercialRequestAttachmentKind; file: File },
): Promise<CommercialRequestAttachment> {
  const mimeType = resolveAttachmentMime(input.file);
  if (!mimeType) {
    throw new Error('Tipo de arquivo não permitido. Envie PDF, PNG ou JPEG.');
  }
  const contentBase64 = await readFileAsBase64(input.file);
  return api.post<CommercialRequestAttachment>(`${BASE}/${requestId}/attachments`, {
    kind: input.kind,
    fileName: input.file.name,
    mimeType,
    contentBase64,
  });
}

/**
 * Baixa o anexo pela API autenticada (JSON base64 -> Blob com o tipo vindo do servidor ->
 * <a download>). Nunca abre em aba nem usa URL publica.
 */
export async function downloadCommercialRequestAttachment(
  requestId: number,
  attachmentId: number,
): Promise<void> {
  const file = await api.get<{ fileName: string; mimeType: string; contentBase64: string }>(
    `${BASE}/${requestId}/attachments/${attachmentId}/download`,
  );
  const binary = atob(file.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function deleteCommercialRequestAttachment(
  requestId: number,
  attachmentId: number,
): Promise<void> {
  return api.del<void>(`${BASE}/${requestId}/attachments/${attachmentId}`);
}
