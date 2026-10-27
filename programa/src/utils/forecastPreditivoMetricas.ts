// Forecast preditivo (fase 0): metricas de erro. WAPE (robusto a zeros), viés (positivo = excesso), MAE, custo de negocio
// no lead time (falta pesa `razao` vezes o excesso) e cobertura de intervalo (implementada; sem intervalo na fase 0).
import type { AnoMes } from './forecastPreditivoTipos';

export interface Erro {
  serieId: string;
  origem: AnoMes;
  h: number;
  real: number;
  previsto: number;
}

const somaReal = (e: Erro[]) => e.reduce((t, x) => t + x.real, 0);

// Σ|real - previsto| / Σreal; null se vazio ou Σreal = 0.
export function wape(e: Erro[]): number | null {
  const base = somaReal(e);
  if (e.length === 0 || base === 0) return null;
  return e.reduce((t, x) => t + Math.abs(x.real - x.previsto), 0) / base;
}

// Σ(previsto - real) / Σreal; null se vazio ou Σreal = 0. Positivo = excesso, negativo = falta.
export function vies(e: Erro[]): number | null {
  const base = somaReal(e);
  if (e.length === 0 || base === 0) return null;
  return e.reduce((t, x) => t + (x.previsto - x.real), 0) / base;
}

// Media de |erro|; null se vazio.
export function mae(e: Erro[]): number | null {
  if (e.length === 0) return null;
  return e.reduce((t, x) => t + Math.abs(x.real - x.previsto), 0) / e.length;
}

export function custoNoLeadTime(
  real: number,
  previsto: number,
  razaoFaltaExcesso: number,
): { excesso: number; falta: number; custo: number } {
  const falta = Math.max(real - previsto, 0);
  const excesso = Math.max(previsto - real, 0);
  return { excesso, falta, custo: falta * razaoFaltaExcesso + excesso };
}

// Fracao dos realizados dentro de [p10, p90]; null se vazio.
export function cobertura(pares: { real: number; p10: number; p90: number }[]): number | null {
  if (pares.length === 0) return null;
  return pares.filter((p) => p.p10 <= p.real && p.real <= p.p90).length / pares.length;
}

// Meses cobertos pelo lead time + 1, limitado ao horizonte: min(H, max(1, ceil(LT / 30)) + 1).
export function horizonteLeadTime(leadTimeDias: number, horizonte: number): number {
  return Math.min(horizonte, Math.max(1, Math.ceil(leadTimeDias / 30)) + 1);
}
