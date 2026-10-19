import { api } from '@/api/client';

// Espelha src/constants/supplierDocuments.ts do backend (o backend revalida tudo).
export const SUPPLIER_DOCUMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const SUPPLIER_DOCUMENT_ALLOWED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;
export type SupplierDocumentMime = (typeof SUPPLIER_DOCUMENT_ALLOWED_MIME)[number];

export type SupplierDocumentStatus = 'ok' | 'expiring' | 'due_today' | 'expired';

export interface SupplierDocument {
  id: number;
  supplierId: number;
  name: string;
  /** YYYY-MM-DD (ultimo dia valido). */
  expiresOn: string;
  notes: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  /** Calculado pelo backend (calendario de Sao Paulo). O web nunca calcula status. */
  daysLeft: number;
  status: SupplierDocumentStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: number; name: string } | null;
}

export interface SupplierDocumentSummaryEntry {
  expired: number;
  expiring: number;
  nextDaysLeft?: number | null;
}

export interface SupplierDocumentSummary {
  bySupplier: Record<string, SupplierDocumentSummaryEntry>;
}

export interface SupplierDocumentFilePayload {
  fileName: string;
  mimeType: SupplierDocumentMime;
  contentBase64: string;
}

export interface CreateSupplierDocumentInput extends SupplierDocumentFilePayload {
  supplierId: number;
  name: string;
  expiresOn: string;
  notes?: string | null;
}

export interface UpdateSupplierDocumentInput {
  name?: string;
  expiresOn?: string;
  notes?: string | null;
}

export interface ReplaceSupplierDocumentFileInput extends SupplierDocumentFilePayload {
  expiresOn: string;
}

const BASE = '/api/v1/supplier-documents';

export function listSupplierDocuments(supplierId: number): Promise<SupplierDocument[]> {
  return api.get<SupplierDocument[]>(BASE, { supplierId: String(supplierId) });
}

export function createSupplierDocument(
  input: CreateSupplierDocumentInput,
): Promise<SupplierDocument> {
  return api.post<SupplierDocument>(BASE, { ...input });
}

export function updateSupplierDocument(
  id: number,
  input: UpdateSupplierDocumentInput,
): Promise<SupplierDocument> {
  return api.patch<SupplierDocument>(`${BASE}/${id}`, { ...input });
}

export function replaceSupplierDocumentFile(
  id: number,
  input: ReplaceSupplierDocumentFileInput,
): Promise<SupplierDocument> {
  return api.put<SupplierDocument>(`${BASE}/${id}/file`, { ...input });
}

export function deleteSupplierDocument(id: number): Promise<{ ok: boolean }> {
  return api.del<{ ok: boolean }>(`${BASE}/${id}`);
}

/** Qualquer forma diferente de `{ bySupplier: {...} }` vira mapa vazio. */
export function normalizeSummary(data: unknown): Record<string, SupplierDocumentSummaryEntry> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const bySupplier = (data as { bySupplier?: unknown }).bySupplier;
  if (!bySupplier || typeof bySupplier !== 'object' || Array.isArray(bySupplier)) return {};
  return bySupplier as Record<string, SupplierDocumentSummaryEntry>;
}

export async function getSupplierDocumentsSummary(): Promise<
  Record<string, SupplierDocumentSummaryEntry>
> {
  return normalizeSummary(await api.get<unknown>(`${BASE}/summary`));
}

/** Le o arquivo como base64 puro (sem prefixo data-URL). */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result ?? '').split(',')[1];
      if (!base64) reject(new Error('Falha ao ler arquivo.'));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

/** Baixa o documento (JSON base64 -> Blob -> <a download>), como SupplierImportModal. */
export async function downloadSupplierDocument(id: number): Promise<void> {
  const file = await api.get<{ fileName: string; mimeType: string; contentBase64: string }>(
    `${BASE}/${id}/download`,
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

/** '2026-10-19' -> '19/10/2026' por split (sem new Date: sem deslocamento de fuso). */
export function formatDateKeyBR(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return key;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Rotulo e classe do badge a partir do status/daysLeft devolvidos pelo backend. */
export function statusLabel(doc: Pick<SupplierDocument, 'status' | 'daysLeft'>): {
  text: string;
  badgeClass: string;
} {
  switch (doc.status) {
    case 'expired':
      return { text: 'Vencido', badgeClass: 'badge badge--danger' };
    case 'due_today':
      // Mais urgente que "Vence em N dias" (warning): reaproveita a cor de perigo existente.
      return { text: 'Vence hoje', badgeClass: 'badge badge--danger' };
    case 'expiring':
      return {
        text: doc.daysLeft === 1 ? 'Vence em 1 dia' : `Vence em ${doc.daysLeft} dias`,
        badgeClass: 'badge badge--warning',
      };
    default:
      return { text: 'Em dia', badgeClass: 'badge' };
  }
}
