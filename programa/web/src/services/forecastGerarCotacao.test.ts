import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn() },
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
  forecastGerarCotacaoErrorMessage,
  forecastGerarCotacaoKeys,
  getCatalogItemParaCotacao,
  listForecastProdutosParaCotacao,
} from './forecastGerarCotacao';

const get = vi.mocked(api.get);

// Dados 100% sinteticos.
beforeEach(() => {
  vi.clearAllMocks();
});

describe('listForecastProdutosParaCotacao', () => {
  it('le GET /v1/forecast/products e ordena os codigos por position', async () => {
    get.mockResolvedValue({
      data: [
        {
          id: 42,
          name: 'PRODUTO 001',
          isActive: true,
          source: { id: 1, name: 'FONTE 001' },
          codes: [
            { id: 3, position: 2, code: 'C0002', catalogItemId: 11, catalogItem: { id: 11, commercialName: 'ITEM B', marketName: 'MB' } },
            { id: 2, position: 1, code: 'C0001', catalogItemId: 10, catalogItem: { id: 10, commercialName: 'ITEM A', marketName: 'MA' } },
          ],
        },
      ],
    });
    const r = await listForecastProdutosParaCotacao();
    expect(get).toHaveBeenCalledWith('/v1/forecast/products');
    expect(r).toEqual([
      {
        id: 42,
        name: 'PRODUTO 001',
        codes: [
          { code: 'C0001', position: 1, catalogItemId: 10, catalogItem: { id: 10, commercialName: 'ITEM A', marketName: 'MA' } },
          { code: 'C0002', position: 2, catalogItemId: 11, catalogItem: { id: 11, commercialName: 'ITEM B', marketName: 'MB' } },
        ],
      },
    ]);
  });

  it('codigo sem catalogo: catalogItem nulo preservado e catalogItemId nulo', async () => {
    get.mockResolvedValue({
      data: [{ id: 42, name: 'PRODUTO 001', codes: [{ position: 1, code: 'C0001', catalogItem: null }] }],
    });
    const r = await listForecastProdutosParaCotacao();
    expect(r[0]!.codes[0]).toEqual({ code: 'C0001', position: 1, catalogItemId: null, catalogItem: null });
  });

  it('resposta sem lista vale lista vazia (GET generico de teste nao quebra)', async () => {
    get.mockResolvedValue({ data: undefined });
    expect(await listForecastProdutosParaCotacao()).toEqual([]);
    get.mockResolvedValue({ data: {} });
    expect(await listForecastProdutosParaCotacao()).toEqual([]);
    get.mockResolvedValue(undefined);
    expect(await listForecastProdutosParaCotacao()).toEqual([]);
  });

  it('produto sem codes vira lista vazia de codigos', async () => {
    get.mockResolvedValue({ data: [{ id: 42, name: 'PRODUTO 001' }] });
    expect(await listForecastProdutosParaCotacao()).toEqual([{ id: 42, name: 'PRODUTO 001', codes: [] }]);
  });
});

describe('getCatalogItemParaCotacao', () => {
  it('le GET /v1/catalog-items/:id (resposta crua, sem envelope)', async () => {
    get.mockResolvedValue({ id: 10, commercialName: 'ITEM A', marketName: 'MA', isActive: false, family: { id: 1, name: 'F' } });
    const r = await getCatalogItemParaCotacao(10);
    expect(get).toHaveBeenCalledWith('/v1/catalog-items/10');
    expect(r).toEqual({ id: 10, commercialName: 'ITEM A', marketName: 'MA', isActive: false });
  });
});

describe('forecastGerarCotacaoKeys', () => {
  it('chaves proprias da feature', () => {
    expect(forecastGerarCotacaoKeys.produtos).toEqual(['forecast', 'gerar-cotacao', 'produtos']);
    expect(forecastGerarCotacaoKeys.catalogo(10)).toEqual(['forecast', 'gerar-cotacao', 'catalogo', 10]);
  });
});

describe('forecastGerarCotacaoErrorMessage', () => {
  it('mensagens por status e sem conexao', () => {
    expect(forecastGerarCotacaoErrorMessage(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastGerarCotacaoErrorMessage(new ApiError(403, null))).toBe('Seu perfil não pode ler o vínculo com o catálogo.');
    expect(forecastGerarCotacaoErrorMessage(new ApiError(404, null))).toBe('Item do catálogo não encontrado.');
    expect(forecastGerarCotacaoErrorMessage(new ApiError(500, null))).toBe(
      'Não foi possível ler o vínculo com o catálogo (HTTP 500).',
    );
    expect(forecastGerarCotacaoErrorMessage(new Error('boom'))).toBe('Sem conexão com o servidor. Tente de novo.');
  });
});
