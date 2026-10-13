import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { escapeHtml } from './renderQuoteDispatch';

// PR5 (Credit Support): aviso INTERNO (PT-BR) ao comprador quando o parceiro de
// credito responde (ou revisa) pelo portal publico. Espelha
// renderSupplierResponseReceived. Editavel via Templates.tsx,
// key = "credit_partner_response_received".
export const CREDIT_PARTNER_RESPONSE_RECEIVED_TEMPLATE_KEY = 'credit_partner_response_received';
export const CREDIT_PARTNER_RESPONSE_RECEIVED_DEFAULT_LOCALE = 'pt';

const TEMPLATE_FILE = 'credit-partner-response-received.pt.html';

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

export function loadFileTemplate(): string {
  return fs.readFileSync(TEMPLATE_PATH, 'utf-8');
}

export interface CreditPartnerResponseReceivedVars {
  subject: string;
  buyerName: string;
  partnerName: string;
  supplierName: string;
  requestCode: string;
  productName: string;
  currency: string;
  partnerTotal: string;
  originalTotal: string;
  // "+4.38%" / "-5.00%" / "" (sem base de comparacao).
  markupLabel: string;
  partnerPaymentTermsDays: string;
  originalPaymentTermsDays: string;
  // "" quando o parceiro nao informou validade.
  validityDays: string;
  itemsCount: string;
  // "" quando o parceiro nao deixou observacoes.
  notes: string;
  // "revisao vN" apenas quando o parceiro REVISOU uma resposta anterior.
  revisionLabel: string;
  quoteUrl: string;
}

export function renderSections(
  template: string,
  vars: CreditPartnerResponseReceivedVars,
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
    // quoteUrl entra em atributo href e notes e' texto livre do parceiro:
    // escapeHtml cobre aspas e tags.
    return escapeHtml(String(value));
  });
}

export function renderPlainText(vars: CreditPartnerResponseReceivedVars): string {
  const revision = vars.revisionLabel ? ` (${vars.revisionLabel})` : '';
  const productSuffix = vars.productName ? ` — ${vars.productName}` : '';
  const markup = vars.markupLabel ? ` (${vars.markupLabel} vs. fornecedor)` : '';
  const lines = [
    `Olá, ${vars.buyerName}.`,
    '',
    `O parceiro de crédito ${vars.partnerName} respondeu ao pedido de crédito da cotação ${vars.requestCode}${productSuffix} pelo portal${revision}.`,
    '',
    `Fornecedor de origem: ${vars.supplierName}`,
    `Total do parceiro: ${vars.partnerTotal} ${vars.currency}${markup}`,
    `Total original: ${vars.originalTotal} ${vars.currency}`,
    `Prazo de pagamento: ${vars.partnerPaymentTermsDays} dias (parceiro) × ${vars.originalPaymentTermsDays} dias (original)`,
  ];
  if (vars.validityDays) lines.push(`Validade: ${vars.validityDays} dias`);
  lines.push(`Itens: ${vars.itemsCount}`);
  if (vars.notes) lines.push(`Observações do parceiro: ${vars.notes}`);
  lines.push('', 'Veja a cotação no IntelliQuote:', vars.quoteUrl);
  return lines.join('\r\n');
}

// Rascunho editavel com placeholders crus, para a tela Templates (o html/text
// do preview sao dados de exemplo e NAO podem virar o corpo salvo).
export function buildTextTemplateDraft(): string {
  return [
    'Olá, {{buyerName}}.',
    '',
    'O parceiro de crédito {{partnerName}} respondeu ao pedido de crédito da cotação {{requestCode}}{{#productName}} — {{productName}}{{/productName}} pelo portal{{#revisionLabel}} ({{revisionLabel}}){{/revisionLabel}}.',
    '',
    'Fornecedor de origem: {{supplierName}}',
    'Total do parceiro: {{partnerTotal}} {{currency}}{{#markupLabel}} ({{markupLabel}} vs. fornecedor){{/markupLabel}}',
    'Total original: {{originalTotal}} {{currency}}',
    'Prazo de pagamento: {{partnerPaymentTermsDays}} dias (parceiro) × {{originalPaymentTermsDays}} dias (original)',
    '{{#validityDays}}Validade: {{validityDays}} dias{{/validityDays}}',
    'Itens: {{itemsCount}}',
    '{{#notes}}Observações do parceiro: {{notes}}{{/notes}}',
    '',
    'Veja a cotação no IntelliQuote:',
    '{{quoteUrl}}',
  ].join('\r\n');
}

export interface RenderedCreditPartnerResponseReceived {
  subject: string;
  html: string;
  text: string;
  source: 'database' | 'fallback';
}

export async function renderCreditPartnerResponseReceivedFromTemplate(
  vars: CreditPartnerResponseReceivedVars,
  locale: string = CREDIT_PARTNER_RESPONSE_RECEIVED_DEFAULT_LOCALE,
): Promise<RenderedCreditPartnerResponseReceived> {
  const dbTemplate = await EmailTemplateService.get(
    CREDIT_PARTNER_RESPONSE_RECEIVED_TEMPLATE_KEY,
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
