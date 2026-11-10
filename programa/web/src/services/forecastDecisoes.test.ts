import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message?: string) {
      super(message ?? `HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));

import { api } from '@/api/client';
import { forecastDecisoesKeys, listForecastDecisoes } from './forecastDecisoes';

const get = vi.mocked(api.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico de decisoes de compra do Forecast', () => {
  it('chave de cache por quinzena', () => {
    expect(forecastDecisoesKeys.lista(7)).toEqual(['forecast', 'decisoes', 7]);
  });

  it('lista por GET /v1/forecast/snapshots/:id/decisoes e desembrulha data.decisoes', async () => {
    get.mockResolvedValue({ data: { snapshotId: 7, label: '10-2', decisoes: [{ productId: 42 }] } });
    await expect(listForecastDecisoes(7)).resolves.toEqual([{ productId: 42 }]);
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/7/decisoes');
  });

  it('resposta sem lista de decisoes vira lista vazia (nao quebra)', async () => {
    get.mockResolvedValue({ quinzena: { id: 7 }, grupos: [] });
    await expect(listForecastDecisoes(7)).resolves.toEqual([]);
    get.mockResolvedValue({ data: { decisoes: 'x' } });
    await expect(listForecastDecisoes(7)).resolves.toEqual([]);
    get.mockResolvedValue(undefined);
    await expect(listForecastDecisoes(7)).resolves.toEqual([]);
  });
});
