import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { escapeHtml } from './renderQuoteDispatch';

// Aviso INTERNO (PT-BR) a Equipe COMEX quando o comercial registra uma solicitacao.
// Mesmo precedente de supplier_response_received: consulta o banco e, sem linha,
// usa o arquivo .html + texto em codigo. Nao ha seed (nao entra na tela Templates).
export const COMMERCIAL_REQUEST_CREATED_TEMPLATE_KEY = 'commercial_request_created';
export const COMMERCIAL_REQUEST_CREATED_DEFAULT_LOCALE = 'pt';

const CANDIDATE_PATHS = [
  path.join(__dirname, 'templates', 'commercial-request-created.pt.html'),
  path.join(__dirname, '..', '..', 'src', 'mailer', 'templates', 'commercial-request-created.pt.html'),
  path.join(process.cwd(), 'dist', 'src', 'mailer', 'templates', 'commercial-request-created.pt.html'),
  path.join(process.cwd(), 'src', 'mailer', 'templates', 'commercial-request-created.pt.html'),
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

export interface CommercialRequestCreatedVars {
  subject: string;
  requesterName: string;
  requestId: number | string;
  // Vazios -> a section {{#...}} correspondente some.
  customerName: string;
  // Uma linha por item ("\n"); renderizado em bloco white-space:pre-line.
  itemsSummary: string;
  notes: string;
  requestsUrl: string;
}

export function renderSections(template: string, vars: CommercialRequestCreatedVars): string {
  const out = template.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
    const value = (vars as unknown as Record<string, unknown>)[key];
    const hasValue = value !== undefined && value !== null && String(value).trim().length > 0;
    return hasValue ? body : '';
  });

  return out.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = String(key).trim();
    const value = (vars as unknown as Record<string, unknown>)[trimmed];
    if (value === undefined || value === null) return '';
    // requestsUrl entra em atributo href; escapeHtml cobre aspas.
    return escapeHtml(String(value));
  });
}

export function renderPlainText(vars: CommercialRequestCreatedVars): string {
  const lines = [
    `${vars.requesterName} registrou a solicitação do comercial #${vars.requestId}.`,
    '',
  ];
  if (vars.customerName) lines.push(`Cliente: ${vars.customerName}`);
  lines.push('Itens:', vars.itemsSummary);
  if (vars.notes) lines.push('', `Observações: ${vars.notes}`);
  lines.push('', 'Veja as solicitações no IntelliQuote:', vars.requestsUrl);
  return lines.join('\r\n');
}

export interface RenderedCommercialRequestCreated {
  subject: string;
  html: string;
  text: string;
  source: 'database' | 'fallback';
}

export async function renderCommercialRequestCreatedFromTemplate(
  vars: CommercialRequestCreatedVars,
  locale: string = COMMERCIAL_REQUEST_CREATED_DEFAULT_LOCALE,
): Promise<RenderedCommercialRequestCreated> {
  const dbTemplate = await EmailTemplateService.get(
    COMMERCIAL_REQUEST_CREATED_TEMPLATE_KEY,
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
