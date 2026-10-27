import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

// So roda com RUN_DB_TESTS=true (scripts/test-critical-local.mjs: Postgres embutido com TODAS as migrations).
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `cr-lock-db-${Date.now()}`;

const HOLD_MS = 1500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Serializacao do vinculo ao catalogo (linkItemToCatalog) com a criacao/vinculo de cotacao
// (createQuoteWithLinks / linkToExistingQuote): as tres tomam o MESMO lock da linha de
// CommercialRequest (FOR NO KEY UPDATE) antes de ler itens/status.
//
// Determinismo: o teste segura o lock numa transacao aberta (como linkItemToCatalog faria no meio
// da troca de vinculo), dispara a outra operacao, troca o vinculo A -> B dentro da transacao
// segurada e so entao faz commit. Sem o lock, a operacao le o vinculo A antes do commit e grava
// um item de cotacao com catalogo A enquanto o vinculo final e B.
describe('Solicitacao x cotacao: lock da linha da solicitacao serializa com o vinculo de catalogo (DB)', () => {
  const userIds: number[] = [];
  const catalogItemIds: number[] = [];
  const quoteIds: number[] = [];
  let comercialCookies: string[] = [];
  let compradorCookies: string[] = [];
  let catalogAId: number;
  let catalogBId: number;

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
    return login.headers['set-cookie'] as unknown as string[];
  }

  // Solicitacao com 1 item novo ja vinculado ao catalogo A.
  async function linkedDevRequest(name: string) {
    const created = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', comercialCookies)
      .send({ items: [{ proposedName: name, quantity: 5, unit: 'KG' }] });
    expect(created.status).toBe(201);
    const row = await prisma.commercialRequest.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { items: true },
    });
    const itemId = row.items[0].id;
    const linked = await request(app)
      .post(`/api/v1/commercial-requests/${row.id}/items/${itemId}/catalog`)
      .set('Cookie', compradorCookies)
      .send({ catalogItemId: catalogAId });
    expect(linked.status).toBe(200);
    return { requestId: row.id, itemId };
  }

  // Segura o lock da linha da solicitacao, deixa `start` disparar a operacao concorrente, troca o
  // vinculo A -> B dentro da transacao segurada e so entao libera (commit).
  async function relinkWhileHoldingLock<T>(
    requestId: number,
    itemId: number,
    start: () => Promise<T>,
  ): Promise<{ result: T; settledWhileHeld: boolean }> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockedPromise = new Promise<void>((resolve) => {
      locked = resolve;
    });

    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CommercialRequest" WHERE id = ${requestId} FOR NO KEY UPDATE`;
        locked();
        await gate;
        await tx.commercialRequestItem.update({ where: { id: itemId }, data: { catalogItemId: catalogBId } });
      },
      { timeout: 30000, maxWait: 10000 },
    );
    await lockedPromise;

    let settled = false;
    const operation = start().then((value) => {
      settled = true;
      return value;
    });
    await sleep(HOLD_MS);
    const settledWhileHeld = settled;
    release();
    await holder;
    return { result: await operation, settledWhileHeld };
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    comercialCookies = await createUser('comercial', 'comercial');
    compradorCookies = await createUser('comprador', 'comprador');
    const a = await prisma.catalogItem.create({
      data: { commercialName: `Resina A ${runId}`, marketName: `LCKA-${runId}` },
    });
    const b = await prisma.catalogItem.create({
      data: { commercialName: `Resina B ${runId}`, marketName: `LCKB-${runId}` },
    });
    catalogAId = a.id;
    catalogBId = b.id;
    catalogItemIds.push(a.id, b.id);
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

  testDbSkip(
    'criar cotacao espera o lock do vinculo e enxerga o catalogo FINAL (nunca grava item com catalogo antigo)',
    async () => {
      const { requestId, itemId } = await linkedDevRequest(`Resina Nova ${runId} create`);

      // Payload montado com o catalogo A (vinculo vigente quando a tela abriu).
      const { result, settledWhileHeld } = await relinkWhileHoldingLock(requestId, itemId, () =>
        request(app)
          .post('/api/v1/quote-requests')
          .set('Cookie', compradorCookies)
          .send({
            desiredIncoterm: ['FOB'],
            commercialRequestIds: [requestId],
            items: [{ catalogItemId: catalogAId, quantity: 5, unit: 'KG' }],
          }),
      );

      const row = await prisma.commercialRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { items: true },
      });
      if (row.quoteRequestId !== null) quoteIds.push(row.quoteRequestId);

      expect(settledWhileHeld).toBe(false);
      // Com o lock: a leitura acontece depois do commit (vinculo B), o payload (A) nao casa -> 400.
      expect(result.status).toBe(400);
      expect(row.items[0].catalogItemId).toBe(catalogBId);
      expect(row.status).toBe('pending');
      expect(row.quoteRequestId).toBeNull();
      // Invariante: nenhum item de cotacao da solicitacao diverge do vinculo final.
      expect(row.items[0].quoteRequestItemId).toBeNull();
    },
    30000,
  );

  testDbSkip(
    'vincular a cotacao existente espera o lock do vinculo e usa o catalogo FINAL',
    async () => {
      const { requestId, itemId } = await linkedDevRequest(`Resina Nova ${runId} link`);
      const quote = await prisma.quoteRequest.create({
        data: { requestCode: `QR-${runId}-LINK`, desiredIncoterm: ['FOB'] },
      });
      quoteIds.push(quote.id);

      const { result, settledWhileHeld } = await relinkWhileHoldingLock(requestId, itemId, () =>
        request(app)
          .post(`/api/v1/commercial-requests/${requestId}/link-quote`)
          .set('Cookie', compradorCookies)
          .send({ quoteRequestId: quote.id }),
      );

      expect(settledWhileHeld).toBe(false);
      expect(result.status).toBe(200);

      const row = await prisma.commercialRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { items: true },
      });
      expect(row.status).toBe('quoting');
      expect(row.quoteRequestId).toBe(quote.id);
      const finalCatalogId = row.items[0].catalogItemId;
      expect(finalCatalogId).toBe(catalogBId);

      // Invariante: os itens da cotacao tem exatamente o catalogo do vinculo final (B), nunca o A.
      const quoteItems = await prisma.quoteRequestItem.findMany({
        where: { quoteRequestId: quote.id, deletedAt: null },
        select: { id: true, catalogItemId: true },
      });
      expect(quoteItems.map((q) => q.catalogItemId)).toEqual([finalCatalogId]);
      expect(row.items[0].quoteRequestItemId).toBe(quoteItems[0].id);
    },
    30000,
  );
});
