import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const tx = {
    creditPartner: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    creditPartnerContact: {
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
    creditPartner: { findMany: vi.fn() },
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
  creditPartner: { findMany: Mock };
  __tx: {
    creditPartner: { findFirst: Mock; create: Mock; update: Mock };
    creditPartnerContact: { deleteMany: Mock; update: Mock; create: Mock };
    auditLog: { create: Mock };
  };
};

const now = new Date('2026-10-07T12:00:00.000Z');

function partnerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    name: 'Banco Alfa',
    taxId: null,
    website: null,
    country: 'BR',
    notes: null,
    isActive: true,
    createdById: 7,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    contacts: [
      {
        id: 11,
        creditPartnerId: 5,
        name: 'Ana',
        email: 'ana@alfa.com',
        phone: null,
        position: null,
        isPrimary: true,
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
  const cookie = ((res.headers['set-cookie'] as string[]) ?? []).map((c) => c.split(';')[0]).join('; ');
  cookieCache.set(role, cookie);
  return cookie;
}

const validBody = {
  name: 'Banco Alfa',
  country: 'BR',
  contacts: [{ name: 'Ana', email: 'Ana@Alfa.com' }],
};

describe('/api/v1/credit-partners', () => {
  const tx = prismaMock.__tx;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.creditPartner.findFirst.mockResolvedValue(null);
    tx.creditPartner.create.mockResolvedValue(partnerRow());
    tx.creditPartner.update.mockResolvedValue(partnerRow());
    tx.creditPartnerContact.deleteMany.mockResolvedValue({ count: 0 });
    tx.creditPartnerContact.update.mockResolvedValue({});
    tx.creditPartnerContact.create.mockResolvedValue({});
    tx.auditLog.create.mockResolvedValue({});
    prismaMock.creditPartner.findMany.mockResolvedValue([partnerRow()]);
  });

  it('sem autenticacao retorna 401', async () => {
    const res = await request(app).get('/api/v1/credit-partners');
    expect(res.status).toBe(401);
  });

  it('viewer lista (200) com shape publico, mas nao escreve (403)', async () => {
    const cookie = await loginAs('viewer');

    const list = await request(app).get('/api/v1/credit-partners').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty('createdById');
    expect(list.body[0]).not.toHaveProperty('deletedAt');
    expect(list.body[0].contacts[0]).toEqual({
      id: 11,
      name: 'Ana',
      email: 'ana@alfa.com',
      phone: null,
      position: null,
      isPrimary: true,
    });
    const findManyArgs = prismaMock.creditPartner.findMany.mock.calls[0][0];
    expect(findManyArgs.where).toEqual({ deletedAt: null });
    expect(findManyArgs.orderBy).toEqual({ name: 'asc' });

    const post = await request(app).post('/api/v1/credit-partners').set('Cookie', cookie).send(validBody);
    const put = await request(app).put('/api/v1/credit-partners/5').set('Cookie', cookie).send({ notes: 'x' });
    const del = await request(app).delete('/api/v1/credit-partners/5').set('Cookie', cookie);
    expect([post.status, put.status, del.status]).toEqual([403, 403, 403]);
    expect(tx.creditPartner.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('GET ?active=true filtra isActive e active invalido retorna 400', async () => {
    const cookie = await loginAs('comprador');

    const ok = await request(app).get('/api/v1/credit-partners?active=true').set('Cookie', cookie);
    expect(ok.status).toBe(200);
    expect(prismaMock.creditPartner.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      isActive: true,
    });

    const bad = await request(app).get('/api/v1/credit-partners?active=talvez').set('Cookie', cookie);
    expect(bad.status).toBe(400);
  });

  it('comprador le (200) mas nao escreve (403): cadastro e so admin/gestor', async () => {
    const cookie = await loginAs('comprador');

    const list = await request(app).get('/api/v1/credit-partners').set('Cookie', cookie);
    const post = await request(app).post('/api/v1/credit-partners').set('Cookie', cookie).send(validBody);
    const put = await request(app).put('/api/v1/credit-partners/5').set('Cookie', cookie).send({ notes: 'x' });
    const del = await request(app).delete('/api/v1/credit-partners/5').set('Cookie', cookie);

    expect(list.status).toBe(200);
    expect([post.status, put.status, del.status]).toEqual([403, 403, 403]);
    expect(tx.creditPartner.create).not.toHaveBeenCalled();
    expect(tx.creditPartner.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('gestor escreve (201)', async () => {
    const cookie = await loginAs('gestor');

    const res = await request(app).post('/api/v1/credit-partners').set('Cookie', cookie).send(validBody);

    expect(res.status).toBe(201);
  });

  it.each([
    ['website sem protocolo', { website: 'www.banco.com' }],
    ['website javascript:', { website: 'javascript:alert(1)' }],
    ['website data:', { website: 'data:text/html,<script>1</script>' }],
    ['website ftp:', { website: 'ftp://banco.com' }],
    ['website acima de 300', { website: `https://banco.com/${'a'.repeat(300)}` }],
    ['taxId acima de 40', { taxId: 'x'.repeat(41) }],
    ['country acima de 80', { country: 'x'.repeat(81) }],
    ['notes acima de 2000', { notes: 'x'.repeat(2001) }],
    ['phone acima de 40', { contacts: [{ name: 'Ana', email: 'ana@alfa.com', phone: '1'.repeat(41) }] }],
    ['position acima de 120', { contacts: [{ name: 'Ana', email: 'ana@alfa.com', position: 'x'.repeat(121) }] }],
  ])('POST com %s retorna 400 sem gravar', async (_label, extra) => {
    const cookie = await loginAs('admin');

    const res = await request(app)
      .post('/api/v1/credit-partners')
      .set('Cookie', cookie)
      .send({ ...validBody, ...extra });

    expect(res.status).toBe(400);
    expect(tx.creditPartner.create).not.toHaveBeenCalled();
  });

  it('PUT com website javascript: retorna 400 e website https valido e aceito', async () => {
    const cookie = await loginAs('admin');
    tx.creditPartner.findFirst.mockResolvedValue(partnerRow());

    const bad = await request(app)
      .put('/api/v1/credit-partners/5')
      .set('Cookie', cookie)
      .send({ website: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    expect(tx.creditPartner.update).not.toHaveBeenCalled();

    const ok = await request(app)
      .put('/api/v1/credit-partners/5')
      .set('Cookie', cookie)
      .send({ website: 'https://banco.com' });
    expect(ok.status).toBe(200);
    expect(tx.creditPartner.update.mock.calls[0][0].data).toEqual({ website: 'https://banco.com' });
  });

  it.each([
    ['sem name', { ...validBody, name: '' }],
    ['e-mail invalido', { ...validBody, contacts: [{ name: 'Ana', email: 'nao-e-email' }] }],
    ['contacts vazio', { ...validBody, contacts: [] }],
    [
      '2 contatos principais',
      {
        ...validBody,
        contacts: [
          { name: 'Ana', email: 'ana@alfa.com', isPrimary: true },
          { name: 'Beto', email: 'beto@alfa.com', isPrimary: true },
        ],
      },
    ],
    [
      'e-mail duplicado',
      {
        ...validBody,
        contacts: [
          { name: 'Ana', email: 'ana@alfa.com' },
          { name: 'Ana 2', email: 'ANA@alfa.com' },
        ],
      },
    ],
  ])('POST %s retorna 400 sem gravar', async (_label, body) => {
    const cookie = await loginAs('admin');

    const res = await request(app).post('/api/v1/credit-partners').set('Cookie', cookie).send(body);

    expect(res.status).toBe(400);
    expect(tx.creditPartner.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('POST valido retorna 201, 1o contato vira principal e grava AuditLog no tx', async () => {
    const cookie = await loginAs('admin');

    const res = await request(app).post('/api/v1/credit-partners').set('Cookie', cookie).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(5);
    const createArgs = tx.creditPartner.create.mock.calls[0][0];
    expect(createArgs.data.createdById).toBe(7);
    expect(createArgs.data.contacts.create).toEqual([
      { name: 'Ana', email: 'ana@alfa.com', phone: null, position: null, isPrimary: true },
    ]);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entityType: 'credit_partner',
      entityId: '5',
      action: 'create',
      performedById: 7,
    });
  });

  it('POST com nome duplicado (case-insensitive) retorna 409', async () => {
    const cookie = await loginAs('gestor');
    tx.creditPartner.findFirst.mockResolvedValue({ id: 9 });

    const res = await request(app)
      .post('/api/v1/credit-partners')
      .set('Cookie', cookie)
      .send({ ...validBody, name: 'banco alfa' });

    expect(res.status).toBe(409);
    expect(tx.creditPartner.findFirst.mock.calls[0][0].where).toMatchObject({
      deletedAt: null,
      name: { equals: 'banco alfa', mode: 'insensitive' },
    });
    expect(tx.creditPartner.create).not.toHaveBeenCalled();
    // Lock por nome normalizado ANTES do check (serializa POST/PUT concorrentes).
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [sqlParts, lockKey] = tx.$executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sqlParts.join('?')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(lockKey).toBe('credit_partner:banco alfa');
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.creditPartner.findFirst.mock.invocationCallOrder[0] as number,
    );
  });

  it('PUT sincroniza contatos (update/create/delete) e grava AuditLog update', async () => {
    const cookie = await loginAs('admin');
    tx.creditPartner.findFirst.mockResolvedValue(
      partnerRow({
        contacts: [
          { id: 11, name: 'Ana', email: 'ana@alfa.com', phone: null, position: null, isPrimary: true },
          { id: 12, name: 'Beto', email: 'beto@alfa.com', phone: null, position: null, isPrimary: false },
        ],
      }),
    );

    const res = await request(app)
      .put('/api/v1/credit-partners/5')
      .set('Cookie', cookie)
      .send({
        notes: 'Atualizado',
        contacts: [
          { id: 11, name: 'Ana Maria', email: 'ana@alfa.com', isPrimary: true },
          { name: 'Caio', email: 'caio@alfa.com' },
        ],
      });

    expect(res.status).toBe(200);
    expect(tx.creditPartnerContact.deleteMany.mock.calls[0][0].where).toEqual({
      creditPartnerId: 5,
      id: { notIn: [11] },
    });
    expect(tx.creditPartnerContact.update).toHaveBeenCalledTimes(1);
    expect(tx.creditPartnerContact.update.mock.calls[0][0].where).toEqual({ id: 11 });
    expect(tx.creditPartnerContact.create).toHaveBeenCalledTimes(1);
    expect(tx.creditPartnerContact.create.mock.calls[0][0].data).toMatchObject({
      creditPartnerId: 5,
      email: 'caio@alfa.com',
      isPrimary: false,
    });
    expect(tx.creditPartner.update.mock.calls[0][0].data).toEqual({ notes: 'Atualizado' });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entityType: 'credit_partner',
      entityId: '5',
      action: 'update',
    });
  });

  it('PUT com id de contato de outro parceiro retorna 400', async () => {
    const cookie = await loginAs('admin');
    tx.creditPartner.findFirst.mockResolvedValue(partnerRow());

    const res = await request(app)
      .put('/api/v1/credit-partners/5')
      .set('Cookie', cookie)
      .send({ contacts: [{ id: 999, name: 'Intruso', email: 'x@y.com' }] });

    expect(res.status).toBe(400);
    expect(tx.creditPartnerContact.deleteMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('PUT em parceiro inexistente/excluido retorna 404', async () => {
    const cookie = await loginAs('admin');

    const res = await request(app)
      .put('/api/v1/credit-partners/5')
      .set('Cookie', cookie)
      .send({ notes: 'x' });

    expect(res.status).toBe(404);
    expect(tx.creditPartner.findFirst.mock.calls[0][0].where).toEqual({ id: 5, deletedAt: null });
  });

  it('DELETE faz soft-delete (deletedAt + isActive=false) e grava AuditLog delete', async () => {
    const cookie = await loginAs('admin');
    tx.creditPartner.findFirst.mockResolvedValue(partnerRow());
    tx.creditPartner.update.mockResolvedValue(
      partnerRow({ isActive: false, deletedAt: new Date() }),
    );

    const res = await request(app).delete('/api/v1/credit-partners/5').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 5 });
    const updateArgs = tx.creditPartner.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 5 });
    expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.isActive).toBe(false);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entityType: 'credit_partner',
      entityId: '5',
      action: 'delete',
    });
  });

  it('DELETE em parceiro ja excluido/inexistente retorna 404', async () => {
    const cookie = await loginAs('admin');

    const res = await request(app).delete('/api/v1/credit-partners/5').set('Cookie', cookie);

    expect(res.status).toBe(404);
    expect(tx.creditPartner.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
