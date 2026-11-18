import { describe, expect, it } from 'vitest';
import {
  PO_DIRETA_KG_MAX,
  chaveDeEnvioValida,
  codigoDeFalha,
  quantidadeDaPoValida,
} from '../src/utils/forecastPoDireta';

// Regras puras da PO direta do Forecast (item de preco fechado). Dados sinteticos.

describe('quantidadeDaPoValida', () => {
  it.each([1, 25000, 0.001, 1234.567, PO_DIRETA_KG_MAX])('aceita %s kg', (kg) => {
    expect(quantidadeDaPoValida(kg)).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, PO_DIRETA_KG_MAX + 1, 1.0001, 0.0004])('recusa %s kg', (kg) => {
    expect(quantidadeDaPoValida(kg)).toBe(false);
  });

  it('nao recusa ruido de ponto flutuante a 3 casas (0,1 + 0,2)', () => {
    expect(quantidadeDaPoValida(0.1 + 0.2)).toBe(true);
  });
});

describe('chaveDeEnvioValida', () => {
  it('aceita UUID e chaves curtas seguras', () => {
    expect(chaveDeEnvioValida('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(chaveDeEnvioValida('abc_DEF-123')).toBe(true);
  });

  it.each(['', 'curta', 'tem espaco 123', 'acentuação-123', 'a'.repeat(65), "x'; drop table--"])('recusa %j', (chave) => {
    expect(chaveDeEnvioValida(chave)).toBe(false);
  });
});

describe('codigoDeFalha', () => {
  it('tira acento, normaliza e limita a 40 caracteres', () => {
    expect(codigoDeFalha('Falha no SMTP: conexão recusada')).toBe('falha_no_smtp_conexao_recusada');
    expect(codigoDeFalha('x'.repeat(100))).toHaveLength(40);
  });

  it('nunca devolve vazio nem texto livre com espacos', () => {
    expect(codigoDeFalha('   ')).toBe('erro');
    expect(codigoDeFalha('!!!')).toBe('erro');
    expect(codigoDeFalha('a b c')).toBe('a_b_c');
  });
});
