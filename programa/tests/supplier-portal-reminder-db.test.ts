import { createHash } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';
import { SupplierPortalReminderService } from '../src/services/SupplierPortalReminderService';
import { SupplierPortalService } from '../src/services/SupplierPortalService';

// So roda com RUN_DB_TESTS=true (scripts/test-critical-local.mjs: Postgres embutido com TODAS as migrations).
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `supplier-portal-reminder-db-${Date.now()}`;

// Terca 2030-01-08 04:00 BRT; os tokens nascem na vespera (24 h, data BRT anterior).
const NOW = new Date('2030-01-08T07:00:00Z');
const TODAY = '2030-01-08';
const TOKEN_CREATED_AT = new Date('2030-01-07T07:00:00Z');
const TOKEN_EXPIRES_AT = new Date('2030-01-20T12:00:00Z');

describe('SupplierPortalReminderService (DB)', () => {
  let userId = 0;
  let supplierId = 0;
  let otherSupplierId = 0;
  const contactIds: Record<'A' | 'B' | 'C' | 'D', number> = { A: 0, B: 0, C: 0, D: 0 };
  const quoteIds: Record<'Q1' | 'Q2' | 'Q3', number> = { Q1: 0, Q2: 0, Q3: 0 };
  const extraQuoteIds: number[] = [];
  const dispatchIds = new Map<number, number>();
  const originalTokenIds: number[] = [];
  let q1TokenId = 0;

  const emailOf = (suffix: string) => `contato-${suffix.toLowerCase()}-${runId}@fornecedor.example`;
  const addressHashOf = (suffix: string) =>
    createHash('sha256').update(emailOf(suffix).trim().toLowerCase()).digest('hex');
  const suffixes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

  async function makeContact(suffix: string) {
    const contact = await prisma.supplierContact.create({
      data: { supplierId, name: `Contato ${suffix}`, email: emailOf(suffix) },
    });
    return contact.id;
  }

  async function makeQuote(suffix: string) {
    const quote = await prisma.quoteRequest.create({
      data: { requestCode: `QR-${runId}-${suffix}`, desiredIncoterm: ['FOB'], currency: 'USD' },
    });
    const dispatch = await prisma.dispatchEvent.create({
      data: { quoteRequestId: quote.id, createdById: userId, recipientsCount: 1, subject: `Dispatch ${suffix}` },
    });
    dispatchIds.set(quote.id, dispatch.id);
    return quote.id;
  }

  // `withDispatch: false` simula o token criado por generatePortalTokens (sem dispatchEventId).
  async function makeToken(
    quoteRequestId: number,
    supplierContactId: number,
    lastSeenAt: Date | null = null,
    withDispatch = true,
  ) {
    const token = await SupplierPortalService.createToken({
      quoteRequestId,
      supplierId,
      supplierContactId,
      createdById: userId,
      dispatchEventId: withDispatch ? dispatchIds.get(quoteRequestId) : null,
      expiresAt: TOKEN_EXPIRES_AT,
    });
    await prisma.supplierPortalToken.update({
      where: { id: token.id },
      data: { createdAt: TOKEN_CREATED_AT, lastSeenAt },
    });
    originalTokenIds.push(token.id);
    return token.id;
  }

  const remindersOf = (quoteRequestId: number, supplierContactId?: number) =>
    prisma.supplierPortalReminder.findMany({
      where: { quoteRequestId, ...(supplierContactId ? { supplierContactId } : {}) },
      orderBy: { id: 'asc' },
    });

  const mailsTo = (suffix: string, templateId: string) =>
    prisma.mailLog.findMany({ where: { templateId, toEmail: emailOf(suffix) } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const role = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Reminder ${runId}`,
        email: `reminder-${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: role.id,
      },
    });
    userId = user.id;

    const supplier = await prisma.supplier.create({
      data: { name: `Fornecedor ${runId}`, acceptedIncoterms: ['FOB'], status: 'active' },
    });
    supplierId = supplier.id;
    const other = await prisma.supplier.create({
      data: { name: `Outro fornecedor ${runId}`, acceptedIncoterms: ['FOB'], status: 'active' },
    });
    otherSupplierId = other.id;
    contactIds.A = await makeContact('A');
    contactIds.B = await makeContact('B');
    contactIds.C = await makeContact('C');
    contactIds.D = await makeContact('D');

    quoteIds.Q1 = await makeQuote('Q1');
    quoteIds.Q2 = await makeQuote('Q2');
    quoteIds.Q3 = await makeQuote('Q3');

    // Q1: contato A com token elegivel (casos a, b, c).
    q1TokenId = await makeToken(quoteIds.Q1, contactIds.A);

    // Q2: 2 contatos do mesmo fornecedor + QuoteResponse manual do fornecedor (caso d).
    await makeToken(quoteIds.Q2, contactIds.B);
    await makeToken(quoteIds.Q2, contactIds.C);
    await prisma.quoteResponse.create({
      data: {
        quoteRequestId: quoteIds.Q2,
        supplierId,
        offeredPrice: 10,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
      },
    });

    // Q3: token aberto ha 1 h (caso e).
    await makeToken(quoteIds.Q3, contactIds.D, new Date(NOW.getTime() - 60 * 60 * 1000));
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.mailLog.deleteMany({
      where: {
        templateId: { in: ['quote_reminder', 'quote_reminder_digest'] },
        relatedEntityType: 'supplierPortalToken',
        relatedEntityId: { in: originalTokenIds.map(String) },
      },
    });
    // Claims por endereco nao tem FK: apagar pelos hashes dos e-mails do teste.
    await prisma.supplierPortalReminderAddress.deleteMany({
      where: { addressHash: { in: suffixes.map(addressHashOf) } },
    });
    // Tokens, lembretes, dispatches e QuoteResponse caem em cascata com a cotacao.
    const allQuoteIds = [...Object.values(quoteIds), ...extraQuoteIds].filter(Boolean);
    await prisma.quoteRequest.deleteMany({ where: { id: { in: allQuoteIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierId, otherSupplierId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  testDbSkip('2 sweeps simultaneos: 1 lembrete sent, 1 MailLog, original revogado, 1 token ativo', async () => {
    await Promise.all([
      SupplierPortalReminderService.runReminderSweep(NOW),
      SupplierPortalReminderService.runReminderSweep(NOW),
    ]);

    const reminders = await remindersOf(quoteIds.Q1, contactIds.A);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      reminderDate: TODAY,
      tokenId: q1TokenId,
      status: 'sent',
    });
    expect(reminders[0].freshTokenId).not.toBeNull();

    const mails = await prisma.mailLog.findMany({
      where: {
        templateId: 'quote_reminder',
        relatedEntityType: 'supplierPortalToken',
        relatedEntityId: String(q1TokenId),
      },
    });
    expect(mails).toHaveLength(1);
    expect(mails[0].status).toBe('sent');

    const original = await prisma.supplierPortalToken.findUniqueOrThrow({ where: { id: q1TokenId } });
    expect(original.revokedAt).not.toBeNull();

    const active = await prisma.supplierPortalToken.findMany({
      where: { quoteRequestId: quoteIds.Q1, supplierContactId: contactIds.A, revokedAt: null },
    });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(reminders[0].freshTokenId);
    expect(active[0].expiresAt.getTime()).toBe(TOKEN_EXPIRES_AT.getTime());
    // O token novo herda o dispatchEventId (mantem o par elegivel nos proximos dias).
    expect(active[0].dispatchEventId).toBe(dispatchIds.get(quoteIds.Q1));
  });

  testDbSkip('3o sweep no mesmo now nao cria nada novo', async () => {
    const before = await prisma.supplierPortalReminder.count({
      where: { quoteRequestId: { in: Object.values(quoteIds) } },
    });
    const mailsBefore = await prisma.mailLog.count({
      where: { templateId: 'quote_reminder', relatedEntityId: String(q1TokenId) },
    });

    await SupplierPortalReminderService.runReminderSweep(NOW);

    const after = await prisma.supplierPortalReminder.count({
      where: { quoteRequestId: { in: Object.values(quoteIds) } },
    });
    const mailsAfter = await prisma.mailLog.count({
      where: { templateId: 'quote_reminder', relatedEntityId: String(q1TokenId) },
    });
    expect(after).toBe(before);
    expect(mailsAfter).toBe(mailsBefore);
  });

  testDbSkip('create direto duplicado (cotacao, contato, dia) viola o unique (P2002)', async () => {
    await expect(
      prisma.supplierPortalReminder.create({
        data: {
          quoteRequestId: quoteIds.Q1,
          supplierContactId: contactIds.A,
          reminderDate: TODAY,
          tokenId: q1TokenId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  testDbSkip('QuoteResponse manual do fornecedor: nenhum lembrete para os contatos da cotacao', async () => {
    await SupplierPortalReminderService.runReminderSweep(NOW);

    expect(await remindersOf(quoteIds.Q2)).toHaveLength(0);
    const mails = await prisma.mailLog.count({
      where: {
        templateId: 'quote_reminder',
        toEmail: { in: [emailOf('B'), emailOf('C')] },
      },
    });
    expect(mails).toBe(0);
  });

  testDbSkip('token aberto ha 1 h: nenhuma linha de claim para o par', async () => {
    await SupplierPortalReminderService.runReminderSweep(NOW);

    expect(await remindersOf(quoteIds.Q3, contactIds.D)).toHaveLength(0);
    const active = await prisma.supplierPortalToken.count({
      where: { quoteRequestId: quoteIds.Q3, supplierContactId: contactIds.D, revokedAt: null },
    });
    expect(active).toBe(1);
  });

  testDbSkip('(f) token sem dispatchEventId: nenhuma linha de claim e nenhum e-mail', async () => {
    const contactId = await makeContact('E');
    const quoteId = await makeQuote('Q4');
    extraQuoteIds.push(quoteId);
    await makeToken(quoteId, contactId, null, false);

    await SupplierPortalReminderService.runReminderSweep(NOW);

    expect(await remindersOf(quoteId)).toHaveLength(0);
    expect(await mailsTo('E', 'quote_reminder')).toHaveLength(0);
    expect(await mailsTo('E', 'quote_reminder_digest')).toHaveLength(0);
  });

  testDbSkip('(g) mesmo contato em 2 cotacoes: 1 MailLog digest e 2 claims sent', async () => {
    const contactId = await makeContact('F');
    const quoteA = await makeQuote('Q5');
    const quoteB = await makeQuote('Q6');
    extraQuoteIds.push(quoteA, quoteB);
    await makeToken(quoteA, contactId);
    await makeToken(quoteB, contactId);

    await SupplierPortalReminderService.runReminderSweep(NOW);

    const digests = await mailsTo('F', 'quote_reminder_digest');
    expect(digests).toHaveLength(1);
    expect(digests[0].status).toBe('sent');
    expect(await mailsTo('F', 'quote_reminder')).toHaveLength(0);
    for (const quoteId of [quoteA, quoteB]) {
      const rows = await remindersOf(quoteId, contactId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ reminderDate: TODAY, status: 'sent' });
    }
  });

  testDbSkip('(h) QuoteResponse vencedora de OUTRO fornecedor: nada e enviado', async () => {
    const contactId = await makeContact('G');
    const quoteId = await makeQuote('Q7');
    extraQuoteIds.push(quoteId);
    await makeToken(quoteId, contactId);
    await prisma.quoteResponse.create({
      data: {
        quoteRequestId: quoteId,
        supplierId: otherSupplierId,
        offeredPrice: 10,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
        isWinner: true,
      },
    });

    await SupplierPortalReminderService.runReminderSweep(NOW);

    expect(await remindersOf(quoteId)).toHaveLength(0);
    expect(await mailsTo('G', 'quote_reminder')).toHaveLength(0);
  });

  testDbSkip('(i) 2 sweeps simultaneos com resumo: exatamente 1 e-mail para o endereco no dia', async () => {
    const contactId = await makeContact('H');
    const quoteA = await makeQuote('Q8');
    const quoteB = await makeQuote('Q9');
    extraQuoteIds.push(quoteA, quoteB);
    await makeToken(quoteA, contactId);
    await makeToken(quoteB, contactId);

    await Promise.all([
      SupplierPortalReminderService.runReminderSweep(NOW),
      SupplierPortalReminderService.runReminderSweep(NOW),
    ]);

    // Deterministico em qualquer interleaving: o claim por endereco/dia deixa 1 dono so.
    const digests = await mailsTo('H', 'quote_reminder_digest');
    const singles = await mailsTo('H', 'quote_reminder');
    expect(digests.length + singles.length).toBe(1);
    expect(
      await prisma.supplierPortalReminderAddress.count({
        where: { addressHash: addressHashOf('H'), reminderDate: TODAY },
      }),
    ).toBe(1);
  });

  testDbSkip('(j) 2 sweeps sequenciais com claims de par diferentes: o 2o nao manda nada ao endereco', async () => {
    const contactId = await makeContact('I');
    const quoteA = await makeQuote('Q10');
    const quoteB = await makeQuote('Q11');
    extraQuoteIds.push(quoteA, quoteB);
    await makeToken(quoteA, contactId);

    await SupplierPortalReminderService.runReminderSweep(NOW);
    expect(await remindersOf(quoteA, contactId)).toHaveLength(1);
    const first = (await mailsTo('I', 'quote_reminder')).length + (await mailsTo('I', 'quote_reminder_digest')).length;
    expect(first).toBe(1);

    // Par novo (sem claim hoje) para o MESMO endereco: o claim do endereco/dia impede o 2o e-mail.
    await makeToken(quoteB, contactId);
    const second = await SupplierPortalReminderService.runReminderSweep(NOW);

    expect(second.skippedAddressClaimed).toBeGreaterThanOrEqual(1);
    expect(await remindersOf(quoteB, contactId)).toHaveLength(0);
    const total = (await mailsTo('I', 'quote_reminder')).length + (await mailsTo('I', 'quote_reminder_digest')).length;
    expect(total).toBe(1);
  });
});
