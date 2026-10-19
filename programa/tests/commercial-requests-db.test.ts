import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

// So roda com RUN_DB_TESTS=true (scripts/test-critical-local.mjs: Postgres embutido com TODAS as migrations).
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `commercial-db-${Date.now()}`;

describe('Solicitacoes do comercial (DB)', () => {
  const userIds: number[] = [];
  const catalogItemIds: number[] = [];
  let cookiesA: string[] = [];
  let cookiesB: string[] = [];
  let viewerCookies: string[] = [];
  let userAId: number;
  let itemId: number;

  async function createUser(roleName: string, label: string) {
    // `comercial` precisa vir da MIGRATION (sem upsert); os demais papeis vem do seed, entao upsert.
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

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const a = await createUser('comercial', 'comercial-a');
    const b = await createUser('comercial', 'comercial-b');
    const v = await createUser('viewer', 'viewer');
    userAId = a.user.id;
    cookiesA = a.cookies;
    cookiesB = b.cookies;
    viewerCookies = v.cookies;

    const item = await prisma.catalogItem.create({
      data: {
        commercialName: `Resina ${runId}`,
        marketName: `RES-${runId}`,
        dbcorpCode: 'DB-SECRET',
        ncm: '39011000',
      },
    });
    itemId = item.id;
    catalogItemIds.push(item.id);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ entityType: 'commercial_request' }, { performedById: { in: userIds } }],
      },
    });
    // Itens saem em cascata junto com a solicitacao.
    await prisma.commercialRequest.deleteMany({ where: { requestedById: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.catalogItem.deleteMany({ where: { id: { in: catalogItemIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  testDbSkip('papel comercial existe apos as migrations', async () => {
    const role = await prisma.role.findUnique({ where: { name: 'comercial' } });
    expect(role).not.toBeNull();
  });

  testDbSkip('A cria, B nao ve a de A, pending-count conta, busca nao vaza campos internos', async () => {
    const baseline = await prisma.commercialRequest.count({ where: { status: 'pending' } });

    const search = await request(app)
      .get(`/api/v1/commercial-requests/catalog-items?search=${encodeURIComponent('Resina ' + runId)}`)
      .set('Cookie', cookiesA);
    expect(search.status).toBe(200);
    expect(search.body).toEqual([
      { id: itemId, commercialName: `Resina ${runId}`, familyName: null },
    ]);
    expect(JSON.stringify(search.body)).not.toContain('DB-SECRET');

    const create = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookiesA)
      .send({
        customerName: 'ACME',
        items: [{ catalogItemId: itemId, quantity: 3, unit: 'KG', targetPrice: 9.9 }],
      });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('pending');
    expect(create.body.items[0]).toMatchObject({
      commercialName: `Resina ${runId}`,
      quantity: 3,
      unit: 'KG',
      targetPrice: '9.90',
      targetCurrency: 'USD',
    });
    expect(JSON.stringify(create.body)).not.toContain('DB-SECRET');

    const row = await prisma.commercialRequest.findUniqueOrThrow({ where: { id: create.body.id } });
    expect(row.requestedById).toBe(userAId);

    const mineA = await request(app).get('/api/v1/commercial-requests/mine').set('Cookie', cookiesA);
    expect(mineA.status).toBe(200);
    expect(mineA.body.data.map((r: { id: number }) => r.id)).toContain(create.body.id);

    const mineB = await request(app).get('/api/v1/commercial-requests/mine').set('Cookie', cookiesB);
    expect(mineB.status).toBe(200);
    expect(mineB.body.data).toEqual([]);

    const count = await request(app)
      .get('/api/v1/commercial-requests/pending-count')
      .set('Cookie', viewerCookies);
    expect(count.status).toBe(200);
    expect(count.body.count).toBe(baseline + 1);

    const detail = await request(app)
      .get(`/api/v1/commercial-requests/${create.body.id}`)
      .set('Cookie', viewerCookies);
    expect(detail.status).toBe(200);
    expect(detail.body.requestedBy.id).toBe(userAId);
    expect(detail.body.items[0].dbcorpCode).toBe('DB-SECRET');
  });

  testDbSkip('mesmo item duas vezes na mesma solicitacao e rejeitado (400)', async () => {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', cookiesA)
      .send({
        items: [
          { catalogItemId: itemId, quantity: 1, unit: 'KG' },
          { catalogItemId: itemId, quantity: 2, unit: 'KG' },
        ],
      });
    expect(response.status).toBe(400);
  });
});
