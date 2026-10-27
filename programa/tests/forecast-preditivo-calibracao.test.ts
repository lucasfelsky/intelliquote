import { describe, expect, it } from 'vitest';
import { calibradorDaTabela, compatibilidadeTabela, fatorCorrecao, lerTabelaCalibracao } from '../src/utils/forecastPreditivoCalibracao';
import type { TabelaCalibracao } from '../src/utils/forecastPreditivoCalibracao';
import { PARAMETROS_CORRECAO_PADRAO, hashConfigRef, validarParametrosCorrecao } from '../src/utils/forecastPreditivoConfigRef';
import type { ParametrosCorrecao } from '../src/utils/forecastPreditivoConfigRef';
import { criarPoolsRef } from '../src/utils/forecastPreditivoPoolsRef';
import { somarMeses } from '../src/utils/forecastPreditivoSerie';
import { tabelaSintetica } from './helpers/forecastPreditivoSinteticasRef';

const P = PARAMETROS_CORRECAO_PADRAO; // k 300, [0,85; 1,25], minPares 30

describe('fatorCorrecao (a mao)', () => {
  it('razao 1,2 com n 300 (w = 0,5) -> 1,1', () => {
    const f = fatorCorrecao(1.2, 300, P);
    expect(f.fator).toBeCloseTo(1.1, 12);
    expect(f).toMatchObject({ aplicado: true, noLimite: false });
  });
  it('razao 1,6 -> bruto 1,3 -> 1,25 no limite; razao 0,6 -> bruto 0,8 -> 0,85 no limite', () => {
    expect(fatorCorrecao(1.6, 300, P)).toEqual({ fator: 1.25, aplicado: true, noLimite: true });
    expect(fatorCorrecao(0.6, 300, P)).toEqual({ fator: 0.85, aplicado: true, noLimite: true });
  });
  it('n 29 / 30 / 31 com minPares 30: abaixo nao aplica, no minimo e acima aplicam', () => {
    expect(fatorCorrecao(1.2, 29, P)).toEqual({ fator: 1, aplicado: false, noLimite: false });
    expect(fatorCorrecao(1.2, 30, P).aplicado).toBe(true);
    expect(fatorCorrecao(1.2, 31, P).aplicado).toBe(true);
  });
  it.each([[null], [Number.NaN], [Number.POSITIVE_INFINITY]])('razao %j nao finita -> fator 1 sem aplicar', (razao) => {
    expect(fatorCorrecao(razao, 300, P)).toEqual({ fator: 1, aplicado: false, noLimite: false });
  });
  it('limite superior: bruto = 1,25 exato nao e "no limite"; 1,2501 e', () => {
    expect(fatorCorrecao(1.5, 300, P)).toEqual({ fator: 1.25, aplicado: true, noLimite: false }); // 1 + 0,5 x 0,5
    expect(fatorCorrecao(1.5002, 300, P)).toEqual({ fator: 1.25, aplicado: true, noLimite: true });
  });
  it('limite inferior: bruto no fatorMin exato nao e "no limite"; abaixo e (fatorMin 0,75 e razao em dobro de 2)', () => {
    const p = { ...P, fatorMin: 0.75 };
    expect(fatorCorrecao(0.5, 300, p)).toEqual({ fator: 0.75, aplicado: true, noLimite: false }); // 1 - 0,5 x 0,5
    expect(fatorCorrecao(0.4998, 300, p)).toEqual({ fator: 0.75, aplicado: true, noLimite: true });
    expect(fatorCorrecao(0.7001, 300, P).noLimite).toBe(false); // bruto 0,85005 > 0,85
  });
  it('encolhimento: k minusculo (w ~ 1) segue a razao; k enorme (w ~ 0) fica perto de 1', () => {
    expect(fatorCorrecao(1.2, 300, { ...P, k: 1e-9 }).fator).toBeCloseTo(1.2, 9);
    expect(fatorCorrecao(1.2, 300, { ...P, k: 1e6 }).fator).toBeCloseTo(1 + (300 / (300 + 1e6)) * 0.2, 12);
  });
  it('os parametros chegam a conta (fatorMax 2 deixa passar 1,3)', () => {
    expect(fatorCorrecao(1.6, 300, { ...P, fatorMax: 2 })).toMatchObject({ aplicado: true, noLimite: false });
    expect(fatorCorrecao(1.6, 300, { ...P, fatorMax: 2 }).fator).toBeCloseTo(1.3, 12);
  });
});

describe('validarParametrosCorrecao: fronteiras', () => {
  const ok = (p: Partial<ParametrosCorrecao>) => validarParametrosCorrecao({ ...P, ...p }).length === 0;
  it('o padrao e valido', () => expect(validarParametrosCorrecao(P)).toEqual([]));
  it.each([[0, false], [1e-9, true], [1e6, true], [1e6 + 1, false], [Number.NaN, false], [Number.POSITIVE_INFINITY, false]])('k %j -> %j', (k, v) => expect(ok({ k })).toBe(v));
  it.each([[0, false], [0.0001, true], [1, true], [1.0001, false]])('fatorMin %j -> %j', (fatorMin, v) => expect(ok({ fatorMin })).toBe(v));
  it.each([[0.9999, false], [1, true], [3, true], [3.0001, false]])('fatorMax %j -> %j', (fatorMax, v) => expect(ok({ fatorMax })).toBe(v));
  it.each([[0, false], [1, true], [1.5, false], [-1, false]])('minPares %j -> %j', (minPares, v) => expect(ok({ minPares })).toBe(v));
});

describe('lerTabelaCalibracao', () => {
  const base = (): Record<string, unknown> => JSON.parse(JSON.stringify(tabelaSintetica()));
  const ler = (f: (t: any) => void) => {
    const t = base();
    f(t);
    return lerTabelaCalibracao(JSON.stringify(t));
  };

  it('valida e ida e volta (stringify -> ler) devolve a mesma tabela', () => {
    const t = tabelaSintetica();
    const r = lerTabelaCalibracao(JSON.stringify(t, null, 2));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tabela).toEqual(t);
  });
  it('razao null e historicoMaximo null sao validos; tabelas vazias tambem', () => {
    expect(ler((t) => (t.nivel.razao = null)).ok).toBe(true);
    expect(ler((t) => (t.parametros.historicoMaximo = null)).ok).toBe(true);
    expect(ler((t) => { t.mensal = []; t.leadTime = []; }).ok).toBe(true);
  });
  it.each<[string, (t: any) => void, string]>([
    ['formato', (t) => (t.formato = 'outro'), 'formato'],
    ['versao nao string', (t) => (t.versao = 7), 'versao'],
    ['hashConfig nao string', (t) => (t.hashConfig = null), 'hashConfig'],
    ['correcaoNivel nao boolean', (t) => (t.correcaoNivel = 'sim'), 'correcaoNivel'],
    ['parametros.horizonte 13', (t) => (t.parametros.horizonte = 13), 'parametros'],
    ['parametros.historicoMaximo 241', (t) => (t.parametros.historicoMaximo = 241), 'parametros'],
    ['ultimoMes invalido', (t) => (t.ultimoMes = '2026-13'), 'ultimoMes'],
    ['chave extra no topo', (t) => (t.serieId = 'X'), 'chaves'],
    ['chave extra na celula', (t) => (t.mensal[0].id = 'X'), 'mensal'],
    ['q10 > q90', (t) => (t.mensal[0].q10 = 2), 'mensal'],
    ['m 13', (t) => (t.leadTime[0].m = 13), 'leadTime'],
    ['m 0', (t) => (t.mensal[0].m = 0), 'mensal'],
    ['n negativo', (t) => (t.mensal[0].n = -1), 'mensal'],
    ['n fracionario', (t) => (t.mensal[0].n = 1.5), 'mensal'],
    ['celula desconhecida', (t) => (t.mensal[0].celula = 'zzz'), 'mensal'],
    ['celula duplicada', (t) => t.leadTime.push({ ...t.leadTime[0] }), 'leadTime'],
    ['q90 nulo (nao finito)', (t) => (t.mensal[0].q90 = null), 'mensal'],
    ['razao 0', (t) => (t.nivel.razao = 0), 'nivel'],
    ['razao negativa', (t) => (t.nivel.razao = -1), 'nivel'],
    ['nivel.n negativo', (t) => (t.nivel.n = -5), 'nivel'],
  ])('invalida: %s', (_nome, f, campo) => {
    const r = ler(f);
    expect(r).toEqual({ ok: false, erro: `calibracao invalida: ${campo}` });
  });
  it.each([['{'], ['[]'], ['null'], ['"x"'], ['']])('texto %j nao e tabela', (texto) => {
    expect(lerTabelaCalibracao(texto).ok).toBe(false);
  });
  it('o erro nao ecoa o valor invalido', () => {
    const r = ler((t) => (t.mensal[0].celula = 'VALOR-SECRETO-123'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).not.toContain('SECRETO');
    const j = lerTabelaCalibracao('{"valor":"SEGREDO-987"');
    if (!j.ok) expect(j.erro).not.toContain('SEGREDO');
  });
});

describe('compatibilidadeTabela', () => {
  it('compativel com o hashConfigRef e o mesmo modo de correcao', () => {
    expect(compatibilidadeTabela(tabelaSintetica(), false)).toBeNull();
    expect(compatibilidadeTabela(tabelaSintetica({ correcaoNivel: true }), true)).toBeNull();
  });
  it.each([
    ['hash diferente', tabelaSintetica({ hashConfig: hashConfigRef().replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) }), false],
    ['modo da correcao diferente (tabela sem, uso com)', tabelaSintetica(), true],
    ['modo da correcao diferente (tabela com, uso sem)', tabelaSintetica({ correcaoNivel: true }), false],
    ['formato diferente', { ...tabelaSintetica(), formato: 'x' } as unknown as TabelaCalibracao, false],
  ])('%s -> calibracao-incompativel', (_n, t, uso) => {
    expect(compatibilidadeTabela(t, uso as boolean)).toBe('calibracao-incompativel');
  });
});

describe('calibradorDaTabela', () => {
  it('celula com n 30 (no minimo) usa a celula; n 29 (abaixo) cai no TOTAL; n 31 usa a celula', () => {
    const cal = calibradorDaTabela(tabelaSintetica());
    expect(cal.intervalo('mensal', 'smooth', 1)).toEqual({ q10: -0.5, q90: 0.5, fonte: 'celula' });
    expect(cal.intervalo('mensal', 'erratic', 1)).toEqual({ q10: -0.4, q90: 0.6, fonte: 'total' });
    const t = tabelaSintetica();
    t.mensal[0] = { ...t.mensal[0], n: 31 };
    expect(calibradorDaTabela(t).intervalo('mensal', 'smooth', 1)?.fonte).toBe('celula');
  });
  it('TOTAL com n 29 -> null; m ausente -> null; lead time usa a tabela propria', () => {
    const t = tabelaSintetica();
    t.mensal = t.mensal.map((c) => (c.celula === 'TOTAL' ? { ...c, n: 29 } : c));
    const cal = calibradorDaTabela(t);
    expect(cal.intervalo('mensal', 'erratic', 1)).toBeNull();
    expect(cal.intervalo('mensal', 'lumpy', 1)).toBeNull();
    expect(cal.intervalo('mensal', 'smooth', 7)).toBeNull();
    expect(cal.intervalo('lt', 'smooth', 2)).toEqual({ q10: -0.3, q90: 0.3, fonte: 'celula' });
    expect(cal.intervalo('lt', 'smooth', 1)).toBeNull();
    expect(cal.intervalo('lt', 'lumpy', 3)).toEqual({ q10: -0.2, q90: 0.4, fonte: 'total' });
  });
  it('o minimo de residuos e parametro (31 manda a celula de n 30 para o TOTAL)', () => {
    expect(calibradorDaTabela(tabelaSintetica(), 31).intervalo('mensal', 'smooth', 1)?.fonte).toBe('total');
    expect(calibradorDaTabela(tabelaSintetica(), 29).intervalo('mensal', 'erratic', 1)?.fonte).toBe('celula');
  });
  it('nivel devolve o da tabela', () => {
    expect(calibradorDaTabela(tabelaSintetica()).nivel()).toEqual({ n: 300, razao: 1.2 });
  });
});

describe('criarPoolsRef', () => {
  const cfg = { minResiduos: 5, janelaNivelMeses: 12 };
  const res = (celula: 'smooth' | 'erratic', m: number, liberacao: string, residuo: number) => ({ tipo: 'mensal' as const, celula, m, liberacao, residuo });

  it('quantis tipo 7 a mao: 0..10 -> q10 = 1 e q90 = 9', () => {
    const pools = criarPoolsRef(cfg);
    for (let v = 0; v <= 10; v++) pools.pendente(res('smooth', 1, '2026-01', v));
    pools.liberarAte('2026-01');
    expect(pools.calibrador('2026-01').intervalo('mensal', 'smooth', 1)).toEqual({ q10: 1, q90: 9, fonte: 'celula' });
  });

  it('liberacao == mes libera; liberacao == mes + 1 nao', () => {
    const pools = criarPoolsRef(cfg);
    for (let v = 0; v < 5; v++) pools.pendente(res('smooth', 1, '2026-02', v));
    pools.liberarAte('2026-01');
    expect(pools.calibrador('2026-01').intervalo('mensal', 'smooth', 1)).toBeNull();
    pools.liberarAte('2026-02');
    expect(pools.calibrador('2026-02').intervalo('mensal', 'smooth', 1)).not.toBeNull();
  });

  it('residuo futuro (pendente) nao altera o intervalo ja liberado', () => {
    const pools = criarPoolsRef(cfg);
    for (let v = 0; v < 5; v++) pools.pendente(res('smooth', 1, '2026-01', v));
    pools.liberarAte('2026-01');
    const antes = pools.calibrador('2026-01').intervalo('mensal', 'smooth', 1);
    pools.pendente(res('smooth', 1, '2026-02', 1e6));
    pools.nivelPendente({ liberacao: '2026-02', real: 1e9, previsto: 1 });
    expect(pools.calibrador('2026-01').intervalo('mensal', 'smooth', 1)).toEqual(antes);
    expect(pools.calibrador('2026-01').nivel()).toEqual({ n: 0, razao: null });
  });

  it('pendente com liberacao anterior ao ultimo mes liberado lanca (nada vaza para tras)', () => {
    const pools = criarPoolsRef(cfg);
    pools.liberarAte('2026-03');
    expect(() => pools.pendente(res('smooth', 1, '2026-03', 1))).toThrow();
    expect(() => pools.pendente(res('smooth', 1, '2026-04', 1))).not.toThrow();
  });

  it('a ordem de insercao nao muda os quantis', () => {
    const valores = [5, -3, 8, 0, 2, 9, -7, 4, 1, 6, -1];
    const intervalo = (ordem: number[]) => {
      const pools = criarPoolsRef(cfg);
      for (const v of ordem) pools.pendente(res('smooth', 2, '2026-01', v));
      pools.liberarAte('2026-01');
      return pools.calibrador('2026-01').intervalo('mensal', 'smooth', 2);
    };
    expect(intervalo([...valores].reverse())).toEqual(intervalo(valores));
  });

  it('celula com poucos residuos usa o pool TOTAL (agregado de todas as celulas); sem minimo -> null', () => {
    const pools = criarPoolsRef(cfg);
    for (let v = 0; v < 3; v++) pools.pendente(res('erratic', 1, '2026-01', v));
    for (let v = 0; v < 3; v++) pools.pendente(res('smooth', 1, '2026-01', v + 10));
    pools.liberarAte('2026-01');
    const cal = pools.calibrador('2026-01');
    expect(cal.intervalo('mensal', 'erratic', 1)?.fonte).toBe('total'); // 6 >= 5 no TOTAL
    expect(cal.intervalo('mensal', 'erratic', 2)).toBeNull();
    expect(cal.intervalo('lt', 'erratic', 1)).toBeNull(); // tipos separados
  });

  it('razao de nivel em janela 12: liberacao em mes - 12 fora, mes - 11 dentro', () => {
    const pools = criarPoolsRef(cfg);
    pools.nivelPendente({ liberacao: '2025-12', real: 1000, previsto: 10 }); // mes - 12: fora
    pools.nivelPendente({ liberacao: '2026-01', real: 30, previsto: 20 }); // mes - 11: dentro
    pools.nivelPendente({ liberacao: '2026-12', real: 10, previsto: 20 }); // mes: dentro
    pools.liberarAte('2026-12');
    expect(pools.calibrador('2026-12').nivel()).toEqual({ n: 2, razao: 1 }); // (30 + 10) / (20 + 20)
    expect(pools.calibrador('2026-01').nivel().n).toBe(2); // janela de 2026-01: 2025-12 e 2026-01 (a de 2026-12 ainda nao existe)
  });

  it('paraTabela: celulas ordenadas por SBC, TOTAL por ultimo, m crescente; so n >= 1; round6; lida por lerTabelaCalibracao', () => {
    const pools = criarPoolsRef(cfg);
    pools.pendente({ tipo: 'lt', celula: 'lumpy', m: 3, liberacao: '2026-01', residuo: 1 / 3 });
    pools.pendente(res('smooth', 2, '2026-01', 0.5));
    pools.pendente(res('smooth', 1, '2026-01', -0.25));
    pools.pendente(res('erratic', 1, '2026-01', 2));
    pools.nivelPendente({ liberacao: '2026-01', real: 3, previsto: 2 });
    pools.liberarAte('2026-01');
    const meta = { versao: 'p1.1.0', hashConfig: hashConfigRef(), correcaoNivel: false, parametros: { horizonte: 6, minTreino: 6, historicoMaximo: null, usarMascara: true, janelaNivelMeses: 12 }, ultimoMes: '2026-01' };
    const t = pools.paraTabela(meta);
    expect(t.mensal.map((c) => `${c.celula}|${c.m}|${c.n}`)).toEqual(['smooth|1|1', 'smooth|2|1', 'erratic|1|1', 'TOTAL|1|2', 'TOTAL|2|1']);
    expect(t.leadTime).toEqual([{ celula: 'lumpy', m: 3, n: 1, q10: 0.333333, q90: 0.333333 }, { celula: 'TOTAL', m: 3, n: 1, q10: 0.333333, q90: 0.333333 }]);
    expect(t.mensal[3]).toMatchObject({ q10: -0.025, q90: 1.775 }); // {-0,25; 2}: pos 0,1 e 0,9 -> -0,25 + 0,1 x 2,25 e -0,25 + 0,9 x 2,25
    expect(t.nivel).toEqual({ n: 1, razao: 1.5 });
    expect(Object.keys(t)).toEqual(['formato', 'versao', 'hashConfig', 'correcaoNivel', 'parametros', 'ultimoMes', 'mensal', 'leadTime', 'nivel']);
    const volta = lerTabelaCalibracao(JSON.stringify(t));
    expect(volta.ok && volta.tabela).toEqual(t);
  });

  it('40.000 residuos em 36 meses de liberacao: sem custo quadratico (< 30 s)', () => {
    const pools = criarPoolsRef({ minResiduos: 30, janelaNivelMeses: 12 });
    const celulas = ['smooth', 'erratic'] as const;
    for (let i = 0; i < 40000; i++) {
      const lib = somarMeses('2024-01', i % 36);
      pools.pendente({ tipo: i % 5 === 0 ? 'lt' : 'mensal', celula: celulas[i % 2], m: 1 + (i % 6), liberacao: lib, residuo: ((i * 7919) % 1000) / 1000 - 0.5 });
    }
    const t0 = Date.now();
    for (let k = 0; k < 36; k++) {
      const mes = somarMeses('2024-01', k);
      pools.liberarAte(mes);
      const cal = pools.calibrador(mes);
      for (let m = 1; m <= 6; m++) cal.intervalo('mensal', 'smooth', m);
    }
    expect(Date.now() - t0).toBeLessThan(30000);
    expect(pools.calibrador('2026-12').intervalo('mensal', 'smooth', 1)).not.toBeNull();
  });
});
