import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { logger } from '../lib/logger';
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
  // Preco unitario ofertado pelo fornecedor. QuoteResponse guarda um preco
  // agregado por fornecedor (nao por item), entao hoje o mesmo valor se
  // repete em todas as linhas da mesma resposta -- ainda assim melhor do
  // que mostrar "-", que o usuario apontou como informacao perdida.
  unitPrice: number | null;
  // Preco-alvo DA LINHA. Opcional -- sem isso, `renderReplySampleVars`
  // (preview de Templates.tsx) continua funcionando sem quebrar o tsc.
  // Template com {{itemsHeaderRow}}: vira a coluna TARGET PRICE (so' existe
  // quando alguma linha tem alvo). Template legado (sem o placeholder): sub-linha
  // "Target:" dentro da celula de Unit Price.
  targetPrice?: number | null;
  // true quando o alvo da linha veio do preco-alvo AGREGADO da proposta
  // (QuoteResponse.targetPrice). No modo legado ele ja' sai na linha
  // "Target Price:" depois da tabela, entao a sub-linha e' omitida.
  targetFromAggregate?: boolean;
  // Fornecedor marcou o item como "Temporarily unavailable": sem preco/total/target.
  isUnavailable?: boolean;
}

export interface QuoteReplyVars {
  subject: string;
  quoteRequestId: number;
  requestCode: string;
  productName: string;
  supplierName: string;
  supplierContactName: string;
  currency: string;
  // Preco-alvo AGREGADO (so' relevante no modo legado e nas intros).
  targetPrice?: number;
  isWinner: boolean;
  items: QuoteReplyItem[];
  // true quando ha' pelo menos um target por item (mesmo sem `targetPrice`
  // agregado) -- dispara a mesma wording de negociacao das intros.
  hasItemTargets?: boolean;
  // Mensagem digitada no modal "Responder". Aparece logo apos "Dear <contato>,"
  // via {{message}} (HTML) / {{messageText}} (texto puro).
  message?: string;
}

function formatEnNumber(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMoney(value: number | null, currency: string): string {
  if (value === null) return '&#8212;';
  return `${formatEnNumber(value)} ${escapeHtml(currency)}`;
}

const UNAVAILABLE_LABEL = 'Temporarily unavailable';
const REPLY_CUSTOM_MESSAGE_SLOT = '<!--CUSTOM_MESSAGE_SLOT-->';

// ---------------------------------------------------------------------------
// Tabela de itens
// ---------------------------------------------------------------------------

const TARGET_COLUMN_BG = '#E5E7EB';
const TARGET_COLUMN_STYLE = `background-color:${TARGET_COLUMN_BG};font-weight:bold;color:#1F2933;`;

// Larguras (px). Sem coluna de alvo: as 5 colunas de sempre. Com a coluna:
// 150+70+90+85+90+85 = 570 (<= 576 uteis do template de 640px com padding 32).
const WIDTHS_5 = { item: 200, incoterm: 80, quantity: 100, unitPrice: 90, total: 90 };
const WIDTHS_6 = { item: 150, incoterm: 70, quantity: 90, unitPrice: 85, target: 90, total: 85 };

function hasTargetColumn(items: QuoteReplyItem[]): boolean {
  return items.some((item) => !item.isUnavailable && item.targetPrice != null);
}

const HEADER_CELL_STYLE =
  'padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-size:11px;font-weight:bold;font-family:Arial,sans-serif;';

function headerCell(label: string, align: 'left' | 'right', width: number, extraStyle = '', bgAttr = ''): string {
  return `<th align="${align}" width="${width}"${bgAttr} style="width:${width}px;${HEADER_CELL_STYLE}${extraStyle}">${label}</th>`;
}

// Cabecalho da tabela ({{itemsHeaderRow}}). Gerado em codigo, junto com as
// linhas, para garantir o mesmo numero de colunas nos dois lados.
function renderItemsHeaderRow(items: QuoteReplyItem[]): string {
  const withTarget = hasTargetColumn(items);
  const w = withTarget ? WIDTHS_6 : WIDTHS_5;
  const cells = [
    headerCell('ITEM', 'left', w.item),
    headerCell('INCOTERM', 'left', w.incoterm),
    headerCell('QUANTITY', 'right', w.quantity),
    headerCell('UNIT PRICE', 'right', w.unitPrice),
    ...(withTarget
      ? [headerCell('TARGET PRICE', 'right', WIDTHS_6.target, `${TARGET_COLUMN_STYLE}white-space:nowrap;`, ` bgcolor="${TARGET_COLUMN_BG}"`)]
      : []),
    headerCell('TOTAL', 'right', w.total),
  ];
  return `<tr bgcolor="#F8FBFA" style="background-color:#F8FBFA;">
                        ${cells.join('\n                        ')}
                      </tr>`;
}

const BODY_CELL_STYLE =
  'padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;';

function bodyCell(
  align: 'left' | 'right',
  width: number,
  colorStyle: string,
  content: string,
  extra: { bgAttr?: string; style?: string } = {},
): string {
  return `<td align="${align}" width="${width}"${extra.bgAttr ?? ''} style="width:${width}px;${BODY_CELL_STYLE}${colorStyle}${extra.style ?? ''}">${content}</td>`;
}

const COLOR_NORMAL = 'color:#1F2933;';
const COLOR_MUTED = 'color:#9aa4ad;font-style:italic;';

interface RowsOptions {
  // Template com {{itemsHeaderRow}}: a coluna TARGET PRICE existe quando alguma linha tem alvo.
  withTargetColumn: boolean;
  // Template legado: sub-linha "Target:" na celula de Unit Price.
  legacyTargetSubline: boolean;
}

// Celula da coluna TARGET PRICE (cinza forte). Vazia fora do modo coluna.
function targetCell(opts: RowsOptions, content: string, muted: boolean): string {
  if (!opts.withTargetColumn) return '';
  return `\n        ${bodyCell('right', WIDTHS_6.target, '', content, {
    bgAttr: ` bgcolor="${TARGET_COLUMN_BG}"`,
    style: `${TARGET_COLUMN_STYLE}white-space:nowrap;${muted ? 'color:#6B7280;' : ''}`,
  })}`;
}

function renderItemRow(item: QuoteReplyItem, idx: number, currency: string, opts: RowsOptions): string {
  const bg = idx % 2 === 0 ? '#F8FBFA' : '#ffffff';
  const w = opts.withTargetColumn ? WIDTHS_6 : WIDTHS_5;
  const nameCell = bodyCell('left', w.item, COLOR_NORMAL, escapeHtml(item.name));
  const incotermCell = bodyCell('left', w.incoterm, COLOR_NORMAL, escapeHtml(item.incoterm));
  // Com 6 colunas o espaco aperta: valores monetarios/quantidade nao quebram linha.
  const nowrap = opts.withTargetColumn ? { style: 'white-space:nowrap;' } : {};
  const quantityCell = bodyCell('right', w.quantity, COLOR_NORMAL, `${formatEnNumber(item.quantity)} ${escapeHtml(item.unit)}`, nowrap);

  if (item.isUnavailable) {
    return `
      <tr bgcolor="${bg}" style="background-color:${bg};">
        ${nameCell}
        ${incotermCell}
        ${quantityCell}
        ${bodyCell('right', w.unitPrice, COLOR_MUTED, UNAVAILABLE_LABEL)}${targetCell(opts, '&#8212;', true)}
        ${bodyCell('right', w.total, COLOR_MUTED, '&#8212;')}
      </tr>`;
  }

  const total = item.unitPrice === null ? null : item.unitPrice * item.quantity;
  const emptyStyle = item.unitPrice === null ? COLOR_MUTED : COLOR_NORMAL;
  // Modo legado: target do item como sub-linha da celula de Unit Price (sem
  // coluna nova). Alvo vindo do agregado ja' sai na linha "Target Price:".
  const itemTargetHtml =
    opts.legacyTargetSubline && item.targetPrice != null && !item.targetFromAggregate
      ? `<br /><span style="font-size:11px;color:#4A5560;">Target: ${formatMoney(item.targetPrice, currency)}</span>`
      : '';
  const targetContent = item.targetPrice != null ? formatMoney(item.targetPrice, currency) : '&#8212;';
  return `
      <tr bgcolor="${bg}" style="background-color:${bg};">
        ${nameCell}
        ${incotermCell}
        ${quantityCell}
        ${bodyCell('right', w.unitPrice, emptyStyle, `${formatMoney(item.unitPrice, currency)}${itemTargetHtml}`, nowrap)}${targetCell(opts, targetContent, item.targetPrice == null)}
        ${bodyCell('right', w.total, emptyStyle, formatMoney(total, currency), nowrap)}
      </tr>`;
}

function renderItemsRows(items: QuoteReplyItem[], currency: string, opts: RowsOptions): string {
  if (items.length === 0) {
    return `
      <tr>
        <td colspan="${opts.withTargetColumn ? 6 : 5}" align="center" style="padding:12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#4A5560;font-style:italic;">No items listed.</td>
      </tr>`;
  }
  return items.map((item, idx) => renderItemRow(item, idx, currency, opts)).join('');
}

// Linha de texto puro. `withTarget`: formato novo com coluna Target Price.
// Sem ele: formato legado (alvo como sufixo "(Target: ...)" do Unit Price).
function renderItemsTextRow(item: QuoteReplyItem, currency: string, withTarget = false): string {
  if (item.isUnavailable) {
    return withTarget
      ? `${item.name}\t${item.incoterm}\t${formatEnNumber(item.quantity)} ${item.unit}\t${UNAVAILABLE_LABEL}\t—\t—`
      : `${item.name}\t${item.incoterm}\t${formatEnNumber(item.quantity)} ${item.unit}\t${UNAVAILABLE_LABEL}\t—`;
  }
  const total = item.unitPrice === null ? null : item.unitPrice * item.quantity;
  const unitPriceText = item.unitPrice === null ? '—' : `${formatEnNumber(item.unitPrice)} ${currency}`;
  const totalText = total === null ? '—' : `${formatEnNumber(total)} ${currency}`;
  if (withTarget) {
    const targetText = item.targetPrice != null ? `${formatEnNumber(item.targetPrice)} ${currency}` : '—';
    return `${item.name}\t${item.incoterm}\t${formatEnNumber(item.quantity)} ${item.unit}\t${unitPriceText}\t${targetText}\t${totalText}`;
  }
  const targetSuffix = item.targetPrice != null && !item.targetFromAggregate
    ? ` (Target: ${formatEnNumber(item.targetPrice)} ${currency})`
    : '';
  return `${item.name}\t${item.incoterm}\t${formatEnNumber(item.quantity)} ${item.unit}\t${unitPriceText}${targetSuffix}\t${totalText}`;
}

// Tabela em texto puro ({{itemsTextTable}} e fallback): cabecalho + linhas, com
// a coluna Target Price somente quando alguma linha tem alvo.
function renderItemsTextTableLines(vars: QuoteReplyVars): string[] {
  const withTarget = hasTargetColumn(vars.items);
  return [
    withTarget
      ? 'Item\tIncoterm\tQuantity\tUnit Price\tTarget Price\tTotal'
      : 'Item\tIncoterm\tQuantity\tUnit Price\tTotal',
    ...vars.items.map((item) => renderItemsTextRow(item, vars.currency, withTarget)),
  ];
}

// ---------------------------------------------------------------------------
// Mensagem do modal
// ---------------------------------------------------------------------------

function trimmedMessage(vars: { message?: string }): string {
  return typeof vars.message === 'string' ? vars.message.trim() : '';
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

// Bloco com leve destaque (Outlook-safe: tabela de apresentacao, bgcolor +
// borda esquerda, sem classes; o espacamento inferior e' uma linha propria
// porque o Outlook ignora margin em <table>).
function renderMessageHtml(vars: { message?: string }): string {
  const message = trimmedMessage(vars);
  if (!message) return '';
  const safe = escapeHtml(normalizeNewlines(message)).replace(/\n/g, '<br />');
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                      <td bgcolor="#EEF7F4" style="background-color:#EEF7F4;border-left:4px solid #184054;padding:12px 16px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1F2933;">${safe}</td>
                    </tr>
                    <tr>
                      <td height="12" style="height:12px;line-height:12px;font-size:1px;">&nbsp;</td>
                    </tr>
                  </table>`;
}

// "mensagem\r\n\r\n" ou '' (sem linha vazia sobrando).
function renderMessageText(vars: { message?: string }): string {
  const message = trimmedMessage(vars);
  if (!message) return '';
  return `${normalizeNewlines(message).replace(/\n/g, '\r\n')}\r\n\r\n`;
}

function hasPlaceholder(template: string, key: string): boolean {
  return new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`).test(template);
}

// ---------------------------------------------------------------------------
// Secoes / placeholders
// ---------------------------------------------------------------------------

export function renderReplySections(template: string, vars: QuoteReplyVars): string {
  const out = template.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
    const value = (vars as unknown as Record<string, unknown>)[key];
    const hasValue = value !== undefined && value !== null && String(value).trim().length > 0;
    return hasValue ? body : '';
  });

  // Template com {{itemsHeaderRow}} = modo coluna; sem ele = modo legado (5
  // colunas + sub-linha "Target:"), exatamente como era antes.
  const columnMode = hasPlaceholder(template, 'itemsHeaderRow');
  const rowsOptions: RowsOptions = {
    withTargetColumn: columnMode && hasTargetColumn(vars.items),
    legacyTargetSubline: !columnMode,
  };

  return out.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = String(key).trim();
    if (trimmed === 'itemsHeaderRow') return renderItemsHeaderRow(vars.items);
    if (trimmed === 'itemsRows') return renderItemsRows(vars.items, vars.currency, rowsOptions);
    if (trimmed === 'message') return renderMessageHtml(vars);
    // Placeholders de texto puro: saem crus (sem escapeHtml).
    if (trimmed === 'messageText') return renderMessageText(vars);
    if (trimmed === 'itemsText') {
      return vars.items.map((item) => renderItemsTextRow(item, vars.currency)).join('\n');
    }
    if (trimmed === 'itemsTextTable') return renderItemsTextTableLines(vars).join('\r\n');
    const value = (vars as unknown as Record<string, unknown>)[trimmed];
    if (value === undefined || value === null) return '';
    return escapeHtml(String(value));
  });
}

export function buildReplyIntro(vars: { targetPrice?: number; hasItemTargets?: boolean; isWinner: boolean; requestCode: string; productName?: string }): string {
  const productSuffix = vars.productName ? ` — ${vars.productName}` : '';
  const prefix = `Thank you for your quotation on ${vars.requestCode}${productSuffix}.`;

  if ((vars.targetPrice !== undefined && vars.targetPrice !== null) || vars.hasItemTargets) {
    return `${prefix} We are currently evaluating your proposal and, to move forward, we would like to discuss adjusting the price towards our target below.`;
  }
  if (vars.isWinner) {
    return `${prefix} We are pleased to inform you that your proposal has been selected as the winning offer for this quote.`;
  }
  return `${prefix} We are currently reviewing your proposal along with other offers received for this quote.`;
}

export function buildReplyItemsIntro(vars: { targetPrice?: number; hasItemTargets?: boolean; isWinner: boolean }): string {
  if ((vars.targetPrice !== undefined && vars.targetPrice !== null) || vars.hasItemTargets) {
    return 'Please find the items under discussion below:';
  }
  if (vars.isWinner) {
    return 'Please find the accepted items below:';
  }
  return 'Please find your submitted items below:';
}

export function renderReplyPlainText(vars: QuoteReplyVars): string {
  const withTarget = hasTargetColumn(vars.items);
  const messageText = renderMessageText(vars);
  return [
    `Dear ${vars.supplierContactName},`,
    '',
    ...(messageText ? [messageText.replace(/\r\n\r\n$/, ''), ''] : []),
    buildReplyIntro(vars),
    '',
    buildReplyItemsIntro(vars),
    '',
    ...renderItemsTextTableLines(vars),
    '',
    // Com a coluna, o alvo ja' esta na tabela; sem coluna mas com agregado, a linha continua.
    ...(!withTarget && vars.targetPrice !== undefined
      ? [`Target Price: ${formatMoney(vars.targetPrice, vars.currency).replace('&#8212;', '—')}`, '']
      : []),
    'Best regards,',
  ].join('\r\n');
}

// Rascunho EDITAVEL do corpo texto puro (tela Templates sem linha no banco):
// mantem os placeholders crus. Nunca usar o preview renderizado como corpo
// salvavel -- mensagem/itens de exemplo virariam texto fixo.
export function buildReplyTextTemplateDraft(): string {
  return [
    'Dear {{supplierContactName}},',
    '',
    '{{messageText}}{{introText}}',
    '',
    '{{itemsIntroText}}',
    '',
    '{{itemsTextTable}}',
    '',
    'Best regards,',
  ].join('\r\n');
}

// Variaveis derivadas (intros + {{targetPriceStr}}). `targetInTable`: o alvo ja'
// aparece na tabela (coluna), entao a linha solta "Target Price:" nao deve sair.
function withDerivedVars(vars: QuoteReplyVars, targetInTable: boolean): QuoteReplyVars {
  const targetPriceStr =
    vars.targetPrice !== undefined && !targetInTable ? formatMoney(vars.targetPrice, vars.currency) : undefined;
  return {
    ...vars,
    targetPriceStr,
    introText: buildReplyIntro(vars),
    itemsIntroText: buildReplyItemsIntro(vars),
  } as QuoteReplyVars;
}

// Renderiza o HTML de um template (arquivo ou banco) com a regra de
// compatibilidade para templates antigos/customizados:
//  - com {{message}}: a mensagem entra no placeholder (o slot, se houver, fica vazio);
//  - sem {{message}} mas com <!--CUSTOM_MESSAGE_SLOT-->: a mensagem entra no slot
//    (formato antigo, depois da tabela);
//  - sem nenhum dos dois: a mensagem nao entra no HTML (logger.warn).
export function renderReplyHtmlFromTemplate(htmlTemplate: string, vars: QuoteReplyVars): string {
  const columnMode = hasPlaceholder(htmlTemplate, 'itemsHeaderRow');
  const hasMessagePlaceholder = hasPlaceholder(htmlTemplate, 'message');
  const hasSlot = htmlTemplate.includes(REPLY_CUSTOM_MESSAGE_SLOT);

  let html = renderReplySections(
    htmlTemplate,
    withDerivedVars(vars, columnMode && hasTargetColumn(vars.items)),
  );

  if (hasSlot) {
    const slotContent = hasMessagePlaceholder ? '' : renderLegacyMessageBlock(vars);
    // Replacer em funcao: o conteudo do usuario pode conter "$&" etc.
    html = html.replace(REPLY_CUSTOM_MESSAGE_SLOT, () => slotContent);
  } else if (!hasMessagePlaceholder && trimmedMessage(vars)) {
    logger.warn(
      { templateKey: REPLY_TEMPLATE_KEY },
      'Template quote_reply sem {{message}} nem <!--CUSTOM_MESSAGE_SLOT-->: a mensagem do modal nao entrou no HTML.',
    );
  }
  return html;
}

// Mesma regra de compatibilidade para o corpo texto puro: sem {{messageText}}
// a mensagem e' prefixada (formato antigo).
export function renderReplyTextFromTemplate(textTemplate: string, vars: QuoteReplyVars): string {
  const hasMessagePlaceholder = hasPlaceholder(textTemplate, 'messageText');
  const targetInTable = hasPlaceholder(textTemplate, 'itemsTextTable') && hasTargetColumn(vars.items);
  const text = renderReplySections(textTemplate, withDerivedVars(vars, targetInTable));
  return hasMessagePlaceholder ? text : withReplyCustomMessageText(text, trimmedMessage(vars));
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
//
// Precedencia do assunto: subjectOverride (digitado no modal ou assunto do
// envio inicial, resolvido pelo controller) > assunto do template do banco
// renderizado > vars.subject.
export async function renderReplyFromTemplate(
  vars: QuoteReplyVars,
  locale: string = REPLY_DEFAULT_LOCALE,
  subjectOverride?: string,
): Promise<RenderedQuoteReply> {
  const dbTemplate = await EmailTemplateService.get(REPLY_TEMPLATE_KEY, locale);
  const override = subjectOverride?.trim();
  const subject = override
    ? override
    : dbTemplate?.subject
      ? renderReplySections(dbTemplate.subject, vars)
      : vars.subject;
  const varsForRender: QuoteReplyVars = { ...vars, subject };

  if (dbTemplate) {
    const html = renderReplyHtmlFromTemplate(dbTemplate.htmlBody, varsForRender);
    const text = dbTemplate.textBody
      ? renderReplyTextFromTemplate(dbTemplate.textBody, varsForRender)
      : renderReplyPlainText(varsForRender);
    return { html, text, subject, source: 'database' };
  }

  const html = renderReplyHtmlFromTemplate(loadFileTemplate(), varsForRender);
  const text = renderReplyPlainText(varsForRender);
  return { html, text, subject, source: 'fallback' };
}

// Bloco da mensagem no formato antigo (tabela propria depois da tabela de
// itens), usado so' para templates do banco que ainda dependem do marcador
// <!--CUSTOM_MESSAGE_SLOT-->.
function renderLegacyMessageBlock(vars: { message?: string }): string {
  const message = trimmedMessage(vars);
  if (!message) return '';
  return injectReplyCustomMessage(REPLY_CUSTOM_MESSAGE_SLOT, message);
}

// Insere a mensagem digitada na hora de responder no lugar do marcador
// `<!--CUSTOM_MESSAGE_SLOT-->` do template (formato antigo, mesmo mecanismo
// do `injectCustomMessage` do dispatch).
export function injectReplyCustomMessage(html: string, message: string): string {
  if (!message) return html;
  const safe = escapeHtml(message).replace(/\n/g, '<br />');
  const block = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;">
      <tr>
        <td style="padding:0 32px 16px 32px;font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#1F2933;">${safe}</td>
      </tr>
    </table>`;
  return html.replace(REPLY_CUSTOM_MESSAGE_SLOT, () => block);
}

export function withReplyCustomMessageText(text: string, message: string): string {
  return message ? `${message}\n\n${text}` : text;
}
