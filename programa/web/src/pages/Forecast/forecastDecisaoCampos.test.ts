import { describe, expect, it } from 'vitest';
import { kgParaCampo, sugeridaParaCampo, textoSalvaEm, validarDecisao } from './forecastDecisaoCampos';

describe('textoSalvaEm', () => {
  it('formata dd/mm hh:mm no horario de Brasilia (nunca UTC)', () => {
    expect(textoSalvaEm('2026-10-26T17:30:00.000Z')).toBe('salva em 26/10 14:30');
    // 02:10 UTC ainda e o dia anterior em Brasilia (UTC-3).
    expect(textoSalvaEm('2026-10-27T02:10:00.000Z')).toBe('salva em 26/10 23:10');
    // Meia-noite local: 03:00 UTC.
    expect(textoSalvaEm('2026-10-27T03:05:00.000Z')).toBe('salva em 27/10 00:05');
  });

  it('data invalida = vazio', () => {
    expect(textoSalvaEm('nao e data')).toBe('');
  });
});

describe('kgParaCampo / sugeridaParaCampo', () => {
  it('virgula decimal, ate 3 casas, sem milhar nem zeros sobrando', () => {
    expect(kgParaCampo(1234.5)).toBe('1234,5');
    expect(kgParaCampo(100)).toBe('100');
    expect(kgParaCampo(0)).toBe('0');
    expect(kgParaCampo(0.125)).toBe('0,125');
    expect(kgParaCampo(1600.1234)).toBe('1600,123');
  });

  it('sugerida arredonda a Qtd. final a 3 casas', () => {
    expect(sugeridaParaCampo(1234.56789)).toBe('1234,568');
    expect(sugeridaParaCampo(40)).toBe('40');
  });
});

describe('validarDecisao', () => {
  it('quantidade valida e observacao aparada', () => {
    expect(validarDecisao({ kg: '1.600,5', observacao: '  OBS SINTETICA  ' })).toEqual({
      erros: {},
      valores: { quantidadeKg: 1600.5, observacao: 'OBS SINTETICA' },
    });
    expect(validarDecisao({ kg: '0', observacao: '' }).valores).toEqual({ quantidadeKg: 0, observacao: null });
    expect(validarDecisao({ kg: '10.000.000', observacao: '' }).valores?.quantidadeKg).toBe(10_000_000);
  });

  it('campo vazio e valido (apagar)', () => {
    expect(validarDecisao({ kg: '  ', observacao: '' }).valores).toEqual({ quantidadeKg: null, observacao: null });
  });

  it('rejeita invalido, negativo, acima do maximo e mais de 3 casas', () => {
    expect(validarDecisao({ kg: 'abc', observacao: '' }).erros.kg).toMatch(/Informe a quantidade/);
    expect(validarDecisao({ kg: '-5', observacao: '' }).erros.kg).toMatch(/negativa/);
    expect(validarDecisao({ kg: '10.000.001', observacao: '' }).erros.kg).toMatch(/10\.000\.000/);
    expect(validarDecisao({ kg: '1,2345', observacao: '' }).erros.kg).toMatch(/3 casas/);
    expect(validarDecisao({ kg: 'abc', observacao: '' }).valores).toBeNull();
  });

  it('rejeita observacao acima de 300 caracteres', () => {
    expect(validarDecisao({ kg: '1', observacao: 'x'.repeat(300) }).erros.observacao).toBeUndefined();
    const longa = validarDecisao({ kg: '1', observacao: 'x'.repeat(301) });
    expect(longa.erros.observacao).toMatch(/300/);
    expect(longa.valores).toBeNull();
  });
});
