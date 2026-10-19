import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';

const run = process.env.RUN_DB_TESTS === 'true';

const BACKFILL_SQL = path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20261019150100_quote_request_listed_at_backfill',
  'migration.sql',
);

describe.skipIf(!run)('QuoteRequest.listedAt/reopenedAt em Postgres isolado', () => {
  let prisma: any;
  let app: any;
  let cookies: string[];
  let userId: number;
  let createdRoleId: number | null = null;
  const tag = `LISTED-${Date.now()}`;

  async function createQuote(key: string, extra: Record<string, unknown> = {}): Promise<any> {
    return prisma.quoteRequest.create({
      data: { requestCode: `${tag}-${key}`, desiredIncoterm: ['FOB'], currency: 'USD', ...extra },
    });
  }

  async function reload(id: number): Promise<any> {
    return prisma.quoteRequest.findUnique({ where: { id } });
  }

  async function execBackfill(): Promise<void> {
    // $executeRawUnsafe aceita um comando por chamada: remove comentarios e executa cada UPDATE.
    const sql = fs.readFileSync(BACKFILL_SQL, 'utf-8').replace(/\r\n/g, '\n');
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
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
        email: 'admin.listedat@local.test',
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

  it('schema: colunas, default, precisao e indice existem sem drift', async () => {
    const cols: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT column_name, is_nullable, column_default, datetime_precision
      FROM information_schema.columns
      WHERE table_name = 'QuoteRequest' AND column_name IN ('listedAt', 'reopenedAt')`;
    const listed = cols.find((c) => c.column_name === 'listedAt');
    const reopened = cols.find((c) => c.column_name === 'reopenedAt');
    expect(listed?.is_nullable).toBe('NO');
    expect(String(listed?.column_default)).toContain('CURRENT_TIMESTAMP');
    expect(Number(listed?.datetime_precision)).toBe(3);
    expect(reopened?.is_nullable).toBe('YES');

    const idx: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'QuoteRequest' AND indexname = 'QuoteRequest_listedAt_idx'`;
    expect(idx).toHaveLength(1);

    // Diff direcionado: o diff global nao e vazio por causa do indice parcial
    // SupplierContact_single_primary_per_supplier, que o schema nao modela.
    const diff = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'diff',
        '--from-url',
        process.env.DATABASE_URL!,
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--script',
      ],
      { encoding: 'utf-8' },
    );
    expect(diff.status, diff.stderr).toBe(0);
    expect(diff.stdout).not.toMatch(/listedAt|reopenedAt/);
  });

  it('backfill: reopenedAt vem do ultimo AuditLog reopen, listedAt = GREATEST e e idempotente', async () => {
    const a = await createQuote('bf-a');
    const b = await createQuote('bf-b');
    const c = await createQuote('bf-c');
    const t1 = new Date(b.createdAt.getTime() + 60_000);
    const t2 = new Date(b.createdAt.getTime() + 120_000);

    await prisma.auditLog.createMany({
      data: [
        { entityType: 'quote_request', entityId: String(b.id), action: 'reopen', createdAt: t1 },
        { entityType: 'quote_request', entityId: String(b.id), action: 'reopen', createdAt: t2 },
        { entityType: 'commercial_request', entityId: String(c.id), action: 'reopen', createdAt: t2 },
      ],
    });

    // Simula o default da migration: listedAt = instante futuro, reopenedAt nulo.
    await prisma.quoteRequest.updateMany({
      where: { id: { in: [a.id, b.id, c.id] } },
      data: { listedAt: new Date('2030-01-01T00:00:00.000Z'), reopenedAt: null },
    });

    const snapshot = async () => {
      const [ra, rb, rc] = await Promise.all([reload(a.id), reload(b.id), reload(c.id)]);
      return { ra, rb, rc };
    };

    await execBackfill();
    const first = await snapshot();
    expect(first.ra.reopenedAt).toBeNull();
    expect(first.ra.listedAt.getTime()).toBe(first.ra.createdAt.getTime());
    expect(first.rb.reopenedAt.getTime()).toBe(t2.getTime());
    expect(first.rb.listedAt.getTime()).toBe(t2.getTime());
    expect(first.rc.reopenedAt).toBeNull();
    expect(first.rc.listedAt.getTime()).toBe(first.rc.createdAt.getTime());

    await execBackfill();
    const second = await snapshot();
    for (const key of ['ra', 'rb', 'rc'] as const) {
      expect(second[key].listedAt.getTime()).toBe(first[key].listedAt.getTime());
      expect(second[key].reopenedAt?.getTime() ?? null).toBe(first[key].reopenedAt?.getTime() ?? null);
    }
  });

  it('reopen real grava reopenedAt = listedAt e close nao mexe neles', async () => {
    const d = await createQuote('reopen');
    await prisma.quoteRequest.update({
      where: { id: d.id },
      data: { status: 'closed', closedAt: new Date() },
    });

    const reopen = await request(app).post(`/api/v1/quote-requests/${d.id}/reopen`).set('Cookie', cookies);
    expect(reopen.status, JSON.stringify(reopen.body)).toBe(200);

    const afterReopen = await reload(d.id);
    expect(afterReopen.status).toBe('open');
    expect(afterReopen.reopenedAt).not.toBeNull();
    expect(afterReopen.listedAt.getTime()).toBe(afterReopen.reopenedAt.getTime());
    expect(afterReopen.listedAt.getTime()).toBeGreaterThan(afterReopen.createdAt.getTime());

    const close = await request(app)
      .post(`/api/v1/quote-requests/${d.id}/close`)
      .set('Cookie', cookies)
      .send({});
    expect(close.status, JSON.stringify(close.body)).toBe(200);

    const afterClose = await reload(d.id);
    expect(afterClose.status).toBe('closed');
    expect(afterClose.reopenedAt.getTime()).toBe(afterReopen.reopenedAt.getTime());
    expect(afterClose.listedAt.getTime()).toBe(afterReopen.listedAt.getTime());
  });

  it('ordem real: cotacao reaberta (mais antiga) vem antes da mais nova', async () => {
    const e1 = await createQuote('order-e1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const e2 = await createQuote('order-e2');
    await prisma.quoteRequest.update({
      where: { id: e1.id },
      data: { status: 'closed', closedAt: new Date() },
    });

    const before = await request(app)
      .get(`/api/v1/quote-requests?search=${tag}-order-e&page=1&pageSize=50`)
      .set('Cookie', cookies);
    expect(before.status).toBe(200);
    expect(before.body.data[0].id).toBe(e2.id);

    const reopen = await request(app).post(`/api/v1/quote-requests/${e1.id}/reopen`).set('Cookie', cookies);
    expect(reopen.status, JSON.stringify(reopen.body)).toBe(200);

    const after = await request(app)
      .get(`/api/v1/quote-requests?search=${tag}-order-e&page=1&pageSize=50`)
      .set('Cookie', cookies);
    expect(after.status).toBe(200);
    expect(after.body.data[0].id).toBe(e1.id);
    expect(after.body.data[0].reopenedAt).toBeTruthy();
  });

  it('mes real: filtro usa listedAt, nao createdAt', async () => {
    const f = await createQuote('month', {
      createdAt: new Date('2026-08-15T12:00:00.000Z'),
      listedAt: new Date('2026-09-10T12:00:00.000Z'),
    });

    const inListedMonth = await request(app)
      .get(`/api/v1/quote-requests?month=2026-09&search=${tag}-month&page=1&pageSize=50`)
      .set('Cookie', cookies);
    expect(inListedMonth.status).toBe(200);
    expect(inListedMonth.body.data.map((q: { id: number }) => q.id)).toContain(f.id);

    const inCreatedMonth = await request(app)
      .get(`/api/v1/quote-requests?month=2026-08&search=${tag}-month&page=1&pageSize=50`)
      .set('Cookie', cookies);
    expect(inCreatedMonth.status).toBe(200);
    expect(inCreatedMonth.body.data.map((q: { id: number }) => q.id)).not.toContain(f.id);
  });
});
