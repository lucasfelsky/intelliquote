import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

import { api } from '@/api/client';
import { forecastFontesKeys, getForecastPrazoReal, type ForecastPrazoReal } from './forecastFontes';

const get = vi.mocked(api.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico de prazo real por fonte (3C)', () => {
  it('le /v1/forecast/sources/prazo-real e desembrulha { data }', async () => {
    const dados: ForecastPrazoReal = {
      quinzena: { id: 3, label: '11-1', baseDate: '2033-11-05' },
      disponivel: true,
      motivo: null,
      janelaDias: 365,
      minChegadas: 3,
      padraoEtdDias: 35,
      fontes: [],
      semFonte: { chegadas: 0 },
    };
    get.mockResolvedValue({ data: dados });
    await expect(getForecastPrazoReal()).resolves.toEqual(dados);
    expect(get).toHaveBeenCalledWith('/v1/forecast/sources/prazo-real');
  });

  it('a chave do prazo real esta sob a chave das fontes (a invalidacao das fontes a atinge)', () => {
    expect(forecastFontesKeys.prazoReal).toEqual(['forecast', 'fontes', 'prazo-real']);
    expect(forecastFontesKeys.prazoReal.slice(0, forecastFontesKeys.todas.length)).toEqual([...forecastFontesKeys.todas]);
  });
});
