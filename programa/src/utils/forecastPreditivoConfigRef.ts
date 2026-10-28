// Forecast preditivo (P1b-1): config da REFERENCIA (combinacao SES + R + Holt amortecido em todos os produtos), variantes do
// backtest, avisos e parametros da correcao de nivel. PREDITIVO_CONFIG e PREDITIVO_CONFIG_P1 NAO mudam: o hashConfig do p0 e
// do p1 fica igual; so o relatorio p1b e a tabela de calibracao usam hashConfigRef(). Mudou um valor aqui, sobe a versao.
import { PREDITIVO_CONFIG_P1 } from './forecastPreditivoConfigP1';
import type { ConfigProtecao } from './forecastPreditivoConfigP1';
import { PREDITIVO_CONFIG, congelar, hashCanonico } from './forecastPreditivoTipos';

export const PREDITIVO_CONFIG_REF = congelar({
  // Minimo de 4 meses validos (SES); 4-7 = SES + R; >= 8 = + Holt amortecido. Abaixo de 4: planilha Q, sem intervalo.
  protecao: {
    janelaDormente: 6,
    minimoValidos: 4,
    metodoDormente: 'planilha-q',
    metodoCurto: 'planilha-q',
    metodoDegrau: 'holt-amortecido',
    metodoPadrao: 'combinacao-ses-r-holt',
  } as ConfigProtecao,
  minimoHolt: 8, // = PREDITIVO_CONFIG_P1.combinacao.minimoValidosHolt (so exposto)
  intervalo: { q10: 0.1, q90: 0.9, janelaEscala: 12, minResiduos: 30 },
  correcaoNivel: { ativaPorPadrao: false, k: 300, fatorMin: 0.85, fatorMax: 1.25, janelaMeses: 12, minPares: 30 },
  calibracao: { formato: 'preditivo-calibracao-v1' as const },
  historicoMaximoLimite: 240, // = LIMITE_PONTOS da entrada
});

export type VarianteRef = 'planilha-q' | 'referencia' | 'referencia-corrigida';
export const VARIANTE_IDS: readonly VarianteRef[] = ['planilha-q', 'referencia', 'referencia-corrigida']; // ordem do relatorio

export type MetodoUsadoRef = 'combinacao-ses-r-holt' | 'holt-amortecido' | 'planilha-q';

export type AvisoRefId =
  | 'historico-curto-planilha'
  | 'dormente-planilha'
  | 'degrau-holt'
  | 'degrau-planilha'
  | 'sem-calibracao'
  | 'calibracao-incompativel'
  | 'sem-intervalo'
  | 'correcao-sem-dados'
  | 'correcao-no-limite'
  | 'lead-time-padrao'
  | 'lead-time-truncado';

export const AVISO_REF_IDS: readonly AvisoRefId[] = [
  'historico-curto-planilha',
  'dormente-planilha',
  'degrau-holt',
  'degrau-planilha',
  'sem-calibracao',
  'calibracao-incompativel',
  'sem-intervalo',
  'correcao-sem-dados',
  'correcao-no-limite',
  'lead-time-padrao',
  'lead-time-truncado',
];

export interface ParametrosCorrecao {
  k: number;
  fatorMin: number;
  fatorMax: number;
  minPares: number;
}

export const PARAMETROS_CORRECAO_PADRAO: ParametrosCorrecao = congelar({
  k: PREDITIVO_CONFIG_REF.correcaoNivel.k,
  fatorMin: PREDITIVO_CONFIG_REF.correcaoNivel.fatorMin,
  fatorMax: PREDITIVO_CONFIG_REF.correcaoNivel.fatorMax,
  minPares: PREDITIVO_CONFIG_REF.correcaoNivel.minPares,
});

// k finito em (0, 1e6]; fatorMin finito em (0, 1]; fatorMax finito em [1, 3]; minPares inteiro >= 1.
export function validarParametrosCorrecao(p: ParametrosCorrecao): string[] {
  const erros: string[] = [];
  if (!(Number.isFinite(p.k) && p.k > 0 && p.k <= 1e6)) erros.push('correcao.k deve estar em (0, 1000000]');
  if (!(Number.isFinite(p.fatorMin) && p.fatorMin > 0 && p.fatorMin <= 1)) erros.push('correcao.fatorMin deve estar em (0, 1]');
  if (!(Number.isFinite(p.fatorMax) && p.fatorMax >= 1 && p.fatorMax <= 3)) erros.push('correcao.fatorMax deve estar em [1, 3]');
  if (!(Number.isInteger(p.minPares) && p.minPares >= 1)) erros.push('correcao.minPares deve ser inteiro >= 1');
  return erros;
}

export function hashConfigRef(): string {
  return hashCanonico({ base: PREDITIVO_CONFIG, p1: PREDITIVO_CONFIG_P1, ref: PREDITIVO_CONFIG_REF });
}
