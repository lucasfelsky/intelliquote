import { SUPPLIER_DOCUMENT_EXPIRING_WINDOW_DAYS } from '../constants/supplierDocuments';

export type SupplierDocumentStatus = 'ok' | 'expiring' | 'due_today' | 'expired';

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const saoPauloFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// "Hoje" no calendario de Sao Paulo (YYYY-MM-DD), independente do TZ do container.
export function todayKeyInSaoPaulo(now: Date): string {
  const parts = saoPauloFormatter.formatToParts(now);
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function parseKey(key: string): { year: number; month: number; day: number } | null {
  const match = DATE_KEY_PATTERN.exec(key);
  if (!match) {
    return null;
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

// Round-trip pelo calendario UTC: rejeita 2027-02-29, 2026-13-01 etc.
export function isValidDateKey(key: unknown): key is string {
  if (typeof key !== 'string') {
    return false;
  }
  const parsed = parseKey(key);
  if (!parsed) {
    return false;
  }
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  return (
    date.getUTCFullYear() === parsed.year &&
    date.getUTCMonth() === parsed.month - 1 &&
    date.getUTCDate() === parsed.day
  );
}

// Coluna @db.Date: grava sempre a meia-noite UTC do dia informado.
export function dateKeyToDbDate(key: string): Date {
  if (!isValidDateKey(key)) {
    throw new Error(`Data invalida: ${key}`);
  }
  return new Date(`${key}T00:00:00.000Z`);
}

export function dbDateToKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function keyToUtcMs(key: string): number {
  const parsed = parseKey(key);
  if (!parsed) {
    throw new Error(`Data invalida: ${key}`);
  }
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day);
}

// Dias de calendario entre hoje e o vencimento (negativo = ja vencido).
export function daysUntil(expiresOnKey: string, todayKey: string): number {
  return Math.round((keyToUtcMs(expiresOnKey) - keyToUtcMs(todayKey)) / MS_PER_DAY);
}

// A data de vencimento e o ULTIMO dia valido: 0 = vence hoje, < 0 = vencido.
export function documentStatus(daysLeft: number): SupplierDocumentStatus {
  if (daysLeft < 0) {
    return 'expired';
  }
  if (daysLeft === 0) {
    return 'due_today';
  }
  if (daysLeft <= SUPPLIER_DOCUMENT_EXPIRING_WINDOW_DAYS) {
    return 'expiring';
  }
  return 'ok';
}

// Soma `days` (pode ser negativo) a uma chave YYYY-MM-DD pelo calendario UTC.
export function addDaysToKey(key: string, days: number): string {
  return new Date(keyToUtcMs(key) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// Marcos dos avisos de vencimento por e-mail (PR2). D0 = vence hoje; EXPIRED = ja vencido.
export const SUPPLIER_DOCUMENT_ALERT_MILESTONES = ['D30', 'D15', 'D7', 'D0', 'EXPIRED'] as const;

export type SupplierDocumentAlertMilestone = (typeof SUPPLIER_DOCUMENT_ALERT_MILESTONES)[number];

// Marco mais urgente ja atingido para `daysLeft` (null = ainda fora da janela de 30 dias).
// Catch-up: um documento vencido ha muito tempo cai direto em EXPIRED.
export function resolveMilestone(daysLeft: number): SupplierDocumentAlertMilestone | null {
  if (daysLeft < 0) {
    return 'EXPIRED';
  }
  if (daysLeft === 0) {
    return 'D0';
  }
  if (daysLeft <= 7) {
    return 'D7';
  }
  if (daysLeft <= 15) {
    return 'D15';
  }
  if (daysLeft <= SUPPLIER_DOCUMENT_EXPIRING_WINDOW_DAYS) {
    return 'D30';
  }
  return null;
}
