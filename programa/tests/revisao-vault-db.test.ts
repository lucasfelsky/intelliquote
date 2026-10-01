import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';

const run = process.env.RUN_DB_TESTS === 'true';

function cookieValue(cookies: string[], name: string): string {
  const found = cookies.find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`cookie ${name} ausente`);
  return found.split(';')[0].slice(name.length + 1);
}

describe.skipIf(!run)('Correcoes da revisao da vault em Postgres isolado', () => {
  let prisma: any;
  let app: any;
  const cookies: Record<string, string[]> = {};
  const refreshTokens: Record<string, string> = {};
  const userIds: Record<string, number> = {};
  const createdRoleIds: number[] = [];
  let supplier: any;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/iq_critical_test') {
      throw new Error('Execute scripts/test-critical-local.mjs para usar um banco descartavel.');
    }
    ({ prisma } = await import('../src/lib/prisma'));
    ({ app } = await import('../src/app'));
    for (const name of ['admin', 'comprador', 'viewer']) {
      // Os arquivos de teste de banco compartilham o mesmo Postgres em sequencia.
      const existing = await prisma.role.findUnique({ where: { name } });
      const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
      if (!existing) createdRoleIds.push(role.id);
      const user = await prisma.user.create({
        data: {
          name,
          email: `${name}.vault1@local.test`,
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
      refreshTokens[name] = cookieValue(login.headers['set-cookie'], 'intelliquote_refresh_token');
    }
    await prisma.companyProfile.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, companyName: 'Empresa teste' },
    });
    supplier = await prisma.supplier.create({
      data: {
        name: 'Fornecedor Regenerate',
        acceptedIncoterms: ['FOB'],
        contacts: { create: { name: 'Contato', email: 'c@local.test', isPrimary: true } },
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

  it('perfil da empresa: viewer recebe 403; comprador edita e gera AuditLog; threshold ignorado', async () => {
    const denied = await request(app)
      .put('/api/v1/company-profile')
      .set('Cookie', cookies.viewer)
      .send({ companyName: 'Hack' });
    expect(denied.status).toBe(403);

    const before = await prisma.auditLog.count({ where: { entityType: 'company_profile' } });
    const previousName = (await prisma.companyProfile.findUnique({ where: { id: 1 } })).companyName;
    const ok = await request(app)
      .put('/api/v1/company-profile')
      .set('Cookie', cookies.comprador)
      .send({ companyName: 'Empresa editada', awardApprovalThreshold: 5000 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.companyName).toBe('Empresa editada');
    expect(ok.body.awardApprovalThreshold ?? null).toBeNull();

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'company_profile' },
      orderBy: { id: 'desc' },
    });
    expect(logs.length).toBe(before + 1);
    expect(logs[0].action).toBe('update');
    expect((logs[0].afterData as any).companyName).toBe('Empresa editada');
    expect((logs[0].beforeData as any).companyName).toBe(previousName);

    const viewerRead = await request(app).get('/api/v1/company-profile').set('Cookie', cookies.viewer);
    expect(viewerRead.status).toBe(200);
  });

  it('gerar novo link: anterior deixa de abrir no portal e o novo abre', async () => {
    const quote = await prisma.quoteRequest.create({
      data: {
        requestCode: `REGEN-${Date.now()}`,
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
    const oldRaw: string = created.body.tokens[0].token.token;
    const oldId: number = created.body.tokens[0].token.id;
    expect((await request(app).get(`/api/portal/${oldRaw}`)).status).toBe(200);

    const listed = await request(app)
      .get(`/api/v1/quote-requests/${quote.id}/portal-tokens`)
      .set('Cookie', cookies.comprador);
    expect(listed.status).toBe(200);
    expect(Object.keys(listed.body[0])).not.toContain('token');

    const regen = await request(app)
      .post(`/api/v1/portal-tokens/${oldId}/regenerate`)
      .set('Cookie', cookies.comprador)
      .send({});
    expect(regen.status, JSON.stringify(regen.body)).toBe(201);
    const newRaw = new URL(regen.body.portalUrl).searchParams.get('token') as string;
    expect(newRaw).not.toBe(oldRaw);

    expect((await request(app).get(`/api/portal/${oldRaw}`)).status).toBe(404);
    expect((await request(app).get(`/api/portal/${newRaw}`)).status).toBe(200);

    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'supplier_portal_token', action: { in: ['revoke', 'generate'] } },
    });
    expect(audits.some((a: any) => a.action === 'revoke' && a.entityId === String(oldId))).toBe(true);
    expect(audits.some((a: any) => a.action === 'generate' && a.entityId === String(regen.body.id))).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(newRaw);
  });

  it('logout com refresh no body invalida a sessao: refresh seguinte retorna 401', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'comprador.vault1@local.test', password: 'Test12345!' });
    expect(login.status).toBe(200);
    const refreshToken = cookieValue(login.headers['set-cookie'], 'intelliquote_refresh_token');

    const logout = await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    expect(logout.status).toBe(204);

    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(refreshed.status).toBe(401);
  });
});
