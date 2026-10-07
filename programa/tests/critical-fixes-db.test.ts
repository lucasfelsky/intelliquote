import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';

const run = process.env.RUN_DB_TESTS === 'true';
describe.skipIf(!run)('Correcoes criticas em Postgres isolado', () => {
  let prisma: any;
  let app: any;
  let cookies: string[];
  let buyerCookies: string[];
  let adminId: number;
  let initialThreshold: unknown;
  const userIds: number[] = [];
  const createdRoleIds: number[] = [];
  let quote: any;
  let suppliers: any[];
  let proposals: any[];
  const weights = { priceWeight: 100, paymentTermsWeight: 0, incotermWeight: 0, qualityWeight: 0 };
  const payload = (supplierId: number, prices = [10, 100]) => ({
    quoteRequestId: quote.id, supplierId, currency: 'USD', exchangeRate: 5,
    offeredIncoterm: 'FOB', paymentTermsDays: 30,
    items: quote.items.map((item: any, i: number) => ({ quoteRequestItemId: item.id,
      quantity: item.quantity, unitPrice: prices[i] })),
  });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/iq_critical_test') {
      throw new Error('Execute scripts/test-critical-local.mjs para usar um banco descartavel.');
    }
    ({ prisma } = await import('../src/lib/prisma'));
    ({ app } = await import('../src/app'));
    for (const name of ['admin', 'comprador']) {
      // Os arquivos de teste de banco compartilham o mesmo Postgres em sequencia.
      const existing = await prisma.role.findUnique({ where: { name } });
      const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
      if (!existing) createdRoleIds.push(role.id);
      const user = await prisma.user.create({ data: { name, email: `${name}.critical@local.test`,
        passwordHash: await hashPassword('Test12345!'), roleId: role.id } });
      userIds.push(user.id);
      const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test12345!' });
      expect(login.status).toBe(200);
      if (name === 'admin') { cookies = login.headers['set-cookie']; adminId = user.id; }
      else buyerCookies = login.headers['set-cookie'];
    }
    await prisma.companyProfile.upsert({ where: { id: 1 }, update: {}, create: { id: 1, companyName: 'Empresa teste' } });
    initialThreshold = (await prisma.companyProfile.findUnique({ where: { id: 1 } })).awardApprovalThreshold;
    suppliers = await Promise.all(['A', 'B'].map(name => prisma.supplier.create({ data: {
      name, acceptedIncoterms: ['FOB'], contacts: { create: { name, email: `${name}@local.test`, isPrimary: true } },
    }, include: { contacts: true } })));
  });
  beforeEach(async () => {
    await prisma.companyProfile.update({ where: { id: 1 }, data: { awardApprovalThreshold: null } });
    quote = await prisma.quoteRequest.create({ data: {
      requestCode: `TEST-${Date.now()}`, desiredIncoterm: ['FOB'], currency: 'USD',
      items: { create: [{ productName: 'Item 1', quantity: 1 }, { productName: 'Item 2', quantity: 1 }] },
    }, include: { items: { orderBy: { id: 'asc' } } } });
    proposals = [];
    for (const [i, supplier] of suppliers.entries()) {
      const response = await request(app).post('/api/v1/quote-responses').set('Cookie', cookies)
        .send(payload(supplier.id, i === 0 ? [10, 100] : [20, 1]));
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      proposals.push(response.body);
    }
  });
  afterAll(async () => {
    if (prisma) {
      // Desfaz usuarios/roles criados aqui: outros arquivos de banco fazem
      // role.create nos mesmos nomes e a ordem de execucao nao e garantida.
      await prisma.companyProfile.update({ where: { id: 1 }, data: { awardApprovalThreshold: initialThreshold } });
      await prisma.supplierPortalToken.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.dispatchEvent.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.role.deleteMany({ where: { id: { in: createdRoleIds }, users: { none: {} } } });
    }
    await prisma?.$disconnect();
  });

  it('corrige o vencedor de propostas antigas no preview e na persistencia', async () => {
    for (const [i, proposal] of proposals.entries()) await prisma.quoteResponse.update({
      where: { id: proposal.id }, data: { offeredPrice: i === 0 ? 10 : 20 },
    });
    for (const suffix of ['/compare/preview', '/compare']) {
      const res = await request(app).post(`/api/v1/quote-requests/${quote.id}${suffix}`).set('Cookie', cookies).send(weights);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.results.find((r: any) => r.isWinner).supplierId).toBe(suppliers[1].id);
      expect(res.body.results.map((r: any) => r.totalLandedCost)).toEqual([550, 105]);
    }
    const saved = await prisma.quoteComparisonResult.findMany({ where: { comparison: { quoteRequestId: quote.id } }, orderBy: { id: 'asc' } });
    expect(saved.map((r: any) => Number(r.offeredPrice))).toEqual([110, 21]);
  });

  it('nao elege uma resposta parcial como mais barata', async () => {
    await prisma.quoteResponseItem.updateMany({ where: { quoteResponseId: proposals[0].id, quoteRequestItemId: quote.items[1].id }, data: { deletedAt: new Date() } });
    for (const suffix of ['/compare/preview', '/compare']) {
      const res = await request(app).post(`/api/v1/quote-requests/${quote.id}${suffix}`).set('Cookie', cookies).send(weights);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('todos os itens');
    }
    expect(await prisma.quoteComparison.count({ where: { quoteRequestId: quote.id } })).toBe(0);
  });

  it('preserva historico, oculta exclusao, revoga links e permite nova versao explicita', async () => {
    await request(app).post(`/api/v1/quote-requests/${quote.id}/compare`).set('Cookie', cookies).send(weights).expect(200);
    const token = await prisma.supplierPortalToken.create({ data: {
      tokenHash: `token-${quote.id}`, quoteRequestId: quote.id, supplierId: suppliers[0].id,
      createdById: adminId,
      supplierContactId: suppliers[0].contacts[0].id, expiresAt: new Date(Date.now() + 86400000),
    } });
    const id = proposals[0].id;
    await request(app).delete(`/api/v1/quote-responses/${id}`).set('Cookie', cookies).expect(204);
    const archived = await prisma.quoteResponse.findUnique({ where: { id }, include: { items: true, comparisonResults: true } });
    expect(archived.deletedAt).not.toBeNull();
    expect(archived.items).toHaveLength(2);
    expect(archived.items.every((i: any) => i.deletedAt)).toBe(true);
    expect(archived.comparisonResults).toHaveLength(1);
    expect((await prisma.supplierPortalToken.findUnique({ where: { id: token.id } })).revokedAt).not.toBeNull();
    await request(app).get(`/api/v1/quote-responses/${id}`).set('Cookie', cookies).expect(404);
    await request(app).put(`/api/v1/quote-responses/${id}`).set('Cookie', cookies).send({ notes: 'Nao reativar' }).expect(404);
    const listing = await request(app).get('/api/v1/quote-responses').set('Cookie', cookies).expect(200);
    expect(listing.body.some((r: any) => r.id === id)).toBe(false);
    const detail = await request(app).get(`/api/v1/quote-requests/${quote.id}`).set('Cookie', cookies).expect(200);
    expect(detail.body.quoteResponses.map((r: any) => r.id)).toEqual([proposals[1].id]);
    const reports = await request(app).get('/api/v1/reports/savings').set('Cookie', cookies).expect(200);
    expect(reports.body.items.some((r: any) => r.quoteRequestId === quote.id)).toBe(false);
    const restored = await request(app).post('/api/v1/quote-responses').set('Cookie', cookies).send(payload(suppliers[0].id, [9, 90])).expect(201);
    expect(restored.body.id).toBe(id);
    expect(restored.body.version).toBe(2);
    expect(restored.body.deletedAt).toBeNull();
    const items = await prisma.quoteResponseItem.findMany({ where: { quoteResponseId: id } });
    expect(items).toHaveLength(4);
    expect(items.filter((i: any) => !i.deletedAt)).toHaveLength(2);
    const reply = await request(app).post(`/api/v1/quote-responses/${id}/reply/preview`).set('Cookie', cookies).send({}).expect(200);
    expect(reply.body.text).toContain('\t9.00 USD');
    expect(reply.body.text).not.toContain('\t10.00 USD');
  });

  it('aprova proposta e snapshot juntos; comprador nao contorna pelo vencedor manual', async () => {
    await prisma.companyProfile.update({ where: { id: 1 }, data: { awardApprovalThreshold: 50 } });
    const res = await request(app).post(`/api/v1/quote-requests/${quote.id}/compare`).set('Cookie', cookies).send(weights).expect(200);
    expect(res.body.pendingApproval).toBe(true);
    expect(await prisma.quoteResponse.count({ where: { quoteRequestId: quote.id, isWinner: true } })).toBe(0);
    await request(app).post(`/api/v1/quote-requests/${quote.id}/winner`).set('Cookie', buyerCookies)
      .send({ quoteResponseId: proposals[1].id }).expect(403);
    await request(app).post(`/api/v1/quote-requests/${quote.id}/comparisons/${res.body.comparisonId}/approve`).set('Cookie', cookies).expect(200);
    expect((await prisma.quoteResponse.findUnique({ where: { id: proposals[1].id } })).isWinner).toBe(true);
    expect(await prisma.quoteComparisonResult.count({ where: { comparisonId: res.body.comparisonId, isWinner: true } })).toBe(1);
  });

  it('aprovacao antiga nao ressuscita proposta excluida; transacao faz rollback', async () => {
    await prisma.companyProfile.update({ where: { id: 1 }, data: { awardApprovalThreshold: 50 } });
    const res = await request(app).post(`/api/v1/quote-requests/${quote.id}/compare`).set('Cookie', cookies).send(weights).expect(200);
    await request(app).delete(`/api/v1/quote-responses/${proposals[1].id}`).set('Cookie', cookies).expect(204);
    await request(app).post(`/api/v1/quote-requests/${quote.id}/comparisons/${res.body.comparisonId}/approve`).set('Cookie', cookies).expect(404);
    expect((await prisma.quoteComparison.findUnique({ where: { id: res.body.comparisonId } })).approvalStatus).toBe('pending');
  });

  it('preserva limite ao editar empresa sem o campo; comprador nao pode remove-lo', async () => {
    await request(app).put('/api/v1/company-profile').set('Cookie', cookies).send({ companyName: 'Teste', awardApprovalThreshold: 50 }).expect(200);
    await request(app).put('/api/v1/company-profile').set('Cookie', buyerCookies).send({ companyName: 'Teste 2', awardApprovalThreshold: null }).expect(200);
    expect(Number((await prisma.companyProfile.findUnique({ where: { id: 1 } })).awardApprovalThreshold)).toBe(50);
  });

  it('portal soma todos os itens, preserva revisoes e rejeita token revogado com rollback', async () => {
    const { SupplierPortalResponseService } = await import('../src/services/SupplierPortalResponseService');
    const token = await prisma.supplierPortalToken.create({ data: {
      tokenHash: `portal-${quote.id}`, quoteRequestId: quote.id, supplierId: suppliers[0].id,
      supplierContactId: suppliers[0].contacts[0].id, createdById: adminId,
      expiresAt: new Date(Date.now() + 86400000),
    } });
    const input = {
      tokenId: token.id, quoteRequestId: quote.id, supplierId: suppliers[0].id,
      supplierContactId: suppliers[0].contacts[0].id,
      payload: { currency: 'USD', incoterm: 'FOB' as const, paymentTermsDays: 30,
        exchangeRate: 5, totalPrice: 110, validityDays: 30,
        items: payload(suppliers[0].id).items.map((i: any) => ({ ...i, totalPrice: i.unitPrice * i.quantity })),
      },
    };
    const submitted = await SupplierPortalResponseService.submit(input);
    expect(Number(submitted.quoteResponse.offeredPrice)).toBe(110);
    expect(Number(submitted.quoteResponse.totalLandedCost)).toBe(550);
    await SupplierPortalResponseService.submit({ ...input, payload: { ...input.payload, totalPrice: 21,
      items: payload(suppliers[0].id, [20, 1]).items.map((i: any) => ({ ...i, totalPrice: i.unitPrice * i.quantity })),
    } });
    expect(await prisma.supplierPortalResponseRevision.count({ where: { portalTokenId: token.id } })).toBe(1);
    expect(await prisma.quoteResponseItem.count({ where: { quoteResponseId: proposals[0].id, deletedAt: null } })).toBe(2);
    await prisma.supplierPortalToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    await expect(SupplierPortalResponseService.submit(input)).rejects.toThrow();
    expect(Number((await prisma.quoteResponse.findUnique({ where: { id: proposals[0].id } })).offeredPrice)).toBe(21);
    expect(await prisma.supplierPortalResponseRevision.count({ where: { portalTokenId: token.id } })).toBe(1);
  });

  it('portal grava preco por incoterm, preserva legado nulo e snapshot de revisao', async () => {
    const { SupplierPortalResponseService } = await import('../src/services/SupplierPortalResponseService');
    const token = await prisma.supplierPortalToken.create({ data: {
      tokenHash: `incoterm-${quote.id}`, quoteRequestId: quote.id, supplierId: suppliers[0].id,
      supplierContactId: suppliers[0].contacts[0].id, createdById: adminId,
      expiresAt: new Date(Date.now() + 86400000),
    } });
    const build = (prices: number[]) => ({
      tokenId: token.id, quoteRequestId: quote.id, supplierId: suppliers[0].id,
      supplierContactId: suppliers[0].contacts[0].id,
      payload: { currency: 'USD', incoterm: 'FOB' as const, paymentTermsDays: 30,
        exchangeRate: 5, totalPrice: prices.reduce((a, b) => a + b, 0), validityDays: 30,
        items: payload(suppliers[0].id, prices).items.map((i: any) => ({
          ...i, totalPrice: i.unitPrice * i.quantity,
          incotermPrices: [{ incoterm: 'FOB' as const, unitPrice: i.unitPrice }],
        })),
      },
    });
    const first = await SupplierPortalResponseService.submit(build([10, 100]));
    const portalItems = await prisma.supplierPortalResponseItem.findMany({ where: { responseId: first.portalResponse.id } });
    expect(portalItems).toHaveLength(2);
    for (const it of portalItems) expect((it.incotermPrices as any[]).length).toBe(1);
    const mirrored = await prisma.quoteResponseItem.findMany({
      where: { quoteResponseId: first.quoteResponse.id, deletedAt: null },
    });
    for (const it of mirrored) expect((it.incotermPrices as any[])[0].incoterm).toBe('FOB');
    // Item legado: coluna omitida le null.
    const legacy = await prisma.supplierPortalResponseItem.create({ data: {
      responseId: first.portalResponse.id, quoteRequestItemId: quote.items[0].id,
      unitPrice: 1, quantity: 1, totalPrice: 1,
    } });
    expect(legacy.incotermPrices).toBeNull();
    await SupplierPortalResponseService.submit(build([20, 1]));
    const revision = await prisma.supplierPortalResponseRevision.findFirst({ where: { portalTokenId: token.id } });
    expect((revision!.items as any[]).some((i) => Array.isArray(i.incotermPrices))).toBe(true);
  });

  it('portal nao reutiliza cambio USD ao receber proposta em EUR sem taxa', async () => {
    const { SupplierPortalResponseService } = await import('../src/services/SupplierPortalResponseService');
    const token = await prisma.supplierPortalToken.create({ data: {
      tokenHash: `eur-${quote.id}`, quoteRequestId: quote.id, supplierId: suppliers[0].id,
      supplierContactId: suppliers[0].contacts[0].id, createdById: adminId,
      expiresAt: new Date(Date.now() + 86400000),
    } });
    await expect(SupplierPortalResponseService.submit({
      tokenId: token.id, quoteRequestId: quote.id, supplierId: suppliers[0].id,
      supplierContactId: suppliers[0].contacts[0].id,
      payload: { currency: 'EUR', incoterm: 'FOB', paymentTermsDays: 30, totalPrice: 110, validityDays: 30,
        items: payload(suppliers[0].id).items.map((i: any) => ({ ...i, totalPrice: i.unitPrice * i.quantity })),
      },
    })).rejects.toThrow('Exchange rate');
  });

  it('exclui PO realocando itens (anterior/proxima/sem PO), mantem posicoes contiguas e dissolve ao sobrar uma', async () => {
    const [i1, i2] = quote.items;
    const pos: any[] = [];
    for (const n of [1, 2, 3, 4]) {
      const res = await request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
        .set('Cookie', cookies).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      pos.push(res.body.purchaseOrder);
      expect(res.body.purchaseOrder.position).toBe(n);
    }
    await prisma.quoteRequestItem.update({ where: { id: i1.id }, data: { purchaseOrderId: pos[0].id } });
    await prisma.quoteRequestItem.update({ where: { id: i2.id }, data: { purchaseOrderId: pos[1].id } });

    // primeira -> proxima (4 -> 3)
    let del = await request(app).delete(`/api/v1/quote-request-purchase-orders/${pos[0].id}`).set('Cookie', cookies);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(del.body.dissolved).toBe(false);
    expect(del.body.reassignedToPurchaseOrderId).toBe(pos[1].id);
    expect((await prisma.quoteRequestItem.findUnique({ where: { id: i1.id } })).purchaseOrderId).toBe(pos[1].id);
    const remaining = await prisma.quoteRequestPurchaseOrder.findMany({ where: { quoteRequestId: quote.id }, orderBy: { position: 'asc' } });
    expect(remaining.map((o: any) => [o.id, o.position])).toEqual([[pos[1].id, 1], [pos[2].id, 2], [pos[3].id, 3]]);

    // ultima -> anterior (3 -> 2)
    del = await request(app).delete(`/api/v1/quote-request-purchase-orders/${pos[3].id}`).set('Cookie', cookies);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(del.body.dissolved).toBe(false);
    expect(del.body.reassignedToPurchaseOrderId).toBe(pos[2].id);

    // sobram 2: excluir uma dissolve o agrupamento (2 -> 0), itens ficam sem PO
    del = await request(app).delete(`/api/v1/quote-request-purchase-orders/${pos[2].id}`).set('Cookie', cookies);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(del.body.dissolved).toBe(true);
    expect(del.body.reassignedToPurchaseOrderId).toBeNull();
    expect(del.body.dissolvedPurchaseOrder.id).toBe(pos[1].id);
    const items = await prisma.quoteRequestItem.findMany({ where: { quoteRequestId: quote.id } });
    expect(items).toHaveLength(2);
    expect(items.every((i: any) => i.purchaseOrderId === null)).toBe(true);
    expect(await prisma.quoteRequestPurchaseOrder.count({ where: { quoteRequestId: quote.id } })).toBe(0);
  });

  it('rotulo padrao de PO e unico apos excluir e recriar', async () => {
    const created: any[] = [];
    for (let n = 0; n < 3; n++) {
      const res = await request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
        .set('Cookie', cookies).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      created.push(res.body.purchaseOrder);
    }
    const del = await request(app).delete(`/api/v1/quote-request-purchase-orders/${created[0].id}`).set('Cookie', cookies);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(del.body.dissolved).toBe(false);
    const again = await request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
      .set('Cookie', cookies).send({});
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.purchaseOrder.label).toBe('PO 4');

    const orders = await prisma.quoteRequestPurchaseOrder.findMany({ where: { quoteRequestId: quote.id } });
    expect(new Set(orders.map((o: any) => o.label)).size).toBe(orders.length);
  });

  it('agrupar por PO (group:true) cria 2 POs atomicamente e rejeita repetir', async () => {
    const res = await request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
      .set('Cookie', cookies).send({ group: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.purchaseOrders.map((o: any) => [o.label, o.position])).toEqual([['PO 1', 1], ['PO 2', 2]]);
    expect(res.body.purchaseOrder.label).toBe('PO 2');

    const orders = await prisma.quoteRequestPurchaseOrder.findMany({ where: { quoteRequestId: quote.id }, orderBy: { position: 'asc' } });
    expect(orders.map((o: any) => o.position)).toEqual([1, 2]);
    const items = await prisma.quoteRequestItem.findMany({ where: { quoteRequestId: quote.id } });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i: any) => i.purchaseOrderId === orders[0].id)).toBe(true);

    const again = await request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
      .set('Cookie', cookies).send({ group: true });
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(await prisma.quoteRequestPurchaseOrder.count({ where: { quoteRequestId: quote.id } })).toBe(2);
  });

  it('cotacao legada com 1 PO: group cria so mais 1 e adota os itens soltos', async () => {
    const plain = await request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
      .set('Cookie', cookies).send({});
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
    const legacyId = plain.body.purchaseOrder.id;
    expect(await prisma.quoteRequestItem.count({ where: { quoteRequestId: quote.id, purchaseOrderId: null } })).toBeGreaterThan(0);

    const res = await request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
      .set('Cookie', cookies).send({ group: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const orders = await prisma.quoteRequestPurchaseOrder.findMany({ where: { quoteRequestId: quote.id }, orderBy: { position: 'asc' } });
    expect(orders).toHaveLength(2);
    expect(orders[0].id).toBe(legacyId);
    expect(res.body.purchaseOrder.id).toBe(orders[1].id);
    const items = await prisma.quoteRequestItem.findMany({ where: { quoteRequestId: quote.id } });
    expect(items.every((i: any) => i.purchaseOrderId === legacyId)).toBe(true);
  });

  it('group concorrente: exatamente um 201 e um 409, total de 2 POs (lock da cotacao)', async () => {
    const post = () => request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
      .set('Cookie', cookies).send({ group: true });
    const results = await Promise.all([post(), post()]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([201, 409]);
    expect(await prisma.quoteRequestPurchaseOrder.count({ where: { quoteRequestId: quote.id } })).toBe(2);
  });

  // Segura o lock da linha QuoteRequest numa tx aberta ate release(). mode 'update' e o
  // controle negativo (FOR UPDATE), que conflita com o KEY SHARE de INSERT com FK.
  async function holdQuoteLock(mode: 'nku' | 'update' = 'nku') {
    const { lockQuoteRequestForPurchaseOrders } = await import('../src/services/QuotePurchaseOrderService');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let holding!: () => void;
    const holdingP = new Promise<void>((resolve) => { holding = resolve; });
    const done = prisma.$transaction(async (tx: any) => {
      if (mode === 'nku') await lockQuoteRequestForPurchaseOrders(tx, quote.id);
      else await tx.$queryRaw`SELECT id FROM "QuoteRequest" WHERE id = ${quote.id} FOR UPDATE`;
      holding();
      await gate;
    }, { timeout: 30000 });
    await Promise.race([holdingP, done]);
    return { release, done };
  }

  // Prova deterministica de espera: faz polling (limite de tempo) em pg_stat_activity ate achar um
  // backend bloqueado (wait_event_type = 'Lock') cuja query e o SELECT ... FOR NO KEY UPDATE da
  // linha QuoteRequest, e confere em pg_locks que esse backend ainda NAO tem lock de escrita
  // (RowExclusiveLock) em nenhuma tabela filha: ou seja, esta esperando o pai ANTES de gravar filhos.
  async function expectBlockedOnQuoteRequestLock(timeoutMs = 10000) {
    const { Prisma } = await import('@prisma/client');
    const deadline = Date.now() + timeoutMs;
    let waiting: { pid: number; query: string; wait_event_type: string; waiting_on: string | null }[] = [];
    while (Date.now() < deadline) {
      waiting = await prisma.$queryRaw`
        SELECT a.pid, a.query, a.wait_event_type,
               (SELECT string_agg(l.mode || ':' || COALESCE(c.relname, l.locktype), ',')
                  FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation
                 WHERE l.pid = a.pid AND NOT l.granted) AS waiting_on
          FROM pg_stat_activity a
         WHERE a.datname = current_database()
           AND a.pid <> pg_backend_pid()
           AND a.wait_event_type = 'Lock'
           AND a.query LIKE '%FOR NO KEY UPDATE%'
           AND a.query LIKE '%"QuoteRequest"%'`;
      if (waiting.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(waiting.length, 'nenhum backend bloqueado no SELECT ... FOR NO KEY UPDATE da cotacao').toBeGreaterThan(0);
    const pids = waiting.map((w) => Number(w.pid));
    const writes: { relname: string; mode: string }[] = await prisma.$queryRaw`
      SELECT c.relname, l.mode
        FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
       WHERE l.pid IN (${Prisma.join(pids)}) AND l.granted AND l.locktype = 'relation'
         AND l.mode IN ('RowExclusiveLock', 'ShareRowExclusiveLock', 'ExclusiveLock')
         AND c.relname NOT LIKE 'pg\\_%' AND c.relkind = 'r'`;
    expect(writes, 'backend esperando o pai nao pode ter gravado em tabelas filhas').toEqual([]);
  }

  it('criacao concorrente de PO na mesma cotacao gera posicoes e rotulos distintos (lock da cotacao)', async () => {
    const post = () => request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
      .set('Cookie', cookies).send({});
    const results = await Promise.all([post(), post(), post(), post(), post(), post()]);
    for (const res of results) expect(res.status, JSON.stringify(res.body)).toBe(201);

    const orders = await prisma.quoteRequestPurchaseOrder.findMany({
      where: { quoteRequestId: quote.id }, orderBy: { position: 'asc' } });
    expect(orders.map((o: any) => o.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(orders.map((o: any) => o.label)).size).toBe(6);
    expect(orders.map((o: any) => o.label).sort()).toEqual(['PO 1', 'PO 2', 'PO 3', 'PO 4', 'PO 5', 'PO 6']);
  });

  it('reorder concorrente de POs nao gera deadlock (500) e termina com posicoes contiguas', async () => {
    const ids: number[] = [];
    for (let n = 0; n < 3; n++) {
      const res = await request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
        .set('Cookie', cookies).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      ids.push(res.body.purchaseOrder.id);
    }
    const reorder = (orderedIds: number[]) => request(app)
      .put(`/api/v1/quote-requests/${quote.id}/purchase-orders/order`)
      .set('Cookie', cookies).send({ orderedIds });
    const permutations = [
      [ids[0], ids[1], ids[2]], [ids[2], ids[1], ids[0]],
      [ids[1], ids[2], ids[0]], [ids[2], ids[0], ids[1]],
    ];
    for (let round = 0; round < 3; round++) {
      const results = await Promise.all(permutations.map((p) => reorder(p)));
      for (const res of results) expect(res.status, JSON.stringify(res.body)).toBe(200);
    }

    const orders = await prisma.quoteRequestPurchaseOrder.findMany({
      where: { quoteRequestId: quote.id }, orderBy: { position: 'asc' } });
    expect(orders.map((o: any) => o.position)).toEqual([1, 2, 3]);
  });

  it('lock da cotacao (NO KEY UPDATE) serializa locks entre si mas nao bloqueia INSERT com FK para QuoteRequest', async () => {
    const { lockQuoteRequestForPurchaseOrders } = await import('../src/services/QuotePurchaseOrderService');
    const insertsWithFk = (tokenHash: string, lockTimeoutMs: number) => prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT set_config('lock_timeout', ${String(lockTimeoutMs)}, true)`;
      await tx.supplierPortalToken.create({ data: {
        tokenHash, quoteRequestId: quote.id, supplierId: suppliers[0].id,
        createdById: adminId, supplierContactId: suppliers[0].contacts[0].id,
        expiresAt: new Date(Date.now() + 86400000),
      } });
      await tx.dispatchEvent.create({ data: { quoteRequestId: quote.id, createdById: adminId,
        recipientsCount: 1, subject: 'nokey', status: 'completed' } });
    }, { timeout: 30000 });

    const holder = await holdQuoteLock('nku');
    try {
      // INSERT com FK (KEY SHARE no pai) nao pode esperar o NKU: FOR UPDATE esperaria (ciclo com o soft-delete).
      await insertsWithFk(`nokey-${quote.id}`, 2000);

      // Outro lock da mesma cotacao (PO op, soft-delete, reopen) espera o primeiro liberar.
      let secondGotLock = false;
      const second = prisma.$transaction(async (tx: any) => {
        await lockQuoteRequestForPurchaseOrders(tx, quote.id);
        secondGotLock = true;
      }, { timeout: 30000 });
      await expectBlockedOnQuoteRequestLock();
      expect(secondGotLock).toBe(false);
      holder.release();
      await second;
      expect(secondGotLock).toBe(true);
    } finally {
      holder.release();
      await holder.done;
    }

    // Controle negativo: com FOR UPDATE o mesmo INSERT espera e estoura o lock_timeout.
    const negative = await holdQuoteLock('update');
    try {
      await expect(insertsWithFk(`nokey-neg-${quote.id}`, 1000)).rejects.toThrow();
    } finally {
      negative.release();
      await negative.done;
    }
  });

  it('soft-delete da cotacao espera o lock da cotacao (nada e gravado antes de liberar)', async () => {
    const holder = await holdQuoteLock();
    try {
      const deletion = request(app).delete(`/api/v1/quote-requests/${quote.id}`)
        .set('Cookie', cookies).then((res) => res);
      // Prova da espera: backend do DELETE bloqueado no lock do pai, sem escrita previa nos filhos.
      await expectBlockedOnQuoteRequestLock();
      holder.release();
      const res = await deletion;
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    } finally {
      holder.release();
      await holder.done;
    }
    const after = await prisma.quoteRequestItem.findMany({ where: { quoteRequestId: quote.id } });
    expect(after).toHaveLength(2);
    expect(after.every((i: any) => i.deletedAt !== null)).toBe(true);
  });

  it('reopen espera o lock da cotacao (vencedora so e limpa depois de liberar)', async () => {
    await prisma.quoteRequest.update({ where: { id: quote.id }, data: { status: 'closed', closedAt: new Date() } });
    await prisma.quoteResponse.update({ where: { id: proposals[0].id }, data: { isWinner: true } });
    const holder = await holdQuoteLock();
    try {
      const reopening = request(app).post(`/api/v1/quote-requests/${quote.id}/reopen`)
        .set('Cookie', cookies).then((res) => res);
      // Prova da espera: backend do reopen bloqueado no lock do pai, antes do updateMany das respostas.
      await expectBlockedOnQuoteRequestLock();
      holder.release();
      const res = await reopening;
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    } finally {
      holder.release();
      await holder.done;
    }
    expect((await prisma.quoteResponse.findUnique({ where: { id: proposals[0].id } })).isWinner).toBe(false);
  });

  it('PO ops, move_po e soft-delete concorrentes nao geram deadlock (500)', async () => {
    const pos: any[] = [];
    for (let n = 0; n < 2; n++) {
      const res = await request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
        .set('Cookie', cookies).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      pos.push(res.body.purchaseOrder);
    }
    await prisma.quoteRequestItem.update({ where: { id: quote.items[0].id }, data: { purchaseOrderId: pos[0].id } });
    await prisma.quoteRequestItem.update({ where: { id: quote.items[1].id }, data: { purchaseOrderId: pos[1].id } });

    const results = await Promise.all([
      request(app).delete(`/api/v1/quote-request-purchase-orders/${pos[0].id}`).set('Cookie', cookies),
      request(app).post(`/api/v1/quote-requests/${quote.id}/purchase-orders`)
        .set('Cookie', cookies).send({ adoptUnassigned: true }),
      request(app).patch(`/api/v1/quote-request-items/${quote.items[1].id}/purchase-order`)
        .set('Cookie', cookies).send({ purchaseOrderId: pos[1].id }),
      request(app).delete(`/api/v1/quote-requests/${quote.id}`).set('Cookie', cookies),
    ]);
    for (const res of results) {
      expect([200, 201, 400, 404], JSON.stringify(res.body)).toContain(res.status);
    }
  });

  it('reopen e soft-delete concorrentes da mesma cotacao nao geram deadlock (500)', async () => {
    await prisma.quoteRequest.update({ where: { id: quote.id }, data: { status: 'closed', closedAt: new Date() } });
    await prisma.quoteResponse.update({ where: { id: proposals[0].id }, data: { isWinner: true } });
    const results = await Promise.all([
      request(app).post(`/api/v1/quote-requests/${quote.id}/reopen`).set('Cookie', cookies),
      request(app).delete(`/api/v1/quote-requests/${quote.id}`).set('Cookie', cookies),
    ]);
    for (const res of results) {
      expect(res.status, JSON.stringify(res.body)).not.toBe(500);
    }
  });

  it('GET da cotacao conta envios (dispatchEvents) ignorando os que falharam', async () => {
    const before = await request(app).get(`/api/v1/quote-requests/${quote.id}`).set('Cookie', cookies);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body._count.dispatchEvents).toBe(0);

    await prisma.dispatchEvent.create({ data: { quoteRequestId: quote.id, createdById: adminId,
      recipientsCount: 1, subject: 't', status: 'completed' } });
    await prisma.dispatchEvent.create({ data: { quoteRequestId: quote.id, createdById: adminId,
      recipientsCount: 1, subject: 't', status: 'failed' } });

    const after = await request(app).get(`/api/v1/quote-requests/${quote.id}`).set('Cookie', cookies);
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(after.body._count.dispatchEvents).toBe(1);
  });
});
