import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = process.env.RUN_DB_TESTS === 'true';

const BACKFILL_SQL = path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20261008230100_quote_request_po_sent_backfill',
  'migration.sql',
);

const D1 = new Date('2026-09-01T10:00:00.000Z');
const D2 = new Date('2026-09-05T15:30:00.000Z');
const D3 = new Date('2026-09-10T08:00:00.000Z');
const ALREADY = new Date('2026-08-01T12:00:00.000Z');

describe.skipIf(!run)('Backfill de purchaseOrderSentAt a partir do MailLog em Postgres isolado', () => {
  let prisma: any;
  let supplierId: number;
  const quoteIds: Record<string, number> = {};
  const responseIds: Record<string, number> = {};
  const tag = `POSENT-${Date.now()}`;

  async function createQuote(key: string, opts: { responseDeleted?: boolean } = {}): Promise<void> {
    const quote = await prisma.quoteRequest.create({
      data: { requestCode: `${tag}-${key}`, desiredIncoterm: ['FOB'], currency: 'USD' },
    });
    const response = await prisma.quoteResponse.create({
      data: {
        quoteRequestId: quote.id,
        supplierId,
        offeredPrice: 10,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
        deletedAt: opts.responseDeleted ? new Date() : null,
      },
    });
    quoteIds[key] = quote.id;
    responseIds[key] = response.id;
  }

  async function createLog(
    key: string,
    data: { templateId: string; status: string; sentAt: Date | null; createdAt: Date },
  ): Promise<void> {
    await prisma.mailLog.create({
      data: {
        provider: 'console',
        fromAddress: 'noreply@local.test',
        toEmail: 'fornecedor@local.test',
        subject: `${tag} ${key}`,
        templateId: data.templateId,
        status: data.status,
        sentAt: data.sentAt,
        createdAt: data.createdAt,
        relatedEntityType: 'quote_response',
        relatedEntityId: String(responseIds[key]),
      },
    });
  }

  async function sentAtOf(key: string): Promise<Date | null> {
    const row = await prisma.quoteRequest.findUnique({ where: { id: quoteIds[key] } });
    return row.purchaseOrderSentAt;
  }

  async function execBackfill(): Promise<void> {
    await prisma.$executeRawUnsafe(fs.readFileSync(BACKFILL_SQL, 'utf-8').replace(/\r\n/g, '\n'));
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/iq_critical_test') {
      throw new Error('Execute scripts/test-critical-local.mjs para usar um banco descartavel.');
    }
    ({ prisma } = await import('../src/lib/prisma'));

    const supplier = await prisma.supplier.create({
      data: { name: `${tag} Fornecedor`, acceptedIncoterms: ['FOB'] },
    });
    supplierId = supplier.id;

    for (const key of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) {
      await createQuote(key, { responseDeleted: key === 'q5' });
    }

    // Q1: dois envios 'sent' -> vale o MAIS RECENTE (sentAt).
    await createLog('q1', { templateId: 'quote-po', status: 'sent', sentAt: D1, createdAt: D1 });
    await createLog('q1', { templateId: 'quote-po', status: 'sent', sentAt: D2, createdAt: D2 });
    // Q2: so 'queued' sem sentAt -> usa o createdAt do log.
    await createLog('q2', { templateId: 'quote-po', status: 'queued', sentAt: null, createdAt: D1 });
    // Q3: so 'failed' -> continua nulo.
    await createLog('q3', { templateId: 'quote-po', status: 'failed', sentAt: null, createdAt: D1 });
    // Q4: outro template ('quote-reply') 'sent' -> continua nulo.
    await createLog('q4', { templateId: 'quote-reply', status: 'sent', sentAt: D1, createdAt: D1 });
    // Q5: resposta soft-deletada com log 'sent' -> marca (a PO foi enviada de fato).
    await createLog('q5', { templateId: 'quote-po', status: 'sent', sentAt: D2, createdAt: D2 });
    // Q6: ja marcada em ALREADY; log mais recente nao sobrescreve.
    await createLog('q6', { templateId: 'quote-po', status: 'sent', sentAt: D3, createdAt: D3 });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.mailLog.deleteMany({ where: { subject: { startsWith: tag } } });
      await prisma.quoteRequest.deleteMany({ where: { requestCode: { startsWith: tag } } });
      if (supplierId) {
        await prisma.supplier.deleteMany({ where: { id: supplierId } });
      }
    }
    await prisma?.$disconnect();
  });

  it('preenche so as cotacoes com envio real da PO e e idempotente', async () => {
    // Estado de partida: coluna zerada (Q6 ja marcada manualmente).
    await prisma.quoteRequest.updateMany({
      where: { id: { in: Object.values(quoteIds) } },
      data: { purchaseOrderSentAt: null },
    });
    await prisma.quoteRequest.update({
      where: { id: quoteIds.q6 },
      data: { purchaseOrderSentAt: ALREADY },
    });

    await execBackfill();

    const first = {
      q1: await sentAtOf('q1'),
      q2: await sentAtOf('q2'),
      q3: await sentAtOf('q3'),
      q4: await sentAtOf('q4'),
      q5: await sentAtOf('q5'),
      q6: await sentAtOf('q6'),
    };

    expect(first.q1?.toISOString()).toBe(D2.toISOString());
    expect(first.q2?.toISOString()).toBe(D1.toISOString());
    expect(first.q3).toBeNull();
    expect(first.q4).toBeNull();
    expect(first.q5?.toISOString()).toBe(D2.toISOString());
    // Ja marcada: nao e sobrescrita pelo backfill.
    expect(first.q6?.toISOString()).toBe(ALREADY.toISOString());

    // Segunda execucao: valores identicos.
    await execBackfill();
    const second = {
      q1: await sentAtOf('q1'),
      q2: await sentAtOf('q2'),
      q3: await sentAtOf('q3'),
      q4: await sentAtOf('q4'),
      q5: await sentAtOf('q5'),
      q6: await sentAtOf('q6'),
    };
    expect(second).toEqual(first);
  });
});
