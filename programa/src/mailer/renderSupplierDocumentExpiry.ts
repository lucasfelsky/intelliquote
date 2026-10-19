import { escapeHtml } from './renderQuoteDispatch';
import { addDaysToKey, type SupplierDocumentAlertMilestone } from '../utils/supplierDocumentDates';

// Aviso de vencimento de documentos de fornecedor (PR2). Template SO em codigo:
// funcao pura, sem EmailTemplateService nem leitura de arquivo.
export const SUPPLIER_DOCUMENT_EXPIRY_TEMPLATE_KEY = 'supplier_document_expiry';

export interface SupplierDocumentExpiryRow {
  documentId: number;
  documentName: string;
  supplierId: number;
  supplierName: string;
  /** Ultimo dia valido, YYYY-MM-DD. */
  expiresOn: string;
  daysLeft: number;
  milestone: SupplierDocumentAlertMilestone;
}

export interface RenderSupplierDocumentExpiryInput {
  rows: SupplierDocumentExpiryRow[];
  /** Base do web (ex.: https://intelliquote.portal-comex.com); barra final e removida. */
  webBaseUrl: string;
}

// YYYY-MM-DD -> dd/mm/aaaa sem passar por Date (sem efeito de fuso).
export function formatDateKeyBR(key: string): string {
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
}

export function situationLabel(row: Pick<SupplierDocumentExpiryRow, 'daysLeft' | 'expiresOn'>): string {
  if (row.daysLeft < 0) {
    // expiresOn e o ultimo dia valido: o 1o dia ja vencido e o seguinte.
    return `VENCIDO desde ${formatDateKeyBR(addDaysToKey(row.expiresOn, 1))}`;
  }
  if (row.daysLeft === 0) {
    return 'Vence HOJE';
  }
  if (row.daysLeft === 1) {
    return 'Vence em 1 dia';
  }
  return `Vence em ${row.daysLeft} dias`;
}

export function buildExpirySubject(rows: SupplierDocumentExpiryRow[]): string {
  const expired = rows.filter((row) => row.milestone === 'EXPIRED').length;
  const today = rows.filter((row) => row.milestone === 'D0').length;
  const upcoming = rows.length - expired - today;
  const parts: string[] = [];
  if (expired > 0) {
    parts.push(expired === 1 ? '1 vencido' : `${expired} vencidos`);
  }
  if (today > 0) {
    parts.push(today === 1 ? '1 vence hoje' : `${today} vencem hoje`);
  }
  if (upcoming > 0) {
    parts.push(upcoming === 1 ? '1 a vencer' : `${upcoming} a vencer`);
  }
  return `[IntelliQuote] Documentos de fornecedor: ${parts.join(', ')}`;
}

function sortRows(rows: SupplierDocumentExpiryRow[]): SupplierDocumentExpiryRow[] {
  return [...rows].sort(
    (a, b) =>
      a.daysLeft - b.daysLeft ||
      a.supplierName.localeCompare(b.supplierName, 'pt-BR') ||
      a.documentName.localeCompare(b.documentName, 'pt-BR'),
  );
}

function buildLink(webBaseUrl: string, supplierId: number): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/fornecedores?supplier=${supplierId}`;
}

export function renderSupplierDocumentExpiry(input: RenderSupplierDocumentExpiryInput): {
  subject: string;
  html: string;
  text: string;
} {
  const rows = sortRows(input.rows);
  const subject = buildExpirySubject(rows);

  const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #d0d7de;font-size:13px;"';
  const td = 'style="padding:6px 10px;border-bottom:1px solid #e5e8eb;font-size:13px;"';
  const body = rows
    .map((row) => {
      const link = escapeHtml(buildLink(input.webBaseUrl, row.supplierId));
      return (
        '<tr>' +
        `<td ${td}>${escapeHtml(row.supplierName)}</td>` +
        `<td ${td}>${escapeHtml(row.documentName)}</td>` +
        `<td ${td}>${escapeHtml(formatDateKeyBR(row.expiresOn))}</td>` +
        `<td ${td}>${escapeHtml(situationLabel(row))}</td>` +
        `<td ${td}><a href="${link}">Abrir</a></td>` +
        '</tr>'
      );
    })
    .join('');

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2328;">' +
    '<p>Os documentos de fornecedor abaixo atingiram um marco de vencimento.</p>' +
    '<table style="border-collapse:collapse;width:100%;max-width:760px;">' +
    '<thead><tr>' +
    `<th ${th}>Fornecedor</th><th ${th}>Documento</th><th ${th}>Vencimento</th>` +
    `<th ${th}>Situa&ccedil;&atilde;o</th><th ${th}>Link</th>` +
    '</tr></thead>' +
    `<tbody>${body}</tbody></table>` +
    '<p style="font-size:12px;color:#57606a;">Aviso autom&aacute;tico do IntelliQuote.</p>' +
    '</div>';

  const text = [
    'Os documentos de fornecedor abaixo atingiram um marco de vencimento.',
    '',
    ...rows.map(
      (row) =>
        `- ${row.supplierName} | ${row.documentName} | Vencimento ${formatDateKeyBR(row.expiresOn)} | ` +
        `${situationLabel(row)} | ${buildLink(input.webBaseUrl, row.supplierId)}`,
    ),
    '',
    'Aviso automatico do IntelliQuote.',
  ].join('\n');

  return { subject, html, text };
}
