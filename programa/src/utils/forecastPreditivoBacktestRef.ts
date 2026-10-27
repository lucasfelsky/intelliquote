// Forecast preditivo (P1b-1): backtest de origem movel da REFERENCIA. Variantes: planilha-q x referencia x referencia-corrigida,
// sobre a AMOSTRA COMUM (pares com lead time observado; elegibilidade por meses de CALENDARIO, nao validos: a amostra e igual com
// e sem mascara, com e sem correcao e com qualquer --historico-max). Realizado BRUTO (mes marcado continua contando no erro).
// Sem vazamento: o treino de cada origem e cortado (e truncado em historicoMaximo) naquele mes; pools e razao de nivel so com
// residuos liberados ate a origem; regra e segmentos so na serie de treino. Funcao pura; estado local a uma chamada.
import { mediaValidos } from './forecastPreditivoBaselines';
import { hashConfigRef, PREDITIVO_CONFIG_REF, VARIANTE_IDS, validarParametrosCorrecao } from './forecastPreditivoConfigRef';
import type { ParametrosCorrecao, VarianteRef } from './forecastPreditivoConfigRef';
import { PREDITIVO_CONFIG_P1, REGRA_IDS } from './forecastPreditivoConfigP1';
import type { RegraProtecao } from './forecastPreditivoConfigP1';
import { validarOpcoesBacktestP1 } from './forecastPreditivoBacktestP1';
import type { CenarioP1 } from './forecastPreditivoBacktestP1';
import type { TabelaCalibracao } from './forecastPreditivoCalibracao';
import { calcularLinhaRef } from './forecastPreditivoLinhasRef';
import type { LinhaRef, ObsRef } from './forecastPreditivoLinhasRef';
import { falhaCriterio7 } from './forecastPreditivoLinhasP1';
import type { ParLinha } from './forecastPreditivoLinhasP1';
import type { ContagemMarcas } from './forecastPreditivoMarcas';
import { horizonteLeadTime, wape, custoNoLeadTime } from './forecastPreditivoMetricas';
import type { Erro } from './forecastPreditivoMetricas';
import { METODOS } from './forecastPreditivoMetodos';
import { criarPoolsRef } from './forecastPreditivoPoolsRef';
import { regraProtecao } from './forecastPreditivoMetodosP1';
import { montarPrevisaoRef, previsaoBaseRef } from './forecastPreditivoReferencia';
import type { BaseRef, PrevisaoSerieRef } from './forecastPreditivoReferencia';
import { segmentar } from './forecastPreditivoSegmentos';
import type { Abc, Sbc, Segmento, Xyz } from './forecastPreditivoSegmentos';
import { chavesSegmentoP1, classeLeadTime, ordenarSegmentosP1, rotuloFonteDaSerie, rotulosFonte } from './forecastPreditivoSegmentosP1';
import type { ClasseLt } from './forecastPreditivoSegmentosP1';
import { cortarAte, indiceMes, somarMeses, ultimoMes } from './forecastPreditivoSerie';
import { PREDITIVO_VERSAO, hashCanonico } from './forecastPreditivoTipos';
import type { AnoMes, SerieNormalizada } from './forecastPreditivoTipos';

export interface OpcoesBacktestRef {
  horizonte: number;
  minTreino: number;
  leadTimePadraoDias: number;
  razaoFaltaExcesso: number;
  usarMascara: boolean;
  tetoVies: number | null;
  historicoMaximo: number | null; // so os ultimos n meses de treino em cada origem (simula a producao: ~7 meses); null = tudo
  parametrosCorrecao: ParametrosCorrecao;
}

export function validarOpcoesBacktestRef(o: OpcoesBacktestRef): string[] {
  const erros = validarOpcoesBacktestP1({ ...o, metodos: ['planilha-q'] });
  const hm = o.historicoMaximo;
  if (hm !== null && !(Number.isInteger(hm) && hm >= 1 && hm <= PREDITIVO_CONFIG_REF.historicoMaximoLimite)) erros.push('historicoMaximo deve ser null ou inteiro de 1 a 240');
  erros.push(...validarParametrosCorrecao(o.parametrosCorrecao));
  return erros;
}

export interface ResumoSerieRef {
  id: string;
  rotuloFonte: string;
  meses: number;
  origens: number;
  abc: Abc;
  xyz: Xyz;
  sbc: Sbc;
  classeLt: ClasseLt;
  regra: RegraProtecao;
  variantes: Record<VarianteRef, { wapeLT: number | null; custoLT: number; faltaLT: number; excessoLT: number }>;
}

type Referencias = 'referencia' | 'referencia-corrigida';

export interface CenarioRef {
  minTreino: number;
  principal: boolean;
  origens: number;
  origensComObservacao: number;
  metades: { meses1: number; meses2: number; ultimoMes1: AnoMes | null };
  contagem: { series: number; comPrevisao: number; semVenda: number; historicoCurto: number };
  contagemSegmentos: CenarioP1['contagemSegmentos'];
  amostra: { pares: number; fallbackReferencia: number; residuosExcluidosMascara: number };
  correcao: { fatorMedio: number | null; fatorMin: number | null; fatorMax: number | null; paresNoLimite: number; paresSemDados: number };
  criterio7: Record<Referencias, { cobertura: number | null; n: number; passa: boolean }>;
  linhas: LinhaRef[];
  porSerie: ResumoSerieRef[];
  tabelas: Record<Referencias, TabelaCalibracao>;
}

export interface ResultadoBacktestRef {
  versao: string;
  hashConfig: string;
  hashEntrada: string;
  opcoes: OpcoesBacktestRef;
  cenariosMinTreino: number[];
  fontes: { rotulo: string; fonte: string }[];
  marcas: ContagemMarcas | null;
  cenarios: CenarioRef[];
}

const porId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const contar = (chaves: readonly string[], valores: string[]): Record<string, number> => Object.fromEntries(chaves.map((c) => [c, valores.filter((v) => v === c).length]));
const ABC: Abc[] = ['A', 'B', 'C', 'sem-venda'];
const SBC: Sbc[] = ['smooth', 'erratic', 'intermittent', 'lumpy', 'insuficiente'];
const XYZ: Xyz[] = ['X', 'Y', 'Z', 'n/a'];
const LT: ClasseLt[] = ['<=60', '61-90', '>90', 'padrao'];
const mesDeIndice = (k: number): AnoMes => somarMeses('0000-01', k);

// Treino da origem: serie cortada no mes e, com historicoMaximo, so os ultimos n meses.
function treinoEm(s: SerieNormalizada, mes: AnoMes, historicoMaximo: number | null): SerieNormalizada | null {
  const c = cortarAte(s, mes);
  if (c === null || historicoMaximo === null || c.valores.length <= historicoMaximo) return c;
  const n = historicoMaximo;
  return { ...c, inicio: somarMeses(c.inicio, c.valores.length - n), valores: c.valores.slice(-n), mascara: c.mascara.slice(-n) };
}

interface Par extends ParLinha {
  s: number;
  chaves: string[];
}

export function rodarCenarioRef(entrada: SerieNormalizada[], o: OpcoesBacktestRef, principal: boolean): CenarioRef {
  const ordenadas = [...entrada].sort(porId);
  const series = o.usarMascara ? ordenadas : ordenadas.map((s) => ({ ...s, mascara: s.mascara.map(() => false) }));
  const H = o.horizonte;
  const I = PREDITIVO_CONFIG_REF.intervalo;
  const nivelCfg = { minResiduos: I.minResiduos, janelaNivelMeses: PREDITIVO_CONFIG_REF.correcaoNivel.janelaMeses };
  const fontes = rotulosFonte(series);
  const rotuloFonte = series.map((s) => rotuloFonteDaSerie(s, fontes));
  const fim = series.map(ultimoMes).sort().pop() ?? '';

  // 1. candidatos por mes de origem: indice i com i + 1 >= minTreino MESES DE CALENDARIO e >= 1 mes depois
  const porMes = new Map<number, { s: number; i: number }[]>();
  series.forEach((s, idx) => {
    for (let i = Math.max(0, o.minTreino - 1); i < s.valores.length - 1; i++) {
      const k = indiceMes(s.inicio) + i;
      const lista = porMes.get(k);
      if (lista) lista.push({ s: idx, i });
      else porMes.set(k, [{ s: idx, i }]);
    }
  });

  const poolsRef = criarPoolsRef(nivelCfg);
  const poolsCor = criarPoolsRef(nivelCfg);
  const pares: Par[] = [];
  const obs: Record<VarianteRef, ObsRef[]> = { 'planilha-q': [], referencia: [], 'referencia-corrigida': [] };
  const fatores: number[] = [];
  let paresNoLimite = 0;
  let paresSemDados = 0;
  let excluidosMascara = 0;
  const opMontar = { horizonte: H, leadTimePadraoDias: o.leadTimePadraoDias, parametrosCorrecao: o.parametrosCorrecao };

  for (const k of [...porMes.keys()].sort((a, b) => a - b)) {
    const mesO = mesDeIndice(k);
    poolsRef.liberarAte(mesO);
    poolsCor.liberarAte(mesO);
    const calRef = poolsRef.calibrador(mesO);
    const calCor = poolsCor.calibrador(mesO);
    const treinos = series.map((s) => treinoEm(s, mesO, o.historicoMaximo));
    const segs = segmentar(treinos.filter((t): t is SerieNormalizada => t !== null), mesO);
    for (const c of porMes.get(k)!) {
      const s = series[c.s];
      const treino = treinos[c.s]!;
      const pq = METODOS['planilha-q'](treino, { horizonte: H });
      if (!pq.ok) continue; // nao ocorre com >= 1 mes valido; a serie conta em historicoCurto se nao tiver nenhum par
      const base = previsaoBaseRef(treino, H);
      const fallback = base.p50s.length === 0;
      const baseQ: BaseRef = { regra: base.regra, metodoUsado: 'planilha-q', componentes: 1, p50s: pq.pontos.map((p) => p.p50), parametros: pq.parametros, avisos: pq.avisos, avisosRef: [] };
      const usada = fallback ? baseQ : base;
      const comb = !fallback && base.metodoUsado === 'combinacao-ses-r-holt';
      const seg = segs.get(s.id)!;
      const dias = s.meta.leadTimeDias ?? o.leadTimePadraoDias;
      const hl = horizonteLeadTime(dias, H);
      const reais: (number | null)[] = Array.from({ length: H }, (_, j) => (c.i + j + 1 < s.valores.length ? s.valores[c.i + j + 1] : null)); // BRUTO
      let realLT: number | null = 0;
      for (let h = 1; h <= hl; h++) {
        if (reais[h - 1] === null) realLT = null;
        else if (realLT !== null) realLT += reais[h - 1]!;
      }
      const prQ = montarPrevisaoRef(baseQ, treino, seg.sbc, { ...opMontar, correcaoNivel: false }, null, null);
      const prRef = montarPrevisaoRef(usada, treino, seg.sbc, { ...opMontar, correcaoNivel: false }, calRef, null);
      const prCor = montarPrevisaoRef(usada, treino, seg.sbc, { ...opMontar, correcaoNivel: true }, calCor, null);
      const obsDe = (pr: PrevisaoSerieRef, fb: boolean): ObsRef => ({
        p50s: pr.pontos.map((p) => p.p50),
        mensal: pr.pontos.map((p, j) => (reais[j] === null ? null : { serieId: s.id, origem: mesO, h: j + 1, real: reais[j]!, previsto: p.p50 })),
        lt: realLT === null ? null : { serieId: s.id, origem: mesO, h: hl, real: realLT, previsto: pr.leadTime.p50 },
        intervaloLT: pr.leadTime.p10 === null ? null : { p10: pr.leadTime.p10, p90: pr.leadTime.p90!, fonte: pr.intervalo.fonte ?? 'celula' },
        intervalosMes: pr.pontos.map((p) => (p.p10 === null ? null : { p10: p.p10, p90: p.p90!, fonte: pr.intervalo.fonte ?? 'celula' })),
        fallback: fb,
        qHat: pr.leadTime.qHat,
        ltDias: dias,
      });
      obs['planilha-q'].push(obsDe(prQ, false));
      obs.referencia.push(obsDe(prRef, fallback));
      obs['referencia-corrigida'].push(obsDe(prCor, fallback));
      pares.push({ s: c.s, serieId: s.id, origem: mesO, abc: seg.abc, chaves: chavesSegmentoP1(seg, classeLeadTime(s.meta.leadTimeDias), rotuloFonte[c.s], base.regra as RegraProtecao) });

      // residuos (so o caminho da combinacao; janela realizada com mes mascarado fica fora dos pools)
      if (comb) {
        const escala = mediaValidos(treino.valores, treino.mascara, I.janelaEscala).media;
        for (const [pr, pools] of [[prRef, poolsRef], [prCor, poolsCor]] as const) {
          for (let h = 1; h <= H; h++) {
            if (reais[h - 1] === null) continue;
            if (s.mascara[c.i + h]) {
              if (pr === prRef) excluidosMascara++;
            } else if (escala > 0) {
              pools.pendente({ tipo: 'mensal', celula: seg.sbc, m: h, liberacao: mesDeIndice(k + h), residuo: (reais[h - 1]! - pr.pontos[h - 1].p50) / escala });
            }
          }
        }
        if (realLT !== null) {
          let mascarado = false;
          for (let h = 1; h <= hl; h++) if (s.mascara[c.i + h]) mascarado = true;
          if (mascarado) excluidosMascara++;
          else {
            if (escala > 0) {
              poolsRef.pendente({ tipo: 'lt', celula: seg.sbc, m: hl, liberacao: mesDeIndice(k + hl), residuo: (realLT - prRef.leadTime.p50) / (escala * hl) });
              poolsCor.pendente({ tipo: 'lt', celula: seg.sbc, m: hl, liberacao: mesDeIndice(k + hl), residuo: (realLT - prCor.leadTime.p50) / (escala * hl) });
            }
            // nivel: pool unico, previsao SEM correcao (o fator nao se realimenta)
            const x = { liberacao: mesDeIndice(k + hl), real: realLT, previsto: prRef.leadTime.p50 };
            poolsRef.nivelPendente(x);
            poolsCor.nivelPendente(x);
          }
        }
      }
      if (comb && realLT !== null) {
        fatores.push(prCor.correcao.fator);
        if (prCor.avisosRef.includes('correcao-no-limite')) paresNoLimite++;
        if (prCor.avisosRef.includes('correcao-sem-dados')) paresSemDados++;
      }
    }
  }

  // 5. tabelas (liberar tudo ate o ultimo mes do calendario)
  const tabelaMeta = (correcaoNivel: boolean) => ({
    versao: PREDITIVO_VERSAO,
    hashConfig: hashConfigRef(),
    correcaoNivel,
    parametros: { horizonte: H, minTreino: o.minTreino, historicoMaximo: o.historicoMaximo, usarMascara: o.usarMascara, janelaNivelMeses: nivelCfg.janelaNivelMeses },
    ultimoMes: fim === '' ? '0000-01' : fim,
  });
  if (fim !== '') {
    poolsRef.liberarAte(fim);
    poolsCor.liberarAte(fim);
  }
  const tabelas = { referencia: poolsRef.paraTabela(tabelaMeta(false)), 'referencia-corrigida': poolsCor.paraTabela(tabelaMeta(true)) };

  // 6. amostra comum (lead time observado nas 3 variantes), metades e linhas
  const amostra = pares.map((_, p) => p).filter((p) => obs['planilha-q'][p].lt !== null);
  const mesesAmostra = [...new Set(amostra.map((p) => pares[p].origem))].sort();
  const k1 = Math.floor(mesesAmostra.length / 2);
  const ultimoMes1 = k1 > 0 ? mesesAmostra[k1 - 1] : null;
  const porSegmento = new Map<string, number[]>();
  pares.forEach((p, pi) => {
    for (const chave of p.chaves) {
      const lista = porSegmento.get(chave);
      if (lista) lista.push(pi);
      else porSegmento.set(chave, [pi]);
    }
  });
  const ctx = { pares, razaoFaltaExcesso: o.razaoFaltaExcesso, tetoVies: o.tetoVies, ultimoMes1 };
  const linhas: LinhaRef[] = [];
  for (const chave of ordenarSegmentosP1([...porSegmento.keys()])) {
    for (const v of VARIANTE_IDS) linhas.push(calcularLinhaRef(chave, v, porSegmento.get(chave)!, obs[v], obs['planilha-q'], ctx, H));
  }
  const total = (v: Referencias) => linhas.find((l) => l.segmento === 'TOTAL' && l.variante === v);
  const c7 = (v: Referencias) => {
    const l = total(v);
    return { cobertura: l?.cobertura ?? null, n: l?.nIntervalo ?? 0, passa: l !== undefined && !falhaCriterio7(l.cobertura, l.nIntervalo) };
  };

  // 8. por serie (segmentos e regra no ultimo mes da serie inteira, como a P1a)
  const finais = fim === '' ? new Map<string, Segmento>() : segmentar(series, fim);
  const paresPorSerie = new Map<number, number[]>();
  pares.forEach((p, pi) => {
    const lista = paresPorSerie.get(p.s);
    if (lista) lista.push(pi);
    else paresPorSerie.set(p.s, [pi]);
  });
  const contagem = { series: series.length, comPrevisao: 0, semVenda: 0, historicoCurto: 0 };
  const porSerie: ResumoSerieRef[] = series.map((s, idx) => {
    const meus = paresPorSerie.get(idx) ?? [];
    if (meus.length > 0) contagem.comPrevisao++;
    else contagem.historicoCurto++;
    if (s.valores.length > 0 && s.valores.every((v) => v === 0)) contagem.semVenda++;
    const resumo = (v: VarianteRef) => {
      const erros = meus.map((p) => obs[v][p].lt).filter((e): e is Erro => e !== null);
      let falta = 0;
      let excesso = 0;
      let custo = 0;
      for (const e of erros) {
        const cc = custoNoLeadTime(e.real, e.previsto, o.razaoFaltaExcesso);
        falta += cc.falta;
        excesso += cc.excesso;
        custo += cc.custo;
      }
      return { wapeLT: wape(erros), custoLT: custo, faltaLT: falta, excessoLT: excesso };
    };
    const seg = finais.get(s.id) ?? { abc: 'sem-venda' as Abc, xyz: 'n/a' as Xyz, sbc: 'insuficiente' as Sbc };
    return {
      id: s.id,
      rotuloFonte: rotuloFonte[idx],
      meses: s.valores.length,
      origens: meus.length,
      ...seg,
      classeLt: classeLeadTime(s.meta.leadTimeDias),
      regra: regraProtecao(s, PREDITIVO_CONFIG_REF.protecao),
      variantes: { 'planilha-q': resumo('planilha-q'), referencia: resumo('referencia'), 'referencia-corrigida': resumo('referencia-corrigida') },
    };
  });
  const rotulosPresentes = [...new Set(fontes.values())].filter((r) => r !== 'outras').sort();
  const eixo = (f: (s: ResumoSerieRef) => string) => porSerie.map(f);
  const media = fatores.length === 0 ? null : fatores.reduce((t, x) => t + x, 0) / fatores.length;
  return {
    minTreino: o.minTreino,
    principal,
    origens: porMes.size,
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
    amostra: { pares: amostra.length, fallbackReferencia: amostra.filter((p) => obs.referencia[p].fallback).length, residuosExcluidosMascara: excluidosMascara },
    correcao: {
      fatorMedio: media,
      fatorMin: fatores.length === 0 ? null : Math.min(...fatores),
      fatorMax: fatores.length === 0 ? null : Math.max(...fatores),
      paresNoLimite,
      paresSemDados,
    },
    criterio7: { referencia: c7('referencia'), 'referencia-corrigida': c7('referencia-corrigida') },
    linhas,
    porSerie,
    tabelas,
  };
}

export function rodarBacktestRef(entrada: SerieNormalizada[], o: OpcoesBacktestRef, marcas: ContagemMarcas | null = null): ResultadoBacktestRef {
  const invalidas = validarOpcoesBacktestRef(o);
  if (invalidas.length > 0) throw new Error('opcoes invalidas: ' + invalidas.join('; '));
  const ordenadas = [...entrada].sort(porId);
  const principal = PREDITIVO_CONFIG_P1.criterios.minTreinoPrincipal;
  const cenariosMinTreino = o.minTreino === principal ? [principal] : [principal, o.minTreino];
  const mapa = rotulosFonte(ordenadas);
  const fontes = [...mapa.entries()]
    .map(([fonte, rotulo]) => ({ rotulo, fonte }))
    .sort((a, b) => (a.rotulo < b.rotulo ? -1 : a.rotulo > b.rotulo ? 1 : a.fonte < b.fonte ? -1 : a.fonte > b.fonte ? 1 : 0));
  return {
    versao: PREDITIVO_VERSAO,
    hashConfig: hashConfigRef(),
    hashEntrada: hashCanonico(ordenadas),
    opcoes: { ...o },
    cenariosMinTreino,
    fontes,
    marcas,
    cenarios: cenariosMinTreino.map((mt, k) => rodarCenarioRef(ordenadas, { ...o, minTreino: mt }, k === 0)),
  };
}

// Tabela do cenario do --min-treino pedido (o ultimo), na variante com ou sem correcao de nivel.
export function tabelaDoBacktest(r: ResultadoBacktestRef, correcaoNivel: boolean): TabelaCalibracao {
  return r.cenarios[r.cenarios.length - 1].tabelas[correcaoNivel ? 'referencia-corrigida' : 'referencia'];
}
