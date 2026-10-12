import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

// Golden do PR4a (Credit Support): gerado ANTES de qualquer edicao em `src/`.
// Garante que, sem encaminhamentos respondidos (0 alternativas via parceiro), o
// score puro e o payload do preview permanecem IDENTICOS ao comportamento atual.
// Nao editar os snapshots inline deste arquivo.

vi.mock('../src/lib/prisma', () => {
  const tx = {
    quoteComparisonResult: { updateMany: vi.fn() },
    quoteResponse: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    quoteComparison: {
      create: vi.fn(),
      update: vi.fn(),
    },
    quoteRequest: {
      update: vi.fn(),
    },
    creditSupportRequest: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  const prisma = {
    companyProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
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
    supplierReview: {
      groupBy: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    quoteRequest: {
      findUnique: vi.fn(),
    },
    quoteResponse: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    quoteComparison: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    creditSupportRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(async (callback) => callback(tx)),
    __tx: tx,
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { QuoteComparisonService } from '../src/services/QuoteComparisonService';

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  quoteRequest: { findUnique: ReturnType<typeof vi.fn> };
  supplierReview: { groupBy: ReturnType<typeof vi.fn> };
  quoteResponse: { findMany: ReturnType<typeof vi.fn> };
  companyProfile: { findUnique: ReturnType<typeof vi.fn> };
  creditSupportRequest: { findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  __tx: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
};

// Remove SO as chaves aditivas do PR4a (no-op no codigo atual) para que o golden
// continue valendo depois da implementacao.
const ADDITIVE_ROW_KEYS = [
  'creditSupportRequestId',
  'creditPartner',
  'partnerContact',
  'partnerValidityDays',
  'validityExpired',
];

function stripAdditive(body: Record<string, unknown>) {
  const clone: Record<string, unknown> = { ...body };
  delete clone.candidateCount;
  delete clone.winnerCreditSupportRequestId;
  for (const listKey of ['results', 'excluded']) {
    const list = clone[listKey];
    if (Array.isArray(list)) {
      clone[listKey] = list.map((row: Record<string, unknown>) => {
        const copy = { ...row };
        for (const key of ADDITIVE_ROW_KEYS) delete copy[key];
        return copy;
      });
    }
  }
  return clone;
}

describe('Golden PR4a - comparacao sem alternativas via parceiro', () => {
  it('(a) compareResponses com os pesos padrao (fixture de quote-comparison-service)', () => {
    const results = QuoteComparisonService.compareResponses([
      {
        id: 1,
        quoteRequestId: 10,
        supplierId: 100,
        offeredPrice: 100,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 40,
        insuranceCost: 10,
        otherFees: 20,
        importDutyRate: 14,
        ipiRate: 5,
        pisRate: 2.1,
        cofinsRate: 9.65,
        offeredIncoterm: 'EXW',
        paymentTermsDays: 10,
      },
      {
        id: 2,
        quoteRequestId: 10,
        supplierId: 200,
        offeredPrice: 120,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 0,
        insuranceCost: 0,
        otherFees: 10,
        importDutyRate: 10,
        ipiRate: 4,
        pisRate: 2.1,
        cofinsRate: 9.65,
        offeredIncoterm: 'DDP',
        paymentTermsDays: 30,
      },
    ]);

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "cifValue": 590,
          "cofinsRate": 0.0965,
          "currency": "USD",
          "exchangeRate": 5.4,
          "freightCost": 40,
          "id": 1,
          "importDutyAmount": 82.6,
          "importDutyRate": 0.14,
          "incotermScore": 4,
          "insuranceCost": 10,
          "ipiAmount": 33.63,
          "ipiRate": 0.05,
          "isWinner": false,
          "offeredIncoterm": "EXW",
          "offeredPrice": 100,
          "otherFees": 20,
          "paymentTermsDays": 10,
          "paymentTermsScore": 10,
          "pisCofinsAmount": 69.33,
          "pisRate": 0.021,
          "priceScore": 50,
          "qualityScore": 0,
          "quoteRequestId": 10,
          "supplierId": 100,
          "totalLandedCost": 795.56,
          "totalScore": 64,
        },
        {
          "cifValue": 648,
          "cofinsRate": 0.0965,
          "currency": "USD",
          "exchangeRate": 5.4,
          "freightCost": 0,
          "id": 2,
          "importDutyAmount": 64.8,
          "importDutyRate": 0.1,
          "incotermScore": 20,
          "insuranceCost": 0,
          "ipiAmount": 28.51,
          "ipiRate": 0.04,
          "isWinner": true,
          "offeredIncoterm": "DDP",
          "offeredPrice": 120,
          "otherFees": 10,
          "paymentTermsDays": 30,
          "paymentTermsScore": 30,
          "pisCofinsAmount": 76.14,
          "pisRate": 0.021,
          "priceScore": 41.67,
          "qualityScore": 0,
          "quoteRequestId": 10,
          "supplierId": 200,
          "totalLandedCost": 827.45,
          "totalScore": 91.67,
        },
      ]
    `);
  });

  describe('(b) POST /compare/preview com 2 respostas completas', () => {
    const requestedItems = [1, 2].map((id) => ({ id, quantity: 1, productName: `Produto ${id}` }));

    const complete = (id: number, supplierId: number, prices: [number, number]) => ({
      id,
      quoteRequestId: 1,
      supplierId,
      offeredPrice: prices[0] + prices[1],
      currency: 'USD',
      exchangeRate: 5,
      freightCost: 0,
      insuranceCost: 0,
      otherFees: 0,
      importDuty: 0,
      ipi: 0,
      pis: 0,
      cofins: 0,
      offeredIncoterm: 'FOB',
      paymentTermsDays: 30,
      isWinner: false,
      items: prices.map((unitPrice, index) => ({
        quoteRequestItemId: index + 1,
        quantity: 1,
        unitPrice,
        leadTimeDays: null,
        originPort: null,
        isUnavailable: false,
        quoteRequestItem: { productName: `Produto ${index + 1}` },
      })),
      supplier: { id: supplierId, name: `Fornecedor ${supplierId}`, contacts: [] },
    });

    beforeEach(() => {
      vi.clearAllMocks();
      prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock.__tx));
      prismaMock.creditSupportRequest.findMany.mockResolvedValue([]);
      prismaMock.quoteRequest.findUnique.mockResolvedValue({
        id: 1,
        requestCode: 'QR-GOLDEN',
        status: 'open',
        currency: 'USD',
        items: requestedItems,
      });
      prismaMock.quoteResponse.findMany.mockResolvedValue([
        complete(12, 102, [10, 20]),
        complete(13, 103, [20, 30]),
      ]);
      prismaMock.companyProfile.findUnique.mockResolvedValue({ id: 1, awardApprovalThreshold: null });
      prismaMock.supplierReview.groupBy.mockResolvedValue([]);
    });

    it('payload do preview (sem as chaves aditivas) permanece identico', async () => {
      const cookies = await loginAs('viewer');

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send({ priceWeight: 100, paymentTermsWeight: 0, incotermWeight: 0, qualityWeight: 0 });

      expect(response.status).toBe(200);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(stripAdditive(response.body)).toMatchInlineSnapshot(`
        {
          "excluded": [],
          "pendingApproval": false,
          "responseCount": 2,
          "results": [
            {
              "cifValue": 150,
              "cofinsRate": 0,
              "contact": null,
              "currency": "USD",
              "dgItems": [],
              "exchangeRate": 5,
              "freightCost": 0,
              "id": 12,
              "importDutyAmount": 0,
              "importDutyRate": 0,
              "incotermScore": 0,
              "insuranceCost": 0,
              "ipiAmount": 0,
              "ipiRate": 0,
              "isWinner": true,
              "itemOrigins": [
                {
                  "originPort": null,
                  "overridden": false,
                  "productName": "Produto 1",
                  "quoteRequestItemId": 1,
                },
                {
                  "originPort": null,
                  "overridden": false,
                  "productName": "Produto 2",
                  "quoteRequestItemId": 2,
                },
              ],
              "leadTimeDays": null,
              "offeredIncoterm": "FOB",
              "offeredPrice": 30,
              "originPort": null,
              "otherFees": 0,
              "paymentTermsDays": 30,
              "paymentTermsScore": 0,
              "pisCofinsAmount": 0,
              "pisRate": 0,
              "priceScore": 100,
              "qualityScore": 0,
              "quantityAdjusted": false,
              "quantityMismatches": [],
              "quoteRequestId": 1,
              "quoteResponseId": 12,
              "supplier": {
                "id": 102,
                "name": "Fornecedor 102",
              },
              "supplierId": 102,
              "totalLandedCost": 150,
              "totalScore": 100,
            },
            {
              "cifValue": 250,
              "cofinsRate": 0,
              "contact": null,
              "currency": "USD",
              "dgItems": [],
              "exchangeRate": 5,
              "freightCost": 0,
              "id": 13,
              "importDutyAmount": 0,
              "importDutyRate": 0,
              "incotermScore": 0,
              "insuranceCost": 0,
              "ipiAmount": 0,
              "ipiRate": 0,
              "isWinner": false,
              "itemOrigins": [
                {
                  "originPort": null,
                  "overridden": false,
                  "productName": "Produto 1",
                  "quoteRequestItemId": 1,
                },
                {
                  "originPort": null,
                  "overridden": false,
                  "productName": "Produto 2",
                  "quoteRequestItemId": 2,
                },
              ],
              "leadTimeDays": null,
              "offeredIncoterm": "FOB",
              "offeredPrice": 50,
              "originPort": null,
              "otherFees": 0,
              "paymentTermsDays": 30,
              "paymentTermsScore": 0,
              "pisCofinsAmount": 0,
              "pisRate": 0,
              "priceScore": 60,
              "qualityScore": 0,
              "quantityAdjusted": false,
              "quantityMismatches": [],
              "quoteRequestId": 1,
              "quoteResponseId": 13,
              "supplier": {
                "id": 103,
                "name": "Fornecedor 103",
              },
              "supplierId": 103,
              "totalLandedCost": 250,
              "totalScore": 60,
            },
          ],
          "thresholdValue": null,
          "winnerQuoteResponseId": 12,
        }
      `);
    });
  });
});

const cookieCache = new Map<string, string[]>();

async function loginAs(role: 'admin' | 'comprador' | 'gestor' | 'viewer') {
  const passwordHash = await hashPassword('ChangeMe123!');

  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  });

  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: { name: role },
  });

  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });

  const cached = cookieCache.get(role);
  if (cached) {
    return cached;
  }

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: `${role}@intelliquote.local`, password: 'ChangeMe123!' });

  const cookies = loginResponse.headers['set-cookie'];
  if (cookies) {
    cookieCache.set(role, cookies as unknown as string[]);
  }
  return cookies;
}
