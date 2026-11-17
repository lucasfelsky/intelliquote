import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildIndentPortalLink,
  buildIndentSubject,
  renderIndentQuoteRequest,
  type IndentQuoteRequestVars,
} from '../src/mailer/renderIndentQuoteRequest';

const FORBIDDEN = /\b(buyer|purchaser|on behalf of|our customer)\b/i;

function vars(overrides: Partial<IndentQuoteRequestVars> = {}): IndentQuoteRequestVars {
  return {
    processNumber: '275/26',
    revision: 1,
    subject: 'x',
    portalLink: 'https://portal.example.test/portal/indent?token=abc_DEF-123&v=1',
    expiresAt: new Date('2026-11-30T15:00:00.000Z'),
    destinationPort: 'Santos',
    incoterm: 'CFR',
    message: null,
    endCustomer: null,
    items: [
      { name: 'Citric acid anhydrous', cas: '77-92-9', quantityKg: '25000.000' },
      { name: 'Sodium tripolyphosphate (STPP)', cas: null, quantityKg: '10000.000' },
    ],
    ...overrides,
  };
}

describe('buildIndentSubject', () => {
  it('R1: NNN/AA · Indent quotation request · item', () => {
    expect(buildIndentSubject('275/26', 1, 'Citric acid anhydrous')).toBe('275/26 · Indent quotation request · Citric acid anhydrous');
  });

  it('R2+: R<n> - NNN/AA · Indent price update requested · item', () => {
    expect(buildIndentSubject('275/26', 2, 'STPP')).toBe('R2 - 275/26 · Indent price update requested · STPP');
    expect(buildIndentSubject('275/26', 3, 'STPP')).toBe('R3 - 275/26 · Indent price update requested · STPP');
  });

  it('trunca o item em 80 caracteres com reticencias', () => {
    const subject = buildIndentSubject('275/26', 1, 'A'.repeat(200));
    const item = subject.split(' · ')[2];

    expect(item).toHaveLength(80);
    expect(item.endsWith('…')).toBe(true);
  });

  it('CR, LF e TAB no item viram espaco (sem injecao de cabecalho)', () => {
    const subject = buildIndentSubject('275/26', 1, 'Acid\r\nBcc: x@evil.test\tmore');

    expect(subject).not.toMatch(/[\r\n\t]/);
    expect(subject).toContain('Acid Bcc: x@evil.test more');
  });
});

describe('renderIndentQuoteRequest', () => {
  it('escapa item, porto e mensagem (script e aspas)', () => {
    const { html } = renderIndentQuoteRequest(
      vars({
        destinationPort: 'Santos "<script>alert(2)</script>',
        message: 'Hi <img src=x onerror=alert(3)>\nSecond "line"',
        items: [{ name: '<script>alert(1)</script> "acid"', cas: '77-92-9', quantityKg: '1000.000' }],
      }),
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;acid&quot;');
    expect(html).toContain('Santos &quot;&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(3)&gt;<br>Second &quot;line&quot;');
  });

  it('escapa o link (atributo) e nao deixa placeholder sem preencher', () => {
    const { html } = renderIndentQuoteRequest(vars({ portalLink: 'https://x.test/portal/indent?token=a"b&v=1' }));

    expect(html).toContain('href="https://x.test/portal/indent?token=a&quot;b&amp;v=1"');
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(html).not.toMatch(/<!--(END)?IF:/);
  });

  it('sem endCustomer nao ha "End customer"; com, ha', () => {
    const without = renderIndentQuoteRequest(vars());
    const withClient = renderIndentQuoteRequest(vars({ endCustomer: 'Vale Verde Fertilizantes Ltda' }));

    expect(without.html).not.toContain('End customer');
    expect(without.text).not.toContain('End customer');
    expect(withClient.html).toContain('End customer');
    expect(withClient.html).toContain('Vale Verde Fertilizantes Ltda');
    expect(withClient.text).toContain('End customer: Vale Verde Fertilizantes Ltda');
  });

  it('endCustomer (parceiro) sai escapado no HTML; no texto sai literal', () => {
    const name = 'A&B <script>alert(1)</script> "Ltda"';
    const { html, text } = renderIndentQuoteRequest(vars({ endCustomer: name }));

    expect(html).toContain('End customer');
    expect(html).toContain('A&amp;B &lt;script&gt;alert(1)&lt;/script&gt; &quot;Ltda&quot;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain(name);
    expect(text).toContain(`End customer: ${name}`);
  });

  it('valor com marcador do template nao e reprocessado (passada unica)', () => {
    const { html } = renderIndentQuoteRequest(
      vars({ message: '{{endCustomer}} <!--IF:endCustomer-->x<!--ENDIF:endCustomer-->', destinationPort: '{{portalLink}}' }),
    );

    expect(html).toContain('{{endCustomer}} &lt;!--IF:endCustomer--&gt;x&lt;!--ENDIF:endCustomer--&gt;');
    expect(html).toContain('>{{portalLink}}<');
    expect(html).not.toContain('End customer');
  });

  it('bloco de mensagem so aparece quando ha mensagem', () => {
    expect(renderIndentQuoteRequest(vars()).html).not.toContain('Message from SQ Quimica');
    expect(renderIndentQuoteRequest(vars({ message: '   ' })).html).not.toContain('Message from SQ Quimica');
    expect(renderIndentQuoteRequest(vars({ message: 'Please improve CFR.' })).html).toContain('Message from SQ Quimica');
  });

  it('R1 e R2: titulo, rotulo do numero e referencia', () => {
    const r1 = renderIndentQuoteRequest(vars());
    const r2 = renderIndentQuoteRequest(vars({ revision: 2 }));

    expect(r1.html).toContain('Quotation request');
    expect(r1.html).toContain('Request no.');
    expect(r1.html).toContain('>275/26<');
    expect(r2.html).toContain('Price update requested');
    expect(r2.html).toContain('Revision of request');
    expect(r2.html).toContain('R2 - 275/26');
    expect(r2.text).toContain('R2 - 275/26');
  });

  it('mostra porto, incoterm, itens, validade em fuso de Sao Paulo e o botao', () => {
    const { html, text } = renderIndentQuoteRequest(vars());

    expect(html).toContain('Requested by');
    expect(html).toContain('Destination port');
    expect(html).toContain('>Santos<');
    expect(html).toContain('CFR');
    expect(html).toContain('Citric acid anhydrous');
    expect(html).toContain('77-92-9');
    expect(html).toContain('25,000');
    expect(html).toContain('Open quotation form');
    expect(html).toContain('This link is personal and expires on Nov 30, 2026.');
    expect(html).toContain('#004153');
    expect(html).toContain('#F5A524');
    expect(text).toContain('Citric acid anhydrous (CAS 77-92-9): 25,000 kg');
    expect(text).toContain('https://portal.example.test/portal/indent?token=abc_DEF-123&v=1');
  });

  it('HTML e texto nunca casam as frases proibidas', () => {
    for (const input of [vars(), vars({ revision: 2, message: 'Please improve.' }), vars({ endCustomer: 'Vale Verde Fertilizantes Ltda' })]) {
      const { html, text, subject } = renderIndentQuoteRequest(input);

      expect(html).not.toMatch(FORBIDDEN);
      expect(text).not.toMatch(FORBIDDEN);
      expect(subject).not.toMatch(FORBIDDEN);
    }
  });

  it('assunto passa sem quebra de linha', () => {
    expect(renderIndentQuoteRequest(vars({ subject: 'a\r\nb' })).subject).toBe('a b');
  });

  it('o arquivo do template nao tem as palavras proibidas nem script ou imagem externa', () => {
    const file = fs.readFileSync(path.join(__dirname, '..', 'src', 'mailer', 'templates', 'indent-quote-request.en.html'), 'utf-8');

    expect(file).not.toMatch(FORBIDDEN);
    expect(file).not.toMatch(/<script|<img|<link|url\(/i);
  });
});

describe('buildIndentPortalLink', () => {
  it('monta /portal/indent?token= com o token codificado', () => {
    const link = buildIndentPortalLink('a+b/c');

    expect(link).toMatch(/\/portal\/indent\?token=a%2Bb%2Fc&v=\d+$/);
  });
});
