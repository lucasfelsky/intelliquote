import { describe, expect, it } from 'vitest';
import type { IndentQuoteRow } from '@/services/indentQuotes';
import {
  QUOTE_STATUS,
  acceptedNotice,
  cfrHeader,
  firstWords,
  formatDateKey,
  formatMoney,
  formatPricePerKg,
  formatQuantityKg,
  groupQuotes,
  incotermLine,
  initials,
  observationText,
  parsePriceInput,
  todayKeyBr,
  estimateTotal,
} from './indentCotacao';

function linha(id: number, overrides: Partial<IndentQuoteRow> = {}): IndentQuoteRow {
  return {
    id,
    ref: '270/26',
    revision: 1,
    status: 'RASCUNHO',
    requestId: 11,
    processNumber: '270/26',
    requestStatus: 'COTACAO',
    client: { id: 3, name: 'Cliente Exemplo Ltda', city: 'Itajaí' },
    supplier: { id: 5, name: 'Acme Chemicals', country: 'China', contactName: 'Li Wei', hasPartnership: true },
    itemsSummary: { firstName: 'Zinco', count: 1 },
    currency: 'USD',
    total: null,
    validUntil: null,
    exception: null,
    createdAt: `2026-11-${String(10 + id).padStart(2, '0')}T12:00:00.000Z`,
    ...overrides,
  };
}

describe('QUOTE_STATUS', () => {
  it('rotulo e badge do mock', () => {
    expect(QUOTE_STATUS.RASCUNHO).toEqual({ rotulo: 'Rascunho', classe: 'badge badge--dot badge--muted' });
    expect(QUOTE_STATUS.ENVIADA.classe).toContain('badge--info');
    expect(QUOTE_STATUS.RESPONDIDA.classe).toContain('badge--warning');
    expect(QUOTE_STATUS.ACEITA.classe).toContain('badge--success');
    expect(QUOTE_STATUS.RECUSADA.classe).toContain('badge--danger');
    expect(QUOTE_STATUS.REVISADA.classe).toContain('badge--muted');
  });
});

describe('formatos pt-BR', () => {
  it('formatMoney: simbolo por moeda, milhar e 2 casas; null = "—"', () => {
    expect(formatMoney('19875.00', 'USD')).toBe('US$ 19.875,00');
    expect(formatMoney('1234567.5', 'EUR')).toBe('€ 1.234.567,50');
    expect(formatMoney('0.00', 'USD')).toBe('US$ 0,00');
    expect(formatMoney(null, 'USD')).toBe('—');
  });

  it('formatPricePerKg: minimo 3 e maximo 4 casas; null = "—"', () => {
    expect(formatPricePerKg('0.7950')).toBe('0,795');
    expect(formatPricePerKg('0.7955')).toBe('0,7955');
    expect(formatPricePerKg('2.1000')).toBe('2,100');
    expect(formatPricePerKg('1234.5000')).toBe('1.234,500');
    expect(formatPricePerKg(null)).toBe('—');
  });

  it('formatQuantityKg', () => {
    expect(formatQuantityKg('25000.000')).toBe('25.000');
    expect(formatQuantityKg('1000.500')).toBe('1.000,5');
    expect(formatQuantityKg('0.125')).toBe('0,125');
  });

  it('formatDateKey: dd/mm na lista e dd/mm/aaaa na gaveta, sem passar por Date', () => {
    expect(formatDateKey('2026-11-26', 'curta')).toBe('26/11');
    expect(formatDateKey('2026-11-26', 'longa')).toBe('26/11/2026');
    expect(formatDateKey(null, 'curta')).toBe('—');
  });
});

describe('parsePriceInput', () => {
  it('converte "0,795" em "0.795" e aceita ponto', () => {
    expect(parsePriceInput('0,795')).toBe('0.795');
    expect(parsePriceInput(' 0.7955 ')).toBe('0.7955');
    expect(parsePriceInput('12')).toBe('12');
    expect(parsePriceInput('99999,9999')).toBe('99999.9999');
  });

  it('recusa 5 casas, zero, negativo, texto, milhar e acima de 99999', () => {
    for (const invalido of ['0,79555', '0', '0,0000', '-1', 'abc', '', '1.234,5', '100000', '1,', ',5', '1,2,3']) {
      expect(parsePriceInput(invalido), invalido).toBeNull();
    }
  });
});

describe('initials', () => {
  it('palavras com inicial maiuscula, ate 2', () => {
    expect(initials('Acme Chemicals')).toBe('AC');
    expect(initials('Cliente Exemplo Ltda')).toBe('CE');
    expect(initials('zhejiang Chem Co')).toBe('CC');
    expect(initials('Único')).toBe('Ú');
    expect(initials('abc')).toBe('');
  });
});

describe('groupQuotes', () => {
  const linhas = [
    linha(1, { status: 'RESPONDIDA', exception: { reason: 'X' } }),
    linha(2, { supplier: { id: 6, name: 'Zeta Corp', country: 'Índia', contactName: null, hasPartnership: false }, status: 'ENVIADA' }),
    linha(3, { client: { id: 4, name: 'Beta Ltda', city: null }, status: 'ACEITA' }),
    linha(4, { status: 'REVISADA' }),
  ];

  it('por fornecedor: nome pt-BR, sub "Pais · Contato", avatar, sem parceria, contagens e linhas da mais recente para a mais antiga', () => {
    const grupos = groupQuotes(linhas, 'fornecedor');

    expect(grupos.map((g) => g.titulo)).toEqual(['Acme Chemicals', 'Zeta Corp']);
    expect(grupos[0]).toMatchObject({ sub: 'China · Li Wei', avatar: 'AC', semParceria: false, comExcecao: 1, emAberto: 0 });
    expect(grupos[0]!.linhas.map((l) => l.id)).toEqual([4, 3, 1]);
    expect(grupos[1]).toMatchObject({ sub: 'Índia', avatar: 'ZC', semParceria: true, comExcecao: 0, emAberto: 1 });
  });

  it('por cliente: cidade como sub e sem selo de parceria', () => {
    const grupos = groupQuotes(linhas, 'cliente');

    expect(grupos.map((g) => g.titulo)).toEqual(['Beta Ltda', 'Cliente Exemplo Ltda']);
    expect(grupos[0]).toMatchObject({ sub: null, semParceria: false });
    expect(grupos[1]).toMatchObject({ sub: 'Itajaí', semParceria: false });
  });

  it('por status: ordem Rascunho, Enviada, Respondida, Aceita, Recusada, Revisada; sem avatar nem sub', () => {
    const grupos = groupQuotes(linhas, 'status');

    expect(grupos.map((g) => g.titulo)).toEqual(['Enviada', 'Respondida', 'Aceita', 'Revisada']);
    expect(grupos.every((g) => g.avatar === null && g.sub === null)).toBe(true);
  });

  it('lista vazia = nenhum grupo', () => {
    expect(groupQuotes([], 'fornecedor')).toEqual([]);
  });
});

describe('acceptedNotice', () => {
  const aceita = { id: 9, ref: '270/26', supplierName: 'Beta Corp' };
  const base = 'A solicitação 270/26 já tem uma cotação aceita: 270/26 · Beta Corp. Esta cotação não pode mais ser aceita nem revisada.';

  it('3 variacoes por status da propria cotacao', () => {
    expect(acceptedNotice({ acceptedQuote: aceita, processNumber: '270/26', status: 'RESPONDIDA' })).toBe(`${base} Você ainda pode recusá-la.`);
    expect(acceptedNotice({ acceptedQuote: aceita, processNumber: '270/26', status: 'ENVIADA' })).toBe(
      `${base} Você ainda pode registrar a resposta do fornecedor, para histórico.`,
    );
    expect(acceptedNotice({ acceptedQuote: aceita, processNumber: '270/26', status: 'RASCUNHO' })).toBe(`${base} Ela não será enviada.`);
    expect(acceptedNotice({ acceptedQuote: aceita, processNumber: '270/26', status: 'RECUSADA' })).toBe(base);
  });

  it('sem OUTRA cotacao aceita (inclui a propria ACEITA) = sem aviso', () => {
    expect(acceptedNotice({ acceptedQuote: null, processNumber: '270/26', status: 'ACEITA' })).toBeNull();
  });
});

describe('textos da gaveta', () => {
  it('cabecalho CFR, linha de Incoterm e Observacao', () => {
    expect(cfrHeader('Itajaí')).toBe('CFR Itajaí');
    expect(cfrHeader(null)).toBe('CFR');
    expect(incotermLine('Itajaí')).toBe('FOB origem e CFR Itajaí');
    expect(incotermLine(null)).toBe('FOB origem e CFR (destino a definir)');
    expect(observationText('Fab X', 'Embarque em 20 dias')).toBe('Fabricante: Fab X · Embarque em 20 dias');
    expect(observationText('Fab X', null)).toBe('Fabricante: Fab X');
    expect(observationText(null, 'Obs')).toBe('Obs');
    expect(observationText(null, null)).toBeNull();
    expect(firstWords('Cliente Exemplo Ltda Sul')).toBe('Cliente Exemplo Ltda');
  });
});

describe('todayKeyBr e estimateTotal', () => {
  it('todayKeyBr usa o dia de Sao Paulo (02:00Z ainda e o dia anterior em BRT)', () => {
    expect(todayKeyBr(new Date('2026-11-13T02:00:00.000Z'))).toBe('2026-11-12');
    expect(todayKeyBr(new Date('2026-11-13T15:00:00.000Z'))).toBe('2026-11-13');
  });

  it('estimateTotal soma quantidade x CFR digitado e ignora o que nao e preco valido', () => {
    expect(estimateTotal([{ quantityKg: '25000.000', cfr: '0,795' }])).toBe('19875.00');
    expect(
      estimateTotal([
        { quantityKg: '1000.000', cfr: '2,5' },
        { quantityKg: '300.000', cfr: '' },
        { quantityKg: '300.000', cfr: 'abc' },
      ]),
    ).toBe('2500.00');
    expect(estimateTotal([{ quantityKg: '1000.000', cfr: '' }])).toBeNull();
  });
});
