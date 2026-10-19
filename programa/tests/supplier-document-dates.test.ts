import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  dateKeyToDbDate,
  dbDateToKey,
  daysUntil,
  documentStatus,
  isValidDateKey,
  todayKeyInSaoPaulo,
} from '../src/utils/supplierDocumentDates';

describe('supplierDocumentDates', () => {
  it('todayKeyInSaoPaulo usa o calendario de Sao Paulo (UTC-3)', () => {
    expect(todayKeyInSaoPaulo(new Date('2026-10-20T02:59:00Z'))).toBe('2026-10-19');
    expect(todayKeyInSaoPaulo(new Date('2026-10-20T03:00:00Z'))).toBe('2026-10-20');
  });

  it('isValidDateKey faz round-trip de calendario', () => {
    expect(isValidDateKey('2028-02-29')).toBe(true);
    expect(isValidDateKey('2027-02-29')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('19/10/2026')).toBe(false);
    expect(isValidDateKey(undefined)).toBe(false);
  });

  it('daysUntil conta dias de calendario (inclui ano bissexto)', () => {
    expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2);
    expect(daysUntil('2026-10-19', '2026-10-19')).toBe(0);
    expect(daysUntil('2026-10-18', '2026-10-19')).toBe(-1);
  });

  it('documentStatus: 31 ok, 30/1 expiring, 0 due_today, -1 expired', () => {
    expect(documentStatus(31)).toBe('ok');
    expect(documentStatus(30)).toBe('expiring');
    expect(documentStatus(1)).toBe('expiring');
    expect(documentStatus(0)).toBe('due_today');
    expect(documentStatus(-1)).toBe('expired');
  });

  it('dbDateToKey(dateKeyToDbDate) preserva a data', () => {
    expect(dbDateToKey(dateKeyToDbDate('2028-02-29'))).toBe('2028-02-29');
    expect(dateKeyToDbDate('2026-10-19').toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(() => dateKeyToDbDate('2027-02-29')).toThrow();
  });

  it('virada de ano: 2027-01-01T02:59Z ainda e 31/12 e 03:00Z ja e 01/01 em Sao Paulo', () => {
    expect(todayKeyInSaoPaulo(new Date('2027-01-01T02:59:00Z'))).toBe('2026-12-31');
    expect(todayKeyInSaoPaulo(new Date('2027-01-01T03:00:00Z'))).toBe('2027-01-01');
  });

  it('virada de ano no status: 2026-12-31 vence hoje ate 02:59Z e vira vencido as 03:00Z', () => {
    const before = daysUntil('2026-12-31', todayKeyInSaoPaulo(new Date('2027-01-01T02:59:00Z')));
    const after = daysUntil('2026-12-31', todayKeyInSaoPaulo(new Date('2027-01-01T03:00:00Z')));
    expect(before).toBe(0);
    expect(documentStatus(before)).toBe('due_today');
    expect(after).toBe(-1);
    expect(documentStatus(after)).toBe('expired');
  });

  it('bordas de 30/31 dias atravessando o ano: 2027-01-30 expiring, 2027-01-31 ok', () => {
    const today = '2026-12-31';
    expect(daysUntil('2027-01-30', today)).toBe(30);
    expect(documentStatus(daysUntil('2027-01-30', today))).toBe('expiring');
    expect(daysUntil('2027-01-31', today)).toBe(31);
    expect(documentStatus(daysUntil('2027-01-31', today))).toBe('ok');
  });

  it('addDaysToKey soma dias de calendario (virada de ano e bissexto)', () => {
    expect(addDaysToKey('2026-12-31', 30)).toBe('2027-01-30');
    expect(addDaysToKey('2028-01-30', 30)).toBe('2028-02-29');
    expect(addDaysToKey('2027-01-01', -1)).toBe('2026-12-31');
  });
});
