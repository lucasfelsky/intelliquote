import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { IndentRequestService } from '../src/services/IndentRequestService';
import { formatProcessNumber } from '../src/utils/indentProcessNumber';
import { hashPassword } from '../src/utils/password';
import { todayKeyInSaoPaulo } from '../src/utils/supplierDocumentDates';

// Banco real descartavel (scripts/test-critical-local.mjs aplica as migrations, inclusive
// 20261113120000_indent_solicitacoes). Sem RUN_DB_TESTS=true os testes sao pulados.
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `indent-req-db-${Date.now()}`;
const YEAR = Number(todayKeyInSaoPaulo(new Date()).slice(0, 4));

describe('IQ Indent - solicitacoes (DB)', () => {
  let cookies: string[] = [];
  let userId = 0;
  let userName = '';
  let livreClientId = 0;
  let aprovadosClientId = 0;
  let supplierA = 0; // aprovado pelo cliente APROVADOS, fornece o produto 1
  let supplierB = 0; // fora da lista (travado)
  let productId = 0;
  const requestIds: number[] = [];
  const extraYears: number[] = [];

  async function api(method: 'get' | 'post', path: string, body?: object) {
    const req = request(app)[method](`/api/v1/indent${path}`).set('Cookie', cookies);
    return method === 'get' ? req : req.send(body ?? {});
  }

  async function createRequest(clientId: number, items: Array<Record<string, unknown>>) {
    const res = await api('post', '/requests', { clientId, items });
    if (res.status === 201) requestIds.push(res.body.id);
    return res;
  }

  function item(quantityKg = 1000) {
    return { productId, description: `Produto cadastrado ${runId}`, quantityKg };
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    userName = `Admin Indent Req ${runId}`;
    const user = await prisma.user.create({
      data: {
        name: userName,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    userId = user.id;

    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    supplierA = (await prisma.indentSupplier.create({ data: { name: `Forn A ${runId}`, nameKey: `forn a ${runId}` } })).id;
    supplierB = (await prisma.indentSupplier.create({ data: { name: `Forn B ${runId}`, nameKey: `forn b ${runId}` } })).id;
    productId = (
      await prisma.indentProduct.create({
        data: { name: `Produto cadastrado ${runId}`, nameKey: `produto cadastrado ${runId}` },
      })
    ).id;
    await prisma.indentSupplierProduct.create({ data: { supplierId: supplierA, productId } });

    livreClientId = (
      await prisma.indentClient.create({ data: { name: `Cliente livre ${runId}`, cnpj: `9${Date.now()}`.slice(0, 14) } })
    ).id;
    aprovadosClientId = (
      await prisma.indentClient.create({
        data: {
          name: `Cliente aprovados ${runId}`,
          cnpj: `8${Date.now()}`.slice(0, 14),
          supplierRuleMode: 'APROVADOS',
          ruleReason: 'Politica do teste',
          supplierRules: { create: [{ supplierId: supplierA }] },
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const ids = [
      ...requestIds,
      ...(await prisma.indentRequest.findMany({ where: { ownerName: userName }, select: { id: true } })).map((r) => r.id),
    ];
    await prisma.indentQuote.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.indentRequest.deleteMany({ where: { id: { in: ids } } });
    await prisma.indentSequence.deleteMany({ where: { year: { in: extraYears } } });
    await prisma.auditLog.deleteMany({ where: { performedById: userId } });
    await prisma.indentSupplierProduct.deleteMany({ where: { supplierId: { in: [supplierA, supplierB] } } });
    await prisma.indentProduct.deleteMany({ where: { nameKey: { contains: runId } } });
    await prisma.indentClientSupplierRule.deleteMany({ where: { clientId: { in: [livreClientId, aprovadosClientId] } } });
    await prisma.indentClient.deleteMany({ where: { id: { in: [livreClientId, aprovadosClientId] } } });
    await prisma.indentSupplier.deleteMany({ where: { id: { in: [supplierA, supplierB] } } });
    if (userId) {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('5 criacoes concorrentes geram 5 numeros distintos e consecutivos, com autoria e AuditLog', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => createRequest(livreClientId, [item(1.5)])));

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const seqs = results.map((r) => Number((r.body.processNumber as string).split('/')[0])).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(5);
    expect(seqs[4] - seqs[0]).toBe(4);
    expect(results[0].body.processNumber).toMatch(new RegExp(`/${String(YEAR % 100).padStart(2, '0')}$`));
    expect(results[0].body.ownerName).toBe(userName);
    expect(results[0].body.items[0]).toMatchObject({ quantityKg: 1.5, confirmed: true });

    const row = await prisma.indentRequest.findUniqueOrThrow({ where: { id: results[0].body.id } });
    expect(row).toMatchObject({ origin: 'IQ_INDENT', status: 'NOVA', createdById: userId, createdByName: userName });

    const logs = await prisma.auditLog.count({
      where: { performedById: userId, action: 'indent_request.created', entityId: { in: results.map((r) => String(r.body.id)) } },
    });
    expect(logs).toBe(5);
  });

  testDbSkip('numero gravado por fora (maior que a sequencia) faz o proximo seguir o maior (GREATEST)', async () => {
    const sequence = await prisma.indentSequence.findUniqueOrThrow({ where: { year: YEAR } });
    const outside = sequence.lastNumber + 40;
    const manual = await prisma.indentRequest.create({
      data: {
        processNumber: formatProcessNumber(YEAR, outside),
        processYear: YEAR,
        processSeq: outside,
        origin: 'PIPEDRIVE',
        pipedriveDealId: Number(String(Date.now()).slice(-9)),
        ownerName: userName,
        clientId: livreClientId,
      },
    });
    requestIds.push(manual.id);

    const res = await createRequest(livreClientId, [item()]);

    expect(res.status).toBe(201);
    expect(res.body.processNumber).toBe(formatProcessNumber(YEAR, outside + 1));
  });

  testDbSkip('virada de ano usa o calendario BRT: 31/12 23:30 BRT fica no ano; 01/01 00:30 BRT cria 001/AA do ano novo', async () => {
    const user = { id: userId, name: userName };
    const payload = { clientId: livreClientId, items: [{ productId, description: 'x', quantityKg: 10 }] };
    extraYears.push(2031, 2032);

    const fimDoAno = await IndentRequestService.create(payload, user, new Date('2031-12-31T23:30:00-03:00'));
    expect(fimDoAno.processNumber).toBe('001/31');

    const anoNovo = await IndentRequestService.create(payload, user, new Date('2032-01-01T00:30:00-03:00'));
    expect(anoNovo.processNumber).toBe('001/32');
    requestIds.push(fimDoAno.id, anoNovo.id);

    const sequences = await prisma.indentSequence.findMany({ where: { year: { in: [2031, 2032] } }, orderBy: { year: 'asc' } });
    expect(sequences.map((s) => [s.year, s.lastNumber])).toEqual([
      [2031, 1],
      [2032, 1],
    ]);
  });

  testDbSkip('item livre: cria produto LIVRE com sourceRequestNumber e o reaproveita na solicitacao seguinte', async () => {
    const nome = `Produto livre ${runId}`;
    const first = await createRequest(livreClientId, [{ description: nome, quantityKg: 100 }]);
    expect(first.status).toBe(201);

    const created = await prisma.indentProduct.findMany({ where: { nameKey: nome.toLowerCase() } });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ origin: 'LIVRE', unit: 'kg', sourceRequestNumber: first.body.processNumber });
    expect(first.body.items[0]).toMatchObject({ productId: created[0].id, isFree: true });

    const second = await createRequest(livreClientId, [{ description: `  ${nome.toUpperCase()} `, quantityKg: 50 }]);
    expect(second.status).toBe(201);
    expect(second.body.items[0].productId).toBe(created[0].id);
    expect(await prisma.indentProduct.count({ where: { nameKey: nome.toLowerCase() } })).toBe(1);

    const logs = await prisma.auditLog.count({
      where: { action: 'indent_product.created_from_request', entityId: String(created[0].id) },
    });
    expect(logs).toBe(1);
  });

  testDbSkip('gerar: cobertura/restricao no seletor, excecao gravada com auditoria e 2a geracao em paralelo so passa uma vez', async () => {
    const created = await createRequest(aprovadosClientId, [item(2500)]);
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const options = await api('get', `/requests/${id}/supplier-options`);
    expect(options.status).toBe(200);
    const byId = new Map((options.body.suppliers as Array<{ id: number }>).map((s) => [s.id, s]));
    expect(byId.get(supplierA)).toMatchObject({
      allowed: true,
      approvedByClient: true,
      coverage: { covered: 1, total: 1 },
    });
    expect(byId.get(supplierB)).toMatchObject({
      allowed: false,
      blockedReason: 'Fora da lista de fornecedores aprovados do cliente',
      coverage: { covered: 0, total: 1 },
    });

    const semMotivo = await api('post', `/requests/${id}/quotes`, { suppliers: [{ supplierId: supplierA }, { supplierId: supplierB }] });
    expect(semMotivo.status).toBe(400);
    expect(await prisma.indentQuote.count({ where: { requestId: id } })).toBe(0);

    const body = { suppliers: [{ supplierId: supplierA }, { supplierId: supplierB, exceptionReason: 'Cliente autorizou' }] };
    const [one, two] = await Promise.all([api('post', `/requests/${id}/quotes`, body), api('post', `/requests/${id}/quotes`, body)]);
    expect([one.status, two.status].sort()).toEqual([201, 409]);
    const ok = one.status === 201 ? one : two;
    expect(ok.body.processNumber).toBe(created.body.processNumber);

    const quotes = await prisma.indentQuote.findMany({ where: { requestId: id }, orderBy: { supplierId: 'asc' }, include: { items: true } });
    expect(quotes).toHaveLength(2);
    expect(quotes.every((q) => q.status === 'RASCUNHO' && q.revision === 1 && q.items.length === 1)).toBe(true);
    const travada = quotes.find((q) => q.supplierId === supplierB)!;
    expect(travada).toMatchObject({ exceptionReason: 'Cliente autorizou', exceptionById: userId, exceptionByName: userName });
    expect(travada.exceptionAt).toBeInstanceOf(Date);
    expect(quotes.find((q) => q.supplierId === supplierA)!.exceptionReason).toBeNull();

    expect((await prisma.indentRequest.findUniqueOrThrow({ where: { id } })).status).toBe('COTACAO');
    expect(await prisma.auditLog.count({ where: { action: 'indent_quote.exception_granted', entityId: String(travada.id) } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'indent_request.quotes_generated', entityId: String(id) } })).toBe(1);

    const detail = await api('get', `/requests/${id}`);
    expect(detail.body.status).toBe('COTACAO');
    expect(detail.body.quotes).toHaveLength(2);
    expect(detail.body.quotes.find((q: { supplier: { id: number } }) => q.supplier.id === supplierB).exception).toMatchObject({
      reason: 'Cliente autorizou',
    });

    const again = await api('post', `/requests/${id}/quotes`, body);
    expect(again.status).toBe(409);

    // Restrict: fornecedor com cotacao nao pode ser apagado.
    await expect(prisma.indentSupplier.delete({ where: { id: supplierB } })).rejects.toThrow(/RESTRICT/);
  });

  testDbSkip('cliente pendente: aparece no chip, fica fora de Novas/badge e nao escolhe fornecedor nem gera cotacao', async () => {
    const before = (await api('get', '/requests/new-count')).body.count as number;
    const seq = (await prisma.indentSequence.findUniqueOrThrow({ where: { year: YEAR } })).lastNumber + 100;
    const pending = await prisma.indentRequest.create({
      data: {
        processNumber: formatProcessNumber(YEAR, seq),
        processYear: YEAR,
        processSeq: seq,
        origin: 'PIPEDRIVE',
        pipedriveDealId: Number(String(Date.now()).slice(-8)) + 1,
        ownerName: userName,
        clientId: null,
        items: { create: [{ productId, description: 'Item', quantityKg: 10, confirmed: true, position: 0 }] },
      },
    });
    requestIds.push(pending.id);

    expect(((await api('get', '/requests/new-count')).body.count as number)).toBe(before);

    const list = await api('get', `/requests?filter=pendente&q=${encodeURIComponent(pending.processNumber)}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: { id: number }) => r.id)).toEqual([pending.id]);
    expect(list.body.data[0]).toMatchObject({ clientPending: true, client: null });
    expect(list.body.counts.pendente).toBeGreaterThanOrEqual(1);

    const novas = await api('get', `/requests?filter=nova&q=${encodeURIComponent(pending.processNumber)}`);
    expect(novas.body.data).toEqual([]);

    expect((await api('get', `/requests/${pending.id}/supplier-options`)).status).toBe(409);
    expect((await api('post', `/requests/${pending.id}/quotes`, { suppliers: [{ supplierId: supplierA }] })).status).toBe(409);
    expect(await prisma.indentQuote.count({ where: { requestId: pending.id } })).toBe(0);
  });

  testDbSkip('lista: kpis, busca por item e quantidade decimal ida e volta', async () => {
    const created = await createRequest(livreClientId, [{ productId, description: 'Zinco', quantityKg: 12.345 }]);
    expect(created.status).toBe(201);

    const list = await api('get', `/requests?q=${encodeURIComponent(`cadastrado ${runId}`)}&pageSize=100`);
    expect(list.status).toBe(200);
    const row = list.body.data.find((r: { id: number }) => r.id === created.body.id);
    expect(row.itemsSummary).toMatchObject({ firstName: `Produto cadastrado ${runId}`, count: 1, totalKg: 12.345 });
    expect(row.queueBusinessDays).toBe(0);
    expect(list.body.kpis.novas).toBeGreaterThanOrEqual(1);
  });
});
