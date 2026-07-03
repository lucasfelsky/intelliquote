import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { escapeHtml } from './renderQuoteDispatch';

export const REPLY_TEMPLATE_KEY = 'quote_reply';
export const REPLY_DEFAULT_LOCALE = 'en';

const CANDIDATE_PATHS = [
  path.join(__dirname, 'templates', 'quote-reply.en.html'),
  path.join(__dirname, '..', '..', 'src', 'mailer', 'templates', 'quote-reply.en.html'),
  path.join(process.cwd(), 'dist', 'src', 'mailer', 'templates', 'quote-reply.en.html'),
  path.join(process.cwd(), 'src', 'mailer', 'templates', 'quote-reply.en.html'),
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

export interface QuoteReplyItem {
  name: string;
  incoterm: string;
  quantity: number;
  unit: string;
}

export interface QuoteReplyVars {
  subject: string;
  quoteRequestId: number;
  requestCode: string;
  productName: string;
  supplierName: string;
  items: QuoteReplyItem[];
}

function formatEnNumber(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderItemsRows(items: QuoteReplyItem[]): string {
  if (items.length === 0) {
    return `
      <tr>
        <td colspan="5" align="center" style="padding:12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#4A5560;font-style:italic;">No items listed.</td>
      </tr>`;
  }
  return items
    .map((item, idx) => {
      const bg = idx % 2 === 0 ? '#F8FBFA' : '#ffffff';
      return `
      <tr bgcolor="${bg}" style="background-color:${bg};">
        <td align="left" width="200" style="width:200px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#1F2933;">${escapeHtml(item.name)}</td>
        <td align="left" width="80" style="width:80px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#1F2933;">${escapeHtml(item.incoterm)}</td>
        <td align="right" width="100" style="width:100px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#1F2933;">${formatEnNumber(item.quantity)} ${escapeHtml(item.unit)}</td>
        <td align="right" width="90" style="width:90px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#9aa4ad;font-style:italic;">&#8212;</td>
        <td align="right" width="90" style="width:90px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#9aa4ad;font-style:italic;">&#8212;</td>
      </tr>`;
    })
    .join('');
}

export function renderReplySections(template: string, vars: QuoteReplyVars): string {
  const out = template.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
    const value = (vars as unknown as Record<string, unknown>)[key];
    const hasValue = value !== undefined && value !== null && String(value).trim().length > 0;
    return hasValue ? body : '';
  });

  return out.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = String(key).trim();
    if (trimmed === 'itemsRows') return renderItemsRows(vars.items);
    const value = (vars as unknown as Record<string, unknown>)[trimmed];
    if (value === undefined || value === null) return '';
    return escapeHtml(String(value));
  });
}

export function renderReplyPlainText(vars: QuoteReplyVars): string {
  return [
    'Hello,',
    '',
    `Please find below our reference for Quote #${vars.quoteRequestId} (${vars.requestCode} — ${vars.productName}):`,
    '',
    'Item\tIncoterm\tQuantity\tUnit Price\tTotal',
    ...vars.items.map((item) => `${item.name}\t${item.incoterm}\t${formatEnNumber(item.quantity)} ${item.unit}\t—\t—`),
    '',
    'Best regards,',
  ].join('\r\n');
}

export interface RenderedQuoteReply {
  subject: string;
  html: string;
  text: string;
  source: 'database' | 'fallback';
}

// Envio real via SMTP (sendAndLog) do botao "Responder" -- diferente do
// mailto: antigo, ja que mailto: (RFC 6068) so' aceita texto puro e nao da
// pra formatar a tabela. Editavel via Templates.tsx (mesmo mecanismo do
// quote_dispatch), key = "quote_reply".
export async function renderReplyFromTemplate(
  vars: QuoteReplyVars,
  locale: string = REPLY_DEFAULT_LOCALE,
): Promise<RenderedQuoteReply> {
  const dbTemplate = await EmailTemplateService.get(REPLY_TEMPLATE_KEY, locale);
  const subject = dbTemplate?.subject ? renderReplySections(dbTemplate.subject, vars) : vars.subject;
  const varsForRender = { ...vars, subject };

  if (dbTemplate) {
    const html = renderReplySections(dbTemplate.htmlBody, varsForRender);
    const text = dbTemplate.textBody
      ? renderReplySections(dbTemplate.textBody, varsForRender).replace(/\{\{itemsText\}\}/g, () =>
          vars.items.map((item) => `${item.name}\t${item.incoterm}\t${formatEnNumber(item.quantity)} ${item.unit}\t—\t—`).join('\n'),
        )
      : renderReplyPlainText(varsForRender);
    return { html, text, subject, source: 'database' };
  }

  const html = renderReplySections(loadFileTemplate(), varsForRender);
  const text = renderReplyPlainText(varsForRender);
  return { html, text, subject, source: 'fallback' };
}
