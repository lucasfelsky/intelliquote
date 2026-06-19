import type { EmailTemplate, EmailTemplateDraft } from '@/services/templates';

const API_PREFIX = '/api/v1/email-templates';

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
  const records = await fetchJson<EmailTemplateRecordApi[]>(`${API_PREFIX}/${search}`);
  return records.map(normalize);
}

export async function previewEmailTemplate(
  key: string,
  locale: string,
): Promise<EmailTemplatePreview> {
  return fetchJson<EmailTemplatePreview>(
    `${API_PREFIX}/preview?key=${encodeURIComponent(key)}&locale=${encodeURIComponent(locale)}`,
  );
}

export async function saveEmailTemplate(
  key: string,
  locale: string,
  draft: EmailTemplateDraft,
): Promise<EmailTemplate> {
  const record = await fetchJson<EmailTemplateRecordApi>(
    `${API_PREFIX}/${encodeURIComponent(key)}/${encodeURIComponent(locale)}`,
    {
      method: 'PUT',
      body: JSON.stringify(draft),
    },
  );
  return normalize(record);
}

export async function resetEmailTemplate(key: string, locale: string): Promise<void> {
  await fetchJson<void>(
    `${API_PREFIX}/${encodeURIComponent(key)}/${encodeURIComponent(locale)}`,
    { method: 'DELETE' },
  );
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.message) message = parsed.message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
