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

import { api, ApiError } from '@/api/client';
import {
  deleteVinculoCotacao,
  forecastVincularCotacaoKeys,
  forecastVinculoErrorMessage,
  getCotacoesAbertasParaVinculo,
  putVinculoCotacao,
} from './forecastVincularCotacao';

const get = vi.mocked(api.get);
const put = vi.mocked(api.put);
const del = vi.mocked(api.del);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico de vinculo de cotacao do Forecast', () => {
  it('chave de cache por quinzena e produto', () => {
    expect(forecastVincularCotacaoKeys.abertas(7, 42)).toEqual(['forecast', 'vincular-cotacao', 7, 42]);
  });

  it('lista por GET /v1/forecast/snapshots/:id/cotacoes-abertas/:productId e desembrulha { data }', async () => {
    const data = { snapshotId: 7, productId: 42, cotacoes: [] };
    get.mockResolvedValue({ data });
    await expect(getCotacoesAbertasParaVinculo(7, 42)).resolves.toEqual(data);
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/7/cotacoes-abertas/42');
  });

  it('vincula por PUT /v1/forecast/snapshots/:id/vinculo-cotacao/:productId com o corpo como esta', async () => {
    const data = { acao: 'vincular', quoteRequestId: 90 };
    put.mockResolvedValue({ data });
    await expect(putVinculoCotacao(7, 42, { quoteRequestId: 90 })).resolves.toEqual(data);
    expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/vinculo-cotacao/42', { quoteRequestId: 90 });
    await putVinculoCotacao(7, 42, { quoteRequestId: 91, substituir: true });
    expect(put).toHaveBeenLastCalledWith('/v1/forecast/snapshots/7/vinculo-cotacao/42', {
      quoteRequestId: 91,
      substituir: true,
    });
  });

  it('desvincula por DELETE /v1/forecast/snapshots/:id/vinculo-cotacao/:productId', async () => {
    const data = { acao: 'desvincular', decisao: null };
    del.mockResolvedValue({ data });
    await expect(deleteVinculoCotacao(7, 42)).resolves.toEqual(data);
    expect(del).toHaveBeenCalledWith('/v1/forecast/snapshots/7/vinculo-cotacao/42');
  });
});

describe('forecastVinculoErrorMessage', () => {
  it('403 tem mensagem propria', () => {
    expect(forecastVinculoErrorMessage(new ApiError(403, null))).toBe('Você não tem permissão para vincular cotações.');
  });

  it.each([400, 404, 409])('%i repassa a mensagem do backend', (status) => {
    expect(forecastVinculoErrorMessage(new ApiError(status, { message: 'Mensagem do servidor.' }))).toBe(
      'Mensagem do servidor.',
    );
  });

  it('demais erros e erro de rede usam o texto padrao', () => {
    const padrao = 'Não foi possível vincular a cotação. Tente novamente.';
    expect(forecastVinculoErrorMessage(new ApiError(500, null))).toBe(padrao);
    expect(forecastVinculoErrorMessage(new ApiError(409, null))).toBe(padrao);
    expect(forecastVinculoErrorMessage(new Error('x'))).toBe(padrao);
  });
});
