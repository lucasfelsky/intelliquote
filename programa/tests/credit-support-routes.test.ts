import request from 'supertest';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';
import { hashToken } from '../src/utils/tokens';

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    quoteRequest: { findFirst: vi.fn() },
    quoteResponse: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    creditPartner: { findFirst: vi.fn(), findMany: vi.fn() },
    creditSupportRequest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    companyProfile: { findUnique: vi.fn(), create: vi.fn() },
    emailTemplate: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    supplier: {},
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma));
  return { prisma };
});

vi.mock('../src/mailer/MailerService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/mailer/MailerService')>();
  return { ...actual, sendAndLog: vi.fn(), getComexCcList: vi.fn() };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { getComexCcList, sendAndLog } from '../src/mailer/MailerService';

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
  quoteRequest: { findFirst: Mock };
  quoteResponse: { findFirst: Mock; findMany: Mock; findUnique: Mock };
  creditPartner: { findFirst: Mock; findMany: Mock };
  creditSupportRequest: {
    findFirst: Mock;
    findMany: Mock;
    findUnique: Mock;
    create: Mock;
    update: Mock;
    updateMany: Mock;
  };
  companyProfile: { findUnique: Mock };
  emailTemplate: { findUnique: Mock };
  auditLog: { create: Mock };
  $queryRaw: Mock;
};
const sendMock = sendAndLog as unknown as Mock;
const comexCcMock = getComexCcList as unknown as Mock;

const now = new Date('2026-10-09T12:00:00.000Z');
const future = new Date('2099-01-01T00:00:00.000Z');

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
  db.user.findUnique.mockResolvedValue(user);
  db.user.findFirst.mockResolvedValue(user);
  db.session.create.mockImplementation(({ data }: { data: { id: string } }) =>
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

function responseItem(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id: id * 10,
    quoteRequestItemId: id,
    unitPrice: new Prisma.Decimal('10.00'),
    quantity: 5,
    totalPrice: new Prisma.Decimal('50.00'),
    deletedAt: null,
    quoteRequestItem: {
      id,
      productName: `Produto ${id}`,
      itemCode: null,
      unit: 'KG',
      quantity: 5,
      deletedAt: null,
      catalogItem: null,
    },
    ...overrides,
  };
}

function responseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    quoteRequestId: 3,
    supplierId: 1,
    version: 1,
    currency: 'USD',
    offeredIncoterm: 'FOB',
    paymentTermsDays: 45,
    deletedAt: null,
    supplier: { id: 1, name: 'Forn Ltd', country: 'CN' },
    quoteRequest: { id: 3, requestCode: 'RFQ-3', status: 'open', deletedAt: null },
    items: [responseItem(1), responseItem(2)],
    ...overrides,
  };
}

function partnerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    name: 'Banco Alfa',
    isActive: true,
    deletedAt: null,
    contacts: [
      { id: 11, creditPartnerId: 5, name: 'Ana', email: 'ana@alfa.com', isPrimary: true },
      { id: 12, creditPartnerId: 5, name: 'Beto', email: 'beto@alfa.com', isPrimary: false },
    ],
    ...overrides,
  };
}

function storedRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    quoteRequestId: 3,
    quoteResponseId: 4,
    supplierId: 1,
    creditPartnerId: 5,
    creditPartnerContactId: 11,
    recipientEmails: '["ana@alfa.com","beto@alfa.com"]',
    emailSubject: 'Credit support request - RFQ-3 - Forn Ltd',
    emailMessage: null,
    tokenHash: 'a'.repeat(64),
    expiresAt: future,
    revokedAt: null,
    respondedAt: null,
    responseVersion: 0,
    sourceResponseVersion: 1,
    currency: 'USD',
    offeredIncoterm: 'FOB',
    originalPaymentTermsDays: 45,
    originalTotalPrice: new Prisma.Decimal('100.00'),
    originPort: null,
    partnerPaymentTermsDays: null,
    partnerValidityDays: null,
    partnerNotes: null,
    partnerTotalPrice: null,
    createdById: 7,
    createdAt: now,
    updatedAt: now,
    emailMessageNull: null,
    items: [
      {
        quoteRequestItemId: 1,
        position: 1,
        productName: 'Produto 1',
        itemCode: null,
        unit: 'KG',
        quantity: 5,
        isUnavailable: false,
        originPort: null,
        isDangerousGood: false,
        originalUnitPrice: new Prisma.Decimal('10.00'),
        originalTotalPrice: new Prisma.Decimal('50.00'),
        partnerUnitPrice: null,
        partnerTotalPrice: null,
      },
      {
        quoteRequestItemId: 2,
        position: 2,
        productName: 'Produto 2',
        itemCode: null,
        unit: 'KG',
        quantity: 5,
        isUnavailable: false,
        originPort: null,
        isDangerousGood: false,
        originalUnitPrice: new Prisma.Decimal('10.00'),
        originalTotalPrice: new Prisma.Decimal('50.00'),
        partnerUnitPrice: null,
        partnerTotalPrice: null,
      },
    ],
    supplier: { id: 1, name: 'Forn Ltd', country: 'CN' },
    creditPartner: { ...partnerRow() },
    createdBy: { id: 7, name: 'comprador' },
    quoteRequest: { id: 3, requestCode: 'RFQ-3', status: 'open', deletedAt: null },
    ...overrides,
  };
}

describe('Credit Support (rotas autenticadas)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comexCcMock.mockReturnValue([{ email: 'comex@sq.com', name: '' }]);
    sendMock.mockResolvedValue({ status: 'sent', providerMessageId: 'x' });
    db.$queryRaw.mockResolvedValue([]);
    db.auditLog.create.mockResolvedValue({});
    db.emailTemplate.findUnique.mockResolvedValue(null);
    db.companyProfile.findUnique.mockResolvedValue({
      id: 1,
      companyName: 'SQ Quimica',
      dispatchCc: '["Fin@SQ.com","comex@sq.com"]',
    });
    db.quoteResponse.findFirst.mockResolvedValue(responseRow());
    db.quoteResponse.findUnique.mockResolvedValue(responseRow());
    db.quoteResponse.findMany.mockResolvedValue([responseRow()]);
    db.quoteRequest.findFirst.mockResolvedValue({ id: 3 });
    db.creditPartner.findFirst.mockResolvedValue(partnerRow());
    db.creditPartner.findMany.mockResolvedValue([partnerRow()]);
    db.creditSupportRequest.findFirst.mockResolvedValue(null);
    db.creditSupportRequest.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        storedRequest({
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          recipientEmails: data.recipientEmails,
          emailMessage: data.emailMessage,
          emailSubject: data.emailSubject,
        }),
    );
    db.creditSupportRequest.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => storedRequest(data),
    );
    db.creditSupportRequest.updateMany.mockResolvedValue({ count: 1 });
    db.creditSupportRequest.findMany.mockResolvedValue([storedRequest()]);
    db.creditSupportRequest.findUnique.mockResolvedValue(storedRequest());
  });

  describe('autorizacao', () => {
    it('sem autenticacao retorna 401', async () => {
      const res = await request(app).post('/api/v1/quote-responses/4/credit-support').send({});
      expect(res.status).toBe(401);
      const list = await request(app).get('/api/v1/quote-requests/3/credit-support');
      expect(list.status).toBe(401);
    });

    it('viewer e gestor nao encaminham nem fazem preview (403); viewer lista (200)', async () => {
      for (const role of ['viewer', 'gestor']) {
        const cookie = await loginAs(role);
        const post = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
        const prev = await request(app)
          .post('/api/v1/quote-responses/4/credit-support/preview')
          .set('Cookie', cookie)
          .send({});
        expect([post.status, prev.status]).toEqual([403, 403]);
      }
      expect(db.creditSupportRequest.create).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();

      const viewer = await loginAs('viewer');
      const list = await request(app).get('/api/v1/quote-requests/3/credit-support').set('Cookie', viewer);
      expect(list.status).toBe(200);
    });

    it('viewer nao revoga nem reenvia (403); gestor pode (revoke 200 / resend 201)', async () => {
      const viewer = await loginAs('viewer');
      const vRevoke = await request(app).post('/api/v1/credit-support-requests/9/revoke').set('Cookie', viewer);
      const vResend = await request(app).post('/api/v1/credit-support-requests/9/resend').set('Cookie', viewer).send({});
      expect([vRevoke.status, vResend.status]).toEqual([403, 403]);

      const gestor = await loginAs('gestor');
      const gRevoke = await request(app).post('/api/v1/credit-support-requests/9/revoke').set('Cookie', gestor);
      const gResend = await request(app).post('/api/v1/credit-support-requests/9/resend').set('Cookie', gestor).send({});
      expect(gRevoke.status).toBe(200);
      expect(gResend.status).toBe(201);
    });
  });

  describe('validacao Zod', () => {
    it('ttlDays 61, contactIds vazio e repetido -> 400', async () => {
      const cookie = await loginAs('comprador');
      const ttl = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({ ttlDays: 61 });
      const empty = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({ contactIds: [] });
      const dup = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({ contactIds: [11, 11] });
      const resend = await request(app).post('/api/v1/credit-support-requests/9/resend').set('Cookie', cookie).send({ ttlDays: 0 });
      expect([ttl.status, empty.status, dup.status, resend.status]).toEqual([400, 400, 400, 400]);
      expect(db.creditSupportRequest.create).not.toHaveBeenCalled();
    });

    it('ids invalidos -> 400', async () => {
      const cookie = await loginAs('comprador');
      const res = await request(app).post('/api/v1/quote-responses/abc/credit-support').set('Cookie', cookie).send({});
      expect(res.status).toBe(400);
    });
  });

  describe('encaminhar - regras', () => {
    it('cotacao fechada -> 409', async () => {
      const cookie = await loginAs('comprador');
      db.quoteResponse.findFirst.mockResolvedValue(
        responseRow({ quoteRequest: { id: 3, requestCode: 'RFQ-3', status: 'closed', deletedAt: null } }),
      );
      const res = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/fechada/i);
      expect(db.creditSupportRequest.create).not.toHaveBeenCalled();
    });

    it('resposta inexistente/excluida e cotacao excluida -> 404', async () => {
      const cookie = await loginAs('comprador');
      db.quoteResponse.findFirst.mockResolvedValue(null);
      const missing = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(missing.status).toBe(404);

      db.quoteResponse.findFirst.mockResolvedValue(
        responseRow({ quoteRequest: { id: 3, requestCode: 'RFQ-3', status: 'open', deletedAt: now } }),
      );
      const deleted = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(deleted.status).toBe(404);
    });

    it('resposta sem itens -> 400; todos indisponiveis -> 400', async () => {
      const cookie = await loginAs('comprador');
      db.quoteResponse.findFirst.mockResolvedValue(responseRow({ items: [] }));
      const none = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(none.status).toBe(400);

      db.quoteResponse.findFirst.mockResolvedValue(
        responseRow({
          items: [
            responseItem(1, { isUnavailable: true, unitPrice: new Prisma.Decimal(0), quantity: 0, totalPrice: new Prisma.Decimal(0) }),
          ],
        }),
      );
      const all = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(all.status).toBe(400);
      expect(db.creditSupportRequest.create).not.toHaveBeenCalled();
    });

    it('parceiro inativo -> 400; excluido/inexistente -> 404', async () => {
      const cookie = await loginAs('comprador');
      db.creditPartner.findFirst.mockResolvedValue(partnerRow({ isActive: false }));
      const inactive = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({ creditPartnerId: 5 });
      expect(inactive.status).toBe(400);

      db.creditPartner.findFirst.mockResolvedValue(null);
      const gone = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({ creditPartnerId: 5 });
      expect(gone.status).toBe(404);
      expect(db.creditPartner.findFirst.mock.calls[0][0].where).toEqual({ id: 5, deletedAt: null });
    });

    it('contato de outro parceiro -> 400; parceiro sem contato -> 400', async () => {
      const cookie = await loginAs('comprador');
      const other = await request(app)
        .post('/api/v1/quote-responses/4/credit-support')
        .set('Cookie', cookie)
        .send({ creditPartnerId: 5, contactIds: [999] });
      expect(other.status).toBe(400);

      db.creditPartner.findFirst.mockResolvedValue(partnerRow({ contacts: [] }));
      const none = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({ creditPartnerId: 5 });
      expect(none.status).toBe(400);
    });

    it('D11: parceiro omitido com 1 ativo usa ele; com 0 ou 2 ativos -> 400', async () => {
      const cookie = await loginAs('comprador');
      const one = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(one.status).toBe(201);
      expect(db.creditSupportRequest.create.mock.calls[0][0].data.creditPartnerId).toBe(5);

      db.creditPartner.findMany.mockResolvedValue([partnerRow(), partnerRow({ id: 6 })]);
      const two = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(two.status).toBe(400);
      expect(two.body.message).toMatch(/Selecione o parceiro/);

      db.creditPartner.findMany.mockResolvedValue([]);
      const zero = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(zero.status).toBe(400);
    });

    it('encaminhamento ativo duplicado -> 409 (consulta so ativos: revokedAt null e expiresAt futuro)', async () => {
      const cookie = await loginAs('comprador');
      db.creditSupportRequest.findFirst.mockResolvedValue({ id: 1 });
      const res = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(res.status).toBe(409);
      const where = db.creditSupportRequest.findFirst.mock.calls[0][0].where;
      expect(where).toMatchObject({ quoteResponseId: 4, creditPartnerId: 5, revokedAt: null });
      expect(where.expiresAt.gt).toBeInstanceOf(Date);
      expect(db.creditSupportRequest.create).not.toHaveBeenCalled();
    });

    it('trava a cotacao (FOR NO KEY UPDATE) antes de gravar', async () => {
      const cookie = await loginAs('comprador');
      await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      const order = db.$queryRaw.mock.invocationCallOrder[0];
      expect(order).toBeLessThan(db.creditSupportRequest.create.mock.invocationCallOrder[0]);
    });
  });

  describe('encaminhar - token, e-mail e auditoria', () => {
    it('grava so o hash, devolve o link bruto e snapshot congelado', async () => {
      const cookie = await loginAs('comprador');
      const res = await request(app)
        .post('/api/v1/quote-responses/4/credit-support')
        .set('Cookie', cookie)
        .send({ contactIds: [11], message: 'Ola', ttlDays: 10 });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('sent');
      expect(res.body.recipients).toEqual([{ email: 'ana@alfa.com', status: 'sent' }]);
      const url = new URL(res.body.portalUrl);
      expect(url.pathname).toBe('/portal/credit');
      const rawToken = url.searchParams.get('token') as string;
      expect(rawToken.length).toBeGreaterThanOrEqual(43);

      const data = db.creditSupportRequest.create.mock.calls[0][0].data;
      expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(data.tokenHash).not.toBe(rawToken);
      expect(hashToken(rawToken)).toBe(data.tokenHash);
      expect(JSON.stringify(data)).not.toContain(rawToken);
      expect(data).toMatchObject({
        quoteRequestId: 3,
        quoteResponseId: 4,
        supplierId: 1,
        creditPartnerId: 5,
        creditPartnerContactId: 11,
        currency: 'USD',
        offeredIncoterm: 'FOB',
        sourceResponseVersion: 1,
        createdById: 7,
        emailMessage: 'Ola',
      });
      expect(data.originalTotalPrice.toFixed(2)).toBe('100.00');
      expect(data.items.create).toHaveLength(2);
      const ttlMs = (data.expiresAt as Date).getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(9 * 86_400_000);
      expect(ttlMs).toBeLessThanOrEqual(10 * 86_400_000);
    });

    it('1 sendAndLog por contato; copia COMEX so na 1a chamada, sem duplicar o destinatario', async () => {
      const cookie = await loginAs('comprador');
      const res = await request(app)
        .post('/api/v1/quote-responses/4/credit-support')
        .set('Cookie', cookie)
        .send({ contactIds: [11, 12] });
      expect(res.status).toBe(201);
      expect(sendMock).toHaveBeenCalledTimes(2);

      const first = sendMock.mock.calls[0][0];
      const second = sendMock.mock.calls[1][0];
      expect(first.to.email).toBe('ana@alfa.com');
      expect(first.cc.map((c: { email: string }) => c.email).sort()).toEqual(['comex@sq.com', 'fin@sq.com']);
      expect(second.to.email).toBe('beto@alfa.com');
      expect(second.cc).toEqual([]);
      expect(first.templateId).toBe('credit-support-request');
      expect(first.relatedEntityType).toBe('credit_support_request');
      expect(first.relatedEntityId).toBe('9');
      expect(first.html).toContain('/portal/credit?token=');
      expect(first.subject).toBe('Credit support request - RFQ-3 - Forn Ltd');
    });

    it('copia nao e consumida quando o 1o envio falha', async () => {
      const cookie = await loginAs('comprador');
      sendMock.mockResolvedValueOnce({ status: 'failed', error: 'smtp' }).mockResolvedValueOnce({ status: 'queued' });
      const res = await request(app)
        .post('/api/v1/quote-responses/4/credit-support')
        .set('Cookie', cookie)
        .send({ contactIds: [11, 12] });
      expect(res.status).toBe(201);
      expect(res.body.recipients).toEqual([
        { email: 'ana@alfa.com', status: 'failed' },
        { email: 'beto@alfa.com', status: 'sent' },
      ]);
      expect(sendMock.mock.calls[1][0].cc.length).toBe(2);
    });

    it('templateVars e AuditLog nao contem token, tokenHash nem o link do portal', async () => {
      const cookie = await loginAs('comprador');
      const res = await request(app)
        .post('/api/v1/quote-responses/4/credit-support')
        .set('Cookie', cookie)
        .send({ message: 'Ola parceiro' });
      expect(res.status).toBe(201);
      const rawToken = new URL(res.body.portalUrl).searchParams.get('token') as string;
      const tokenHash = db.creditSupportRequest.create.mock.calls[0][0].data.tokenHash as string;

      const vars = JSON.stringify(sendMock.mock.calls[0][0].templateVars);
      const audit = JSON.stringify(db.auditLog.create.mock.calls.map((c) => c[0]));
      for (const blob of [vars, audit]) {
        expect(blob).not.toMatch(/token/i);
        expect(blob).not.toContain('portal/credit');
        expect(blob).not.toContain(rawToken);
        expect(blob).not.toContain(tokenHash);
      }
      expect(JSON.parse(vars)).toEqual({
        creditSupportRequestId: 9,
        quoteRequestId: 3,
        requestCode: 'RFQ-3',
        creditPartnerId: 5,
        recipientEmail: 'ana@alfa.com',
        customMessage: 'Ola parceiro',
      });
      const forward = db.auditLog.create.mock.calls[0][0].data;
      expect(forward).toMatchObject({
        entityType: 'credit_support_request',
        entityId: '9',
        action: 'forward',
        performedById: 7,
      });
    });

    it('assunto digitado prevalece', async () => {
      const cookie = await loginAs('comprador');
      await request(app)
        .post('/api/v1/quote-responses/4/credit-support')
        .set('Cookie', cookie)
        .send({ subject: 'Assunto do Lucas' });
      expect(sendMock.mock.calls[0][0].subject).toBe('Assunto do Lucas');
    });

    it('todas as falhas -> 502 e registro revogado (audit revoke send_failed)', async () => {
      const cookie = await loginAs('comprador');
      sendMock.mockResolvedValue({ status: 'failed', error: 'smtp down' });
      const res = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(res.status).toBe(502);
      expect(res.body.message).toMatch(/nada foi encaminhado/);
      expect(res.body).not.toHaveProperty('portalUrl');

      const upd = db.creditSupportRequest.update.mock.calls[0][0];
      expect(upd.where).toEqual({ id: 9 });
      expect(upd.data.revokedAt).toBeInstanceOf(Date);
      const actions = db.auditLog.create.mock.calls.map((c) => c[0].data.action);
      expect(actions).toEqual(['forward', 'revoke']);
      expect(db.auditLog.create.mock.calls[1][0].data.metadata).toEqual({ reason: 'send_failed' });
    });

    it('excecao no envio conta como falha', async () => {
      const cookie = await loginAs('comprador');
      sendMock.mockRejectedValue(new Error('boom'));
      const res = await request(app).post('/api/v1/quote-responses/4/credit-support').set('Cookie', cookie).send({});
      expect(res.status).toBe(502);
    });
  });

  describe('preview', () => {
    it('valida como o encaminhar, nao grava, nao envia e usa link PREVIEW', async () => {
      const cookie = await loginAs('admin');
      const res = await request(app)
        .post('/api/v1/quote-responses/4/credit-support/preview')
        .set('Cookie', cookie)
        .send({ contactIds: [11, 12] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        subject: 'Credit support request - RFQ-3 - Forn Ltd',
        partner: { id: 5, name: 'Banco Alfa' },
        items: 2,
      });
      expect(res.body.recipients).toHaveLength(2);
      expect(res.body.cc.sort()).toEqual(['comex@sq.com', 'fin@sq.com']);
      expect(res.body.html).toContain('token=PREVIEW');
      expect(db.creditSupportRequest.create).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();

      db.quoteResponse.findFirst.mockResolvedValue(
        responseRow({ quoteRequest: { id: 3, requestCode: 'RFQ-3', status: 'closed', deletedAt: null } }),
      );
      const closed = await request(app)
        .post('/api/v1/quote-responses/4/credit-support/preview')
        .set('Cookie', cookie)
        .send({});
      expect(closed.status).toBe(409);
    });
  });

  describe('listar', () => {
    it('serializa sem tokenHash, com status/isStale/markup', async () => {
      const cookie = await loginAs('viewer');
      const res = await request(app).get('/api/v1/quote-requests/3/credit-support').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toMatch(/tokenHash/);
      expect(res.body[0]).toMatchObject({
        id: 9,
        status: 'sent',
        isStale: false,
        partner: { id: 5, name: 'Banco Alfa' },
        supplier: { id: 1, name: 'Forn Ltd', country: 'CN' },
        recipientEmails: ['ana@alfa.com', 'beto@alfa.com'],
        totals: { original: '100.00', partner: null, markupPercent: null },
      });
      expect(db.creditSupportRequest.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
    });

    it('isStale quando a proposta original mudou ou foi excluida; cotacao excluida -> 404', async () => {
      const cookie = await loginAs('viewer');
      db.quoteResponse.findMany.mockResolvedValue([
        responseRow({ items: [responseItem(1, { unitPrice: new Prisma.Decimal('11.00') }), responseItem(2)] }),
      ]);
      const changed = await request(app).get('/api/v1/quote-requests/3/credit-support').set('Cookie', cookie);
      expect(changed.body[0].isStale).toBe(true);

      db.quoteResponse.findMany.mockResolvedValue([responseRow({ deletedAt: now })]);
      const deleted = await request(app).get('/api/v1/quote-requests/3/credit-support').set('Cookie', cookie);
      expect(deleted.body[0].isStale).toBe(true);

      db.quoteRequest.findFirst.mockResolvedValue(null);
      const gone = await request(app).get('/api/v1/quote-requests/3/credit-support').set('Cookie', cookie);
      expect(gone.status).toBe(404);
    });
  });

  describe('revogar', () => {
    it('revoga uma vez e a 2a devolve alreadyRevoked', async () => {
      const cookie = await loginAs('comprador');
      const first = await request(app).post('/api/v1/credit-support-requests/9/revoke').set('Cookie', cookie);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ id: 9, status: 'revoked' });
      expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'revoke', entityId: '9' });
      expect(JSON.stringify(db.auditLog.create.mock.calls[0][0])).not.toContain('a'.repeat(64));

      db.creditSupportRequest.findUnique.mockResolvedValue(storedRequest({ revokedAt: now }));
      const second = await request(app).post('/api/v1/credit-support-requests/9/revoke').set('Cookie', cookie);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ id: 9, alreadyRevoked: true });
    });

    it('inexistente -> 404', async () => {
      const cookie = await loginAs('comprador');
      db.creditSupportRequest.findUnique.mockResolvedValue(null);
      const res = await request(app).post('/api/v1/credit-support-requests/9/revoke').set('Cookie', cookie);
      expect(res.status).toBe(404);
    });
  });

  describe('reenviar', () => {
    it('gira o token no mesmo registro, reenvia aos recipientEmails e devolve o link novo', async () => {
      const cookie = await loginAs('comprador');
      const res = await request(app)
        .post('/api/v1/credit-support-requests/9/resend')
        .set('Cookie', cookie)
        .send({ ttlDays: 7 });
      expect(res.status).toBe(201);
      const rawToken = new URL(res.body.portalUrl).searchParams.get('token') as string;
      const upd = db.creditSupportRequest.update.mock.calls[0][0];
      expect(upd.where).toEqual({ id: 9 });
      expect(upd.data.tokenHash).toBe(hashToken(rawToken));
      expect(upd.data.tokenHash).not.toBe('a'.repeat(64));
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock.mock.calls[0][0].to.name).toBe('Ana');
      expect(sendMock.mock.calls[1][0].cc).toEqual([]);
      expect(sendMock.mock.calls[0][0].subject).toBe('Credit support request - RFQ-3 - Forn Ltd');
      const audit = JSON.stringify(db.auditLog.create.mock.calls);
      expect(audit).not.toContain(rawToken);
      expect(audit).not.toContain(upd.data.tokenHash);
      expect(db.auditLog.create.mock.calls[0][0].data.action).toBe('resend');
    });

    it('revogado, respondido ou stale -> 409 sem girar token', async () => {
      const cookie = await loginAs('comprador');

      db.creditSupportRequest.findUnique.mockResolvedValue(storedRequest({ revokedAt: now }));
      const revoked = await request(app).post('/api/v1/credit-support-requests/9/resend').set('Cookie', cookie).send({});

      db.creditSupportRequest.findUnique.mockResolvedValue(storedRequest({ respondedAt: now }));
      const responded = await request(app).post('/api/v1/credit-support-requests/9/resend').set('Cookie', cookie).send({});

      db.creditSupportRequest.findUnique.mockResolvedValue(storedRequest());
      db.quoteResponse.findUnique.mockResolvedValue(
        responseRow({ items: [responseItem(1, { unitPrice: new Prisma.Decimal('99.00') }), responseItem(2)] }),
      );
      const stale = await request(app).post('/api/v1/credit-support-requests/9/resend').set('Cookie', cookie).send({});

      expect([revoked.status, responded.status, stale.status]).toEqual([409, 409, 409]);
      expect(stale.body.message).toMatch(/proposta do fornecedor mudou/);
      expect(db.creditSupportRequest.update).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('cotacao fechada e parceiro excluido -> 409; expirado pode reenviar', async () => {
      const cookie = await loginAs('comprador');

      db.creditSupportRequest.findUnique.mockResolvedValue(
        storedRequest({ quoteRequest: { id: 3, requestCode: 'RFQ-3', status: 'closed', deletedAt: null } }),
      );
      const closed = await request(app).post('/api/v1/credit-support-requests/9/resend').set('Cookie', cookie).send({});

      db.creditSupportRequest.findUnique.mockResolvedValue(
        storedRequest({ creditPartner: partnerRow({ deletedAt: now }) }),
      );
      const partnerGone = await request(app).post('/api/v1/credit-support-requests/9/resend').set('Cookie', cookie).send({});

      db.creditSupportRequest.findUnique.mockResolvedValue(storedRequest({ expiresAt: new Date('2020-01-01') }));
      const expired = await request(app).post('/api/v1/credit-support-requests/9/resend').set('Cookie', cookie).send({});

      expect([closed.status, partnerGone.status, expired.status]).toEqual([409, 409, 201]);
    });

    it('inexistente -> 404; todas as falhas -> 502', async () => {
      const cookie = await loginAs('comprador');
      db.creditSupportRequest.findUnique.mockResolvedValueOnce(null);
      const missing = await request(app).post('/api/v1/credit-support-requests/9/resend').set('Cookie', cookie).send({});
      expect(missing.status).toBe(404);

      sendMock.mockResolvedValue({ status: 'failed', error: 'x' });
      const failed = await request(app).post('/api/v1/credit-support-requests/9/resend').set('Cookie', cookie).send({});
      expect(failed.status).toBe(502);
      // Reenvio com falha total NAO revoga: o registro segue ativo para novo Reenviar.
      expect(db.creditSupportRequest.update).toHaveBeenCalledTimes(1);
      const updateData = db.creditSupportRequest.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('revokedAt');
      expect(Object.keys(updateData).sort()).toEqual(['expiresAt', 'tokenHash']);
      expect(db.creditSupportRequest.updateMany).not.toHaveBeenCalled();
      expect(db.auditLog.create.mock.calls.map((c) => c[0].data.action)).toEqual(['resend']);
    });
  });
});
