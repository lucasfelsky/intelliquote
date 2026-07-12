import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { escapeHtml } from './renderQuoteDispatch';

// F1 (backlog 2026-07-12): aviso ao COMPRADOR quando o fornecedor envia (ou
// revisa) uma resposta pelo portal publico. Diferente de quote_dispatch e
// quote_reply (EN, voltados ao fornecedor estrangeiro), este e-mail e' interno
// e vai em PT-BR. Editavel via Templates.tsx, key = "supplier_response_received".
export const SUPPLIER_RESPONSE_RECEIVED_TEMPLATE_KEY = 'supplier_response_received';
export const SUPPLIER_RESPONSE_RECEIVED_DEFAULT_LOCALE = 'pt';

const CANDIDATE_PATHS = [
  path.join(__dirname, 'templates', 'supplier-response-received.pt.html'),
  path.join(__dirname, '..', '..', 'src', 'mailer', 'templates', 'supplier-response-received.pt.html'),
  path.join(process.cwd(), 'dist', 'src', 'mailer', 'templates', 'supplier-response-received.pt.html'),
  path.join(process.cwd(), 'src', 'mailer', 'templates', 'supplier-response-received.pt.html'),
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

export interface SupplierResponseReceivedVars {
  subject: string;
  buyerName: string;
  supplierName: string;
  contactName: string;
  requestCode: string;
  productName: string;
  totalPrice: string;
  currency: string;
  itemsCount: number;
  // Presentes apenas quando o fornecedor REVISOU uma resposta anterior —
  // controlam a section {{#revisionLabel}} do template.
  revisionLabel: string;
  responsesUrl: string;
}

export function renderSections(
  template: string,
  vars: SupplierResponseReceivedVars,
): string {
  const out = template.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
    const value = (vars as unknown as Record<string, unknown>)[key];
    const hasValue = value !== undefined && value !== null && String(value).trim().length > 0;
    return hasValue ? body : '';
  });

  return out.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = String(key).trim();
    const value = (vars as unknown as Record<string, unknown>)[trimmed];
    if (value === undefined || value === null) return '';
    // responsesUrl entra em atributo href; escapeHtml cobre aspas.
    return escapeHtml(String(value));
  });
}

export function renderPlainText(vars: SupplierResponseReceivedVars): string {
  const revision = vars.revisionLabel ? ` (${vars.revisionLabel})` : '';
  const productSuffix = vars.productName ? ` — ${vars.productName}` : '';
  return [
    `Olá, ${vars.buyerName}.`,
    '',
    `O fornecedor ${vars.supplierName} respondeu à cotação ${vars.requestCode}${productSuffix} pelo portal${revision}.`,
    '',
    `Contato: ${vars.contactName}`,
    `Total ofertado: ${vars.totalPrice} ${vars.currency}`,
    `Itens: ${vars.itemsCount}`,
    '',
    'Veja a resposta no IntelliQuote:',
    vars.responsesUrl,
  ].join('\r\n');
}

export interface RenderedSupplierResponseReceived {
  subject: string;
  html: string;
  text: string;
  source: 'database' | 'fallback';
}

export async function renderSupplierResponseReceivedFromTemplate(
  vars: SupplierResponseReceivedVars,
  locale: string = SUPPLIER_RESPONSE_RECEIVED_DEFAULT_LOCALE,
): Promise<RenderedSupplierResponseReceived> {
  const dbTemplate = await EmailTemplateService.get(
    SUPPLIER_RESPONSE_RECEIVED_TEMPLATE_KEY,
    locale,
  );
  const subject = dbTemplate?.subject ? renderSections(dbTemplate.subject, vars) : vars.subject;
  const varsForRender = { ...vars, subject };

  if (dbTemplate) {
    const html = renderSections(dbTemplate.htmlBody, varsForRender);
    const text = dbTemplate.textBody
      ? renderSections(dbTemplate.textBody, varsForRender)
      : renderPlainText(varsForRender);
    return { html, text, subject, source: 'database' };
  }

  const html = renderSections(loadFileTemplate(), varsForRender);
  const text = renderPlainText(varsForRender);
  return { html, text, subject, source: 'fallback' };
}
