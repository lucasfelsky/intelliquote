import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTemplate = vi.fn();
vi.mock('../src/services/EmailTemplateService', () => ({
  EmailTemplateService: { get: (...args: unknown[]) => getTemplate(...args) },
}));

import {
  defaultCreditSupportSubject,
  formatCreditSupportExpiry,
  renderCreditSupportFromTemplate,
  type CreditSupportRequestVars,
} from '../src/mailer/renderCreditSupportRequest';

function vars(overrides: Partial<CreditSupportRequestVars> = {}): CreditSupportRequestVars {
  return {
    subject: 'Credit support request - RFQ-1 - Forn',
    contactName: 'Ana',
    partnerName: 'Banco Alfa',
    companyName: 'SQ Quimica',
    requestCode: 'RFQ-1',
    supplierName: 'Forn Ltd',
    supplierCountry: 'China',
    currency: 'USD',
    incoterm: 'FOB',
    itemsCount: 3,
    unavailableCount: 1,
    expiresAt: '08 Oct 2026',
    portalLink: 'https://app.test/portal/credit?token=abc_DEF-123&v=99',
    customMessage: '',
    ...overrides,
  };
}

describe('renderCreditSupportFromTemplate', () => {
  beforeEach(() => {
    getTemplate.mockReset();
    getTemplate.mockResolvedValue(null);
  });

  it('escapa HTML no nome do parceiro e do fornecedor', async () => {
    const out = await renderCreditSupportFromTemplate(
      vars({
        partnerName: '<script>alert(1)</script>',
        supplierName: '<img src=x onerror=alert(2)>',
      }),
    );
    expect(out.html).not.toContain('<script>');
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out.source).toBe('fallback');
  });

  it('inclui o link no html (href escapado) e no texto', async () => {
    const out = await renderCreditSupportFromTemplate(vars());
    expect(out.html).toContain('href="https://app.test/portal/credit?token=abc_DEF-123&amp;v=99"');
    expect(out.text).toContain('https://app.test/portal/credit?token=abc_DEF-123&v=99');
    expect(out.html).toContain('Open the request');
  });

  it('nao deixa {{ }} remanescente e esconde secoes vazias', async () => {
    const out = await renderCreditSupportFromTemplate(
      vars({ unavailableCount: 0, supplierCountry: '', customMessage: '' }),
    );
    expect(out.html).not.toContain('{{');
    expect(out.html).not.toContain('currently unavailable');
    expect(out.text).not.toContain('currently unavailable');
    expect(out.text).not.toContain('()');

    const full = await renderCreditSupportFromTemplate(
      vars({ customMessage: 'Please <b>review</b>' }),
    );
    expect(full.html).toContain('1 item(s) are currently unavailable');
    expect(full.html).toContain('(China)');
    expect(full.html).toContain('Please &lt;b&gt;review&lt;/b&gt;');
  });

  it('nao coloca precos no corpo e usa o assunto padrao em ingles', async () => {
    expect(defaultCreditSupportSubject('RFQ-1', 'Forn')).toBe(
      'Credit support request - RFQ-1 - Forn',
    );
    const out = await renderCreditSupportFromTemplate(vars());
    expect(out.html).not.toMatch(/unit price|total price/i);
    expect(out.subject).toBe('Credit support request - RFQ-1 - Forn');
  });

  it('aplica o override do banco; assunto digitado prevalece sobre o do banco', async () => {
    getTemplate.mockResolvedValue({
      subject: 'DB {{requestCode}}',
      htmlBody: '<p>DB body {{partnerName}} {{portalLink}}</p>',
      textBody: null,
    });
    const fromDb = await renderCreditSupportFromTemplate(vars());
    expect(fromDb.source).toBe('database');
    expect(fromDb.subject).toBe('DB RFQ-1');
    expect(fromDb.html).toContain('DB body Banco Alfa');
    expect(fromDb.text).toContain('Open the request:');

    const custom = await renderCreditSupportFromTemplate(
      vars({ subject: 'Meu assunto', subjectIsCustom: true }),
    );
    expect(custom.subject).toBe('Meu assunto');
  });

  it('formata a expiracao em en-GB (UTC)', () => {
    expect(formatCreditSupportExpiry(new Date('2026-10-08T03:00:00.000Z'))).toBe('08 Oct 2026');
  });
});
