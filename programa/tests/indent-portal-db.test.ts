import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';
import { addDaysToKey, todayKeyInSaoPaulo } from '../src/utils/supplierDocumentDates';

// Banco real descartavel (scripts/test-critical-local.mjs aplica as migrations) e SMTP console. Sem RUN_DB_TESTS=true os testes sao pulados.
// Aqui mora a prova da API PUBLICA do portal do fornecedor (IQ Indent 4a-2) com banco de verdade: resposta com 4 casas, concorrencia
// (Promise.all) com aceite/revisao/respostas/uploads simultaneos, PDF byte a byte e a parceria atual mandando no sigilo.
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `indent-prt-db-${Date.now()}`;
const TODAY = todayKeyInSaoPaulo(new Date());

describe('IQ Indent - portal do fornecedor (DB)', () => {
  let cookies: string[] = [];
  let userId = 0;
  let clientId = 0;
  let productId = 0;
  let uaSeq = 0;
  const supplierIds: number[] = [];
  const requestIds: number[] = [];

  async function api(method: 'get' | 'post', path: string, body?: object) {
    const req = request(app)[method](`/api/v1/indent${path}`).set('Cookie', cookies);
    return method === 'get' ? req : req.send(body ?? {});
  }

  // User-Agent novo a cada chamada: rate limit e lockout do portal sao por IP + UA.
  const ua = () => `${runId}-${(uaSeq += 1)}`;
  const pGet = (token: string) => request(app).get(`/api/indent-portal/${token}`).set('User-Agent', ua());
  const pRespond = (token: string, body: object) => request(app).post(`/api/indent-portal/${token}/respond`).set('User-Agent', ua()).send(body);
  const pUpload = (token: string, file: Buffer, name = 'tds.pdf') =>
    request(app).post(`/api/indent-portal/${token}/attachments`).set('User-Agent', ua()).set('Content-Type', 'application/pdf').set('X-File-Name', encodeURIComponent(name)).send(file);

  const pdf = (seed: number, size = 200) => Buffer.concat([Buffer.from(`%PDF-1.4 ${seed}\n`), Buffer.alloc(size, seed % 250)]);

  async function newQuote(suppliers: number[]) {
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

  // Envia pelo ConsoleMailer e devolve o token CRU capturado do link impresso (o banco so guarda o hash).
  async function sendAndGetToken(quoteId: number, extra: Record<string, unknown> = {}): Promise<string> {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
    const res = await api('post', `/quotes/${quoteId}/send`, { recipients: ['fornecedor@forn.test'], destinationPort: 'Santos', showClientName: false, saveToSupplier: false, ...extra });
    spy.mockRestore();
    expect(res.status).toBe(200);
    const token = /token=([A-Za-z0-9_-]{43})/.exec(logged.join('\n'))?.[1];
    expect(token).toBeDefined();
    return token as string;
  }

  const body = (overrides: Record<string, unknown> = {}, quoteItemIds: number[] = []) => ({
    currency: 'USD',
    productionLeadTimeDays: 20,
    paymentTerms: 'T/T 30 days after B/L date',
    validUntil: addDaysToKey(TODAY, 20),
    manufacturer: 'Acme Works',
    notes: 'Prices ex-works.',
    items: quoteItemIds.map((quoteItemId) => ({ quoteItemId, packaging: '25 kg bag', fobPricePerKg: '0.7123', cfrPricePerKg: '0.7956' })),
    ...overrides,
  });

  async function itemIds(quoteId: number): Promise<number[]> {
    return (await prisma.indentQuoteItem.findMany({ where: { quoteId }, orderBy: { id: 'asc' }, select: { id: true } })).map((item) => item.id);
  }

  // Resposta manual da Compras (para deixar a cotacao B RESPONDIDA e aceitavel).
  async function manualRespond(quoteId: number) {
    expect((await api('post', `/quotes/${quoteId}/mark-sent`, { sentOn: TODAY })).status).toBe(200);
    const ids = await itemIds(quoteId);
    const res = await api('post', `/quotes/${quoteId}/response`, {
      respondedOn: TODAY,
      currency: 'USD',
      validUntil: addDaysToKey(TODAY, 20),
      productionLeadTimeDays: 20,
      paymentTerms: 'T/T',
      items: ids.map((quoteItemId) => ({ quoteItemId, packaging: '25 kg bag', fobPricePerKg: '0.7', cfrPricePerKg: '0.795' })),
    });
    expect(res.status).toBe(200);
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: { name: `Admin Indent Portal ${runId}`, email: `${runId}@intelliquote.local`, passwordHash: await hashPassword('Test1234!'), roleId: adminRole.id },
    });
    userId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    for (const label of ['a', 'b']) {
      supplierIds.push((await prisma.indentSupplier.create({ data: { name: `Forn ${label} ${runId}`, nameKey: `forn ${label} ${runId}`, contactEmails: ['fornecedor@forn.test'] } })).id);
    }
    productId = (await prisma.indentProduct.create({ data: { name: `Produto cadastrado ${runId}`, nameKey: `produto cadastrado ${runId}` } })).id;
    clientId = (await prisma.indentClient.create({ data: { name: `Cliente ${runId}`, cnpj: `7${Date.now()}`.slice(0, 14) } })).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const quotes = await prisma.indentQuote.findMany({ where: { requestId: { in: requestIds } }, select: { id: true } });
    const quoteIds = quotes.map((quote) => String(quote.id));
    await prisma.mailLog.deleteMany({ where: { relatedEntityType: 'indent_quote', relatedEntityId: { in: quoteIds } } });
    await prisma.indentPortalAccessLog.deleteMany({ where: { userAgent: { startsWith: runId } } });
    await prisma.indentQuote.updateMany({ where: { requestId: { in: requestIds } }, data: { baseQuoteId: null } });
    await prisma.indentQuote.deleteMany({ where: { requestId: { in: requestIds } } }); // tokens, resposta, anexos e IndentMailLog caem em cascata
    await prisma.indentRequestItem.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.indentRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ performedById: userId }, { entityType: 'indent_quote', performedById: null, entityId: { in: quoteIds } }] } });
    await prisma.indentProduct.deleteMany({ where: { nameKey: { contains: runId } } });
    await prisma.indentClient.deleteMany({ where: { id: clientId } });
    await prisma.indentSupplier.deleteMany({ where: { OR: [{ id: { in: supplierIds } }, { nameKey: { contains: runId } }] } });
    if (userId) {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('envio -> GET -> POST com 4 casas: cotacao e solicitacao RESPONDIDA, Decimal correto, hash do token e AuditLog sem ator', async () => {
    const { requestId, quoteIds } = await newQuote([supplierIds[0]!]);
    const quoteId = quoteIds[0]!;
    const token = await sendAndGetToken(quoteId);

    const view = await pGet(token);
    expect(view.status).toBe(200);
    expect(view.body.state).toBe('open');
    expect(view.body.endCustomer).toBeNull();
    expect(view.body.destination).toBe('Santos');
    expect(view.headers['cache-control']).toBe('no-store');
    const ids = view.body.items.map((item: { quoteItemId: number }) => item.quoteItemId) as number[];
    expect(ids).toEqual(await itemIds(quoteId));

    const res = await pRespond(token, body({}, ids));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ version: 1, revised: false, unchanged: false });

    const quote = await prisma.indentQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { items: true } });
    expect(quote.status).toBe('RESPONDIDA');
    expect(quote.respondedAt).not.toBeNull();
    expect(quote.currency).toBe('USD');
    expect(quote.productionLeadTimeDays).toBe(20);
    expect(quote.paymentTerms).toBe('T/T 30 days after B/L date');
    expect(quote.items.map((item) => [item.packaging, item.fobPricePerKg?.toFixed(4), item.cfrPricePerKg?.toFixed(4)])).toEqual([['25 kg bag', '0.7123', '0.7956']]);
    expect((await prisma.indentRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('RESPONDIDA');
    expect((await prisma.indentPortalResponse.findUniqueOrThrow({ where: { quoteId } })).version).toBe(1);

    const tokenRow = await prisma.indentPortalToken.findFirstOrThrow({ where: { quoteId } });
    expect(tokenRow.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(tokenRow.accessCount).toBe(1);
    expect(tokenRow.firstSeenAt).not.toBeNull();
    const audits = await prisma.auditLog.findMany({ where: { entityType: 'indent_quote', entityId: String(quoteId), action: 'indent_quote.portal_submit' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.performedById).toBeNull();
    const everywhere = JSON.stringify([
      await prisma.indentPortalAccessLog.findMany({ where: { tokenId: tokenRow.id } }),
      await prisma.auditLog.findMany({ where: { entityType: 'indent_quote', entityId: String(quoteId) } }),
      await prisma.mailLog.findMany({ where: { relatedEntityType: 'indent_quote', relatedEntityId: String(quoteId) } }),
    ]);
    expect(everywhere).not.toContain(token);
    expect((await prisma.indentPortalAccessLog.findMany({ where: { tokenId: tokenRow.id } })).map((log) => log.kind).sort()).toEqual(['SUBMIT', 'VIEW']);

    // o GET seguinte ja mostra a resposta do fornecedor
    const again = await pGet(token);
    expect(again.body.state).toBe('sent');
    expect(again.body.response).toMatchObject({ via: 'portal', version: 1 });
    // Compras recebeu o aviso (MailLog do template do aviso)
    expect(await prisma.mailLog.count({ where: { templateId: 'indent_response_received', relatedEntityId: String(quoteId) } })).toBe(1);
  });

  testDbSkip('2 respostas IDENTICAS simultaneas -> uma versao (201) e a outra idempotente (200 unchanged); resposta diferente depois -> versao 2 + revisao', async () => {
    const { quoteIds } = await newQuote([supplierIds[0]!]);
    const quoteId = quoteIds[0]!;
    const token = await sendAndGetToken(quoteId);
    const ids = await itemIds(quoteId);

    const results = await Promise.all([pRespond(token, body({}, ids)), pRespond(token, body({}, ids))]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results.find((r) => r.status === 200)!.body.unchanged).toBe(true);
    expect(await prisma.indentPortalResponseRevision.count({ where: { response: { quoteId } } })).toBe(0);
    expect((await prisma.indentPortalResponse.findUniqueOrThrow({ where: { quoteId } })).version).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'indent_quote', entityId: String(quoteId), action: { startsWith: 'indent_quote.portal_' } } })).toBe(1);

    const changed = await pRespond(token, body({ productionLeadTimeDays: 35 }, ids));
    expect(changed.status).toBe(201);
    expect(changed.body).toMatchObject({ version: 2, revised: true });
    const revisions = await prisma.indentPortalResponseRevision.findMany({ where: { response: { quoteId } } });
    expect(revisions.map((r) => r.version)).toEqual([1]);
    expect((revisions[0]!.snapshot as { productionLeadTimeDays: number }).productionLeadTimeDays).toBe(20);
    expect((await prisma.indentQuote.findUniqueOrThrow({ where: { id: quoteId } })).productionLeadTimeDays).toBe(35);
    expect(await prisma.indentPortalResponseItem.count({ where: { response: { quoteId } } })).toBe(1);
  });

  testDbSkip('submit de A x accept de B na MESMA solicitacao em paralelo -> sem deadlock, uma unica ACEITA, resposta de A gravada; depois do aceite o submit e afterAcceptance', async () => {
    const { requestId, quoteIds } = await newQuote([supplierIds[0]!, supplierIds[1]!]);
    const [a, b] = quoteIds as [number, number];
    await manualRespond(b);
    const token = await sendAndGetToken(a);
    const ids = await itemIds(a);

    const [submitted, accepted] = await Promise.all([pRespond(token, body({}, ids)), api('post', `/quotes/${b}/accept`)]);

    expect(accepted.status).toBe(200);
    expect(submitted.status).toBe(201);
    expect(await prisma.indentQuote.count({ where: { requestId, status: 'ACEITA' } })).toBe(1);
    expect((await prisma.indentQuote.findUniqueOrThrow({ where: { id: b } })).status).toBe('ACEITA');
    expect((await prisma.indentQuote.findUniqueOrThrow({ where: { id: a } })).status).toBe('RESPONDIDA'); // o portal nunca grava ACEITA
    expect((await prisma.indentRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('CONVERTIDA');
    expect(await prisma.indentPortalResponse.count({ where: { quoteId: a } })).toBe(1);

    // com o aceite ja gravado, uma nova versao da resposta de A e "apos aceite" e nao mexe no aceite nem na solicitacao
    const late = await pRespond(token, body({ productionLeadTimeDays: 33 }, ids));
    expect(late.status).toBe(201);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'indent_quote', entityId: String(a), action: 'indent_quote.portal_revise' } });
    expect((audit.metadata as { afterAcceptance: boolean }).afterAcceptance).toBe(true);
    expect(await prisma.indentQuote.count({ where: { requestId, status: 'ACEITA' } })).toBe(1);
    expect((await prisma.indentRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('CONVERTIDA');
    const view = await pGet(token);
    expect(JSON.stringify(view.body)).not.toMatch(/accept|aceit|convert/i);
  });

  testDbSkip('submit x pedir revisao na MESMA cotacao em paralelo -> sem deadlock e estado coerente (REVISADA no fim; submit 201 ou 410)', async () => {
    const { requestId, quoteIds } = await newQuote([supplierIds[0]!]);
    const quoteId = quoteIds[0]!;
    const token = await sendAndGetToken(quoteId);
    const ids = await itemIds(quoteId);
    expect((await pRespond(token, body({}, ids))).status).toBe(201);

    const [submitted, revision] = await Promise.all([pRespond(token, body({ productionLeadTimeDays: 44 }, ids)), api('post', `/quotes/${quoteId}/revision`)]);

    expect(revision.status).toBe(201); // cria a cotacao R2
    expect([201, 410]).toContain(submitted.status);
    expect((await prisma.indentQuote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe('REVISADA');
    expect(await prisma.indentQuote.count({ where: { requestId, revision: 2 } })).toBe(1);
    const stored = await prisma.indentPortalResponse.findUniqueOrThrow({ where: { quoteId } });
    expect(stored.version).toBe(submitted.status === 201 ? 2 : 1);
    expect(stored.productionLeadTimeDays).toBe(submitted.status === 201 ? 44 : 20);
    // depois de REVISADA o link antigo esta fechado
    const closed = await pGet(token);
    expect(closed.status).toBe(410);
    expect(closed.body.code).toBe('LINK_CLOSED');
  });

  testDbSkip('uploads simultaneos: 7 PDFs distintos -> exatamente 5 gravados (2 x 409); o mesmo PDF 3x em paralelo -> 1 anexo', async () => {
    const { quoteIds } = await newQuote([supplierIds[0]!]);
    const quoteId = quoteIds[0]!;
    const token = await sendAndGetToken(quoteId);

    const results = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((seed) => pUpload(token, pdf(seed), `arquivo-${seed}.pdf`)));

    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    const rejected = results.filter((r) => r.status === 409);
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.body.code === 'TOO_MANY_FILES')).toBe(true);
    expect(await prisma.indentPortalAttachment.count({ where: { quoteId } })).toBe(5);
    expect(await prisma.indentPortalAttachmentFile.count({ where: { attachment: { quoteId } } })).toBe(5);

    const other = await newQuote([supplierIds[1]!]);
    const otherToken = await sendAndGetToken(other.quoteIds[0]!);
    const same = await Promise.all([0, 1, 2].map(() => pUpload(otherToken, pdf(99), 'mesmo.pdf')));
    expect(same.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(same.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.indentPortalAttachment.count({ where: { quoteId: other.quoteIds[0]! } })).toBe(1);
  });

  testDbSkip('PDF do fornecedor gravado e baixado byte a byte pela rota interna; token invalido nao grava; nao-PDF 400', async () => {
    const { quoteIds } = await newQuote([supplierIds[0]!]);
    const quoteId = quoteIds[0]!;
    const token = await sendAndGetToken(quoteId);
    const file = pdf(42, 5000);

    const created = await pUpload(token, file, 'Relatório "TDS".pdf');
    expect(created.status).toBe(201);
    expect(created.body.fileName).not.toMatch(/"/);

    const download = await api('get', `/quotes/${quoteId}/portal-attachments/${created.body.id}`);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['content-disposition']).toContain("filename*=UTF-8''Relat%C3%B3rio");
    expect(Buffer.from(download.body).equals(file)).toBe(true);
    // anexo de OUTRA cotacao -> 404
    const otherQuote = (await newQuote([supplierIds[1]!])).quoteIds[0]!;
    expect((await api('get', `/quotes/${otherQuote}/portal-attachments/${created.body.id}`)).status).toBe(404);

    const bad = await pUpload(token, Buffer.from('nao e pdf, so texto'), 'x.pdf');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('NOT_PDF');
    const nope = await pUpload('Z'.repeat(43), pdf(7));
    expect(nope.status).toBe(404);
    expect(await prisma.indentPortalAttachment.count({ where: { quoteId } })).toBe(1);

    const state = await api('get', `/quotes/${quoteId}/portal`);
    expect(state.body.attachments).toEqual([expect.objectContaining({ id: created.body.id, fileSize: file.length })]);
  });

  testDbSkip('a parceria ATUAL manda: com parceria + opcao o GET mostra o cliente; desligar a parceria depois do envio remove o cliente', async () => {
    const supplierId = supplierIds[1]!;
    await prisma.indentSupplier.update({ where: { id: supplierId }, data: { hasPartnership: true } });
    const { quoteIds } = await newQuote([supplierId]);
    const token = await sendAndGetToken(quoteIds[0]!, { showClientName: true, message: `Offer for the end customer Cliente ${runId}` });

    const withClient = await pGet(token);
    expect(withClient.status).toBe(200);
    expect(withClient.body.endCustomer).toBe(`Cliente ${runId}`);
    expect(withClient.body.message).toContain(`Cliente ${runId}`);

    await prisma.indentSupplier.update({ where: { id: supplierId }, data: { hasPartnership: false } });
    const without = await pGet(token);
    expect(without.status).toBe(200);
    expect(without.body.endCustomer).toBeNull();
    expect(without.body.message).toBeNull();
    expect(JSON.stringify(without.body)).not.toContain(`Cliente ${runId}`);
  });

  testDbSkip('token inexistente/mal formado -> 404 unico; revogado -> 410; lockout depois de 5 invalidas; PortalAccessLog sem token nem hash', async () => {
    const { quoteIds } = await newQuote([supplierIds[0]!]);
    const token = await sendAndGetToken(quoteIds[0]!);
    const client = `${runId}-lock`;
    const get = (value: string) => request(app).get(`/api/indent-portal/${value}`).set('User-Agent', client);

    for (let i = 0; i < 5; i += 1) {
      const res = await get(i % 2 === 0 ? 'curto' : `${'x'.repeat(42)}${i}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('LINK_INVALID');
    }
    expect((await get(token)).status).toBe(429); // bloqueado ate o cliente (IP + UA) esperar

    await prisma.indentPortalToken.updateMany({ where: { quoteId: quoteIds[0]! }, data: { revokedAt: new Date(), revokedReason: 'resend' } });
    const revoked = await pGet(token);
    expect(revoked.status).toBe(410);
    const logs = JSON.stringify(await prisma.indentPortalAccessLog.findMany({ where: { userAgent: { startsWith: runId } } }));
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(createHash('sha256').update(token).digest('hex'));
    expect(logs).toContain('bad_format');
  });
});
