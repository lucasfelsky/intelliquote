import { describe, expect, it } from 'vitest';
import { criteriosFalhos } from '../src/utils/forecastPreditivoBacktest';
import type { MedidasPromocao } from '../src/utils/forecastPreditivoBacktest';
import { calcularLinhaP1, criteriosFalhosP1, falhaCriterio7, passaCriterio3 } from '../src/utils/forecastPreditivoLinhasP1';
import type { ContextoLinha, ObsP1, ParLinha } from '../src/utils/forecastPreditivoLinhasP1';
import { chavesSegmentoP1, classeLeadTime, leadTimeTruncado, ordenarSegmentosP1, rotuloFonteDaSerie, rotuloSegmento, rotulosFonte } from '../src/utils/forecastPreditivoSegmentosP1';
import { somarMeses } from '../src/utils/forecastPreditivoSerie';
import type { SerieNormalizada } from '../src/utils/forecastPreditivoTipos';

describe('passaCriterio3 (teto parametrizavel)', () => {
  it('teto 0,10 com viesRef 0,5: 0,1 passa; 0,101 e -0,101 falham', () => {
    expect(passaCriterio3(0.1, 0.5, 0.1)).toBe(true);
    expect(passaCriterio3(0.101, 0.5, 0.1)).toBe(false);
    expect(passaCriterio3(-0.1, 0.5, 0.1)).toBe(true);
    expect(passaCriterio3(-0.101, 0.5, 0.1)).toBe(false);
  });
  it('sem teto com viesRef 0,49: 0,51 passa e 0,511 falha (folga de 2 p.p.)', () => {
    expect(passaCriterio3(0.51, 0.49, null)).toBe(true);
    expect(passaCriterio3(0.511, 0.49, null)).toBe(false);
    expect(passaCriterio3(-0.51, 0.49, null)).toBe(true);
    expect(passaCriterio3(-0.511, -0.49, null)).toBe(false);
  });
  it('teto 0 so aceita vies exatamente 0; viesRef null vale 0; viesLT null falha', () => {
    expect(passaCriterio3(0, 0.5, 0)).toBe(true);
    expect(passaCriterio3(0.001, 0.5, 0)).toBe(false);
    expect(passaCriterio3(0.02, null, null)).toBe(true);
    expect(passaCriterio3(0.0201, null, null)).toBe(false);
    expect(passaCriterio3(null, 0.5, null)).toBe(false);
    expect(passaCriterio3(null, 0.5, 0.1)).toBe(false);
  });
  it('o teto vale tambem acima da folga: teto 0,05 com viesRef 0,5', () => {
    expect(passaCriterio3(0.05, 0.5, 0.05)).toBe(true);
    expect(passaCriterio3(0.0501, 0.5, 0.05)).toBe(false);
    expect(passaCriterio3(0.0501, 0.5, 0.1)).toBe(true);
  });
});

describe('criteriosFalhosP1 == criteriosFalhos da fase 0 com teto 0,10', () => {
  it('grade de MedidasPromocao (inclui as fronteiras)', () => {
    let casos = 0;
    for (const origens of [5, 6]) {
      for (const n of [29, 30]) {
        for (const wapeLT of [null, 0.89, 0.9, 0.91]) {
          for (const viesLT of [null, 0, 0.02, 0.1, 0.101, -0.1, -0.101, 0.12]) {
            for (const viesRef of [null, 0, 0.1, -0.1, 0.5]) {
              for (const custoRel of [null, 0.95, 0.951]) {
                for (const vitoria of [null, 0.549, 0.55]) {
                  const m: MedidasPromocao = { origens, n, wapeLT, wapeRef: wapeLT === null ? null : 1, viesLT, viesRef, custoRel, vitoria };
                  expect(criteriosFalhosP1(m, 0.1)).toEqual(criteriosFalhos(m));
                  casos++;
                }
              }
            }
          }
        }
      }
    }
    expect(casos).toBe(2 * 2 * 4 * 8 * 5 * 3 * 3);
  });
  it('sem teto: so o criterio 3 muda, e fica ordenado', () => {
    const m: MedidasPromocao = { origens: 6, n: 30, wapeLT: 0.5, wapeRef: 1, viesLT: 0.15, viesRef: 0.2, custoRel: 0.5, vitoria: 0.9 };
    expect(criteriosFalhosP1(m, 0.1)).toEqual([3]);
    expect(criteriosFalhosP1(m, null)).toEqual([]);
    expect(criteriosFalhosP1({ ...m, n: 10, custoRel: 2 }, 0.1)).toEqual([1, 3, 4]);
  });
});

describe('falhaCriterio7', () => {
  it('cobertura 0,72 e 0,88 passam; 0,7199 e 0,8801 falham', () => {
    expect(falhaCriterio7(0.72, 30)).toBe(false);
    expect(falhaCriterio7(0.88, 30)).toBe(false);
    expect(falhaCriterio7(0.7199, 30)).toBe(true);
    expect(falhaCriterio7(0.8801, 30)).toBe(true);
  });
  it('nIntervalo 29 falha, 30 passa; cobertura null falha', () => {
    expect(falhaCriterio7(0.8, 29)).toBe(true);
    expect(falhaCriterio7(0.8, 30)).toBe(false);
    expect(falhaCriterio7(null, 100)).toBe(true);
  });
});

// ---- calcularLinhaP1 com pares fabricados: 5 series x 12 meses (2025-01..2025-12), real 100; metade 1 = ate 2025-06 ----
const MESES = Array.from({ length: 12 }, (_, k) => somarMeses('2025-01', k));
const SERIES = ['S1', 'S2', 'S3', 'S4', 'S5'];
const pares: ParLinha[] = SERIES.flatMap((id) => MESES.map((origem) => ({ serieId: id, origem, abc: 'B' as const })));
const ctx = (extra: Partial<ContextoLinha> = {}): ContextoLinha => ({ pares, razaoFaltaExcesso: 3, tetoVies: 0.1, ultimoMes1: '2025-06', ...extra });
const indices = pares.map((_, p) => p);

type Fator = (p: number) => number;
function obsPares(fator: Fator, intervalo: (p: number) => { p10: number; p90: number } | null = () => ({ p10: 90, p90: 110 })): ObsP1[] {
  return pares.map((par, p) => {
    const iv = intervalo(p);
    return {
      obs: { lt: { serieId: par.serieId, origem: par.origem, h: 3, real: 100, previsto: 100 * fator(p) }, h1: { serieId: par.serieId, origem: par.origem, h: 1, real: 100, previsto: 100 * fator(p) } },
      fallback: p === 0,
      intervalo: iv === null ? null : { p10: iv.p10, p90: iv.p90, fonte: p < 10 ? 'total' : 'celula' },
    };
  });
}
const metade2 = (p: number) => MESES.indexOf(pares[p].origem) >= 6;
const ref = obsPares(() => 1.3, () => null);
const linha = (meu: ObsP1[], c: ContextoLinha = ctx(), metodo: 'ses' | 'planilha-q' = 'ses') => calcularLinhaP1('TOTAL', metodo, indices, meu, metodo === 'planilha-q' ? meu : ref, c);
const cobertura83 = (p: number) => (p % 6 === 0 ? { p10: 80, p90: 95 } : { p10: 90, p90: 110 }); // 50/60 cobertos

describe('calcularLinhaP1: valores a mao', () => {
  const l = linha(obsPares(() => 1.05, cobertura83));
  it('metricas da amostra comum', () => {
    expect(l.n).toBe(60);
    expect(l.origens).toBe(12);
    expect(l.nFallback).toBe(1);
    expect(l.wapeLT).toBeCloseTo(0.05, 9);
    expect(l.wapeRef).toBeCloseTo(0.3, 9);
    expect(l.wapeRel).toBeCloseTo(0.05 / 0.3, 9);
    expect(l.viesLT).toBeCloseTo(0.05, 9);
    expect(l.viesRef).toBeCloseTo(0.3, 9);
    expect(l.faltaLT).toBe(0);
    expect(l.excessoLT).toBeCloseTo(300, 9);
    expect(l.custoLT).toBeCloseTo(300, 9);
    expect(l.custoRel).toBeCloseTo(300 / 1800, 9);
    expect(l.vitoria).toBe(1);
    expect(l.wapeH1).toBeCloseTo(0.05, 9);
    expect(l.maeLT).toBeCloseTo(5, 9);
  });
  it('cobertura, pares com intervalo e pool TOTAL', () => {
    expect(l.nIntervalo).toBe(60);
    expect(l.cobertura).toBeCloseTo(50 / 60, 9);
    expect(l.nPoolTotal).toBe(10);
  });
  it('tudo limpo nas duas metades: candidato e sem criterio 7 nem 8', () => {
    expect(l.criteriosFalhos).toEqual([]);
    expect(l.promovivel).toBe('candidato');
    expect(l.criteriosFalhosSemTeto).toEqual([]);
    expect(l.promovivelSemTeto).toBe('candidato');
    expect(l.metade1).toMatchObject({ n: 30, origens: 6, criteriosFalhos: [] });
    expect(l.metade2).toMatchObject({ n: 30, origens: 6, criteriosFalhos: [] });
  });
  it('pinball: p10 90 / p90 110 para real 100 -> 0,01 cada', () => {
    const t = linha(obsPares(() => 1.05, () => ({ p10: 90, p90: 110 })));
    expect(t.cobertura).toBe(1);
    expect(t.pinball10).toBeCloseTo(0.01, 12);
    expect(t.pinball90).toBeCloseTo(0.01, 12);
  });
  it('planilha-q e a referencia: criterios [], vitoria null, sem itens piores', () => {
    const q = linha(ref, ctx(), 'planilha-q');
    expect(q).toMatchObject({ promovivel: 'referencia', promovivelSemTeto: 'referencia', criteriosFalhos: [], criteriosFalhosSemTeto: [], vitoria: null, itensAPiores: [] });
    expect(q.metade1.criteriosFalhos).toEqual([]);
  });
});

describe('criterio 7 na linha', () => {
  it('cobertura 1 (acima de 0,88) -> 7; sem intervalos -> 7; 29 pares com intervalo -> 7', () => {
    expect(linha(obsPares(() => 1.05, () => ({ p10: 90, p90: 110 }))).criteriosFalhos).toEqual([7]);
    expect(linha(obsPares(() => 1.05, () => null)).criteriosFalhos).toEqual([7]);
    expect(linha(obsPares(() => 1.05, () => null)).cobertura).toBeNull();
    expect(linha(obsPares(() => 1.05, () => null)).pinball10).toBeNull();
    const so29 = linha(obsPares(() => 1.05, (p) => (p < 29 ? cobertura83(p + 1) : null)));
    expect(so29.nIntervalo).toBe(29);
    expect(so29.criteriosFalhos).toContain(7);
  });
  it('30 pares com intervalo e cobertura 0,8 passam', () => {
    // 30 pares com intervalo, 24 cobertos (0,8)
    const l = linha(obsPares(() => 1.05, (p) => (p < 30 ? (p % 5 === 0 ? { p10: 80, p90: 95 } : { p10: 90, p90: 110 }) : null)));
    expect(l.nIntervalo).toBe(30);
    expect(l.cobertura).toBeCloseTo(0.8, 12);
    expect(l.criteriosFalhos).toEqual([]);
  });
});

describe('criterio 8 (estabilidade nas duas metades)', () => {
  it('metade 1 limpa + metade 2 com falha -> 8 presente', () => {
    const l = linha(obsPares((p) => (metade2(p) ? 1.6 : 1.05), cobertura83));
    expect(l.metade1.criteriosFalhos).toEqual([]);
    expect(l.metade2.criteriosFalhos).toEqual([2, 3, 4, 5]);
    expect(l.criteriosFalhos).toContain(8);
    expect(l.promovivel).toBe('nao');
  });
  it('metade 1 com falha + metade 2 limpa -> 8 presente', () => {
    const l = linha(obsPares((p) => (metade2(p) ? 1.05 : 1.6), cobertura83));
    expect(l.metade1.criteriosFalhos).toEqual([2, 3, 4, 5]);
    expect(l.metade2.criteriosFalhos).toEqual([]);
    expect(l.criteriosFalhos).toContain(8);
  });
  it('ambas limpas -> 8 ausente', () => {
    expect(linha(obsPares(() => 1.05, cobertura83)).criteriosFalhos).not.toContain(8);
  });
  it('metade 1 vazia (ultimoMes1 null): criterio 1 falha na metade 1 e 8 aparece', () => {
    const l = linha(obsPares(() => 1.05, cobertura83), ctx({ ultimoMes1: null }));
    expect(l.metade1).toMatchObject({ n: 0, origens: 0 });
    expect(l.metade1.criteriosFalhos).toContain(1);
    expect(l.metade2.n).toBe(60);
    expect(l.criteriosFalhos).toContain(8);
  });
  it('variantes do teto: vies 0,15 x ref 0,2 falha 3 e 8 com teto 0,10, e limpo sem teto', () => {
    const refAlta = obsPares(() => 1.2, () => null);
    const l = calcularLinhaP1('TOTAL', 'ses', indices, obsPares(() => 1.15, cobertura83), refAlta, ctx());
    expect(l.metade1.criteriosFalhos).toEqual([3]);
    expect(l.metade1.criteriosFalhosSemTeto).toEqual([]);
    expect(l.criteriosFalhos).toEqual([3, 8]);
    expect(l.promovivel).toBe('nao');
    expect(l.criteriosFalhosSemTeto).toEqual([]);
    expect(l.promovivelSemTeto).toBe('candidato');
  });
  it('o teto do contexto chega a linha: teto 0,20 deixa a variante com teto limpa; teto 0 reprova ate vies 0,05', () => {
    const refAlta = obsPares(() => 1.2, () => null);
    const meu = obsPares(() => 1.15, cobertura83);
    expect(calcularLinhaP1('TOTAL', 'ses', indices, meu, refAlta, ctx({ tetoVies: 0.2 })).criteriosFalhos).toEqual([]);
    expect(calcularLinhaP1('TOTAL', 'ses', indices, meu, refAlta, ctx({ tetoVies: null })).criteriosFalhos).toEqual([]);
    expect(calcularLinhaP1('TOTAL', 'ses', indices, meu, refAlta, ctx({ tetoVies: 0.149 })).criteriosFalhos).toEqual([3, 8]);
    expect(calcularLinhaP1('TOTAL', 'ses', indices, obsPares(() => 1.05, cobertura83), ref, ctx({ tetoVies: 0 })).criteriosFalhos).toEqual([3, 8]);
  });
});

describe('classeLeadTime e leadTimeTruncado: fronteiras', () => {
  it('60 -> <=60; 61 e 90 -> 61-90; 91 -> >90; null -> padrao', () => {
    expect(classeLeadTime(0)).toBe('<=60');
    expect(classeLeadTime(60)).toBe('<=60');
    expect(classeLeadTime(61)).toBe('61-90');
    expect(classeLeadTime(90)).toBe('61-90');
    expect(classeLeadTime(91)).toBe('>90');
    expect(classeLeadTime(3650)).toBe('>90');
    expect(classeLeadTime(null)).toBe('padrao');
  });
  it('horizonte 6: LT 150 nao, 151 sim; horizonte 12: 330 nao, 331 sim; LT 0 nao', () => {
    expect(leadTimeTruncado(150, 6)).toBe(false);
    expect(leadTimeTruncado(151, 6)).toBe(true);
    expect(leadTimeTruncado(330, 12)).toBe(false);
    expect(leadTimeTruncado(331, 12)).toBe(true);
    expect(leadTimeTruncado(0, 6)).toBe(false);
    expect(leadTimeTruncado(0, 2)).toBe(false);
    expect(leadTimeTruncado(0, 1)).toBe(true);
  });
});

const comFonte = (id: string, fonte: string | null, volume: number): SerieNormalizada => ({
  id,
  inicio: '2025-01',
  valores: [volume],
  mascara: [false],
  meta: { fonte, familia: null, leadTimeDias: null },
  avisos: [],
});

describe('rotulosFonte', () => {
  it('12 fontes -> fonte-01..fonte-10 + outras; empate decidido pelo nome; soma por fonte', () => {
    const series = Array.from({ length: 12 }, (_, i) => comFonte('s' + i, 'F' + String(i + 1).padStart(2, '0'), 100 - i));
    const m = rotulosFonte(series);
    expect(m.get('F01')).toBe('fonte-01');
    expect(m.get('F10')).toBe('fonte-10');
    expect(m.get('F11')).toBe('outras');
    expect(m.get('F12')).toBe('outras');
    expect([...new Set(m.values())].sort()).toEqual(['fonte-01', 'fonte-02', 'fonte-03', 'fonte-04', 'fonte-05', 'fonte-06', 'fonte-07', 'fonte-08', 'fonte-09', 'fonte-10', 'outras']);
    const empate = rotulosFonte([comFonte('a', 'Z', 50), comFonte('b', 'A', 50), comFonte('c', 'M', 70)]);
    expect([empate.get('M'), empate.get('A'), empate.get('Z')]).toEqual(['fonte-01', 'fonte-02', 'fonte-03']);
    const somadas = rotulosFonte([comFonte('a', 'X', 40), comFonte('b', 'X', 40), comFonte('c', 'Y', 70)]);
    expect(somadas.get('X')).toBe('fonte-01'); // 80 > 70
  });
  it('exatamente 10 fontes -> sem outras; top e parametro; serie sem fonte -> sem-fonte', () => {
    const dez = Array.from({ length: 10 }, (_, i) => comFonte('s' + i, 'F' + i, 10 + i));
    expect(new Set(rotulosFonte(dez).values()).has('outras')).toBe(false);
    expect(new Set(rotulosFonte(dez, 3).values()).size).toBe(4);
    const mapa = rotulosFonte([comFonte('a', 'F', 1), comFonte('b', null, 99)]);
    expect(mapa.size).toBe(1);
    expect(rotuloFonteDaSerie(comFonte('b', null, 99), mapa)).toBe('sem-fonte');
    expect(rotuloFonteDaSerie(comFonte('a', 'F', 1), mapa)).toBe('fonte-01');
  });
});

describe('chaves, ordem e rotulo dos segmentos P1', () => {
  it('chavesSegmentoP1 na ordem dos eixos', () => {
    expect(chavesSegmentoP1({ abc: 'A', xyz: 'X', sbc: 'smooth' }, '61-90', 'fonte-02', 'degrau')).toEqual([
      'TOTAL', 'ABC:A', 'SBC:smooth', 'XYZ:X', 'ABC/SBC:A/smooth', 'LT:61-90', 'FONTE:fonte-02', 'REGRA:degrau',
    ]);
  });
  it('ordenarSegmentosP1: eixos e valores na ordem declarada', () => {
    const embaralhado = [
      'REGRA:degrau', 'REGRA:padrao', 'FONTE:sem-fonte', 'FONTE:outras', 'FONTE:fonte-10', 'FONTE:fonte-02', 'LT:padrao', 'LT:>90', 'LT:<=60', 'LT:61-90',
      'ABC/SBC:B/lumpy', 'ABC/SBC:A/smooth', 'XYZ:n/a', 'XYZ:Z', 'XYZ:X', 'SBC:insuficiente', 'SBC:smooth', 'ABC:sem-venda', 'ABC:A', 'TOTAL', 'REGRA:curto', 'REGRA:dormente',
    ];
    expect(ordenarSegmentosP1(embaralhado)).toEqual([
      'TOTAL', 'ABC:A', 'ABC:sem-venda', 'SBC:smooth', 'SBC:insuficiente', 'XYZ:X', 'XYZ:Z', 'XYZ:n/a', 'ABC/SBC:A/smooth', 'ABC/SBC:B/lumpy',
      'LT:<=60', 'LT:61-90', 'LT:>90', 'LT:padrao', 'FONTE:fonte-02', 'FONTE:fonte-10', 'FONTE:outras', 'FONTE:sem-fonte',
      'REGRA:padrao', 'REGRA:dormente', 'REGRA:curto', 'REGRA:degrau',
    ]);
  });
  it('rotuloSegmento: dormente em ASCII; demais EIXO valor', () => {
    expect(rotuloSegmento('ABC:sem-venda')).toBe('ABC sem venda >=6 meses');
    expect(rotuloSegmento('ABC:A')).toBe('ABC A');
    expect(rotuloSegmento('ABC/SBC:A/smooth')).toBe('ABC/SBC A/smooth');
    expect(rotuloSegmento('LT:<=60')).toBe('LT <=60');
    expect(rotuloSegmento('TOTAL')).toBe('TOTAL');
    expect(rotuloSegmento('REGRA:dormente')).toBe('REGRA dormente');
    expect(/^[\x20-\x7e]*$/.test(rotuloSegmento('ABC:sem-venda'))).toBe(true);
  });
});
