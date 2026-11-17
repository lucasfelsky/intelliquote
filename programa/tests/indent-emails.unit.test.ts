import { describe, expect, it } from 'vitest';
import { normalizeEmailList, normalizeEmailListLenient } from '../src/utils/indentEmails';

describe('normalizeEmailList', () => {
  it('quebra a string, normaliza caixa e remove duplicados mantendo a ordem', () => {
    expect(normalizeEmailList('A@X.COM, a@x.com ; b@y.com')).toEqual({ emails: ['a@x.com', 'b@y.com'] });
  });

  it('aceita lista e separa por espaco e quebra de linha', () => {
    expect(normalizeEmailList([' A@x.test ', 'b@y.test', 'A@X.test'])).toEqual({ emails: ['a@x.test', 'b@y.test'] });
    expect(normalizeEmailList('a@x.test\nb@y.test c@z.test')).toEqual({ emails: ['a@x.test', 'b@y.test', 'c@z.test'] });
  });

  it('um e-mail invalido derruba a lista inteira', () => {
    expect(normalizeEmailList('a@x.test, nao-e-email')).toEqual({ error: 'invalid' });
    expect(normalizeEmailList(['a@x.test', 'b@'])).toEqual({ error: 'invalid' });
  });

  it('mais de 10 e-mails validos vira too_many; 10 passam', () => {
    const ten = Array.from({ length: 10 }, (_, index) => `u${index}@x.test`);
    expect(normalizeEmailList(ten)).toEqual({ emails: ten });
    expect(normalizeEmailList([...ten, 'u10@x.test'])).toEqual({ error: 'too_many' });
  });

  it('null, undefined e vazio viram lista vazia', () => {
    expect(normalizeEmailList(null)).toEqual({ emails: [] });
    expect(normalizeEmailList(undefined)).toEqual({ emails: [] });
    expect(normalizeEmailList('')).toEqual({ emails: [] });
    expect(normalizeEmailList('  ,; ')).toEqual({ emails: [] });
  });
});

describe('normalizeEmailListLenient', () => {
  it('descarta invalidos, nulos e duplicados', () => {
    expect(normalizeEmailListLenient(['A@x.test', null, 'lixo', 'a@x.test', undefined, 'b@y.test'])).toEqual([
      'a@x.test',
      'b@y.test',
    ]);
  });

  it('corta em 10', () => {
    const many = Array.from({ length: 14 }, (_, index) => `u${index}@x.test`);
    expect(normalizeEmailListLenient(many)).toEqual(many.slice(0, 10));
  });

  it('vazio devolve lista vazia', () => {
    expect(normalizeEmailListLenient([])).toEqual([]);
    expect(normalizeEmailListLenient([null, ''])).toEqual([]);
  });
});
