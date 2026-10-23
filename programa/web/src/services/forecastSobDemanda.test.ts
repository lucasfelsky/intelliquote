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
import { forecastSobDemandaErrorMessage, patchForecastSobDemanda } from './forecastSobDemanda';

const patch = vi.mocked(api.patch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico de compra sob demanda do Forecast', () => {
  it('grava com PATCH em /v1/forecast/products/:id/compra-sob-demanda e desembrulha { data }', async () => {
    patch.mockResolvedValue({ data: { productId: 7, sobDemanda: true, motivo: 'MOTIVO SINTETICO' } });
    const body = { sobDemanda: true, motivo: 'MOTIVO SINTETICO' };
    await expect(patchForecastSobDemanda(7, body)).resolves.toEqual({
      productId: 7,
      sobDemanda: true,
      motivo: 'MOTIVO SINTETICO',
    });
    expect(patch).toHaveBeenCalledWith('/v1/forecast/products/7/compra-sob-demanda', body);
  });

  it('mensagens por status; 400 repassa a mensagem do backend', () => {
    expect(forecastSobDemandaErrorMessage(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastSobDemandaErrorMessage(new ApiError(403, null))).toBe(
      'Seu perfil não pode marcar compra sob demanda.',
    );
    expect(forecastSobDemandaErrorMessage(new ApiError(404, null))).toBe(
      'Produto não encontrado no cadastro do Forecast.',
    );
    expect(forecastSobDemandaErrorMessage(new ApiError(500, null))).toBe(
      'Não foi possível salvar a compra sob demanda (HTTP 500).',
    );
    expect(forecastSobDemandaErrorMessage(new Error('rede'))).toBe('Sem conexão com o servidor. Tente de novo.');
    expect(
      forecastSobDemandaErrorMessage(new ApiError(400, { message: 'O motivo precisa ter ao menos 3 caracteres.' })),
    ).toBe('O motivo precisa ter ao menos 3 caracteres.');
    expect(forecastSobDemandaErrorMessage(new ApiError(400, null))).toBe('Pedido recusado pelo servidor (HTTP 400).');
  });
});
