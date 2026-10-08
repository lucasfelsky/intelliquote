import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = process.env.RUN_DB_TESTS === 'true';

const MIGRATION_SQL = path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20261008210000_quote_reply_template_message_target_column',
  'migration.sql',
);

// Statements do arquivo de migration, sem comentarios, para reexecutar com
// outro locale (a linha 'en' real nao e' tocada).
function migrationStatements(locale: string): string[] {
  const sql = fs
    .readFileSync(MIGRATION_SQL, 'utf-8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return sql
    .split(/;[ \t]*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(`"locale"='en'`, `"locale"='${locale}'`));
}

const LEGACY_THEAD = [
  '<thead>',
  '  <tr bgcolor="#F8FBFA" style="background-color:#F8FBFA;">',
  '    <th align="left" width="200" style="width:200px;">ITEM</th>',
  '    <th align="left" width="80" style="width:80px;">INCOTERM</th>',
  '    <th align="right" width="100" style="width:100px;">QUANTITY</th>',
  '    <th align="right" width="90" style="width:90px;">UNIT PRICE</th>',
  '    <th align="right" width="90" style="width:90px;">TOTAL</th>',
  '  </tr>',
  '</thead>',
].join('\n');

// HTML legado: thead fixo de 5 colunas + {{itemsRows}} + bloco Target Price + slot da mensagem.
const LEGACY_HTML = [
  '<html><body>',
  '<p style="margin:0 0 12px 0;">Dear {{supplierContactName}},</p>',
  '<p>{{introText}}</p>',
  '<table>',
  LEGACY_THEAD,
  '<tbody>{{itemsRows}}</tbody>',
  '</table>',
  '{{#targetPriceStr}}<p><strong>Target Price:</strong> {{targetPriceStr}}</p>{{/targetPriceStr}}',
  '<!--CUSTOM_MESSAGE_SLOT-->',
  '<p>Best regards,</p>',
  '</body></html>',
].join('\n');

const LEGACY_TEXT = 'Dear {{supplierContactName}},\n\n{{introText}}\n\n{{itemsText}}\n\nBest regards,';

// Id de cotacao que nao colide com nada (MailLog nao tem FK: relatedEntityId e' texto).
const DISPATCH_QUOTE_ID = '987654321';

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe.skipIf(!run)('Migration do template quote_reply (mensagem + coluna Target Price) em Postgres isolado', () => {
  let prisma: any;

  async function execMigration(locale: string): Promise<void> {
    for (const statement of migrationStatements(locale)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }

  async function putZz(htmlBody: string, textBody: string): Promise<void> {
    await prisma.emailTemplate.deleteMany({ where: { key: 'quote_reply', locale: 'zz' } });
    await prisma.emailTemplate.create({
      data: { key: 'quote_reply', locale: 'zz', subject: '{{subject}}', htmlBody, textBody },
    });
  }

  async function getZz(): Promise<{ htmlBody: string; textBody: string }> {
    return prisma.emailTemplate.findUnique({ where: { key_locale: { key: 'quote_reply', locale: 'zz' } } });
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/iq_critical_test') {
      throw new Error('Execute scripts/test-critical-local.mjs para usar um banco descartavel.');
    }
    ({ prisma } = await import('../src/lib/prisma'));
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.emailTemplate.deleteMany({ where: { key: 'quote_reply', locale: 'zz' } });
      await prisma.mailLog.deleteMany({ where: { relatedEntityType: 'quote_request', relatedEntityId: DISPATCH_QUOTE_ID } });
      await prisma.supplier.deleteMany({ where: { name: 'Fornecedor Teste Assunto Dispatch' } });
    }
    await prisma?.$disconnect();
  });

  it('linha legada migra: {{message}} apos o "Dear", {{itemsHeaderRow}} no thead e {{messageText}} no texto', async () => {
    await putZz(LEGACY_HTML, LEGACY_TEXT);
    await execMigration('zz');
    const row = await getZz();

    expect(row.htmlBody).toMatch(/<p[^>]*>Dear \{\{supplierContactName\}\},<\/p>\{\{message\}\}/);
    expect(row.htmlBody).toContain('<thead>{{itemsHeaderRow}}</thead>');
    expect(row.htmlBody).not.toContain('<th ');
    expect(row.htmlBody).toContain('{{itemsRows}}');
    // Cada placeholder aparece uma unica vez.
    expect(count(row.htmlBody, '{{message}}')).toBe(1);
    expect(count(row.htmlBody, '{{itemsHeaderRow}}')).toBe(1);
    // Slot e bloco do alvo ficam (o renderer os neutraliza).
    expect(row.htmlBody).toContain('<!--CUSTOM_MESSAGE_SLOT-->');
    expect(row.htmlBody).toContain('{{#targetPriceStr}}');

    expect(row.textBody).toMatch(/^Dear \{\{supplierContactName\}\},\n\n\{\{messageText\}\}\{\{introText\}\}/);
    expect(count(row.textBody, '{{messageText}}')).toBe(1);
  });

  it('o renderer usa a linha migrada: mensagem logo apos o Dear, coluna gerada e slot vazio', async () => {
    const { renderReplyHtmlFromTemplate, renderReplyTextFromTemplate } = await import('../src/mailer/renderQuoteReply');
    await putZz(LEGACY_HTML, LEGACY_TEXT);
    await execMigration('zz');
    const row = await getZz();

    const vars = {
      subject: 'S',
      quoteRequestId: 1,
      requestCode: 'QR-1',
      productName: 'P',
      supplierName: 'Acme',
      supplierContactName: 'John',
      currency: 'USD',
      isWinner: false,
      message: 'Mensagem de teste',
      hasItemTargets: true,
      items: [{ name: 'PI-TPO', incoterm: 'CIF', quantity: 5, unit: 'KG', unitPrice: 2, targetPrice: 1.5 }],
    };
    const html = renderReplyHtmlFromTemplate(row.htmlBody, vars);
    expect(count(html, 'Mensagem de teste')).toBe(1);
    expect(html.indexOf('Mensagem de teste')).toBeGreaterThan(html.indexOf('Dear John,'));
    expect(html.indexOf('Mensagem de teste')).toBeLessThan(html.indexOf('<table>'));
    expect(html).toContain('TARGET PRICE');
    expect(html).not.toContain('Target Price:');
    expect(html).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');

    const text = renderReplyTextFromTemplate(row.textBody, vars);
    expect(count(text, 'Mensagem de teste')).toBe(1);
    expect(text.indexOf('Mensagem de teste')).toBeGreaterThan(text.indexOf('Dear John,'));
  });

  it('reexecutar o SQL nao muda nada (idempotente)', async () => {
    await putZz(LEGACY_HTML, LEGACY_TEXT);
    await execMigration('zz');
    const afterFirst = await getZz();

    await execMigration('zz');
    const afterSecond = await getZz();
    expect(afterSecond.htmlBody).toBe(afterFirst.htmlBody);
    expect(afterSecond.textBody).toBe(afterFirst.textBody);
  });

  it('linha customizada sem as ancoras continua identica', async () => {
    const html = '<html><body><h1>Meu reply customizado</h1><p>Ola, tudo bem?</p>{{itemsRows}}</body></html>';
    const text = 'Meu reply customizado\nOla, tudo bem?\n{{itemsText}}';
    await putZz(html, text);
    await execMigration('zz');
    const row = await getZz();
    expect(row.htmlBody).toBe(html);
    expect(row.textBody).toBe(text);
  });

  it('linha com linhas congeladas (sem {{itemsRows}}) nao ganha {{itemsHeaderRow}}', async () => {
    const frozen = LEGACY_HTML.replace('{{itemsRows}}', '<tr><td>PI-TPO</td><td>CIF</td><td>5 KG</td><td>2.00 USD</td><td>10.00 USD</td></tr>');
    await putZz(frozen, LEGACY_TEXT);
    await execMigration('zz');
    const row = await getZz();
    expect(row.htmlBody).not.toContain('{{itemsHeaderRow}}');
    expect(row.htmlBody).toContain('<th align="left" width="200"');
    // A mensagem ainda ganha o placeholder (ancora do "Dear" presente).
    expect(row.htmlBody).toContain('{{message}}');
  });

  it('thead com colunas fora do padrao nao e substituido', async () => {
    const custom = LEGACY_HTML.replace('>TOTAL</th>', '>AMOUNT</th>');
    await putZz(custom, LEGACY_TEXT);
    await execMigration('zz');
    const row = await getZz();
    expect(row.htmlBody).not.toContain('{{itemsHeaderRow}}');
    expect(row.htmlBody).toContain('AMOUNT');
  });

  it('linha que ja tem os placeholders novos fica identica', async () => {
    const migrated = [
      '<p>Dear {{supplierContactName}},</p>{{message}}',
      '<table><thead>{{itemsHeaderRow}}</thead><tbody>{{itemsRows}}</tbody></table>',
    ].join('\n');
    const text = 'Dear {{supplierContactName}},\n\n{{messageText}}{{introText}}';
    await putZz(migrated, text);
    await execMigration('zz');
    const row = await getZz();
    expect(row.htmlBody).toBe(migrated);
    expect(row.textBody).toBe(text);
  });

  // Regressao do reviewer: cotacao enviada a muitos contatos (um MailLog por contato) nao
  // pode esconder o log do fornecedor alvo atras dos N mais recentes da cotacao inteira.
  it('assunto do envio inicial e encontrado mesmo com mais de 50 logs mais recentes de outros contatos', async () => {
    const { QuoteResponseController } = await import('../src/controllers/QuoteResponseController');
    const supplier = await prisma.supplier.create({
      data: {
        name: 'Fornecedor Teste Assunto Dispatch',
        contacts: {
          create: [
            { name: 'Alvo Um', email: 'Alvo.Um@Fornecedor-Teste.com', isPrimary: true },
            { name: 'Alvo Dois', email: 'alvo.dois@fornecedor-teste.com' },
          ],
        },
      },
      include: { contacts: true },
    });
    const [contactA, contactB] = supplier.contacts;

    const base = { provider: 'console', fromAddress: 'comex@sqquimica.com', templateId: 'quote-dispatch', relatedEntityType: 'quote_request', relatedEntityId: DISPATCH_QUOTE_ID };
    const now = Date.now();
    // Logs do fornecedor alvo: o mais antigo de todos; um por supplierContactId, outro so por e-mail.
    await prisma.mailLog.create({
      data: { ...base, toEmail: 'alvo.um@fornecedor-teste.com', subject: 'Assunto do alvo (por contactId)', status: 'sent', templateVars: { supplierContactId: contactA.id }, createdAt: new Date(now - 3_600_000) },
    });
    // Mais de 50 logs MAIS RECENTES de outros contatos/fornecedores da mesma cotacao.
    await prisma.mailLog.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        ...base,
        toEmail: `outro${i}@outro-fornecedor.com`,
        subject: `Assunto de outro ${i}`,
        status: 'sent' as const,
        templateVars: { supplierContactId: 900000 + i },
        createdAt: new Date(now - i * 1000),
      })),
    });

    const byId = await (QuoteResponseController as any).findDispatchSubjectForSupplier(Number(DISPATCH_QUOTE_ID), supplier.id);
    expect(byId).toBe('Assunto do alvo (por contactId)');

    // Falha/suprimido do alvo e' ignorado; log mais novo so por e-mail (case-insensitive, sem supplierContactId) vence.
    await prisma.mailLog.create({
      data: { ...base, toEmail: 'ALVO.DOIS@fornecedor-teste.com', subject: 'Assunto por e-mail', status: 'queued', templateVars: null, createdAt: new Date(now - 1_800_000) },
    });
    await prisma.mailLog.create({
      data: { ...base, toEmail: 'alvo.dois@fornecedor-teste.com', subject: 'Falhou, ignorar', status: 'failed', templateVars: { supplierContactId: contactB.id }, createdAt: new Date(now - 1_000_000) },
    });
    const byEmail = await (QuoteResponseController as any).findDispatchSubjectForSupplier(Number(DISPATCH_QUOTE_ID), supplier.id);
    expect(byEmail).toBe('Assunto por e-mail');
  });
});
