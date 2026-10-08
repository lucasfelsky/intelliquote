import { describe, expect, it } from 'vitest';
import {
  buildReplyTextTemplateDraft,
  loadFileTemplate,
  renderReplyHtmlFromTemplate,
  renderReplyPlainText,
  renderReplySections,
  renderReplyTextFromTemplate,
  type QuoteReplyVars,
} from '../src/mailer/renderQuoteReply';

function makeVars(overrides: Partial<QuoteReplyVars> = {}): QuoteReplyVars {
  return {
    subject: 'Sourcing request QR-1 - Produto',
    quoteRequestId: 1,
    requestCode: 'QR-1',
    productName: 'Produto',
    supplierName: 'Acme',
    supplierContactName: 'John',
    currency: 'USD',
    isWinner: false,
    items: [
      { name: 'PI-TPO', incoterm: 'CIF', quantity: 500, unit: 'KG', unitPrice: 4.99, targetPrice: 4.5 },
      { name: 'PI-DTX', incoterm: 'CIF', quantity: 1200, unit: 'KG', unitPrice: 4.99, targetPrice: null },
      { name: 'PI-OFF', incoterm: 'CIF', quantity: 10, unit: 'KG', unitPrice: null, targetPrice: null, isUnavailable: true },
    ],
    hasItemTargets: true,
    ...overrides,
  };
}

const LEGACY_HTML = [
  '<p>Dear {{supplierContactName}},</p>',
  '<table><thead><tr><th>ITEM</th><th>INCOTERM</th><th>QUANTITY</th><th>UNIT PRICE</th><th>TOTAL</th></tr></thead>',
  '<tbody>{{itemsRows}}</tbody></table>',
  '<!--CUSTOM_MESSAGE_SLOT-->',
].join('\n');

// Linhas da tabela de itens (do <thead> ao fim do <tbody>).
function rowsOf(html: string): string[] {
  const start = html.indexOf('<thead>');
  const end = html.indexOf('</tbody>');
  return (html.slice(start, end).match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []);
}

function cellCount(row: string): number {
  return (row.match(/<t[dh][\s>]/g) ?? []).length;
}

describe('renderQuoteReply — coluna TARGET PRICE', () => {
  it('modo coluna: cabecalho e linhas tem o mesmo numero de celulas (6)', () => {
    const html = renderReplyHtmlFromTemplate(loadFileTemplate(), makeVars());
    const tableRows = rowsOf(html);
    expect(tableRows).toHaveLength(4); // cabecalho + 3 itens (1 indisponivel)
    for (const row of tableRows) expect(cellCount(row)).toBe(6);
    expect(html).toContain('TARGET PRICE');
    expect(html).toContain('bgcolor="#E5E7EB"');
    expect(html).toContain('background-color:#E5E7EB;font-weight:bold;color:#1F2933;');
  });

  it('modo coluna sem alvo nenhum: 5 celulas e sem TARGET PRICE', () => {
    const vars = makeVars({
      hasItemTargets: false,
      items: makeVars().items.map((item) => ({ ...item, targetPrice: null })),
    });
    const html = renderReplyHtmlFromTemplate(loadFileTemplate(), vars);
    const tableRows = rowsOf(html);
    for (const row of tableRows) expect(cellCount(row)).toBe(5);
    expect(html).not.toContain('TARGET PRICE');
  });

  it('modo legado (sem {{itemsHeaderRow}}): 5 celulas, sub-linha "Target:" e sem coluna', () => {
    const html = renderReplyHtmlFromTemplate(LEGACY_HTML, makeVars());
    const bodyRows = rowsOf(html).filter((row) => /<td align=/.test(row));
    for (const row of bodyRows) expect(cellCount(row)).toBe(5);
    expect(html).toContain('Target: 4.50 USD');
    expect(html).not.toContain('#E5E7EB');
  });

  it('modo legado: alvo vindo do agregado nao duplica a sub-linha (a linha "Target Price:" do template cobre)', () => {
    const vars = makeVars({
      targetPrice: 4.5,
      items: [{ name: 'PI-TPO', incoterm: 'CIF', quantity: 500, unit: 'KG', unitPrice: 4.99, targetPrice: 4.5, targetFromAggregate: true }],
    });
    const html = renderReplyHtmlFromTemplate(
      `${LEGACY_HTML}\n{{#targetPriceStr}}<p>Target Price: {{targetPriceStr}}</p>{{/targetPriceStr}}`,
      vars,
    );
    expect(html).not.toContain('Target: ');
    expect(html).toContain('<p>Target Price: 4.50 USD</p>');
  });

  it('modo coluna: o bloco {{#targetPriceStr}} do banco colapsa quando a coluna mostra o alvo', () => {
    const vars = makeVars({ targetPrice: 4.5 });
    const html = renderReplyHtmlFromTemplate(
      '{{itemsHeaderRow}}{{itemsRows}}{{#targetPriceStr}}<p>Target Price: {{targetPriceStr}}</p>{{/targetPriceStr}}',
      vars,
    );
    expect(html).toContain('TARGET PRICE');
    expect(html).not.toContain('Target Price:');
  });

  it('sem itens: linha "No items listed." usa o colspan certo', () => {
    const html = renderReplySections('{{itemsHeaderRow}}{{itemsRows}}', makeVars({ items: [], hasItemTargets: false }));
    expect(html).toContain('colspan="5"');
  });
});

describe('renderQuoteReply — mensagem do modal', () => {
  it('{{message}} escapa HTML e converte \\n em <br />, dentro de bloco com destaque', () => {
    const html = renderReplyHtmlFromTemplate(
      loadFileTemplate(),
      makeVars({ message: 'Linha 1 <script>alert(1)</script>\nLinha 2' }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('Linha 1 &lt;script&gt;alert(1)&lt;/script&gt;<br />Linha 2');
    expect(html).toContain('role="presentation" width="100%"');
    expect(html).toContain('bgcolor="#EEF7F4"');
    expect(html).toContain('border-left:4px solid #184054');
    expect(html.indexOf('Linha 1')).toBeGreaterThan(html.indexOf('Dear John,'));
    expect(html.indexOf('Linha 1')).toBeLessThan(html.indexOf('Thank you for your quotation'));
  });

  it('mensagem vazia ou so espacos nao gera bloco', () => {
    for (const message of [undefined, '', '   \n ']) {
      const html = renderReplyHtmlFromTemplate(loadFileTemplate(), makeVars({ message }));
      expect(html).not.toContain('border-left:4px solid #184054');
    }
  });

  it('modo legado: mensagem vai para o slot; com {{message}} o slot fica vazio (sem duplicar)', () => {
    const legacy = renderReplyHtmlFromTemplate(LEGACY_HTML, makeVars({ message: 'Oi $& mundo' }));
    expect(legacy).toContain('Oi $&amp; mundo');
    expect(legacy).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');

    const both = renderReplyHtmlFromTemplate(`{{message}}\n${LEGACY_HTML}`, makeVars({ message: 'Unica' }));
    expect(both.split('Unica')).toHaveLength(2);
    expect(both).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');
  });

  it('texto puro: {{messageText}} logo apos "Dear"; sem o placeholder a mensagem e prefixada', () => {
    const withPlaceholder = renderReplyTextFromTemplate('Dear {{supplierContactName}},\r\n\r\n{{messageText}}Body', makeVars({ message: 'A\nB' }));
    expect(withPlaceholder).toBe('Dear John,\r\n\r\nA\r\nB\r\n\r\nBody');

    const withoutPlaceholder = renderReplyTextFromTemplate('Dear {{supplierContactName}},\r\n\r\nBody', makeVars({ message: 'Oi' }));
    expect(withoutPlaceholder.startsWith('Oi\n\nDear John,')).toBe(true);

    const noMessage = renderReplyTextFromTemplate('Dear {{supplierContactName}},\r\n\r\n{{messageText}}Body', makeVars());
    expect(noMessage).toBe('Dear John,\r\n\r\nBody');
  });

  it('renderReplyPlainText coloca a mensagem apos "Dear" e inclui a coluna Target Price', () => {
    const text = renderReplyPlainText(makeVars({ message: 'Mensagem' }));
    expect(text.indexOf('Mensagem')).toBeGreaterThan(text.indexOf('Dear John,'));
    expect(text.indexOf('Mensagem')).toBeLessThan(text.indexOf('Thank you for your quotation'));
    expect(text).toContain('Item\tIncoterm\tQuantity\tUnit Price\tTarget Price\tTotal');
    expect(text).toContain('PI-TPO\tCIF\t500.00 KG\t4.99 USD\t4.50 USD\t2,495.00 USD');
    expect(text).toContain('PI-DTX\tCIF\t1,200.00 KG\t4.99 USD\t—\t5,988.00 USD');
    expect(text).toContain('PI-OFF\tCIF\t10.00 KG\tTemporarily unavailable\t—\t—');
  });
});

describe('renderQuoteReply — {{itemsText}} e {{itemsTextTable}}', () => {
  it('{{itemsText}} renderiza as linhas (antes virava vazio por causa de renderReplySections)', () => {
    const text = renderReplyTextFromTemplate('Dear {{supplierContactName}},\n{{itemsText}}', makeVars());
    expect(text).toContain('PI-TPO\tCIF\t500.00 KG\t4.99 USD (Target: 4.50 USD)\t2,495.00 USD');
    expect(text).toContain('PI-DTX\tCIF');
    expect(text).not.toContain('{{itemsText}}');
  });

  it('{{itemsTextTable}} renderiza cabecalho + linhas (com coluna quando ha alvo)', () => {
    const text = renderReplyTextFromTemplate('{{itemsTextTable}}', makeVars());
    expect(text.split('\r\n')[0]).toBe('Item\tIncoterm\tQuantity\tUnit Price\tTarget Price\tTotal');
    expect(text.split('\r\n')).toHaveLength(4);

    const noTargets = renderReplyTextFromTemplate(
      '{{itemsTextTable}}',
      makeVars({ items: makeVars().items.map((item) => ({ ...item, targetPrice: null })), hasItemTargets: false }),
    );
    expect(noTargets.split('\r\n')[0]).toBe('Item\tIncoterm\tQuantity\tUnit Price\tTotal');
  });

  it('nao escapa HTML nos placeholders de texto puro', () => {
    const text = renderReplyTextFromTemplate(
      '{{itemsTextTable}}',
      makeVars({ items: [{ name: 'A & B', incoterm: 'CIF', quantity: 1, unit: 'KG', unitPrice: 1, targetPrice: null }], hasItemTargets: false }),
    );
    expect(text).toContain('A & B');
  });

  it('buildReplyTextTemplateDraft traz os placeholders crus, sem dados de exemplo', () => {
    const draft = buildReplyTextTemplateDraft();
    for (const placeholder of [
      '{{supplierContactName}}',
      '{{messageText}}',
      '{{introText}}',
      '{{itemsIntroText}}',
      '{{itemsTextTable}}',
    ]) {
      expect(draft).toContain(placeholder);
    }
    expect(draft.indexOf('{{messageText}}')).toBeGreaterThan(draft.indexOf('Dear {{supplierContactName}},'));
    expect(draft.indexOf('{{messageText}}')).toBeLessThan(draft.indexOf('{{introText}}'));
    expect(draft).not.toContain('PI-TPO');
  });

  it('o rascunho renderizado produz um texto completo e coerente', () => {
    const text = renderReplyTextFromTemplate(buildReplyTextTemplateDraft(), makeVars({ message: 'Oi' }));
    expect(text.startsWith('Dear John,\r\n\r\nOi\r\n\r\nThank you for your quotation on QR-1')).toBe(true);
    expect(text).toContain('Please find the items under discussion below:');
    expect(text).toContain('Unit Price\tTarget Price\tTotal');
    expect(text.endsWith('Best regards,')).toBe(true);
  });
});
