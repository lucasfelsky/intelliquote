import { api, ApiError } from '@/api/client';
import type { EmailTemplate, EmailTemplateDraft } from '@/services/templates';

export interface EmailTemplatePreview {
  subject: string;
  html: string;
  text: string;
  isActive: boolean;
  source: 'database' | 'fallback';
  locale: string;
}

interface EmailTemplateRecordApi {
  id: number;
  key: string;
  locale: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  isActive: boolean;
  updatedAt: string;
  updatedById: number | null;
}

function normalize(record: EmailTemplateRecordApi): EmailTemplate {
  return {
    id: record.id,
    key: record.key,
    locale: record.locale,
    subject: record.subject,
    htmlBody: record.htmlBody,
    textBody: record.textBody,
    isActive: record.isActive,
    updatedAt: record.updatedAt,
    updatedById: record.updatedById,
  };
}

export async function listEmailTemplates(key?: string): Promise<EmailTemplate[]> {
  const search = key ? `?key=${encodeURIComponent(key)}` : '';
  const records = await api.get<EmailTemplateRecordApi[]>(`/v1/email-templates${search}`);
  return Array.isArray(records) ? records.map(normalize) : [];
}

export async function previewEmailTemplate(
  key: string,
  locale: string,
): Promise<EmailTemplatePreview> {
  return api.get<EmailTemplatePreview>(
    `/v1/email-templates/preview?key=${encodeURIComponent(key)}&locale=${encodeURIComponent(locale)}`,
  );
}

export async function saveEmailTemplate(
  key: string,
  locale: string,
  draft: EmailTemplateDraft,
): Promise<EmailTemplate> {
  const record = await api.put<EmailTemplateRecordApi>(
    `/v1/email-templates/${encodeURIComponent(key)}/${encodeURIComponent(locale)}`,
    { ...draft },
  );
  return normalize(record);
}

export async function resetEmailTemplate(key: string, locale: string): Promise<void> {
  await api.del<void>(`/v1/email-templates/${encodeURIComponent(key)}/${encodeURIComponent(locale)}`);
}

export function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}