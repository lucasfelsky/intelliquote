import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

// So roda com RUN_DB_TESTS=true (scripts/test-critical-local.mjs: Postgres embutido com TODAS as migrations).
const enabled = process.env.RUN_DB_TESTS === 'true';
const testDb = enabled ? it : it.skip;
const runId = `notify-emails-db-${Date.now()}`;

describe('CompanyProfile.commercialRequestNotifyEmails (DB, migration aditiva)', () => {
  const userIds: number[] = [];
  let adminCookies: string[] = [];
  let comercialEmail = '';
  let original: { companyName: string; dispatchCc: string; commercialRequestNotifyEmails: string } | null = null;

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
    if (!enabled) return;
    const admin = await createUser('admin', 'admin');
    adminCookies = admin.cookies;
    const comercial = await createUser('comercial', 'comercial');
    comercialEmail = comercial.user.email;
    const existing = await prisma.companyProfile.findUnique({ where: { id: 1 } });
    original = existing
      ? {
          companyName: existing.companyName,
          dispatchCc: existing.dispatchCc,
          commercialRequestNotifyEmails: existing.commercialRequestNotifyEmails,
        }
      : null;
  });

  afterAll(async () => {
    if (!enabled) return;
    await prisma.auditLog.deleteMany({ where: { performedById: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    if (original) {
      await prisma.companyProfile.update({ where: { id: 1 }, data: original });
    } else {
      await prisma.companyProfile.deleteMany({ where: { id: 1 } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  testDb('coluna nasce com default [] (perfil criado sem o campo)', async () => {
    await prisma.companyProfile.deleteMany({ where: { id: 1 } });
    const created = await prisma.companyProfile.create({ data: { id: 1, companyName: 'Empresa teste' } });
    expect(created.commercialRequestNotifyEmails).toBe('[]');
  });

  testDb('PUT normaliza, deduplica e descarta usuario comercial; GET devolve o array', async () => {
    const put = await request(app)
      .put('/api/v1/company-profile')
      .set('Cookie', adminCookies)
      .send({
        companyName: 'Empresa teste',
        commercialRequestNotifyEmails: [
          '  Gestor@SQQuimica.com ',
          'gestor@sqquimica.com',
          comercialEmail.toUpperCase(),
          'compras@sqquimica.com',
        ],
      });
    expect(put.status).toBe(200);
    expect(put.body.commercialRequestNotifyEmails).toEqual(['gestor@sqquimica.com', 'compras@sqquimica.com']);

    const row = await prisma.companyProfile.findUniqueOrThrow({ where: { id: 1 } });
    expect(JSON.parse(row.commercialRequestNotifyEmails)).toEqual(['gestor@sqquimica.com', 'compras@sqquimica.com']);

    const get = await request(app).get('/api/v1/company-profile').set('Cookie', adminCookies);
    expect(get.status).toBe(200);
    expect(get.body.commercialRequestNotifyEmails).toEqual(['gestor@sqquimica.com', 'compras@sqquimica.com']);
  });

  testDb('PUT sem o campo preserva a lista; PUT com [] limpa', async () => {
    const keep = await request(app)
      .put('/api/v1/company-profile')
      .set('Cookie', adminCookies)
      .send({ companyName: 'Empresa teste' });
    expect(keep.status).toBe(200);
    expect(keep.body.commercialRequestNotifyEmails).toEqual(['gestor@sqquimica.com', 'compras@sqquimica.com']);

    const clear = await request(app)
      .put('/api/v1/company-profile')
      .set('Cookie', adminCookies)
      .send({ companyName: 'Empresa teste', commercialRequestNotifyEmails: [] });
    expect(clear.status).toBe(200);
    expect(clear.body.commercialRequestNotifyEmails).toEqual([]);
    const row = await prisma.companyProfile.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.commercialRequestNotifyEmails).toBe('[]');
  });
});
