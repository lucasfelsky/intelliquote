// O codigo interno da cotacao (requestCode) e o id numerico (quoteRequestId) nunca podem
// aparecer para o fornecedor/parceiro de credito: preheader, corpo HTML, texto puro,
// assunto e <title>. Vale para o arquivo-fallback E para templates salvos no banco
// (onde {{requestCode}} vira string vazia). E-mails INTERNOS ficam de fora.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTemplate = vi.fn();
vi.mock('../src/services/EmailTemplateService', () => ({
  EmailTemplateService: { get: (...args: unknown[]) => getTemplate(...args) },
}));

import { renderDispatchFromTemplate } from '../src/mailer/renderQuoteDispatch';
import { renderReplyFromTemplate } from '../src/mailer/renderQuoteReply';
import { renderPoFromTemplate } from '../src/mailer/renderQuotePo';
import { renderReminderFromTemplate } from '../src/mailer/renderQuoteReminder';
import { renderReminderDigest } from '../src/mailer/renderQuoteReminderDigest';
import { renderRegretFromTemplate } from '../src/mailer/renderQuoteRegret';
import { renderCreditSupportFromTemplate } from '../src/mailer/renderCreditSupportRequest';
import { omitRequestCode, stripRequestCode } from '../src/mailer/supplierFacing';

const CODE = 'SEA-VP-17112026';
const QUOTE_ID = 4242;
const LEAK = { requestCode: CODE, quoteRequestId: QUOTE_ID } as Record<string, unknown>;

// Template do banco que insiste em usar o codigo no assunto, no HTML e no texto.
const DB_SUBJECT = 'Assunto {{requestCode}} #{{quoteRequestId}} fim';
const DB_HTML =
  '<html><head><title>{{subject}}</title></head><body>' +
  '<div>Preheader {{requestCode}} / Quote #{{quoteRequestId}}</div>' +
  '<p>Ref: {{requestCode}}</p><p>{{message}}</p>{{senderSignature}}</body></html>';
const DB_TEXT = 'Ref {{requestCode}} #{{quoteRequestId}} {{subject}}';

function dbTemplate() {
  return { subject: DB_SUBJECT, htmlBody: DB_HTML, textBody: DB_TEXT, isActive: true };
}

function expectNoCode(out: { subject?: string; html: string; text: string }) {
  for (const [label, value] of Object.entries(out)) {
    if (typeof value !== 'string') continue;
    expect(value, label).not.toContain(CODE);
    expect(value, label).not.toContain('{{requestCode}}');
    expect(value, label).not.toContain('Quote #4242');
    expect(value, label).not.toContain(String(QUOTE_ID));
  }
}

const dispatchVars = {
  subject: 'Sourcing request - Photoiniator',
  supplierContactName: 'John',
  productName: 'Photoiniator',
  quantity: 10,
  unit: 'KG',
  desiredIncoterm: 'CIF',
  currency: 'USD',
  deadlineAt: '01 Jan 2027',
  expiresAt: '15 Jan 2027',
  portalLink: 'https://portal.example/portal?token=abc&v=1',
  companyName: 'SQ Quimica',
  purchasingEmail: 'comex@sq.example',
  items: [{ marketName: 'PI-TPO', quantity: 10, unit: 'KG' }],
};

const replyVars = {
  subject: 'Photoiniator - SQ QUIMICA - Acme',
  productName: 'Photoiniator',
  supplierName: 'Acme',
  supplierContactName: 'John',
  currency: 'USD',
  isWinner: false,
  hasItemTargets: false,
  portalLink: 'https://portal.example/portal?token=abc&v=1',
  items: [{ name: 'PI-TPO', incoterm: 'CIF', quantity: 500, unit: 'KG', unitPrice: 4.99, targetPrice: null }],
};

const poVars = {
  subject: 'Purchase Order - Photoiniator',
  supplierContactName: 'John',
  forwarderInfo: 'Global Forwarders',
  destinationPort: 'SANTOS, BRAZIL',
  message: 'Please confirm.',
  senderName: 'Maria',
  senderEmail: 'maria@sq.example',
};

const reminderVars = {
  subject: 'Reminder: quotation for Photoiniator closes on 10 Nov 2026',
  contactName: 'Li Wei',
  supplierName: 'Shanghai Chem',
  productName: 'Photoiniator',
  expiresAt: '10 Nov 2026',
  portalLink: 'https://portal.example/portal?token=abc&v=1',
  companyName: 'SQ Quimica',
};

const regretVars = {
  subject: 'Update on your quotation for Photoiniator',
  contactName: 'Li Wei',
  supplierName: 'Shanghai Chem',
  productName: 'Photoiniator',
  companyName: 'SQ Quimica',
};

const creditVars = {
  subject: 'Credit support request - Forn Ltd',
  contactName: 'Ana',
  partnerName: 'Banco Alfa',
  companyName: 'SQ Quimica',
  supplierName: 'Forn Ltd',
  supplierCountry: 'China',
  currency: 'USD',
  incoterm: 'FOB',
  itemsCount: 3,
  unavailableCount: 1,
  expiresAt: '08 Oct 2026',
  portalLink: 'https://app.test/portal/credit?token=abc&v=1',
  customMessage: '',
};

type Case = {
  name: string;
  render: (vars: never) => Promise<{ subject?: string; html: string; text: string }>;
  vars: Record<string, unknown>;
};

const CASES: Case[] = [
  { name: 'dispatch', render: (v) => renderDispatchFromTemplate(v), vars: dispatchVars },
  { name: 'reply', render: (v) => renderReplyFromTemplate(v), vars: replyVars },
  { name: 'po', render: (v) => renderPoFromTemplate(v), vars: poVars },
  { name: 'reminder', render: (v) => renderReminderFromTemplate(v), vars: reminderVars },
  { name: 'regret', render: (v) => renderRegretFromTemplate(v), vars: regretVars },
  { name: 'credit-support', render: (v) => renderCreditSupportFromTemplate(v), vars: creditVars },
];

describe('e-mails externos nunca expõem o código da cotação', () => {
  beforeEach(() => {
    getTemplate.mockReset();
  });

  for (const c of CASES) {
    it(`${c.name}: arquivo/fallback (sem template no banco)`, async () => {
      getTemplate.mockResolvedValue(null);
      const out = await c.render({ ...c.vars, ...LEAK } as never);
      expectNoCode(out);
      expect(out.html.length).toBeGreaterThan(100);
      expect(out.text.length).toBeGreaterThan(10);
    });

    it(`${c.name}: template do banco com {{requestCode}} no assunto, HTML e texto`, async () => {
      getTemplate.mockResolvedValue(dbTemplate());
      // creditSupport usa o assunto do banco so quando o assunto nao e digitado.
      const out = await c.render({ ...c.vars, ...LEAK } as never);
      expectNoCode(out);
      expect(out.html).toContain('<title>');
    });
  }

  it('reply: o intro do texto puro e do HTML cita o produto, nao o código', async () => {
    getTemplate.mockResolvedValue(null);
    const out = await renderReplyFromTemplate({ ...replyVars, ...LEAK } as never);
    expect(out.text).toContain('Thank you for your quotation for Photoiniator.');
    expect(out.html).toContain('Thank you for your quotation for Photoiniator.');
    expect(out.html).not.toContain('Quote #');
  });

  it('reply: sem productName o intro continua correto', async () => {
    getTemplate.mockResolvedValue(null);
    const out = await renderReplyFromTemplate({ ...replyVars, productName: '', ...LEAK } as never);
    expect(out.text).toContain('Thank you for your quotation.');
    expectNoCode(out);
  });

  it('reminder/regret: sem productName a frase não fica órfã', async () => {
    getTemplate.mockResolvedValue(null);
    const reminder = await renderReminderFromTemplate({ ...reminderVars, productName: '', ...LEAK } as never);
    expect(reminder.text).toContain('your quotation has not been submitted yet.');
    expect(reminder.html).not.toMatch(/<strong[^>]*><\/strong>/);
    const regret = await renderRegretFromTemplate({ ...regretVars, productName: '', ...LEAK } as never);
    expect(regret.text).toContain('effort you put into your quotation.');
    expect(regret.html).not.toMatch(/<strong[^>]*><\/strong>/);
  });

  it('credit-support: sem "under request" e sem vírgula órfã', async () => {
    getTemplate.mockResolvedValue(null);
    const out = await renderCreditSupportFromTemplate({ ...creditVars, ...LEAK } as never);
    expect(out.text).toContain('purchase from Forn Ltd (China), and would like to know');
    expect(out.text).not.toContain('under request');
    expect(out.html.replace(/\s+/g, ' ')).not.toContain('under request');
  });

  it('digest: item identificado por produto (ou "Quotation") + data de fechamento', () => {
    const items = [
      { productName: 'Photoiniator', supplierName: 'A', closesOn: '10 Nov 2026', portalLink: 'https://p.example/1', ...LEAK },
      { productName: '', supplierName: 'B', closesOn: '12 Nov 2026', portalLink: 'https://p.example/2', ...LEAK },
    ];
    const out = renderReminderDigest({ contactName: 'Li', companyName: 'SQ Quimica', items: items as never });
    expectNoCode(out);
    expect(out.html).toContain('<strong>Photoiniator</strong>');
    expect(out.html).toContain('<strong>Quotation</strong>');
    expect(out.html).toContain('Closes on 10 Nov 2026');
    expect(out.text).toContain('Photoiniator (supplier: A; closes on 10 Nov 2026): https://p.example/1');
    expect(out.text).toContain('Quotation (supplier: B; closes on 12 Nov 2026): https://p.example/2');
  });

  it('dispatch: o texto puro do arquivo não cita o código', async () => {
    getTemplate.mockResolvedValue(null);
    const out = await renderDispatchFromTemplate({ ...dispatchVars, ...LEAK } as never);
    expect(out.text).toContain('regarding a sourcing request.');
    expect(out.html).toContain('Sourcing request from SQ Quimica: Photoiniator.');
  });
});

describe('omitRequestCode', () => {
  it('remove requestCode e quoteRequestId sem tocar nos demais campos nem mutar a entrada', () => {
    const input = { requestCode: CODE, quoteRequestId: QUOTE_ID, productName: 'X', n: 1 };
    const out = omitRequestCode(input);
    expect(out).toEqual({ productName: 'X', n: 1 });
    expect(input.requestCode).toBe(CODE);
  });
});

describe('stripRequestCode', () => {
  it('tira o código do assunto de envio e normaliza espaços', () => {
    expect(stripRequestCode('Sourcing request SEA-VP-17112026 - Photoiniator', CODE)).toBe(
      'Sourcing request - Photoiniator',
    );
  });

  it('colapsa separadores duplicados (credit support gravado)', () => {
    expect(stripRequestCode('Credit support request - SEA-VP-17112026 - Forn Ltd', CODE)).toBe(
      'Credit support request - Forn Ltd',
    );
  });

  it('remove separador pendente e parênteses vazios', () => {
    expect(stripRequestCode('Purchase Order - SEA-VP-17112026', CODE)).toBe('Purchase Order');
    expect(stripRequestCode('Quote (SEA-VP-17112026) for X', CODE)).toBe('Quote for X');
    expect(stripRequestCode('SEA-VP-17112026 - Foo', CODE)).toBe('Foo');
  });

  it('é case-insensitive e trata o código como literal (sem regex)', () => {
    expect(stripRequestCode('Re sea-vp-17112026 ok', CODE)).toBe('Re ok');
    expect(stripRequestCode('A QR.1 B', 'QR.1')).toBe('A B');
    expect(stripRequestCode('A QRx1 B', 'QR.1')).toBe('A QRx1 B');
  });

  it('sem código no texto (ou código vazio) devolve o texto intacto', () => {
    expect(stripRequestCode('Sourcing request - X  - Y', CODE)).toBe('Sourcing request - X  - Y');
    expect(stripRequestCode('Texto  qualquer', '')).toBe('Texto  qualquer');
    expect(stripRequestCode('Texto', null)).toBe('Texto');
  });
});
