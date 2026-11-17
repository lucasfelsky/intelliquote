// Render puro do resumo diario (2+ cotacoes pendentes no mesmo e-mail). Sem Prisma.
import { describe, expect, it } from 'vitest';
import {
  QUOTE_REMINDER_DIGEST_TEMPLATE_ID,
  renderReminderDigest,
} from '../src/mailer/renderQuoteReminderDigest';

// requestCode e' "canario": o digest e' voltado ao fornecedor e nunca pode mostra-lo.
const baseItems = [
  {
    requestCode: 'QR-2026-042',
    productName: 'PI-TPO',
    supplierName: 'Shanghai Chem Co.',
    closesOn: '10 Nov 2026',
    portalLink: 'https://portal.example/portal?token=raw-one&v=1',
  },
  {
    requestCode: 'QR-2026-043',
    productName: 'Resina',
    supplierName: 'Ningbo Resins Ltd',
    closesOn: '12 Nov 2026',
    portalLink: 'https://portal.example/portal?token=raw-two&v=1',
  },
];

function render(items = baseItems) {
  return renderReminderDigest({ contactName: 'Li Wei', companyName: 'SQ Quimica', items });
}

describe('renderReminderDigest', () => {
  it('usa o id de template fixo quote_reminder_digest', () => {
    expect(QUOTE_REMINDER_DIGEST_TEMPLATE_ID).toBe('quote_reminder_digest');
  });

  it('o assunto tem N e o companyName', () => {
    expect(render().subject).toBe('Reminder: 2 quotations pending — SQ Quimica');
    expect(render([...baseItems, { ...baseItems[0], requestCode: 'QR-3' }]).subject).toContain('3 quotations');
  });

  it('productName com HTML aparece escapado no html', () => {
    const { html } = render([{ ...baseItems[0], productName: '<script>x</script>' }, baseItems[1]]);
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });

  it('o & do link vira &amp; no href', () => {
    const { html } = render();
    expect(html).toContain('href="https://portal.example/portal?token=raw-one&amp;v=1"');
    expect(html).not.toContain('href="https://portal.example/portal?token=raw-one&v=1"');
  });

  it('html tem os produtos (sem o codigo da cotacao), prazos, saudacao, contagem e rodape; sem marcador residual', () => {
    const { html } = render();
    expect(html).not.toContain('QR-2026-042');
    expect(html).not.toContain('QR-2026-043');
    expect(html).toContain('<strong>PI-TPO</strong>');
    expect(html).toContain('<strong>Resina</strong>');
    expect(html).toContain('Closes on 10 Nov 2026');
    expect(html).toContain('Closes on 12 Nov 2026');
    expect(html).toContain('Dear Li Wei, this is a friendly reminder that 2 quotations are still pending.');
    expect(html).toContain('SQ Quimica');
    expect(html).not.toContain('<!--REMINDER_ITEMS-->');
    expect(html).not.toMatch(/\{\{[^}]*\}\}/);
  });

  it('o texto tem uma linha por item com o link cru e usa CRLF', () => {
    const { text } = render();
    const lines = text.split('\r\n');
    expect(text).not.toContain('QR-');
    expect(lines.filter((line) => line.startsWith('PI-TPO') || line.startsWith('Resina'))).toHaveLength(2);
    expect(lines.find((line) => line.startsWith('PI-TPO'))).toContain('https://portal.example/portal?token=raw-one&v=1');
    expect(lines.find((line) => line.startsWith('Resina'))).toContain('https://portal.example/portal?token=raw-two&v=1');
    expect(lines.find((line) => line.startsWith('PI-TPO'))).toContain('10 Nov 2026');
    expect(text).toContain('Dear Li Wei,');
    expect(text.includes('\n') && !text.replace(/\r\n/g, '').includes('\n')).toBe(true);
  });

  it('sem productName o item vira "Quotation" (sem o codigo e sem o separador " — ")', () => {
    const { html, text } = render([{ ...baseItems[0], productName: '' }, { ...baseItems[1], productName: '' }]);
    const itemLines = text.split('\r\n').filter((line) => line.startsWith('Quotation'));
    expect(itemLines).toHaveLength(2);
    for (const line of itemLines) expect(line).not.toContain(' — ');
    expect(html).toContain('<strong>Quotation</strong>');
    expect(html).not.toContain('&mdash;');
    expect(html).not.toContain('QR-');
    expect(text).not.toContain('QR-');
  });

  it('o nome do fornecedor aparece em cada item (html escapado e texto)', () => {
    const { html, text } = render([{ ...baseItems[0], supplierName: '<b>Forn & Co</b>' }, baseItems[1]]);
    expect(html).toContain('Supplier: &lt;b&gt;Forn &amp; Co&lt;/b&gt;');
    expect(html).not.toContain('<b>Forn');
    expect(html).toContain('Supplier: Ningbo Resins Ltd');
    const lines = text.split('\r\n');
    expect(lines.find((line) => line.startsWith('PI-TPO'))).toContain('supplier: <b>Forn & Co</b>');
    expect(lines.find((line) => line.startsWith('Resina'))).toContain('supplier: Ningbo Resins Ltd');
  });

  it('o aviso de seguranca diz "each link above" (os links vem antes do aviso)', () => {
    const { html, text } = render();
    expect(html).toContain('each link above replaces the one from the previous email');
    expect(html).not.toContain('each link below');
    expect(text).toContain('each link above');
  });

  it('placeholder "{{...}}" dentro de um campo de item nao e interpretado', () => {
    const { html } = render([{ ...baseItems[0], productName: '{{companyName}}' }, baseItems[1]]);
    expect(html).toContain('{{companyName}}');
  });
});
