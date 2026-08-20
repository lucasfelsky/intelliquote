import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { escapeHtml } from './renderQuoteDispatch';

export const PO_TEMPLATE_KEY = 'quote_po';
export const PO_DEFAULT_LOCALE = 'en';

const CANDIDATE_PATHS = [
  path.join(__dirname, 'templates', 'quote-po.en.html'),
  path.join(__dirname, '..', '..', 'src', 'mailer', 'templates', 'quote-po.en.html'),
  path.join(process.cwd(), 'dist', 'src', 'mailer', 'templates', 'quote-po.en.html'),
  path.join(process.cwd(), 'src', 'mailer', 'templates', 'quote-po.en.html'),
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

export interface QuotePoVars {
  subject: string;
  requestCode: string;
  supplierContactName: string;
  // Contato do despachante/forwarder, digitado na hora no modal "Enviar
  // Ordem de Compra". Texto livre (pode ter varias linhas) -- renderizado no
  // HTML com escape + \n->br (mesmo tratamento de injectReplyCustomMessage).
  // No corpo texto puro (DB textBody customizado), o placeholder equivalente
  // e' {{forwarderInfoText}} (sem br) -- mesmo padrao itemsRows/itemsText do
  // quote_reply.
  forwarderInfo: string;
}

function renderForwarderInfoHtml(value: string): string {
  if (!value) return '';
  return escapeHtml(value).replace(/\n/g, '<br />');
}

export function renderPoSections(template: string, vars: QuotePoVars): string {
  const out = template.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
    const value = (vars as unknown as Record<string, unknown>)[key];
    const hasValue = value !== undefined && value !== null && String(value).trim().length > 0;
    return hasValue ? body : '';
  });

  return out.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = String(key).trim();
    if (trimmed === 'forwarderInfo') return renderForwarderInfoHtml(vars.forwarderInfo);
    if (trimmed === 'forwarderInfoText') return vars.forwarderInfo ?? '';
    const value = (vars as unknown as Record<string, unknown>)[trimmed];
    if (value === undefined || value === null) return '';
    return escapeHtml(String(value));
  });
}

export function renderPoPlainText(vars: QuotePoVars): string {
  return [
    'Dear all,',
    '',
    'Attached is our PO. We look forward to receiving the PI soon.',
    'Please inform estimated cargo delivery date:',
    '',
    'Please note the original BL copies should be issued at destination, please coordinate with our forwarder accordingly',
    '',
    'SHIPPING INSTRUCTION:',
    'LABEL: Consider small labels and neutral package with the description according to our PO.',
    'PALLETS: Goods must be sent on pallets. Consider using processed wooden pallet, plastic pallet or treated and certificate (with stamp and original certificate in English). If you cannot provide pallet, please ask the agent to do so.',
    "*Pallets size must have no more than 112CM in order to be loaded on a 40'NOR.",
    '',
    'SHIPPING DOCUMENTS:',
    'Please make sure to include all the data below on both Invoice and Packing list;',
    '',
    "- SQ QUIMICA's complete information including tax number: CNPJ: 14.111.367/0001-97;",
    "- SQ QUIMICA's Internal Product Code followed by Product Description on the Invoice according to our PO;",
    "- Exporter's TAX ID/TIN NUMBER must be mentioned on shipper's info;",
    '- Port of Destination: as agreed.',
    '- CBM; N.W and G.W per Package and TOTAL; Pallet Weight;',
    '- Quantity of pallets and packages with description (Pallets and other types: Bags, drums, etc.);',
    '- HS CODE/NCM (according to our PO);',
    '- Manufacturer information (If same as exporter, please inform it on the Invoice) including TAX ID/TIN NUMBER;',
    '- Country of Origin, Acquisition and Provenance;',
    '- Bank Info: Swift Code, Bank Address and Beneficiary IS MANDATORY ON INVOICE',
    '',
    'CERTIFICATE OF ANALYSIS.',
    'Please make sure to include all the data below on every COA;',
    '',
    "- Product's name according to INVOICE;",
    '- Batches/Lot numbers;',
    '- Shipped quantity for every Batch/Lot;',
    '- Manufacturing date and Expiring/Validity date',
    '- All data must be digital (handwritten will no longer be accepted).',
    '',
    'Port of Destination: NAVEGANTES, BRAZIL.',
    '*FCL: ITAPOA, BRAZIL.',
    '',
    "Here below is the forwarder's contact info:",
    vars.forwarderInfo || '',
  ].join('\r\n');
}

export interface RenderedQuotePo {
  subject: string;
  html: string;
  text: string;
  source: 'database' | 'fallback';
}

// Envio real via SMTP (sendAndLog) do botao "Enviar Ordem de Compra" na
// Comparacao -- so' e' habilitado para a proposta vencedora (isWinner).
// Editavel via Templates.tsx (mesmo mecanismo do quote_dispatch/quote_reply),
// key = "quote_po".
export async function renderPoFromTemplate(
  vars: QuotePoVars,
  locale: string = PO_DEFAULT_LOCALE,
): Promise<RenderedQuotePo> {
  const dbTemplate = await EmailTemplateService.get(PO_TEMPLATE_KEY, locale);
  const subject = dbTemplate?.subject ? renderPoSections(dbTemplate.subject, vars) : vars.subject;
  const varsForRender = { ...vars, subject };

  if (dbTemplate) {
    const html = renderPoSections(dbTemplate.htmlBody, varsForRender);
    const text = dbTemplate.textBody
      ? renderPoSections(dbTemplate.textBody, varsForRender)
      : renderPoPlainText(varsForRender);
    return { html, text, subject, source: 'database' };
  }

  const html = renderPoSections(loadFileTemplate(), varsForRender);
  const text = renderPoPlainText(varsForRender);
  return { html, text, subject, source: 'fallback' };
}

// Insere a mensagem opcional digitada na hora (modal "Enviar Ordem de
// Compra") no lugar do marcador `<!--CUSTOM_MESSAGE_SLOT-->` do template
// (mesmo mecanismo do injectReplyCustomMessage/injectCustomMessage do
// dispatch). Se o template customizado no banco nao tiver o marcador, a
// mensagem simplesmente nao aparece no HTML (mas continua indo no texto puro).
export function injectPoCustomMessage(html: string, message: string): string {
  if (!message) return html;
  const safe = escapeHtml(message).replace(/\n/g, '<br />');
  const block = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;">
      <tr>
        <td style="padding:0 32px 16px 32px;font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#1F2933;">${safe}</td>
      </tr>
    </table>`;
  return html.replace('<!--CUSTOM_MESSAGE_SLOT-->', block);
}

export function withPoCustomMessageText(text: string, message: string): string {
  return message ? `${message}\n\n${text}` : text;
}
