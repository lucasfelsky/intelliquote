import { describe, expect, it } from 'vitest';
import { formatCnpj, isValidCnpj, maskCnpjInput, normalizeCnpj } from './cnpj';

describe('IQ Indent - CNPJ (copia do backend)', () => {
  it('normalizeCnpj deixa so digitos', () => {
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizeCnpj(' 11 222 333 0001 81 ')).toBe('11222333000181');
  });

  it.each(['11.222.333/0001-81', '11222333000181', '45.997.418/0001-53'])('aceita %s', (cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(true);
  });

  it.each(['11.222.333/0001-82', '1122233300018', '112223330001811', '00000000000000', '11111111111111', '', 'abc'])(
    'rejeita %s',
    (cnpj) => {
      expect(isValidCnpj(cnpj)).toBe(false);
    },
  );

  it('formatCnpj aplica 00.000.000/0000-00 so com 14 digitos', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCnpj('1122')).toBe('1122');
  });

  it('maskCnpjInput aplica a mascara enquanto digita e corta em 14 digitos', () => {
    expect(maskCnpjInput('1')).toBe('1');
    expect(maskCnpjInput('112')).toBe('11.2');
    expect(maskCnpjInput('1122233')).toBe('11.222.33');
    expect(maskCnpjInput('112223330001')).toBe('11.222.333/0001');
    expect(maskCnpjInput('11222333000181')).toBe('11.222.333/0001-81');
    expect(maskCnpjInput('11.222.333/0001-81999')).toBe('11.222.333/0001-81');
    expect(maskCnpjInput('')).toBe('');
  });

  it('formatCnpj(null) (CNPJ pendente) devolve vazio, sem quebrar', () => {
    expect(formatCnpj(null)).toBe('');
    expect(formatCnpj('')).toBe('');
  });
});
