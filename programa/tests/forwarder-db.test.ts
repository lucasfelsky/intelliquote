import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `forwarder-db-${Date.now()}`;

describe('ForwarderController (DB)', () => {
  let adminCookies: string[] = [];
  let adminId: number;
  const forwarderIds: number[] = [];

  async function createForwarder(
    name: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ status: number; body: { id: number; isDefault: boolean } }> {
    const res = await request(app)
      .post('/api/v1/forwarders')
      .set('Cookie', adminCookies)
      .send({
        companyName: name,
        contacts: [{ name: 'Contato', email: `${name.replace(/\W/g, '').toLowerCase()}@fw.test` }],
        ...extra,
      });
    if (res.status === 201) forwarderIds.push(res.body.id);
    return res;
  }

  async function defaultCount(): Promise<number> {
    // Escopo do teste: so os forwarders criados aqui (a base local pode ter outros).
    return prisma.forwarder.count({
      where: { id: { in: forwarderIds }, isDefault: true, deletedAt: null },
    });
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: { name: 'admin' },
    });

    const user = await prisma.user.create({
      data: {
        name: `Admin Forwarder Test ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;

    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: user.email,
      password: 'Test1234!',
    });
    adminCookies = loginRes.headers['set-cookie'];
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: 'forwarder', entityId: { in: forwarderIds.map(String) } },
          { performedById: adminId },
        ],
      },
    });
    // Contatos saem em cascata junto com o forwarder.
    await prisma.forwarder.deleteMany({ where: { id: { in: forwarderIds } } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('ciclo completo: padrao unico, inativar, excluir, filtrar e auditar', async () => {
    // Estado limpo: nenhum padrao pre-existente atrapalha as contagens globais.
    await prisma.forwarder.updateMany({ where: { isDefault: true }, data: { isDefault: false } });

    const a = await createForwarder(`Alfa ${runId}`, { isDefault: true });
    expect(a.status).toBe(201);
    expect(a.body.isDefault).toBe(true);
    const b = await createForwarder(`Beta ${runId}`);
    expect(b.status).toBe(201);
    expect(b.body.isDefault).toBe(false);

    // Nome duplicado (case-insensitive) -> 409.
    const duplicate = await createForwarder(`BETA ${runId}`.toUpperCase());
    expect(duplicate.status).toBe(409);

    // PUT B isDefault -> A deixa de ser padrao.
    const makeB = await request(app)
      .put(`/api/v1/forwarders/${b.body.id}`)
      .set('Cookie', adminCookies)
      .send({ isDefault: true });
    expect(makeB.status).toBe(200);
    expect(makeB.body.isDefault).toBe(true);
    expect((await prisma.forwarder.findUnique({ where: { id: a.body.id } }))?.isDefault).toBe(false);
    expect(await defaultCount()).toBe(1);

    // Inativar o padrao -> nenhum padrao.
    const inactivate = await request(app)
      .put(`/api/v1/forwarders/${b.body.id}`)
      .set('Cookie', adminCookies)
      .send({ isActive: false });
    expect(inactivate.status).toBe(200);
    expect(inactivate.body.isActive).toBe(false);
    expect(inactivate.body.isDefault).toBe(false);
    expect(await defaultCount()).toBe(0);

    // Inativo nao pode virar padrao.
    const inactiveDefault = await request(app)
      .put(`/api/v1/forwarders/${b.body.id}`)
      .set('Cookie', adminCookies)
      .send({ isDefault: true });
    expect(inactiveDefault.status).toBe(400);

    // Contatos: mantem 1, adiciona 1; contato de outro forwarder -> 400.
    const current = await request(app)
      .get('/api/v1/forwarders')
      .set('Cookie', adminCookies);
    const aRow = current.body.find((f: { id: number }) => f.id === a.body.id);
    const bRow = current.body.find((f: { id: number }) => f.id === b.body.id);
    const foreign = await request(app)
      .put(`/api/v1/forwarders/${a.body.id}`)
      .set('Cookie', adminCookies)
      .send({ contacts: [{ id: bRow.contacts[0].id, name: 'Fantasma' }] });
    expect(foreign.status).toBe(400);
    const edited = await request(app)
      .put(`/api/v1/forwarders/${a.body.id}`)
      .set('Cookie', adminCookies)
      .send({
        contacts: [
          { id: aRow.contacts[0].id, name: 'Contato 2', email: null },
          { name: 'Novo', phone: '+55 11 9999' },
        ],
      });
    expect(edited.status).toBe(200);
    expect(edited.body.contacts).toHaveLength(2);
    expect(edited.body.contacts[0]).toMatchObject({ id: aRow.contacts[0].id, name: 'Contato 2', email: null });

    // ?active=true nao lista inativo; excluido some de qualquer lista.
    const activeList = await request(app)
      .get('/api/v1/forwarders?active=true')
      .set('Cookie', adminCookies);
    expect(activeList.body.some((f: { id: number }) => f.id === a.body.id)).toBe(true);
    expect(activeList.body.some((f: { id: number }) => f.id === b.body.id)).toBe(false);

    const removed = await request(app)
      .delete(`/api/v1/forwarders/${a.body.id}`)
      .set('Cookie', adminCookies);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ id: a.body.id });

    const listAfter = await request(app).get('/api/v1/forwarders').set('Cookie', adminCookies);
    expect(listAfter.body.some((f: { id: number }) => f.id === a.body.id)).toBe(false);
    const row = await prisma.forwarder.findUnique({ where: { id: a.body.id } });
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.isActive).toBe(false);
    expect(row?.isDefault).toBe(false);

    const again = await request(app)
      .delete(`/api/v1/forwarders/${a.body.id}`)
      .set('Cookie', adminCookies);
    expect(again.status).toBe(404);

    // Nome de excluido fica livre para reuso.
    const reuse = await createForwarder(`Alfa ${runId}`);
    expect(reuse.status).toBe(201);

    // Auditoria de A: create, unset_default (B virou padrao), update x2, delete.
    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'forwarder', entityId: String(a.body.id) },
      orderBy: { id: 'asc' },
    });
    const actions = logs.map((log) => log.action);
    expect(actions[0]).toBe('create');
    expect(actions).toContain('unset_default');
    expect(actions[actions.length - 1]).toBe('delete');
    expect(logs.every((log) => log.performedById === adminId)).toBe(true);
  });

  testDbSkip('concorrencia: PUTs simultaneos de isDefault deixam no maximo 1 padrao', async () => {
    await prisma.forwarder.updateMany({ where: { isDefault: true }, data: { isDefault: false } });

    const ids: number[] = [];
    for (const label of ['C1', 'C2', 'C3']) {
      const created = await createForwarder(`${label} ${runId}`);
      expect(created.status).toBe(201);
      ids.push(created.body.id);
    }

    for (let round = 0; round < 5; round += 1) {
      const results = await Promise.all(
        ids.map((id) =>
          request(app)
            .put(`/api/v1/forwarders/${id}`)
            .set('Cookie', adminCookies)
            .send({ isDefault: true }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      const count = await prisma.forwarder.count({ where: { isDefault: true, deletedAt: null } });
      expect(count).toBe(1);
    }
  });

  testDbSkip('concorrencia de nome: 2 POST com o mesmo nome (caixa diferente) -> 201 e 409', async () => {
    const results = await Promise.all([
      createForwarder(`Dup ${runId}`),
      createForwarder(`DUP ${runId}`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});
