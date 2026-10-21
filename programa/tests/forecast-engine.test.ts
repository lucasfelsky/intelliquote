import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROJECAO_5O_MES_SOMA_CHEGADA,
  calcular,
  conferir,
} from '../src/utils/forecastEngine';
import { somarDias } from '../src/utils/forecastMonths';
import type { Quinzena } from '../src/utils/forecastTypes';

// Fixture ANONIMIZADA (repo publico): scripts/forecast-anonymize-fixture.mjs.
const q = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const HOJE = '2026-10-20';
const linhas = calcular(q, { hoje: HOJE });
const linhaDe = (n: number) => linhas.find((l) => l.linha === n)!;

describe('motor do Forecast x planilha 10-2 corrigida (fixture anonimizada)', () => {
  it('bate com todas as celulas que o Excel calculou', () => {
    const r = conferir(q, linhas);
    expect(r.divergencias.slice(0, 5)).toEqual([]);
    expect(r.batem).toBe(r.celulas);
    expect(r.celulas).toBe(9464);
    expect(r.batem).toBe(9464);
  });

  it('linha 3: projecao e demanda conferidas a mao', () => {
    const l = linhaDe(3);
    expect(l.Q).toBeCloseTo(1468.33, 2); // (1.000 + 1.630 + 1.775) / 3
    expect(l.T).toBeCloseTo(4453.94, 2); // 1.468,33 / 30 x 91
    expect(l.chegadas).toEqual([3200, 2400, 0, 2400, 0]);
    expect(l.projecao[0]).toBeCloseTo(931.67, 2); // 0 + 3.200 - 800 - 1.468,33
    expect(l.AN).toBeCloseTo(477.72, 2); // 8.000 - 4.453,94 - 1.468,33 - 1.600
    expect(l.AP).toBe('2027-01-19'); // 20/10/2026 + 91 dias
  });

  it('lead time desconhecido deixa AQ, T, AN e AP sem valor', () => {
    const semFonte: Quinzena = {
      ...q,
      produtos: q.produtos.slice(0, 1).map((p) => ({ ...p, fonte: 'FONTE INEXISTENTE' })),
    };
    const [l] = calcular(semFonte, { hoje: HOJE });
    expect(l.AQ).toBeNull();
    expect(l.T).toBeNull();
    expect(l.AN).toBeNull();
    expect(l.AP).toBeNull();
  });

  it('comparacao de codigo e de fonte ignora maiusculas/minusculas', () => {
    const p = q.produtos.find((x) => x.linha === 3)!;
    const minusculo: Quinzena = {
      ...q,
      produtos: [
        { ...p, codigos: p.codigos.map((c) => c.toLowerCase()), fonte: p.fonte.toLowerCase() },
      ],
    };
    const [l] = calcular(minusculo, { hoje: HOJE });
    expect(l).toEqual(linhaDe(3));
  });

  it('quinzena 1: AG e a media trimestral (Q), mesmo com P > Q', () => {
    const l = linhas.find((x) => x.P > x.Q)!;
    expect(l).toBeDefined();
    expect(l.AG).toBe(l.P); // quinzena 2 (default): maior entre Q e P

    const q1 = calcular(q, { hoje: HOJE, quinzena: 1 });
    const l1 = q1.find((x) => x.linha === l.linha)!;
    expect(l1.AG).toBe(l1.Q);
    expect(l1.projecao[0]).toBeCloseTo(l.projecao[0] + (l.P - l.Q), 6);
  });

  it('quinzena 2 explicita equivale ao default (planilha)', () => {
    expect(calcular(q, { hoje: HOJE, quinzena: 2 })).toEqual(linhas);
  });

  it('PROJECAO_5O_MES_SOMA_CHEGADA = false replica a planilha; true soma chegadas[4] em AL', () => {
    expect(PROJECAO_5O_MES_SOMA_CHEGADA).toBe(false);
    expect(calcular(q, { hoje: HOJE, somarChegada5oMes: false })).toEqual(linhas);

    const com = calcular(q, { hoje: HOJE, somarChegada5oMes: true });
    expect(linhas.filter((l) => l.chegadas[4] !== 0).length).toBeGreaterThan(0);
    for (const l of linhas) {
      const c = com.find((x) => x.linha === l.linha)!;
      expect(c.projecao[4]).toBeCloseTo(l.projecao[4] + l.chegadas[4], 6); // AL
      expect(c.projecao[5]).toBeCloseTo(l.projecao[5] + l.chegadas[4], 6); // AM = AL - Q
      expect(c.projecao.slice(0, 4)).toEqual(l.projecao.slice(0, 4));
    }
    // Com a opcao ligada a conferencia com a planilha diverge so em AL/AM.
    const { porColuna } = conferir(q, com);
    const divergentes = Object.keys(porColuna).filter(
      (col) => porColuna[col].batem !== porColuna[col].celulas,
    );
    expect(divergentes.sort()).toEqual(['AL', 'AM']);
  });

  it('rejeita data de hoje invalida', () => {
    expect(() => calcular(q, { hoje: '2026-13-01' })).toThrow(/Data invalida/);
    expect(() => calcular(q, { hoje: '20/10/2026' })).toThrow(/Data invalida/);
  });
});

describe('somarDias (date key, aritmetica UTC)', () => {
  it('atravessa o fim de mes', () => {
    expect(somarDias('2026-02-27', 2)).toBe('2026-03-01');
  });

  it('atravessa a virada de ano e ano bissexto', () => {
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2027-01-01', -1)).toBe('2026-12-31');
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(somarDias('2026-10-20', 91)).toBe('2027-01-19');
  });

  it('rejeita date key invalida', () => {
    expect(() => somarDias('2027-02-29', 1)).toThrow(/Data invalida/);
  });
});
