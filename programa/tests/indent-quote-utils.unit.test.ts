import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  ACTIONS_BLOCKED_AFTER_ACCEPT,
  QUOTE_TRANSITIONS,
  allowedQuoteActions,
  computeQuoteTotal,
  formatQuoteRef,
  isOpenQuote,
  parsePricePerKg,
} from '../src/utils/indentQuote';

// Regras puras das cotacoes do IQ Indent (PR 3).

describe('formatQuoteRef', () => {
  it('R1 = numero da solicitacao; R2 e R3 ganham o prefixo', () => {
    expect(formatQuoteRef('270/26', 1)).toBe('270/26');
    expect(formatQuoteRef('270/26', 2)).toBe('R2 - 270/26');
    expect(formatQuoteRef('270/26', 3)).toBe('R3 - 270/26');
  });
});

describe('QUOTE_TRANSITIONS', () => {
  it('tabela completa da maquina de estados', () => {
    expect(QUOTE_TRANSITIONS).toEqual({
      'mark-sent': ['RASCUNHO'],
      items: ['RASCUNHO'],
      response: ['ENVIADA'],
      accept: ['RESPONDIDA'],
      refuse: ['RESPONDIDA'],
      revision: ['RESPONDIDA'],
    });
    expect(ACTIONS_BLOCKED_AFTER_ACCEPT).toEqual(['mark-sent', 'items', 'accept', 'revision']);
  });

  it('isOpenQuote: so RASCUNHO e ENVIADA', () => {
    expect(['RASCUNHO', 'ENVIADA'].every(isOpenQuote)).toBe(true);
    expect(['RESPONDIDA', 'ACEITA', 'RECUSADA', 'REVISADA'].some(isOpenQuote)).toBe(false);
  });
});

describe('allowedQuoteActions', () => {
  it('por status, com escrita e sem aceite na solicitacao', () => {
    expect(allowedQuoteActions('RASCUNHO', true, 'COTACAO', false)).toEqual(['mark-sent', 'items']);
    expect(allowedQuoteActions('ENVIADA', true, 'COTACAO', false)).toEqual(['response']);
    expect(allowedQuoteActions('RESPONDIDA', true, 'RESPONDIDA', false)).toEqual(['accept', 'refuse', 'revision']);
    expect(allowedQuoteActions('ACEITA', true, 'CONVERTIDA', true)).toEqual([]);
    expect(allowedQuoteActions('RECUSADA', true, 'COTACAO', false)).toEqual([]);
    expect(allowedQuoteActions('REVISADA', true, 'COTACAO', false)).toEqual([]);
  });

  it('viewer (sem escrita) e solicitacao PERDIDA: nenhuma acao', () => {
    expect(allowedQuoteActions('RESPONDIDA', false, 'COTACAO', false)).toEqual([]);
    expect(allowedQuoteActions('RESPONDIDA', true, 'PERDIDA', false)).toEqual([]);
    expect(allowedQuoteActions('RASCUNHO', true, 'PERDIDA', false)).toEqual([]);
  });

  it('com ACEITA na solicitacao: RESPONDIDA so recusa, ENVIADA so registra a resposta, RASCUNHO nada', () => {
    expect(allowedQuoteActions('RESPONDIDA', true, 'CONVERTIDA', true)).toEqual(['refuse']);
    expect(allowedQuoteActions('ENVIADA', true, 'CONVERTIDA', true)).toEqual(['response']);
    expect(allowedQuoteActions('RASCUNHO', true, 'CONVERTIDA', true)).toEqual([]);
    expect(allowedQuoteActions('ACEITA', true, 'CONVERTIDA', true)).toEqual([]);
  });
});

describe('computeQuoteTotal', () => {
  it('soma quantidade x CFR em Decimal (25000 kg x 0,795 = 19875.00)', () => {
    expect(computeQuoteTotal([{ quantityKg: '25000', cfrPricePerKg: '0.7950' }])).toBe('19875.00');
    expect(
      computeQuoteTotal([
        { quantityKg: new Prisma.Decimal('25000'), cfrPricePerKg: new Prisma.Decimal('0.795') },
        { quantityKg: 500.5, cfrPricePerKg: '1.1234' },
      ]),
    ).toBe('20437.26');
  });

  it('parcial: ignora item sem CFR; nenhum CFR = null', () => {
    expect(
      computeQuoteTotal([
        { quantityKg: '1000', cfrPricePerKg: '2.5' },
        { quantityKg: '300', cfrPricePerKg: null },
      ]),
    ).toBe('2500.00');
    expect(computeQuoteTotal([{ quantityKg: '1000', cfrPricePerKg: null }])).toBeNull();
    expect(computeQuoteTotal([])).toBeNull();
  });
});

describe('parsePricePerKg', () => {
  it('aceita ate 5 inteiros e 4 casas, maior que zero', () => {
    expect(parsePricePerKg('0.795')?.toFixed(4)).toBe('0.7950');
    expect(parsePricePerKg('0.7955')?.toFixed(4)).toBe('0.7955');
    expect(parsePricePerKg('99999.9999')?.toFixed(4)).toBe('99999.9999');
  });

  it('recusa 5 casas, zero, negativo, virgula, texto e acima de 99999', () => {
    for (const invalid of ['0.79555', '0', '0.0000', '-1', '0,795', 'abc', '', '100000', ' 1', 1, null, undefined]) {
      expect(parsePricePerKg(invalid), String(invalid)).toBeNull();
    }
  });
});
