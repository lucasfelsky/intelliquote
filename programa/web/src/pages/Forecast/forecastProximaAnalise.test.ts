import { describe, expect, it } from 'vitest';
import {
  ANOS_COBERTOS,
  ehDiaUtil,
  FERIADOS_NACIONAIS,
  hojeEmSaoPaulo,
  proximaAnalise,
  segundoDiaUtil,
} from './forecastProximaAnalise';

describe('FERIADOS_NACIONAIS', () => {
  it('cobre exatamente 2026 e 2027', () => {
    expect([...ANOS_COBERTOS].sort()).toEqual([2026, 2027]);
  });

  it('2026: os 13 feriados esperados (igualdade de conjunto)', () => {
    expect([...(FERIADOS_NACIONAIS[2026] ?? [])].sort()).toEqual(
      [
        '2026-01-01',
        '2026-02-16',
        '2026-02-17',
        '2026-04-03',
        '2026-04-21',
        '2026-05-01',
        '2026-06-04',
        '2026-09-07',
        '2026-10-12',
        '2026-11-02',
        '2026-11-15',
        '2026-11-20',
        '2026-12-25',
      ].sort(),
    );
  });

  it('2027: os 13 feriados esperados (igualdade de conjunto)', () => {
    expect([...(FERIADOS_NACIONAIS[2027] ?? [])].sort()).toEqual(
      [
        '2027-01-01',
        '2027-02-08',
        '2027-02-09',
        '2027-03-26',
        '2027-04-21',
        '2027-05-01',
        '2027-05-27',
        '2027-09-07',
        '2027-10-12',
        '2027-11-02',
        '2027-11-15',
        '2027-11-20',
        '2027-12-25',
      ].sort(),
    );
  });
});

describe('ehDiaUtil', () => {
  it('segunda a sexta fora de feriado e util', () => {
    expect(ehDiaUtil('2026-10-27')).toBe(true);
    expect(ehDiaUtil('2026-02-18')).toBe(true); // quarta de cinzas: ponto facultativo conta como util
  });

  it('fim de semana e feriado nao sao uteis', () => {
    expect(ehDiaUtil('2026-10-24')).toBe(false); // sabado
    expect(ehDiaUtil('2026-10-25')).toBe(false); // domingo
    expect(ehDiaUtil('2026-11-02')).toBe(false); // Finados (segunda)
    expect(ehDiaUtil('2026-02-17')).toBe(false); // Carnaval (terca)
  });

  it('ano fora da tabela e data invalida devolvem null', () => {
    expect(ehDiaUtil('2028-01-10')).toBeNull();
    expect(ehDiaUtil('2025-12-20')).toBeNull();
    expect(ehDiaUtil('2026-02-30')).toBeNull();
    expect(ehDiaUtil('abc')).toBeNull();
  });
});

// Valores gerados e conferidos: [ano, mes, 2o dia util a partir do dia 1, 2o dia util a partir do dia 16].
const CANDIDATAS: Array<[number, number, string, string]> = [
  [2026, 1, '2026-01-05', '2026-01-19'],
  [2026, 2, '2026-02-03', '2026-02-19'],
  [2026, 3, '2026-03-03', '2026-03-17'],
  [2026, 4, '2026-04-02', '2026-04-17'],
  [2026, 5, '2026-05-05', '2026-05-19'],
  [2026, 6, '2026-06-02', '2026-06-17'],
  [2026, 7, '2026-07-02', '2026-07-17'],
  [2026, 8, '2026-08-04', '2026-08-18'],
  [2026, 9, '2026-09-02', '2026-09-17'],
  [2026, 10, '2026-10-02', '2026-10-19'],
  [2026, 11, '2026-11-04', '2026-11-17'],
  [2026, 12, '2026-12-02', '2026-12-17'],
  [2027, 1, '2027-01-05', '2027-01-19'],
  [2027, 2, '2027-02-02', '2027-02-17'],
  [2027, 3, '2027-03-02', '2027-03-17'],
  [2027, 4, '2027-04-02', '2027-04-19'],
  [2027, 5, '2027-05-04', '2027-05-18'],
  [2027, 6, '2027-06-02', '2027-06-17'],
  [2027, 7, '2027-07-02', '2027-07-19'],
  [2027, 8, '2027-08-03', '2027-08-17'],
  [2027, 9, '2027-09-02', '2027-09-17'],
  [2027, 10, '2027-10-04', '2027-10-19'],
  [2027, 11, '2027-11-03', '2027-11-17'],
  [2027, 12, '2027-12-02', '2027-12-17'],
];

describe('segundoDiaUtil', () => {
  it.each(CANDIDATAS.flatMap(([ano, mes, primeira, segunda]) => [[ano, mes, 1, primeira], [ano, mes, 16, segunda]] as Array<[number, number, number, string]>))(
    '%i-%i: 2o dia util a partir do dia %i = %s',
    (ano, mes, aPartirDoDia, esperado) => {
      expect(segundoDiaUtil(ano, mes, aPartirDoDia)).toBe(esperado);
    },
  );

  it('fora da tabela ou entrada invalida = null', () => {
    expect(segundoDiaUtil(2028, 1, 1)).toBeNull();
    expect(segundoDiaUtil(2026, 13, 1)).toBeNull();
    expect(segundoDiaUtil(2026, 0, 1)).toBeNull();
    expect(segundoDiaUtil(2026, 10, 0)).toBeNull();
  });
});

describe('proximaAnalise', () => {
  it('valor do mock-up: 27/10/2026 -> 04/11/2026 (Finados no caminho do 2o dia util)', () => {
    expect(proximaAnalise('2026-10-27')).toBe('2026-11-04');
  });

  it('hoje conta: no proprio dia da analise devolve hoje', () => {
    expect(proximaAnalise('2026-11-04')).toBe('2026-11-04');
    expect(proximaAnalise('2026-11-05')).toBe('2026-11-17');
  });

  it('"apos o dia 15" comeca no dia 16 (contar do 15 daria 16/10)', () => {
    expect(proximaAnalise('2026-10-03')).toBe('2026-10-19');
  });

  it('dia 15 em fim de semana ou feriado', () => {
    expect(proximaAnalise('2026-08-05')).toBe('2026-08-18'); // 15/08 sabado
    expect(proximaAnalise('2026-11-05')).toBe('2026-11-17'); // 15/11 domingo e feriado
  });

  it('Carnaval: 16 e 17/02 sao feriados; quarta de cinzas conta como util', () => {
    expect(proximaAnalise('2026-02-04')).toBe('2026-02-19');
  });

  it('virada de ano: 01/01 e feriado', () => {
    expect(proximaAnalise('2026-12-18')).toBe('2027-01-05');
    expect(proximaAnalise('2026-12-31')).toBe('2027-01-05');
  });

  it('fim da tabela: ate 17/12/2027 calcula, depois devolve null', () => {
    expect(proximaAnalise('2027-12-17')).toBe('2027-12-17');
    expect(proximaAnalise('2027-12-18')).toBeNull();
    expect(proximaAnalise('2028-01-10')).toBeNull();
    expect(proximaAnalise('2025-12-20')).toBeNull();
  });

  it('entrada invalida = null', () => {
    expect(proximaAnalise('')).toBeNull();
    expect(proximaAnalise('2026-13-01')).toBeNull();
    expect(proximaAnalise('abc')).toBeNull();
  });
});

describe('hojeEmSaoPaulo', () => {
  it('usa o fuso de Sao Paulo (UTC-3), nao o UTC', () => {
    expect(hojeEmSaoPaulo(new Date('2026-11-04T02:59:59Z'))).toBe('2026-11-03');
    expect(hojeEmSaoPaulo(new Date('2026-11-04T03:00:00Z'))).toBe('2026-11-04');
    expect(hojeEmSaoPaulo(new Date('2027-01-01T02:30:00Z'))).toBe('2026-12-31');
  });
});
