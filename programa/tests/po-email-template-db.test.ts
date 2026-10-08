import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';

const run = process.env.RUN_DB_TESTS === 'true';

const MIGRATION_DIR = path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20261007180100_quote_po_template_message_signature_logo',
);
const SEED_SQL = path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260820_seed_quote_po_template',
  'migration.sql',
);

// Statements do arquivo de migration, sem comentarios, para reexecutar com
// outro locale (a linha 'en' real nao e' tocada).
function migrationStatements(locale: string): string[] {
  const sql = fs
    .readFileSync(path.join(MIGRATION_DIR, 'migration.sql'), 'utf-8')
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

// HTML e texto da seed original (template legado, com o slot).
function loadSeed(): { html: string; text: string } {
  const sql = fs.readFileSync(SEED_SQL, 'utf-8').replace(/\r\n/g, '\n');
  const htmlStart = sql.indexOf("'<!doctype html>");
  const htmlEnd = sql.indexOf("</html>',", htmlStart) + '</html>'.length;
  const textStart = sql.indexOf("'Dear all,", htmlEnd);
  const textEnd = sql.indexOf("',\n    CURRENT_TIMESTAMP", textStart);
  return {
    html: sql.slice(htmlStart + 1, htmlEnd).replace(/''/g, "'"),
    text: sql.slice(textStart + 1, textEnd).replace(/''/g, "'"),
  };
}

describe.skipIf(!run)('Migration do template quote_po (mensagem, assinatura, logo) em Postgres isolado', () => {
  let prisma: any;
  const createdUserIds: number[] = [];
  let createdRoleId: number | null = null;

  async function execMigration(locale: string): Promise<void> {
    for (const statement of migrationStatements(locale)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }

  async function putZz(htmlBody: string, textBody: string): Promise<void> {
    await prisma.emailTemplate.deleteMany({ where: { key: 'quote_po', locale: 'zz' } });
    await prisma.emailTemplate.create({
      data: { key: 'quote_po', locale: 'zz', subject: 'Purchase Order - {{requestCode}}', htmlBody, textBody },
    });
  }

  async function getZz(): Promise<{ htmlBody: string; textBody: string }> {
    return prisma.emailTemplate.findUnique({ where: { key_locale: { key: 'quote_po', locale: 'zz' } } });
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
      await prisma.emailTemplate.deleteMany({ where: { key: 'quote_po', locale: 'zz' } });
      if (createdUserIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      if (createdRoleId) {
        await prisma.role.deleteMany({ where: { id: createdRoleId, users: { none: {} } } });
      }
    }
    await prisma?.$disconnect();
  });

  it('a linha quote_po/en migrada tem os 5 placeholders e perdeu o slot', async () => {
    const row = await prisma.emailTemplate.findUnique({
      where: { key_locale: { key: 'quote_po', locale: 'en' } },
    });
    expect(row).toBeTruthy();

    // {{message}} logo apos o </p> do "Dear all,".
    expect(row.htmlBody).toMatch(/<p[^>]*>Dear all,<\/p>\{\{message\}\}/);
    expect(row.htmlBody).toContain('{{senderSignature}}');
    expect(row.htmlBody).toMatch(/\{\{companyLogo\}\}<div[^>]*>\s*SQ Quimica &#183; Purchase Order/);
    expect(row.htmlBody).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');
    // Cada placeholder aparece uma unica vez (nada duplicado).
    for (const placeholder of ['{{message}}', '{{senderSignature}}', '{{companyLogo}}']) {
      expect(row.htmlBody.split(placeholder)).toHaveLength(2);
    }

    expect(row.textBody).toMatch(/Dear all,\r?\n\r?\n\{\{messageText\}\}Attached is our PO/);
    expect(row.textBody).toMatch(/\{\{senderSignatureText\}\}PO reference: /);
    expect(row.textBody.split('{{messageText}}')).toHaveLength(2);
    expect(row.textBody.split('{{senderSignatureText}}')).toHaveLength(2);
    // A migration anterior (porto dinamico) continua valendo.
    expect(row.htmlBody).toContain('{{destinationPort}}');
  });

  it('o renderer coloca a mensagem logo apos "Dear all," usando a linha migrada', async () => {
    const { renderPoHtmlFromTemplate, renderPoTextFromTemplate } = await import(
      '../src/mailer/renderQuotePo'
    );
    const row = await prisma.emailTemplate.findUnique({
      where: { key_locale: { key: 'quote_po', locale: 'en' } },
    });
    const vars = {
      subject: 'Purchase Order - QR-1',
      requestCode: 'QR-1',
      supplierContactName: 'John',
      forwarderInfo: 'Fwd',
      destinationPort: 'Santos',
      message: 'Mensagem de teste',
      senderName: 'Maria',
      senderEmail: 'maria@sqquimica.com',
      companyLogoSrc: 'cid:sq-logo@intelliquote',
    };
    const html = renderPoHtmlFromTemplate(row.htmlBody, vars);
    expect(html.split('Mensagem de teste')).toHaveLength(2);
    expect(html.indexOf('Mensagem de teste')).toBeGreaterThan(html.indexOf('Dear all,'));
    expect(html.indexOf('Mensagem de teste')).toBeLessThan(html.indexOf('Attached is our PO'));
    expect(html).toContain('src="cid:sq-logo@intelliquote"');
    expect(html.indexOf('Best regards,')).toBeLessThan(html.indexOf('PO reference:'));

    const text = renderPoTextFromTemplate(row.textBody, vars);
    expect(text.split('Mensagem de teste')).toHaveLength(2);
    expect(text.indexOf('Best regards,')).toBeLessThan(text.indexOf('PO reference:'));
  });

  it('reexecutar o SQL (locale zz): linha legada migra e linha ja migrada fica identica', async () => {
    const seed = loadSeed();
    await putZz(seed.html, seed.text);

    await execMigration('zz');
    const afterFirst = await getZz();
    expect(afterFirst.htmlBody).toMatch(/<p[^>]*>Dear all,<\/p>\{\{message\}\}/);
    expect(afterFirst.htmlBody).toContain('{{senderSignature}}');
    expect(afterFirst.htmlBody).toContain('{{companyLogo}}');
    expect(afterFirst.htmlBody).not.toContain('<!--CUSTOM_MESSAGE_SLOT-->');
    expect(afterFirst.textBody).toContain('{{messageText}}');
    expect(afterFirst.textBody).toContain('{{senderSignatureText}}PO reference: ');

    // (i) segunda execucao: nada muda.
    await execMigration('zz');
    const afterSecond = await getZz();
    expect(afterSecond.htmlBody).toBe(afterFirst.htmlBody);
    expect(afterSecond.textBody).toBe(afterFirst.textBody);

    // (i) linha 'en' ja migrada, copiada para zz: continua identica.
    const en = await prisma.emailTemplate.findUnique({
      where: { key_locale: { key: 'quote_po', locale: 'en' } },
    });
    await putZz(en.htmlBody, en.textBody);
    await execMigration('zz');
    const copy = await getZz();
    expect(copy.htmlBody).toBe(en.htmlBody);
    expect(copy.textBody).toBe(en.textBody);
  });

  it('(ii) linha customizada sem as ancoras continua identica', async () => {
    const html = '<html><body><h1>Meu PO customizado</h1><p>Ola, tudo bem?</p>{{forwarderInfo}}</body></html>';
    const text = 'Meu PO customizado\nOla, tudo bem?\n{{forwarderInfoText}}';
    await putZz(html, text);
    await execMigration('zz');
    const row = await getZz();
    expect(row.htmlBody).toBe(html);
    expect(row.textBody).toBe(text);
  });

  it('customizada que tem o slot mas nao {{message}} mantem o slot (a mensagem nao perde o lugar)', async () => {
    const html = '<html><body><p>Hello</p><!--CUSTOM_MESSAGE_SLOT--></body></html>';
    await putZz(html, 'Hello');
    await execMigration('zz');
    const row = await getZz();
    expect(row.htmlBody).toBe(html);
  });

  it('bytea da assinatura: roundtrip byte a byte e cascade ao apagar o usuario', async () => {
    const existingRole = await prisma.role.findUnique({ where: { name: 'comprador' } });
    const role =
      existingRole ?? (await prisma.role.create({ data: { name: 'comprador' } }));
    if (!existingRole) createdRoleId = role.id;
    const user = await prisma.user.create({
      data: {
        name: 'Assinatura Teste',
        email: `assinatura.${Date.now()}@local.test`,
        passwordHash: await hashPassword('Test12345!'),
        roleId: role.id,
      },
    });
    createdUserIds.push(user.id);

    const bytes = Buffer.alloc(4096);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + 7) % 256;
    bytes[0] = 0;
    bytes[1] = 255;

    await prisma.userEmailSignature.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        text: 'Att, Maria',
        imageData: new Uint8Array(bytes),
        imageMimeType: 'image/png',
        imageWidth: 300,
        imageHeight: 90,
        imageSize: bytes.length,
      },
      update: {},
    });
    const stored = await prisma.userEmailSignature.findUnique({ where: { userId: user.id } });
    expect(Buffer.from(stored.imageData).equals(bytes)).toBe(true);
    expect(stored.imageMimeType).toBe('image/png');
    expect(stored.imageWidth).toBe(300);
    expect(stored.text).toBe('Att, Maria');

    // Zerar so a imagem preserva o texto.
    await prisma.userEmailSignature.updateMany({
      where: { userId: user.id },
      data: { imageData: null, imageMimeType: null, imageWidth: null, imageHeight: null, imageSize: null },
    });
    const cleared = await prisma.userEmailSignature.findUnique({ where: { userId: user.id } });
    expect(cleared.imageData).toBeNull();
    expect(cleared.text).toBe('Att, Maria');

    await prisma.user.delete({ where: { id: user.id } });
    createdUserIds.pop();
    expect(await prisma.userEmailSignature.findUnique({ where: { userId: user.id } })).toBeNull();
  });
});
