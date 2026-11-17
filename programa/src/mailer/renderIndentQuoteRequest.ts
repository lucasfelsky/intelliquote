import fs from 'fs';
import path from 'path';
import { mailerEnv } from '../config/env';
import { formatQuoteRef } from '../utils/indentQuote';
import { escapeHtml } from './renderQuoteDispatch';

// IQ Indent PR 4: e-mail EM INGLES de pedido de cotacao (novo pedido e revisao R2+) para o fornecedor.
// Template so em arquivo (sem EmailTemplateService). Todo valor passa por escapeHtml. O renderer NAO decide sigilo:
// recebe `endCustomer` ja filtrado pelo perfil de exposicao (null quando o fornecedor nao pode ver o cliente).

export type IndentMailKindName = 'REQUEST' | 'REVISION' | 'RESEND';

const TEMPLATE_FILE = 'indent-quote-request.en.html';

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

function loadFileTemplate(): string {
  return fs.readFileSync(TEMPLATE_PATH, 'utf-8');
}

/** Link do portal do Indent. O token CRU so existe em memoria: nunca em MailLog, AuditLog nem logger. */
export function buildIndentPortalLink(rawToken: string): string {
  const base = mailerEnv.portalUrl.replace(/\/$/, '');
  return `${base}/portal/indent?token=${encodeURIComponent(rawToken)}&v=${Date.now()}`;
}

const SUBJECT_ITEM_MAX = 80;

function singleLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/** Assunto sem CR/LF/TAB (anti injecao de cabecalho). R1: `NNN/AA · ...`; R2+: `R<n> - NNN/AA · ...`. */
export function buildIndentSubject(processNumber: string, revision: number, firstItemName: string): string {
  const ref = singleLine(formatQuoteRef(processNumber, revision));
  const rawItem = singleLine(firstItemName);
  const item = rawItem.length > SUBJECT_ITEM_MAX ? `${rawItem.slice(0, SUBJECT_ITEM_MAX - 1).trimEnd()}…` : rawItem;
  const label = revision > 1 ? 'Indent price update requested' : 'Indent quotation request';

  return `${ref} · ${label} · ${item}`;
}

export interface IndentQuoteRequestVars {
  processNumber: string;
  revision: number;
  subject: string;
  portalLink: string;
  expiresAt: Date;
  destinationPort: string;
  incoterm: string;
  message: string | null;
  endCustomer: string | null;
  items: Array<{ name: string; cas: string | null; quantityKg: string }>;
}

function formatExpiresOn(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatQuantity(quantityKg: string): string {
  const value = Number(quantityKg);

  if (!Number.isFinite(value)) {
    return quantityKg;
  }

  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function messageToHtml(message: string): string {
  return escapeHtml(message.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
}

function introOf(vars: IndentQuoteRequestVars, ref: string): string {
  if (vars.revision > 1) {
    return `Thank you for your offer. We would like to ask you to review your prices for request ${ref}. Your previous offer is already filled in on the form, so you only need to change what is different.`;
  }

  return 'SQ Quimica requests your best offer for the items below, quoted in US$ or EUR per kg, FOB and CFR, using the secure link below.';
}

const ITEM_CELL = 'padding:11px 12px;border-bottom:1px solid #D5E2DE;vertical-align:top;';

function renderItemsRows(items: IndentQuoteRequestVars['items']): string {
  return items
    .map(
      (item) =>
        `<tr><td style="${ITEM_CELL}"><strong>${escapeHtml(item.name)}</strong></td>` +
        `<td style="${ITEM_CELL}font-family:'Courier New',monospace;">${item.cas ? escapeHtml(item.cas) : '&ndash;'}</td>` +
        `<td align="right" style="${ITEM_CELL}text-align:right;font-family:'Courier New',monospace;">${escapeHtml(formatQuantity(item.quantityKg))}</td></tr>`,
    )
    .join('\n');
}

function applyTemplate(template: string, optional: Record<string, boolean>, values: Record<string, string>): string {
  const withBlocks = template.replace(/<!--IF:(\w+)-->([\s\S]*?)<!--ENDIF:\1-->/g, (_match, key: string, body: string) =>
    optional[key] ? body : '',
  );

  // Passada unica: um valor que contenha `{{x}}` nao e reprocessado.
  return withBlocks.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

export function renderIndentQuoteRequest(vars: IndentQuoteRequestVars): { subject: string; html: string; text: string } {
  const subject = singleLine(vars.subject);
  const ref = formatQuoteRef(vars.processNumber, vars.revision);
  const revision = vars.revision > 1;
  const expiresOn = formatExpiresOn(vars.expiresAt);
  const message = vars.message && vars.message.trim() !== '' ? vars.message : null;
  const endCustomer = vars.endCustomer && vars.endCustomer.trim() !== '' ? vars.endCustomer : null;

  const html = applyTemplate(
    loadFileTemplate(),
    { message: message !== null, endCustomer: endCustomer !== null },
    {
      subject: escapeHtml(subject),
      title: revision ? 'Price update requested' : 'Quotation request',
      numberLabel: revision ? 'Revision of request' : 'Request no.',
      processNumber: escapeHtml(ref),
      intro: escapeHtml(introOf(vars, ref)),
      message: message !== null ? messageToHtml(message) : '',
      endCustomer: endCustomer !== null ? escapeHtml(endCustomer) : '',
      destinationPort: escapeHtml(vars.destinationPort),
      incoterm: escapeHtml(vars.incoterm),
      itemsRows: renderItemsRows(vars.items),
      portalLink: escapeHtml(vars.portalLink),
      expiresOn: escapeHtml(expiresOn),
    },
  );

  const lines = [
    revision ? 'Price update requested' : 'Quotation request',
    `${revision ? 'Revision of request' : 'Request no.'}: ${ref}`,
    '',
    introOf(vars, ref),
    '',
  ];

  if (message !== null) {
    lines.push('Message from SQ Quimica:', message.replace(/\r\n?/g, '\n'), '');
  }

  lines.push('Requested by: SQ Quimica');
  if (endCustomer !== null) {
    lines.push(`End customer: ${endCustomer}`);
  }
  lines.push(`Destination port: ${vars.destinationPort}`, `Incoterm: ${vars.incoterm}`, '', 'Items:');
  for (const item of vars.items) {
    lines.push(`- ${item.name}${item.cas ? ` (CAS ${item.cas})` : ''}: ${formatQuantity(item.quantityKg)} kg`);
  }
  lines.push(
    '',
    'What we need from you: packaging for each item; FOB and CFR price per kg; production lead time and payment terms; offer validity (and the manufacturer if you are a trading company).',
    '',
    'Open quotation form:',
    vars.portalLink,
    `This link is personal and expires on ${expiresOn}. Please do not share it with third parties.`,
    '',
    'Reply to this e-mail to reach the SQ Quimica Indent team.',
  );

  return { subject, html, text: lines.join('\n') };
}
