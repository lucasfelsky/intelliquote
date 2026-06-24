import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';

export const DISPATCH_TEMPLATE_KEY = 'quote_dispatch';
export const DISPATCH_DEFAULT_LOCALE = 'en';

const CANDIDATE_PATHS = [
  path.join(__dirname, 'templates', 'quote-dispatch.en.html'),
  path.join(__dirname, '..', '..', 'src', 'mailer', 'templates', 'quote-dispatch.en.html'),
  path.join(process.cwd(), 'dist', 'src', 'mailer', 'templates', 'quote-dispatch.en.html'),
  path.join(process.cwd(), 'src', 'mailer', 'templates', 'quote-dispatch.en.html'),
];

function resolveTemplatePath(): string {
  for (const candidate of CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return CANDIDATE_PATHS[0];
}

const TEMPLATE_PATH = resolveTemplatePath();

function loadFileTemplate(): string {
  return fs.readFileSync(TEMPLATE_PATH, 'utf-8');
}

export interface QuoteDispatchItem {
  /** Nome de mercado (mostrado para o fornecedor). */
  marketName: string;
  quantity: number;
  unit: string;
  /** Mantido para compat mas nao e renderizado no e-mail. */
  productName?: string;
  code?: string;
  targetPrice?: string;
  /** INCOTERM herdado da cotacao ou sobrescrito por item. */
  desiredIncoterm?: string;
  /** Porto de destino herdado da cotacao ou sobrescrito por item. */
  destinationPort?: string;
  /** Porto de embarque (origem) da cotacao - sempre no nivel da cotacao. */
  originPort?: string;
}

export interface QuoteDispatchVars {
  subject: string;
  supplierContactName: string;
  requestCode: string;
  productName: string;
  quantity: number;
  unit: string;
  desiredIncoterm: string;
  destinationPort?: string;
  originPort?: string;
  currency: string;
  deadlineAt: string;
  expiresAt: string;
  portalLink: string;
  companyName: string;
  tradeName?: string;
  taxId?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  purchasingEmail: string;
  purchasingPhone?: string;
  items: QuoteDispatchItem[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderItemsRows(items: QuoteDispatchItem[]): string {
  if (items.length === 0) {
    return `
      <tr>
        <td colspan="5" style="padding:12px;text-align:center;color:#4A5560;font-style:italic;">No items listed.</td>
      </tr>`;
  }
  return items
    .map(
      (item, idx) => {
        const incotermCell = item.desiredIncoterm
          ? `<td style="padding:10px 12px;border-bottom:1px solid #ECF1EF;font-size:13px;color:#1F2933;white-space:nowrap;">${escapeHtml(item.desiredIncoterm)}</td>`
          : `<td style="padding:10px 12px;border-bottom:1px solid #ECF1EF;font-size:13px;color:#1F2933;white-space:nowrap;"><span style="color:#9aa4ad;font-style:italic;">—</span></td>`;
        const originCell = item.originPort
          ? `<td style="padding:10px 12px;border-bottom:1px solid #ECF1EF;font-size:13px;color:#1F2933;white-space:nowrap;">${escapeHtml(item.originPort)}</td>`
          : `<td style="padding:10px 12px;border-bottom:1px solid #ECF1EF;font-size:13px;color:#1F2933;white-space:nowrap;"><span style="color:#9aa4ad;font-style:italic;">—</span></td>`;
        const destinationCell = item.destinationPort
          ? `<td style="padding:10px 12px;border-bottom:1px solid #ECF1EF;font-size:13px;color:#1F2933;white-space:nowrap;">${escapeHtml(item.destinationPort)}</td>`
          : `<td style="padding:10px 12px;border-bottom:1px solid #ECF1EF;font-size:13px;color:#1F2933;white-space:nowrap;"><span style="color:#9aa4ad;font-style:italic;">—</span></td>`;
        return `
      <tr style="background:${idx % 2 === 0 ? '#F8FBFA' : '#ffffff'};">
        <td style="padding:10px 12px;border-bottom:1px solid #ECF1EF;">
          <div style="font-weight:600;color:#1F2933;">${escapeHtml(item.marketName)}</div>
        </td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid #ECF1EF;">${item.quantity} ${escapeHtml(item.unit)}</td>
        ${incotermCell}
        ${originCell}
        ${destinationCell}
      </tr>`;
      },
    )
    .join('');
}

export function renderSections(template: string, vars: QuoteDispatchVars): string {
  const out = template.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
    const value = (vars as unknown as Record<string, unknown>)[key];
    const hasValue =
      value !== undefined && value !== null && String(value).trim().length > 0;
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

export function renderDispatchTemplate(
  template: string,
  vars: QuoteDispatchVars,
): string {
  return renderSections(template, vars);
}

export function renderQuoteDispatch(
  vars: QuoteDispatchVars,
  fallbackHtml?: string,
): { html: string; text: string } {
  const html = renderSections(fallbackHtml ?? loadFileTemplate(), vars);
  const originPart = vars.originPort ? `Origin port: ${vars.originPort}` : '';
  const text = [
    vars.subject,
    '',
    `Dear ${vars.supplierContactName},`,
    '',
    `We are contacting you on behalf of ${vars.companyName} regarding sourcing request ${vars.requestCode}.`,
    `Incoterm: ${vars.desiredIncoterm}${vars.destinationPort ? ` | Destination port: ${vars.destinationPort}` : ''}${originPart ? ` | ${originPart}` : ''} | Currency: ${vars.currency}`,
    `Response deadline: ${vars.deadlineAt}`,
    `Link expires on: ${vars.expiresAt}`,
    '',
    'Items:',
    ...vars.items.map((i) => {
      const portPart = i.destinationPort ? ` | Dest: ${i.destinationPort}` : '';
      const incoPart = i.desiredIncoterm ? ` | ${i.desiredIncoterm}` : '';
      const originPart = i.originPort ? ` | Origin: ${i.originPort}` : '';
      return `  - ${i.marketName}${incoPart}${portPart}${originPart} | ${i.quantity} ${i.unit}`;
    }),
    '',
    `Submit your proposal: ${vars.portalLink}`,
    '',
    `Buyer contact: ${vars.companyName} <${vars.purchasingEmail}>`,
    '',
    'This message is confidential and intended solely for the addressee.',
  ].join('\n');
  return { html, text };
}

export interface RenderedDispatch {
  html: string;
  text: string;
  subject: string;
  source: 'database' | 'fallback';
}
export async function renderDispatchFromTemplate(
  vars: QuoteDispatchVars,
  locale: string = DISPATCH_DEFAULT_LOCALE,
): Promise<RenderedDispatch> {
  const dbTemplate = await EmailTemplateService.get(DISPATCH_TEMPLATE_KEY, locale);
  const subject = dbTemplate?.subject
    ? renderSections(dbTemplate.subject, vars)
    : vars.subject;
  const varsForRender = { ...vars, subject };

  if (dbTemplate) {
    const html = renderSections(dbTemplate.htmlBody, varsForRender);
    const text = renderSections(dbTemplate.textBody, varsForRender)
      .replace(/\{\{itemsText\}\}/g, () =>
        vars.items
          .map((i) => {
            const portPart = i.destinationPort ? ` | Dest: ${i.destinationPort}` : '';
            const incoPart = i.desiredIncoterm ? ` | ${i.desiredIncoterm}` : '';
            const originPart = i.originPort ? ` | Origin: ${i.originPort}` : '';
            return `  - ${i.marketName}${incoPart}${portPart}${originPart} | ${i.quantity} ${i.unit}`;
          })
          .join('\n'),
      );
    return { html, text, subject, source: 'database' };
  }

  const fallback = renderQuoteDispatch(varsForRender);
  const fallbackSubject = varsForRender.subject;
  return { html: fallback.html, text: fallback.text, subject: fallbackSubject, source: 'fallback' };
}
