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
  forecastUltimoPrecoErrorMessage,
  forecastUltimoPrecoKeys,
  getForecastUltimoPreco,
} from './forecastUltimoPreco';

const get = vi.mocked(api.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico do ultimo preco negociado do Forecast', () => {
  it('le por /v1/forecast/products/:id/ultimo-preco e desembrulha { data }', async () => {
    const data = { productId: 42, ultimoPreco: null, motivo: 'sem_cotacao_vencedora' };
    get.mockResolvedValue({ data });
    await expect(getForecastUltimoPreco(42)).resolves.toEqual(data);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/v1/forecast/products/42/ultimo-preco');
  });

  it.each([
    ['data ausente', { data: undefined }],
    ['data vazio (sem a chave ultimoPreco)', { data: {} }],
    ['corpo vazio', undefined],
  ])('%s -> erro "Resposta inesperada do servidor."', async (_nome, resposta) => {
    get.mockResolvedValue(resposta);
    await expect(getForecastUltimoPreco(42)).rejects.toThrow('Resposta inesperada do servidor.');
  });

  it('chave por produto', () => {
    expect(forecastUltimoPrecoKeys.produto(42)).toEqual(['forecast', 'ultimo-preco', 42]);
  });

  it.each([
    [401, 'Sua sessão expirou. Entre de novo.'],
    [403, 'Seu perfil não tem acesso aos preços negociados.'],
    [404, 'Produto não encontrado no cadastro do Forecast.'],
    [500, 'Não foi possível buscar o último preço (HTTP 500).'],
    [503, 'Não foi possível buscar o último preço (HTTP 503).'],
  ])('HTTP %s -> mensagem em portugues', (status, mensagem) => {
    expect(forecastUltimoPrecoErrorMessage(new ApiError(status, null))).toBe(mensagem);
  });

  it('erro sem status (rede) -> mensagem de conexao', () => {
    expect(forecastUltimoPrecoErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'Não foi possível buscar o último preço. Verifique a conexão e tente de novo.',
    );
  });
});
