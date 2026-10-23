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
import { forecastFontesKeys, listForecastSources, patchForecastSourceLeadTime } from './forecastFontes';
import {
  addForecastProductCode,
  createForecastProduct,
  forecastPendentesErrorMessage,
  forecastPendentesKeys,
  getForecastPendentes,
  listFamiliasAtivas,
  listProdutosAtivos,
} from './forecastPendentes';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico de pendentes de cadastro do Forecast', () => {
  it('le os pendentes da quinzena por /v1/forecast/snapshots/:id/pendentes e desembrulha { data }', async () => {
    const dados = { aplicavel: true, snapshotId: 8, label: '11-1', itens: [], totalItens: 0, omitidos: 0, soSaldo: { codigos: 0, kg: 0 } };
    get.mockResolvedValue({ data: dados });
    await expect(getForecastPendentes(8)).resolves.toEqual(dados);
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/8/pendentes');
  });

  it('cria o produto com POST /v1/forecast/products e o corpo como esta', async () => {
    const body = { nome: 'PRODUTO 901', codigos: ['TST0901'], sourceId: 3, familyId: 4 };
    post.mockResolvedValue({ data: { id: 55, nome: 'PRODUTO 901' } });
    await expect(createForecastProduct(body)).resolves.toEqual({ id: 55, nome: 'PRODUTO 901' });
    expect(post).toHaveBeenCalledWith('/v1/forecast/products', body);
  });

  it('acrescenta o codigo com POST /v1/forecast/products/:id/codigos e devolve a origem', async () => {
    post.mockResolvedValue({ data: { produtoId: 5, produtoOrigem: 'planilha', codigo: { id: 9, posicao: 2, codigo: 'TST0903' } } });
    const r = await addForecastProductCode(5, 'TST0903');
    expect(r.produtoOrigem).toBe('planilha');
    expect(post).toHaveBeenCalledWith('/v1/forecast/products/5/codigos', { codigo: 'TST0903' });
  });

  it('familias: so as ativas, so id e nome', async () => {
    get.mockResolvedValue({
      data: [
        { id: 1, name: 'FAMILIA 1', isActive: true, extra: 'x' },
        { id: 2, name: 'FAMILIA 2', isActive: false },
        { id: 3, name: 'FAMILIA 3' },
      ],
    });
    await expect(listFamiliasAtivas()).resolves.toEqual([
      { id: 1, name: 'FAMILIA 1' },
      { id: 3, name: 'FAMILIA 3' },
    ]);
    expect(get).toHaveBeenCalledWith('/v1/item-families');
  });

  it('produtos: so os ativos', async () => {
    get.mockResolvedValue({
      data: [
        { id: 1, name: 'PRODUTO 001', isActive: true, codes: [] },
        { id: 2, name: 'PRODUTO 002', isActive: false, codes: [] },
      ],
    });
    const produtos = await listProdutosAtivos();
    expect(produtos.map((p) => p.id)).toEqual([1]);
    expect(get).toHaveBeenCalledWith('/v1/forecast/products');
  });

  it('chaves de cache ficam sob ["forecast"] (invalidar o forecast refaz tudo)', () => {
    expect(forecastPendentesKeys.snapshot(8)).toEqual(['forecast', 'pendentes', 8]);
    expect(forecastPendentesKeys.familias.slice(0, 1)).toEqual(['forecast']);
    expect(forecastPendentesKeys.produtos.slice(0, 1)).toEqual(['forecast']);
    expect(forecastFontesKeys.todas).toEqual(['forecast', 'fontes']);
  });

  it('mensagens: 400/409/503 repassam o backend; os demais sao fixos em portugues', () => {
    const corpo = (message: string) => new ApiError(409, { message }, 'x');
    expect(forecastPendentesErrorMessage(corpo('O código TST0901 já pertence ao produto PRODUTO 001.'))).toBe(
      'O código TST0901 já pertence ao produto PRODUTO 001.',
    );
    expect(forecastPendentesErrorMessage(new ApiError(400, { message: 'A fonte escolhida não tem lead time cadastrado.' }))).toBe(
      'A fonte escolhida não tem lead time cadastrado.',
    );
    expect(
      forecastPendentesErrorMessage(
        new ApiError(503, { message: 'O cadastro está ocupado por uma importação. Tente novamente em instantes.' }),
      ),
    ).toBe('O cadastro está ocupado por uma importação. Tente novamente em instantes.');
    expect(forecastPendentesErrorMessage(new ApiError(503, null))).toBe(
      'O cadastro está ocupado por uma importação. Tente novamente em instantes.',
    );
    expect(forecastPendentesErrorMessage(new ApiError(409, null))).toBe('Pedido recusado pelo servidor (HTTP 409).');
    expect(forecastPendentesErrorMessage(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastPendentesErrorMessage(new ApiError(403, null))).toBe(
      'Seu perfil não pode completar o cadastro. Peça a um administrador ou comprador.',
    );
    expect(forecastPendentesErrorMessage(new ApiError(404, null))).toBe(
      'Não encontrado no cadastro do Forecast. Atualize a tela e tente de novo.',
    );
    expect(forecastPendentesErrorMessage(new ApiError(500, null))).toBe('Não foi possível concluir (HTTP 500).');
    expect(forecastPendentesErrorMessage(new Error('rede'))).toBe('Sem conexão com o servidor. Tente de novo.');
  });
});

describe('servico de fontes do Forecast', () => {
  it('lista por /v1/forecast/sources e desembrulha { data }', async () => {
    get.mockResolvedValue({ data: [{ id: 3, name: 'FONTE 001', leadTimeDays: null, clearanceDays: null, isActive: true }] });
    const fontes = await listForecastSources();
    expect(fontes[0]?.leadTimeDays).toBeNull();
    expect(get).toHaveBeenCalledWith('/v1/forecast/sources');
  });

  it('grava so o lead time com PATCH /v1/forecast/sources/:id', async () => {
    patch.mockResolvedValue({ data: { id: 3, name: 'FONTE 001', leadTimeDays: 45, clearanceDays: null, isActive: true } });
    await expect(patchForecastSourceLeadTime(3, 45)).resolves.toMatchObject({ leadTimeDays: 45 });
    expect(patch).toHaveBeenCalledWith('/v1/forecast/sources/3', { leadTimeDays: 45 });
  });
});
