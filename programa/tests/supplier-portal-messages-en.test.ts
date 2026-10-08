import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => {
  const tx = {
    supplierPortalResponse: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    supplierPortalResponseItem: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    supplierPortalResponseRevision: {
      create: vi.fn().mockResolvedValue({}),
    },
    supplierPortalToken: {
      update: vi.fn(),
    },
    quoteResponse: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    exchangeRate: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  const supplierPortalToken = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
  };
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    supplier: {},
    quoteRequest: {
      findUnique: vi.fn(),
    },
    quoteRequestItem: {
      findMany: vi.fn(),
    },
    supplierPortalToken,
    supplierPortalResponse: {
      findUnique: vi.fn(),
    },
    supplierPortalResponseRevision: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    supplierPortalResponseItem: {},
    supplierPortalTokenLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    quoteResponse: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    exchangeRate: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => cb(tx)),
    __tx: tx,
  };
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashToken } from '../src/utils/tokens';
import { PORTAL_INVALID_LINK_MESSAGE } from '../src/services/SupplierPortalService';
import { SupplierPortalResponseService } from '../src/services/SupplierPortalResponseService';
import { HttpError } from '../src/utils/http';

const prismaMock = prisma as unknown as {
  supplierPortalToken: { findUnique: ReturnType<typeof vi.fn> };
};

const PORTAL_INVALID_PAYLOAD = 'The submitted data is invalid. Please review the form and try again.';
const PORTAL_PT_PATTERN = /invalido|expirado|Muitas|Aguarde|Tente|bloqueado|sao invalidos|Erro interno/i;
const PT_ANY_PATTERN = /proposta|contem|precos|quantidades|invalidos|nao |Token|Cotacao|Conflito/i;
const LONG_TOKEN = 'tok-en-1234567890123456789012345678901234567890';

let uaSeq = 0;
function nextUa(): string {
  uaSeq += 1;
  return `portal-en-test-${uaSeq}`;
}

function tokenRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tokenHash: hashToken(LONG_TOKEN),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    respondedAt: null,
    accessCount: 0,
    firstSeenAt: null,
    quoteRequestId: 5,
    supplierId: 2,
    supplierContactId: 9,
    ...overrides,
  };
}

describe('Portal do fornecedor - mensagens em ingles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.supplierPortalToken.findUnique.mockReset();
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue(null);
  });

  it('token inexistente devolve 404 com mensagem em ingles nas 3 rotas', async () => {
    const ua = nextUa();
    const responses = [
      await request(app).get(`/api/portal/${LONG_TOKEN}`).set('User-Agent', ua),
      await request(app).get(`/api/portal/${LONG_TOKEN}/respond`).set('User-Agent', ua),
      await request(app).post(`/api/portal/${LONG_TOKEN}/respond`).set('User-Agent', ua).send({}),
    ];
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body.message).toBe(PORTAL_INVALID_LINK_MESSAGE);
      expect(res.body.message).not.toMatch(PORTAL_PT_PATTERN);
    }
  });

  it('token revogado devolve 404 com a mesma mensagem', async () => {
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue(tokenRecord({ revokedAt: new Date() }));
    const res = await request(app).get(`/api/portal/${LONG_TOKEN}`).set('User-Agent', nextUa());
    expect(res.status).toBe(404);
    expect(res.body.message).toBe(PORTAL_INVALID_LINK_MESSAGE);
    expect(res.body.message).not.toMatch(PORTAL_PT_PATTERN);
  });

  it('token expirado devolve 404 com a mesma mensagem', async () => {
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue(
      tokenRecord({ expiresAt: new Date(Date.now() - 60 * 1000) }),
    );
    const res = await request(app).get(`/api/portal/${LONG_TOKEN}`).set('User-Agent', nextUa());
    expect(res.status).toBe(404);
    expect(res.body.message).toBe(PORTAL_INVALID_LINK_MESSAGE);
    expect(res.body.message).not.toMatch(PORTAL_PT_PATTERN);
  });

  it('token curto (<16 chars) devolve 404 com a mesma mensagem', async () => {
    const res = await request(app).get('/api/portal/abc').set('User-Agent', nextUa());
    expect(res.status).toBe(404);
    expect(res.body.message).toBe(PORTAL_INVALID_LINK_MESSAGE);
    expect(res.body.message).not.toMatch(PORTAL_PT_PATTERN);
  });

  it('token valido com body invalido no POST devolve 400 em ingles', async () => {
    prismaMock.supplierPortalToken.findUnique.mockResolvedValue(tokenRecord());
    const res = await request(app)
      .post(`/api/portal/${LONG_TOKEN}/respond`)
      .set('User-Agent', nextUa())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(PORTAL_INVALID_PAYLOAD);
    expect(res.body.message).not.toMatch(PORTAL_PT_PATTERN);
  });

  it('lockout apos 5 tentativas invalidas devolve 429 em ingles', async () => {
    const ua = nextUa();
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).get(`/api/portal/${LONG_TOKEN}`).set('User-Agent', ua);
      expect(res.status).toBe(404);
    }
    const locked = await request(app).get(`/api/portal/${LONG_TOKEN}`).set('User-Agent', ua);
    expect(locked.status).toBe(429);
    expect(locked.body.message).toMatch(/^Access temporarily blocked/);
    expect(locked.body.message).not.toMatch(PORTAL_PT_PATTERN);
  });

  it('rate limit devolve 429 em ingles na 11a requisicao', async () => {
    const ua = nextUa();
    let last = await request(app).get(`/api/portal/${LONG_TOKEN}/respond`).set('User-Agent', ua);
    for (let i = 1; i < 11; i += 1) {
      last = await request(app).get(`/api/portal/${LONG_TOKEN}/respond`).set('User-Agent', ua);
    }
    expect(last.status).toBe(429);
    expect(last.body.message).toMatch(/^Too many requests/);
    expect(last.body.message).not.toMatch(PORTAL_PT_PATTERN);
  });

  it('erro inesperado devolve 500 com mensagem generica em ingles', async () => {
    prismaMock.supplierPortalToken.findUnique.mockRejectedValue(new Error('boom'));
    const res = await request(app).get(`/api/portal/${LONG_TOKEN}`).set('User-Agent', nextUa());
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Something went wrong on our side. Please try again in a few minutes.');
    expect(res.body.message).not.toMatch(PORTAL_PT_PATTERN);
  });

  describe('HttpError de codigo compartilhado (portugues) nao vaza ao fornecedor', () => {
    function submitPayload(items: Array<Record<string, unknown>>, totalPrice: number) {
      return {
        incoterm: 'FOB',
        paymentTermsDays: 30,
        totalPrice,
        validityDays: 10,
        items,
      };
    }

    it('submit com o mesmo quoteRequestItemId duas vezes devolve 400 com mensagem especifica em ingles', async () => {
      prismaMock.supplierPortalToken.findUnique.mockResolvedValue(tokenRecord());
      const item = { quoteRequestItemId: 7, unitPrice: 10, quantity: 2, totalPrice: 20 };
      const res = await request(app)
        .post(`/api/portal/${LONG_TOKEN}/respond`)
        .set('User-Agent', nextUa())
        .send(submitPayload([item, { ...item }], 40));
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('The proposal contains duplicated items or invalid prices/quantities.');
      expect(res.body.message).not.toMatch(PT_ANY_PATTERN);
    });

    it('HttpError generico em portugues vira mensagem em ingles do fallback, com status preservado', async () => {
      prismaMock.supplierPortalToken.findUnique.mockResolvedValue(tokenRecord());
      const spy = vi
        .spyOn(SupplierPortalResponseService, 'getByTokenId')
        .mockRejectedValue(new HttpError(409, 'Conflito interno de negocio em portugues.'));
      try {
        const res = await request(app)
          .get(`/api/portal/${LONG_TOKEN}/respond`)
          .set('User-Agent', nextUa());
        expect(res.status).toBe(409);
        expect(res.body.message).toBe(
          'Your proposal could not be saved due to a conflict. Please reload the page and try again.',
        );
        expect(res.body.message).not.toMatch(PT_ANY_PATTERN);
      } finally {
        spy.mockRestore();
      }
    });

    it('HttpError generico em portugues no POST nao repassa message nem code', async () => {
      prismaMock.supplierPortalToken.findUnique.mockResolvedValue(tokenRecord());
      const spy = vi
        .spyOn(SupplierPortalResponseService, 'submit')
        .mockRejectedValue(new HttpError(400, 'Mensagem em portugues qualquer.', 'CODIGO_INTERNO'));
      try {
        const res = await request(app)
          .post(`/api/portal/${LONG_TOKEN}/respond`)
          .set('User-Agent', nextUa())
          .send(submitPayload([{ quoteRequestItemId: 7, unitPrice: 10, quantity: 2, totalPrice: 20 }], 20));
        expect(res.status).toBe(400);
        expect(res.body.message).toBe(PORTAL_INVALID_PAYLOAD);
        expect(res.body.code).toBeUndefined();
      } finally {
        spy.mockRestore();
      }
    });

    it('mensagens em ingles do SupplierPortalResponseService continuam intactas', async () => {
      prismaMock.supplierPortalToken.findUnique.mockResolvedValue(tokenRecord());
      const res = await request(app)
        .post(`/api/portal/${LONG_TOKEN}/respond`)
        .set('User-Agent', nextUa())
        .send(submitPayload([{ quoteRequestItemId: 7, unitPrice: 10, quantity: 2, totalPrice: 5 }], 20));
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('The item total does not match the unit price times the quantity.');
    });
  });
});
