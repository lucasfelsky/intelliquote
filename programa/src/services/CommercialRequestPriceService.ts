import type { Prisma } from '@prisma/client';

// Preco final de uma solicitacao do comercial, calculado na LEITURA (nada e persistido).
// So le isWinner/unitPrice/partnerUnitPrice; nenhuma formula de scoring/landed cost.
// ATENCAO: o resultado vai ao COMERCIAL. Nunca selecionar id/supplierId/creditPartnerId
// nem relacoes de fornecedor/parceiro aqui.

type PriceClient = Pick<Prisma.TransactionClient, 'quoteResponse' | 'creditSupportRequest'>;

export interface FinalPrice {
  unitPrice: string;
  currency: string;
  incoterm: string;
  // Unidade do item da COTACAO a que o preco se refere (pode diferir da solicitada).
  unit: string;
}

export interface PriceRow {
  status: string;
  quoteRequestId: number | null;
  quoteRequest: { deletedAt: Date | null } | null;
  items: Array<{ id: number; quoteRequestItemId: number | null }>;
}

type Decimalish = { toFixed: (digits: number) => string } | string | number;

function toFixed2(value: Decimalish): string {
  if (typeof value === 'object') return value.toFixed(2);
  return Number(value).toFixed(2);
}

// Tipo do vencedor da cotacao: resposta de fornecedor, alternativa via parceiro, ou nenhum.
// (Invariante: no maximo um dos dois, ver QuoteResponseController.)
export async function findWinnerKind(
  client: PriceClient,
  quoteRequestId: number,
): Promise<'response' | 'credit' | null> {
  const responses = await client.quoteResponse.count({
    where: { quoteRequestId, isWinner: true, deletedAt: null, quoteRequest: { deletedAt: null } },
  });
  if (responses > 0) return 'response';

  const credits = await client.creditSupportRequest.count({
    where: { quoteRequestId, isWinner: true, quoteRequest: { deletedAt: null } },
  });
  return credits > 0 ? 'credit' : null;
}

// itemId da solicitacao -> preco final (ou null). Em lote: no maximo 2 queries por chamada
// e zero quando nao ha linha `fulfilled` com cotacao nao excluida.
export async function computeFinalPrices(
  client: PriceClient,
  rows: PriceRow[],
): Promise<Map<number, FinalPrice | null>> {
  const result = new Map<number, FinalPrice | null>();
  for (const row of rows) {
    for (const item of row.items) result.set(item.id, null);
  }

  const eligible = rows.filter(
    (row) =>
      row.status === 'fulfilled' &&
      typeof row.quoteRequestId === 'number' &&
      row.quoteRequest !== null &&
      row.quoteRequest !== undefined &&
      row.quoteRequest.deletedAt === null,
  );
  if (eligible.length === 0) return result;

  const quoteIds = [...new Set(eligible.map((row) => row.quoteRequestId as number))];
  const quoteItemIds = [
    ...new Set(
      eligible.flatMap((row) =>
        row.items
          .map((item) => item.quoteRequestItemId)
          .filter((id): id is number => id !== null && id !== undefined),
      ),
    ),
  ];
  if (quoteItemIds.length === 0) return result;

  // quoteRequestId -> (quoteRequestItemId -> preco)
  const priceByQuote = new Map<number, Map<number, FinalPrice | null>>();

  const responses = await client.quoteResponse.findMany({
    where: { quoteRequestId: { in: quoteIds }, isWinner: true, deletedAt: null },
    select: {
      quoteRequestId: true,
      currency: true,
      offeredIncoterm: true,
      items: {
        where: { deletedAt: null, quoteRequestItemId: { in: quoteItemIds } },
        select: {
          quoteRequestItemId: true,
          unitPrice: true,
          isUnavailable: true,
          quoteRequestItem: { select: { unit: true } },
        },
      },
    },
  });
  for (const response of responses) {
    if (priceByQuote.has(response.quoteRequestId)) continue;
    const prices = new Map<number, FinalPrice | null>();
    for (const item of response.items) {
      prices.set(
        item.quoteRequestItemId,
        item.isUnavailable
          ? null
          : {
              unitPrice: toFixed2(item.unitPrice),
              currency: response.currency,
              incoterm: response.offeredIncoterm,
              unit: item.quoteRequestItem.unit,
            },
      );
    }
    priceByQuote.set(response.quoteRequestId, prices);
  }

  const quotesWithoutResponse = quoteIds.filter((id) => !priceByQuote.has(id));
  if (quotesWithoutResponse.length > 0) {
    const credits = await client.creditSupportRequest.findMany({
      where: { quoteRequestId: { in: quotesWithoutResponse }, isWinner: true },
      select: {
        quoteRequestId: true,
        currency: true,
        offeredIncoterm: true,
        items: {
          where: { quoteRequestItemId: { in: quoteItemIds } },
          select: {
            quoteRequestItemId: true,
            partnerUnitPrice: true,
            isUnavailable: true,
            unit: true,
          },
        },
      },
    });
    for (const credit of credits) {
      if (priceByQuote.has(credit.quoteRequestId)) continue;
      const prices = new Map<number, FinalPrice | null>();
      for (const item of credit.items) {
        prices.set(
          item.quoteRequestItemId,
          item.isUnavailable || item.partnerUnitPrice === null
            ? null
            : {
                unitPrice: toFixed2(item.partnerUnitPrice),
                currency: credit.currency,
                incoterm: credit.offeredIncoterm,
                unit: item.unit,
              },
        );
      }
      priceByQuote.set(credit.quoteRequestId, prices);
    }
  }

  for (const row of eligible) {
    const prices = priceByQuote.get(row.quoteRequestId as number);
    if (!prices) continue;
    for (const item of row.items) {
      if (item.quoteRequestItemId === null || item.quoteRequestItemId === undefined) continue;
      result.set(item.id, prices.get(item.quoteRequestItemId) ?? null);
    }
  }

  return result;
}
