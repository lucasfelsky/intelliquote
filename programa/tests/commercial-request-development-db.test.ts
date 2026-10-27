import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

// So roda com RUN_DB_TESTS=true (scripts/test-critical-local.mjs: Postgres embutido com TODAS as migrations).
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `cr-dev-db-${Date.now()}`;

// Quebra o arquivo da migration em statements (respeita os blocos DO $$ ... END $$;).
function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = [];
  let current: string[] = [];
  let inDoBlock = false;
  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (current.length === 0 && (line.trim() === '' || line.trim().startsWith('--'))) continue;
    if (line.trim().startsWith('DO $$')) inDoBlock = true;
    current.push(line);
    const endsStatement = line.endsWith(';') && (!inDoBlock || line.trim() === 'END $$;');
    if (endsStatement) {
      statements.push(current.join('\n'));
      current = [];
      inDoBlock = false;
    }
  }
  return statements;
}

describe('Solicitacao de desenvolvimento - item novo e vinculo ao catalogo (DB)', () => {
  const userIds: number[] = [];
  const catalogItemIds: number[] = [];
  const quoteIds: number[] = [];
  let comercialCookies: string[] = [];
  let compradorCookies: string[] = [];
  let viewerCookies: string[] = [];
  let otherComercialCookies: string[] = [];
  let activeItemId: number;
  let secondItemId: number;
  let inactiveItemId: number;
  let activeItemName: string;
  let inactiveItemName: string;

  async function createUser(roleName: string, label: string) {
    const role =
      roleName === 'comercial'
        ? await prisma.role.findUniqueOrThrow({ where: { name: roleName } })
        : await prisma.role.upsert({ where: { name: roleName }, update: {}, create: { name: roleName } });
    const user = await prisma.user.create({
      data: {
        name: `${label} ${runId}`,
        email: `${label}-${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: role.id,
      },
    });
    userIds.push(user.id);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Test1234!' });
    return { user, cookies: login.headers['set-cookie'] as unknown as string[] };
  }

  const NEW_UNIT = { quantity: 5, unit: 'KG' };

  async function createRequest(items: unknown[], cookies = comercialCookies, extra: Record<string, unknown> = {}) {
    return request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookies)
      .send({ items, ...extra });
  }

  // Solicitacao so com 1 item novo; devolve ids.
  async function newDevRequest(name: string) {
    const response = await createRequest([{ proposedName: name, ...NEW_UNIT, notes: 'obs interna' }]);
    expect(response.status).toBe(201);
    const row = await prisma.commercialRequest.findUniqueOrThrow({
      where: { id: response.body.id },
      include: { items: true },
    });
    return { requestId: row.id, itemId: row.items[0].id };
  }

  function linkCatalog(requestId: number, itemId: number, catalogItemId: number, cookies = compradorCookies) {
    return request(app)
      .post(`/api/v1/commercial-requests/${requestId}/items/${itemId}/catalog`)
      .set('Cookie', cookies)
      .send({ catalogItemId });
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    comercialCookies = (await createUser('comercial', 'comercial')).cookies;
    otherComercialCookies = (await createUser('comercial', 'outro-comercial')).cookies;
    compradorCookies = (await createUser('comprador', 'comprador')).cookies;
    viewerCookies = (await createUser('viewer', 'viewer')).cookies;

    activeItemName = `Resina Ativa ${runId}`;
    inactiveItemName = `Resina Inativa ${runId}`;
    const active = await prisma.catalogItem.create({
      data: { commercialName: activeItemName, marketName: `ATV-${runId}` },
    });
    const second = await prisma.catalogItem.create({
      data: { commercialName: `Solvente ${runId}`, marketName: `SOL-${runId}` },
    });
    const inactive = await prisma.catalogItem.create({
      data: { commercialName: inactiveItemName, marketName: `INA-${runId}`, isActive: false },
    });
    activeItemId = active.id;
    secondItemId = second.id;
    inactiveItemId = inactive.id;
    catalogItemIds.push(active.id, second.id, inactive.id);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.auditLog.deleteMany({ where: { performedById: { in: userIds } } });
    await prisma.commercialRequest.deleteMany({ where: { requestedById: { in: userIds } } });
    await prisma.quoteRequest.deleteMany({ where: { id: { in: quoteIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.catalogItem.deleteMany({ where: { id: { in: catalogItemIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  testDbSkip('comercial cria com 1 item de catalogo + 1 item novo: vira desenvolvimento', async () => {
    const name = `Resina Nova ${runId} A`;
    const response = await createRequest([
      { catalogItemId: activeItemId, ...NEW_UNIT },
      { proposedName: name, ...NEW_UNIT, notes: 'obs' },
    ]);

    expect(response.status).toBe(201);
    expect(response.body.isDevelopment).toBe(true);
    const [catalogLine, newLine] = response.body.items;
    expect(catalogLine).toMatchObject({ catalogItemId: activeItemId, isNewItem: false });
    expect(newLine).toMatchObject({
      catalogItemId: null,
      isNewItem: true,
      commercialName: name,
      notes: 'obs',
    });
    const json = JSON.stringify(response.body);
    expect(json).not.toContain('marketName');
    expect(json).not.toContain('proposedName');
  });

  testDbSkip('solicitacao so de catalogo continua nao-desenvolvimento', async () => {
    const response = await createRequest([{ catalogItemId: activeItemId, ...NEW_UNIT }]);
    expect(response.status).toBe(201);
    expect(response.body.isDevelopment).toBe(false);
  });

  testDbSkip('sem cliente: customerName null e GET /mine devolve a linha', async () => {
    const response = await createRequest([{ proposedName: `Resina Nova ${runId} B`, ...NEW_UNIT }]);
    expect(response.status).toBe(201);
    expect(response.body.customerName).toBeNull();

    const mine = await request(app).get('/api/v1/commercial-requests/mine').set('Cookie', comercialCookies);
    expect(mine.status).toBe(200);
    const row = mine.body.data.find((r: { id: number }) => r.id === response.body.id);
    expect(row).toBeTruthy();
    expect(row.customerName).toBeNull();
  });

  testDbSkip('item novo com nome de catalogo ATIVO (so caixa difere) -> 400; de catalogo INATIVO -> 201', async () => {
    const ativo = await createRequest([{ proposedName: activeItemName.toUpperCase(), ...NEW_UNIT }]);
    expect(ativo.status).toBe(400);
    expect(JSON.stringify(ativo.body)).not.toContain(activeItemName.toUpperCase());

    const inativo = await createRequest([{ proposedName: inactiveItemName.toLowerCase(), ...NEW_UNIT }]);
    expect(inativo.status).toBe(201);
    expect(inativo.body.isDevelopment).toBe(true);
  });

  testDbSkip('mesmo item novo 2x na mesma solicitacao -> 400 (Zod)', async () => {
    const response = await createRequest([
      { proposedName: `Resina Nova ${runId} C`, ...NEW_UNIT },
      { proposedName: `RESINA  nova ${runId} c`, ...NEW_UNIT },
    ]);
    expect(response.status).toBe(400);
  });

  testDbSkip('CHECK: item sem catalogItemId e sem proposedName e recusado pelo Postgres', async () => {
    const { requestId } = await newDevRequest(`Resina Nova ${runId} D`);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "CommercialRequestItem" ("commercialRequestId", "quantity", "unit") VALUES (${requestId}, 1, 'KG')`,
      ),
    ).rejects.toThrow();
  });

  testDbSkip('Comex vincula o item novo ao catalogo e os guardas respondem 403/404/400/409', async () => {
    const { requestId, itemId } = await newDevRequest(`Resina Nova ${runId} E`);

    const viewer = await linkCatalog(requestId, itemId, activeItemId, viewerCookies);
    expect(viewer.status).toBe(403);
    const comercial = await linkCatalog(requestId, itemId, activeItemId, comercialCookies);
    expect(comercial.status).toBe(403);

    const ok = await linkCatalog(requestId, itemId, activeItemId);
    expect(ok.status).toBe(200);
    const linked = ok.body.items.find((i: { id: number }) => i.id === itemId);
    expect(linked.catalogItemId).toBe(activeItemId);
    expect(linked.proposedName).toBe(`Resina Nova ${runId} E`);
    expect(linked.isNewItem).toBe(true);
    expect(linked.marketName).toBe(`ATV-${runId}`);

    // relink enquanto pendente
    const relink = await linkCatalog(requestId, itemId, secondItemId);
    expect(relink.status).toBe(200);

    // item de outra solicitacao -> 404
    const other = await newDevRequest(`Resina Nova ${runId} F`);
    const wrongRequest = await linkCatalog(requestId, other.itemId, activeItemId);
    expect(wrongRequest.status).toBe(404);

    // catalogo inativo -> 400
    const inactive = await linkCatalog(other.requestId, other.itemId, inactiveItemId);
    expect(inactive.status).toBe(400);

    // item de catalogo (nao novo) -> 400
    const catalogRequest = await createRequest([{ catalogItemId: activeItemId, ...NEW_UNIT }]);
    const catalogItemRow = await prisma.commercialRequestItem.findFirstOrThrow({
      where: { commercialRequestId: catalogRequest.body.id },
    });
    const notNew = await linkCatalog(catalogRequest.body.id, catalogItemRow.id, secondItemId);
    expect(notNew.status).toBe(400);

    // catalogo ja presente na mesma solicitacao -> 409
    const mixed = await createRequest([
      { catalogItemId: activeItemId, ...NEW_UNIT },
      { proposedName: `Resina Nova ${runId} G`, ...NEW_UNIT },
    ]);
    const newInMixed = await prisma.commercialRequestItem.findFirstOrThrow({
      where: { commercialRequestId: mixed.body.id, catalogItemId: null },
    });
    const duplicated = await linkCatalog(mixed.body.id, newInMixed.id, activeItemId);
    expect(duplicated.status).toBe(409);

    // AuditLog do vinculo: so ids
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'commercial_request', entityId: String(requestId), action: 'link_catalog_item' },
      orderBy: { id: 'asc' },
    });
    expect(audit.metadata).toMatchObject({ itemId, catalogItemId: activeItemId, previousCatalogItemId: null });
    expect(JSON.stringify(audit)).not.toContain(`Resina Nova ${runId} E`);
  });

  testDbSkip('cotar com item novo SEM vinculo -> 409 e nada criado; depois do vinculo -> 201 com isDevelopment', async () => {
    const { requestId, itemId } = await newDevRequest(`Resina Nova ${runId} H`);
    const body = {
      desiredIncoterm: ['FOB'],
      commercialRequestIds: [requestId],
      items: [{ catalogItemId: activeItemId, quantity: 5, unit: 'KG' }],
    };

    const before = await prisma.quoteRequest.count();
    const blocked = await request(app).post('/api/v1/quote-requests').set('Cookie', compradorCookies).send(body);
    expect(blocked.status).toBe(409);
    expect(await prisma.quoteRequest.count()).toBe(before);

    expect((await linkCatalog(requestId, itemId, activeItemId)).status).toBe(200);

    const created = await request(app).post('/api/v1/quote-requests').set('Cookie', compradorCookies).send(body);
    expect(created.status).toBe(201);
    quoteIds.push(created.body.id);

    const quote = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(quote.isDevelopment).toBe(true);
    const row = await prisma.commercialRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { items: true },
    });
    expect(row.status).toBe('quoting');
    expect(row.items[0].quoteRequestItemId).not.toBeNull();

    // solicitacao em cotacao nao aceita mais vinculo de catalogo
    const afterQuote = await linkCatalog(requestId, itemId, secondItemId);
    expect(afterQuote.status).toBe(409);
  });

  testDbSkip('link-quote: desenvolvimento marca a cotacao; solicitacao comum nao', async () => {
    const devQuote = await prisma.quoteRequest.create({
      data: { requestCode: `QR-${runId}-DEV`, desiredIncoterm: ['FOB'] },
    });
    const plainQuote = await prisma.quoteRequest.create({
      data: { requestCode: `QR-${runId}-PLAIN`, desiredIncoterm: ['FOB'] },
    });
    quoteIds.push(devQuote.id, plainQuote.id);

    // sem vinculo -> 409
    const dev = await newDevRequest(`Resina Nova ${runId} I`);
    const blocked = await request(app)
      .post(`/api/v1/commercial-requests/${dev.requestId}/link-quote`)
      .set('Cookie', compradorCookies)
      .send({ quoteRequestId: devQuote.id });
    expect(blocked.status).toBe(409);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: devQuote.id } })).isDevelopment).toBe(false);

    await linkCatalog(dev.requestId, dev.itemId, activeItemId);
    const linked = await request(app)
      .post(`/api/v1/commercial-requests/${dev.requestId}/link-quote`)
      .set('Cookie', compradorCookies)
      .send({ quoteRequestId: devQuote.id });
    expect(linked.status).toBe(200);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: devQuote.id } })).isDevelopment).toBe(true);

    const plain = await createRequest([{ catalogItemId: secondItemId, ...NEW_UNIT }]);
    const plainLink = await request(app)
      .post(`/api/v1/commercial-requests/${plain.body.id}/link-quote`)
      .set('Cookie', compradorCookies)
      .send({ quoteRequestId: plainQuote.id });
    expect(plainLink.status).toBe(200);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: plainQuote.id } })).isDevelopment).toBe(false);
  });

  testDbSkip('GET /commercial-requests?quoteRequestId filtra para a Comex; /mine ignora o filtro', async () => {
    const quote = await prisma.quoteRequest.create({
      data: { requestCode: `QR-${runId}-FILTER`, desiredIncoterm: ['FOB'] },
    });
    quoteIds.push(quote.id);

    const linkedRequest = await createRequest([{ catalogItemId: activeItemId, ...NEW_UNIT }]);
    const freeRequest = await createRequest([{ catalogItemId: secondItemId, ...NEW_UNIT }]);
    const link = await request(app)
      .post(`/api/v1/commercial-requests/${linkedRequest.body.id}/link-quote`)
      .set('Cookie', compradorCookies)
      .send({ quoteRequestId: quote.id });
    expect(link.status).toBe(200);

    const comex = await request(app)
      .get(`/api/v1/commercial-requests?quoteRequestId=${quote.id}`)
      .set('Cookie', compradorCookies);
    expect(comex.status).toBe(200);
    expect(comex.body.data.map((r: { id: number }) => r.id)).toEqual([linkedRequest.body.id]);

    const mine = await request(app)
      .get(`/api/v1/commercial-requests/mine?quoteRequestId=${quote.id}`)
      .set('Cookie', comercialCookies);
    expect(mine.status).toBe(200);
    const mineIds = mine.body.data.map((r: { id: number }) => r.id);
    expect(mineIds).toContain(linkedRequest.body.id);
    expect(mineIds).toContain(freeRequest.body.id);

    // outro comercial nao ve as do primeiro
    const others = await request(app)
      .get(`/api/v1/commercial-requests/mine?quoteRequestId=${quote.id}`)
      .set('Cookie', otherComercialCookies);
    expect(others.body.data.map((r: { id: number }) => r.id)).not.toContain(linkedRequest.body.id);
  });

  testDbSkip('AuditLog do create nao leva o nome digitado nem a observacao do item', async () => {
    const name = `Resina Sigilosa ${runId}`;
    const response = await createRequest([{ proposedName: name, ...NEW_UNIT, notes: 'observacao-sigilosa' }]);
    expect(response.status).toBe(201);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'commercial_request', entityId: String(response.body.id), action: 'create' },
    });
    const after = JSON.stringify(audit.afterData);
    expect(after).not.toContain(name);
    expect(after).not.toContain('observacao-sigilosa');
    expect(audit.afterData).toMatchObject({ isDevelopment: true, items: [{ isNewItem: true }] });
  });

  testDbSkip('a migration e idempotente: reexecutar cada statement nao falha', async () => {
    const sql = readFileSync(
      join(__dirname, '..', 'prisma', 'migrations', '20261027200000_commercial_request_development', 'migration.sql'),
      'utf8',
    );
    const statements = splitMigrationStatements(sql);
    expect(statements.length).toBeGreaterThan(10);
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
  });
});
