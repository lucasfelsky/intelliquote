import { randomUUID } from 'crypto';
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
  /** PO (QuoteRequestPurchaseOrder) a que o item pertence; usado so para agrupar. */
  purchaseOrderId?: number | null;
}

export interface QuoteDispatchPurchaseOrder {
  id: number;
  label: string;
  position: number;
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
  /** POs da cotacao (lidas no momento do render). So agrupa com 2 ou mais. */
  purchaseOrders?: QuoteDispatchPurchaseOrder[];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface DispatchItemGroup {
  key: string;
  label: string;
  items: QuoteDispatchItem[];
}

/**
 * Agrupa os itens por PO, espelhando public/portal.html (groupItemsByPurchaseOrder).
 * Retorna null (modo plano) com menos de 2 POs, sem itens, ou quando nenhum item
 * pertence a uma PO listada.
 */
export function groupDispatchItemsByPurchaseOrder(
  items: QuoteDispatchItem[],
  purchaseOrders?: QuoteDispatchPurchaseOrder[],
): DispatchItemGroup[] | null {
  const pos = purchaseOrders ?? [];
  if (pos.length < 2 || items.length === 0) return null;
  const sorted = [...pos].sort((a, b) => a.position - b.position || a.id - b.id);
  const known = new Set(sorted.map((po) => po.id));
  if (!items.some((it) => it.purchaseOrderId != null && known.has(it.purchaseOrderId))) {
    return null;
  }
  const groups: DispatchItemGroup[] = [];
  for (const po of sorted) {
    const poItems = items.filter((it) => it.purchaseOrderId === po.id);
    if (poItems.length === 0) continue;
    groups.push({ key: `po-${po.id}`, label: po.label, items: poItems });
  }
  const others = items.filter(
    (it) => it.purchaseOrderId == null || !known.has(it.purchaseOrderId),
  );
  if (others.length > 0) {
    groups.push({ key: 'other', label: 'Other items', items: others });
  }
  return groups;
}

export function itemCountLabel(n: number): string {
  return n === 1 ? '1 item' : `${n} items`;
}

function renderItemRow(item: QuoteDispatchItem, idx: number, zebra = true): string {
  const bg = zebra && idx % 2 === 0 ? '#F8FBFA' : '#ffffff';
  const incotermCell = item.desiredIncoterm
    ? `<td align="left" width="80" style="width:80px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#1F2933;">${escapeHtml(item.desiredIncoterm)}</td>`
    : `<td align="left" width="80" style="width:80px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#9aa4ad;font-style:italic;">&#8212;</td>`;
  const originCell = item.originPort
    ? `<td align="left" width="100" style="width:100px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#1F2933;">${escapeHtml(item.originPort)}</td>`
    : `<td align="left" width="100" style="width:100px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#9aa4ad;font-style:italic;">&#8212;</td>`;
  const destinationCell = item.destinationPort
    ? `<td align="left" width="120" style="width:120px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#1F2933;">${escapeHtml(item.destinationPort)}</td>`
    : `<td align="left" width="120" style="width:120px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#9aa4ad;font-style:italic;">&#8212;</td>`;
  return `
      <tr bgcolor="${bg}" style="background-color:${bg};">
        <td align="left" width="182" style="width:182px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#1F2933;">
          <div style="font-weight:bold;color:#1F2933;">${escapeHtml(item.marketName)}</div>
        </td>
        <td align="right" width="80" style="width:80px;padding:10px 12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#1F2933;">${item.quantity} ${escapeHtml(item.unit)}</td>
        ${incotermCell}
        ${originCell}
        ${destinationCell}
      </tr>`;
}

function renderGroupTitleRow(label: string, count: number, isFirst: boolean): string {
  // Padrao do portal (.po-group-title): fundo branco, nome em negrito 15px, contador em
  // pilula cinza; a partir do 2o grupo, borda superior e mais espaco acima.
  const padding = isFirst ? '14px 12px 8px' : '22px 12px 8px';
  const borderTop = isFirst ? '' : 'border-top:1px solid #ECF1EF;';
  return `<tr><td colspan="5" align="left" bgcolor="#ffffff" style="background-color:#ffffff;padding:${padding};${borderTop}border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#1F2933;">${escapeHtml(label)} <span style="display:inline-block;margin-left:4px;padding:2px 10px;border-radius:999px;background-color:#ECF1EF;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;color:#4A5560;white-space:nowrap;">${itemCountLabel(count)}</span></td></tr>`;
}

function renderItemsRows(
  items: QuoteDispatchItem[],
  purchaseOrders?: QuoteDispatchPurchaseOrder[],
): string {
  if (items.length === 0) {
    return `
      <tr>
        <td colspan="5" align="center" style="padding:12px;border-bottom:1px solid #ECF1EF;font-family:Arial,sans-serif;font-size:13px;color:#4A5560;font-style:italic;">No items listed.</td>
      </tr>`;
  }
  const groups = groupDispatchItemsByPurchaseOrder(items, purchaseOrders);
  if (!groups) {
    return items.map((item, idx) => renderItemRow(item, idx)).join('');
  }
  return groups
    .map(
      (group, groupIdx) =>
        renderGroupTitleRow(group.label, group.items.length, groupIdx === 0) +
        group.items.map((item, idx) => renderItemRow(item, idx, false)).join(''),
    )
    .join('');
}

export function renderItemsTable(
  items: QuoteDispatchItem[],
  purchaseOrders?: QuoteDispatchPurchaseOrder[],
): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;font-family:Arial,sans-serif;font-size:13px;">
        <colgroup>
          <col style="width:182px;" />
          <col style="width:80px;" />
          <col style="width:80px;" />
          <col style="width:100px;" />
          <col style="width:120px;" />
        </colgroup>
        <thead>
          <tr bgcolor="#F8FBFA" style="background-color:#F8FBFA;">
            <th align="left" width="182" style="width:182px;padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-size:11px;font-weight:bold;font-family:Arial,sans-serif;">PRODUCT</th>
            <th align="right" width="80" style="width:80px;padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-size:11px;font-weight:bold;font-family:Arial,sans-serif;">QTY</th>
            <th align="left" width="80" style="width:80px;padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-size:11px;font-weight:bold;font-family:Arial,sans-serif;">INCOTERM</th>
            <th align="left" width="100" style="width:100px;padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-size:11px;font-weight:bold;font-family:Arial,sans-serif;">ORIGIN</th>
            <th align="left" width="120" style="width:120px;padding:10px 12px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-size:11px;font-weight:bold;font-family:Arial,sans-serif;">DESTINATION</th>
          </tr>
        </thead>
        <tbody>${renderItemsRows(items, purchaseOrders)}</tbody>
      </table>`;
}

function renderItemTextLine(i: QuoteDispatchItem): string {
  const portPart = i.destinationPort ? ` | Dest: ${i.destinationPort}` : '';
  const incoPart = i.desiredIncoterm ? ` | ${i.desiredIncoterm}` : '';
  const originPart = i.originPort ? ` | Origin: ${i.originPort}` : '';
  return `  - ${i.marketName}${incoPart}${portPart}${originPart} | ${i.quantity} ${i.unit}`;
}

export function renderItemsText(
  items: QuoteDispatchItem[],
  purchaseOrders?: QuoteDispatchPurchaseOrder[],
): string {
  const groups = groupDispatchItemsByPurchaseOrder(items, purchaseOrders);
  if (!groups) {
    return items.map(renderItemTextLine).join('\n');
  }
  return groups
    .map((group) =>
      [
        `${group.label} - ${itemCountLabel(group.items.length)}`,
        ...group.items.map(renderItemTextLine),
      ].join('\n'),
    )
    .join('\n\n');
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
    if (trimmed === 'itemsTable') return renderItemsTable(vars.items, vars.purchaseOrders);
    if (trimmed === 'itemsRows') return renderItemsRows(vars.items, vars.purchaseOrders);
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
    ...(vars.items.length > 0 ? [renderItemsText(vars.items, vars.purchaseOrders)] : []),
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
  subjectOverride?: string,
): Promise<RenderedDispatch> {
  const dbTemplate = await EmailTemplateService.get(DISPATCH_TEMPLATE_KEY, locale);
  const override = subjectOverride?.trim();
  const subject = override
    ? override
    : dbTemplate?.subject
    ? renderSections(dbTemplate.subject, vars)
    : vars.subject;
  const varsForRender = { ...vars, subject };

  if (dbTemplate) {
    const html = renderSections(dbTemplate.htmlBody, varsForRender);
    // {{itemsText}} precisa ser trocado fora do renderSections: la, todo {{x}}
    // desconhecido vira '' e o placeholder nunca chegaria ao replace final.
    // Token com nonce por chamada: conteudo do usuario nao consegue forja-lo.
    const itemsTextToken = `\u0000ITEMS_TEXT_${randomUUID()}\u0000`;
    const itemsText = renderItemsText(vars.items, vars.purchaseOrders);
    const text = renderSections(
      dbTemplate.textBody.replace(/\{\{\s*itemsText\s*\}\}/g, itemsTextToken),
      varsForRender,
    )
      .split(itemsTextToken)
      .join(itemsText);
    return { html, text, subject, source: 'database' };
  }

  const fallback = renderQuoteDispatch(varsForRender);
  const fallbackSubject = varsForRender.subject;
  return { html: fallback.html, text: fallback.text, subject: fallbackSubject, source: 'fallback' };
}
