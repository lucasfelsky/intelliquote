import fs from 'fs';
import path from 'path';
import { escapeHtml } from './renderQuoteDispatch';

// Resumo diario do lembrete: quando o MESMO endereco tem 2+ cotacoes pendentes no
// dia, vai 1 e-mail unico com uma linha (e um link proprio) por cotacao. Modelo
// fixo em codigo, em ingles (fornecedor estrangeiro); NAO tem linha no EmailTemplate.
// 1 cotacao continua usando renderReminderFromTemplate (template `quote_reminder`).
export const QUOTE_REMINDER_DIGEST_TEMPLATE_ID = 'quote_reminder_digest';

const ITEMS_MARKER = '<!--REMINDER_ITEMS-->';

const CANDIDATE_PATHS = [
  path.join(__dirname, 'templates', 'quote-reminder-digest.en.html'),
  path.join(__dirname, '..', '..', 'src', 'mailer', 'templates', 'quote-reminder-digest.en.html'),
  path.join(process.cwd(), 'dist', 'src', 'mailer', 'templates', 'quote-reminder-digest.en.html'),
  path.join(process.cwd(), 'src', 'mailer', 'templates', 'quote-reminder-digest.en.html'),
];

function resolveTemplatePath(): string {
  for (const candidate of CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return CANDIDATE_PATHS[0];
}

const TEMPLATE_PATH = resolveTemplatePath();

export interface ReminderDigestItem {
  requestCode: string;
  productName: string;
  supplierName: string;
  closesOn: string;
  portalLink: string;
}

export interface ReminderDigestInput {
  contactName: string;
  companyName: string;
  items: ReminderDigestItem[];
}

export interface RenderedReminderDigest {
  subject: string;
  html: string;
  text: string;
}

function renderItemHtml(item: ReminderDigestItem): string {
  const product = item.productName
    ? ` <span style="font-weight:normal;color:#4A5560;">&mdash; ${escapeHtml(item.productName)}</span>`
    : '';
  const supplier = item.supplierName
    ? `<p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:13px;color:#4A5560;">Supplier: ${escapeHtml(item.supplierName)}</p>`
    : '';
  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFF7EC" style="background-color:#FFF7EC;border-radius:10px;border:1px solid #F3E3C8;margin-top:12px;">',
    '<tr><td style="padding:14px 18px;">',
    `<p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:14px;color:#1F2933;"><strong>${escapeHtml(item.requestCode)}</strong>${product}</p>`,
    supplier,
    `<p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:13px;color:#7A5B22;"><strong>Closes on ${escapeHtml(item.closesOn)}</strong></p>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    '<td bgcolor="#0B7A66" style="background-color:#0B7A66;border-radius:8px;">',
    `<a href="${escapeHtml(item.portalLink)}" target="_blank" style="display:inline-block;padding:10px 18px;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">Submit your quotation</a>`,
    '</td></tr></table>',
    '</td></tr></table>',
  ].join('');
}

function renderPlainText(input: ReminderDigestInput): string {
  const lines: string[] = [
    `Dear ${input.contactName},`,
    '',
    `This is a friendly reminder that ${input.items.length} quotations are still pending.`,
    '',
  ];
  for (const item of input.items) {
    const product = item.productName ? ` — ${item.productName}` : '';
    const supplier = item.supplierName ? `supplier: ${item.supplierName}; ` : '';
    lines.push(`${item.requestCode}${product} (${supplier}closes on ${item.closesOn}): ${item.portalLink}`);
  }
  lines.push(
    '',
    'For security, each link above replaces the one from the previous email.',
    '',
    'Best regards,',
    input.companyName,
  );
  return lines.join('\r\n');
}

export function renderReminderDigest(input: ReminderDigestInput): RenderedReminderDigest {
  const subject = `Reminder: ${input.items.length} quotations pending — ${input.companyName}`;
  const simple: Record<string, string> = {
    subject,
    contactName: input.contactName,
    count: String(input.items.length),
    companyName: input.companyName,
  };

  // Placeholders simples PRIMEIRO: o bloco de itens entra depois, para que um
  // "{{...}}" dentro de um campo de item nunca seja interpretado.
  const withVars = fs
    .readFileSync(TEMPLATE_PATH, 'utf-8')
    .replace(/\{\{([^}]+)\}\}/g, (_, key) => escapeHtml(simple[String(key).trim()] ?? ''));
  const itemsHtml = input.items.map(renderItemHtml).join('');
  const html = withVars.replace(ITEMS_MARKER, () => itemsHtml);

  return { subject, html, text: renderPlainText(input) };
}
