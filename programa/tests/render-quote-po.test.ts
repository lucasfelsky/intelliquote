import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const templateGet = vi.fn();
vi.mock('../src/services/EmailTemplateService', () => ({
  EmailTemplateService: { get: (...args: unknown[]) => templateGet(...args) },
}));

import {
  buildPoSenderSignature,
  loadFileTemplate,
  renderPoFromTemplate,
  renderPoHtmlFromTemplate,
  renderPoPlainText,
  renderPoSections,
  type QuotePoVars,
} from '../src/mailer/renderQuotePo';

const baseVars: QuotePoVars = {
  subject: 'Purchase Order - QR-1',
  requestCode: 'QR-1',
  supplierContactName: 'John Supplier',
  forwarderInfo: 'Global Forwarders Ltda.',
  destinationPort: 'NAVEGANTES, BRAZIL',
  senderName: 'Maria Compradora',
  senderEmail: 'maria@sqquimica.com',
};

const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgo=';

// HTML/texto da seed original (20260820_seed_quote_po_template): template
// legado, com <!--CUSTOM_MESSAGE_SLOT--> e sem os placeholders novos.
function loadSeedTemplate(): { html: string; text: string } {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'prisma', 'migrations', '20260820_seed_quote_po_template', 'migration.sql'),
    'utf-8',
  );
  const normalized = sql.replace(/\r\n/g, '\n');
  const htmlStart = normalized.indexOf("'<!doctype html>");
  const htmlEnd = normalized.indexOf("</html>',", htmlStart) + '</html>'.length;
  const html = normalized.slice(htmlStart + 1, htmlEnd).replace(/''/g, "'");
  const textStart = normalized.indexOf("'Dear all,", htmlEnd);
  const textEnd = normalized.indexOf("',\n    CURRENT_TIMESTAMP", textStart);
  const text = normalized.slice(textStart + 1, textEnd).replace(/''/g, "'");
  return { html, text };
}

function mockDbTemplate(htmlBody: string, textBody: string, subject = 'Purchase Order - {{requestCode}}') {
  templateGet.mockResolvedValue({
    id: 1,
    key: 'quote_po',
    locale: 'en',
    subject,
    htmlBody,
    textBody,
    isActive: true,
    updatedAt: new Date(),
    updatedById: null,
  });
}

describe('renderQuotePo - e-mail da Ordem de Compra', () => {
  beforeEach(() => {
    templateGet.mockReset();
    templateGet.mockResolvedValue(null);
  });

  it('(a) a mensagem fica entre "Dear all," e "Attached is our PO"', async () => {
    const rendered = await renderPoFromTemplate({ ...baseVars, message: 'Favor confirmar o recebimento.' });
    const dear = rendered.html.indexOf('Dear all,');
    const msg = rendered.html.indexOf('Favor confirmar o recebimento.');
    const attached = rendered.html.indexOf('Attached is our PO');
    expect(dear).toBeGreaterThan(-1);
    expect(msg).toBeGreaterThan(dear);
    expect(attached).toBeGreaterThan(msg);
    // Texto puro: mesma ordem.
    const textDear = rendered.text.indexOf('Dear all,');
    const textMsg = rendered.text.indexOf('Favor confirmar o recebimento.');
    expect(textMsg).toBeGreaterThan(textDear);
    expect(rendered.text.indexOf('Attached is our PO')).toBeGreaterThan(textMsg);
  });

  it('(b) <script> na mensagem e no texto da assinatura sai escapado', async () => {
    const rendered = await renderPoFromTemplate({
      ...baseVars,
      message: '<script>alert(1)</script>',
      signatureText: '<script>alert(2)</script>\nLinha 2',
    });
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rendered.html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;<br />Linha 2');
  });

  describe('(c) composicao da assinatura', () => {
    it('texto + imagem: texto, depois a imagem; texto puro = texto', async () => {
      const rendered = await renderPoFromTemplate({
        ...baseVars,
        signatureText: 'Maria Compradora\nSQ Quimica',
        signatureImageSrc: 'cid:sender-signature@intelliquote',
        signatureImageWidth: 300,
        signatureImageHeight: 90,
      });
      const textPos = rendered.html.indexOf('Maria Compradora<br />SQ Quimica');
      const imgPos = rendered.html.indexOf('<img src="cid:sender-signature@intelliquote"');
      expect(textPos).toBeGreaterThan(-1);
      expect(imgPos).toBeGreaterThan(textPos);
      expect(rendered.html).toContain('width="300" height="90" alt="Maria Compradora"');
      expect(rendered.html).not.toContain('Best regards,');
      expect(rendered.text).toContain('Maria Compradora\r\nSQ Quimica');
      expect(rendered.text).not.toContain('Best regards,');
    });

    it('so texto: sem imagem', async () => {
      const rendered = await renderPoFromTemplate({ ...baseVars, signatureText: 'Att,\nMaria' });
      expect(rendered.html).toContain('Att,<br />Maria');
      expect(rendered.html).not.toContain('sender-signature');
      expect(rendered.text.trimEnd().endsWith('Att,\r\nMaria')).toBe(true);
    });

    it('so imagem: "Best regards," + imagem no HTML; fallback completo no texto puro', async () => {
      const rendered = await renderPoFromTemplate({
        ...baseVars,
        signatureImageSrc: 'cid:sender-signature@intelliquote',
        signatureImageWidth: 300,
        signatureImageHeight: 90,
      });
      expect(rendered.html).toContain('Best regards,</div><img src="cid:sender-signature@intelliquote"');
      expect(rendered.html).not.toContain('maria@sqquimica.com');
      expect(rendered.text.trimEnd().endsWith('Best regards,\r\nMaria Compradora\r\nmaria@sqquimica.com')).toBe(true);
    });

    it('nenhum: "Best regards," + nome + e-mail nos dois formatos', async () => {
      const rendered = await renderPoFromTemplate(baseVars);
      expect(rendered.html).toContain('Best regards,<br />Maria Compradora<br />maria@sqquimica.com');
      expect(rendered.text.trimEnd().endsWith('Best regards,\r\nMaria Compradora\r\nmaria@sqquimica.com')).toBe(true);
    });

    it('buildPoSenderSignature trata nome/e-mail ausentes e texto so de espacos', () => {
      const sig = buildPoSenderSignature({ name: '', email: 'x@y.com', text: '   ', hasImage: false });
      expect(sig.plainText).toBe('Best regards,\r\nx@y.com');
      expect(sig.showImage).toBe(false);
    });
  });

  it('(d) template legado (seed com slot): mensagem + assinatura no slot, sem duplicar', async () => {
    const seed = loadSeedTemplate();
    expect(seed.html).toContain('<!--CUSTOM_MESSAGE_SLOT-->');
    expect(seed.html).not.toContain('{{message}}');
    mockDbTemplate(seed.html, seed.text);

    const rendered = await renderPoFromTemplate({
      ...baseVars,
      message: 'Mensagem do modal',
      signatureText: 'Assinatura texto',
    });
    expect(rendered.source).toBe('database');
    expect(rendered.html.split('Mensagem do modal')).toHaveLength(2);
    expect(rendered.html.split('Assinatura texto')).toHaveLength(2);
    expect(rendered.html).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');
    // O slot fica antes de "PO reference".
    expect(rendered.html.indexOf('Assinatura texto')).toBeLessThan(rendered.html.indexOf('PO reference:'));
    // Texto puro legado: mensagem prefixada e assinatura no fim, sem duplicar.
    expect(rendered.text.startsWith('Mensagem do modal\r\n\r\n')).toBe(true);
    expect(rendered.text.split('Mensagem do modal')).toHaveLength(2);
    expect(rendered.text.trimEnd().endsWith('Assinatura texto')).toBe(true);
  });

  it('(e) template com {{message}} + slot: a mensagem entra so no placeholder', async () => {
    mockDbTemplate(
      '<p>Dear all,</p>{{message}}<!--CUSTOM_MESSAGE_SLOT--><p>PO reference: {{requestCode}}</p>',
      'Dear all,\r\n\r\n{{messageText}}PO reference: {{requestCode}}',
    );
    const rendered = await renderPoFromTemplate({ ...baseVars, message: 'Unica vez' });
    expect(rendered.html.split('Unica vez')).toHaveLength(2);
    expect(rendered.html.indexOf('Unica vez')).toBeLessThan(rendered.html.indexOf('PO reference:'));
    expect(rendered.html).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');
    // Assinatura (sem {{senderSignature}}) cai no slot.
    expect(rendered.html).toContain('Best regards,<br />Maria Compradora');
    expect(rendered.text.split('Unica vez')).toHaveLength(2);
  });

  it('template sem placeholder e sem slot: conteudo fora do HTML, mas a assinatura vai ao fim do texto', async () => {
    mockDbTemplate('<p>Dear all,</p><p>PO reference: {{requestCode}}</p>', 'Dear all,\r\nPO reference: {{requestCode}}');
    const rendered = await renderPoFromTemplate({ ...baseVars, message: 'Perdida no HTML' });
    expect(rendered.html).not.toContain('Perdida no HTML');
    expect(rendered.html).not.toContain('Best regards,');
    expect(rendered.text.startsWith('Perdida no HTML\r\n\r\n')).toBe(true);
    expect(rendered.text.trimEnd().endsWith('maria@sqquimica.com')).toBe(true);
  });

  describe('(f) whitelist de src de imagem', () => {
    it.each(['javascript:alert(1)', 'https://evil.example/x.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,AAAA'])(
      'rejeita %s em companyLogoSrc e signatureImageSrc',
      async (src) => {
        const rendered = await renderPoFromTemplate({
          ...baseVars,
          companyLogoSrc: src,
          signatureImageSrc: src,
        });
        expect(rendered.html).not.toContain('<img');
        expect(rendered.html).not.toContain(src);
        // Sem imagem valida: assinatura vira o fallback completo.
        expect(rendered.html).toContain('maria@sqquimica.com');
      },
    );

    it('aceita cid: e data URI png (logo) / png+jpeg (assinatura)', async () => {
      const a = await renderPoFromTemplate({
        ...baseVars,
        companyLogoSrc: 'cid:sq-logo@intelliquote',
        companyLogoWidth: 96,
        signatureImageSrc: 'data:image/jpeg;base64,/9j/4AAQ',
      });
      expect(a.html).toContain('<img src="cid:sq-logo@intelliquote" height="48" width="96" alt="SQ Quimica"');
      expect(a.html).toContain('<img src="data:image/jpeg;base64,/9j/4AAQ"');

      const b = await renderPoFromTemplate({ ...baseVars, companyLogoSrc: PNG_DATA_URI });
      expect(b.html).toContain(`<img src="${PNG_DATA_URI}" height="48"`);

      // JPEG nao e aceito como logo (so' PNG).
      const c = await renderPoFromTemplate({ ...baseVars, companyLogoSrc: 'data:image/jpeg;base64,/9j/4AAQ' });
      expect(c.html).not.toContain('<img');
    });

    it('o logo (branco, transparente) vem direto sobre o cabecalho, sem chip, antes do eyebrow', async () => {
      const rendered = await renderPoFromTemplate({ ...baseVars, companyLogoSrc: 'cid:sq-logo@intelliquote' });
      const logo = rendered.html.indexOf('<img src="cid:sq-logo@intelliquote"');
      const eyebrow = rendered.html.indexOf('SQ Quimica &#183; Purchase Order');
      expect(logo).toBeGreaterThan(-1);
      expect(logo).toBeLessThan(eyebrow);
      expect(rendered.html).not.toContain('bgcolor="#ffffff" style="background-color:#ffffff;margin:0 0 16px 0;"');
      // alt legivel sobre o navy quando o cliente bloqueia imagens.
      expect(rendered.html).toMatch(/alt="SQ Quimica" style="[^"]*color:#ffffff/);
    });
  });

  it('(g) placeholders de texto e fallbacks de prefixo e sufixo', () => {
    const vars: QuotePoVars = { ...baseVars, message: 'Oi', signatureText: 'Tchau' };
    expect(renderPoSections('{{messageText}}|{{senderSignatureText}}', vars)).toBe('Oi\r\n\r\n|Tchau\r\n\r\n');
    expect(renderPoSections('{{messageText}}|', { ...baseVars })).toBe('|');
    expect(renderPoSections('{{message}}|', { ...baseVars })).toBe('|');
    expect(renderPoSections('{{companyLogo}}|', { ...baseVars })).toBe('|');

    const plain = renderPoPlainText(vars);
    expect(plain.startsWith('Dear all,\r\n\r\nOi\r\n\r\nAttached is our PO.')).toBe(true);
    expect(plain.trimEnd().endsWith('Tchau')).toBe(true);
  });

  it('(h) subjectOverride vence o assunto do banco; sem override vale o do banco', async () => {
    mockDbTemplate('<title>{{subject}}</title><p>{{subject}}</p>', 'Subj: {{subject}}');
    const withOverride = await renderPoFromTemplate(baseVars, 'en', '  PO revisada  ');
    expect(withOverride.subject).toBe('PO revisada');
    expect(withOverride.html).toContain('<title>PO revisada</title>');
    expect(withOverride.text).toContain('Subj: PO revisada');

    const without = await renderPoFromTemplate(baseVars, 'en');
    expect(without.subject).toBe('Purchase Order - QR-1');

    const blank = await renderPoFromTemplate(baseVars, 'en', '   ');
    expect(blank.subject).toBe('Purchase Order - QR-1');
  });

  it('o arquivo-fallback do template usa os tres placeholders novos e nao tem o slot', () => {
    const file = loadFileTemplate();
    expect(file).toContain('{{companyLogo}}');
    expect(file).toContain('{{message}}');
    expect(file).toContain('{{senderSignature}}');
    expect(file).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');
  });

  it('o conteudo do usuario com "$&" nao quebra a injecao no slot', async () => {
    const seed = loadSeedTemplate();
    mockDbTemplate(seed.html, seed.text);
    const rendered = await renderPoFromTemplate({ ...baseVars, message: 'custa $& e $1' });
    expect(rendered.html).toContain('custa $&amp; e $1');
  });
});

describe('renderQuotePo - PO via parceiro de Credit Support (PR4b)', () => {
  const SECTION_RE = /\{\{#creditPartnerName\}\}[\s\S]*?\{\{\/creditPartnerName\}\}/;
  const PHRASE = 'This purchase order refers to goods supplied by';
  const partnerVars: QuotePoVars = {
    ...baseVars,
    supplierName: 'Acme Chemicals',
    creditPartnerName: 'Banco Parceiro',
  };

  function countOf(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  // Template do banco ja migrado (com {{message}} e {{senderSignature}}), sem o paragrafo do parceiro.
  function dbLikeHtml(): string {
    return loadFileTemplate().replace(SECTION_RE, '');
  }

  beforeEach(() => {
    templateGet.mockReset();
    templateGet.mockResolvedValue(null);
  });

  it('(a) arquivo sem creditPartnerName: HTML do fornecedor identico ao do template sem o bloco', async () => {
    const file = loadFileTemplate();
    expect(file).toMatch(SECTION_RE);
    const withMessage = { ...baseVars, message: 'Favor confirmar.' };
    const rendered = await renderPoFromTemplate(withMessage);
    expect(rendered.html).toBe(renderPoHtmlFromTemplate(file.replace(SECTION_RE, ''), withMessage));
    expect(rendered.html).not.toContain('credit support');
    expect(rendered.text).not.toContain('credit support');
  });

  it('(b) arquivo com parceiro: frase 1x entre "Dear all," e "Attached is our PO", nomes escapados', async () => {
    const rendered = await renderPoFromTemplate({
      ...partnerVars,
      supplierName: 'Acme <script>x</script> & Co',
      creditPartnerName: 'Banco <b>P</b> & Cia',
      message: 'Favor confirmar.',
    });
    expect(countOf(rendered.html, PHRASE)).toBe(1);
    const dear = rendered.html.indexOf('Dear all,');
    const msg = rendered.html.indexOf('Favor confirmar.');
    const phrase = rendered.html.indexOf(PHRASE);
    const attached = rendered.html.indexOf('Attached is our PO');
    expect(phrase).toBeGreaterThan(msg);
    expect(msg).toBeGreaterThan(dear);
    expect(attached).toBeGreaterThan(phrase);
    expect(rendered.html).toContain('Acme &lt;script&gt;x&lt;/script&gt; &amp; Co');
    expect(rendered.html).toContain('Banco &lt;b&gt;P&lt;/b&gt; &amp; Cia');
    expect(rendered.html).not.toContain('<script>x</script>');
    // Texto puro (sem linha no banco): linha literal antes de "Attached is our PO".
    expect(countOf(rendered.text, PHRASE)).toBe(1);
    expect(rendered.text.indexOf(PHRASE)).toBeLessThan(rendered.text.indexOf('Attached is our PO'));
  });

  it('(c) template do banco SEM o placeholder: frase injetada 1x logo apos a mensagem; texto puro antes de "Attached"', async () => {
    mockDbTemplate(dbLikeHtml(), 'Dear all,\r\n\r\n{{messageText}}Attached is our PO.\r\n\r\n{{senderSignatureText}}');
    const rendered = await renderPoFromTemplate({ ...partnerVars, message: 'Favor confirmar.' });
    expect(rendered.source).toBe('database');
    expect(countOf(rendered.html, PHRASE)).toBe(1);
    expect(rendered.html).toContain(
      'Favor confirmar.</p><p style="margin:0 0 12px 0;">This purchase order refers to goods supplied by Acme Chemicals, purchased through Banco Parceiro (credit support).</p>',
    );
    expect(countOf(rendered.text, PHRASE)).toBe(1);
    expect(rendered.text).toContain(
      'Favor confirmar.\r\n\r\nThis purchase order refers to goods supplied by Acme Chemicals, purchased through Banco Parceiro (credit support).\r\n\r\nAttached is our PO.',
    );
  });

  it('(c2) seed legado (slot, sem {{message}}): frase injetada 1x antes de "Attached is our PO"', async () => {
    const seed = loadSeedTemplate();
    mockDbTemplate(seed.html, seed.text);
    const rendered = await renderPoFromTemplate(partnerVars);
    expect(countOf(rendered.html, PHRASE)).toBe(1);
    expect(rendered.html.indexOf(PHRASE)).toBeLessThan(rendered.html.indexOf('Attached is our PO'));
    expect(countOf(rendered.text, PHRASE)).toBe(1);
    expect(rendered.text.indexOf(PHRASE)).toBeLessThan(rendered.text.indexOf('Attached is our PO'));
  });

  it('(d) template do banco COM {{#creditPartnerName}}: nao duplica', async () => {
    mockDbTemplate(
      `<p>Dear all,</p>{{message}}{{#creditPartnerName}}<p>Via {{creditPartnerName}} ({{supplierName}})</p>{{/creditPartnerName}}<p>Attached is our PO</p>{{senderSignature}}`,
      'Dear all,\r\n{{messageText}}Attached is our PO.\r\n{{senderSignatureText}}',
    );
    const rendered = await renderPoFromTemplate(partnerVars);
    expect(rendered.html).toContain('<p>Via Banco Parceiro (Acme Chemicals)</p>');
    expect(countOf(rendered.html, PHRASE)).toBe(0);
    expect(countOf(rendered.html, 'Banco Parceiro')).toBe(1);
  });

  it('(e) banco sem {{message}} nem "Attached is our PO": cai antes de </body> com logger.warn', async () => {
    const { logger } = await import('../src/lib/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    mockDbTemplate('<html><body><p>Custom body</p></body></html>', 'Custom text');
    const rendered = await renderPoFromTemplate(partnerVars);
    expect(countOf(rendered.html, PHRASE)).toBe(1);
    expect(rendered.html.indexOf(PHRASE)).toBeLessThan(rendered.html.indexOf('</body>'));
    expect(
      warn.mock.calls.some((call) => String(call[1] ?? '').includes('parceiro de credito')),
    ).toBe(true);
    warn.mockRestore();
  });

  it('(f) sem creditPartnerName o template do banco renderiza igual ao de hoje (nenhuma injecao)', async () => {
    const html = dbLikeHtml();
    mockDbTemplate(html, 'Dear all,\r\n\r\n{{messageText}}Attached is our PO.\r\n\r\n{{senderSignatureText}}');
    const rendered = await renderPoFromTemplate({ ...baseVars, message: 'Oi.' });
    expect(rendered.html).toBe(renderPoHtmlFromTemplate(html, { ...baseVars, message: 'Oi.', subject: rendered.subject }));
    expect(rendered.html).not.toContain('credit support');
    expect(rendered.text).not.toContain('credit support');
    // supplierName sozinho (sem parceiro) tambem nao injeta.
    const onlySupplier = await renderPoFromTemplate({ ...baseVars, supplierName: 'Acme' });
    expect(onlySupplier.html).not.toContain('credit support');
  });

  it('(g) nomes/mensagem com "$&" nao quebram a injecao (HTML e texto)', async () => {
    mockDbTemplate(dbLikeHtml(), 'Dear all,\r\n\r\n{{messageText}}Attached is our PO.\r\n\r\n{{senderSignatureText}}');
    const rendered = await renderPoFromTemplate({
      ...partnerVars,
      supplierName: 'A$&B',
      creditPartnerName: 'P$1$$',
      message: 'custa $& e $1',
    });
    expect(countOf(rendered.html, PHRASE)).toBe(1);
    expect(rendered.html).toContain('supplied by A$&amp;B, purchased through P$1$$ (credit support)');
    expect(rendered.text).toContain('supplied by A$&B, purchased through P$1$$ (credit support)');
    expect(rendered.html).toContain('custa $&amp; e $1');
  });

  it('renderPoPlainText: linha do parceiro so quando ha creditPartnerName', () => {
    expect(renderPoPlainText(baseVars)).not.toContain('credit support');
    const text = renderPoPlainText(partnerVars);
    expect(text).toContain(
      'This purchase order refers to goods supplied by Acme Chemicals, purchased through Banco Parceiro (credit support).',
    );
    expect(text.indexOf('credit support')).toBeLessThan(text.indexOf('Attached is our PO'));
  });

  it('o arquivo-fallback tem a secao condicional do parceiro', () => {
    expect(loadFileTemplate()).toContain('{{#creditPartnerName}}');
  });
});
