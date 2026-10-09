import request from 'supertest';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', () => {
  const prisma: Record<string, any> = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    supplier: {},
    quoteRequest: { findUnique: vi.fn(), findFirst: vi.fn() },
    quoteRequestItem: { findMany: vi.fn() },
    supplierPortalToken: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    supplierPortalResponse: { findUnique: vi.fn() },
    supplierPortalResponseRevision: { findMany: vi.fn() },
    supplierPortalResponseItem: {},
    supplierPortalTokenLog: { create: vi.fn() },
    creditSupportRequest: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    creditSupportRequestItem: { update: vi.fn() },
    auditLog: { create: vi.fn() },
    quoteResponse: { findFirst: vi.fn(), upsert: vi.fn() },
    exchangeRate: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma));
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashToken } from '../src/utils/tokens';
import { HttpError } from '../src/utils/http';
import { PORTAL_INVALID_LINK_MESSAGE } from '../src/services/SupplierPortalService';
import { CreditPortalService } from '../src/services/CreditPortalService';

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  supplierPortalToken: { findUnique: Mock };
  supplierPortalTokenLog: { create: Mock };
  supplierPortalResponseRevision: { findMany: Mock };
  creditSupportRequest: { findUnique: Mock; update: Mock; updateMany: Mock };
  creditSupportRequestItem: { update: Mock };
  auditLog: { create: Mock };
  $queryRaw: Mock;
  $transaction: Mock;
};

const PORTAL_INVALID_PAYLOAD = 'The submitted data is invalid. Please review the form and try again.';
const PT_ANY_PATTERN = /proposta|contem|precos|quantidades|invalidos|nao |Token|Cotacao|Conflito/i;
const LONG_TOKEN = 'credit-tok-1234567890123456789012345678901234567890';
const LONG_SUPPLIER_TOKEN = 'supplier-tok-1234567890123456789012345678901234567890';
const future = new Date('2099-01-01T00:00:00.000Z');
const past = new Date('2020-01-01T00:00:00.000Z');
const createdAt = new Date('2026-10-08T10:00:00.000Z');

let uaSeq = 0;
function nextUa(): string {
  uaSeq += 1;
  return `credit-portal-test-${uaSeq}`;
}

type Overrides = Record<string, unknown>;

function creditRecord(overrides: Overrides = {}) {
  return {
    id: 77,
    quoteRequestId: 5,
    quoteResponseId: 9,
    supplierId: 2,
    creditPartnerId: 3,
    creditPartnerContactId: null,
    recipientEmails: '["ana@banco.test"]',
    emailSubject: 'Credit support request',
    emailMessage: 'SECRET-EMAIL-MESSAGE',
    tokenHash: hashToken(LONG_TOKEN),
    expiresAt: future,
    revokedAt: null,
    firstSeenAt: null,
    lastSeenAt: null,
    accessCount: 0,
    sourceResponseVersion: 1,
    currency: 'USD',
    offeredIncoterm: 'FOB',
    originalPaymentTermsDays: 45,
    originalTotalPrice: new Prisma.Decimal('80.00'),
    originPort: 'Shanghai',
    respondedAt: null,
    responseVersion: 0,
    partnerPaymentTermsDays: null,
    partnerValidityDays: null,
    partnerNotes: null,
    partnerTotalPrice: null,
    submitterIp: null,
    submitterUserAgent: null,
    createdById: 7,
    createdAt,
    updatedAt: createdAt,
    quoteRequest: { id: 5, requestCode: 'QR-5', status: 'open', deletedAt: null },
    supplier: {
      id: 2,
      name: 'Acme Chem',
      country: 'CN',
      notes: 'SECRET-SUPPLIER-NOTE',
      contacts: [{ id: 1, name: 'John', email: 'secret.contact@acme.test' }],
    },
    creditPartner: { id: 3, name: 'Banco Alfa' },
    createdBy: { id: 7, name: 'Buyer Person', email: 'buyer@sq.test' },
    items: [
      {
        id: 101,
        requestId: 77,
        quoteRequestItemId: 11,
        position: 1,
        productName: 'Item A',
        itemCode: 'A-1',
        unit: 'KG',
        quantity: 5,
        originalUnitPrice: new Prisma.Decimal('10.00'),
        originalTotalPrice: new Prisma.Decimal('50.00'),
        isUnavailable: false,
        originPort: null,
        isDangerousGood: false,
        partnerUnitPrice: null,
        partnerTotalPrice: null,
      },
      {
        id: 102,
        requestId: 77,
        quoteRequestItemId: 12,
        position: 2,
        productName: 'Item B',
        itemCode: 'B-2',
        unit: 'KG',
        quantity: 3,
        originalUnitPrice: new Prisma.Decimal('10.00'),
        originalTotalPrice: new Prisma.Decimal('30.00'),
        isUnavailable: false,
        originPort: 'Ningbo',
        isDangerousGood: true,
        partnerUnitPrice: null,
        partnerTotalPrice: null,
      },
    ],
    ...overrides,
  };
}

type Record77 = ReturnType<typeof creditRecord>;

// Simula o banco: updateMany/update mutam o registro compartilhado para que o
// buildPartnerView pos-commit (findUnique) devolva os valores gravados.
function applyData(target: Record<string, any>, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !(value instanceof Date) && 'increment' in value) {
      target[key] = (target[key] ?? 0) + (value as { increment: number }).increment;
    } else {
      target[key] = value;
    }
  }
}

function useRecord(record: Record77 | null) {
  db.creditSupportRequest.findUnique.mockImplementation(async () => record);
  if (!record) return;
  db.creditSupportRequest.updateMany.mockImplementation(async ({ data }: { data: Record<string, any> }) => {
    applyData(record, data);
    return { count: 1 };
  });
  db.creditSupportRequestItem.update.mockImplementation(
    async ({ where, data }: { where: { id: number }; data: Record<string, any> }) => {
      const item = record.items.find((entry) => entry.id === where.id) as Record<string, any> | undefined;
      if (item) applyData(item, data);
      return item ?? null;
    },
  );
}

function validPayload() {
  return {
    paymentTermsDays: 90,
    validityDays: 30,
    notes: 'Partner notes',
    items: [
      { quoteRequestItemId: 11, unitPrice: 11 },
      { quoteRequestItemId: 12, unitPrice: 9.5 },
    ],
  };
}

const ITEM_KEYS = [
  'isDangerousGood',
  'isUnavailable',
  'itemCode',
  'markupPercent',
  'originPort',
  'originalTotalPrice',
  'originalUnitPrice',
  'partnerTotalPrice',
  'partnerUnitPrice',
  'productName',
  'quantity',
  'quoteRequestItemId',
  'unit',
];

function logCalls() {
  return db.supplierPortalTokenLog.create.mock.calls.map((call) => (call as [{ data: any }])[0].data);
}

describe('Portal do parceiro de credito - /api/credit-portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.supplierPortalToken.findUnique.mockReset().mockResolvedValue(null);
    db.supplierPortalResponseRevision.findMany.mockReset().mockResolvedValue([]);
    db.creditSupportRequest.findUnique.mockReset().mockResolvedValue(null);
    db.creditSupportRequest.update.mockReset().mockResolvedValue({});
    db.creditSupportRequest.updateMany.mockReset().mockResolvedValue({ count: 1 });
    db.creditSupportRequestItem.update.mockReset().mockResolvedValue({});
    db.supplierPortalTokenLog.create.mockReset().mockResolvedValue({});
    db.auditLog.create.mockReset().mockResolvedValue({});
    db.$queryRaw.mockReset().mockResolvedValue([]);
  });

  describe('a. token invalido devolve 404 generico e loga INVALID', () => {
    it('token inexistente', async () => {
      const res = await request(app).get(`/api/credit-portal/${LONG_TOKEN}`).set('User-Agent', nextUa());
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: PORTAL_INVALID_LINK_MESSAGE });
      const logs = logCalls();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        kind: 'INVALID',
        tokenId: null,
        creditSupportRequestId: null,
        meta: { portal: 'credit', reason: 'not_found' },
      });
    });

    it('token curto (<16 chars) devolve 404 sem consultar o banco', async () => {
      const res = await request(app).get('/api/credit-portal/abc').set('User-Agent', nextUa());
      expect(res.status).toBe(404);
      expect(res.body.message).toBe(PORTAL_INVALID_LINK_MESSAGE);
      expect(db.creditSupportRequest.findUnique).not.toHaveBeenCalled();
    });

    it.each([
      ['revogado', { revokedAt: new Date() }, 'revoked'],
      ['expirado', { expiresAt: past }, 'expired'],
      [
        'cotacao excluida',
        { quoteRequest: { id: 5, requestCode: 'QR-5', status: 'open', deletedAt: new Date() } },
        'quote_deleted',
      ],
    ])('token %s', async (_label, overrides, reason) => {
      useRecord(creditRecord(overrides as Overrides));
      const res = await request(app).get(`/api/credit-portal/${LONG_TOKEN}`).set('User-Agent', nextUa());
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: PORTAL_INVALID_LINK_MESSAGE });
      const logs = logCalls();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        kind: 'INVALID',
        tokenId: null,
        creditSupportRequestId: 77,
        meta: { portal: 'credit', reason },
      });
      expect(db.creditSupportRequest.update).not.toHaveBeenCalled();
    });

    it('POST com token inexistente devolve 404 e loga INVALID', async () => {
      const res = await request(app)
        .post(`/api/credit-portal/${LONG_TOKEN}/respond`)
        .set('User-Agent', nextUa())
        .send(validPayload());
      expect(res.status).toBe(404);
      expect(res.body.message).toBe(PORTAL_INVALID_LINK_MESSAGE);
      expect(logCalls()[0]).toMatchObject({ kind: 'INVALID', meta: { portal: 'credit', reason: 'not_found' } });
    });
  });

  it('b. lockout compartilhado com /api/portal (mesmo Map)', async () => {
    const ua = nextUa();
    for (let i = 0; i < 4; i += 1) {
      const res = await request(app).get('/api/portal/abc').set('User-Agent', ua);
      expect(res.status).toBe(404);
    }
    const fifth = await request(app).get('/api/credit-portal/abc').set('User-Agent', ua);
    expect(fifth.status).toBe(404);

    const lockedCredit = await request(app).get(`/api/credit-portal/${LONG_TOKEN}`).set('User-Agent', ua);
    expect(lockedCredit.status).toBe(429);
    expect(lockedCredit.body.message).toMatch(/^Access temporarily blocked/);

    const lockedSupplier = await request(app).get(`/api/portal/${LONG_SUPPLIER_TOKEN}`).set('User-Agent', ua);
    expect(lockedSupplier.status).toBe(429);
    expect(lockedSupplier.body.message).toMatch(/^Access temporarily blocked/);
  });

  it('c. rate limit compartilhado com /api/portal (mesma instancia)', async () => {
    const ua = nextUa();
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).get(`/api/portal/${LONG_SUPPLIER_TOKEN}/respond`).set('User-Agent', ua);
      expect(res.status).toBe(404);
    }
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post(`/api/credit-portal/${LONG_TOKEN}/respond`)
        .set('User-Agent', ua)
        .send(validPayload());
      expect(res.status).toBe(404);
    }
    const eleventh = await request(app).get(`/api/credit-portal/${LONG_TOKEN}`).set('User-Agent', ua);
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.message).toMatch(/^Too many requests/);
  });

  it('d. GET valido devolve a allowlist exata, sem campos sensiveis, e registra VIEW', async () => {
    useRecord(creditRecord());
    const res = await request(app).get(`/api/credit-portal/${LONG_TOKEN}`).set('User-Agent', nextUa());
    expect(res.status).toBe(200);

    expect(Object.keys(res.body).sort()).toEqual(['items', 'partner', 'request', 'response', 'supplier', 'totals']);
    expect(Object.keys(res.body.request).sort()).toEqual([
      'closed',
      'currency',
      'expiresAt',
      'incoterm',
      'originPort',
      'readOnly',
      'requestCode',
    ]);
    expect(Object.keys(res.body.supplier).sort()).toEqual(['country', 'name']);
    expect(Object.keys(res.body.partner)).toEqual(['name']);
    expect(Object.keys(res.body.totals).sort()).toEqual(['markupPercent', 'original', 'partner']);
    expect(res.body.items).toHaveLength(2);
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
    }
    expect(res.body.request).toMatchObject({
      requestCode: 'QR-5',
      currency: 'USD',
      incoterm: 'FOB',
      originPort: 'Shanghai',
      closed: false,
      readOnly: false,
    });
    expect(res.body.supplier).toEqual({ name: 'Acme Chem', country: 'CN' });
    expect(res.body.partner).toEqual({ name: 'Banco Alfa' });
    expect(res.body.response).toBeNull();
    expect(res.body.totals).toEqual({ original: '80.00', partner: null, markupPercent: null });
    expect(res.body.items[0]).toMatchObject({
      quoteRequestItemId: 11,
      originalUnitPrice: '10.00',
      originalTotalPrice: '50.00',
      partnerUnitPrice: null,
      markupPercent: null,
    });
    expect(res.body.items[1]).toMatchObject({ isDangerousGood: true, originPort: 'Ningbo' });

    const blob = JSON.stringify(res.body);
    for (const secret of [
      hashToken(LONG_TOKEN),
      LONG_TOKEN,
      'SECRET-EMAIL-MESSAGE',
      'SECRET-SUPPLIER-NOTE',
      'secret.contact@acme.test',
      'ana@banco.test',
      'Buyer Person',
      '45',
    ]) {
      expect(blob).not.toContain(secret);
    }
    for (const key of ['tokenHash', 'recipientEmails', 'originalPaymentTermsDays', 'email', 'targetPrice', 'exchangeRate', 'createdBy', 'accessCount', 'id"']) {
      expect(blob).not.toContain(key);
    }

    expect(db.creditSupportRequest.update).toHaveBeenCalledTimes(1);
    const updateArgs = db.creditSupportRequest.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(updateArgs.where).toEqual({ id: 77 });
    expect(updateArgs.data.accessCount).toEqual({ increment: 1 });
    expect(updateArgs.data.firstSeenAt).toBeInstanceOf(Date);
    expect(updateArgs.data.lastSeenAt).toBeInstanceOf(Date);

    const logs = logCalls();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: 'VIEW', tokenId: null, creditSupportRequestId: 77, meta: { portal: 'credit' } });
  });

  it('e. cotacao fechada: GET so leitura, POST 409 QUOTE_CLOSED', async () => {
    useRecord(creditRecord({ quoteRequest: { id: 5, requestCode: 'QR-5', status: 'closed', deletedAt: null } }));
    const get = await request(app).get(`/api/credit-portal/${LONG_TOKEN}`).set('User-Agent', nextUa());
    expect(get.status).toBe(200);
    expect(get.body.request.closed).toBe(true);
    expect(get.body.request.readOnly).toBe(true);

    const post = await request(app)
      .post(`/api/credit-portal/${LONG_TOKEN}/respond`)
      .set('User-Agent', nextUa())
      .send(validPayload());
    expect(post.status).toBe(409);
    expect(post.body).toEqual({
      message: 'This quote has been closed. Responses are no longer accepted.',
      code: 'QUOTE_CLOSED',
    });
    expect(db.creditSupportRequest.updateMany).not.toHaveBeenCalled();
  });

  describe('f. POST valido', () => {
    it('grava precos, totais e auditoria partner_submit', async () => {
      const record = creditRecord();
      useRecord(record);
      const ua = nextUa();
      const res = await request(app)
        .post(`/api/credit-portal/${LONG_TOKEN}/respond`)
        .set('User-Agent', ua)
        .send(validPayload());
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['items', 'respondedAt', 'totals', 'version']);
      expect(res.body.version).toBe(1);
      expect(res.body.respondedAt).toBeTruthy();
      expect(res.body.totals).toEqual({ original: '80.00', partner: '83.50', markupPercent: '4.38' });
      expect(res.body.items.map((item: { markupPercent: string }) => item.markupPercent)).toEqual(['10.00', '-5.00']);
      expect(res.body.items[0]).toMatchObject({ partnerUnitPrice: '11.00', partnerTotalPrice: '55.00' });
      expect(res.body.items[1]).toMatchObject({ partnerUnitPrice: '9.50', partnerTotalPrice: '28.50' });

      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(db.creditSupportRequest.updateMany).toHaveBeenCalledTimes(1);
      const updateMany = db.creditSupportRequest.updateMany.mock.calls[0][0] as {
        where: Record<string, any>;
        data: Record<string, any>;
      };
      expect(updateMany.where.id).toBe(77);
      expect(updateMany.where.tokenHash).toBe(hashToken(LONG_TOKEN));
      expect(updateMany.where.revokedAt).toBeNull();
      expect(updateMany.where.expiresAt.gt).toBeInstanceOf(Date);
      expect(updateMany.where.quoteRequest).toEqual({ deletedAt: null, status: { not: 'closed' } });
      expect(updateMany.data.responseVersion).toEqual({ increment: 1 });
      expect(updateMany.data.partnerPaymentTermsDays).toBe(90);
      expect(updateMany.data.partnerValidityDays).toBe(30);
      expect(updateMany.data.partnerNotes).toBe('Partner notes');
      expect(String(updateMany.data.partnerTotalPrice)).toBe('83.5');
      expect(updateMany.data.submitterUserAgent).toBe(ua);
      expect(updateMany.data.respondedAt).toBeInstanceOf(Date);

      expect(db.creditSupportRequestItem.update).toHaveBeenCalledTimes(2);

      expect(db.auditLog.create).toHaveBeenCalledTimes(1);
      const audit = db.auditLog.create.mock.calls[0][0] as { data: Record<string, any> };
      expect(audit.data.action).toBe('partner_submit');
      expect(audit.data.performedById).toBeNull();
      expect(audit.data.entityType).toBe('credit_support_request');
      expect(audit.data.entityId).toBe('77');
      expect(audit.data.afterData).toMatchObject({
        responseVersion: 1,
        partnerTotalPrice: '83.50',
        items: [
          { quoteRequestItemId: 11, partnerUnitPrice: '11.00', partnerTotalPrice: '55.00' },
          { quoteRequestItemId: 12, partnerUnitPrice: '9.50', partnerTotalPrice: '28.50' },
        ],
      });
      expect(audit.data.metadata).toEqual({ portal: 'credit' });

      // Log SUBMIT depois do commit.
      const logs = logCalls();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ kind: 'SUBMIT', creditSupportRequestId: 77, meta: { portal: 'credit' } });
    });

    it('com respondedAt previo vira revisao (partner_revise) e mantem respondedAt', async () => {
      const previous = new Date('2026-10-08T12:00:00.000Z');
      const record = creditRecord({
        respondedAt: previous,
        responseVersion: 1,
        partnerPaymentTermsDays: 60,
        partnerValidityDays: 15,
        partnerTotalPrice: new Prisma.Decimal('100.00'),
      });
      useRecord(record);
      const res = await request(app)
        .post(`/api/credit-portal/${LONG_TOKEN}/respond`)
        .set('User-Agent', nextUa())
        .send(validPayload());
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.version).toBe(2);
      expect(res.body.respondedAt).toBe(previous.toISOString());

      const updateMany = db.creditSupportRequest.updateMany.mock.calls[0][0] as { data: Record<string, any> };
      expect(updateMany.data.respondedAt).toEqual(previous);

      const audit = db.auditLog.create.mock.calls[0][0] as { data: Record<string, any> };
      expect(audit.data.action).toBe('partner_revise');
      expect(audit.data.performedById).toBeNull();
      expect(audit.data.beforeData).toMatchObject({ responseVersion: 1, partnerTotalPrice: '100.00' });
    });
  });

  describe('g. 400 em ingles', () => {
    const cases: Array<[string, Record<string, unknown>, string | RegExp]> = [
      [
        'item disponivel faltando',
        { ...validPayload(), items: [{ quoteRequestItemId: 11, unitPrice: 11 }] },
        'Provide a unit price for every available item.',
      ],
      [
        'item extra fora do snapshot',
        { ...validPayload(), items: [...validPayload().items, { quoteRequestItemId: 99, unitPrice: 1 }] },
        /^Item id=99 is not part of this request/,
      ],
      [
        'item duplicado',
        { ...validPayload(), items: [...validPayload().items, { quoteRequestItemId: 11, unitPrice: 12 }] },
        /^Duplicate item in the response \(id=11\)/,
      ],
      [
        'unitPrice que arredonda para zero',
        { ...validPayload(), items: [{ quoteRequestItemId: 11, unitPrice: 0.001 }, { quoteRequestItemId: 12, unitPrice: 9.5 }] },
        'Unit prices must be greater than zero.',
      ],
      ['paymentTermsDays 721', { ...validPayload(), paymentTermsDays: 721 }, PORTAL_INVALID_PAYLOAD],
      ['validityDays 0', { ...validPayload(), validityDays: 0 }, PORTAL_INVALID_PAYLOAD],
      ['notes com 2001 chars', { ...validPayload(), notes: 'x'.repeat(2001) }, PORTAL_INVALID_PAYLOAD],
      ['body vazio', {}, PORTAL_INVALID_PAYLOAD],
    ];

    it.each(cases)('%s', async (_label, body, expected) => {
      useRecord(creditRecord());
      const res = await request(app)
        .post(`/api/credit-portal/${LONG_TOKEN}/respond`)
        .set('User-Agent', nextUa())
        .send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      if (typeof expected === 'string') {
        expect(res.body.message).toBe(expected);
      } else {
        expect(res.body.message).toMatch(expected);
      }
      expect(res.body.message).not.toMatch(PT_ANY_PATTERN);
      expect(db.creditSupportRequest.updateMany).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it('item indisponivel com preco', async () => {
      const record = creditRecord();
      record.items[1].isUnavailable = true;
      useRecord(record);
      const res = await request(app)
        .post(`/api/credit-portal/${LONG_TOKEN}/respond`)
        .set('User-Agent', nextUa())
        .send(validPayload());
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Item id=12 is temporarily unavailable and cannot be priced.');
      expect(res.body.message).not.toMatch(PT_ANY_PATTERN);
    });

    it('item indisponivel fica fora do total e sem preco', async () => {
      const record = creditRecord();
      record.items[1].isUnavailable = true;
      useRecord(record);
      const res = await request(app)
        .post(`/api/credit-portal/${LONG_TOKEN}/respond`)
        .set('User-Agent', nextUa())
        .send({ ...validPayload(), items: [{ quoteRequestItemId: 11, unitPrice: 11 }] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.totals.partner).toBe('55.00');
      expect(res.body.items[1]).toMatchObject({ isUnavailable: true, partnerUnitPrice: null, markupPercent: null });
      expect(db.creditSupportRequestItem.update).toHaveBeenCalledTimes(1);
    });
  });

  it('h. updateMany com count 0 devolve 409 de conflito em ingles', async () => {
    useRecord(creditRecord());
    db.creditSupportRequest.updateMany.mockImplementation(async () => ({ count: 0 }));
    const res = await request(app)
      .post(`/api/credit-portal/${LONG_TOKEN}/respond`)
      .set('User-Agent', nextUa())
      .send(validPayload());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      message: 'Your response could not be saved due to a conflict. Please reload the page and try again.',
    });
    expect(res.body.message).not.toMatch(PT_ANY_PATTERN);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('i. HttpError em portugues de codigo compartilhado vira fallback em ingles, sem code', async () => {
    useRecord(creditRecord());
    const spy = vi
      .spyOn(CreditPortalService, 'buildPartnerView')
      .mockRejectedValue(new HttpError(409, 'Conflito interno em portugues.', 'CODIGO_INTERNO'));
    try {
      const res = await request(app).get(`/api/credit-portal/${LONG_TOKEN}`).set('User-Agent', nextUa());
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        'Your proposal could not be saved due to a conflict. Please reload the page and try again.',
      );
      expect(res.body.code).toBeUndefined();
      expect(res.body.message).not.toMatch(PT_ANY_PATTERN);
    } finally {
      spy.mockRestore();
    }
  });

  it('erro inesperado devolve 500 generico em ingles', async () => {
    db.creditSupportRequest.findUnique.mockRejectedValue(new Error('boom'));
    const res = await request(app).get(`/api/credit-portal/${LONG_TOKEN}`).set('User-Agent', nextUa());
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Something went wrong on our side. Please try again in a few minutes.');
  });

  it('j. nenhum log/auditoria contem o token bruto', async () => {
    const record = creditRecord();
    useRecord(record);
    const ua = nextUa();
    await request(app).get(`/api/credit-portal/${LONG_TOKEN}`).set('User-Agent', ua);
    await request(app).post(`/api/credit-portal/${LONG_TOKEN}/respond`).set('User-Agent', ua).send(validPayload());
    await request(app).get(`/api/credit-portal/${LONG_TOKEN}`).set('User-Agent', ua);
    useRecord(null);
    await request(app).get(`/api/credit-portal/${LONG_TOKEN}`).set('User-Agent', ua);

    expect(db.supplierPortalTokenLog.create.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    const blob = JSON.stringify([db.supplierPortalTokenLog.create.mock.calls, db.auditLog.create.mock.calls]);
    expect(blob).not.toContain(LONG_TOKEN);
    expect(blob).not.toContain(hashToken(LONG_TOKEN));
    expect(blob).not.toContain('portal/credit');
    // Logs de acesso nao carregam ip/UA na auditoria (so no SupplierPortalTokenLog).
    const audit = JSON.stringify(db.auditLog.create.mock.calls);
    expect(audit).not.toContain(ua);
  });
});
