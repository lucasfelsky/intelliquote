import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';

const run = process.env.RUN_DB_TESTS === 'true';
const ROLES = ['comprador', 'gestor', 'viewer'] as const;

describe.skipIf(!run)('Pendencias da revisao da vault (2) em Postgres isolado', () => {
  let prisma: any;
  let app: any;
  const cookies: Record<string, string[]> = {};
  const userIds: Record<string, number> = {};
  let supplier: any;
  const createdRoleIds: number[] = [];

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/iq_critical_test') {
      throw new Error('Execute scripts/test-critical-local.mjs para usar um banco descartavel.');
    }
    ({ prisma } = await import('../src/lib/prisma'));
    ({ app } = await import('../src/app'));
    for (const name of ROLES) {
      // Os arquivos de teste de banco compartilham o mesmo Postgres em sequencia.
      const existing = await prisma.role.findUnique({ where: { name } });
      const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
      if (!existing) createdRoleIds.push(role.id);
      const user = await prisma.user.create({
        data: {
          name,
          email: `${name}.pend2@local.test`,
          passwordHash: await hashPassword('Test12345!'),
          roleId: role.id,
        },
      });
      userIds[name] = user.id;
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'Test12345!' });
      expect(login.status).toBe(200);
      cookies[name] = login.headers['set-cookie'];
    }
    supplier = await prisma.supplier.create({
      data: {
        name: 'Fornecedor Pend2',
        acceptedIncoterms: ['FOB'],
        contacts: { create: { name: 'Contato', email: 'c.pend2@local.test', isPrimary: true } },
      },
      include: { contacts: true },
    });
  });

  afterAll(async () => {
    if (prisma) {
      // Desfaz usuarios/roles criados aqui: outros arquivos de banco fazem
      // role.create nos mesmos nomes e a ordem de execucao nao e garantida.
      const ids = Object.values(userIds);
      await prisma.supplierPortalToken.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.session.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await prisma.role.deleteMany({ where: { id: { in: createdRoleIds }, users: { none: {} } } });
    }
    await prisma?.$disconnect();
  });

  async function createToken(): Promise<{ id: number; raw: string }> {
    const quote = await prisma.quoteRequest.create({
      data: {
        requestCode: `PEND2-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        desiredIncoterm: ['FOB'],
        currency: 'USD',
        items: { create: [{ productName: 'Item 1', quantity: 1 }] },
      },
    });
    const created = await request(app)
      .post(`/api/v1/quote-requests/${quote.id}/portal-tokens`)
      .set('Cookie', cookies.comprador)
      .send({ supplierContactIds: [supplier.contacts[0].id], expiresInDays: 7 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return { id: created.body.tokens[0].token.id, raw: created.body.tokens[0].token.token };
  }

  it('gestor gera novo link: 201, link antigo 404, novo 200 e AuditLog revoke+generate do gestor', async () => {
    const { id: oldId, raw: oldRaw } = await createToken();
    expect((await request(app).get(`/api/portal/${oldRaw}`)).status).toBe(200);

    const regen = await request(app)
      .post(`/api/v1/portal-tokens/${oldId}/regenerate`)
      .set('Cookie', cookies.gestor)
      .send({});
    expect(regen.status, JSON.stringify(regen.body)).toBe(201);
    const newRaw = new URL(regen.body.portalUrl).searchParams.get('token') as string;
    expect(newRaw).not.toBe(oldRaw);

    expect((await request(app).get(`/api/portal/${oldRaw}`)).status).toBe(404);
    expect((await request(app).get(`/api/portal/${newRaw}`)).status).toBe(200);

    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'supplier_portal_token', action: { in: ['revoke', 'generate'] } },
    });
    expect(
      audits.some(
        (a: any) =>
          a.action === 'revoke' && a.entityId === String(oldId) && a.performedById === userIds.gestor,
      ),
    ).toBe(true);
    expect(
      audits.some(
        (a: any) =>
          a.action === 'generate' &&
          a.entityId === String(regen.body.id) &&
          a.performedById === userIds.gestor,
      ),
    ).toBe(true);
  });

  it('viewer nao gera novo link: 403', async () => {
    const { id } = await createToken();
    const res = await request(app)
      .post(`/api/v1/portal-tokens/${id}/regenerate`)
      .set('Cookie', cookies.viewer)
      .send({});
    expect(res.status).toBe(403);
  });

  it('token inexistente: 404 e log INVALID gravado com tokenId null', async () => {
    const fake = randomBytes(32).toString('base64url');
    const res = await request(app).get(`/api/portal/${fake}`);
    expect(res.status).toBe(404);

    const logs = await prisma.supplierPortalTokenLog.findMany({
      where: { kind: 'INVALID', tokenId: null },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const row = logs.find((l: any) => l.meta?.reason === 'not_found');
    expect(row).toBeTruthy();
    expect(row.occurredAt).toBeInstanceOf(Date);
    expect(row.ip).not.toBeNull();
    expect(JSON.stringify(logs)).not.toContain(fake);
  });
});
