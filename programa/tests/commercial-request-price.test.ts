// Preco final do comercial calculado na leitura (PR2). Cliente Prisma injetado: sem banco.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import {
  computeFinalPrices,
  findWinnerKind,
  PriceRow,
} from '../src/services/CommercialRequestPriceService';

function makeClient(overrides: {
  responses?: unknown[];
  credits?: unknown[];
  responseCount?: number;
  creditCount?: number;
} = {}) {
  return {
    quoteResponse: {
      findMany: vi.fn().mockResolvedValue(overrides.responses ?? []),
      count: vi.fn().mockResolvedValue(overrides.responseCount ?? 0),
    },
    creditSupportRequest: {
      findMany: vi.fn().mockResolvedValue(overrides.credits ?? []),
      count: vi.fn().mockResolvedValue(overrides.creditCount ?? 0),
    },
  };
}

function row(overrides: Partial<PriceRow> = {}): PriceRow {
  return {
    status: 'fulfilled',
    quoteRequestId: 50,
    quoteRequest: { deletedAt: null },
    items: [
      { id: 1, quoteRequestItemId: 501 },
      { id: 2, quoteRequestItemId: 502 },
    ],
    ...overrides,
  };
}

const run = (client: ReturnType<typeof makeClient>, rows: PriceRow[]) =>
  computeFinalPrices(client as never, rows);

describe('computeFinalPrices', () => {
  it('vencedor normal: unitPrice, moeda e incoterm da resposta', async () => {
    const client = makeClient({
      responses: [
        {
          quoteRequestId: 50,
          currency: 'EUR',
          offeredIncoterm: 'CIF',
          items: [{ quoteRequestItemId: 501, unitPrice: { toFixed: () => '1.85' }, isUnavailable: false, quoteRequestItem: { unit: 'TON' } }],
        },
      ],
    });
    const prices = await run(client, [row()]);

    // A1: a unidade e a do item da COTACAO (pode diferir da pedida na solicitacao)
    expect(prices.get(1)).toEqual({
      unitPrice: '1.85',
      currency: 'EUR',
      incoterm: 'CIF',
      unit: 'TON',
    });
    // item 2 nao veio na resposta vencedora
    expect(prices.get(2)).toBeNull();
    expect(client.creditSupportRequest.findMany).not.toHaveBeenCalled();
  });

  it('item isUnavailable -> null', async () => {
    const client = makeClient({
      responses: [
        {
          quoteRequestId: 50,
          currency: 'USD',
          offeredIncoterm: 'FOB',
          items: [{ quoteRequestItemId: 501, unitPrice: 0, isUnavailable: true, quoteRequestItem: { unit: 'KG' } }],
        },
      ],
    });
    const prices = await run(client, [row()]);
    expect(prices.get(1)).toBeNull();
  });

  it('item sem vinculo (quoteRequestItemId null) -> null', async () => {
    const client = makeClient({
      responses: [
        {
          quoteRequestId: 50,
          currency: 'USD',
          offeredIncoterm: 'FOB',
          items: [{ quoteRequestItemId: 501, unitPrice: 2, isUnavailable: false, quoteRequestItem: { unit: 'KG' } }],
        },
      ],
    });
    const prices = await run(client, [
      row({ items: [{ id: 1, quoteRequestItemId: null }, { id: 2, quoteRequestItemId: 501 }] }),
    ]);
    expect(prices.get(1)).toBeNull();
    expect(prices.get(2)).toEqual({ unitPrice: '2.00', currency: 'USD', incoterm: 'FOB', unit: 'KG' });
  });

  it('vencedor parceiro: partnerUnitPrice + moeda/incoterm do CreditSupportRequest', async () => {
    const client = makeClient({
      responses: [],
      credits: [
        {
          quoteRequestId: 50,
          currency: 'USD',
          offeredIncoterm: 'DAP',
          items: [
            { quoteRequestItemId: 501, partnerUnitPrice: { toFixed: () => '3.10' }, isUnavailable: false, unit: 'KG' },
            { quoteRequestItemId: 502, partnerUnitPrice: null, isUnavailable: false, unit: 'KG' },
          ],
        },
      ],
    });
    const prices = await run(client, [row()]);

    expect(prices.get(1)).toEqual({ unitPrice: '3.10', currency: 'USD', incoterm: 'DAP', unit: 'KG' });
    // partnerUnitPrice null -> null
    expect(prices.get(2)).toBeNull();
  });

  it('vencedor parceiro com item isUnavailable -> null', async () => {
    const client = makeClient({
      credits: [
        {
          quoteRequestId: 50,
          currency: 'USD',
          offeredIncoterm: 'DAP',
          items: [{ quoteRequestItemId: 501, partnerUnitPrice: 9, isUnavailable: true, unit: 'KG' }],
        },
      ],
    });
    const prices = await run(client, [row()]);
    expect(prices.get(1)).toBeNull();
  });

  it('sem vencedor -> null', async () => {
    const client = makeClient();
    const prices = await run(client, [row()]);
    expect(prices.get(1)).toBeNull();
    expect(prices.get(2)).toBeNull();
  });

  it('cotacao excluida -> null e sem consulta', async () => {
    const client = makeClient();
    const prices = await run(client, [row({ quoteRequest: { deletedAt: new Date() } })]);
    expect(prices.get(1)).toBeNull();
    expect(client.quoteResponse.findMany).not.toHaveBeenCalled();
    expect(client.creditSupportRequest.findMany).not.toHaveBeenCalled();
  });

  it('so linhas nao-fulfilled -> zero chamadas ao prisma', async () => {
    const client = makeClient();
    const prices = await run(client, [
      row({ status: 'pending' }),
      row({ status: 'quoting' }),
      row({ status: 'rejected' }),
    ]);
    expect(prices.get(1)).toBeNull();
    expect(client.quoteResponse.findMany).not.toHaveBeenCalled();
    expect(client.creditSupportRequest.findMany).not.toHaveBeenCalled();
    expect(client.quoteResponse.count).not.toHaveBeenCalled();
  });

  it('em lote: no maximo 1 query por tabela para varias linhas', async () => {
    const client = makeClient({
      responses: [
        {
          quoteRequestId: 50,
          currency: 'USD',
          offeredIncoterm: 'FOB',
          items: [{ quoteRequestItemId: 501, unitPrice: 1, isUnavailable: false, quoteRequestItem: { unit: 'KG' } }],
        },
        {
          quoteRequestId: 60,
          currency: 'USD',
          offeredIncoterm: 'CIF',
          items: [{ quoteRequestItemId: 601, unitPrice: 2, isUnavailable: false, quoteRequestItem: { unit: 'KG' } }],
        },
      ],
    });
    const prices = await run(client, [
      row(),
      row({ quoteRequestId: 60, items: [{ id: 3, quoteRequestItemId: 601 }] }),
    ]);
    expect(client.quoteResponse.findMany).toHaveBeenCalledTimes(1);
    expect(client.creditSupportRequest.findMany).not.toHaveBeenCalled();
    expect(prices.get(1)?.unitPrice).toBe('1.00');
    expect(prices.get(3)).toEqual({ unitPrice: '2.00', currency: 'USD', incoterm: 'CIF', unit: 'KG' });
  });

  it('os select nao expoem id, fornecedor nem parceiro', async () => {
    const client = makeClient({
      credits: [],
      responses: [],
    });
    await run(client, [row()]);

    const responseArgs = JSON.stringify(client.quoteResponse.findMany.mock.calls[0][0].select);
    const creditArgs = JSON.stringify(client.creditSupportRequest.findMany.mock.calls[0][0].select);
    for (const select of [responseArgs, creditArgs]) {
      expect(select).not.toContain('"id"');
      expect(select).not.toContain('supplierId');
      expect(select).not.toContain('supplier');
      expect(select).not.toContain('creditPartnerId');
      expect(select).not.toContain('creditPartner');
    }
    expect(client.quoteResponse.findMany.mock.calls[0][0].where).toMatchObject({
      isWinner: true,
      deletedAt: null,
    });
    expect(client.quoteResponse.findMany.mock.calls[0][0].select.items.where).toMatchObject({
      deletedAt: null,
    });
  });
});

describe('findWinnerKind', () => {
  it("devolve 'response' quando ha resposta vencedora", async () => {
    const client = makeClient({ responseCount: 1 });
    expect(await findWinnerKind(client as never, 50)).toBe('response');
    expect(client.creditSupportRequest.count).not.toHaveBeenCalled();
  });

  it("devolve 'credit' quando so ha alternativa via parceiro", async () => {
    const client = makeClient({ creditCount: 1 });
    expect(await findWinnerKind(client as never, 50)).toBe('credit');
  });

  it('devolve null sem vencedor e filtra cotacao excluida', async () => {
    const client = makeClient();
    expect(await findWinnerKind(client as never, 50)).toBeNull();
    expect(client.quoteResponse.count.mock.calls[0][0].where).toMatchObject({
      quoteRequestId: 50,
      isWinner: true,
      deletedAt: null,
      quoteRequest: { deletedAt: null },
    });
  });
});
