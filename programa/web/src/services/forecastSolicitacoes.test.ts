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
  forecastSolicitacoesErrorMessage,
  listSolicitacoesParaDemanda,
  SOLICITACOES_PAGE_SIZE,
} from './forecastSolicitacoes';

const get = vi.mocked(api.get);

// Dados 100% sinteticos.
const pagina = (ids: number[], totalItems: number) => ({
  data: ids.map((id) => ({ id })),
  pagination: { page: 1, pageSize: 100, totalItems, totalPages: 1 },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico de Solicitacoes para a demanda do comercial', () => {
  it('S1: duas chamadas, uma por status, com page 1 e pageSize 100', async () => {
    get.mockResolvedValue(pagina([], 0));
    await listSolicitacoesParaDemanda();
    expect(SOLICITACOES_PAGE_SIZE).toBe(100);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith('/api/v1/commercial-requests', { status: 'pending', page: 1, pageSize: 100 });
    expect(get).toHaveBeenCalledWith('/api/v1/commercial-requests', { status: 'quoting', page: 1, pageSize: 100 });
  });

  it('S2: junta os dados das duas respostas e monta os totais a partir de pagination.totalItems', async () => {
    get.mockImplementation(async (_path, q) =>
      (q as { status: string }).status === 'pending' ? pagina([1, 2], 134) : pagina([3], 1),
    );
    const r = await listSolicitacoesParaDemanda();
    expect(r.solicitacoes.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(r.totais).toEqual({ pending: { mostradas: 2, total: 134 }, quoting: { mostradas: 1, total: 1 } });
  });

  it('S3: se uma das chamadas falha, a promise rejeita', async () => {
    get.mockImplementation(async (_path, q) => {
      if ((q as { status: string }).status === 'quoting') throw new ApiError(500, null);
      return pagina([1], 1);
    });
    await expect(listSolicitacoesParaDemanda()).rejects.toBeInstanceOf(ApiError);
  });

  it('S4: mensagens por status', () => {
    expect(forecastSolicitacoesErrorMessage(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastSolicitacoesErrorMessage(new ApiError(403, null))).toBe(
      'Seu perfil não pode consultar as Solicitações. Preencha a demanda à mão.',
    );
    expect(forecastSolicitacoesErrorMessage(new ApiError(500, null))).toBe(
      'Não foi possível carregar as Solicitações (HTTP 500).',
    );
  });

  it('S5: erro que nao e ApiError vira mensagem de conexao', () => {
    expect(forecastSolicitacoesErrorMessage(new Error('rede'))).toBe('Sem conexão com o servidor. Tente de novo.');
  });
});
