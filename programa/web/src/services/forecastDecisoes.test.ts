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
  forecastDecisaoErrorMessage,
  forecastDecisoesKeys,
  listForecastDecisoes,
  putForecastDecisao,
} from './forecastDecisoes';

const get = vi.mocked(api.get);
const put = vi.mocked(api.put);

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

  it('grava por PUT /v1/forecast/snapshots/:id/decisoes/:productId com o corpo como esta e desembrulha { data }', async () => {
    put.mockResolvedValue({ data: { acao: 'create', decisao: { productId: 42 } } });
    const body = { quantidadeKg: 1200.5, status: 'cotando' as const, observacao: 'OBS SINTETICA' };
    await expect(putForecastDecisao(7, 42, body)).resolves.toEqual({ acao: 'create', decisao: { productId: 42 } });
    expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/decisoes/42', body);
    put.mockResolvedValue({ data: { acao: 'delete', decisao: null } });
    await putForecastDecisao(7, 42, { quantidadeKg: null });
    expect(put).toHaveBeenLastCalledWith('/v1/forecast/snapshots/7/decisoes/42', { quantidadeKg: null });
  });
});

describe('forecastDecisaoErrorMessage', () => {
  it('mensagens por status', () => {
    expect(forecastDecisaoErrorMessage(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastDecisaoErrorMessage(new ApiError(403, null))).toBe('Seu perfil só pode ler as quantidades decididas.');
    expect(forecastDecisaoErrorMessage(new ApiError(404, null))).toBe('Quinzena não encontrada (pode ter sido excluída).');
    expect(forecastDecisaoErrorMessage(new ApiError(500, null))).toBe(
      'Não foi possível salvar a quantidade decidida (HTTP 500).',
    );
  });

  it('400 e 409 repassam a mensagem do backend; sem mensagem usa o texto padrao', () => {
    expect(forecastDecisaoErrorMessage(new ApiError(400, { message: 'O item não está na lista de compra desta quinzena.' }))).toBe(
      'O item não está na lista de compra desta quinzena.',
    );
    expect(forecastDecisaoErrorMessage(new ApiError(409, { message: 'Gravada por outra pessoa.' }))).toBe(
      'Gravada por outra pessoa.',
    );
    expect(forecastDecisaoErrorMessage(new ApiError(409, null))).toBe('Pedido recusado pelo servidor (HTTP 409).');
  });

  it('erro de rede', () => {
    expect(forecastDecisaoErrorMessage(new Error('x'))).toBe('Sem conexão com o servidor. Tente de novo.');
  });
});
