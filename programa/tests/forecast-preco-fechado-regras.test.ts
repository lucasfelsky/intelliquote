import { describe, expect, it } from 'vitest';
import {
  PRECO_FECHADO_MAX,
  estadoDoPrecoFechado,
  motivoDoPrecoBloqueado,
  valorPorKgValido,
} from '../src/utils/forecastPrecoFechado';
import { forecastPrecoFechadoPutSchema } from '../src/validators/forecast';

// Dados SINTETICOS (repo publico). Regras do preco fechado do Forecast (valor + moeda + incoterm + validade).

const HOJE = '2026-11-17';
const completo = { valorPorKg: 1.8425, moeda: 'USD', incoterm: 'CFR', validoAte: '2026-12-31' };

describe('valorPorKgValido', () => {
  it.each([0.0001, 1, 1.8425, 1234.5678, PRECO_FECHADO_MAX])('aceita %s', (v) => {
    expect(valorPorKgValido(v)).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, PRECO_FECHADO_MAX + 1, 1.00001, 0.00004])('recusa %s', (v) => {
    expect(valorPorKgValido(v)).toBe(false);
  });

  it('nao recusa ruido de ponto flutuante (0,1 + 0,2)', () => {
    expect(valorPorKgValido(0.1 + 0.2)).toBe(true);
  });
});

describe('estadoDoPrecoFechado', () => {
  it('completo e dentro da validade = ok (o proprio dia da validade ainda vale)', () => {
    expect(estadoDoPrecoFechado(completo, HOJE)).toBe('ok');
    expect(estadoDoPrecoFechado({ ...completo, validoAte: HOJE }, HOJE)).toBe('ok');
  });

  it('um dia depois da validade = vencido', () => {
    expect(estadoDoPrecoFechado({ ...completo, validoAte: '2026-11-16' }, HOJE)).toBe('vencido');
  });

  it.each([
    ['sem valor', { valorPorKg: null }],
    ['sem moeda', { moeda: null }],
    ['sem incoterm', { incoterm: null }],
    ['sem validade', { validoAte: null }],
    ['moeda vazia', { moeda: '' }],
  ])('%s = sem_valor (so se envia PO com o preco completo)', (_nome, over) => {
    expect(estadoDoPrecoFechado({ ...completo, ...over }, HOJE)).toBe('sem_valor');
  });
});

describe('motivoDoPrecoBloqueado', () => {
  it('ok nao bloqueia', () => {
    expect(motivoDoPrecoBloqueado('ok', '2026-12-31')).toBeNull();
  });

  it('vencido cita a data em dd/mm/aaaa; sem valor pede o cadastro', () => {
    expect(motivoDoPrecoBloqueado('vencido', '2026-10-31')).toMatch(/venceu em 31\/10\/2026/);
    expect(motivoDoPrecoBloqueado('sem_valor', null)).toMatch(/ainda não foi cadastrado/);
  });
});

describe('forecastPrecoFechadoPutSchema', () => {
  const ok = { valorPorKg: 1.8425, moeda: 'USD', incoterm: 'CFR', validoAte: '2026-12-31' };

  it('aceita o preco completo e o limpar sozinho', () => {
    expect(forecastPrecoFechadoPutSchema.safeParse(ok).success).toBe(true);
    expect(forecastPrecoFechadoPutSchema.safeParse({ limpar: true }).success).toBe(true);
  });

  it.each([
    ['sem valor', { ...ok, valorPorKg: undefined }, /preço por kg/],
    ['valor zero', { ...ok, valorPorKg: 0 }, /preço por kg/],
    ['valor com 5 casas', { ...ok, valorPorKg: 1.23456 }, /4 casas/],
    ['valor como texto', { ...ok, valorPorKg: '1,5' }, /preço por kg/],
    ['sem moeda', { ...ok, moeda: undefined }, /moeda/i],
    ['moeda invalida', { ...ok, moeda: 'JPY' }, /Moeda inválida/],
    ['sem incoterm', { ...ok, incoterm: undefined }, /incoterm/i],
    ['incoterm invalido', { ...ok, incoterm: 'XYZ' }, /Incoterm inválido/],
    ['sem validade', { ...ok, validoAte: undefined }, /até quando/],
    ['validade que nao e data', { ...ok, validoAte: '31/12/2026' }, /até quando/],
    ['data impossivel', { ...ok, validoAte: '2026-02-30' }, /até quando/],
    ['limpar junto com termos', { limpar: true, valorPorKg: 1 }, /só limpar/],
    ['limpar false', { limpar: false }, /limpar/],
    ['chave desconhecida', { ...ok, fixedPrice: 3 }, /./],
    ['vazio', {}, /preço por kg/],
  ])('%s -> recusa com mensagem', (_nome, corpo, mensagem) => {
    const r = forecastPrecoFechadoPutSchema.safeParse(corpo);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toMatch(mensagem);
  });
});
