// Leitura de celulas do exceljs para a planilha de Forecast. Porte de valor()/mesComoTexto() de
// Forecast-prototipo/scripts/importar.ts, com os gotchas do exceljs ja resolvidos:
//  - formula cujo resultado e 0 (ou texto vazio) chega SEM `result`: vale 0;
//  - a coluna MES e TEXTO(data;"mm") com formato de data: o exceljs entrega a data de serie.
import type exceljs from 'exceljs';

export type Bruto = number | string | null;

const pad2 = (n: number) => String(n).padStart(2, '0');

// Date -> YYYY-MM-DD lendo as partes UTC (e assim que o exceljs entrega datas de planilha).
function dateKeyUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Valor "como o Excel mostra": resultado da formula, texto rico juntado, erro vira null.
export function valor(cell: exceljs.Cell): Bruto {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return dateKeyUtc(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // O exceljs descarta o resultado quando o Excel gravou 0 (ou texto vazio).
    if (('formula' in o || 'sharedFormula' in o) && o.result === undefined) return 0;
    if ('result' in o) {
      const r = o.result as unknown;
      if (r === undefined || r === null) return null;
      if (typeof r === 'object' && 'error' in (r as object)) return null;
      if (r instanceof Date) return dateKeyUtc(r);
      return r as Bruto;
    }
    if ('richText' in o) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('error' in o) return null;
    if ('text' in o) return String(o.text);
  }
  return null;
}

export const num = (v: Bruto): number => (typeof v === 'number' ? v : 0);
export const txt = (v: Bruto): string => (v === null ? '' : String(v));

// A celula tem formula (mestre ou compartilhada)?
export function temFormula(cell: exceljs.Cell): boolean {
  const v = cell.value as unknown;
  return typeof v === 'object' && v !== null && ('formula' in v || 'sharedFormula' in v);
}

// A coluna MES e TEXTO(data;"mm") com formato de data na celula: o exceljs le o "10" como a data
// de serie 10 (09/01/1900). Volta para o numero de serie e para o texto "10".
export function mesComoTexto(v: Bruto): string {
  if (typeof v === 'number') return String(v).padStart(2, '0');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const serie = Math.round((Date.parse(`${v}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);
    return String(serie).padStart(2, '0');
  }
  return txt(v);
}

// Cabecalho normalizado: NFD, sem acento, trim, minusculas (mesmo criterio de normalizeHeaderCell
// em supplierImport.ts, reimplementado aqui para nao acoplar os dois importadores).
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

// Numero (1-based) da primeira coluna da linha cujo cabecalho normalizado e um dos `wanted`;
// null se nao achar.
export function findHeaderColumn(row: exceljs.Row, wanted: string[]): number | null {
  const targets = new Set(wanted.map(normalizeHeader));
  for (let c = 1; c <= row.cellCount; c++) {
    if (targets.has(normalizeHeader(txt(valor(row.getCell(c)))))) return c;
  }
  return null;
}
