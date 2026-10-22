import { describe, expect, it } from 'vitest';
import type { ForecastEmbalagens } from '@/services/forecastEmbalagens';
import {
  edicaoInicial,
  type EdicaoDeEmbalagens,
  ERRO_QTD_CASAS,
  ERRO_QTD_FORMATO,
  ERRO_QTD_MAXIMA,
  ERRO_QTD_POSITIVA,
  lerQuantidadeKg,
  montarPatch,
  quantidadeParaCampo,
} from './forecastEmbalagens';

describe('lerQuantidadeKg', () => {
  it('vazio vira null (sem embalagem)', () => {
    expect(lerQuantidadeKg('')).toEqual({ ok: true, valor: null });
    expect(lerQuantidadeKg('   ')).toEqual({ ok: true, valor: null });
  });

  it.each([
    ['25', 25],
    ['25,5', 25.5],
    ['22,68', 22.68],
    ['0,5', 0.5],
    ['1.000', 1000],
    ['1.250,5', 1250.5],
    ['1.000.000', 1000000],
    [' 200 ', 200],
    ['2,125', 2.125],
  ])('aceita %s', (texto, valor) => {
    expect(lerQuantidadeKg(texto)).toEqual({ ok: true, valor });
  });

  it.each([
    ['0', ERRO_QTD_POSITIVA],
    ['0,000', ERRO_QTD_POSITIVA],
    ['-5', ERRO_QTD_POSITIVA],
    ['abc', ERRO_QTD_FORMATO],
    ['25 kg', ERRO_QTD_FORMATO],
    ['25.5', ERRO_QTD_FORMATO],
    ['1.00', ERRO_QTD_FORMATO],
    ['25,', ERRO_QTD_FORMATO],
    ['25,1234', ERRO_QTD_CASAS],
    ['1.000.001', ERRO_QTD_MAXIMA],
    ['1000000,001', ERRO_QTD_MAXIMA],
  ])('rejeita %s', (texto, erro) => {
    expect(lerQuantidadeKg(texto)).toEqual({ ok: false, erro });
  });

  it('quantidadeParaCampo devolve o que lerQuantidadeKg le de volta', () => {
    expect(quantidadeParaCampo(null)).toBe('');
    expect(quantidadeParaCampo(22.68)).toBe('22,68');
    expect(quantidadeParaCampo(1000)).toBe('1000');
    expect(lerQuantidadeKg(quantidadeParaCampo(22.68))).toEqual({ ok: true, valor: 22.68 });
  });
});

const original: ForecastEmbalagens = {
  produto: { id: 5, nome: 'PRODUTO 001', ativo: true, embalagemPlanilha: null, naoFraciona: false },
  codigos: [
    { id: 11, posicao: 1, codigo: 'C0001', quantidadeKg: 25, rotulo: 'Saco', principal: true, origem: 'manual', atualizadoEm: '2026-10-22' },
    { id: 12, posicao: 2, codigo: 'C0002', quantidadeKg: null, rotulo: null, principal: false, origem: null, atualizadoEm: null },
    { id: 13, posicao: 3, codigo: 'C0003', quantidadeKg: 200, rotulo: null, principal: false, origem: 'dbcorp', atualizadoEm: '2026-10-21' },
  ],
  usadaCodigoId: 11,
};

// Copia da edicao com o codigo da posicao `i` alterado.
function editar(
  ed: EdicaoDeEmbalagens,
  i: number,
  parcial: Partial<EdicaoDeEmbalagens['codigos'][number]>,
): EdicaoDeEmbalagens {
  return { ...ed, codigos: ed.codigos.map((c, j) => (j === i ? { ...c, ...parcial } : c)) };
}

describe('montarPatch', () => {
  const base = edicaoInicial(original);

  it('nada mudou -> null', () => {
    expect(montarPatch(original, base)).toBeNull();
  });

  it('rotulo so com espacos equivale a vazio (nao conta como mudanca)', () => {
    expect(montarPatch(original, editar(base, 1, { rotulo: '   ' }))).toBeNull();
  });

  it('so os codigos alterados; principal ausente quando nao mudou', () => {
    expect(montarPatch(original, editar(base, 2, { quantidadeKg: 22.68 }))).toEqual({
      embalagens: [{ codigoId: 13, quantidadeKg: 22.68, rotulo: null }],
    });
  });

  it('muda so o rotulo (aparado) e so a principal', () => {
    expect(montarPatch(original, editar(base, 0, { rotulo: '  Saco 25 kg ' }))).toEqual({
      embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco 25 kg' }],
    });
    expect(montarPatch(original, { ...base, principalCodigoId: 13 })).toEqual({ principalCodigoId: 13 });
  });

  it('principal null = nenhuma; limpar a quantidade do principal junto com a principal', () => {
    const ed = { ...editar(base, 0, { quantidadeKg: null, rotulo: null }), principalCodigoId: null };
    expect(montarPatch(original, ed)).toEqual({
      embalagens: [{ codigoId: 11, quantidadeKg: null, rotulo: null }],
      principalCodigoId: null,
    });
  });
});
