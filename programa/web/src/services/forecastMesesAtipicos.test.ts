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
  FORECAST_MESES_ATIPICOS_MOTIVO_MAX,
  FORECAST_MESES_ATIPICOS_MOTIVO_MIN,
  forecastMesesAtipicosErrorMessage,
  putForecastMesesAtipicos,
} from './forecastMesesAtipicos';

const put = vi.mocked(api.put);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico de meses atipicos do Forecast', () => {
  it('grava com PUT em /v1/forecast/products/:id/meses-atipicos (com a janela) e desembrulha { data }', async () => {
    const resposta = { productId: 7, meses: [{ anoMes: '2026-08', motivo: 'MOTIVO SINTETICO' }] };
    put.mockResolvedValue({ data: resposta });
    const body = { meses: [{ anoMes: '2026-08', motivo: 'MOTIVO SINTETICO' }], janela: ['2026-08', '2026-09'] };
    await expect(putForecastMesesAtipicos(7, body)).resolves.toEqual(resposta);
    expect(put).toHaveBeenCalledWith('/v1/forecast/products/7/meses-atipicos', body);
  });

  it('limites do motivo espelham o backend (3 a 300)', () => {
    expect(FORECAST_MESES_ATIPICOS_MOTIVO_MIN).toBe(3);
    expect(FORECAST_MESES_ATIPICOS_MOTIVO_MAX).toBe(300);
  });

  it('mensagens por status; 400 repassa a mensagem do backend', () => {
    expect(forecastMesesAtipicosErrorMessage(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastMesesAtipicosErrorMessage(new ApiError(403, null))).toBe(
      'Seu perfil não pode marcar meses atípicos.',
    );
    expect(forecastMesesAtipicosErrorMessage(new ApiError(404, null))).toBe(
      'Produto não encontrado no cadastro do Forecast.',
    );
    expect(forecastMesesAtipicosErrorMessage(new ApiError(500, null))).toBe(
      'Não foi possível salvar os meses atípicos (HTTP 500).',
    );
    expect(forecastMesesAtipicosErrorMessage(new Error('rede'))).toBe('Sem conexão com o servidor. Tente de novo.');
    expect(
      forecastMesesAtipicosErrorMessage(
        new ApiError(400, { message: 'O mês 2099-01 é futuro: marque só meses que já tiveram venda.' }),
      ),
    ).toBe('O mês 2099-01 é futuro: marque só meses que já tiveram venda.');
    expect(forecastMesesAtipicosErrorMessage(new ApiError(400, null))).toBe('Pedido recusado pelo servidor (HTTP 400).');
  });

  it('409 (corrida) e 503 (cadastro ocupado por importacao) repassam a mensagem do backend', () => {
    expect(
      forecastMesesAtipicosErrorMessage(
        new ApiError(409, {
          message: 'Os meses atípicos deste produto foram alterados por outra pessoa. Recarregue e tente de novo.',
        }),
      ),
    ).toBe('Os meses atípicos deste produto foram alterados por outra pessoa. Recarregue e tente de novo.');
    expect(
      forecastMesesAtipicosErrorMessage(
        new ApiError(503, { message: 'O cadastro está ocupado por uma importação. Tente novamente em instantes.' }),
      ),
    ).toBe('O cadastro está ocupado por uma importação. Tente novamente em instantes.');
    expect(forecastMesesAtipicosErrorMessage(new ApiError(503, null))).toBe('Pedido recusado pelo servidor (HTTP 503).');
  });
});
