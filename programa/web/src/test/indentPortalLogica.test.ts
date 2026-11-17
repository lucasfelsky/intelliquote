// Funcoes puras de public/indent-portal.js (validacao, payload, preenchimento, formatos, token). O JS real e carregado como modulo CommonJS:
// sem #ip-app no documento o boot nao roda. Os fluxos de tela ficam em indentPortalHtml.test.ts.
import { describe, expect, it } from 'vitest';
import indentJs from '../../../public/indent-portal.js?raw';

type Fn = (...args: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const mod = { exports: {} as Record<string, Fn> };
new Function('module', indentJs)(mod);
const L = mod.exports;

const PACKAGING = ['25 kg bag', '50 kg bag', '200 kg drum', '1,000 kg IBC', 'Bulk'];
const PAYMENT = ['T/T 30 days after B/L date', 'T/T 60 days after B/L date', 'L/C at sight'];
const TODAY = '2026-11-17';
const view = (overrides: Record<string, unknown> = {}) => ({
  state: 'open',
  currency: 'USD',
  manufacturerRequired: false,
  items: [
    { quoteItemId: 201, quantityKg: '25000.000' },
    { quoteItemId: 202, quantityKg: '10000.000' },
  ],
  previousOffer: null,
  response: null,
  options: { packaging: PACKAGING, paymentTerms: PAYMENT, currencies: ['USD', 'EUR'] },
  ...overrides,
});
const good = (overrides: Record<string, unknown> = {}) => ({
  cur: 'USD',
  lead: '20',
  pay: PAYMENT[0],
  valid: '2026-12-01',
  maker: '',
  notes: '',
  items: [
    { pkg: '25 kg bag', fob: '0.72', cfr: '0.795' },
    { pkg: '50 kg bag', fob: '0.94', cfr: '1.015' },
  ],
  ...overrides,
});

describe('validateOffer', () => {
  it('oferta completa: nenhum erro', () => {
    expect(L.validateOffer!(good(), view(), TODAY)).toEqual({});
  });

  it('cada regra gera a mensagem em ingles no id do mock', () => {
    const empty = { cur: 'USD', lead: '', pay: '', valid: '', maker: '', notes: '', items: [{ pkg: '', fob: '', cfr: '' }, { pkg: '', fob: '', cfr: '' }] };

    expect(L.validateOffer!(empty, view({ manufacturerRequired: true }), TODAY)).toEqual({
      pkg0: 'Choose the packaging.',
      fob0: 'Enter the FOB price.',
      cfr0: 'Enter the CFR price.',
      pkg1: 'Choose the packaging.',
      fob1: 'Enter the FOB price.',
      cfr1: 'Enter the CFR price.',
      lead: 'Enter the lead time in days.',
      pay: 'Choose the payment terms.',
      valid: 'Enter the validity date.',
      maker: 'Please inform the manufacturer.',
    });
  });

  it('fabricante so e exigido quando manufacturerRequired; espacos nao contam', () => {
    expect(L.validateOffer!(good({ maker: '   ' }), view({ manufacturerRequired: true }), TODAY)).toEqual({ maker: 'Please inform the manufacturer.' });
    expect(L.validateOffer!(good({ maker: ' ACME ' }), view({ manufacturerRequired: true }), TODAY)).toEqual({});
    expect(L.validateOffer!(good({ maker: '' }), view(), TODAY)).toEqual({});
  });

  it('precos: zero, 5 casas, formato invalido e CFR < FOB; CFR == FOB vale; virgula vale; comparacao sem float', () => {
    const items = (fob: string, cfr: string) => ({ items: [{ pkg: '25 kg bag', fob, cfr }, good().items[1]] });
    const run = (fob: string, cfr: string) => L.validateOffer!(good(items(fob, cfr)), view(), TODAY);

    expect(run('0', '0.5')).toEqual({ fob0: 'The price must be greater than zero.' });
    expect(run('0.5', '0.0000')).toEqual({ cfr0: 'The price must be greater than zero.' });
    expect(run('0.12345', '1')).toEqual({ fob0: 'Use up to 4 decimal places.' });
    expect(run('1', '1,23456')).toEqual({ cfr0: 'Use up to 4 decimal places.' });
    expect(run('abc', '1')).toEqual({ fob0: 'Enter the FOB price.' });
    expect(run('-1', '1')).toEqual({ fob0: 'Enter the FOB price.' });
    expect(run('1.0001', '1')).toEqual({ cfr0: 'CFR cannot be lower than FOB.' });
    expect(run('1', '1.0000')).toEqual({});
    expect(run('1,5', '1.5')).toEqual({});
    expect(run('0.1', '0.3')).toEqual({});
    expect(run('0.3', '0.1')).toEqual({ cfr0: 'CFR cannot be lower than FOB.' });
    expect(run('99999.9999', '99999.9999')).toEqual({});
  });

  it('prazo de producao: 1 a 365, so inteiros', () => {
    const lead = (value: string) => L.validateOffer!(good({ lead: value }), view(), TODAY).lead;

    expect(lead('1')).toBeUndefined();
    expect(lead('365')).toBeUndefined();
    expect(lead(' 20 ')).toBeUndefined();
    for (const bad of ['0', '366', '-3', '2.5', 'vinte', '1e2']) {
      expect(lead(bad), bad).toBe('Production lead time must be 1 to 365 days.');
    }
  });

  it('validade: hoje e hoje+365 valem; ontem, +366 e data impossivel nao', () => {
    const valid = (value: string) => L.validateOffer!(good({ valid: value }), view(), TODAY).valid;
    const msg = 'The validity must be between today and 365 days from today.';

    expect(valid(TODAY)).toBeUndefined();
    expect(valid('2027-11-17')).toBeUndefined();
    expect(valid('2026-11-16')).toBe(msg);
    expect(valid('2027-11-18')).toBe(msg);
    expect(valid('2026-02-30')).toBe(msg);
    expect(valid('17/11/2026')).toBe(msg);
  });
});

describe('prefillForm', () => {
  const offer = {
    currency: 'EUR',
    productionLeadTimeDays: 25,
    paymentTerms: PAYMENT[1],
    validUntil: '2026-12-10',
    manufacturer: 'Own plant',
    notes: 'ignored on revision',
    items: [
      { quoteItemId: 202, packaging: '200 kg drum', fobPricePerKg: '0.9400', cfrPricePerKg: '1.0150' },
      { quoteItemId: 201, packaging: '40 kg bag', fobPricePerKg: '0.7200', cfrPricePerKg: '0.7954' },
    ],
  };

  it('pedido novo: tudo em branco e moeda da cotacao', () => {
    expect(L.prefillForm!(view({ currency: 'EUR' }))).toEqual({
      cur: 'EUR',
      lead: '',
      pay: '',
      valid: '',
      maker: '',
      notes: '',
      items: [{ pkg: '', fob: '', cfr: '' }, { pkg: '', fob: '', cfr: '' }],
    });
  });

  it('revisao: usa a oferta anterior casando por quoteItemId; embalagem fora das opcoes fica vazia; notas nao vem', () => {
    expect(L.prefillForm!(view({ state: 'revision', previousOffer: offer }))).toEqual({
      cur: 'EUR',
      lead: '25',
      pay: PAYMENT[1],
      valid: '2026-12-10',
      maker: 'Own plant',
      notes: '',
      items: [{ pkg: '', fob: '0.720', cfr: '0.7954' }, { pkg: '200 kg drum', fob: '0.940', cfr: '1.015' }],
    });
  });

  it('enviado (edicao): usa a resposta, inclusive as notas; pagamento fora das opcoes fica vazio', () => {
    const form = L.prefillForm!(view({ state: 'sent', response: { ...offer, paymentTerms: 'Net 7' } }));

    expect(form.notes).toBe('ignored on revision');
    expect(form.pay).toBe('');
    expect(form.cur).toBe('EUR');
  });

  it('moeda fora de options.currencies nunca vira valor do select: cai na da cotacao e, depois, na 1a opcao', () => {
    expect(L.prefillForm!(view({ state: 'revision', previousOffer: { ...offer, currency: 'GBP' }, currency: 'EUR' })).cur).toBe('EUR');
    expect(L.prefillForm!(view({ currency: 'JPY' })).cur).toBe('USD');
    expect(L.prefillForm!(view({ state: 'sent', response: { ...offer, currency: 'XXX' }, currency: 'XXX' })).cur).toBe('USD');
  });

  it('revisao sem oferta anterior (nao achou a cotacao antiga): formulario em branco, sem quebrar', () => {
    expect(L.prefillForm!(view({ state: 'revision', previousOffer: null })).items).toEqual([{ pkg: '', fob: '', cfr: '' }, { pkg: '', fob: '', cfr: '' }]);
  });
});

describe('buildPayload', () => {
  it('corpo exato: numeros, textos aparados, null para vazio, itens na ordem da view', () => {
    const form = good({ lead: ' 20 ', maker: '  ACME ', notes: '  ', items: [{ pkg: '25 kg bag', fob: '0,72', cfr: '0.795' }, { pkg: '50 kg bag', fob: '0.94', cfr: '1.0150' }] });

    expect(L.buildPayload!(form, view())).toEqual({
      currency: 'USD',
      productionLeadTimeDays: 20,
      paymentTerms: PAYMENT[0],
      validUntil: '2026-12-01',
      manufacturer: 'ACME',
      notes: null,
      items: [
        { quoteItemId: 201, packaging: '25 kg bag', fobPricePerKg: '0.72', cfrPricePerKg: '0.795' },
        { quoteItemId: 202, packaging: '50 kg bag', fobPricePerKg: '0.94', cfrPricePerKg: '1.0150' },
      ],
    });
  });
});

describe('screenForError', () => {
  it('404 invalid; 410 expired so com LINK_EXPIRED, o resto closed; 429 locked so com LOCKED, o resto busy; demais error', () => {
    expect(L.screenForError!(404, { code: 'LINK_INVALID' })).toBe('invalid');
    expect(L.screenForError!(404, null)).toBe('invalid');
    expect(L.screenForError!(410, { code: 'LINK_EXPIRED' })).toBe('expired');
    expect(L.screenForError!(410, { code: 'LINK_CLOSED' })).toBe('closed');
    expect(L.screenForError!(410, null)).toBe('closed');
    expect(L.screenForError!(429, { code: 'LOCKED' })).toBe('locked');
    expect(L.screenForError!(429, { message: 'slow down' })).toBe('busy');
    for (const status of [0, 400, 500, 502]) {
      expect(L.screenForError!(status, { message: 'x' })).toBe('error');
    }
  });
});

describe('formatos (en-GB, America/Sao_Paulo)', () => {
  it('formatKg, formatPrice e formatMoney', () => {
    expect(L.formatKg!('25000.000')).toBe('25,000 kg');
    expect(L.formatKg!('12.5')).toBe('12.5 kg');
    expect(L.formatPrice!('0.7200')).toBe('0.720');
    expect(L.formatPrice!('0.7254')).toBe('0.7254');
    expect(L.formatMoney!(30025, 'USD')).toBe('US$ 30,025.00');
    expect(L.formatMoney!(1000.5, 'EUR')).toBe('€ 1,000.50');
  });

  it('formatDate e formatDateTime usam o fuso de Sao Paulo (perto da meia-noite UTC) e nomes de mes fixos', () => {
    expect(L.formatDate!('2026-11-26T14:00:00.000Z')).toBe('26 Nov 2026');
    expect(L.formatDate!('2026-11-27T02:30:00.000Z')).toBe('26 Nov 2026');
    expect(L.formatDate!('2026-09-05T12:00:00.000Z')).toBe('5 Sep 2026');
    expect(L.formatDateTime!('2026-11-12T18:42:00.000Z')).toBe('12 Nov 2026, 15:42');
    expect(L.formatDateTime!('2026-11-12T03:05:00.000Z')).toBe('12 Nov 2026, 00:05');
    expect(L.formatDate!('nao e data')).toBe('');
  });
});

describe('readToken', () => {
  const token = 'A'.repeat(43);
  const store = (value: string | null) => ({ getItem: () => value });
  const loc = (search: string) => ({ search });

  it('?token= valido vence o storage; sem o parametro usa o storage; sem nenhum, null', () => {
    expect(L.readToken!(loc(`?token=${token}&v=2`), store('B'.repeat(43)))).toEqual({ token, fromUrl: true });
    expect(L.readToken!(loc(''), store(token))).toEqual({ token, fromUrl: false });
    expect(L.readToken!(loc(''), store(null))).toBeNull();
    expect(L.readToken!(loc(''), null)).toBeNull();
  });

  it('parametro presente e invalido nao cai no storage; token de storage invalido e ignorado', () => {
    expect(L.readToken!(loc('?token=curto'), store(token))).toBeNull();
    expect(L.readToken!(loc(''), store('curto'))).toBeNull();
  });

  it('storage que lanca (bloqueado) nao quebra', () => {
    const blocked = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    };

    expect(L.readToken!(loc(''), blocked)).toBeNull();
    expect(L.readToken!(loc(`?token=${token}`), blocked)).toEqual({ token, fromUrl: true });
  });
});
