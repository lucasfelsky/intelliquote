import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
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
import { forecastErrorMessage, forecastKeys, getForecastSnapshot, listForecastSnapshots } from './forecast';

const get = vi.mocked(api.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico do Forecast', () => {
  it('lista as quinzenas por /v1/forecast/snapshots e desembrulha { data }', async () => {
    get.mockResolvedValue({ data: [{ id: 1, label: '10-2' }] });
    await expect(listForecastSnapshots()).resolves.toEqual([{ id: 1, label: '10-2' }]);
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots');
  });

  it('pede o detalhe por id', async () => {
    get.mockResolvedValue({ data: { id: 7, linhas: [] } });
    await expect(getForecastSnapshot(7)).resolves.toEqual({ id: 7, linhas: [] });
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/7');
  });

  it('chaves de cache', () => {
    expect(forecastKeys.snapshots).toEqual(['forecast', 'snapshots']);
    expect(forecastKeys.snapshot(7)).toEqual(['forecast', 'snapshot', 7]);
  });
});

describe('forecastErrorMessage', () => {
  it('401, 403 e 404 tem texto proprio', () => {
    expect(forecastErrorMessage(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastErrorMessage(new ApiError(403, null))).toBe('Seu perfil não tem acesso ao Forecast.');
    expect(forecastErrorMessage(new ApiError(404, null))).toBe('Quinzena não encontrada (pode ter sido removida).');
  });

  it.each([400, 409, 413])('%s repassa a mensagem do backend', (status) => {
    expect(forecastErrorMessage(new ApiError(status, { message: 'Mensagem do servidor.' }))).toBe('Mensagem do servidor.');
  });

  it('400/409/413 sem mensagem usam o texto de recusa', () => {
    expect(forecastErrorMessage(new ApiError(409, null))).toBe('Pedido recusado pelo servidor (HTTP 409).');
  });

  it('outros status e erro de rede', () => {
    expect(forecastErrorMessage(new ApiError(500, { message: 'detalhe interno' }))).toBe(
      'Não foi possível carregar o Forecast (HTTP 500).',
    );
    expect(forecastErrorMessage(new TypeError('Failed to fetch'))).toBe('Sem conexão com o servidor. Tente de novo.');
  });
});
