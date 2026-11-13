import { describe, expect, it } from 'vitest';
import { formatProcessNumber, parseProcessNumber } from '../src/utils/indentProcessNumber';
import { businessDaysSince, queueLevel } from '../src/utils/indentQueue';
import {
  BLOCKED_REASON_APPROVED_ONLY,
  BLOCKED_REASON_BLOCKLIST,
  computeCoverage,
  evaluateSupplierRule,
} from '../src/utils/indentSupplierRule';

describe('numero de processo do Indent', () => {
  it('formatProcessNumber: 3 digitos, 4 acima de 999 e ano com 2 digitos', () => {
    expect(formatProcessNumber(2026, 7)).toBe('007/26');
    expect(formatProcessNumber(2026, 277)).toBe('277/26');
    expect(formatProcessNumber(2026, 1000)).toBe('1000/26');
    expect(formatProcessNumber(2100, 1)).toBe('001/00');
    expect(formatProcessNumber(2027, 1)).toBe('001/27');
  });

  it('parseProcessNumber aceita NNN/AA e rejeita o resto', () => {
    expect(parseProcessNumber('277/26')).toEqual({ seq: 277, yearShort: 26 });
    expect(parseProcessNumber('1000/26')).toEqual({ seq: 1000, yearShort: 26 });
    expect(parseProcessNumber('27/26')).toBeNull();
    expect(parseProcessNumber('277-26')).toBeNull();
    expect(parseProcessNumber('277/2026')).toBeNull();
    expect(parseProcessNumber('')).toBeNull();
  });
});

describe('Na fila ha (dias uteis em Sao Paulo)', () => {
  // 2026-11-13 e sexta-feira.
  const sextaTarde = new Date('2026-11-13T20:00:00.000Z'); // sexta 17:00 BRT

  it('mesmo dia = 0', () => {
    expect(businessDaysSince(sextaTarde, new Date('2026-11-13T23:00:00.000Z'))).toBe(0);
  });

  it('sexta -> segunda = 1 (fim de semana nao conta)', () => {
    expect(businessDaysSince(sextaTarde, new Date('2026-11-16T13:00:00.000Z'))).toBe(1);
  });

  it('sexta -> sabado e domingo = 0', () => {
    expect(businessDaysSince(sextaTarde, new Date('2026-11-14T15:00:00.000Z'))).toBe(0);
    expect(businessDaysSince(sextaTarde, new Date('2026-11-15T15:00:00.000Z'))).toBe(0);
  });

  it('sexta -> quarta = 3', () => {
    expect(businessDaysSince(sextaTarde, new Date('2026-11-18T13:00:00.000Z'))).toBe(3);
  });

  it('usa o dia de Sao Paulo, nao o UTC (virada de dia)', () => {
    // 2026-11-13T01:30Z = quinta 22:30 BRT; agora = sexta 09:00 BRT -> 1 dia util (a sexta).
    expect(businessDaysSince(new Date('2026-11-13T01:30:00.000Z'), new Date('2026-11-13T12:00:00.000Z'))).toBe(1);
    // 2026-11-14T02:00Z = sexta 23:00 BRT; agora = sabado 09:00 BRT -> 0.
    expect(businessDaysSince(new Date('2026-11-14T02:00:00.000Z'), new Date('2026-11-14T12:00:00.000Z'))).toBe(0);
  });

  it('data de entrada no futuro = 0', () => {
    expect(businessDaysSince(new Date('2026-11-20T12:00:00.000Z'), sextaTarde)).toBe(0);
  });

  it('queueLevel: 0 e 1 neutro, 2 no limite, 3 ou mais atrasada', () => {
    expect(queueLevel(0)).toBe('neutral');
    expect(queueLevel(1)).toBe('neutral');
    expect(queueLevel(2)).toBe('warning');
    expect(queueLevel(3)).toBe('danger');
    expect(queueLevel(9)).toBe('danger');
  });
});

describe('restricao de fornecedores do cliente', () => {
  const lista = new Set([1, 2]);

  it('LIVRE permite todos, mesmo com lista', () => {
    expect(evaluateSupplierRule('LIVRE', lista, 1)).toEqual({ allowed: true, blockedReason: null });
    expect(evaluateSupplierRule('LIVRE', lista, 9)).toEqual({ allowed: true, blockedReason: null });
  });

  it('APROVADOS: fora da lista trava com o texto literal', () => {
    expect(evaluateSupplierRule('APROVADOS', lista, 1)).toEqual({ allowed: true, blockedReason: null });
    expect(evaluateSupplierRule('APROVADOS', lista, 9)).toEqual({
      allowed: false,
      blockedReason: 'Fora da lista de fornecedores aprovados do cliente',
    });
    expect(BLOCKED_REASON_APPROVED_ONLY).toBe('Fora da lista de fornecedores aprovados do cliente');
  });

  it('BLOQUEIO: na lista trava com o texto literal', () => {
    expect(evaluateSupplierRule('BLOQUEIO', lista, 2)).toEqual({
      allowed: false,
      blockedReason: 'Fornecedor bloqueado por este cliente',
    });
    expect(evaluateSupplierRule('BLOQUEIO', lista, 9)).toEqual({ allowed: true, blockedReason: null });
    expect(BLOCKED_REASON_BLOCKLIST).toBe('Fornecedor bloqueado por este cliente');
  });

  it('computeCoverage conta so itens com produto presente no catalogo do fornecedor', () => {
    expect(computeCoverage([1, 2, 3], new Set([1, 3]))).toEqual({ covered: 2, total: 3 });
    expect(computeCoverage([1, null, 3], new Set([1, 3]))).toEqual({ covered: 2, total: 3 });
    expect(computeCoverage([null], new Set([1]))).toEqual({ covered: 0, total: 1 });
    expect(computeCoverage([], new Set([1]))).toEqual({ covered: 0, total: 0 });
  });
});
