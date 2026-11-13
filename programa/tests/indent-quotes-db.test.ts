import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';
import { addDaysToKey, todayKeyInSaoPaulo } from '../src/utils/supplierDocumentDates';

// Banco real descartavel (scripts/test-critical-local.mjs aplica as migrations, inclusive 20261114120000_indent_cotacoes).
// Sem RUN_DB_TESTS=true os testes sao pulados. Aqui mora a prova da trava: aceite unico concorrente, aceitar x recusar, revisoes paralelas.
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `indent-quo-db-${Date.now()}`;
const TODAY = todayKeyInSaoPaulo(new Date());

describe('IQ Indent - cotacoes (DB)', () => {
  let cookies: string[] = [];
  let userId = 0;
  let clientId = 0;
  const supplierIds: number[] = [];
  let productId = 0;
  const requestIds: number[] = [];

  async function api(method: 'get' | 'post', path: string, body?: object) {
    const req = request(app)[method](`/api/v1/indent${path}`).set('Cookie', cookies);
    return method === 'get' ? req : req.send(body ?? {});
  }

  // Solicitacao nova com 1 item e uma cotacao RASCUNHO por fornecedor (pela API, como o front faz).
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

  async function respond(quoteId: number, cfr = '0.795') {
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
        packaging: 'Tambor 200 kg',
        fobPricePerKg: '0.7',
        cfrPricePerKg: cfr,
      })),
    });
    expect(res.status).toBe(200);
    return res;
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Indent Quo ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    userId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    for (const label of ['a', 'b', 'c']) {
      supplierIds.push((await prisma.indentSupplier.create({ data: { name: `Forn ${label} ${runId}`, nameKey: `forn ${label} ${runId}` } })).id);
    }
    productId = (
      await prisma.indentProduct.create({ data: { name: `Produto cadastrado ${runId}`, nameKey: `produto cadastrado ${runId}` } })
    ).id;
    clientId = (await prisma.indentClient.create({ data: { name: `Cliente ${runId}`, cnpj: `7${Date.now()}`.slice(0, 14) } })).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    // A FK baseQuoteId e RESTRICT: solta as revisoes antes de apagar as cotacoes.
    await prisma.indentQuote.updateMany({ where: { requestId: { in: requestIds } }, data: { baseQuoteId: null } });
    await prisma.indentQuote.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.indentRequestItem.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.indentRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.auditLog.deleteMany({ where: { performedById: userId } });
    await prisma.indentProduct.deleteMany({ where: { nameKey: { contains: runId } } });
    await prisma.indentClient.deleteMany({ where: { id: clientId } });
    await prisma.indentSupplier.deleteMany({ where: { id: { in: supplierIds } } });
    if (userId) {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('a migration criou as colunas, o Decimal(14,4), os indices e a FK RESTRICT da cadeia de revisoes', async () => {
    const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string; numeric_scale: number | null; is_nullable: string }>>`
      SELECT table_name, column_name, numeric_scale, is_nullable FROM information_schema.columns
      WHERE table_name IN ('IndentQuote', 'IndentQuoteItem')`;
    const has = (table: string, column: string) => columns.find((c) => c.table_name === table && c.column_name === column);

    for (const column of ['baseQuoteId', 'sentAt', 'respondedAt', 'decidedAt', 'validUntil', 'productionLeadTimeDays', 'paymentTerms', 'manufacturer', 'notes']) {
      expect(has('IndentQuote', column)?.is_nullable, column).toBe('YES');
    }
    expect(has('IndentQuoteItem', 'packaging')).toBeDefined();
    expect(has('IndentQuoteItem', 'fobPricePerKg')?.numeric_scale).toBe(4);
    expect(has('IndentQuoteItem', 'cfrPricePerKg')?.numeric_scale).toBe(4);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE tablename = 'IndentQuote'`;
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining(['IndentQuote_baseQuoteId_idx', 'IndentQuote_requestId_status_idx']),
    );

    const fk = await prisma.$queryRaw<Array<{ delete_rule: string }>>`
      SELECT rc.delete_rule FROM information_schema.referential_constraints rc
      WHERE rc.constraint_name = 'IndentQuote_baseQuoteId_fkey'`;
    expect(fk[0]?.delete_rule).toBe('RESTRICT');
  });

  testDbSkip('Decimal(14,4) ida e volta (0.7955), total em Decimal e status da solicitacao: COTACAO -> RESPONDIDA -> CONVERTIDA', async () => {
    const { requestId, quoteIds } = await newRequest([supplierIds[0]!]);
    const quoteId = quoteIds[0]!;

    const responded = await respond(quoteId, '0.7955');

    const stored = await prisma.indentQuoteItem.findFirstOrThrow({ where: { quoteId } });
    expect(stored.cfrPricePerKg?.toFixed(4)).toBe('0.7955');
    expect(stored.packaging).toBe('Tambor 200 kg');
    expect(responded.body.items[0].cfrPricePerKg).toBe('0.7955');
    expect(responded.body.total).toBe('19887.50');
    expect((await prisma.indentRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('RESPONDIDA');

    expect((await api('post', `/quotes/${quoteId}/accept`)).status).toBe(200);
    const request2 = await prisma.indentRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(request2.status).toBe('CONVERTIDA');
    const quote = await prisma.indentQuote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quote.status).toBe('ACEITA');
    expect(quote.decidedAt).not.toBeNull();

    const actions = (await prisma.auditLog.findMany({ where: { entityType: 'indent_quote', entityId: String(quoteId) }, orderBy: { id: 'asc' } })).map((l) => l.action);
    expect(actions).toEqual(['indent_quote.marked_sent', 'indent_quote.response_recorded', 'indent_quote.accepted']);
  });

  testDbSkip('2 aceites simultaneos de cotacoes diferentes da mesma solicitacao -> exatamente 1 sucesso e 1 409', async () => {
    const { requestId, quoteIds } = await newRequest([supplierIds[0]!, supplierIds[1]!]);
    for (const id of quoteIds) await respond(id);

    const results = await Promise.all(quoteIds.map((id) => api('post', `/quotes/${id}/accept`)));

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.message).toMatch(/^Esta solicitação já tem uma cotação aceita \(/);
    expect(await prisma.indentQuote.count({ where: { requestId, status: 'ACEITA' } })).toBe(1);
    expect((await prisma.indentRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('CONVERTIDA');
    expect(await prisma.auditLog.count({ where: { action: 'indent_quote.accepted', entityId: { in: quoteIds.map(String) } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'indent_request.status_changed', entityId: String(requestId) } })).toBeGreaterThanOrEqual(1);
  });

  testDbSkip('a trava da SOLICITACAO e real: o aceite espera quem a segura e, depois, ve o que ele gravou (409 por aceite unico)', async () => {
    const { requestId, quoteIds } = await newRequest([supplierIds[0]!, supplierIds[1]!]);
    const [primeira, segunda] = quoteIds as [number, number];
    await respond(primeira);
    await respond(segunda);

    // Quem segura a linha da solicitacao grava a ACEITA da segunda cotacao e so libera (commit) depois.
    let liberar!: () => void;
    const segurando = new Promise<void>((resolve) => (liberar = resolve));
    let travou!: () => void;
    const travado = new Promise<void>((resolve) => (travou = resolve));
    const segurador = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "IndentRequest" WHERE id = ${requestId} FOR NO KEY UPDATE`;
        await tx.indentQuote.update({ where: { id: segunda }, data: { status: 'ACEITA', decidedAt: new Date() } });
        travou();
        await segurando;
      },
      { timeout: 30000 },
    );
    await travado;

    const aceite = Promise.resolve(api('post', `/quotes/${primeira}/accept`));
    const estado = await Promise.race([aceite.then(() => 'terminou'), new Promise<string>((resolve) => setTimeout(() => resolve('pendente'), 800))]);
    expect(estado).toBe('pendente');

    liberar();
    await segurador;
    // Sem a trava, o aceite leria "nenhuma ACEITA" antes de esperar e gravaria a 2a ACEITA (200).
    const res = await aceite;
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/^Esta solicitação já tem uma cotação aceita \(/);
    expect(await prisma.indentQuote.count({ where: { requestId, status: 'ACEITA' } })).toBe(1);
  });

  testDbSkip('depois do aceite, a outra cotacao RESPONDIDA ainda pode ser recusada, mas nao aceita nem revisada', async () => {
    const { quoteIds } = await newRequest([supplierIds[0]!, supplierIds[1]!]);
    for (const id of quoteIds) await respond(id);
    expect((await api('post', `/quotes/${quoteIds[0]}/accept`)).status).toBe(200);

    expect((await api('post', `/quotes/${quoteIds[1]}/accept`)).status).toBe(409);
    expect((await api('post', `/quotes/${quoteIds[1]}/revision`)).status).toBe(409);
    expect((await api('post', `/quotes/${quoteIds[1]}/refuse`)).status).toBe(200);
    expect((await prisma.indentQuote.findUniqueOrThrow({ where: { id: quoteIds[1]! } })).status).toBe('RECUSADA');
  });

  testDbSkip('aceitar x recusar a MESMA cotacao em paralelo -> 1 sucesso e 1 409', async () => {
    const { quoteIds } = await newRequest([supplierIds[0]!]);
    const id = quoteIds[0]!;
    await respond(id);

    const results = await Promise.all([api('post', `/quotes/${id}/accept`), api('post', `/quotes/${id}/refuse`)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(['ACEITA', 'RECUSADA']).toContain((await prisma.indentQuote.findUniqueOrThrow({ where: { id } })).status);
  });

  testDbSkip('2 pedidos de revisao em paralelo -> uma R2 (201) e um 409; baseQuoteId aponta para a R1 e e RESTRICT', async () => {
    const { requestId, quoteIds } = await newRequest([supplierIds[2]!]);
    const id = quoteIds[0]!;
    await respond(id);

    const results = await Promise.all([api('post', `/quotes/${id}/revision`), api('post', `/quotes/${id}/revision`)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const revisions = await prisma.indentQuote.findMany({ where: { requestId, supplierId: supplierIds[2]! }, orderBy: { revision: 'asc' } });
    expect(revisions.map((q) => [q.revision, q.status])).toEqual([
      [1, 'REVISADA'],
      [2, 'RASCUNHO'],
    ]);
    expect(revisions[1]?.baseQuoteId).toBe(id);
    const items = await prisma.indentQuoteItem.findMany({ where: { quoteId: revisions[1]!.id } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ packaging: null, fobPricePerKg: null, cfrPricePerKg: null });

    // RESTRICT do Postgres (23001): o Prisma devolve erro sem codigo P2003 aqui.
    await expect(prisma.indentQuote.delete({ where: { id } })).rejects.toThrow(/RESTRICT|23001|foreign key/i);
  });

  testDbSkip('marcar como enviada 2x em paralelo -> 1 sucesso e 1 409', async () => {
    const { quoteIds } = await newRequest([supplierIds[0]!]);
    const id = quoteIds[0]!;

    const results = await Promise.all([
      api('post', `/quotes/${id}/mark-sent`, { sentOn: TODAY }),
      api('post', `/quotes/${id}/mark-sent`, { sentOn: TODAY }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({ where: { action: 'indent_quote.marked_sent', entityId: String(id) } })).toBe(1);
  });

  testDbSkip('item livre no rascunho cria o item da solicitacao e o da cotacao SO nesta', async () => {
    const { requestId, quoteIds } = await newRequest([supplierIds[0]!, supplierIds[1]!]);

    const res = await api('post', `/quotes/${quoteIds[0]}/items`, { description: `Item livre ${runId}`, quantityKg: 100.5 });

    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[1]).toMatchObject({ isFree: true, quantityKg: '100.500' });
    expect(await prisma.indentRequestItem.count({ where: { requestId } })).toBe(2);
    expect(await prisma.indentQuoteItem.count({ where: { quoteId: quoteIds[0]! } })).toBe(2);
    expect(await prisma.indentQuoteItem.count({ where: { quoteId: quoteIds[1]! } })).toBe(1);
  });
});
