import { describe, expect, it } from 'vitest';
import type { ForecastLinha } from '@/services/forecast';
import type { ForecastDecisao } from '@/services/forecastDecisoes';
import {
  aplicarGravacao,
  corpoDaGravacao,
  foraDaListaDeCompra,
  incluiManualmente,
  kgParaCampo,
  somenteLeitura,
  validarQuantidade,
} from './forecastAnaliseEditavel';

const linha = (over: Partial<ForecastLinha> = {}) => ({ AN: -10, status: 'nao', productId: 42, ...over }) as ForecastLinha;

function decisao(over: Partial<ForecastDecisao> = {}): ForecastDecisao {
  return {
    productId: 42,
    quantidadeKg: 100,
    status: 'cotando',
    observacao: 'x',
    sugeridaKg: 10,
    demandaKg: -10,
    decididaPorId: 1,
    criadaEm: '2026-10-26T17:30:00.000Z',
    atualizadaEm: '2026-10-26T17:30:00.000Z',
    ...over,
  };
}

describe('validarQuantidade', () => {
  it('vazio e valido (apaga)', () => {
    expect(validarQuantidade('  ')).toEqual({ erro: null, kg: null });
  });
  it.each([
    ['1.600', 1600],
    ['1600,5', 1600.5],
    ['0', 0],
    ['10.000.000', 10_000_000],
    ['1,234', 1.234],
  ])('%s -> %s', (texto, kg) => {
    expect(validarQuantidade(texto)).toEqual({ erro: null, kg });
  });
  it.each([
    ['abc', 'Informe a quantidade'],
    ['-1', 'negativa'],
    ['10.000.001', '10.000.000'],
    ['1,2345', '3 casas'],
  ])('%s recusa', (texto, trecho) => {
    const r = validarQuantidade(texto);
    expect(r.kg).toBeNull();
    expect(r.erro).toContain(trecho);
  });
});

describe('kgParaCampo', () => {
  it('virgula decimal, sem milhar e sem zeros a direita', () => {
    expect(kgParaCampo(1600)).toBe('1600');
    expect(kgParaCampo(1600.5)).toBe('1600,5');
    expect(kgParaCampo(0.125)).toBe('0,125');
  });
});

describe('fora da lista de compra', () => {
  it('sem falta (AN > 0) ou sem AN esta fora; com falta (AN <= 0) nao', () => {
    expect(foraDaListaDeCompra({ AN: 5 })).toBe(true);
    expect(foraDaListaDeCompra({ AN: null })).toBe(true);
    expect(foraDaListaDeCompra({ AN: 0 })).toBe(false);
    expect(foraDaListaDeCompra({ AN: -3 })).toBe(false);
  });
  it('decisao que ja era incluida manualmente reenvia a flag mesmo com falta', () => {
    expect(incluiManualmente({ AN: -3 }, decisao({ incluidoManualmente: true }))).toBe(true);
    expect(incluiManualmente({ AN: -3 }, decisao())).toBe(false);
  });
});

describe('somenteLeitura', () => {
  it('sem productId', () => {
    expect(somenteLeitura(linha({ productId: null }), undefined)?.motivo).toContain('fora do cadastro');
  });
  it('cotacao criada ou enviada trava; fechada e PO nao', () => {
    const com = (statusCotacao: 'criada' | 'enviada' | 'fechada' | 'po_enviada') =>
      decisao({ cotacao: { id: 1, requestCode: 'COT-0001', statusCotacao } });
    expect(somenteLeitura(linha(), com('criada'))?.motivo).toContain('COT-0001');
    expect(somenteLeitura(linha(), com('enviada'))).not.toBeNull();
    expect(somenteLeitura(linha(), com('fechada'))).toBeNull();
    expect(somenteLeitura(linha(), com('po_enviada'))).toBeNull();
  });
  it('item comum edita', () => {
    expect(somenteLeitura(linha(), undefined)).toBeNull();
  });
});

describe('corpoDaGravacao', () => {
  it('apagar: so quantidadeKg null (mesmo fora da lista)', () => {
    expect(corpoDaGravacao(linha({ AN: 5 }), decisao(), null)).toEqual({ quantidadeKg: null });
  });
  it('decisao existente: so a quantidade (status e observacao ficam)', () => {
    expect(corpoDaGravacao(linha(), decisao(), 50)).toEqual({ quantidadeKg: 50 });
  });
  it('decisao nova: status do item', () => {
    expect(corpoDaGravacao(linha({ status: 'po' }), undefined, 50)).toEqual({ quantidadeKg: 50, status: 'po' });
  });
  it('fora da lista: flag incluidoManualmente', () => {
    expect(corpoDaGravacao(linha({ AN: 8 }), undefined, 50)).toEqual({ quantidadeKg: 50, status: 'nao', incluidoManualmente: true });
    expect(corpoDaGravacao(linha({ AN: 8 }), decisao({ incluidoManualmente: true }), 50)).toEqual({
      quantidadeKg: 50,
      incluidoManualmente: true,
    });
  });
});

describe('aplicarGravacao', () => {
  it('troca, insere ordenado e remove', () => {
    const base = [decisao({ productId: 1 }), decisao({ productId: 3 })];
    expect(aplicarGravacao(base, 2, { acao: 'create', decisao: decisao({ productId: 2 }) }).map((d) => d.productId)).toEqual([1, 2, 3]);
    expect(aplicarGravacao(base, 1, { acao: 'update', decisao: decisao({ productId: 1, quantidadeKg: 9 }) })[0]?.quantidadeKg).toBe(9);
    expect(aplicarGravacao(base, 1, { acao: 'delete', decisao: null }).map((d) => d.productId)).toEqual([3]);
    expect(aplicarGravacao(undefined, 1, { acao: 'create', decisao: decisao({ productId: 1 }) })).toHaveLength(1);
  });
});
