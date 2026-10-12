import { describe, expect, it } from 'vitest';
import {
  REPLY_PORTAL_CTA_HTML,
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

describe('renderQuoteReply — link do portal', () => {
  const link = 'https://intelliquote.portal-comex.com/portal?token=abc_DEF-123&v=99';
  const linkVars = () => makeVars({ portalLink: link });

  function count(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  // Template do banco "legado" (fixture de quote-reply-template-db.test.ts): sem {{portalLink}}, com "Best regards".
  const LEGACY_DB_HTML = [
    '<html><body>',
    '<p style="margin:0 0 12px 0;">Dear {{supplierContactName}},</p>',
    '<p>{{introText}}</p>',
    '<table>',
    '<thead><tr><th>ITEM</th><th>INCOTERM</th><th>QUANTITY</th><th>UNIT PRICE</th><th>TOTAL</th></tr></thead>',
    '<tbody>{{itemsRows}}</tbody>',
    '</table>',
    '{{#targetPriceStr}}<p><strong>Target Price:</strong> {{targetPriceStr}}</p>{{/targetPriceStr}}',
    '<!--CUSTOM_MESSAGE_SLOT-->',
    '<p>Best regards,</p>',
    '</body></html>',
  ].join('\n');

  it('arquivo do repo: a secao {{#portalLink}} renderiza o botao com href escapado e sem placeholder sobrando', () => {
    const html = renderReplyHtmlFromTemplate(loadFileTemplate(), linkVars());
    expect(html).toContain('Review or adjust your proposal');
    expect(html).toContain('href="https://intelliquote.portal-comex.com/portal?token=abc_DEF-123&amp;v=99"');
    expect(html).not.toContain('token=abc_DEF-123&v=99');
    expect(html).not.toContain('{{');
    expect(html).not.toContain('{{/portalLink}}');
    expect(html.indexOf('Review or adjust your proposal')).toBeGreaterThan(html.indexOf('</tbody>'));
    expect(html.indexOf('Review or adjust your proposal')).toBeLessThan(html.indexOf('Best regards,'));
  });

  it('sem portalLink a secao colapsa e nada do botao aparece', () => {
    const html = renderReplyHtmlFromTemplate(loadFileTemplate(), makeVars());
    expect(html).not.toContain('Review or adjust');
    expect(html).not.toContain('/portal');
    expect(html).not.toContain('{{');
    expect(renderReplyHtmlFromTemplate(loadFileTemplate(), makeVars({ portalLink: '' }))).not.toContain('Review or adjust');
    // Template do banco sem o placeholder: sem link tambem nao injeta.
    expect(renderReplyHtmlFromTemplate(LEGACY_DB_HTML, makeVars())).not.toContain('Review or adjust');
  });

  it('template do banco sem o placeholder + ancora: bloco injetado UMA vez antes de "Best regards"', () => {
    const html = renderReplyHtmlFromTemplate(LEGACY_DB_HTML, linkVars());
    expect(count(html, 'Review or adjust your proposal</a>')).toBe(1);
    expect(count(html, 'You can review or adjust your proposal using your secure link:')).toBe(1);
    expect(html).toContain('href="https://intelliquote.portal-comex.com/portal?token=abc_DEF-123&amp;v=99"');
    expect(html.indexOf('Review or adjust your proposal')).toBeGreaterThan(html.indexOf('</table>'));
    expect(html.indexOf('Review or adjust your proposal')).toBeLessThan(html.indexOf('<p>Best regards,</p>'));
    expect(html).not.toContain('{{');
    expect(html).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');
  });

  it('template do banco sem ancora "Best regards": bloco antes de </body>, sem duplicar', () => {
    const template = '<html><body><p>Dear {{supplierContactName}},</p><table><tbody>{{itemsRows}}</tbody></table><p>Regards</p></body></html>';
    const html = renderReplyHtmlFromTemplate(template, linkVars());
    expect(count(html, 'Review or adjust your proposal</a>')).toBe(1);
    expect(html.indexOf('Review or adjust your proposal')).toBeGreaterThan(html.indexOf('<p>Regards</p>'));
    expect(html.indexOf('Review or adjust your proposal')).toBeLessThan(html.indexOf('</body>'));
    expect(html).not.toContain('{{');
    // Sem </body> nem ancora: vai pro fim.
    const bare = renderReplyHtmlFromTemplate('<p>Dear {{supplierContactName}},</p>{{itemsRows}}', linkVars());
    expect(count(bare, 'Review or adjust your proposal</a>')).toBe(1);
    expect(bare.endsWith('</table>')).toBe(true);
  });

  it('template do banco COM {{portalLink}}: sem injecao, o admin controla a posicao', () => {
    const template = '<p>Dear {{supplierContactName}},</p>{{itemsRows}}<p><a href="{{portalLink}}">Open</a> {{portalLink}}</p><p>Best regards,</p>';
    const html = renderReplyHtmlFromTemplate(template, linkVars());
    expect(count(html, 'https://intelliquote.portal-comex.com/portal?token=abc_DEF-123&amp;v=99')).toBe(2);
    expect(html).not.toContain('Review or adjust');
    // Com a secao (sem o placeholder simples fora dela) tambem nao injeta.
    const withSection = '<p>Dear {{supplierContactName}},</p>{{#portalLink}}<a href="{{portalLink}}">Go</a>{{/portalLink}}<p>Best regards,</p>';
    expect(count(renderReplyHtmlFromTemplate(withSection, linkVars()), 'abc_DEF-123')).toBe(1);
    expect(renderReplyHtmlFromTemplate(withSection, linkVars())).not.toContain('Review or adjust');
  });

  it('bloco padrao usa o mesmo markup (VML + bulletproof) com {{portalLink}} no href', () => {
    expect(REPLY_PORTAL_CTA_HTML).toContain('<v:roundrect');
    expect(REPLY_PORTAL_CTA_HTML).toContain('href="{{portalLink}}"');
    expect(REPLY_PORTAL_CTA_HTML).toContain('Or copy and paste this link into your browser:');
    expect(loadFileTemplate()).toContain('{{#portalLink}}');
    expect(loadFileTemplate()).toContain('{{/portalLink}}');
  });

  it('texto puro: renderReplyPlainText traz a linha do link (crua) antes de "Best regards,"', () => {
    const text = renderReplyPlainText(linkVars());
    expect(text).toContain(`Review or adjust your proposal: ${link}`);
    expect(text).not.toContain('&amp;');
    const lines = text.split('\r\n');
    const idx = lines.indexOf(`Review or adjust your proposal: ${link}`);
    expect(idx).toBeGreaterThan(0);
    expect(lines[idx + 1]).toBe('');
    expect(lines[idx + 2]).toBe('Best regards,');
    expect(renderReplyPlainText(makeVars())).not.toContain('Review or adjust');
  });

  it('texto puro do banco: com {{portalLink}} sai cru; sem placeholder a linha e injetada antes de "Best regards"', () => {
    const withPlaceholder = 'Dear {{supplierContactName}},\n\n{{itemsTextTable}}\n\nLink: {{portalLink}}\n\nBest regards,';
    const text = renderReplyTextFromTemplate(withPlaceholder, linkVars());
    expect(text).toContain(`Link: ${link}`);
    expect(text).not.toContain('&amp;');
    expect(text).not.toContain('Review or adjust');

    const legacy = 'Dear {{supplierContactName}},\n\n{{itemsText}}\n\nBest regards,';
    const injected = renderReplyTextFromTemplate(legacy, linkVars());
    expect(injected).toContain(`\n\nReview or adjust your proposal: ${link}\n\nBest regards,`);
    expect(injected).not.toContain('{{');
    expect(injected).not.toContain('&amp;');
    // Sem link, nada entra.
    expect(renderReplyTextFromTemplate(legacy, makeVars())).not.toContain('Review or adjust');
    // Sem ancora: append no fim. CRLF do template e' respeitado.
    const noAnchor = 'Dear {{supplierContactName}},\r\n\r\n{{itemsText}}\r\n';
    const appended = renderReplyTextFromTemplate(noAnchor, linkVars());
    expect(appended.endsWith(`\r\n\r\nReview or adjust your proposal: ${link}`)).toBe(true);
    expect(count(appended, 'Review or adjust')).toBe(1);
  });

  it('rascunho editavel do texto tem a secao {{#portalLink}} antes de "Best regards,"', () => {
    const draft = buildReplyTextTemplateDraft();
    expect(draft).toContain('{{#portalLink}}Review or adjust your proposal: {{portalLink}}{{/portalLink}}');
    expect(draft.indexOf('{{#portalLink}}')).toBeLessThan(draft.indexOf('Best regards,'));
    expect(draft.indexOf('{{#portalLink}}')).toBeGreaterThan(draft.indexOf('{{itemsTextTable}}'));
    // Renderizado com e sem link.
    expect(renderReplyTextFromTemplate(draft, linkVars())).toContain(`Review or adjust your proposal: ${link}`);
    expect(renderReplyTextFromTemplate(draft, makeVars())).not.toContain('Review or adjust');
  });

  it('renderReplySections escapa o link no HTML e deixa cru no modo texto', () => {
    expect(renderReplySections('{{portalLink}}', linkVars())).toBe(
      'https://intelliquote.portal-comex.com/portal?token=abc_DEF-123&amp;v=99',
    );
    expect(renderReplySections('{{portalLink}}', linkVars(), true)).toBe(link);
    expect(renderReplySections('{{#portalLink}}x{{/portalLink}}', makeVars())).toBe('');
  });
});
