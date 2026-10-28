// Forecast preditivo (P1b-1): previsao de REFERENCIA por produto = combinacao SES + R + Holt amortecido em todos os produtos,
// com regra de protecao propria (minimo 4 meses validos; abaixo disso, planilha Q com aviso e SEM intervalo). p50/p10/p90 por
// mes (h = 1..H) e na soma do lead time. Intervalos so da combinacao e so com tabela de calibracao compativel. Funcao PURA.
import { mediaValidos } from './forecastPreditivoBaselines';
import { calibradorDaTabela, compatibilidadeTabela, fatorCorrecao } from './forecastPreditivoCalibracao';
import type { Calibrador, TabelaCalibracao } from './forecastPreditivoCalibracao';
import type { RegraProtecao } from './forecastPreditivoConfigP1';
import {
  AVISO_REF_IDS,
  PARAMETROS_CORRECAO_PADRAO,
  PREDITIVO_CONFIG_REF,
  hashConfigRef,
  validarParametrosCorrecao,
} from './forecastPreditivoConfigRef';
import type { AvisoRefId, MetodoUsadoRef, ParametrosCorrecao } from './forecastPreditivoConfigRef';
import { prepararSeriesRef } from './forecastPreditivoMarcas';
import type { ContagemMarcas, MarcasPorSerie } from './forecastPreditivoMarcas';
import { combinacaoSesRHolt, regraProtecao } from './forecastPreditivoMetodosP1';
import { METODOS } from './forecastPreditivoMetodos';
import { horizonteLeadTime } from './forecastPreditivoMetricas';
import { segmentar } from './forecastPreditivoSegmentos';
import type { Sbc } from './forecastPreditivoSegmentos';
import { leadTimeTruncado } from './forecastPreditivoSegmentosP1';
import { somarMeses, ultimoMes } from './forecastPreditivoSerie';
import { PREDITIVO_CONFIG as C, PREDITIVO_VERSAO, hashCanonico } from './forecastPreditivoTipos';
import type { AnoMes, AvisoId, ResultadoPrevisao, SerieEntrada, SerieNormalizada } from './forecastPreditivoTipos';

export interface OpcoesReferencia {
  horizonte: number;
  leadTimePadraoDias: number;
  usarMascara: boolean;
  calibracao: TabelaCalibracao | null;
  correcaoNivel: boolean;
  parametrosCorrecao: ParametrosCorrecao;
}

export const OPCOES_REFERENCIA_PADRAO: OpcoesReferencia = {
  horizonte: C.horizontePadrao,
  leadTimePadraoDias: C.leadTimePadraoDias,
  usarMascara: true,
  calibracao: null,
  correcaoNivel: PREDITIVO_CONFIG_REF.correcaoNivel.ativaPorPadrao,
  parametrosCorrecao: PARAMETROS_CORRECAO_PADRAO,
};

export function validarOpcoesReferencia(o: OpcoesReferencia): string[] {
  const erros: string[] = [];
  if (!Number.isInteger(o.horizonte) || o.horizonte < 1 || o.horizonte > C.horizonteMax) erros.push('horizonte deve ser inteiro de 1 a 12');
  if (!Number.isFinite(o.leadTimePadraoDias) || o.leadTimePadraoDias < 0 || o.leadTimePadraoDias > 3650) erros.push('leadTimePadraoDias deve estar entre 0 e 3650');
  erros.push(...validarParametrosCorrecao(o.parametrosCorrecao));
  return erros;
}

export interface BaseRef {
  regra: RegraProtecao | 'sem-dados';
  metodoUsado: MetodoUsadoRef | null;
  componentes: number;
  p50s: number[];
  parametros: Record<string, number>;
  avisos: AvisoId[];
  avisosRef: AvisoRefId[];
}

// Unico caminho do calculo (o backtest chama a MESMA funcao, sobre o treino cortado/truncado na origem).
export function previsaoBaseRef(s: SerieNormalizada, horizonte: number): BaseRef {
  if (s.valores.length === 0) return { regra: 'sem-dados', metodoUsado: null, componentes: 0, p50s: [], parametros: {}, avisos: [], avisosRef: [] };
  const cfg = PREDITIVO_CONFIG_REF.protecao;
  const regra = regraProtecao(s, cfg); // olha so a serie recebida, nunca s.avisos
  const o = { horizonte };
  const avisosRef: AvisoRefId[] = [];
  let r: ResultadoPrevisao;
  let metodoUsado: MetodoUsadoRef;
  if (regra === 'padrao') {
    r = combinacaoSesRHolt(s, o);
    metodoUsado = 'combinacao-ses-r-holt';
  } else if (regra === 'degrau') {
    r = METODOS['holt-amortecido'](s, o);
    metodoUsado = 'holt-amortecido';
    if (r.ok) avisosRef.push('degrau-holt');
  } else {
    r = METODOS['planilha-q'](s, o);
    metodoUsado = 'planilha-q';
    avisosRef.push(regra === 'dormente' ? 'dormente-planilha' : 'historico-curto-planilha');
  }
  if (!r.ok) {
    // alvo sem previsao -> planilha Q; se ela tambem falhar (todos os meses mascarados), a serie fica sem previsao
    avisosRef.length = 0;
    if (regra === 'degrau') avisosRef.push('degrau-planilha');
    else if (regra === 'dormente') avisosRef.push('dormente-planilha');
    else avisosRef.push('historico-curto-planilha');
    r = METODOS['planilha-q'](s, o);
    metodoUsado = 'planilha-q';
    if (!r.ok) return { regra, metodoUsado: null, componentes: 0, p50s: [], parametros: {}, avisos: [], avisosRef: ['historico-curto-planilha'] };
  }
  const componentes = metodoUsado === 'combinacao-ses-r-holt' ? r.parametros.componentes ?? 1 : 1;
  return { regra, metodoUsado, componentes, p50s: r.pontos.map((p) => p.p50), parametros: r.parametros, avisos: r.avisos, avisosRef };
}

export interface PontoReferencia {
  h: number;
  anoMes: AnoMes;
  p50: number;
  p10: number | null;
  p90: number | null;
}

export interface PrevisaoSerieRef {
  id: string;
  ok: boolean;
  regra: RegraProtecao | 'sem-dados';
  metodoUsado: MetodoUsadoRef | null;
  componentes: number;
  origem: AnoMes | null;
  pontos: PontoReferencia[];
  leadTime: { dias: number; padrao: boolean; meses: number; truncado: boolean; p50: number; p10: number | null; p90: number | null; qHat: number };
  historico: { meses: number; validos: number; mascarados: number; minimoExigido: number; minimoHolt: number };
  correcao: { aplicada: boolean; fator: number };
  intervalo: { celula: Sbc; fonte: 'celula' | 'total' | null };
  parametros: Record<string, number>;
  avisos: AvisoId[];
  avisosRef: AvisoRefId[];
}

type OpcoesMontar = Pick<OpcoesReferencia, 'horizonte' | 'leadTimePadraoDias' | 'correcaoNivel' | 'parametrosCorrecao'>;

const soma = (xs: number[], ate: number): number => {
  let t = 0;
  for (let i = 0; i < ate && i < xs.length; i++) t += xs[i];
  return t;
};

// Barata (aplicada 2x por par no backtest): correcao de nivel, p50, lead time e intervalos sobre a base.
export function montarPrevisaoRef(
  base: BaseRef,
  s: SerieNormalizada,
  celula: Sbc,
  o: OpcoesMontar,
  cal: Calibrador | null,
  avisoCalibracao: AvisoRefId | null,
): PrevisaoSerieRef {
  const H = o.horizonte;
  const avisos = new Set<AvisoRefId>(base.avisosRef);
  const comb = base.metodoUsado === 'combinacao-ses-r-holt';
  // (a) correcao de nivel: so a combinacao (Q e Holt de degrau nunca sao corrigidos)
  let fator = 1;
  let aplicada = false;
  if (o.correcaoNivel && comb) {
    if (cal === null) avisos.add('correcao-sem-dados');
    else {
      const nv = cal.nivel();
      const f = fatorCorrecao(nv.razao, nv.n, o.parametrosCorrecao);
      fator = f.fator;
      aplicada = f.aplicado;
      if (!f.aplicado) avisos.add('correcao-sem-dados');
      if (f.noLimite) avisos.add('correcao-no-limite');
    }
  }
  // (b) p50 por mes
  const p50s = base.p50s.map((v) => v * fator);
  // (c) lead time
  const dias = s.meta.leadTimeDias ?? o.leadTimePadraoDias;
  const padrao = s.meta.leadTimeDias === null;
  if (padrao) avisos.add('lead-time-padrao');
  const meses = horizonteLeadTime(dias, H);
  const truncado = leadTimeTruncado(dias, H);
  if (truncado) avisos.add('lead-time-truncado');
  const mq = Math.min(H, Math.max(1, Math.ceil(dias / 30)));
  const temPrevisao = p50s.length > 0;
  const qHat = temPrevisao ? soma(p50s, mq) / mq : 0;
  const p50LT = soma(p50s, meses);
  // (d) intervalos: so combinacao + tabela
  const p10s: (number | null)[] = p50s.map(() => null);
  const p90s: (number | null)[] = p50s.map(() => null);
  let p10LT: number | null = null;
  let p90LT: number | null = null;
  let fonte: 'celula' | 'total' | null = null;
  if (comb && cal !== null) {
    const escala = mediaValidos(s.valores, s.mascara, PREDITIVO_CONFIG_REF.intervalo.janelaEscala).media;
    if (!(escala > 0)) avisos.add('sem-intervalo');
    else {
      p50s.forEach((p50, i) => {
        const q = cal.intervalo('mensal', celula, i + 1);
        if (q === null) {
          avisos.add('sem-intervalo');
          return;
        }
        p10s[i] = Math.max(0, p50 + q.q10 * escala);
        p90s[i] = Math.max(0, p50 + q.q90 * escala);
      });
      const q = cal.intervalo('lt', celula, meses);
      if (q === null) avisos.add('sem-intervalo');
      else {
        p10LT = Math.max(0, p50LT + q.q10 * (escala * meses));
        p90LT = Math.max(0, p50LT + q.q90 * (escala * meses));
        fonte = q.fonte;
      }
    }
  } else if (comb) {
    avisos.add('sem-intervalo');
    avisos.add(avisoCalibracao ?? 'sem-calibracao');
  } else avisos.add('sem-intervalo');

  const origem = s.valores.length === 0 ? null : ultimoMes(s);
  const validos = s.mascara.filter((m) => !m).length;
  return {
    id: s.id,
    ok: temPrevisao,
    regra: base.regra,
    metodoUsado: base.metodoUsado,
    componentes: base.componentes,
    origem,
    pontos: p50s.map((p50, i) => ({ h: i + 1, anoMes: somarMeses(origem!, i + 1), p50, p10: p10s[i], p90: p90s[i] })),
    leadTime: { dias, padrao, meses, truncado, p50: p50LT, p10: p10LT, p90: p90LT, qHat },
    historico: {
      meses: s.valores.length,
      validos,
      mascarados: s.valores.length - validos,
      minimoExigido: PREDITIVO_CONFIG_REF.protecao.minimoValidos,
      minimoHolt: PREDITIVO_CONFIG_REF.minimoHolt,
    },
    correcao: { aplicada, fator },
    intervalo: { celula, fonte },
    parametros: base.parametros,
    avisos: base.avisos,
    avisosRef: AVISO_REF_IDS.filter((a) => avisos.has(a)),
  };
}

export interface ResultadoReferencia {
  versao: string;
  hashConfig: string;
  hashCalibracao: string | null;
  calibracao: 'nenhuma' | 'aplicada' | 'incompativel';
  opcoes: Omit<OpcoesReferencia, 'calibracao'>;
  contagem: {
    series: number;
    comPrevisao: number;
    comIntervalo: number;
    porRegra: Record<string, number>;
    porMetodo: Record<string, number>;
    marcas: ContagemMarcas;
    rupturaIgnorada: number;
  };
  erros: number;
  series: PrevisaoSerieRef[]; // ordenadas por id
}

const REGRAS_E_SEM_DADOS: readonly string[] = [...['padrao', 'dormente', 'curto', 'degrau'], 'sem-dados'];
const METODOS_USADOS: readonly string[] = ['combinacao-ses-r-holt', 'holt-amortecido', 'planilha-q', 'nenhum'];

export function preverReferencia(entradas: readonly SerieEntrada[], marcas: MarcasPorSerie, opcoes: Partial<OpcoesReferencia> = {}): ResultadoReferencia {
  const o: OpcoesReferencia = { ...OPCOES_REFERENCIA_PADRAO, ...opcoes };
  const invalidas = validarOpcoesReferencia(o);
  if (invalidas.length > 0) throw new Error('opcoes invalidas: ' + invalidas.join('; '));
  const prep = prepararSeriesRef(entradas, marcas, o.usarMascara);
  const incompativel = o.calibracao !== null && compatibilidadeTabela(o.calibracao, o.correcaoNivel) !== null;
  const cal = o.calibracao !== null && !incompativel ? calibradorDaTabela(o.calibracao) : null;
  const avisoCalibracao: AvisoRefId | null = incompativel ? 'calibracao-incompativel' : null;
  const fim = prep.series.map(ultimoMes).sort().pop() ?? '';
  const segmentos = fim === '' ? new Map<string, { sbc: Sbc }>() : segmentar(prep.series, fim);
  const series = prep.series.map((s) =>
    montarPrevisaoRef(previsaoBaseRef(s, o.horizonte), s, segmentos.get(s.id)?.sbc ?? 'insuficiente', o, cal, avisoCalibracao),
  );
  const contar = (chaves: readonly string[], valores: string[]) => Object.fromEntries(chaves.map((c) => [c, valores.filter((v) => v === c).length]));
  const { calibracao: _tabela, ...opcoesSaida } = o;
  void _tabela;
  return {
    versao: PREDITIVO_VERSAO,
    hashConfig: hashConfigRef(),
    hashCalibracao: o.calibracao === null ? null : hashCanonico(o.calibracao),
    calibracao: o.calibracao === null ? 'nenhuma' : incompativel ? 'incompativel' : 'aplicada',
    opcoes: opcoesSaida,
    contagem: {
      series: series.length,
      comPrevisao: series.filter((x) => x.ok).length,
      comIntervalo: series.filter((x) => x.leadTime.p10 !== null).length,
      porRegra: contar(REGRAS_E_SEM_DADOS, series.map((x) => x.regra)),
      porMetodo: contar(METODOS_USADOS, series.map((x) => x.metodoUsado ?? 'nenhum')),
      marcas: prep.marcas,
      rupturaIgnorada: prep.rupturaIgnorada,
    },
    erros: prep.erros.length,
    series,
  };
}
