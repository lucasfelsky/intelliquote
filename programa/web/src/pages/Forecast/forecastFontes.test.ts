import { describe, expect, it } from 'vitest';
import type { ForecastPrazoRealEstatistica, ForecastPrazoRealFonte } from '@/services/forecastFontes';
import { diferencaTexto, ordenarFontes, textoIndisponivel, textoPrazoReal } from './forecastFontes';

const est = (media: number, over: Partial<ForecastPrazoRealEstatistica> = {}): ForecastPrazoRealEstatistica => ({
  chegadas: 12,
  media,
  mediana: media + 4,
  min: media - 10,
  max: media + 10,
  poucasChegadas: false,
  ...over,
});

const fonte = (
  nome: string,
  leadTimeDays: number | null,
  po: ForecastPrazoRealEstatistica | null,
  sourceId = 1,
): ForecastPrazoRealFonte => ({
  sourceId,
  nome,
  leadTimeDays,
  clearanceDays: null,
  etdDiasUsado: 35,
  real: { po, etd: null },
});

describe('textoPrazoReal', () => {
  it('formata media, mediana e chegadas', () => {
    expect(textoPrazoReal(est(64))).toBe('64 dias (mediana 68 · 12 chegadas)');
  });

  it('usa o singular com 1 dia e 1 chegada', () => {
    expect(textoPrazoReal(est(1, { mediana: 1, chegadas: 1 }))).toBe('1 dia (mediana 1 · 1 chegada)');
  });

  it('poucas chegadas nao mostra a media', () => {
    expect(textoPrazoReal(est(64, { chegadas: 2, poucasChegadas: true }))).toBe('poucas chegadas (2)');
  });

  it('sem dado -> traco', () => {
    expect(textoPrazoReal(null)).toBe('—');
    expect(textoPrazoReal(undefined)).toBe('—');
  });
});

describe('diferencaTexto', () => {
  it('positivo, negativo e igual', () => {
    expect(diferencaTexto(est(102), 90)).toBe('+12 dias');
    expect(diferencaTexto(est(85), 90)).toBe('−5 dias');
    expect(diferencaTexto(est(90), 90)).toBe('igual');
    expect(diferencaTexto(est(91), 90)).toBe('+1 dia');
  });

  it('sem lead time, sem dado ou poucas chegadas -> traco', () => {
    expect(diferencaTexto(est(102), null)).toBe('—');
    expect(diferencaTexto(null, 90)).toBe('—');
    expect(diferencaTexto(est(102, { chegadas: 2, poucasChegadas: true }), 90)).toBe('—');
  });
});

describe('ordenarFontes', () => {
  it('maior diferenca absoluta primeiro; sem dado no fim; empate por nome', () => {
    const entrada = [
      fonte('SEM DADO', 90, null, 1),
      fonte('PEQUENA', 90, est(92), 2),
      fonte('SEM LEAD', null, est(50), 3),
      fonte('GRANDE NEGATIVA', 90, est(60), 4),
      fonte('B EMPATE', 90, est(100), 5),
      fonte('A EMPATE', 90, est(80), 6),
      fonte('POUCAS', 90, est(10, { chegadas: 1, poucasChegadas: true }), 7),
    ];
    expect(ordenarFontes(entrada).map((f) => f.nome)).toEqual([
      'GRANDE NEGATIVA',
      'A EMPATE',
      'B EMPATE',
      'PEQUENA',
      'POUCAS',
      'SEM DADO',
      'SEM LEAD',
    ]);
  });

  it('nao altera a lista de entrada e aceita real null', () => {
    const entrada: ForecastPrazoRealFonte[] = [{ ...fonte('B', 90, null), real: null }, fonte('A', 90, est(100))];
    expect(ordenarFontes(entrada).map((f) => f.nome)).toEqual(['A', 'B']);
    expect(entrada.map((f) => f.nome)).toEqual(['B', 'A']);
  });
});

describe('textoIndisponivel', () => {
  it('sem quinzena DBCorp', () => {
    expect(textoIndisponivel('sem_quinzena_dbcorp', null)).toBe(
      'Importe uma quinzena pelos relatórios DBCorp para ver o prazo real.',
    );
  });

  it('quinzena importada antes do prazo real', () => {
    expect(textoIndisponivel('quinzena_sem_historico', '11-1')).toBe(
      'A quinzena 11-1 foi importada antes do prazo real existir. Importe a próxima quinzena pelos relatórios DBCorp para ver o prazo real.',
    );
  });
});
