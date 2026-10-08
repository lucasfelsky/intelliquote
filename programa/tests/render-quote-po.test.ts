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
