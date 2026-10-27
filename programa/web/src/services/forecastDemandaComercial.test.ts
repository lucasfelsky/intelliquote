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
  createForecastDemandaComercial,
  dataValida,
  forecastDemandaComercialErrorMessage,
  lerKgBr,
  listForecastDemandasComerciais,
  listForecastProdutosParaDemanda,
  patchForecastDemandaComercial,
  validarDemandaComercial,
  validarNotaDeFechamento,
} from './forecastDemandaComercial';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('servico de demanda do comercial do Forecast', () => {
  it('lista por GET /v1/forecast/commercial-demands com os filtros e desembrulha { data }', async () => {
    get.mockResolvedValue({ data: [{ id: 1 }] });
    await expect(listForecastDemandasComerciais({ status: 'aberta', productId: 7 })).resolves.toEqual([{ id: 1 }]);
    expect(get).toHaveBeenCalledWith('/v1/forecast/commercial-demands', { status: 'aberta', productId: 7 });
    await listForecastDemandasComerciais();
    expect(get).toHaveBeenLastCalledWith('/v1/forecast/commercial-demands', { status: undefined, productId: undefined });
  });

  it('lanca por POST /v1/forecast/commercial-demands com o corpo como esta', async () => {
    post.mockResolvedValue({ data: { id: 9 } });
    const body = { productId: 7, quantidadeKg: 1600, necessidade: '2027-02-10', motivo: 'MOTIVO SINTETICO', cliente: null };
    await expect(createForecastDemandaComercial(body)).resolves.toEqual({ id: 9 });
    expect(post).toHaveBeenCalledWith('/v1/forecast/commercial-demands', body);
  });

  it('edita e fecha por PATCH /v1/forecast/commercial-demands/:id', async () => {
    patch.mockResolvedValue({ data: { id: 9 } });
    await patchForecastDemandaComercial(9, { motivo: 'NOVO MOTIVO' });
    expect(patch).toHaveBeenCalledWith('/v1/forecast/commercial-demands/9', { motivo: 'NOVO MOTIVO' });
    await patchForecastDemandaComercial(9, { status: 'cancelada', nota: 'CLIENTE DESISTIU SINTETICO' });
    expect(patch).toHaveBeenLastCalledWith('/v1/forecast/commercial-demands/9', {
      status: 'cancelada',
      nota: 'CLIENTE DESISTIU SINTETICO',
    });
  });

  it('lista os produtos do cadastro so com os campos usados na busca', async () => {
    get.mockResolvedValue({
      data: [
        {
          id: 5,
          name: 'PRODUTO 001',
          isActive: true,
          source: { id: 2, name: 'FONTE 001', leadTimeDays: 60 },
          family: null,
          codes: [{ id: 1, position: 1, code: 'C0001', catalogItemId: null }],
        },
        { id: 6, name: 'PRODUTO 002', isActive: false, source: null },
      ],
    });
    await expect(listForecastProdutosParaDemanda()).resolves.toEqual([
      { id: 5, name: 'PRODUTO 001', isActive: true, source: { name: 'FONTE 001' }, codes: [{ code: 'C0001', catalogItemId: null }] },
      { id: 6, name: 'PRODUTO 002', isActive: false, source: null, codes: [] },
    ]);
    expect(get).toHaveBeenCalledWith('/v1/forecast/products');
  });

  it('mensagens por status; 400 e 409 repassam a mensagem do backend', () => {
    expect(forecastDemandaComercialErrorMessage(new ApiError(401, null))).toBe('Sua sessão expirou. Entre de novo.');
    expect(forecastDemandaComercialErrorMessage(new ApiError(403, null))).toBe(
      'Seu perfil não pode lançar nem alterar demanda do comercial.',
    );
    expect(forecastDemandaComercialErrorMessage(new ApiError(404, null))).toBe(
      'Demanda ou produto não encontrado (pode ter sido removido).',
    );
    expect(forecastDemandaComercialErrorMessage(new ApiError(500, null))).toBe(
      'Não foi possível salvar a demanda do comercial (HTTP 500).',
    );
    expect(forecastDemandaComercialErrorMessage(new Error('rede'))).toBe('Sem conexão com o servidor. Tente de novo.');
    expect(
      forecastDemandaComercialErrorMessage(new ApiError(409, { message: 'Demanda ja fechada: nao pode ser alterada nem reaberta.' })),
    ).toBe('Demanda ja fechada: nao pode ser alterada nem reaberta.');
    expect(forecastDemandaComercialErrorMessage(new ApiError(400, null))).toBe('Pedido recusado pelo servidor (HTTP 400).');
  });
});

describe('lerKgBr', () => {
  it.each([
    ['1600', 1600],
    ['1.600', 1600],
    ['1.600,5', 1600.5],
    ['1600,5', 1600.5],
    ['1600.5', 1600.5],
    ['0,125', 0.125],
    ['  25 ', 25],
    ['1.234.567', 1234567],
  ])('"%s" -> %s', (texto, esperado) => {
    expect(lerKgBr(texto)).toBe(esperado);
  });

  it.each(['', '   ', 'abc', '1,2,3', '-5', '1e3', '12 kg', ',5'])('"%s" -> invalido', (texto) => {
    expect(lerKgBr(texto)).toBeNull();
  });
});

describe('dataValida', () => {
  it('aceita so datas existentes no formato AAAA-MM-DD', () => {
    expect(dataValida('2027-02-10')).toBe(true);
    expect(dataValida('2028-02-29')).toBe(true);
    expect(dataValida('2027-02-29')).toBe(false);
    expect(dataValida('2027-13-01')).toBe(false);
    expect(dataValida('10/02/2027')).toBe(false);
    expect(dataValida('')).toBe(false);
  });
});

describe('validarDemandaComercial', () => {
  const ok = {
    kg: '1.600',
    necessidade: '2027-02-10',
    motivo: '  MOTIVO SINTETICO  ',
    cliente: '  CLIENTE SINTETICO ',
    solicitacao: '#12',
  };

  it('campos validos: valores prontos para o corpo (trim, kg numerico, solicitacao sem #)', () => {
    const r = validarDemandaComercial(ok, { produtoEscolhido: true, minNecessidade: '2026-10-20' });
    expect(r.erros).toEqual({});
    expect(r.valores).toEqual({
      quantidadeKg: 1600,
      necessidade: '2027-02-10',
      motivo: 'MOTIVO SINTETICO',
      cliente: 'CLIENTE SINTETICO',
      solicitacaoId: 12,
    });
  });

  it('cliente e solicitacao vazios viram null', () => {
    const r = validarDemandaComercial({ ...ok, cliente: '  ', solicitacao: '' }, { produtoEscolhido: true });
    expect(r.valores).toMatchObject({ cliente: null, solicitacaoId: null });
  });

  it('erros por campo, em portugues', () => {
    const r = validarDemandaComercial(
      { kg: '', necessidade: '', motivo: 'ab', cliente: 'x'.repeat(201), solicitacao: 'abc' },
      { produtoEscolhido: false },
    );
    expect(r.valores).toBeNull();
    expect(r.erros).toEqual({
      produto: 'Escolha o produto.',
      kg: 'Informe a quantidade em kg.',
      necessidade: 'Informe a data de necessidade.',
      motivo: 'Informe o motivo (ao menos 3 caracteres).',
      cliente: 'O cliente aceita no máximo 200 caracteres.',
      solicitacao: 'O número da solicitação deve ser um inteiro positivo.',
    });
  });

  it.each([
    ['abc', 'Informe a quantidade em kg (ex.: 1.600 ou 1600,5).'],
    ['0', 'A quantidade precisa ser maior que zero.'],
    ['10.000.001', 'A quantidade aceita no máximo 10.000.000 kg.'],
    ['1,2345', 'A quantidade aceita no máximo 3 casas decimais.'],
  ])('kg "%s" -> %s', (kg, mensagem) => {
    expect(validarDemandaComercial({ ...ok, kg }, { produtoEscolhido: true }).erros.kg).toBe(mensagem);
  });

  it('data: invalida, anterior ao minimo (so quando informado) e igual ao minimo', () => {
    expect(validarDemandaComercial({ ...ok, necessidade: '2027-02-30' }, { produtoEscolhido: true }).erros.necessidade).toBe(
      'Informe uma data de necessidade válida.',
    );
    expect(
      validarDemandaComercial({ ...ok, necessidade: '2026-10-19' }, { produtoEscolhido: true, minNecessidade: '2026-10-20' })
        .erros.necessidade,
    ).toBe('A data de necessidade não pode ser anterior a hoje.');
    expect(
      validarDemandaComercial({ ...ok, necessidade: '2026-10-20' }, { produtoEscolhido: true, minNecessidade: '2026-10-20' }).erros,
    ).toEqual({});
    // Edicao com a data inalterada: sem minimo, pedido antigo continua editavel.
    expect(validarDemandaComercial({ ...ok, necessidade: '2020-01-01' }, { produtoEscolhido: true }).erros).toEqual({});
  });

  it('motivo com 300 caracteres passa; 301 nao', () => {
    expect(validarDemandaComercial({ ...ok, motivo: 'x'.repeat(300) }, { produtoEscolhido: true }).erros).toEqual({});
    expect(validarDemandaComercial({ ...ok, motivo: 'x'.repeat(301) }, { produtoEscolhido: true }).erros.motivo).toBe(
      'O motivo aceita no máximo 300 caracteres.',
    );
  });

  it('solicitacao zero ou maior que o INTEGER do banco -> erro', () => {
    for (const solicitacao of ['0', '2147483648']) {
      expect(validarDemandaComercial({ ...ok, solicitacao }, { produtoEscolhido: true }).erros.solicitacao).toBe(
        'O número da solicitação deve ser um inteiro positivo.',
      );
    }
  });
});

describe('validarNotaDeFechamento', () => {
  it('cancelar exige a nota (3 a 300); comprada e virou_programacao aceitam vazio', () => {
    expect(validarNotaDeFechamento('cancelada', '  ')).toEqual({ erro: 'Informe o motivo do cancelamento.', nota: null });
    expect(validarNotaDeFechamento('cancelada', 'ab').erro).toBe('A nota precisa ter ao menos 3 caracteres.');
    expect(validarNotaDeFechamento('cancelada', ' CLIENTE DESISTIU ')).toEqual({ erro: null, nota: 'CLIENTE DESISTIU' });
    expect(validarNotaDeFechamento('comprada', '')).toEqual({ erro: null, nota: null });
    expect(validarNotaDeFechamento('virou_programacao', 'PO SINTETICA 1')).toEqual({ erro: null, nota: 'PO SINTETICA 1' });
    expect(validarNotaDeFechamento('comprada', 'x'.repeat(301)).erro).toBe('A nota aceita no máximo 300 caracteres.');
  });
});
