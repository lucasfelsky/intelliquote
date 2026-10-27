import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => {
  const supplierPortalToken = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
  };
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    supplierPortalToken,
    supplierPortalResponse: { findUnique: vi.fn().mockResolvedValue(null) },
    supplierPortalResponseRevision: { findMany: vi.fn().mockResolvedValue([]) },
    supplierPortalTokenLog: { create: vi.fn().mockResolvedValue({}) },
    exchangeRate: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashToken } from '../src/utils/tokens';

const prismaMock = prisma as unknown as {
  supplierPortalToken: { findUnique: ReturnType<typeof vi.fn> };
  supplierPortalResponse: { findUnique: ReturnType<typeof vi.fn> };
  supplierPortalResponseRevision: { findMany: ReturnType<typeof vi.fn> };
  exchangeRate: { findFirst: ReturnType<typeof vi.fn> };
};

// Allowlist campo a campo do `quoteRequest` do portal do fornecedor (PortalRoutes.buildPortalView).
// Campo novo na cotacao (ex.: isDevelopment, anexos da solicitacao do comercial) NAO pode vazar:
// quem expor um campo novo precisa atualizar estas listas de proposito.
const QUOTE_REQUEST_KEYS = [
  'currency',
  'deadlineAt',
  'description',
  'desiredIncoterm',
  'destinationPort',
  'id',
  'items',
  'originPort',
  'productName',
  'purchaseOrders',
  'requestCode',
];
const ITEM_KEYS = [
  'description',
  'desiredIncoterm',
  'destinationPort',
  'id',
  'itemCode',
  'notes',
  'originPort',
  'productName',
  'purchaseOrderId',
  'quantity',
  'unit',
];

describe('GET /api/portal/:token - chaves exatas de quoteRequest (nada de desenvolvimento/anexos)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expoe so a allowlist e nao vaza isDevelopment, anexos nem dados da solicitacao do comercial', async () => {
    const rawToken = 'tok-keys-1234567890123456789012345678901234567890';
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const fullToken = {
      id: 1,
      tokenHash: hashToken(rawToken),
      expiresAt: expires,
      revokedAt: null,
      respondedAt: null,
      accessCount: 0,
      firstSeenAt: null,
      quoteRequestId: 5,
      supplierId: 2,
      supplierContactId: 9,
      quoteRequest: {
        id: 5,
        requestCode: 'QR-2026-001',
        productName: 'Acido sulfurico',
        description: 'Lote piloto',
        desiredIncoterm: ['FOB'],
        destinationPort: 'Santos',
        originPort: null,
        currency: 'USD',
        deadlineAt: null,
        // Campos internos que a linha do banco carrega e NAO podem sair no portal.
        isDevelopment: true,
        createdById: 77,
        status: 'open',
        attachments: [{ id: 1, fileName: 'tds-sigilosa.pdf', sha256: 'abc' }],
        commercialRequests: [{ id: 3, customerName: 'Cliente Sigiloso' }],
        purchaseOrders: [{ id: 1, label: 'PO-1', position: 1 }],
        items: [
          {
            id: 11,
            purchaseOrderId: null,
            itemCode: 'A1',
            productName: 'Acido sulfurico',
            description: null,
            quantity: 1,
            unit: 'UN',
            desiredIncoterm: null,
            destinationPort: null,
            notes: null,
            targetPrice: '9.99',
            proposedName: 'Nome digitado pelo comercial',
            commercialRequestItemId: 4,
            catalogItem: { marketName: 'Acido sulfurico', commercialName: 'Nome comercial interno' },
          },
        ],
      },
      supplier: { id: 2, name: 'Acme', paymentTermsDays: 30 },
      supplierContact: { id: 9, name: 'John', email: 'john@acme.com' },
    };
    prismaMock.supplierPortalToken.findUnique
      .mockResolvedValueOnce(fullToken) // SupplierPortalService.validate
      .mockResolvedValueOnce(fullToken); // buildPortalView
    prismaMock.supplierPortalResponse.findUnique.mockResolvedValue(null);
    prismaMock.supplierPortalResponseRevision.findMany.mockResolvedValue([]);
    prismaMock.exchangeRate.findFirst.mockResolvedValue(null);

    const res = await request(app).get(`/api/portal/${rawToken}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.quoteRequest).sort()).toEqual(QUOTE_REQUEST_KEYS);
    expect(Object.keys(res.body.quoteRequest.items[0]).sort()).toEqual(ITEM_KEYS);

    const json = JSON.stringify(res.body);
    for (const leaked of [
      'isDevelopment',
      'attachments',
      'tds-sigilosa',
      'Cliente Sigiloso',
      'Nome digitado pelo comercial',
      'Nome comercial interno',
      'targetPrice',
    ]) {
      expect(json).not.toContain(leaked);
    }
  });
});
