import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { escapeHtml } from './renderQuoteDispatch';

// Aviso (PT-BR) ao SOLICITANTE (comercial) quando o COMEX muda o status da solicitacao.
// Mesmo precedente de commercial_request_created: consulta o banco e, sem linha, usa o
// arquivo .html + texto em codigo. Nao ha seed (nao entra na tela Templates).
// NUNCA inclui preco, fornecedor, parceiro, nota de atendimento nem nome de mercado.
export const COMMERCIAL_REQUEST_STATUS_CHANGED_TEMPLATE_KEY = 'commercial_request_status_changed';
export const COMMERCIAL_REQUEST_STATUS_CHANGED_DEFAULT_LOCALE = 'pt';

const TEMPLATE_FILE = 'commercial-request-status-changed.pt.html';
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

export interface CommercialRequestStatusChangedVars {
  subject: string;
  requestId: number | string;
  statusLabel: string;
  statusMessage: string;
  // Vazios -> a section {{#...}} correspondente some.
  quoteCode: string;
  rejectionReason: string;
  requestsUrl: string;
}

export function renderSections(template: string, vars: CommercialRequestStatusChangedVars): string {
  const out = template.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
    const value = (vars as unknown as Record<string, unknown>)[key];
    const hasValue = value !== undefined && value !== null && String(value).trim().length > 0;
    return hasValue ? body : '';
  });

  return out.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = String(key).trim();
    const value = (vars as unknown as Record<string, unknown>)[trimmed];
    if (value === undefined || value === null) return '';
    // Tudo escapado: o motivo da recusa e texto livre; requestsUrl entra em atributo href.
    return escapeHtml(String(value));
  });
}

export function renderPlainText(vars: CommercialRequestStatusChangedVars): string {
  const lines = [vars.statusMessage, ''];
  if (vars.quoteCode) lines.push(`Cotação: ${vars.quoteCode}`);
  if (vars.rejectionReason) lines.push(`Motivo: ${vars.rejectionReason}`);
  lines.push('', 'Veja suas solicitações no IntelliQuote:', vars.requestsUrl);
  return lines.join('\r\n');
}

export interface RenderedCommercialRequestStatusChanged {
  subject: string;
  html: string;
  text: string;
  source: 'database' | 'fallback';
}

export async function renderCommercialRequestStatusChangedFromTemplate(
  vars: CommercialRequestStatusChangedVars,
  locale: string = COMMERCIAL_REQUEST_STATUS_CHANGED_DEFAULT_LOCALE,
): Promise<RenderedCommercialRequestStatusChanged> {
  const dbTemplate = await EmailTemplateService.get(
    COMMERCIAL_REQUEST_STATUS_CHANGED_TEMPLATE_KEY,
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
