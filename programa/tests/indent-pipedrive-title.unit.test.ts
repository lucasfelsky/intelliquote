import { describe, expect, it } from 'vitest';
import { parseDealTitle } from '../src/utils/indentPipedriveTitle';

// Titulos FICTICIOS no formato real. "Agora" fixo: 13/11/2026 (BRT) -> anos aceitos 2025, 2026 e 2027.
const NOW = new Date('2026-11-13T15:00:00-03:00');

describe('parseDealTitle', () => {
  const valid: Array<[string, number | null, string]> = [
    ['274/26 INDENT - CLIENTE EXEMPLO', null, '274/26'],
    ['INDENT 270/26 - CLIENTE EXEMPLO', null, '270/26'],
    ['R2 - 263/26 INDENT CLIENTE EXEMPLO', 2, '263/26'],
    ['r2-263/26', 2, '263/26'],
    ['R10 – 001/27', 10, '001/27'],
    ['R3: 263/26 CLIENTE EXEMPLO', 3, '263/26'],
    ['R2 263/26 CLIENTE EXEMPLO', 2, '263/26'],
    ['R 2 - 274/26 INDENT', 2, '274/26'],
    ['R2 — 274/26', 2, '274/26'],
    ['  274/26   INDENT  ', null, '274/26'],
    ['74/26 INDENT', null, '074/26'],
    ['4/26 INDENT', null, '004/26'],
    ['1000/26 INDENT', null, '1000/26'],
    ['CLIENTE EXEMPLO (274/26)', null, '274/26'],
    ['274/26 INDENT - CLIENTE 274/26', null, '274/26'],
    ['R2D2 - 274/26', null, '274/26'],
    ['RESINA EXEMPLO 274/26', null, '274/26'],
  ];
  it.each(valid)('%s -> revisao %s, numero %s', (title, revision, processNumber) => {
    const parsed = parseDealTitle(title, NOW);
    expect(parsed.problem).toBeNull();
    expect(parsed.revision).toBe(revision);
    expect(parsed.processNumber).toBe(processNumber);
  });

  it('devolve ano e sequencia numericos', () => {
    expect(parseDealTitle('R2 - 074/26 INDENT', NOW)).toEqual({
      revision: 2,
      processNumber: '074/26',
      year: 2026,
      seq: 74,
      problem: null,
    });
  });

  it('sem numero: com e sem prefixo de revisao', () => {
    expect(parseDealTitle('R2 - INDENT CLIENTE EXEMPLO', NOW)).toEqual({
      revision: 2,
      processNumber: null,
      year: null,
      seq: null,
      problem: 'no_number',
    });
    expect(parseDealTitle('INDENT CLIENTE EXEMPLO', NOW)).toMatchObject({ revision: null, problem: 'no_number' });
    expect(parseDealTitle('', NOW)).toMatchObject({ problem: 'no_number' });
  });

  it('data dd/MM/aa e numeros colados nao casam', () => {
    expect(parseDealTitle('12/11/26 INDENT', NOW).problem).toBe('no_number');
    expect(parseDealTitle('INDENT 1/2/26', NOW).problem).toBe('no_number');
    expect(parseDealTitle('INDENT 12345/26', NOW).problem).toBe('no_number');
    expect(parseDealTitle('INDENT 274/260', NOW).problem).toBe('no_number');
  });

  it('dois numeros distintos -> multiple_numbers (o mesmo numero repetido nao)', () => {
    expect(parseDealTitle('274/26 e 275/26 INDENT', NOW)).toMatchObject({ processNumber: null, problem: 'multiple_numbers' });
    expect(parseDealTitle('R2 - 274/26 / 275/26', NOW).revision).toBe(2);
    expect(parseDealTitle('274/26 INDENT 274/26', NOW)).toMatchObject({ processNumber: '274/26', problem: null });
  });

  it('ano fora de (atual - 1) .. (atual + 1) -> year_out_of_range', () => {
    expect(parseDealTitle('270/19 INDENT', NOW).problem).toBe('year_out_of_range');
    expect(parseDealTitle('270/99 INDENT', NOW).problem).toBe('year_out_of_range');
    expect(parseDealTitle('270/24 INDENT', NOW).problem).toBe('year_out_of_range');
    expect(parseDealTitle('270/28 INDENT', NOW).problem).toBe('year_out_of_range');
    expect(parseDealTitle('270/25 INDENT', NOW).problem).toBeNull();
    expect(parseDealTitle('270/27 INDENT', NOW).problem).toBeNull();
  });

  it('o ano de referencia e o de Brasilia, nao o do UTC', () => {
    // 31/12/2026 22:00 BRT = 01/01/2027 01:00 UTC: ainda e 2026 no Brasil.
    const lateNewYearsEve = new Date('2027-01-01T01:00:00Z');
    expect(parseDealTitle('270/28 INDENT', lateNewYearsEve).problem).toBe('year_out_of_range');
    const earlyNewYear = new Date('2027-01-01T04:00:00Z');
    expect(parseDealTitle('270/28 INDENT', earlyNewYear).problem).toBeNull();
  });

  it('sequencia zero e numero invalido', () => {
    expect(parseDealTitle('000/26 INDENT', NOW).problem).toBe('invalid_number');
    expect(parseDealTitle('0/26 INDENT', NOW).problem).toBe('invalid_number');
  });

  it('R0 nao e revisao; o prefixo so vale no inicio do titulo', () => {
    expect(parseDealTitle('R0 - 274/26', NOW)).toMatchObject({ revision: null, processNumber: '274/26' });
    expect(parseDealTitle('274/26 INDENT R2', NOW)).toMatchObject({ revision: null, processNumber: '274/26' });
  });

  it('entrada nao-texto nao quebra', () => {
    expect(parseDealTitle(undefined as unknown as string, NOW).problem).toBe('no_number');
    expect(parseDealTitle(null as unknown as string, NOW).problem).toBe('no_number');
  });
});
