import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { escapeHtml } from './renderQuoteDispatch';

// F5 (backlog 2026-07-12): lembrete pre-deadline ao FORNECEDOR que ainda nao
// respondeu. Como o quote_dispatch, e' voltado ao fornecedor estrangeiro ->
// EN. O link e' de um token NOVO (o cru nao e' armazenado); o antigo e'
// revogado APOS o envio bem-sucedido. Editavel via Templates.tsx,
// key = "quote_reminder".
export const QUOTE_REMINDER_TEMPLATE_KEY = 'quote_reminder';
export const QUOTE_REMINDER_DEFAULT_LOCALE = 'en';

const CANDIDATE_PATHS = [
  path.join(__dirname, 'templates', 'quote-reminder.en.html'),
  path.join(__dirname, '..', '..', 'src', 'mailer', 'templates', 'quote-reminder.en.html'),
  path.join(process.cwd(), 'dist', 'src', 'mailer', 'templates', 'quote-reminder.en.html'),
  path.join(process.cwd(), 'src', 'mailer', 'templates', 'quote-reminder.en.html'),
];

function resolveTemplatePath(): string {
  for (const candidate of CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return CANDIDATE_PATHS[0];
}

const TEMPLATE_PATH = resolveTemplatePath();

export function loadFileTemplate(): string {
  return fs.readFileSync(TEMPLATE_PATH, 'utf-8');
}

export interface QuoteReminderVars {
  subject: string;
  contactName: string;
  supplierName: string;
  requestCode: string;
  productName: string;
  expiresAt: string;
  portalLink: string;
  companyName: string;
}

export function renderReminderSections(template: string, vars: QuoteReminderVars): string {
  const out = template.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
    const value = (vars as unknown as Record<string, unknown>)[key];
    const hasValue = value !== undefined && value !== null && String(value).trim().length > 0;
    return hasValue ? body : '';
  });

  return out.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = String(key).trim();
    const value = (vars as unknown as Record<string, unknown>)[trimmed];
    if (value === undefined || value === null) return '';
    return escapeHtml(String(value));
  });
}

export function renderReminderPlainText(vars: QuoteReminderVars): string {
  const productSuffix = vars.productName ? ` — ${vars.productName}` : '';
  return [
    `Dear ${vars.contactName},`,
    '',
    `This is a friendly reminder that your quotation for ${vars.requestCode}${productSuffix} has not been submitted yet.`,
    '',
    `The request closes on ${vars.expiresAt}.`,
    '',
    'Please submit your quotation using the secure link below (this link replaces the one from the previous email):',
    vars.portalLink,
    '',
    'Best regards,',
    vars.companyName,
  ].join('\r\n');
}

export interface RenderedQuoteReminder {
  subject: string;
  html: string;
  text: string;
  source: 'database' | 'fallback';
}

export async function renderReminderFromTemplate(
  vars: QuoteReminderVars,
  locale: string = QUOTE_REMINDER_DEFAULT_LOCALE,
): Promise<RenderedQuoteReminder> {
  const dbTemplate = await EmailTemplateService.get(QUOTE_REMINDER_TEMPLATE_KEY, locale);
  const subject = dbTemplate?.subject
    ? renderReminderSections(dbTemplate.subject, vars)
    : vars.subject;
  const varsForRender = { ...vars, subject };

  if (dbTemplate) {
    const html = renderReminderSections(dbTemplate.htmlBody, varsForRender);
    const text = dbTemplate.textBody
      ? renderReminderSections(dbTemplate.textBody, varsForRender)
      : renderReminderPlainText(varsForRender);
    return { html, text, subject, source: 'database' };
  }

  const html = renderReminderSections(loadFileTemplate(), varsForRender);
  const text = renderReminderPlainText(varsForRender);
  return { html, text, subject, source: 'fallback' };
}
