import { describe, expect, it } from 'vitest';
import { linhaDaRota } from './forecastLinhaDaRota';

// FZ2: a linha da rota /forecast/item/:linha e inteiro positivo em digitos; qualquer outra forma e item inexistente (NaN).
describe('linhaDaRota', () => {
  it.each([
    ['3', 3],
    ['12', 12],
    ['007', 7],
  ])('%s -> %i', (texto, esperado) => {
    expect(linhaDaRota(texto)).toBe(esperado);
  });

  it.each(['1e1', '0x3', ' 3', '3 ', '+3', '-3', '3.0', '3,0', '', '0', '00', 'abc', '3abc', '١٢', '99999999999999999999'])(
    '%j nao e linha (NaN)',
    (texto) => {
      expect(Number.isNaN(linhaDaRota(texto))).toBe(true);
    },
  );

  it('parametro ausente nao e linha', () => {
    expect(Number.isNaN(linhaDaRota(undefined))).toBe(true);
  });
});
