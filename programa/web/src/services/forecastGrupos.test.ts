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
  createForecastGrupo,
  deleteForecastGrupo,
  filtrarProdutosParaGrupo,
  forecastGrupoErrorMessage,
  listForecastGrupos,
  listForecastProdutosParaGrupo,
  patchForecastGrupo,
  validarGrupo,
  type ForecastProdutoParaGrupo,
} from './forecastGrupos';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.del);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico de grupos de equivalencia do Forecast', () => {
  it('lista por GET /v1/forecast/equivalence-groups e desembrulha { data }', async () => {
    get.mockResolvedValue({ data: [{ id: 1 }] });
    await expect(listForecastGrupos()).resolves.toEqual([{ id: 1 }]);
    expect(get).toHaveBeenCalledWith('/v1/forecast/equivalence-groups');
  });

  it('cria por POST, edita por PATCH e desfaz por DELETE', async () => {
    post.mockResolvedValue({ data: { id: 7 } });
    const body = { nome: 'GRUPO SINTETICO', produtoIds: [1, 2], principalProdutoId: 1, observacao: null };
    await expect(createForecastGrupo(body)).resolves.toEqual({ id: 7 });
    expect(post).toHaveBeenCalledWith('/v1/forecast/equivalence-groups', body);

    patch.mockResolvedValue({ data: { id: 7 } });
    await patchForecastGrupo(7, { principalProdutoId: null });
    expect(patch).toHaveBeenCalledWith('/v1/forecast/equivalence-groups/7', { principalProdutoId: null });

    del.mockResolvedValue({ data: { id: 7 } });
    await expect(deleteForecastGrupo(7)).resolves.toEqual({ id: 7 });
    expect(del).toHaveBeenCalledWith('/v1/forecast/equivalence-groups/7');
  });

  it('lista os produtos do cadastro so com os campos usados; backend antigo (sem grupo) vira avulso', async () => {
    get.mockResolvedValue({
      data: [
        {
          id: 5,
          name: 'PRODUTO 001',
          isActive: true,
          source: { id: 2, name: 'FONTE 001', leadTimeDays: 60 },
          codes: [{ id: 1, position: 1, code: 'C0001', catalogItemId: null }],
          equivalenceGroupId: 3,
        },
        { id: 6, name: 'PRODUTO 002', isActive: false, source: null },
      ],
    });
    await expect(listForecastProdutosParaGrupo()).resolves.toEqual([
      { id: 5, name: 'PRODUTO 001', isActive: true, source: { name: 'FONTE 001' }, codes: [{ code: 'C0001' }], equivalenceGroupId: 3 },
      { id: 6, name: 'PRODUTO 002', isActive: false, source: null, codes: [], equivalenceGroupId: null },
    ]);
    expect(get).toHaveBeenCalledWith('/v1/forecast/products');
  });
});

describe('filtrarProdutosParaGrupo', () => {
  const produto = (id: number, nome: string, over: Partial<ForecastProdutoParaGrupo> = {}): ForecastProdutoParaGrupo => ({
    id,
    name: nome,
    isActive: true,
    source: { name: 'FONTE 001' },
    codes: [{ code: `C000${id}` }],
    equivalenceGroupId: null,
    ...over,
  });
  const lista = [
    produto(1, 'PRODUTO ÁCIDO 001'),
    produto(2, 'PRODUTO 002', { isActive: false }),
    produto(3, 'PRODUTO 003', { equivalenceGroupId: 9 }),
    produto(4, 'PRODUTO 004', { equivalenceGroupId: 5 }),
  ];

  it('so ativos e livres; sem busca, todos os candidatos', () => {
    expect(filtrarProdutosParaGrupo(lista, '').map((p) => p.id)).toEqual([1]);
  });

  it('o grupo em edicao continua dono dos seus membros (aparecem como candidatos)', () => {
    expect(filtrarProdutosParaGrupo(lista, '', 5).map((p) => p.id)).toEqual([1, 4]);
  });

  it('busca por nome (sem acento, sem diferenciar caixa) ou por codigo', () => {
    expect(filtrarProdutosParaGrupo(lista, 'acido').map((p) => p.id)).toEqual([1]);
    expect(filtrarProdutosParaGrupo(lista, 'c0004', 5).map((p) => p.id)).toEqual([4]);
    expect(filtrarProdutosParaGrupo(lista, 'inexistente')).toEqual([]);
  });
});

describe('validarGrupo (espelha o Zod do backend)', () => {
  const ok = { nome: ' GRUPO SINTETICO ', observacao: '  ', produtoIds: [1, 2], principalProdutoId: 1 };

  it('aceita e normaliza (nome aparado, observacao vazia vira null)', () => {
    expect(validarGrupo(ok)).toEqual({
      erros: {},
      valores: { nome: 'GRUPO SINTETICO', observacao: null, produtoIds: [1, 2], principalProdutoId: 1 },
    });
  });

  it('mensagens em portugues por campo', () => {
    expect(validarGrupo({ ...ok, nome: '  ' }).erros.nome).toBe('Informe o nome do grupo.');
    expect(validarGrupo({ ...ok, nome: 'A'.repeat(121) }).erros.nome).toBe('O nome do grupo aceita no máximo 120 caracteres.');
    expect(validarGrupo({ ...ok, observacao: 'A'.repeat(301) }).erros.observacao).toBe(
      'A observação aceita no máximo 300 caracteres.',
    );
    expect(validarGrupo({ ...ok, produtoIds: [1] }).erros.produtos).toBe('Escolha ao menos 2 produtos para formar um grupo.');
    expect(validarGrupo({ ...ok, produtoIds: Array.from({ length: 21 }, (_, i) => i + 1) }).erros.produtos).toBe(
      'Um grupo aceita no máximo 20 produtos.',
    );
    expect(validarGrupo({ ...ok, principalProdutoId: 9 }).erros.principal).toBe(
      'O produto principal precisa ser um dos produtos do grupo.',
    );
    expect(validarGrupo({ ...ok, principalProdutoId: 9 }).valores).toBeNull();
  });

  it('principal e opcional (null = automatico)', () => {
    expect(validarGrupo({ ...ok, principalProdutoId: null }).valores?.principalProdutoId).toBeNull();
  });
});

describe('forecastGrupoErrorMessage', () => {
  it('traduz por status e repassa a mensagem do backend em 400 e 409', () => {
    expect(forecastGrupoErrorMessage(new ApiError(401, {}))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastGrupoErrorMessage(new ApiError(403, {}))).toContain('não pode criar nem alterar grupos');
    expect(forecastGrupoErrorMessage(new ApiError(404, {}))).toContain('Grupo não encontrado');
    expect(
      forecastGrupoErrorMessage(new ApiError(409, { message: 'O produto PRODUTO 002 já está no grupo OUTRO.' }, 'O produto PRODUTO 002 já está no grupo OUTRO.')),
    ).toBe('O produto PRODUTO 002 já está no grupo OUTRO.');
    expect(forecastGrupoErrorMessage(new ApiError(400, {}))).toBe('Pedido recusado pelo servidor (HTTP 400).');
    expect(forecastGrupoErrorMessage(new ApiError(500, {}))).toBe(
      'Não foi possível salvar o grupo de equivalência (HTTP 500).',
    );
    expect(forecastGrupoErrorMessage(new Error('x'))).toBe('Sem conexão com o servidor. Tente de novo.');
  });
});
