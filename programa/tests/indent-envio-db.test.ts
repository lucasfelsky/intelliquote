import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';
import { addDaysToKey, todayKeyInSaoPaulo } from '../src/utils/supplierDocumentDates';

// Banco real descartavel (scripts/test-critical-local.mjs aplica as migrations, inclusive 20261117120000_indent_envio_portal) e SMTP console.
// Sem RUN_DB_TESTS=true os testes sao pulados. Aqui mora a prova do envio com banco de verdade: hash do token, trava e ordem solicitacao -> cotacao.
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `indent-env-db-${Date.now()}`;
const TODAY = todayKeyInSaoPaulo(new Date());

describe('IQ Indent - envio por e-mail (DB)', () => {
  let cookies: string[] = [];
  let userId = 0;
  let clientId = 0;
  let productId = 0;
  const supplierIds: number[] = [];
  const requestIds: number[] = [];
  const iqSupplierIds: number[] = [];

  async function api(method: 'get' | 'post', path: string, body?: object) {
    const req = request(app)[method](`/api/v1/indent${path}`).set('Cookie', cookies);
    return method === 'get' ? req : req.send(body ?? {});
  }

  async function newRequest(suppliers: number[]) {
    const created = await api('post', '/requests', {
      clientId,
      items: [{ productId, description: `Produto cadastrado ${runId}`, quantityKg: 25000 }],
    });
    expect(created.status).toBe(201);
    requestIds.push(created.body.id);
    const generated = await api('post', `/requests/${created.body.id}/quotes`, { suppliers: suppliers.map((supplierId) => ({ supplierId })) });
    expect(generated.status).toBe(201);
    return { requestId: created.body.id as number, quoteIds: (generated.body.quotes as Array<{ id: number }>).map((quote) => quote.id) };
  }

  const sendBody = (recipients: string[]) => ({ recipients, destinationPort: 'Santos', showClientName: false, saveToSupplier: false });

  async function respond(quoteId: number) {
    expect((await api('post', `/quotes/${quoteId}/mark-sent`, { sentOn: TODAY })).status).toBe(200);
    const detail = await api('get', `/quotes/${quoteId}`);
    const res = await api('post', `/quotes/${quoteId}/response`, {
      respondedOn: TODAY,
      currency: 'USD',
      validUntil: addDaysToKey(TODAY, 20),
      productionLeadTimeDays: 20,
      paymentTerms: 'T/T',
      items: (detail.body.items as Array<{ id: number }>).map((item) => ({
        quoteItemId: item.id,
        packaging: '25 kg bag',
        fobPricePerKg: '0.7',
        cfrPricePerKg: '0.795',
      })),
    });
    expect(res.status).toBe(200);
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Indent Env ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    userId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    for (const label of ['a', 'b']) {
      supplierIds.push(
        (
          await prisma.indentSupplier.create({
            data: { name: `Forn ${label} ${runId}`, nameKey: `forn ${label} ${runId}`, contactEmails: [`${label}1@forn.test`, `${label}2@forn.test`] },
          })
        ).id,
      );
    }
    productId = (await prisma.indentProduct.create({ data: { name: `Produto cadastrado ${runId}`, nameKey: `produto cadastrado ${runId}` } })).id;
    clientId = (await prisma.indentClient.create({ data: { name: `Cliente ${runId}`, cnpj: `8${Date.now()}`.slice(0, 14) } })).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const quotes = await prisma.indentQuote.findMany({ where: { requestId: { in: requestIds } }, select: { id: true } });
    const quoteIds = quotes.map((quote) => String(quote.id));
    await prisma.mailLog.deleteMany({ where: { relatedEntityType: 'indent_quote', relatedEntityId: { in: quoteIds } } });
    await prisma.indentQuote.updateMany({ where: { requestId: { in: requestIds } }, data: { baseQuoteId: null } });
    await prisma.indentQuote.deleteMany({ where: { requestId: { in: requestIds } } }); // tokens e IndentMailLog caem em cascata
    await prisma.indentRequestItem.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.indentRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.auditLog.deleteMany({ where: { performedById: userId } });
    await prisma.indentProduct.deleteMany({ where: { nameKey: { contains: runId } } });
    await prisma.indentClient.deleteMany({ where: { id: clientId } });
    await prisma.indentSupplier.deleteMany({ where: { OR: [{ id: { in: supplierIds } }, { nameKey: { contains: runId } }] } });
    await prisma.supplier.deleteMany({ where: { id: { in: iqSupplierIds } } });
    if (userId) {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('a migration criou as 8 tabelas e contactEmails nasce como lista vazia', async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('IndentPortalToken', 'IndentPortalResponse', 'IndentPortalResponseItem', 'IndentPortalResponseRevision',
        'IndentPortalAttachment', 'IndentPortalAttachmentFile', 'IndentPortalAccessLog', 'IndentMailLog')`;
    expect(tables).toHaveLength(8);

    const created = await prisma.indentSupplier.create({ data: { name: `Sem emails ${runId}`, nameKey: `sem emails ${runId}` } });
    expect(created.contactEmails).toEqual([]);
    const raw = await prisma.$queryRaw<Array<{ contactEmails: string[] }>>`SELECT "contactEmails" FROM "IndentSupplier" WHERE id = ${created.id}`;
    expect(raw[0]?.contactEmails).toEqual([]);

    const unique = await prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE tablename = 'IndentPortalToken'`;
    expect(unique.map((row) => row.indexname)).toContain('IndentPortalToken_tokenHash_key');
  });

  testDbSkip('a importacao real copia os e-mails de TODOS os contatos do IntelliQuote (principal primeiro)', async () => {
    const source = await prisma.supplier.create({
      data: {
        name: `Importado ${runId}`,
        country: 'China',
        contacts: {
          create: [
            { name: 'Secundario', email: 'sec@import.test', isPrimary: false },
            { name: 'Principal', email: 'Princ@import.test', isPrimary: true },
            { name: 'Duplicado', email: 'princ@import.test', isPrimary: false },
          ],
        },
      },
    });
    iqSupplierIds.push(source.id);

    const res = await api('post', '/import/suppliers', { ids: [source.id] });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    const imported = await prisma.indentSupplier.findFirstOrThrow({ where: { nameKey: `importado ${runId}` } });
    expect(imported.contactName).toBe('Principal');
    expect(imported.contactEmails).toEqual(['princ@import.test', 'sec@import.test']);
    // a importacao nao escreve na origem
    expect(await prisma.supplierContact.count({ where: { supplierId: source.id } })).toBe(3);
  });

  testDbSkip('envio pelo ConsoleMailer: grava so o HASH (64 hex) e o token cru nao aparece em nenhuma tabela', async () => {
    const { quoteIds } = await newRequest([supplierIds[0]!]);
    const quoteId = quoteIds[0]!;
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));

    const res = await api('post', `/quotes/${quoteId}/send`, sendBody(['a1@forn.test', 'a2@forn.test']));
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(['sent', 'sent']);
    expect(res.body.quote.status).toBe('ENVIADA');

    const tokens = await prisma.indentPortalToken.findMany({ where: { quoteId }, orderBy: { id: 'asc' } });
    expect(tokens.map((token) => token.recipientEmail)).toEqual(['a1@forn.test', 'a2@forn.test']);
    for (const token of tokens) {
      expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(token.revokedAt).toBeNull();
    }

    const raws = Array.from(logged.join('\n').matchAll(/token=([A-Za-z0-9_-]{43})/g)).map((match) => match[1]!);
    expect(raws).toHaveLength(2);
    expect(raws.map((raw) => createHash('sha256').update(raw).digest('hex')).sort()).toEqual(tokens.map((token) => token.tokenHash).sort());

    const everywhere = JSON.stringify([
      await prisma.indentMailLog.findMany({ where: { quoteId } }),
      await prisma.mailLog.findMany({ where: { relatedEntityType: 'indent_quote', relatedEntityId: String(quoteId) } }),
      await prisma.auditLog.findMany({ where: { entityType: 'indent_quote', entityId: String(quoteId) } }),
      await prisma.indentPortalToken.findMany({ where: { quoteId } }),
    ]);
    for (const raw of raws) {
      expect(everywhere).not.toContain(raw);
    }
    expect(everywhere).not.toContain('token=');

    const mails = await prisma.indentMailLog.findMany({ where: { quoteId }, orderBy: { id: 'asc' } });
    expect(mails.map((mail) => [mail.kind, mail.status, mail.sentById])).toEqual([
      ['REQUEST', 'sent', userId],
      ['REQUEST', 'sent', userId],
    ]);
    expect(mails.every((mail) => mail.tokenId !== null && mail.sentAt !== null)).toBe(true);

    const state = await api('get', `/quotes/${quoteId}/portal`);
    expect(state.body.state).toBe('AGUARDANDO');
    expect(state.body.recipients).toEqual(['a1@forn.test', 'a2@forn.test']);
    expect(state.body.canResend).toBe(true);
  });

  testDbSkip('reenvio: tokens novos e antigos revogados (resend) so depois do envio', async () => {
    const { quoteIds } = await newRequest([supplierIds[1]!]);
    const quoteId = quoteIds[0]!;
    expect((await api('post', `/quotes/${quoteId}/send`, sendBody(['b1@forn.test']))).status).toBe(200);

    const res = await api('post', `/quotes/${quoteId}/resend`, {});

    expect(res.status).toBe(200);
    const tokens = await prisma.indentPortalToken.findMany({ where: { quoteId }, orderBy: { id: 'asc' } });
    expect(tokens.map((token) => [token.recipientEmail, token.revokedReason])).toEqual([
      ['b1@forn.test', 'resend'],
      ['b1@forn.test', null],
    ]);
    const kinds = (await prisma.indentMailLog.findMany({ where: { quoteId }, orderBy: { id: 'asc' } })).map((mail) => mail.kind);
    expect(kinds).toEqual(['REQUEST', 'RESEND']);
  });

  testDbSkip('2 reenvios simultaneos da mesma cotacao -> ambos 200 (serializados pela trava, sem deadlock) e 1 unico token ativo por destinatario', async () => {
    const { quoteIds } = await newRequest([supplierIds[1]!]);
    const quoteId = quoteIds[0]!;
    expect((await api('post', `/quotes/${quoteId}/send`, sendBody(['b1@forn.test', 'b2@forn.test']))).status).toBe(200);

    const results = await Promise.all([api('post', `/quotes/${quoteId}/resend`, {}), api('post', `/quotes/${quoteId}/resend`, {})]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const tokens = await prisma.indentPortalToken.findMany({ where: { quoteId } });
    expect(tokens).toHaveLength(6); // 2 do envio + 2 por reenvio
    const active = tokens.filter((token) => token.revokedAt === null);
    expect(active.map((token) => token.recipientEmail).sort()).toEqual(['b1@forn.test', 'b2@forn.test']);
    expect(await prisma.auditLog.count({ where: { action: 'indent_quote.resent', entityId: String(quoteId) } })).toBe(2);
    const kinds = (await prisma.indentMailLog.findMany({ where: { quoteId } })).map((mail) => mail.kind).sort();
    expect(kinds).toEqual(['REQUEST', 'REQUEST', 'RESEND', 'RESEND', 'RESEND', 'RESEND']);
  });

  testDbSkip('send x mark-sent em paralelo na MESMA cotacao -> exatamente um 200 e um 409, sem deadlock', async () => {
    const { quoteIds } = await newRequest([supplierIds[0]!]);
    const id = quoteIds[0]!;

    const results = await Promise.all([
      api('post', `/quotes/${id}/send`, sendBody(['a1@forn.test'])),
      api('post', `/quotes/${id}/mark-sent`, { sentOn: TODAY }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await prisma.indentQuote.findUniqueOrThrow({ where: { id } })).status).toBe('ENVIADA');
  });

  testDbSkip('2 envios simultaneos da mesma cotacao -> um 200 e um 409 (uma unica leva de tokens)', async () => {
    const { quoteIds } = await newRequest([supplierIds[0]!]);
    const id = quoteIds[0]!;

    const results = await Promise.all([
      api('post', `/quotes/${id}/send`, sendBody(['a1@forn.test'])),
      api('post', `/quotes/${id}/send`, sendBody(['a2@forn.test'])),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.indentPortalToken.count({ where: { quoteId: id } })).toBe(1);
  });

  testDbSkip('send da cotacao A x accept da cotacao B na mesma solicitacao -> sem deadlock e uma unica ACEITA', async () => {
    const { requestId, quoteIds } = await newRequest([supplierIds[0]!, supplierIds[1]!]);
    const [a, b] = quoteIds as [number, number];
    await respond(b);

    const [sent, accepted] = await Promise.all([
      api('post', `/quotes/${a}/send`, sendBody(['a1@forn.test'])),
      api('post', `/quotes/${b}/accept`),
    ]);

    expect(accepted.status).toBe(200);
    expect([200, 409]).toContain(sent.status);
    expect(await prisma.indentQuote.count({ where: { requestId, status: 'ACEITA' } })).toBe(1);
    const stateA = (await prisma.indentQuote.findUniqueOrThrow({ where: { id: a } })).status;
    expect(stateA).toBe(sent.status === 200 ? 'ENVIADA' : 'RASCUNHO');
    if (sent.status === 409) {
      expect(sent.body.message).toMatch(/aceita|Rascunho|Enviada/);
      expect(await prisma.indentPortalToken.count({ where: { quoteId: a } })).toBe(0);
    }
  });
});
