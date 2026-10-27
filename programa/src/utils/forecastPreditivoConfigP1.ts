// Forecast preditivo (P1a): config da combinacao, das regras de protecao, dos intervalos e dos criterios novos.
// PREDITIVO_CONFIG (fase 0) NAO muda: o que entra no hashConfig do relatorio P1 e { base, p1 } (hashConfigP1).
// Mudou um valor aqui, sobe a versao (PREDITIVO_VERSAO).
import { PREDITIVO_CONFIG, congelar, hashCanonico } from './forecastPreditivoTipos';
import type { MetodoId } from './forecastPreditivoTipos';

// Metodos que a regra de protecao pode escolher (o composto 'preditivo-p1' fica de fora: evita recursao).
export type MetodoAlvo = MetodoId | 'combinacao-ses-r-holt';

export interface ConfigProtecao {
  janelaDormente: number;
  minimoValidos: number;
  metodoDormente: MetodoAlvo;
  metodoCurto: MetodoAlvo;
  metodoDegrau: MetodoAlvo;
  metodoPadrao: MetodoAlvo;
}

const PROTECAO: ConfigProtecao = {
  janelaDormente: 6,
  minimoValidos: 8,
  metodoDormente: 'planilha-q',
  metodoCurto: 'planilha-q',
  metodoDegrau: 'holt-amortecido',
  metodoPadrao: 'combinacao-ses-r-holt',
};

export const PREDITIVO_CONFIG_P1 = congelar({
  combinacao: {
    componentes: ['ses', 'planilha-r', 'holt-amortecido'] as MetodoId[],
    minimoValidos: 4,
    minimoValidosHolt: 8,
  },
  protecao: PROTECAO,
  intervalo: { q10: 0.1, q90: 0.9, janelaEscala: 12, minResiduos: 30, coberturaMin: 0.72, coberturaMax: 0.88, minPares: 30 },
  criterios: { tetoViesPadrao: 0.1, minTreinoPrincipal: 12 },
  segmentos: { ltAte60: 60, ltAte90: 90, topFontes: 10 },
});

export type RegraProtecao = 'padrao' | 'dormente' | 'curto' | 'degrau';
export const REGRA_IDS: readonly RegraProtecao[] = ['padrao', 'dormente', 'curto', 'degrau'];

export type AvisoP1Id = 'lead-time-truncado';
export const AVISO_P1_IDS: readonly AvisoP1Id[] = ['lead-time-truncado'];

// ASCII de "sem venda >=6 meses" (o console do PowerShell 5.1 corrompe o simbolo).
export const ROTULO_DORMENTE = 'sem venda >=6 meses';

export function hashConfigP1(): string {
  return hashCanonico({ base: PREDITIVO_CONFIG, p1: PREDITIVO_CONFIG_P1 });
}
