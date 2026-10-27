// Forecast preditivo (P1a): backtest de origem movel P1. Diferencas para a fase 0: amostra COMUM (metodo sem previsao
// usa a Q no par, contado em nFallback), intervalos p10/p90 sem vazamento, duas metades temporais das origens, criterios
// 1-5, 7 e 8, segmentos novos (XYZ, classe de lead time, fonte por posto, regra de protecao) e dois cenarios de
// min-treino (12 = principal, e o pedido). Funcoes puras: sem relogio, sem ordem de insercao de Map na saida.
import { observar, validarOpcoesBacktest } from './forecastPreditivoBacktest';
import type { OpcoesBacktest } from './forecastPreditivoBacktest';
import { AVISO_P1_IDS, PREDITIVO_CONFIG_P1, REGRA_IDS, hashConfigP1 } from './forecastPreditivoConfigP1';
import type { AvisoP1Id, RegraProtecao } from './forecastPreditivoConfigP1';
import { escalaLeadTime, intervalosEmpiricos } from './forecastPreditivoIntervalos';
import type { ParIntervalo } from './forecastPreditivoIntervalos';
import { calcularLinhaP1 } from './forecastPreditivoLinhasP1';
import type { LinhaP1, ObsP1, ParLinha } from './forecastPreditivoLinhasP1';
import { horizonteLeadTime, wape } from './forecastPreditivoMetricas';
import type { Erro } from './forecastPreditivoMetricas';
import { METODOS_TODOS, regraProtecao } from './forecastPreditivoMetodosP1';
import { segmentar } from './forecastPreditivoSegmentos';
import type { Abc, Sbc, Segmento, Xyz } from './forecastPreditivoSegmentos';
import { chavesSegmentoP1, classeLeadTime, leadTimeTruncado, ordenarSegmentosP1, rotuloFonteDaSerie, rotulosFonte } from './forecastPreditivoSegmentosP1';
import type { ClasseLt } from './forecastPreditivoSegmentosP1';
import { cortarAte, somarMeses, ultimoMes } from './forecastPreditivoSerie';
import { AVISO_IDS, METODO_TODOS_IDS, PREDITIVO_VERSAO, hashCanonico } from './forecastPreditivoTipos';
import type { AnoMes, AvisoId, MetodoTodosId, SerieNormalizada } from './forecastPreditivoTipos';

export interface OpcoesBacktestP1 {
  horizonte: number;
  minTreino: number;
  metodos: MetodoTodosId[];
  leadTimePadraoDias: number;
  razaoFaltaExcesso: number;
  usarMascara: boolean;
  tetoVies: number | null; // teto absoluto do criterio 3 (null = sem teto)
}

export function validarOpcoesBacktestP1(o: OpcoesBacktestP1): string[] {
  const erros = validarOpcoesBacktest({ ...o, metodos: ['planilha-q'] });
  if (!Array.isArray(o.metodos) || o.metodos.length === 0) erros.push('metodos nao pode ser vazio');
  else if (o.metodos.some((m) => !METODO_TODOS_IDS.includes(m))) erros.push('metodos contem metodo desconhecido');
  if (o.tetoVies !== null && !(Number.isFinite(o.tetoVies) && o.tetoVies >= 0 && o.tetoVies <= 1)) erros.push('tetoVies deve ser null ou estar entre 0 e 1');
  return erros;
}

export interface ResumoSerieP1 {
  id: string;
  rotuloFonte: string;
  meses: number;
  origens: number;
  abc: Abc;
  xyz: Xyz;
  sbc: Sbc;
  classeLt: ClasseLt;
  regra: RegraProtecao;
  avisos: AvisoId[];
  avisosP1: AvisoP1Id[];
  wapeLT: Record<string, number | null>;
}

export interface CenarioP1 {
  minTreino: number;
  principal: boolean;
  origens: number; // meses de origem distintos (candidatos)
  origensComObservacao: number; // meses de origem distintos na amostra comum
  metades: { meses1: number; meses2: number; ultimoMes1: AnoMes | null };
  contagem: { series: number; comPrevisao: number; semVenda: number; historicoCurto: number };
  contagemSegmentos: Record<'abc' | 'sbc' | 'xyz' | 'lt' | 'fonte' | 'regra', Record<string, number>>;
  avisos: Record<AvisoId, number>;
  avisosP1: Record<AvisoP1Id, number>;
  amostra: { pares: number; fallbackPorMetodo: Record<string, number> };
  linhas: LinhaP1[];
  porSerie: ResumoSerieP1[];
}

export interface ResultadoBacktestP1 {
  versao: string;
  hashConfig: string;
  hashEntrada: string;
  opcoes: OpcoesBacktestP1;
  cenariosMinTreino: number[];
  fontes: { rotulo: string; fonte: string }[];
  cenarios: CenarioP1[];
}

const porId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const contar = (chaves: readonly string[], valores: string[]): Record<string, number> =>
  Object.fromEntries(chaves.map((c) => [c, valores.filter((v) => v === c).length]));
const ABC: Abc[] = ['A', 'B', 'C', 'sem-venda'];
const SBC: Sbc[] = ['smooth', 'erratic', 'intermittent', 'lumpy', 'insuficiente'];
const XYZ: Xyz[] = ['X', 'Y', 'Z', 'n/a'];
const LT: ClasseLt[] = ['<=60', '61-90', '>90', 'padrao'];

interface Par extends ParLinha {
  s: number; // indice da serie
  i: number; // indice da origem na serie
  seg: Segmento;
  regra: RegraProtecao;
}

export function rodarCenarioP1(entrada: SerieNormalizada[], o: OpcoesBacktestP1, principal: boolean): CenarioP1 {
  const ordenadas = [...entrada].sort(porId);
  const series = o.usarMascara ? ordenadas : ordenadas.map((s) => ({ ...s, mascara: s.mascara.map(() => false) }));
  const metodos = METODO_TODOS_IDS.filter((m) => o.metodos.includes(m));
  const calcular: MetodoTodosId[] = metodos.includes('planilha-q') ? metodos : ['planilha-q', ...metodos];
  const o0: OpcoesBacktest = { ...o, metodos: ['planilha-q'] };
  const fontes = rotulosFonte(series);
  const rotuloFonte = series.map((s) => rotuloFonteDaSerie(s, fontes));
  const leadTimeEfetivo = (s: SerieNormalizada) => s.meta.leadTimeDias ?? o.leadTimePadraoDias;

  // candidatos: >= minTreino meses validos ate o mes e ao menos 1 mes realizado depois (mesma regra da fase 0)
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

  const avisosSerie: Set<AvisoId>[] = series.map((s) => new Set<AvisoId>(s.avisos));
  const pares: Par[] = [];
  const escalas: number[] = [];
  const hls: number[] = [];
  const res = new Map<MetodoTodosId, ObsP1[]>(calcular.map((m) => [m, []]));
  for (const c of candidatos) {
    const s = series[c.s];
    const cortada = cortarAte(s, c.origem)!;
    const hl = horizonteLeadTime(leadTimeEfetivo(s), o.horizonte);
    const rq = METODOS_TODOS['planilha-q'](cortada, { horizonte: o.horizonte });
    if (!rq.ok) continue; // nao ocorre (>= 1 mes valido); defensivo
    for (const a of rq.avisos) avisosSerie[c.s].add(a);
    for (const m of calcular) {
      const r = m === 'planilha-q' ? rq : METODOS_TODOS[m](cortada, { horizonte: o.horizonte });
      if (r.ok && m !== 'planilha-q') for (const a of r.avisos) avisosSerie[c.s].add(a);
      const usado = r.ok ? r : rq; // fallback: Q no par (contado)
      res.get(m)!.push({ obs: observar(s, c.i, c.origem, usado, o0), fallback: !r.ok, intervalo: null });
    }
    pares.push({ s: c.s, i: c.i, serieId: s.id, origem: c.origem, abc: segmentos.get(c.origem)!.get(s.id)!.abc, seg: segmentos.get(c.origem)!.get(s.id)!, regra: regraProtecao(cortada) });
    escalas.push(escalaLeadTime(cortada, hl));
    hls.push(hl);
  }

  // amostra comum + intervalos (por metodo, so com residuos liberados ate a origem)
  const amostra = pares.map((_, p) => p).filter((p) => res.get('planilha-q')![p].obs.lt);
  for (const m of calcular) {
    const lista = res.get(m)!;
    const entradaInt: ParIntervalo[] = amostra.map((p) => ({
      indice: p,
      origem: pares[p].origem,
      liberacao: somarMeses(pares[p].origem, hls[p]),
      celula: pares[p].seg.sbc,
      hl: hls[p],
      previstoLT: lista[p].obs.lt!.previsto,
      realLT: lista[p].obs.lt!.real,
      escala: escalas[p],
    }));
    intervalosEmpiricos(entradaInt).forEach((iv, k) => {
      lista[amostra[k]].intervalo = iv;
    });
  }

  // metades temporais das origens da amostra: k1 = floor(k / 2) primeiros meses = metade 1
  const mesesAmostra = [...new Set(amostra.map((p) => pares[p].origem))].sort();
  const k1 = Math.floor(mesesAmostra.length / 2);
  const ultimoMes1 = k1 > 0 ? mesesAmostra[k1 - 1] : null;

  const porSegmento = new Map<string, number[]>();
  pares.forEach((p, pi) => {
    const chaves = chavesSegmentoP1(p.seg, classeLeadTime(series[p.s].meta.leadTimeDias), rotuloFonte[p.s], p.regra);
    for (const k of chaves) {
      const lista = porSegmento.get(k);
      if (lista) lista.push(pi);
      else porSegmento.set(k, [pi]);
    }
  });
  const ctx = { pares, razaoFaltaExcesso: o.razaoFaltaExcesso, tetoVies: o.tetoVies, ultimoMes1 };
  const linhas: LinhaP1[] = [];
  for (const k of ordenarSegmentosP1([...porSegmento.keys()])) {
    for (const m of metodos) linhas.push(calcularLinhaP1(k, m, porSegmento.get(k)!, res.get(m)!, res.get('planilha-q')!, ctx));
  }

  // por serie (segmentos e regra no ultimo mes)
  const fim = series.map(ultimoMes).sort().pop() ?? '';
  const finais = fim === '' ? new Map<string, Segmento>() : segmentar(series, fim);
  const paresPorSerie = new Map<number, number[]>();
  pares.forEach((p, pi) => {
    const lista = paresPorSerie.get(p.s);
    if (lista) lista.push(pi);
    else paresPorSerie.set(p.s, [pi]);
  });
  const contagem = { series: series.length, comPrevisao: 0, semVenda: 0, historicoCurto: 0 };
  const truncadas = series.map((s) => leadTimeTruncado(leadTimeEfetivo(s), o.horizonte));
  const porSerie: ResumoSerieP1[] = series.map((s, idx) => {
    const meus = paresPorSerie.get(idx) ?? [];
    if (meus.length > 0) contagem.comPrevisao++;
    else {
      contagem.historicoCurto++;
      avisosSerie[idx].add('historico-curto');
    }
    if (s.valores.length > 0 && s.valores.every((v) => v === 0)) {
      contagem.semVenda++;
      avisosSerie[idx].add('sem-venda');
    }
    const wapeLT: Record<string, number | null> = {};
    for (const m of metodos) {
      wapeLT[m] = wape(meus.map((pi) => res.get(m)![pi].obs.lt).filter((e): e is Erro => !!e));
    }
    const seg = finais.get(s.id) ?? { abc: 'sem-venda' as Abc, xyz: 'n/a' as Xyz, sbc: 'insuficiente' as Sbc };
    return {
      id: s.id,
      rotuloFonte: rotuloFonte[idx],
      meses: s.valores.length,
      origens: meus.length,
      ...seg,
      classeLt: classeLeadTime(s.meta.leadTimeDias),
      regra: regraProtecao(s),
      avisos: AVISO_IDS.filter((a) => avisosSerie[idx].has(a)),
      avisosP1: truncadas[idx] ? ['lead-time-truncado'] : [],
      wapeLT,
    };
  });
  const rotulosPresentes = [...new Set(fontes.values())].filter((r) => r !== 'outras').sort();
  const eixo = (f: (s: ResumoSerieP1) => string) => porSerie.map(f);
  return {
    minTreino: o.minTreino,
    principal,
    origens: origensPorMes.size,
    origensComObservacao: mesesAmostra.length,
    metades: { meses1: k1, meses2: mesesAmostra.length - k1, ultimoMes1 },
    contagem,
    contagemSegmentos: {
      abc: contar(ABC, eixo((s) => s.abc)),
      sbc: contar(SBC, eixo((s) => s.sbc)),
      xyz: contar(XYZ, eixo((s) => s.xyz)),
      lt: contar(LT, eixo((s) => s.classeLt)),
      fonte: contar([...rotulosPresentes, 'outras', 'sem-fonte'], eixo((s) => s.rotuloFonte)),
      regra: contar(REGRA_IDS, eixo((s) => s.regra)),
    },
    avisos: Object.fromEntries(AVISO_IDS.map((a) => [a, avisosSerie.filter((c) => c.has(a)).length])) as Record<AvisoId, number>,
    avisosP1: Object.fromEntries(AVISO_P1_IDS.map((a) => [a, porSerie.filter((s) => s.avisosP1.includes(a)).length])) as Record<AvisoP1Id, number>,
    amostra: {
      pares: amostra.length,
      fallbackPorMetodo: Object.fromEntries(metodos.map((m) => [m, amostra.filter((p) => res.get(m)![p].fallback).length])),
    },
    linhas,
    porSerie,
  };
}

export function rodarBacktestP1(entrada: SerieNormalizada[], o: OpcoesBacktestP1): ResultadoBacktestP1 {
  const invalidas = validarOpcoesBacktestP1(o);
  if (invalidas.length > 0) throw new Error('opcoes invalidas: ' + invalidas.join('; '));
  const ordenadas = [...entrada].sort(porId);
  const metodos = METODO_TODOS_IDS.filter((m) => o.metodos.includes(m));
  const principal = PREDITIVO_CONFIG_P1.criterios.minTreinoPrincipal;
  const cenariosMinTreino = o.minTreino === principal ? [principal] : [principal, o.minTreino];
  const mapa = rotulosFonte(ordenadas);
  const fontes = [...mapa.entries()]
    .map(([fonte, rotulo]) => ({ rotulo, fonte }))
    .sort((a, b) => (a.rotulo < b.rotulo ? -1 : a.rotulo > b.rotulo ? 1 : a.fonte < b.fonte ? -1 : a.fonte > b.fonte ? 1 : 0));
  return {
    versao: PREDITIVO_VERSAO,
    hashConfig: hashConfigP1(),
    hashEntrada: hashCanonico(ordenadas),
    opcoes: { ...o, metodos },
    cenariosMinTreino,
    fontes,
    cenarios: cenariosMinTreino.map((mt, k) => rodarCenarioP1(ordenadas, { ...o, metodos, minTreino: mt }, k === 0)),
  };
}
