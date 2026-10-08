import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

// O service importa o prisma real; aqui so testamos funcoes puras.
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import {
  buildSnapshot,
  computeIsStale,
  deriveStatus,
  isActive,
  markupPercent,
  readResponseExtras,
  serializeRequest,
  type CreditSupportRequestRow,
  type SnapshotSourceResponse,
} from '../src/services/CreditSupportService';

type ItemOverrides = Record<string, unknown>;

function item(id: number, overrides: ItemOverrides = {}) {
  return {
    quoteRequestItemId: id,
    unitPrice: new Prisma.Decimal('10.00'),
    quantity: 5,
    totalPrice: new Prisma.Decimal('50.00'),
    deletedAt: null,
    quoteRequestItem: {
      productName: `Produto ${id}`,
      itemCode: `COD-${id}`,
      unit: 'KG',
      quantity: 5,
      deletedAt: null,
      catalogItem: null,
    },
    ...overrides,
  };
}

function response(
  items: unknown[],
  overrides: Record<string, unknown> = {},
): SnapshotSourceResponse {
  return {
    version: 2,
    currency: 'USD',
    offeredIncoterm: 'FOB',
    paymentTermsDays: 45,
    deletedAt: null,
    items,
    ...overrides,
  } as unknown as SnapshotSourceResponse;
}

describe('buildSnapshot', () => {
  it('funciona com itens SEM os campos novos (main antiga): defaults', () => {
    const snap = buildSnapshot(response([item(1), item(2)]));
    expect(snap.items).toHaveLength(2);
    expect(snap.items[0]).toMatchObject({
      position: 1,
      productName: 'Produto 1',
      itemCode: 'COD-1',
      unit: 'KG',
      quantity: 5,
      isUnavailable: false,
      originPort: null,
      isDangerousGood: false,
    });
    expect(snap.items[1].position).toBe(2);
    expect(snap.originPort).toBeNull();
    expect(snap.originalTotalPrice.toFixed(2)).toBe('100.00');
    expect(snap.sourceResponseVersion).toBe(2);
    expect(snap.originalPaymentTermsDays).toBe(45);
  });

  it('le originPort/isUnavailable/isDangerousGood quando existem (#113/#116/DG)', () => {
    const snap = buildSnapshot(
      response(
        [
          item(1, { originPort: 'Ningbo', isDangerousGood: true }),
          item(2, { originPort: null }),
          item(3, {
            isUnavailable: true,
            unitPrice: new Prisma.Decimal(0),
            quantity: 0,
            totalPrice: new Prisma.Decimal(0),
          }),
        ],
        { originPort: 'Shanghai' },
      ),
    );
    expect(snap.originPort).toBe('Shanghai');
    expect(snap.items[0].originPort).toBe('Ningbo');
    expect(snap.items[0].isDangerousGood).toBe(true);
    // item sem origem propria herda a geral
    expect(snap.items[1].originPort).toBe('Shanghai');
  });

  it('item indisponivel: preco 0, quantidade pedida, fora do total', () => {
    const snap = buildSnapshot(
      response([
        item(1),
        item(2, {
          isUnavailable: true,
          unitPrice: new Prisma.Decimal(0),
          quantity: 0,
          totalPrice: new Prisma.Decimal(0),
          quoteRequestItem: {
            productName: 'Indisponivel',
            itemCode: null,
            unit: 'UN',
            quantity: 40,
            deletedAt: null,
            catalogItem: null,
          },
        }),
      ]),
    );
    const unavailable = snap.items[1];
    expect(unavailable.isUnavailable).toBe(true);
    expect(unavailable.quantity).toBe(40);
    expect(unavailable.originalUnitPrice.toFixed(2)).toBe('0.00');
    expect(unavailable.originalTotalPrice.toFixed(2)).toBe('0.00');
    expect(snap.originalTotalPrice.toFixed(2)).toBe('50.00');
  });

  it('usa marketName do catalogo; DG vem so do item da resposta (sem fallback do catalogo)', () => {
    const snap = buildSnapshot(
      response([
        item(1, {
          quoteRequestItem: {
            productName: 'Nome interno',
            itemCode: null,
            unit: 'KG',
            quantity: 5,
            deletedAt: null,
            // DG no cadastro (legado) e ignorado: o #119 tirou o DG do cadastro
            catalogItem: { marketName: 'Nome de mercado', isDangerousGood: true },
          },
        }),
        item(2, {
          isDangerousGood: true,
          quoteRequestItem: {
            productName: 'B',
            itemCode: null,
            unit: 'KG',
            quantity: 5,
            deletedAt: null,
            catalogItem: { marketName: 'B market' },
          },
        }),
        // item indisponivel nunca e DG, mesmo marcado
        item(3, {
          isDangerousGood: true,
          isUnavailable: true,
          unitPrice: new Prisma.Decimal(0),
          quantity: 0,
          totalPrice: new Prisma.Decimal(0),
        }),
      ]),
    );
    expect(snap.items[0].productName).toBe('Nome de mercado');
    expect(snap.items[0].isDangerousGood).toBe(false);
    expect(snap.items[1].isDangerousGood).toBe(true);
    expect(snap.items[2].isUnavailable).toBe(true);
    expect(snap.items[2].isDangerousGood).toBe(false);
  });

  it('ignora itens excluidos (resposta ou item da cotacao)', () => {
    const snap = buildSnapshot(
      response([
        item(1),
        item(2, { deletedAt: new Date() }),
        item(3, {
          quoteRequestItem: {
            productName: 'x',
            unit: 'UN',
            quantity: 1,
            deletedAt: new Date(),
          },
        }),
      ]),
    );
    expect(snap.items.map((i) => i.quoteRequestItemId)).toEqual([1]);
  });
});

describe('readResponseExtras', () => {
  it('defaults quando os campos nao existem', () => {
    const extras = readResponseExtras(response([]), item(1) as never);
    expect(extras).toEqual({
      generalOriginPort: null,
      itemOriginPort: null,
      isUnavailable: false,
    });
  });
});

describe('deriveStatus / isActive', () => {
  const now = new Date('2026-10-09T12:00:00.000Z');
  const future = new Date('2026-10-20T00:00:00.000Z');
  const past = new Date('2026-10-01T00:00:00.000Z');

  it('revoked > responded > expired > sent', () => {
    expect(deriveStatus({ revokedAt: past, respondedAt: past, expiresAt: past }, now)).toBe(
      'revoked',
    );
    expect(deriveStatus({ revokedAt: null, respondedAt: past, expiresAt: past }, now)).toBe(
      'responded',
    );
    expect(deriveStatus({ revokedAt: null, respondedAt: null, expiresAt: past }, now)).toBe(
      'expired',
    );
    expect(deriveStatus({ revokedAt: null, respondedAt: null, expiresAt: now }, now)).toBe(
      'expired',
    );
    expect(deriveStatus({ revokedAt: null, respondedAt: null, expiresAt: future }, now)).toBe(
      'sent',
    );
  });

  it('ativo = nao revogado e nao expirado', () => {
    expect(isActive({ revokedAt: null, expiresAt: future }, now)).toBe(true);
    expect(isActive({ revokedAt: null, expiresAt: past }, now)).toBe(false);
    expect(isActive({ revokedAt: past, expiresAt: future }, now)).toBe(false);
  });
});

describe('markupPercent', () => {
  it('calcula (partner/original - 1) x 100 com 2 casas', () => {
    expect(markupPercent('11', '10')).toBe('10.00');
    expect(markupPercent('9', '10')).toBe('-10.00');
    expect(markupPercent(new Prisma.Decimal('10.50'), new Prisma.Decimal('10'))).toBe('5.00');
  });

  it('null sem preco do parceiro ou original 0', () => {
    expect(markupPercent(null, '10')).toBeNull();
    expect(markupPercent(undefined, '10')).toBeNull();
    expect(markupPercent('10', '0')).toBeNull();
    expect(markupPercent('10', null)).toBeNull();
  });
});

describe('computeIsStale', () => {
  const stored = {
    currency: 'USD',
    offeredIncoterm: 'FOB' as const,
    items: [
      {
        quoteRequestItemId: 1,
        quantity: 5,
        originalUnitPrice: new Prisma.Decimal('10.00'),
        isUnavailable: false,
      },
      {
        quoteRequestItemId: 2,
        quantity: 7,
        originalUnitPrice: new Prisma.Decimal('0'),
        isUnavailable: true,
      },
    ],
  };
  const unavailable2 = {
    isUnavailable: true,
    unitPrice: new Prisma.Decimal(0),
    quantity: 0,
    totalPrice: new Prisma.Decimal(0),
    quoteRequestItem: {
      productName: 'B',
      itemCode: null,
      unit: 'UN',
      quantity: 7,
      deletedAt: null,
      catalogItem: null,
    },
  };
  const same = () => response([item(1), item(2, unavailable2)]);

  it('igual -> false', () => {
    expect(computeIsStale(stored, same())).toBe(false);
  });

  it('resposta excluida ou ausente -> true', () => {
    expect(computeIsStale(stored, response([item(1)], { deletedAt: new Date() }))).toBe(true);
    expect(computeIsStale(stored, null)).toBe(true);
  });

  it('preco mudou -> true', () => {
    const changed = response([item(1, { unitPrice: new Prisma.Decimal('10.01') }), item(2, unavailable2)]);
    expect(computeIsStale(stored, changed)).toBe(true);
  });

  it('quantidade mudou -> true', () => {
    expect(computeIsStale(stored, response([item(1, { quantity: 6 }), item(2, unavailable2)]))).toBe(true);
  });

  it('item removido ou adicionado -> true', () => {
    expect(computeIsStale(stored, response([item(1)]))).toBe(true);
    expect(computeIsStale(stored, response([item(1), item(2, unavailable2), item(3)]))).toBe(true);
    // item da resposta soft-deletado conta como removido
    expect(
      computeIsStale(stored, response([item(1), item(2, { ...unavailable2, deletedAt: new Date() })])),
    ).toBe(true);
  });

  it('moeda ou incoterm mudou -> true', () => {
    expect(computeIsStale(stored, response([item(1), item(2, unavailable2)], { currency: 'EUR' }))).toBe(true);
    expect(
      computeIsStale(stored, response([item(1), item(2, unavailable2)], { offeredIncoterm: 'CIF' })),
    ).toBe(true);
  });

  it('disponibilidade mudou -> true', () => {
    expect(computeIsStale(stored, response([item(1), item(2)]))).toBe(true);
    expect(
      computeIsStale(stored, response([item(1, { isUnavailable: true }), item(2, unavailable2)])),
    ).toBe(true);
  });
});

describe('serializeRequest', () => {
  const row = {
    id: 9,
    quoteRequestId: 3,
    quoteResponseId: 4,
    recipientEmails: '["ana@alfa.com"]',
    revokedAt: null,
    respondedAt: null,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-10-09T00:00:00.000Z'),
    responseVersion: 1,
    currency: 'USD',
    offeredIncoterm: 'FOB',
    originPort: 'Ningbo',
    originalPaymentTermsDays: 45,
    originalTotalPrice: new Prisma.Decimal('50'),
    partnerPaymentTermsDays: 60,
    partnerValidityDays: 30,
    partnerNotes: 'ok',
    partnerTotalPrice: new Prisma.Decimal('55'),
    supplier: { id: 1, name: 'Forn', country: 'CN' },
    creditPartner: { id: 2, name: 'Banco Alfa' },
    createdBy: { id: 7, name: 'Lucas' },
    items: [
      {
        quoteRequestItemId: 1,
        position: 1,
        productName: 'A',
        itemCode: null,
        unit: 'KG',
        quantity: 5,
        isUnavailable: false,
        originPort: null,
        isDangerousGood: false,
        originalUnitPrice: new Prisma.Decimal('10'),
        originalTotalPrice: new Prisma.Decimal('50'),
        partnerUnitPrice: new Prisma.Decimal('11'),
        partnerTotalPrice: new Prisma.Decimal('55'),
      },
      {
        quoteRequestItemId: 2,
        position: 2,
        productName: 'B',
        itemCode: null,
        unit: 'KG',
        quantity: 7,
        isUnavailable: true,
        originPort: null,
        isDangerousGood: false,
        originalUnitPrice: new Prisma.Decimal('0'),
        originalTotalPrice: new Prisma.Decimal('0'),
        partnerUnitPrice: null,
        partnerTotalPrice: null,
      },
    ],
  } as unknown as CreditSupportRequestRow;

  it('serializa decimais como string, calcula markup e nunca expoe tokenHash', () => {
    const out = serializeRequest({ ...row, tokenHash: 'abc' } as never, true);
    expect(out.status).toBe('sent');
    expect(out.isStale).toBe(true);
    expect(out.recipientEmails).toEqual(['ana@alfa.com']);
    expect(out.totals).toEqual({ original: '50.00', partner: '55.00', markupPercent: '10.00' });
    expect(out.items[0]).toMatchObject({
      originalUnitPrice: '10.00',
      partnerUnitPrice: '11.00',
      markupPercent: '10.00',
    });
    expect(out.items[1]).toMatchObject({ partnerUnitPrice: null, markupPercent: null });
    expect(JSON.stringify(out)).not.toMatch(/tokenHash|abc/);
  });
});
