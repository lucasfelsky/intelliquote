import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `credit-partner-db-${Date.now()}`;

describe('CreditPartnerController (DB)', () => {
  let adminCookies: string[] = [];
  let adminId: number;
  const partnerIds: number[] = [];

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: { name: 'admin' },
    });

    const user = await prisma.user.create({
      data: {
        name: `Admin Credit Partner Test ${runId}`,
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
          { entityType: 'credit_partner', entityId: { in: partnerIds.map(String) } },
          { performedById: adminId },
        ],
      },
    });
    // Contatos saem em cascata junto com o parceiro.
    await prisma.creditPartner.deleteMany({ where: { id: { in: partnerIds } } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('ciclo completo: cria, edita contatos, filtra ativos, exclui e audita', async () => {
    // 1) Cria com 2 contatos, nenhum marcado como principal -> o 1o vira principal.
    const created = await request(app)
      .post('/api/v1/credit-partners')
      .set('Cookie', adminCookies)
      .send({
        name: `Banco ${runId}`,
        country: 'BR',
        contacts: [
          { name: 'Contato A', email: `A.${runId}@banco.test` },
          { name: 'Contato B', email: `b.${runId}@banco.test` },
        ],
      });
    expect(created.status).toBe(201);
    const partnerId: number = created.body.id;
    partnerIds.push(partnerId);
    expect(created.body.isActive).toBe(true);
    expect(created.body.contacts).toHaveLength(2);
    const contactA = created.body.contacts.find((c: { name: string }) => c.name === 'Contato A');
    const contactB = created.body.contacts.find((c: { name: string }) => c.name === 'Contato B');
    expect(contactA.isPrimary).toBe(true);
    expect(contactB.isPrimary).toBe(false);
    expect(contactA.email).toBe(`a.${runId}@banco.test`);

    // Nome duplicado (case-insensitive) -> 409.
    const duplicate = await request(app)
      .post('/api/v1/credit-partners')
      .set('Cookie', adminCookies)
      .send({
        name: `BANCO ${runId}`.toUpperCase(),
        contacts: [{ name: 'X', email: `x.${runId}@banco.test` }],
      });
    expect(duplicate.status).toBe(409);

    // 2) PUT: mantem A (mesmo id), remove B, adiciona C.
    const updated = await request(app)
      .put(`/api/v1/credit-partners/${partnerId}`)
      .set('Cookie', adminCookies)
      .send({
        notes: 'Parceiro de teste',
        contacts: [
          { id: contactA.id, name: 'Contato A2', email: `a.${runId}@banco.test`, isPrimary: true },
          { name: 'Contato C', email: `c.${runId}@banco.test` },
        ],
      });
    expect(updated.status).toBe(200);
    expect(updated.body.notes).toBe('Parceiro de teste');
    expect(updated.body.contacts).toHaveLength(2);
    const keptA = updated.body.contacts.find((c: { id: number }) => c.id === contactA.id);
    expect(keptA?.name).toBe('Contato A2');
    expect(updated.body.contacts.some((c: { id: number }) => c.id === contactB.id)).toBe(false);
    expect(updated.body.contacts.some((c: { name: string }) => c.name === 'Contato C')).toBe(true);
    expect(await prisma.creditPartnerContact.findUnique({ where: { id: contactB.id } })).toBeNull();

    // 3) Contato de outro parceiro -> 400.
    const foreign = await request(app)
      .put(`/api/v1/credit-partners/${partnerId}`)
      .set('Cookie', adminCookies)
      .send({ contacts: [{ id: contactB.id, name: 'Fantasma', email: `f.${runId}@banco.test` }] });
    expect(foreign.status).toBe(400);

    // 4) Inativa -> ?active=true nao lista; ?active=false lista.
    const inactive = await request(app)
      .put(`/api/v1/credit-partners/${partnerId}`)
      .set('Cookie', adminCookies)
      .send({ isActive: false });
    expect(inactive.status).toBe(200);

    const activeList = await request(app)
      .get('/api/v1/credit-partners?active=true')
      .set('Cookie', adminCookies);
    expect(activeList.status).toBe(200);
    expect(activeList.body.some((p: { id: number }) => p.id === partnerId)).toBe(false);

    const inactiveList = await request(app)
      .get('/api/v1/credit-partners?active=false')
      .set('Cookie', adminCookies);
    expect(inactiveList.body.some((p: { id: number }) => p.id === partnerId)).toBe(true);

    // 5) DELETE: some do GET, linha continua no banco com deletedAt.
    const removed = await request(app)
      .delete(`/api/v1/credit-partners/${partnerId}`)
      .set('Cookie', adminCookies);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ id: partnerId });

    const listAfter = await request(app).get('/api/v1/credit-partners').set('Cookie', adminCookies);
    expect(listAfter.body.some((p: { id: number }) => p.id === partnerId)).toBe(false);

    const row = await prisma.creditPartner.findUnique({ where: { id: partnerId } });
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.isActive).toBe(false);

    const again = await request(app)
      .delete(`/api/v1/credit-partners/${partnerId}`)
      .set('Cookie', adminCookies);
    expect(again.status).toBe(404);

    // 6) Auditoria: create + update(s) + delete, todos entityType credit_partner.
    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'credit_partner', entityId: String(partnerId) },
      orderBy: { id: 'asc' },
    });
    const actions = logs.map((log) => log.action);
    expect(actions[0]).toBe('create');
    expect(actions[actions.length - 1]).toBe('delete');
    expect(actions.filter((a) => a === 'update')).toHaveLength(2);
    expect(logs.every((log) => log.performedById === adminId)).toBe(true);
  });
});
