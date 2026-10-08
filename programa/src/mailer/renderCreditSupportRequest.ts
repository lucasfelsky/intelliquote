import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { escapeHtml } from './renderQuoteDispatch';

// Credit Support (PR2a): e-mail ao parceiro de credito com o link do portal dele.
// Voltado a parceiro externo -> EN. Sem precos no corpo (precos so no portal).
// Editavel via banco (key = "credit_support_request"); sem seed: cai no arquivo.
export const CREDIT_SUPPORT_TEMPLATE_KEY = 'credit_support_request';
export const CREDIT_SUPPORT_DEFAULT_LOCALE = 'en';

const TEMPLATE_FILE = 'credit-support-request.en.html';
const CANDIDATE_PATHS = [
  path.join(__dirname, 'templates', TEMPLATE_FILE),
  path.join(__dirname, '..', '..', 'src', 'mailer', 'templates', TEMPLATE_FILE),
  path.join(process.cwd(), 'dist', 'src', 'mailer', 'templates', TEMPLATE_FILE),
  path.join(process.cwd(), 'src', 'mailer', 'templates', TEMPLATE_FILE),
];

function resolveTemplatePath(): string {
  for (const candidate of CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return CANDIDATE_PATHS[0];
}

const TEMPLATE_PATH = resolveTemplatePath();

export function loadCreditSupportFileTemplate(): string {
  return fs.readFileSync(TEMPLATE_PATH, 'utf-8');
}

export interface CreditSupportRequestVars {
  subject: string;
  /** true quando o comprador digitou o assunto: ele prevalece sobre o do template do banco. */
  subjectIsCustom?: boolean;
  contactName: string;
  partnerName: string;
  companyName: string;
  requestCode: string;
  supplierName: string;
  supplierCountry: string;
  currency: string;
  incoterm: string;
  itemsCount: number;
  unavailableCount: number;
  expiresAt: string;
  portalLink: string;
  customMessage: string;
}

export function defaultCreditSupportSubject(requestCode: string, supplierName: string): string {
  return `Credit support request - ${requestCode} - ${supplierName}`;
}

/** "08 Oct 2026" (en-GB, UTC): mesma data para qualquer fuso do servidor. */
export function formatCreditSupportExpiry(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(date)
    .replace('Sept', 'Sep');
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') return value > 0;
  return String(value).trim().length > 0;
}

export function renderCreditSupportSections(
  template: string,
  vars: CreditSupportRequestVars,
): string {
  const record = vars as unknown as Record<string, unknown>;
  const out = template.replace(
    /\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key, body) => (hasValue(record[String(key).trim()]) ? body : ''),
  );

  return out.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const value = record[String(key).trim()];
    if (value === undefined || value === null) return '';
    return escapeHtml(String(value));
  });
}

export function renderCreditSupportPlainText(vars: CreditSupportRequestVars): string {
  const lines: string[] = [`Dear ${vars.contactName},`, ''];
  if (vars.customMessage.trim()) {
    lines.push(vars.customMessage.trim(), '');
  }
  const country = vars.supplierCountry ? ` (${vars.supplierCountry})` : '';
  lines.push(
    `${vars.companyName} is evaluating a purchase from ${vars.supplierName}${country} under request ${vars.requestCode}, and would like to know whether ${vars.partnerName} can offer credit support for it.`,
    '',
    `The request covers ${vars.itemsCount} item(s), quoted in ${vars.currency} under ${vars.incoterm}.` +
      (vars.unavailableCount > 0
        ? ` ${vars.unavailableCount} item(s) are currently unavailable and need no pricing.`
        : '') +
      ' Item details and prices are shown on the secure page below.',
    '',
    `Open the request: ${vars.portalLink}`,
    '',
    `This link is personal and expires on ${vars.expiresAt}. Please do not forward it.`,
    '',
    'Best regards,',
    vars.companyName,
  );
  return lines.join('\r\n');
}

export interface RenderedCreditSupportRequest {
  subject: string;
  html: string;
  text: string;
  source: 'database' | 'fallback';
}

export async function renderCreditSupportFromTemplate(
  vars: CreditSupportRequestVars,
  locale: string = CREDIT_SUPPORT_DEFAULT_LOCALE,
): Promise<RenderedCreditSupportRequest> {
  const dbTemplate = await EmailTemplateService.get(CREDIT_SUPPORT_TEMPLATE_KEY, locale);
  const subject =
    dbTemplate?.subject && !vars.subjectIsCustom
      ? renderCreditSupportSections(dbTemplate.subject, vars)
      : vars.subject;
  const varsForRender = { ...vars, subject };

  if (dbTemplate) {
    const html = renderCreditSupportSections(dbTemplate.htmlBody, varsForRender);
    const text = dbTemplate.textBody
      ? renderCreditSupportSections(dbTemplate.textBody, varsForRender)
      : renderCreditSupportPlainText(varsForRender);
    return { html, text, subject, source: 'database' };
  }

  const html = renderCreditSupportSections(loadCreditSupportFileTemplate(), varsForRender);
  const text = renderCreditSupportPlainText(varsForRender);
  return { html, text, subject, source: 'fallback' };
}
