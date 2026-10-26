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
  forecastEmbalagensErrorMessage,
  forecastEmbalagensKeys,
  getForecastEmbalagens,
  patchForecastEmbalagens,
} from './forecastEmbalagens';

const get = vi.mocked(api.get);
const patch = vi.mocked(api.patch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico de embalagens do Forecast', () => {
  it('le por /v1/forecast/products/:id/embalagens e desembrulha { data }', async () => {
    get.mockResolvedValue({ data: { usadaCodigoId: null, codigos: [] } });
    await expect(getForecastEmbalagens(7)).resolves.toEqual({ usadaCodigoId: null, codigos: [] });
    expect(get).toHaveBeenCalledWith('/v1/forecast/products/7/embalagens');
  });

  it('grava com PATCH repassando o corpo como esta', async () => {
    patch.mockResolvedValue({ data: { usadaCodigoId: 3, codigos: [] } });
    const body = { embalagens: [{ codigoId: 3, quantidadeKg: 22.68, rotulo: 'Saco' }], principalCodigoId: 3 };
    await expect(patchForecastEmbalagens(7, body)).resolves.toEqual({ usadaCodigoId: 3, codigos: [] });
    expect(patch).toHaveBeenCalledWith('/v1/forecast/products/7/embalagens', body);
  });

  it('chaves de cache', () => {
    expect(forecastEmbalagensKeys.todas).toEqual(['forecast', 'embalagens']);
    expect(forecastEmbalagensKeys.produto(7)).toEqual(['forecast', 'embalagens', 7]);
  });

  it('mensagens por status', () => {
    expect(forecastEmbalagensErrorMessage(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastEmbalagensErrorMessage(new ApiError(403, null))).toBe('Seu perfil não pode editar embalagens.');
    expect(forecastEmbalagensErrorMessage(new ApiError(404, null))).toBe(
      'Produto não encontrado no cadastro do Forecast.',
    );
    expect(forecastEmbalagensErrorMessage(new ApiError(500, null))).toBe(
      'Não foi possível carregar as embalagens (HTTP 500).',
    );
    expect(forecastEmbalagensErrorMessage(new Error('rede'))).toBe('Sem conexão com o servidor. Tente de novo.');
  });

  it('400 e 409 repassam a mensagem do backend; sem mensagem, texto padrao', () => {
    expect(
      forecastEmbalagensErrorMessage(new ApiError(400, { message: 'A embalagem principal precisa de quantidade.' })),
    ).toBe('A embalagem principal precisa de quantidade.');
    expect(
      forecastEmbalagensErrorMessage(
        new ApiError(409, { message: 'A embalagem principal foi alterada por outra pessoa. Recarregue e tente de novo.' }),
      ),
    ).toBe('A embalagem principal foi alterada por outra pessoa. Recarregue e tente de novo.');
    expect(forecastEmbalagensErrorMessage(new ApiError(400, null))).toBe('Pedido recusado pelo servidor (HTTP 400).');
  });

  it('503 (cadastro ocupado por importacao) repassa a mensagem do backend', () => {
    expect(
      forecastEmbalagensErrorMessage(
        new ApiError(503, { message: 'O cadastro está ocupado por uma importação. Tente novamente em instantes.' }),
      ),
    ).toBe('O cadastro está ocupado por uma importação. Tente novamente em instantes.');
    expect(forecastEmbalagensErrorMessage(new ApiError(503, null))).toBe('Pedido recusado pelo servidor (HTTP 503).');
  });
});
