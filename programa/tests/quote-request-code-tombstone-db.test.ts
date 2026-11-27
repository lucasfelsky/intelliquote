import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';

const run = process.env.RUN_DB_TESTS === 'true';

const BACKFILL_SQL = path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20261126120000_quote_request_code_tombstone_backfill',
  'migration.sql',
);

describe.skipIf(!run)('Tombstone do codigo da cotacao excluida em Postgres isolado', () => {
  let prisma: any;
  let app: any;
  let cookies: string[];
  let userId: number;
  let createdRoleId: number | null = null;
  const tag = `TOMB-${Date.now()}`;

  async function execBackfill(): Promise<void> {
    // $executeRawUnsafe aceita um comando por chamada: remove comentarios e executa o UPDATE.
    const sql = fs.readFileSync(BACKFILL_SQL, 'utf-8').replace(/\r\n/g, '\n');
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(1);
    await prisma.$executeRawUnsafe(statements[0]);
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/iq_critical_test') {
      throw new Error('Execute scripts/test-critical-local.mjs para usar um banco descartavel.');
    }
    ({ prisma } = await import('../src/lib/prisma'));
    ({ app } = await import('../src/app'));

    // Os arquivos de teste de banco compartilham o mesmo Postgres em sequencia.
    const existing = await prisma.role.findUnique({ where: { name: 'admin' } });
    const role = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    if (!existing) createdRoleId = role.id;
    const user = await prisma.user.create({
      data: {
        name: 'admin',
        email: 'admin.tombstone@local.test',
        passwordHash: await hashPassword('Test12345!'),
        roleId: role.id,
      },
    });
    userId = user.id;
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Test12345!' });
    expect(login.status).toBe(200);
    cookies = login.headers['set-cookie'];
  });

  afterAll(async () => {
    if (prisma) {
      const quotes = await prisma.quoteRequest.findMany({
        where: { requestCode: { startsWith: tag } },
        select: { id: true },
      });
      const ids = quotes.map((q: { id: number }) => String(q.id));
      await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.quoteRequest.deleteMany({ where: { requestCode: { startsWith: tag } } });
      await prisma.auditLog.deleteMany({ where: { performedById: userId } });
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      if (createdRoleId) {
        await prisma.role.deleteMany({ where: { id: createdRoleId, users: { none: {} } } });
      }
    }
    await prisma?.$disconnect();
  });

  it('excluir libera o codigo: tombstone, AuditLog com o original e novo POST com o mesmo codigo', async () => {
    const code = `${tag}-A`;
    const created = await request(app)
      .post('/api/v1/quote-requests')
      .set('Cookie', cookies)
      .send({ requestCode: code, desiredIncoterm: ['FOB'], currency: 'USD' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as number;

    const duplicate = await request(app)
      .post('/api/v1/quote-requests')
      .set('Cookie', cookies)
      .send({ requestCode: code, desiredIncoterm: ['FOB'], currency: 'USD' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({
      message: `O código ${code} já está em uso por outra cotação.`,
      path: 'requestCode',
    });

    const busy = await request(app)
      .get('/api/v1/quote-requests/code-availability')
      .query({ requestCode: code })
      .set('Cookie', cookies);
    expect(busy.status).toBe(200);
    expect(busy.body.available).toBe(false);

    const removed = await request(app).delete(`/api/v1/quote-requests/${id}`).set('Cookie', cookies);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);

    const row = await prisma.quoteRequest.findUnique({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.requestCode).toBe(`${code}#del${id}`);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'quote_request', entityId: String(id), action: 'soft_delete' },
    });
    expect(audit).not.toBeNull();
    expect(audit.metadata.originalRequestCode).toBe(code);
    expect(audit.beforeData.requestCode).toBe(code);
    expect(audit.afterData.requestCode).toBe(`${code}#del${id}`);

    const free = await request(app)
      .get('/api/v1/quote-requests/code-availability')
      .query({ requestCode: code })
      .set('Cookie', cookies);
    expect(free.status).toBe(200);
    expect(free.body.available).toBe(true);

    const again = await request(app)
      .post('/api/v1/quote-requests')
      .set('Cookie', cookies)
      .send({ requestCode: code, desiredIncoterm: ['FOB'], currency: 'USD' });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.id).not.toBe(id);
    expect(again.body.requestCode).toBe(code);
  });

  it('backfill: so a excluida legada muda e a 2a execucao nao altera nada', async () => {
    const base = { desiredIncoterm: ['FOB'], currency: 'USD' };
    const deletedAt = new Date();
    const legacy = await prisma.quoteRequest.create({
      data: { ...base, requestCode: `${tag}-LEG`, deletedAt },
    });
    const live = await prisma.quoteRequest.create({ data: { ...base, requestCode: `${tag}-LIVE` } });
    const done = await prisma.quoteRequest.create({
      data: { ...base, requestCode: `${tag}-DONE`, deletedAt },
    });
    await prisma.quoteRequest.update({
      where: { id: done.id },
      data: { requestCode: `${tag}-DONE#del${done.id}` },
    });

    const codes = async () => {
      const rows = await prisma.quoteRequest.findMany({
        where: { id: { in: [legacy.id, live.id, done.id] } },
        select: { id: true, requestCode: true },
      });
      return Object.fromEntries(rows.map((r: { id: number; requestCode: string }) => [r.id, r.requestCode]));
    };

    await execBackfill();
    const first = await codes();
    expect(first[legacy.id]).toBe(`${tag}-LEG#del${legacy.id}`);
    expect(first[live.id]).toBe(`${tag}-LIVE`);
    expect(first[done.id]).toBe(`${tag}-DONE#del${done.id}`);

    await execBackfill();
    expect(await codes()).toEqual(first);
  });
});
