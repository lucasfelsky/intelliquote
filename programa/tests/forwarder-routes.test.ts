import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const tx = {
    forwarder: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    forwarderContact: {
      deleteMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
  };
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    forwarder: { findMany: vi.fn() },
    supplier: {},
    quoteRequest: {},
    quoteResponse: {},
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    __tx: tx,
  };
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Mock = ReturnType<typeof vi.fn>;

const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
  forwarder: { findMany: Mock };
  __tx: {
    forwarder: {
      findFirst: Mock;
      findMany: Mock;
      create: Mock;
      update: Mock;
      updateMany: Mock;
    };
    forwarderContact: { deleteMany: Mock; update: Mock; create: Mock };
    auditLog: { create: Mock };
    $executeRaw: Mock;
  };
};

const now = new Date('2026-10-08T12:00:00.000Z');

function forwarderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    companyName: 'Global Cargo',
    address: 'Rua A, 10',
    website: null,
    notes: null,
    isActive: true,
    isDefault: false,
    createdById: 7,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    contacts: [
      {
        id: 11,
        forwarderId: 5,
        name: 'Maria',
        email: 'maria@global.com',
        phone: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...overrides,
  };
}

// O login tem rate limit: faz 1 login real por papel e reaproveita o cookie nos demais testes.
const cookieCache = new Map<string, string>();

async function loginAs(role: string): Promise<string> {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 7,
    name: role,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  };
  prismaMock.user.findUnique.mockResolvedValue(user);
  prismaMock.user.findFirst.mockResolvedValue(user);
  prismaMock.session.create.mockImplementation(({ data }: { data: { id: string } }) =>
    Promise.resolve({ id: data.id }),
  );
  const cached = cookieCache.get(role);
  if (cached) return cached;
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'ChangeMe123!' });
  if (res.status !== 200) throw new Error(`login ${role} falhou: ${res.status}`);
  const cookie = ((res.headers['set-cookie'] as string[]) ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  cookieCache.set(role, cookie);
  return cookie;
}

const validBody = {
  companyName: 'Global Cargo',
  address: 'Rua A, 10',
  contacts: [{ name: 'Maria', email: 'Maria@Global.com' }],
};

describe('/api/v1/forwarders', () => {
  const tx = prismaMock.__tx;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.forwarder.findFirst.mockResolvedValue(null);
    tx.forwarder.findMany.mockResolvedValue([]);
    tx.forwarder.create.mockResolvedValue(forwarderRow());
    tx.forwarder.update.mockResolvedValue(forwarderRow());
    tx.forwarder.updateMany.mockResolvedValue({ count: 0 });
    tx.forwarderContact.deleteMany.mockResolvedValue({ count: 0 });
    tx.forwarderContact.update.mockResolvedValue({});
    tx.forwarderContact.create.mockResolvedValue({});
    tx.auditLog.create.mockResolvedValue({});
    prismaMock.forwarder.findMany.mockResolvedValue([forwarderRow()]);
  });

  it('sem autenticacao retorna 401', async () => {
    const res = await request(app).get('/api/v1/forwarders');
    expect(res.status).toBe(401);
  });

  it.each(['viewer', 'gestor'])(
    '%s lista (200) com shape publico, mas nao escreve (403)',
    async (role) => {
      const cookie = await loginAs(role);

      const list = await request(app).get('/api/v1/forwarders').set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).not.toHaveProperty('createdById');
      expect(list.body[0]).not.toHaveProperty('deletedAt');
      expect(list.body[0].contacts[0]).toEqual({
        id: 11,
        name: 'Maria',
        email: 'maria@global.com',
        phone: null,
      });
      const findManyArgs = prismaMock.forwarder.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({ deletedAt: null });
      expect(findManyArgs.orderBy).toEqual([{ isDefault: 'desc' }, { companyName: 'asc' }]);

      const post = await request(app).post('/api/v1/forwarders').set('Cookie', cookie).send(validBody);
      const put = await request(app)
        .put('/api/v1/forwarders/5')
        .set('Cookie', cookie)
        .send({ notes: 'x' });
      const del = await request(app).delete('/api/v1/forwarders/5').set('Cookie', cookie);
      expect([post.status, put.status, del.status]).toEqual([403, 403, 403]);
      expect(tx.forwarder.create).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('GET ?active=true filtra isActive e active invalido retorna 400', async () => {
    const cookie = await loginAs('comprador');

    const ok = await request(app).get('/api/v1/forwarders?active=true').set('Cookie', cookie);
    expect(ok.status).toBe(200);
    expect(prismaMock.forwarder.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      isActive: true,
    });

    const bad = await request(app).get('/api/v1/forwarders?active=talvez').set('Cookie', cookie);
    expect(bad.status).toBe(400);
  });

  it.each(['comprador', 'admin'])('%s escreve (201/200/200)', async (role) => {
    const cookie = await loginAs(role);
    tx.forwarder.findFirst.mockResolvedValue(null);

    const post = await request(app).post('/api/v1/forwarders').set('Cookie', cookie).send(validBody);
    expect(post.status).toBe(201);

    tx.forwarder.findFirst.mockResolvedValue(forwarderRow());
    const put = await request(app)
      .put('/api/v1/forwarders/5')
      .set('Cookie', cookie)
      .send({ notes: 'x' });
    expect(put.status).toBe(200);
    const del = await request(app).delete('/api/v1/forwarders/5').set('Cookie', cookie);
    expect(del.status).toBe(200);
  });

  it.each([
    ['companyName vazio', { companyName: '' }],
    ['companyName com 201 chars', { companyName: 'x'.repeat(201) }],
    ['address com 501 chars', { address: 'x'.repeat(501) }],
    ['notes com 2001 chars', { notes: 'x'.repeat(2001) }],
    ['website javascript:', { website: 'javascript:alert(1)' }],
    ['website ftp:', { website: 'ftp://x' }],
    ['contacts vazio', { contacts: [] }],
    [
      '21 contatos',
      {
        contacts: Array.from({ length: 21 }, (_, i) => ({ name: `C${i}`, email: `c${i}@x.com` })),
      },
    ],
    ['e-mail invalido', { contacts: [{ name: 'Ana', email: 'nao-e-email' }] }],
    [
      'e-mails duplicados',
      {
        contacts: [
          { name: 'Ana', email: 'ana@x.com' },
          { name: 'Ana 2', email: 'ANA@x.com' },
        ],
      },
    ],
    ['phone com 41 chars', { contacts: [{ name: 'Ana', phone: '1'.repeat(41) }] }],
    ['contato sem nome', { contacts: [{ name: '', email: 'ana@x.com' }] }],
    ['isDefault com isActive false', { isDefault: true, isActive: false }],
  ])('POST com %s retorna 400 sem gravar', async (_label, extra) => {
    const cookie = await loginAs('admin');

    const res = await request(app)
      .post('/api/v1/forwarders')
      .set('Cookie', cookie)
      .send({ ...validBody, ...extra });

    expect(res.status).toBe(400);
    expect(tx.forwarder.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('POST aceita website https, contato so com nome e e-mails vazios repetidos', async () => {
    const cookie = await loginAs('admin');

    const res = await request(app)
      .post('/api/v1/forwarders')
      .set('Cookie', cookie)
      .send({
        companyName: 'Global Cargo',
        website: 'https://x.com',
        contacts: [
          { name: 'Ana' },
          { name: 'Beto', email: '' },
          { name: 'Caio', email: 'caio@Global.com', phone: '+55 11 9999' },
        ],
      });

    expect(res.status).toBe(201);
    const createArgs = tx.forwarder.create.mock.calls[0][0];
    expect(createArgs.data.website).toBe('https://x.com');
    expect(createArgs.data.createdById).toBe(7);
    expect(createArgs.data.contacts.create).toEqual([
      { name: 'Ana', email: null, phone: null },
      { name: 'Beto', email: null, phone: null },
      { name: 'Caio', email: 'caio@global.com', phone: '+55 11 9999' },
    ]);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entityType: 'forwarder',
      entityId: '5',
      action: 'create',
      performedById: 7,
    });
  });

  it('POST com nome duplicado retorna 409; lock ANTES do check de nome', async () => {
    const cookie = await loginAs('admin');
    tx.forwarder.findFirst.mockResolvedValue({ id: 9 });

    const res = await request(app)
      .post('/api/v1/forwarders')
      .set('Cookie', cookie)
      .send({ ...validBody, companyName: 'global cargo' });

    expect(res.status).toBe(409);
    expect(tx.forwarder.findFirst.mock.calls[0][0].where).toMatchObject({
      deletedAt: null,
      companyName: { equals: 'global cargo', mode: 'insensitive' },
    });
    expect(tx.forwarder.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [sqlParts, lockKey] = tx.$executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sqlParts.join('?')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(lockKey).toBe('forwarder:write');
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.forwarder.findFirst.mock.invocationCallOrder[0] as number,
    );
  });

  it('POST com isDefault: lock antes do updateMany; zera o anterior e audita unset_default', async () => {
    const cookie = await loginAs('comprador');
    tx.forwarder.create.mockResolvedValue(forwarderRow({ id: 8, isDefault: true }));
    tx.forwarder.findMany.mockResolvedValue([{ id: 3 }]);

    const res = await request(app)
      .post('/api/v1/forwarders')
      .set('Cookie', cookie)
      .send({ ...validBody, isDefault: true });

    expect(res.status).toBe(201);
    expect(tx.forwarder.create.mock.calls[0][0].data.isDefault).toBe(true);
    expect(tx.forwarder.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.forwarder.updateMany.mock.calls[0][0]).toEqual({
      where: { isDefault: true, deletedAt: null, id: { not: 8 } },
      data: { isDefault: false },
    });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.forwarder.updateMany.mock.invocationCallOrder[0] as number,
    );
    const actions = tx.auditLog.create.mock.calls.map(
      (call) => (call[0] as { data: { action: string; entityId: string } }).data,
    );
    expect(actions).toContainEqual(
      expect.objectContaining({ action: 'unset_default', entityId: '3' }),
    );
    expect(actions).toContainEqual(expect.objectContaining({ action: 'create', entityId: '8' }));
  });

  it('POST sem isDefault nao mexe nos outros forwarders', async () => {
    const cookie = await loginAs('comprador');

    const res = await request(app).post('/api/v1/forwarders').set('Cookie', cookie).send(validBody);

    expect(res.status).toBe(201);
    expect(tx.forwarder.updateMany).not.toHaveBeenCalled();
  });

  it('PUT sincroniza contatos (update/create/delete) e grava AuditLog update', async () => {
    const cookie = await loginAs('admin');
    tx.forwarder.findFirst.mockResolvedValue(
      forwarderRow({
        contacts: [
          { id: 11, name: 'Maria', email: 'maria@global.com', phone: null },
          { id: 12, name: 'Beto', email: 'beto@global.com', phone: null },
        ],
      }),
    );

    const res = await request(app)
      .put('/api/v1/forwarders/5')
      .set('Cookie', cookie)
      .send({
        contacts: [
          { id: 11, name: 'Maria 2', email: 'maria@global.com' },
          { name: 'Novo', phone: '123' },
        ],
      });

    expect(res.status).toBe(200);
    expect(tx.forwarderContact.deleteMany.mock.calls[0][0]).toEqual({
      where: { forwarderId: 5, id: { notIn: [11] } },
    });
    expect(tx.forwarderContact.update.mock.calls[0][0]).toEqual({
      where: { id: 11 },
      data: { name: 'Maria 2', email: 'maria@global.com', phone: null },
    });
    expect(tx.forwarderContact.create.mock.calls[0][0]).toEqual({
      data: { name: 'Novo', email: null, phone: '123', forwarderId: 5 },
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entityType: 'forwarder',
      entityId: '5',
      action: 'update',
    });
  });

  it('PUT com contato de outro forwarder retorna 400 sem gravar', async () => {
    const cookie = await loginAs('admin');
    tx.forwarder.findFirst.mockResolvedValue(forwarderRow());

    const res = await request(app)
      .put('/api/v1/forwarders/5')
      .set('Cookie', cookie)
      .send({ contacts: [{ id: 99, name: 'Fantasma' }] });

    expect(res.status).toBe(400);
    expect(tx.forwarder.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('PUT isActive false num forwarder padrao grava isDefault false', async () => {
    const cookie = await loginAs('admin');
    tx.forwarder.findFirst.mockResolvedValue(forwarderRow({ isDefault: true }));

    const res = await request(app)
      .put('/api/v1/forwarders/5')
      .set('Cookie', cookie)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(tx.forwarder.update.mock.calls[0][0].data).toEqual({
      isActive: false,
      isDefault: false,
    });
    expect(tx.forwarder.updateMany).not.toHaveBeenCalled();
  });

  it('PUT isDefault true num forwarder inativo retorna 400', async () => {
    const cookie = await loginAs('admin');
    tx.forwarder.findFirst.mockResolvedValue(forwarderRow({ isActive: false }));

    const res = await request(app)
      .put('/api/v1/forwarders/5')
      .set('Cookie', cookie)
      .send({ isDefault: true });

    expect(res.status).toBe(400);
    expect(tx.forwarder.update).not.toHaveBeenCalled();
  });

  it('PUT isDefault true + isActive false no mesmo payload retorna 400 (Zod)', async () => {
    const cookie = await loginAs('admin');

    const res = await request(app)
      .put('/api/v1/forwarders/5')
      .set('Cookie', cookie)
      .send({ isDefault: true, isActive: false });

    expect(res.status).toBe(400);
    expect(tx.forwarder.update).not.toHaveBeenCalled();
  });

  it('PUT isDefault true zera o padrao anterior (lock primeiro) e audita unset_default', async () => {
    const cookie = await loginAs('admin');
    tx.forwarder.findFirst.mockResolvedValue(forwarderRow());
    tx.forwarder.findMany.mockResolvedValue([{ id: 3 }]);
    tx.forwarder.update.mockResolvedValue(forwarderRow({ isDefault: true }));

    const res = await request(app)
      .put('/api/v1/forwarders/5')
      .set('Cookie', cookie)
      .send({ isDefault: true });

    expect(res.status).toBe(200);
    expect(tx.forwarder.updateMany.mock.calls[0][0]).toEqual({
      where: { isDefault: true, deletedAt: null, id: { not: 5 } },
      data: { isDefault: false },
    });
    expect(tx.forwarder.update.mock.calls[0][0].data).toEqual({ isDefault: true });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.forwarder.updateMany.mock.invocationCallOrder[0] as number,
    );
    const actions = tx.auditLog.create.mock.calls.map(
      (call) => (call[0] as { data: { action: string; entityId: string } }).data,
    );
    expect(actions).toContainEqual(
      expect.objectContaining({ action: 'unset_default', entityId: '3' }),
    );
  });

  it('PUT com nome de outro forwarder retorna 409', async () => {
    const cookie = await loginAs('admin');
    tx.forwarder.findFirst
      .mockResolvedValueOnce(forwarderRow())
      .mockResolvedValueOnce({ id: 9 });

    const res = await request(app)
      .put('/api/v1/forwarders/5')
      .set('Cookie', cookie)
      .send({ companyName: 'Outra Empresa' });

    expect(res.status).toBe(409);
    expect(tx.forwarder.update).not.toHaveBeenCalled();
  });

  it('PUT e DELETE de forwarder inexistente/excluido retornam 404', async () => {
    const cookie = await loginAs('admin');
    tx.forwarder.findFirst.mockResolvedValue(null);

    const put = await request(app)
      .put('/api/v1/forwarders/5')
      .set('Cookie', cookie)
      .send({ notes: 'x' });
    const del = await request(app).delete('/api/v1/forwarders/5').set('Cookie', cookie);

    expect([put.status, del.status]).toEqual([404, 404]);
    expect(tx.forwarder.findFirst.mock.calls[0][0].where).toEqual({ id: 5, deletedAt: null });
    expect(tx.forwarder.update).not.toHaveBeenCalled();
  });

  it('DELETE faz soft-delete (deletedAt, isActive false, isDefault false) e audita delete', async () => {
    const cookie = await loginAs('comprador');
    tx.forwarder.findFirst.mockResolvedValue(forwarderRow({ isDefault: true }));
    tx.forwarder.update.mockResolvedValue(
      forwarderRow({ isActive: false, isDefault: false, deletedAt: now }),
    );

    const res = await request(app).delete('/api/v1/forwarders/5').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 5 });
    const data = tx.forwarder.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.isActive).toBe(false);
    expect(data.isDefault).toBe(false);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.forwarder.findFirst.mock.invocationCallOrder[0] as number,
    );
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entityType: 'forwarder',
      entityId: '5',
      action: 'delete',
      performedById: 7,
    });
  });
});
