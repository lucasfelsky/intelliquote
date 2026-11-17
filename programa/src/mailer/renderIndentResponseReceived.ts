import fs from 'fs';
import path from 'path';
import { escapeHtml } from './renderQuoteDispatch';

// IQ Indent PR 4a-2: aviso INTERNO (pt-BR) a Compras quando o fornecedor responde (ou revisa) pelo portal. Template so em arquivo
// (sem EmailTemplateService). Todo valor passa por escapeHtml. SEM preco e SEM token: o e-mail so aponta para a cotacao no IQ.

const TEMPLATE_FILE = 'indent-response-received.pt.html';

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

export interface IndentResponseReceivedVars {
  supplierName: string;
  ref: string; // NNN/AA ou R<n> - NNN/AA
  version: number;
  afterAcceptance: boolean;
  quoteUrl: string;
}

// Assunto sem CR/LF/TAB (anti injecao de cabecalho): o nome do fornecedor vem do cadastro.
function singleLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

export function buildIndentResponseSubject(vars: Pick<IndentResponseReceivedVars, 'supplierName' | 'ref' | 'version' | 'afterAcceptance'>): string {
  const version = vars.version > 1 ? ` (versão ${vars.version})` : '';
  const late = vars.afterAcceptance ? ' (após aceite de outra cotação)' : '';

  return singleLine(`[IQ Indent] Resposta de ${vars.supplierName} na cotação ${vars.ref}${version}${late}`);
}

// Passada unica: um valor que contenha `{{x}}` nao e reprocessado.
function applyTemplate(template: string, optional: Record<string, boolean>, values: Record<string, string>): string {
  const withBlocks = template.replace(/<!--IF:(\w+)-->([\s\S]*?)<!--ENDIF:\1-->/g, (_match, key: string, body: string) => (optional[key] ? body : ''));

  return withBlocks.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

export function renderIndentResponseReceived(vars: IndentResponseReceivedVars): { subject: string; html: string; text: string } {
  const subject = buildIndentResponseSubject(vars);
  const versionLabel = vars.version > 1 ? `versão ${vars.version}` : '';
  const supplierName = singleLine(vars.supplierName);

  const html = applyTemplate(
    fs.readFileSync(TEMPLATE_PATH, 'utf-8'),
    { versionLabel: versionLabel !== '', afterAcceptance: vars.afterAcceptance },
    {
      subject: escapeHtml(subject),
      supplierName: escapeHtml(supplierName),
      ref: escapeHtml(vars.ref),
      versionLabel: escapeHtml(versionLabel),
      quoteUrl: escapeHtml(vars.quoteUrl),
    },
  );

  const lines = [
    `${supplierName} respondeu pelo portal a cotação ${vars.ref} do Indent${versionLabel ? ` (${versionLabel})` : ''}.`,
  ];

  if (vars.afterAcceptance) {
    lines.push('', 'Esta solicitação já tem outra cotação aceita. A resposta foi registrada, mas não altera o aceite.');
  }

  lines.push('', 'Veja a cotação no IntelliQuote:', vars.quoteUrl);

  return { subject, html, text: lines.join('\r\n') };
}
