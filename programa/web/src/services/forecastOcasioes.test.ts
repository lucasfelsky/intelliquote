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
  alterarOcasiao,
  criarOcasiao,
  excluirOcasiao,
  forecastOcasioesErrorMessage,
  forecastOcasioesKeys,
  forecastPaisFonteErrorMessage,
  listarOcasioes,
  ocasiaoSumiu,
  patchForecastSourceCountry,
  type ForecastOcasiaoNova,
} from './forecastOcasioes';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.del);

const NOVA: ForecastOcasiaoNova = {
  name: 'OCASIAO SINTETICA 1',
  scopeType: 'global',
  countryCode: null,
  sourceId: null,
  startDate: '2027-02-01',
  endDate: '2027-02-03',
  recurrence: 'nenhuma',
  component: 'total',
  effectKind: 'dias',
  effectValue: 3,
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('chamadas HTTP', () => {
  it('lista sem janela chama o GET com 1 argumento so', async () => {
    get.mockResolvedValue({ data: [] });
    await expect(listarOcasioes()).resolves.toEqual([]);
    expect(get).toHaveBeenCalledWith('/v1/forecast/lead-time-events');
    expect(get.mock.calls[0]).toHaveLength(1);
  });

  it('lista com janela manda de e ate', async () => {
    get.mockResolvedValue({ data: [] });
    await listarOcasioes({ de: '2027-01-01', ate: '2027-12-31' });
    expect(get).toHaveBeenCalledWith('/v1/forecast/lead-time-events', { de: '2027-01-01', ate: '2027-12-31' });
  });

  it('criar, alterar e excluir usam a URL e devolvem o dado', async () => {
    post.mockResolvedValue({ data: { id: 5 } });
    patch.mockResolvedValue({ data: { id: 5 } });
    del.mockResolvedValue({ data: { id: 5 } });
    await criarOcasiao(NOVA);
    expect(post).toHaveBeenCalledWith('/v1/forecast/lead-time-events', NOVA);
    await alterarOcasiao(5, { isActive: false });
    expect(patch).toHaveBeenCalledWith('/v1/forecast/lead-time-events/5', { isActive: false });
    await expect(excluirOcasiao(5)).resolves.toEqual({ id: 5 });
    expect(del).toHaveBeenCalledWith('/v1/forecast/lead-time-events/5');
  });

  it('pais da fonte: codigo ou null', async () => {
    patch.mockResolvedValue({ data: { id: 3, name: 'FONTE C', countryCode: 'CN' } });
    await patchForecastSourceCountry(3, 'CN');
    expect(patch).toHaveBeenLastCalledWith('/v1/forecast/sources/3', { countryCode: 'CN' });
    await patchForecastSourceCountry(3, null);
    expect(patch).toHaveBeenLastCalledWith('/v1/forecast/sources/3', { countryCode: null });
  });
});

describe('chaves de query', () => {
  it('lista e ano comecam com a chave geral (invalidar a geral refaz as duas)', () => {
    expect(forecastOcasioesKeys.todas).toEqual(['forecast', 'ocasioes']);
    expect(forecastOcasioesKeys.lista.slice(0, 2)).toEqual(forecastOcasioesKeys.todas);
    expect(forecastOcasioesKeys.ano(2027).slice(0, 2)).toEqual(forecastOcasioesKeys.todas);
    expect(forecastOcasioesKeys.ano(2027)).toEqual(['forecast', 'ocasioes', 'ano', 2027]);
  });
});

describe('forecastOcasioesErrorMessage', () => {
  it('sem ApiError = sem conexao', () => {
    expect(forecastOcasioesErrorMessage(new Error('x'), 'listar')).toBe('Sem conexão com o servidor. Tente de novo.');
  });

  it('401', () => {
    expect(forecastOcasioesErrorMessage(new ApiError(401, null), 'salvar')).toBe('Sua sessão expirou. Entre de novo.');
  });

  it('403 por acao', () => {
    expect(forecastOcasioesErrorMessage(new ApiError(403, null), 'listar')).toBe(
      'Seu perfil não tem acesso aos eventos estrangeiros do Forecast.',
    );
    for (const acao of ['salvar', 'excluir'] as const) {
      expect(forecastOcasioesErrorMessage(new ApiError(403, null), acao)).toBe(
        'Seu perfil não pode cadastrar nem alterar eventos estrangeiros.',
      );
    }
  });

  it('404: listar ou sem corpo JSON = backend antigo', () => {
    const antigo = 'O servidor ainda não tem o cadastro de eventos estrangeiros. Aguarde a atualização do sistema.';
    expect(forecastOcasioesErrorMessage(new ApiError(404, { message: 'Ocasião não encontrada.' }), 'listar')).toBe(antigo);
    expect(forecastOcasioesErrorMessage(new ApiError(404, { contentType: 'text/html', body: '<html>' }), 'salvar')).toBe(antigo);
    expect(forecastOcasioesErrorMessage(new ApiError(404, null), 'excluir')).toBe(antigo);
  });

  it('404 com corpo JSON em salvar/excluir = nao existe mais', () => {
    const sumiu = 'Este evento não existe mais (pode ter sido excluído). A lista foi atualizada.';
    const err = new ApiError(404, { message: 'Ocasião não encontrada.' });
    expect(forecastOcasioesErrorMessage(err, 'salvar')).toBe(sumiu);
    expect(forecastOcasioesErrorMessage(err, 'excluir')).toBe(sumiu);
  });

  it('400 e 409 repassam a mensagem do backend (desconhecida sem mexer)', () => {
    expect(forecastOcasioesErrorMessage(new ApiError(400, { message: 'Fonte não encontrada ou inativa.' }, 'Fonte não encontrada ou inativa.'), 'salvar')).toBe(
      'Fonte não encontrada ou inativa.',
    );
    expect(forecastOcasioesErrorMessage(new ApiError(400, { message: 'Texto novo do servidor.' }), 'salvar')).toBe(
      'Texto novo do servidor.',
    );
  });

  it('409 do backend sai traduzido para eventos', () => {
    const dup = 'Já existe uma ocasião ativa com o mesmo alcance, período e etapa. Edite a existente.';
    expect(forecastOcasioesErrorMessage(new ApiError(409, { message: dup }), 'salvar')).toBe(
      'Já existe um evento ativo com o mesmo alcance, período e etapa. Edite o existente.',
    );
  });

  it('as 8 mensagens do backend com "ocasião" saem traduzidas', () => {
    const pares: Array<[string, string]> = [
      ['Informe o nome da ocasião.', 'Informe o nome do evento.'],
      ['Ocasião global não tem país nem fonte.', 'Evento de todas as fontes não tem país nem fonte.'],
      ['Informe o país da ocasião.', 'Informe o país do evento.'],
      ['Ocasião de país não tem fonte.', 'Evento por país não tem fonte.'],
      ['Informe a fonte da ocasião.', 'Informe a fonte do evento.'],
      ['Ocasião de fonte não tem país.', 'Evento por fonte não tem país.'],
      ['Informe o que alterar na ocasião.', 'Informe o que alterar no evento.'],
    ];
    for (const [backend, web] of pares) {
      expect(forecastOcasioesErrorMessage(new ApiError(400, { message: backend }), 'salvar')).toBe(web);
    }
  });

  it('400 sem mensagem usa o texto padrao', () => {
    expect(forecastOcasioesErrorMessage(new ApiError(400, null), 'salvar')).toBe('Pedido recusado pelo servidor (HTTP 400).');
  });

  it('outros status por acao', () => {
    expect(forecastOcasioesErrorMessage(new ApiError(500, null), 'listar')).toBe('Não foi possível carregar os eventos (HTTP 500).');
    expect(forecastOcasioesErrorMessage(new ApiError(500, null), 'salvar')).toBe('Não foi possível salvar o evento (HTTP 500).');
    expect(forecastOcasioesErrorMessage(new ApiError(502, null), 'excluir')).toBe('Não foi possível excluir o evento (HTTP 502).');
  });
});

describe('ocasiaoSumiu', () => {
  it('so 404 com message no corpo', () => {
    expect(ocasiaoSumiu(new ApiError(404, { message: 'Ocasião não encontrada.' }))).toBe(true);
    expect(ocasiaoSumiu(new ApiError(404, { contentType: 'text/html', body: '<html>' }))).toBe(false);
    expect(ocasiaoSumiu(new ApiError(404, null))).toBe(false);
    expect(ocasiaoSumiu(new ApiError(400, { message: 'x' }))).toBe(false);
    expect(ocasiaoSumiu(new Error('x'))).toBe(false);
  });
});

describe('forecastPaisFonteErrorMessage', () => {
  it('mensagens por status', () => {
    expect(forecastPaisFonteErrorMessage(new Error('x'))).toBe('Sem conexão com o servidor. Tente de novo.');
    expect(forecastPaisFonteErrorMessage(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastPaisFonteErrorMessage(new ApiError(403, null))).toBe('Seu perfil não pode alterar o país das fontes.');
    expect(forecastPaisFonteErrorMessage(new ApiError(404, null))).toBe('Fonte não encontrada (pode ter sido removida).');
    expect(forecastPaisFonteErrorMessage(new ApiError(400, { message: 'País inválido.' }))).toBe('País inválido.');
    expect(forecastPaisFonteErrorMessage(new ApiError(500, null))).toBe('Não foi possível salvar o país da fonte (HTTP 500).');
  });
});
