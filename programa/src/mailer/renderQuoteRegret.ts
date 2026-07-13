import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { escapeHtml } from './renderQuoteDispatch';

// F8 (backlog 2026-07-12): aviso de "nao selecionado" aos fornecedores
// perdedores, ao concluir a cotacao. Voltado ao fornecedor estrangeiro -> EN.
// Tom neutro, SEM expor preco vencedor. Editavel via Templates.tsx,
// key = "quote_regret".
export const QUOTE_REGRET_TEMPLATE_KEY = 'quote_regret';
export const QUOTE_REGRET_DEFAULT_LOCALE = 'en';

const CANDIDATE_PATHS = [
  path.join(__dirname, 'templates', 'quote-regret.en.html'),
  path.join(__dirname, '..', '..', 'src', 'mailer', 'templates', 'quote-regret.en.html'),
  path.join(process.cwd(), 'dist', 'src', 'mailer', 'templates', 'quote-regret.en.html'),
  path.join(process.cwd(), 'src', 'mailer', 'templates', 'quote-regret.en.html'),
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

export interface QuoteRegretVars {
  subject: string;
  contactName: string;
  supplierName: string;
  requestCode: string;
  productName: string;
  companyName: string;
}

export function renderRegretSections(template: string, vars: QuoteRegretVars): string {
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

export function renderRegretPlainText(vars: QuoteRegretVars): string {
  const productSuffix = vars.productName ? ` — ${vars.productName}` : '';
  return [
    `Dear ${vars.contactName},`,
    '',
    `Thank you for the time and effort you put into your quotation for ${vars.requestCode}${productSuffix}.`,
    '',
    'After careful review, we have selected another proposal for this particular request. This decision does not reflect on the quality of your offer, and we truly value our relationship.',
    '',
    'We look forward to working with you on future opportunities.',
    '',
    'Best regards,',
    vars.companyName,
  ].join('\r\n');
}

export interface RenderedQuoteRegret {
  subject: string;
  html: string;
  text: string;
  source: 'database' | 'fallback';
}

export async function renderRegretFromTemplate(
  vars: QuoteRegretVars,
  locale: string = QUOTE_REGRET_DEFAULT_LOCALE,
): Promise<RenderedQuoteRegret> {
  const dbTemplate = await EmailTemplateService.get(QUOTE_REGRET_TEMPLATE_KEY, locale);
  const subject = dbTemplate?.subject ? renderRegretSections(dbTemplate.subject, vars) : vars.subject;
  const varsForRender = { ...vars, subject };

  if (dbTemplate) {
    const html = renderRegretSections(dbTemplate.htmlBody, varsForRender);
    const text = dbTemplate.textBody
      ? renderRegretSections(dbTemplate.textBody, varsForRender)
      : renderRegretPlainText(varsForRender);
    return { html, text, subject, source: 'database' };
  }

  const html = renderRegretSections(loadFileTemplate(), varsForRender);
  const text = renderRegretPlainText(varsForRender);
  return { html, text, subject, source: 'fallback' };
}
