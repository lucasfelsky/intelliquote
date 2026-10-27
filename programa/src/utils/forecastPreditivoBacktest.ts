// Forecast preditivo (fase 0): backtest de origem movel. Para cada serie e cada origem com meses de treino suficientes,
// roda cada metodo sobre o prefixo e compara com o realizado. Linhas por segmento x metodo, sempre na INTERSECAO
// (serie, origem) em que a planilha Q e o metodo deram ok. Os criterios de promocao sao AVALIADOS, sem efeito: na fase 0
// ninguem e "promovido" (candidato no maximo; criterios 7 e 8 ficam pendentes).
import { METODOS } from './forecastPreditivoMetodos';
import { custoNoLeadTime, horizonteLeadTime, mae, vies, wape } from './forecastPreditivoMetricas';
import type { Erro } from './forecastPreditivoMetricas';
import { segmentar } from './forecastPreditivoSegmentos';
import type { Abc, Sbc, Segmento, Xyz } from './forecastPreditivoSegmentos';
import { cortarAte, somarMeses, ultimoMes } from './forecastPreditivoSerie';
import { AVISO_IDS, METODO_IDS, PREDITIVO_CONFIG as C, PREDITIVO_VERSAO, hashCanonico } from './forecastPreditivoTipos';
import type { AnoMes, AvisoId, MetodoId, ResultadoPrevisao, SerieNormalizada } from './forecastPreditivoTipos';

export interface OpcoesBacktest {
  horizonte: number;
  minTreino: number;
  metodos: MetodoId[];
  leadTimePadraoDias: number;
  razaoFaltaExcesso: number;
  usarMascara: boolean;
}

export type Promovivel = 'referencia' | 'nao' | 'candidato';

export interface LinhaResultado {
  segmento: string;
  metodo: MetodoId;
  n: number; // pares (serie, origem) com observacao no lead time
  origens: number; // meses de origem distintos entre esses pares
  wapeH1: number | null;
  wapeH3: number | null;
  wapeLT: number | null;
  viesLT: number | null;
  maeLT: number | null;
  custoLT: number;
  custoRel: number | null;
  vitoria: number | null; // fracao das series do segmento com WAPE_LT menor que o da planilha
  criteriosFalhos: number[]; // 1..5 (o 6 e informativo: itensAPiores; 7 e 8 pendentes na fase 0)
  promovivel: Promovivel;
  itensAPiores: string[];
}

export interface ResumoSerie {
  id: string;
  meses: number;
  origens: number;
  abc: Abc;
  xyz: Xyz;
  sbc: Sbc;
  avisos: AvisoId[];
  wapeLT: Record<string, number | null>;
}

export interface ResultadoBacktest {
  versao: string;
  hashConfig: string;
  hashEntrada: string;
  opcoes: OpcoesBacktest;
  origens: number;
  contagem: { series: number; comPrevisao: number; semVenda: number; historicoCurto: number };
  linhas: LinhaResultado[];
  porSerie: ResumoSerie[]; // array ordenado por id (um Map sumiria no JSON.stringify)
  avisos: Record<AvisoId, number>;
}

export function validarOpcoesBacktest(o: OpcoesBacktest): string[] {
  const erros: string[] = [];
  if (!Number.isInteger(o.horizonte) || o.horizonte < 1 || o.horizonte > C.horizonteMax) erros.push('horizonte deve ser inteiro de 1 a 12');
  if (!Number.isInteger(o.minTreino) || o.minTreino < 1) erros.push('minTreino deve ser inteiro >= 1');
  if (!Array.isArray(o.metodos) || o.metodos.length === 0) erros.push('metodos nao pode ser vazio');
  else if (o.metodos.some((m) => !METODO_IDS.includes(m))) erros.push('metodos contem metodo desconhecido');
  if (!Number.isFinite(o.leadTimePadraoDias) || o.leadTimePadraoDias < 0 || o.leadTimePadraoDias > 3650) erros.push('leadTimePadraoDias deve estar entre 0 e 3650');
  if (!Number.isFinite(o.razaoFaltaExcesso) || o.razaoFaltaExcesso <= 0) erros.push('razaoFaltaExcesso deve ser > 0');
  return erros;
}

interface Obs {
  h1?: Erro;
  h3?: Erro;
  lt?: Erro;
}
interface Par {
  s: number; // indice da serie
  i: number; // indice da origem na serie
  origem: AnoMes;
  seg: Segmento;
}
type Resultados = Map<MetodoId, (Obs | null)[]>; // por par; null = metodo nao deu ok

const porId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function observar(s: SerieNormalizada, i: number, origem: AnoMes, r: Extract<ResultadoPrevisao, { ok: true }>, o: OpcoesBacktest): Obs {
  const real = (h: number): number | null => (i + h < s.valores.length && !s.mascara[i + h] ? s.valores[i + h] : null);
  const erro = (h: number, x: number, prev: number): Erro => ({ serieId: s.id, origem, h, real: x, previsto: prev });
  const obs: Obs = {};
  const r1 = real(1);
  if (r1 !== null) obs.h1 = erro(1, r1, r.pontos[0].p50);
  const r3 = o.horizonte >= 3 ? real(3) : null;
  if (r3 !== null) obs.h3 = erro(3, r3, r.pontos[2].p50);
  const hl = horizonteLeadTime(s.meta.leadTimeDias ?? o.leadTimePadraoDias, o.horizonte);
  let somaReal = 0;
  let somaPrev = 0;
  for (let h = 1; h <= hl; h++) {
    const x = real(h);
    if (x === null) return obs; // lead time sem todos os meses realizados: sem observacao
    somaReal += x;
    somaPrev += r.pontos[h - 1].p50;
  }
  obs.lt = erro(hl, somaReal, somaPrev);
  return obs;
}

const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function calcularLinha(segmento: string, metodo: MetodoId, indices: number[], res: Resultados, pares: Par[], o: OpcoesBacktest): LinhaResultado {
  const meu = res.get(metodo)!;
  const ref = res.get('planilha-q')!;
  const comum = indices.filter((p) => meu[p] && ref[p]);
  const erros = (f: (x: Obs) => Erro | undefined, de: (Obs | null)[]) => comum.map((p) => f(de[p]!)).filter((e): e is Erro => !!e);
  const lt = comum.filter((p) => meu[p]!.lt).map((p) => ({ abc: pares[p].seg.abc, m: meu[p]!.lt!, r: ref[p]!.lt! }));
  const eM = lt.map((x) => x.m);
  const eR = lt.map((x) => x.r);
  const custo = (e: Erro[]) => soma(e.map((x) => custoNoLeadTime(x.real, x.previsto, o.razaoFaltaExcesso).custo));
  const custoM = custo(eM);
  const custoR = custo(eR);
  const agrupar = (itens: typeof lt) => {
    const g = new Map<string, { m: Erro[]; r: Erro[] }>();
    for (const x of itens) {
      const a = g.get(x.m.serieId) ?? { m: [], r: [] };
      a.m.push(x.m);
      a.r.push(x.r);
      g.set(x.m.serieId, a);
    }
    return g;
  };
  let comparaveis = 0;
  let vitorias = 0;
  for (const g of agrupar(lt).values()) {
    const wm = wape(g.m);
    const wr = wape(g.r);
    if (wm === null || wr === null) continue;
    comparaveis++;
    if (wm < wr) vitorias++;
  }
  // criterio 6: series A (nos pares A) com WAPE_LT > guardaA x o da planilha; so listadas, nao reprovam
  const piores: string[] = [];
  for (const [id, g] of agrupar(lt.filter((x) => x.abc === 'A'))) {
    const wm = wape(g.m);
    const wr = wape(g.r);
    if (wm !== null && wr !== null && wm > C.promocao.guardaA * wr) piores.push(id);
  }
  const wapeLT = wape(eM);
  const wapeRef = wape(eR);
  const viesLT = vies(eM);
  const viesRef = vies(eR);
  const origens = new Set(eM.map((x) => x.origem)).size;
  const custoRel = custoR > 0 ? custoM / custoR : null;
  const vitoria = comparaveis > 0 ? vitorias / comparaveis : null;
  const falhos: number[] = [];
  if (!(origens >= C.promocao.minOrigens && eM.length >= C.promocao.minObs)) falhos.push(1);
  if (!(wapeLT !== null && wapeRef !== null && wapeLT <= C.promocao.wapeRel * wapeRef)) falhos.push(2);
  if (!(viesLT !== null && Math.abs(viesLT) <= C.promocao.viesMax && Math.abs(viesLT) <= Math.abs(viesRef ?? 0) + C.promocao.viesFolga)) falhos.push(3);
  if (!(custoRel !== null && custoRel <= C.promocao.custoRel)) falhos.push(4);
  if (!(vitoria !== null && vitoria >= C.promocao.vitoria)) falhos.push(5);
  const referencia = metodo === 'planilha-q';
  return {
    segmento,
    metodo,
    n: eM.length,
    origens,
    wapeH1: wape(erros((x) => x.h1, meu)),
    wapeH3: wape(erros((x) => x.h3, meu)),
    wapeLT,
    viesLT,
    maeLT: mae(eM),
    custoLT: custoM,
    custoRel,
    vitoria: referencia ? null : vitoria,
    criteriosFalhos: referencia ? [] : falhos,
    promovivel: referencia ? 'referencia' : falhos.length > 0 ? 'nao' : 'candidato',
    itensAPiores: referencia ? [] : piores.sort(),
  };
}

const ORDEM_ABC: string[] = ['A', 'B', 'C', 'sem-venda'];
const ORDEM_SBC: string[] = ['smooth', 'erratic', 'intermittent', 'lumpy', 'insuficiente'];

function ordenarSegmentos(chaves: string[]): string[] {
  const rank = (k: string) => (k === 'TOTAL' ? 0 : ORDEM_ABC.includes(k) ? 1 : ORDEM_SBC.includes(k) ? 2 : 3);
  const pos = (k: string) => (rank(k) === 1 ? ORDEM_ABC.indexOf(k) : rank(k) === 2 ? ORDEM_SBC.indexOf(k) : 0);
  return [...chaves].sort((a, b) => rank(a) - rank(b) || pos(a) - pos(b) || (a < b ? -1 : a > b ? 1 : 0));
}

export function rodarBacktest(entrada: SerieNormalizada[], o: OpcoesBacktest): ResultadoBacktest {
  const invalidas = validarOpcoesBacktest(o);
  if (invalidas.length > 0) throw new Error('opcoes invalidas: ' + invalidas.join('; '));
  const ordenadas = [...entrada].sort(porId);
  const series = o.usarMascara ? ordenadas : ordenadas.map((s) => ({ ...s, mascara: s.mascara.map(() => false) }));
  const metodos = METODO_IDS.filter((m) => o.metodos.includes(m));
  const calcular: MetodoId[] = metodos.includes('planilha-q') ? metodos : ['planilha-q', ...metodos];
  const opcoes: OpcoesBacktest = { ...o, metodos };

  // origens: >= minTreino meses validos ate o mes e ao menos 1 mes realizado depois
  const origensPorMes = new Set<AnoMes>();
  const candidatos: { s: number; i: number; origem: AnoMes }[] = [];
  series.forEach((s, idx) => {
    let validos = 0;
    for (let i = 0; i < s.valores.length - 1; i++) {
      if (!s.mascara[i]) validos++;
      if (validos < o.minTreino) continue;
      const origem = somarMeses(s.inicio, i);
      candidatos.push({ s: idx, i, origem });
      origensPorMes.add(origem);
    }
  });
  const segmentos = new Map<AnoMes, Map<string, Segmento>>();
  for (const mes of [...origensPorMes].sort()) segmentos.set(mes, segmentar(series, mes));

  const pares: Par[] = candidatos.map((c) => ({ ...c, seg: segmentos.get(c.origem)!.get(series[c.s].id)! }));
  const avisosSerie: Set<AvisoId>[] = series.map((s) => new Set<AvisoId>(s.avisos));
  const res: Resultados = new Map(calcular.map((m) => [m, new Array<Obs | null>(pares.length).fill(null)]));
  pares.forEach((p, pi) => {
    const s = series[p.s];
    const cortada = cortarAte(s, p.origem)!;
    for (const m of calcular) {
      const r = METODOS[m](cortada, { horizonte: o.horizonte });
      if (!r.ok) continue;
      res.get(m)![pi] = observar(s, p.i, p.origem, r, o);
      for (const a of r.avisos) avisosSerie[p.s].add(a);
    }
  });

  const porSegmento = new Map<string, number[]>();
  pares.forEach((p, pi) => {
    for (const k of ['TOTAL', p.seg.abc, p.seg.sbc, `${p.seg.abc}/${p.seg.sbc}`]) porSegmento.set(k, [...(porSegmento.get(k) ?? []), pi]);
  });
  const linhas: LinhaResultado[] = [];
  for (const k of ordenarSegmentos([...porSegmento.keys()])) {
    for (const m of metodos) linhas.push(calcularLinha(k, m, porSegmento.get(k)!, res, pares, o));
  }

  const fim = series.map(ultimoMes).sort().pop() ?? '';
  const finais = fim === '' ? new Map<string, Segmento>() : segmentar(series, fim);
  const contagem = { series: series.length, comPrevisao: 0, semVenda: 0, historicoCurto: 0 };
  const porSerie: ResumoSerie[] = series.map((s, idx) => {
    const meus = pares.map((p, pi) => ({ p, pi })).filter((x) => x.p.s === idx);
    const semVenda = s.valores.length > 0 && s.valores.every((v) => v === 0);
    if (meus.length > 0) contagem.comPrevisao++;
    else {
      contagem.historicoCurto++;
      avisosSerie[idx].add('historico-curto');
    }
    if (semVenda) {
      contagem.semVenda++;
      avisosSerie[idx].add('sem-venda');
    }
    const wapeLT: Record<string, number | null> = {};
    for (const m of metodos) {
      wapeLT[m] = wape(meus.map((x) => res.get(m)![x.pi]?.lt).filter((e): e is Erro => !!e));
    }
    const seg = finais.get(s.id) ?? { abc: 'sem-venda' as Abc, xyz: 'n/a' as Xyz, sbc: 'insuficiente' as Sbc };
    return { id: s.id, meses: s.valores.length, origens: meus.length, ...seg, avisos: AVISO_IDS.filter((a) => avisosSerie[idx].has(a)), wapeLT };
  });
  const avisos = Object.fromEntries(AVISO_IDS.map((a) => [a, avisosSerie.filter((c) => c.has(a)).length])) as Record<AvisoId, number>;

  return {
    versao: PREDITIVO_VERSAO,
    hashConfig: hashCanonico(C),
    hashEntrada: hashCanonico(ordenadas),
    opcoes,
    origens: origensPorMes.size,
    contagem,
    linhas,
    porSerie,
    avisos,
  };
}
