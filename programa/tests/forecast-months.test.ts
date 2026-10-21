import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  anoMesDoRotulo,
  mesesHistorico,
  rotuloDoYearMonth,
  rotulosDaQuinzena,
  somarDias,
  yearMonthsDaJanela,
} from '../src/utils/forecastMonths';
import type { Quinzena } from '../src/utils/forecastTypes';

const q = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

describe('rotulosDaQuinzena', () => {
  it('2026-10-15 reproduz os rotulos da fixture (mesesConsumo/Chegada/Programacao)', () => {
    const r = rotulosDaQuinzena('2026-10-15');
    expect(r.consumo).toEqual(q.mesesConsumo);
    expect(r.chegada).toEqual(q.mesesChegada);
    expect(r.programacao).toEqual(q.mesesProgramacao);
  });

  it('atravessa a virada de ano', () => {
    const r = rotulosDaQuinzena('2027-01-04');
    expect(r.consumo).toEqual(['07', '08', '09', '10', '11', '12', '01 (ATUAL)']);
    expect(r.chegada).toEqual(['01', '02', '03', '04', '05']);
    expect(r.programacao).toEqual(['01', '02', '03', '04']);
  });
});

describe('anoMesDoRotulo', () => {
  it('devolve o mes mais recente <= mes base com aquele MM', () => {
    expect(anoMesDoRotulo('09', '2026-10-15')).toBe('2026-09');
    expect(anoMesDoRotulo('10', '2026-10-15')).toBe('2026-10');
    expect(anoMesDoRotulo('12', '2027-01-04')).toBe('2026-12');
    expect(anoMesDoRotulo('01', '2027-01-04')).toBe('2027-01');
  });

  it('rejeita rotulo invalido', () => {
    expect(() => anoMesDoRotulo('13', '2026-10-15')).toThrow(/Rotulo de mes invalido/);
    expect(() => anoMesDoRotulo('xx', '2026-10-15')).toThrow(/Rotulo de mes invalido/);
  });
});

describe('mesesHistorico', () => {
  it('J..N = base-6..base-2 e O = base-1', () => {
    expect(mesesHistorico('2026-10-15')).toEqual({
      historico: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
      anterior: '2026-09',
    });
  });

  it('atravessa a virada de ano', () => {
    expect(mesesHistorico('2027-02-01')).toEqual({
      historico: ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'],
      anterior: '2027-01',
    });
  });
});

describe('yearMonthsDaJanela / rotuloDoYearMonth', () => {
  it('janela de 4 meses atravessa a virada de ano e bate com os rotulos da quinzena', () => {
    const janela = yearMonthsDaJanela('2026-11-15', 4);
    expect(janela).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(janela.map(rotuloDoYearMonth)).toEqual(rotulosDaQuinzena('2026-11-15').programacao);
  });

  it('janela de 5 meses bate com os rotulos de chegada', () => {
    const janela = yearMonthsDaJanela('2026-10-15', 5);
    expect(janela).toEqual(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02']);
    expect(janela.map(rotuloDoYearMonth)).toEqual(rotulosDaQuinzena('2026-10-15').chegada);
  });

  it('rotuloDoYearMonth devolve o MM e rejeita formato invalido', () => {
    expect(rotuloDoYearMonth('2027-01')).toBe('01');
    expect(() => rotuloDoYearMonth('2027-1')).toThrow(/Ano-mes invalido/);
  });
});

describe('somarDias', () => {
  it('soma e subtrai dias sem depender do fuso', () => {
    expect(somarDias('2026-02-27', 2)).toBe('2026-03-01');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
  });
});
