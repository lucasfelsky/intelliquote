import { Prisma } from '@prisma/client';
import { HttpError } from './http';

type Amount = number | string | Prisma.Decimal;
type RequestItem = { id: number; quantity: Amount };
type ResponseItem = { quoteRequestItemId: number; quantity: Amount; unitPrice: Amount };

// O preço agregado não é confiável nas respostas antigas do portal: continha
// somente o preço unitário do primeiro item. Recalcular também na leitura evita
// depender de um backfill destrutivo dos dados e comparações históricas.
export function sumQuoteItems(items: ResponseItem[]): number {
  let total = new Prisma.Decimal(0);
  const seen = new Set<number>();
  for (const item of items) {
    const quantity = new Prisma.Decimal(item.quantity);
    const price = new Prisma.Decimal(item.unitPrice);
    if (seen.has(item.quoteRequestItemId) || !quantity.isFinite() || quantity.lte(0) ||
        !price.isFinite() || price.lte(0)) {
      throw new HttpError(400, 'A proposta contem itens duplicados ou precos/quantidades invalidos.');
    }
    seen.add(item.quoteRequestItemId);
    total = total.plus(price.times(quantity));
  }
  return total.toDecimalPlaces(2).toNumber();
}

export function priceForComparison(
  requestedItems: RequestItem[],
  response: { id: number; offeredPrice: Amount; items?: ResponseItem[] },
): number {
  const items = response.items ?? [];
  // Cotações legadas sem detalhamento conservam seu contrato de preço agregado.
  if (requestedItems.length === 0 && items.length === 0) return Number(response.offeredPrice);
  const requested = new Map(requestedItems.map(item => [item.id, item.quantity]));
  if (items.length !== requested.size || items.some(item =>
    !requested.has(item.quoteRequestItemId) ||
    !new Prisma.Decimal(item.quantity).equals(requested.get(item.quoteRequestItemId)!),
  )) {
    throw new HttpError(400,
      `Proposta #${response.id}: para comparar, informe todos os itens nas quantidades solicitadas. Propostas parciais ou com quantidades diferentes precisam ser ajustadas.`,
    );
  }
  return sumQuoteItems(items);
}
