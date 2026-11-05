import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';
import { listCatalogoSemForecast, situacaoDoCodigo } from '@/services/catalogForecast';
import type { ForecastProdutoCadastro } from '@/services/forecastPendentes';
import { ERRO_ESCOLHA_O_PRODUTO, VINCULO_VAZIO, validarVinculo, type FormVinculo } from './itemForecastVinculoForm';

// Dados 100% sinteticos.
const produto = (id: number, name: string, codes: string[], over: Partial<ForecastProdutoCadastro> = {}): ForecastProdutoCadastro => ({
  id,
  name,
  isActive: true,
  origin: 'dbcorp',
  codes: codes.map((code, i) => ({ id: id * 100 + i, position: i + 1, code })),
  ...over,
});

const livre = { tipo: 'livre' } as const;
const contexto = (over: Record<string, unknown> = {}) => ({
  codigo: 'TST9001',
  exigido: true,
  situacao: livre,
  fonte: null,
  produto: null,
  ...over,
});
const form = (over: Partial<FormVinculo> = {}): FormVinculo => ({ ...VINCULO_VAZIO, ...over });

describe('situacaoDoCodigo', () => {
  const produtos = [
    produto(1, 'PRODUTO A', ['TST0001', 'TST0002']),
    produto(2, 'PRODUTO INATIVO', ['TST0003'], { isActive: false }),
  ];

  it('ignora caixa e espacos', () => {
    expect(situacaoDoCodigo(produtos, ' tst0002 ')).toMatchObject({ tipo: 'ativo', produto: { id: 1 } });
  });

  it('produto inativo tambem ocupa o codigo', () => {
    expect(situacaoDoCodigo(produtos, 'TST0003')).toMatchObject({ tipo: 'inativo', produto: { id: 2 } });
  });

  it('livre quando nenhum produto tem o codigo (ou o texto e vazio)', () => {
    expect(situacaoDoCodigo(produtos, 'TST9999')).toEqual({ tipo: 'livre' });
    expect(situacaoDoCodigo(produtos, '   ')).toEqual({ tipo: 'livre' });
  });
});

describe('validarVinculo', () => {
  it('exige a escolha quando o codigo e livre e o vinculo e obrigatorio', () => {
    expect(validarVinculo(form(), contexto())).toEqual({ ok: false, erro: ERRO_ESCOLHA_O_PRODUTO });
  });

  it('nao exige quando o vinculo e opcional (D2) nem quando ainda nao se sabe a situacao', () => {
    expect(validarVinculo(form(), contexto({ exigido: false }))).toEqual({ ok: true, forecast: null, leadTimeDias: null });
    expect(validarVinculo(form(), contexto({ situacao: null }))).toEqual({ ok: true, forecast: null, leadTimeDias: null });
  });

  it('codigo vazio ou ja no Forecast: nada a mandar', () => {
    expect(validarVinculo(form(), contexto({ codigo: '  ' }))).toEqual({ ok: true, forecast: null, leadTimeDias: null });
    const ativo = { tipo: 'ativo', produto: produto(1, 'A', ['TST9001']) };
    expect(validarVinculo(form({ modo: 'existente', productId: 1 }), contexto({ situacao: ativo }))).toEqual({
      ok: true,
      forecast: null,
      leadTimeDias: null,
    });
  });

  it('existente: manda o productId; sem escolha ou com produto cheio -> erro', () => {
    const p = produto(5, 'PRODUTO 5', ['A1']);
    expect(validarVinculo(form({ modo: 'existente', productId: 5 }), contexto({ produto: p }))).toEqual({
      ok: true,
      forecast: { modo: 'existente', productId: 5 },
      leadTimeDias: null,
    });
    expect(validarVinculo(form({ modo: 'existente' }), contexto())).toEqual({
      ok: false,
      erro: 'Escolha o produto do Forecast.',
    });
    const cheio = produto(6, 'PRODUTO 6', ['1', '2', '3', '4', '5', '6', '7']);
    expect(validarVinculo(form({ modo: 'existente', productId: 6 }), contexto({ produto: cheio }))).toEqual({
      ok: false,
      erro: 'O produto já tem 7 códigos.',
    });
  });

  it('novo: usa as mensagens do "Completar cadastro" (nome, fonte, familia e lead time)', () => {
    const base = form({ modo: 'novo', nome: 'PRODUTO NOVO', sourceId: 3, familyId: 4 });
    expect(validarVinculo({ ...base, nome: '  ' }, contexto())).toEqual({ ok: false, erro: 'Informe o nome do produto.' });
    expect(validarVinculo({ ...base, sourceId: null }, contexto())).toEqual({ ok: false, erro: 'Escolha a fonte.' });
    expect(validarVinculo({ ...base, familyId: null }, contexto())).toEqual({ ok: false, erro: 'Escolha a família.' });
    const semLeadTime = { leadTimeDays: null };
    expect(validarVinculo(base, contexto({ fonte: semLeadTime }))).toEqual({
      ok: false,
      erro: 'Informe o lead time da fonte em dias (1 a 999).',
    });
    expect(validarVinculo({ ...base, leadTimeTexto: '45' }, contexto({ fonte: semLeadTime }))).toEqual({
      ok: true,
      forecast: { modo: 'novo', nome: 'PRODUTO NOVO', sourceId: 3, familyId: 4 },
      leadTimeDias: 45,
    });
    expect(validarVinculo(base, contexto({ fonte: { leadTimeDays: 30 } }))).toMatchObject({ ok: true, leadTimeDias: null });
  });

  it('novo: codigo acima de 40 caracteres e recusado como no backend', () => {
    const base = form({ modo: 'novo', nome: 'PRODUTO NOVO', sourceId: 3, familyId: 4 });
    expect(validarVinculo(base, contexto({ codigo: 'T'.repeat(41), fonte: { leadTimeDays: 30 } }))).toEqual({
      ok: false,
      erro: 'O código aceita no máximo 40 caracteres.',
    });
  });
});

describe('listCatalogoSemForecast', () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  it('descarta item sem codigo (lista paginada de backend antigo nao vira selo)', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        { id: 1, commercialName: 'A', marketName: 'A', dbcorpCode: null },
        { id: 2, commercialName: 'B', marketName: 'B', dbcorpCode: '  ' },
        { id: 3, commercialName: 'C', marketName: 'C', dbcorpCode: 'TST0003', familyId: null, family: null },
      ],
    });
    const itens = await listCatalogoSemForecast();
    expect(itens.map((i) => i.id)).toEqual([3]);
    expect(api.get).toHaveBeenCalledWith('/v1/catalog-items/sem-forecast');
  });

  it('resposta sem lista -> vazio', async () => {
    vi.mocked(api.get).mockResolvedValue({});
    expect(await listCatalogoSemForecast()).toEqual([]);
  });
});
