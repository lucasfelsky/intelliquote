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
const ROTATE_SUPPLIER_NAME = 'Fornecedor Teste Rotate Reply';
const ROTATE_REQUEST_CODE = 'QR-TEST-ROTATE-REPLY';
const RESEND_REQUEST_CODE = 'QR-TEST-ROTATE-RESEND';

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
      await prisma.quoteRequest.deleteMany({ where: { requestCode: { in: [ROTATE_REQUEST_CODE, RESEND_REQUEST_CODE] } } });
      await prisma.supplier.deleteMany({ where: { name: ROTATE_SUPPLIER_NAME } });
      await prisma.user.deleteMany({ where: { email: 'rotate-reply@intelliquote.local' } });
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

  describe('rotateTokenForReply (DB real)', () => {
    it('move a resposta e o historico pro token novo, revoga o antigo e respeita as constraints unicas', async () => {
      const { SupplierPortalService } = await import('../src/services/SupplierPortalService');
      const { SupplierPortalResponseService } = await import('../src/services/SupplierPortalResponseService');

      const role = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
      const user = await prisma.user.create({
        data: { name: 'Rotate Reply', email: 'rotate-reply@intelliquote.local', passwordHash: 'x', roleId: role.id },
      });
      const supplier = await prisma.supplier.create({
        data: {
          name: ROTATE_SUPPLIER_NAME,
          contacts: {
            create: [
              { name: 'Principal', email: 'principal@rotate-reply.test', isPrimary: true },
              { name: 'Secundario', email: 'secundario@rotate-reply.test' },
            ],
          },
        },
        include: { contacts: true },
      });
      const [primary, secondary] = supplier.contacts;
      const quoteRequest = await prisma.quoteRequest.create({
        data: {
          requestCode: ROTATE_REQUEST_CODE,
          productName: 'Produto Rotate',
          quantity: 10,
          desiredIncoterm: ['CIF'],
          currency: 'USD',
          createdById: user.id,
          items: { create: [{ productName: 'Item Rotate', quantity: 10, unit: 'KG' }] },
        },
        include: { items: true },
      });

      // Token ORIGINAL (contato secundario) com resposta + 1 revisao, como o portal deixaria.
      const original = (await SupplierPortalService.createToken({
        quoteRequestId: quoteRequest.id,
        supplierId: supplier.id,
        supplierContactId: secondary.id,
        createdById: user.id,
        ttlDays: 3,
      })) as { id: number; rawToken: string; expiresAt: Date };
      const respondedAt = new Date('2026-10-01T10:00:00Z');
      const response = await prisma.supplierPortalResponse.create({
        data: {
          portalTokenId: original.id,
          quoteRequestId: quoteRequest.id,
          supplierId: supplier.id,
          supplierContactId: secondary.id,
          incoterm: 'CIF',
          totalPrice: 100,
          version: 2,
          submittedAt: respondedAt,
          items: { create: [{ quoteRequestItemId: quoteRequest.items[0].id, unitPrice: 10, quantity: 10, totalPrice: 100 }] },
        },
      });
      await prisma.supplierPortalResponseRevision.create({
        data: {
          portalTokenId: original.id,
          version: 1,
          currency: 'USD',
          incoterm: 'CIF',
          paymentTermsDays: 30,
          totalPrice: 120,
          totalPriceCurrency: 'USD',
          validityDays: 30,
          items: [],
          submittedAt: new Date('2026-09-30T10:00:00Z'),
        },
      });
      await prisma.supplierPortalToken.update({
        where: { id: original.id },
        data: { responseId: response.id, respondedAt },
      });

      const rotated = await SupplierPortalService.rotateTokenForReply({
        quoteRequestId: quoteRequest.id,
        supplierId: supplier.id,
        supplierContactId: primary.id,
        createdById: user.id,
      });

      expect(rotated.previous?.id).toBe(original.id);
      expect(rotated.created.id).not.toBe(original.id);
      expect(rotated.created.supplierContactId).toBe(primary.id);
      expect(rotated.created.responseId).toBe(response.id);
      expect(rotated.created.respondedAt).toEqual(respondedAt);
      // max(expiresAt do anterior = 3d, agora + 14d) = ~14d
      expect(rotated.created.expiresAt.getTime()).toBeGreaterThan(Date.now() + 13.9 * 86_400_000);

      // Resposta e historico no token novo; token antigo revogado e sem resposta.
      const moved = await SupplierPortalResponseService.getByTokenId(rotated.created.id);
      expect(moved?.id).toBe(response.id);
      expect(await SupplierPortalResponseService.getByTokenId(original.id)).toBeNull();
      expect(await SupplierPortalResponseService.getHistoryByTokenId(rotated.created.id)).toHaveLength(1);
      expect(await SupplierPortalResponseService.getHistoryByTokenId(original.id)).toHaveLength(0);
      const previousRow = await prisma.supplierPortalToken.findUnique({ where: { id: original.id } });
      expect(previousRow?.revokedAt).not.toBeNull();
      expect(previousRow?.responseId).toBeNull();

      // Link antigo morreu (revoked); o novo abre a proposta ja respondida.
      await expect(SupplierPortalService.validate({ rawToken: original.rawToken })).rejects.toMatchObject({ status: 404 });
      const invalidLog = await prisma.supplierPortalTokenLog.findFirst({
        where: { tokenId: original.id, kind: 'INVALID' },
        orderBy: { id: 'desc' },
      });
      expect(invalidLog?.meta).toEqual({ reason: 'revoked' });
      const validated = await SupplierPortalService.validate({ rawToken: rotated.rawToken });
      expect(validated.alreadyResponded).toBe(true);
      expect(validated.token.id).toBe(rotated.created.id);

      // Rotacionar de novo (mesmo contato) tambem respeita responseId @unique / portalTokenId @unique.
      const again = await SupplierPortalService.rotateTokenForReply({
        quoteRequestId: quoteRequest.id,
        supplierId: supplier.id,
        supplierContactId: primary.id,
        createdById: user.id,
      });
      expect(again.previous?.id).toBe(rotated.created.id);
      expect(again.created.responseId).toBe(response.id);
      expect((await SupplierPortalResponseService.getByTokenId(again.created.id))?.id).toBe(response.id);
      expect(await SupplierPortalResponseService.getHistoryByTokenId(again.created.id)).toHaveLength(1);
      await expect(SupplierPortalService.validate({ rawToken: rotated.rawToken })).rejects.toMatchObject({ status: 404 });
    });

    // Caso do review: fornecedor respondeu pelo token A, a cotacao foi REENVIADA
    // (dispatch revoga A e cria B, sem resposta). A resposta continua presa em A
    // (revogado); o reply tem que leva-la pro token novo, nao abrir vazio.
    it('resposta num token revogado por reenvio migra pro token novo (sem 2a resposta)', async () => {
      const { SupplierPortalService } = await import('../src/services/SupplierPortalService');
      const { SupplierPortalResponseService } = await import('../src/services/SupplierPortalResponseService');

      const role = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
      const user = await prisma.user.upsert({
        where: { email: 'rotate-reply@intelliquote.local' },
        update: {},
        create: { name: 'Rotate Reply', email: 'rotate-reply@intelliquote.local', passwordHash: 'x', roleId: role.id },
      });
      const supplier = await prisma.supplier.create({
        data: {
          name: ROTATE_SUPPLIER_NAME,
          contacts: { create: [{ name: 'Principal', email: 'principal2@rotate-reply.test', isPrimary: true }] },
        },
        include: { contacts: true },
      });
      const [primary] = supplier.contacts;
      const quoteRequest = await prisma.quoteRequest.create({
        data: {
          requestCode: RESEND_REQUEST_CODE,
          productName: 'Produto Resend',
          quantity: 10,
          desiredIncoterm: ['CIF'],
          currency: 'USD',
          createdById: user.id,
          items: { create: [{ productName: 'Item Resend', quantity: 10, unit: 'KG' }] },
        },
        include: { items: true },
      });
      const pair = { quoteRequestId: quoteRequest.id, supplierId: supplier.id };

      // Token A + resposta do fornecedor.
      const tokenA = (await SupplierPortalService.createToken({
        ...pair,
        supplierContactId: primary.id,
        createdById: user.id,
      })) as { id: number; rawToken: string };
      const respondedAt = new Date('2026-10-03T09:00:00Z');
      const response = await prisma.supplierPortalResponse.create({
        data: {
          portalTokenId: tokenA.id,
          ...pair,
          supplierContactId: primary.id,
          incoterm: 'CIF',
          totalPrice: 100,
          submittedAt: respondedAt,
          items: { create: [{ quoteRequestItemId: quoteRequest.items[0].id, unitPrice: 10, quantity: 10, totalPrice: 100 }] },
        },
      });
      await prisma.supplierPortalToken.update({ where: { id: tokenA.id }, data: { responseId: response.id, respondedAt } });

      // Reenvio (mesmo caminho do dispatch): revoga A, cria B vazio.
      await SupplierPortalService.revokeTokensForContact({ quoteRequestId: quoteRequest.id, supplierContactId: primary.id });
      const tokenB = (await SupplierPortalService.createToken({
        ...pair,
        supplierContactId: primary.id,
        createdById: user.id,
      })) as { id: number; rawToken: string };
      const revokedA = await prisma.supplierPortalToken.findUnique({ where: { id: tokenA.id } });
      expect(revokedA?.revokedAt).not.toBeNull();
      expect(revokedA?.responseId).toBe(response.id);

      const rotated = await SupplierPortalService.rotateTokenForReply({
        ...pair,
        supplierContactId: primary.id,
        createdById: user.id,
      });

      // previous = A (revogado, dono da resposta), nao B (ativo, vazio).
      expect(rotated.previous?.id).toBe(tokenA.id);
      expect(rotated.created.responseId).toBe(response.id);
      expect(rotated.created.respondedAt).toEqual(respondedAt);
      const movedResponse = await prisma.supplierPortalResponse.findUnique({ where: { id: response.id } });
      expect(movedResponse?.portalTokenId).toBe(rotated.created.id);
      expect((await SupplierPortalResponseService.getByTokenId(rotated.created.id))?.id).toBe(response.id);
      const validated = await SupplierPortalService.validate({ rawToken: rotated.rawToken });
      expect(validated.alreadyResponded).toBe(true);
      // Uma unica resposta para o par (cotacao, fornecedor); A mantem o revokedAt original; B revogado.
      expect(await prisma.supplierPortalResponse.count({ where: { ...pair, deletedAt: null } })).toBe(1);
      const afterA = await prisma.supplierPortalToken.findUnique({ where: { id: tokenA.id } });
      expect(afterA?.revokedAt).toEqual(revokedA?.revokedAt);
      expect(afterA?.responseId).toBeNull();
      const afterB = await prisma.supplierPortalToken.findUnique({ where: { id: tokenB.id } });
      expect(afterB?.revokedAt).not.toBeNull();
      await expect(SupplierPortalService.validate({ rawToken: tokenA.rawToken })).rejects.toMatchObject({ status: 404 });
      await expect(SupplierPortalService.validate({ rawToken: tokenB.rawToken })).rejects.toMatchObject({ status: 404 });
    });
  });
});
