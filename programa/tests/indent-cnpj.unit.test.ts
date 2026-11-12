import { describe, expect, it } from 'vitest';
import { formatCnpj, isValidCnpj, normalizeCnpj } from '../src/utils/cnpj';

describe('IQ Indent - CNPJ', () => {
  it('normalizeCnpj deixa so digitos', () => {
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizeCnpj(' 11 222 333 0001 81 ')).toBe('11222333000181');
    expect(normalizeCnpj('')).toBe('');
  });

  it.each(['11.222.333/0001-81', '11222333000181', '45.997.418/0001-53', '00.000.000/0001-91'])(
    'aceita CNPJ valido %s (com ou sem mascara)',
    (cnpj) => {
      expect(isValidCnpj(cnpj)).toBe(true);
    },
  );

  it.each([
    ['digito verificador errado', '11.222.333/0001-82'],
    ['primeiro digito errado', '11.222.333/0001-91'],
    ['13 digitos', '1122233300018'],
    ['15 digitos', '112223330001811'],
    ['14 zeros', '00000000000000'],
    ['14 uns', '11111111111111'],
    ['vazio', ''],
    ['texto', 'abc'],
  ])('rejeita CNPJ invalido: %s', (_motivo, cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(false);
  });

  it('formatCnpj aplica a mascara 00.000.000/0000-00 e preserva entrada incompleta como digitos', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCnpj('11.222.333/0001-81')).toBe('11.222.333/0001-81');
    expect(formatCnpj('1122')).toBe('1122');
  });
});
