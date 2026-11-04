import { describe, expect, it } from 'vitest';
import { contemTermo, fatiar, normalizar, termoDeBusca, textoParaIndice } from './busca';

describe('Manual: busca (normalizacao)', () => {
  it('"Ação" = "acao" = "AÇÃO": sem acento e em minusculas', () => {
    expect(normalizar('Ação')).toBe('acao');
    expect(normalizar('AÇÃO')).toBe('acao');
    expect(normalizar('Alçada, aprovação e PTAX')).toBe('alcada, aprovacao e ptax');
  });

  it('termoDeBusca: normaliza, junta espacos e devolve vazio abaixo de 2 caracteres', () => {
    expect(termoDeBusca('  Lembrete ')).toBe('lembrete');
    expect(termoDeBusca('Ordem   de  Compra')).toBe('ordem de compra');
    expect(termoDeBusca('a')).toBe('');
    expect(termoDeBusca(' ç ')).toBe('');
    expect(termoDeBusca('PO')).toBe('po');
    expect(termoDeBusca('')).toBe('');
  });

  it('textoParaIndice: normaliza e colapsa quebras de linha e espacos', () => {
    expect(textoParaIndice('Criar  uma\n  Cotação ')).toBe('criar uma cotacao');
  });

  it('contemTermo: termo vazio acha tudo', () => {
    expect(contemTermo('qualquer coisa', '')).toBe(true);
    expect(contemTermo('qualquer coisa', 'coisa')).toBe(true);
    expect(contemTermo('qualquer coisa', 'outra')).toBe(false);
  });
});

describe('Manual: busca (fatias para o destaque)', () => {
  it('sem ocorrencia: uma fatia so, sem marca', () => {
    expect(fatiar('Enviar aos fornecedores', 'portal')).toEqual([{ texto: 'Enviar aos fornecedores', marca: false }]);
  });

  it('termo vazio ou texto vazio: devolve o texto sem marca', () => {
    expect(fatiar('Texto', '')).toEqual([{ texto: 'Texto', marca: false }]);
    expect(fatiar('', 'abc')).toEqual([{ texto: '', marca: false }]);
  });

  it('marca o trecho ORIGINAL (com acento e caixa) achado pelo termo normalizado', () => {
    expect(fatiar('Ação de Compra', 'acao')).toEqual([
      { texto: 'Ação', marca: true },
      { texto: ' de Compra', marca: false },
    ]);
    expect(fatiar('Preço mínimo', 'preco')).toEqual([
      { texto: 'Preço', marca: true },
      { texto: ' mínimo', marca: false },
    ]);
  });

  it('varias ocorrencias, no comeco, no meio e no fim', () => {
    expect(fatiar('link do Link e do LINK', 'link')).toEqual([
      { texto: 'link', marca: true },
      { texto: ' do ', marca: false },
      { texto: 'Link', marca: true },
      { texto: ' e do ', marca: false },
      { texto: 'LINK', marca: true },
    ]);
  });

  it('ocorrencias coladas nao se sobrepoem', () => {
    expect(fatiar('aaaa', 'aa')).toEqual([
      { texto: 'aa', marca: true },
      { texto: 'aa', marca: true },
    ]);
    expect(fatiar('aaa', 'aa')).toEqual([
      { texto: 'aa', marca: true },
      { texto: 'a', marca: false },
    ]);
  });

  it('termo com espaco acha dentro do mesmo texto', () => {
    expect(fatiar('Ordem de Compra enviada', 'de compra')).toEqual([
      { texto: 'Ordem ', marca: false },
      { texto: 'de Compra', marca: true },
      { texto: ' enviada', marca: false },
    ]);
  });

  it('as fatias juntas devolvem o texto original', () => {
    const texto = 'Aprovação acima da alçada: aprovacao pelo gestor (APROVAÇÃO).';
    const fatias = fatiar(texto, 'aprovacao');
    expect(fatias.map((f) => f.texto).join('')).toBe(texto);
    expect(fatias.filter((f) => f.marca).map((f) => f.texto)).toEqual(['Aprovação', 'aprovacao', 'APROVAÇÃO']);
  });

  it('texto ja decomposto (letra + acento combinante) tambem mantem o original inteiro', () => {
    const texto = 'Acao: ação de compra';
    const fatias = fatiar(texto, 'acao');
    expect(fatias.map((f) => f.texto).join('')).toBe(texto);
    expect(fatias.filter((f) => f.marca)).toHaveLength(2);
  });
});
