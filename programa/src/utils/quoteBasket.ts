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

function partialProposalError(responseId: number): HttpError {
  return new HttpError(400,
    `Proposta #${responseId}: para comparar, informe todos os itens nas quantidades solicitadas. Propostas parciais ou com quantidades diferentes precisam ser ajustadas.`,
  );
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
    throw partialProposalError(response.id);
  }
  return sumQuoteItems(items);
}

// Por que uma proposta NAO cobre a cesta pedida (motivos estruturados, ids da cotacao).
export type PartialBasketDetails = {
  missingItemIds: number[];                 // pedido na cotacao, ausente na proposta
  quantityMismatches: QuantityMismatch[];   // item presente, quantidade cotada != pedida
  extraItemIds: number[];                   // item da proposta que nao pertence (mais) a cotacao (soft-deleted/removido)
  duplicateItemIds: number[];               // mesmo quoteRequestItemId repetido
};

export type QuantityMismatch = { quoteRequestItemId: number; requested: number; offered: number };

export type ComparisonClassification =
  // cobre a cesta pedida -> preco da cesta (priceForComparison, inalterado)
  | { kind: 'complete'; price: number }
  // todos os itens presentes, so a quantidade difere -> ENTRA no ranking com o unitario cotado
  // x quantidade PEDIDA (sinalizada na UI; pode vencer)
  | { kind: 'adjusted'; price: number; quantityMismatches: QuantityMismatch[] }
  // o UNICO motivo de nao cobrir a cesta sao itens marcados como indisponiveis -> fora do ranking
  | { kind: 'unavailable'; unavailableItemIds: number[] }
  // item faltando (pode ser escolhida manualmente) ou item extra/duplicado (dado inconsistente,
  // nao pode vencer) -> fora do ranking com os motivos
  | { kind: 'partial'; details: PartialBasketDetails; unavailableItemIds: number[] };

// Item extra (nao pertence mais a cotacao) ou duplicado = dado inconsistente: a proposta nao
// pode ser vencedora nem manualmente.
export function isInconsistentBasket(details: PartialBasketDetails): boolean {
  return details.extraItemIds.length > 0 || details.duplicateItemIds.length > 0;
}

// Passe unico sobre os itens da proposta contra a cesta pedida. Item marcado como
// indisponivel nao tem a quantidade conferida (o fornecedor nao cotou aquele item).
function diffBasket(
  requestedItems: RequestItem[],
  items: (ResponseItem & { isUnavailable?: boolean })[],
): PartialBasketDetails {
  const requested = new Map(requestedItems.map((item) => [item.id, item.quantity]));
  const seen = new Set<number>();
  const details: PartialBasketDetails = {
    missingItemIds: [],
    quantityMismatches: [],
    extraItemIds: [],
    duplicateItemIds: [],
  };
  for (const item of items) {
    const id = item.quoteRequestItemId;
    if (seen.has(id)) {
      details.duplicateItemIds.push(id);
      continue;
    }
    seen.add(id);
    const requestedQuantity = requested.get(id);
    if (requestedQuantity === undefined) {
      details.extraItemIds.push(id);
      continue;
    }
    if (item.isUnavailable) continue;
    if (!new Prisma.Decimal(item.quantity).equals(requestedQuantity)) {
      details.quantityMismatches.push({
        quoteRequestItemId: id,
        requested: Number(requestedQuantity),
        offered: Number(item.quantity),
      });
    }
  }
  for (const id of requested.keys()) {
    if (!seen.has(id)) details.missingItemIds.push(id);
  }
  return details;
}

// Preco da proposta "a quantidade pedida": soma de unitPrice cotado x quantidade PEDIDA dos
// itens disponiveis que pertencem a cesta (mesma soma/arredondamento do sumQuoteItems, que
// segue intacto). Usado para proposta com quantidade divergente (entra no ranking) e para o
// gate de alcada da escolha manual de proposta com item faltando.
export function priceAtRequestedQuantity(
  requestedItems: RequestItem[],
  items: (ResponseItem & { isUnavailable?: boolean })[],
): number {
  const requested = new Map(requestedItems.map((item) => [item.id, item.quantity]));
  let total = new Prisma.Decimal(0);
  const seen = new Set<number>();
  for (const item of items) {
    if (item.isUnavailable) continue;
    const requestedQuantity = requested.get(item.quoteRequestItemId);
    if (requestedQuantity === undefined) continue;
    const quantity = new Prisma.Decimal(requestedQuantity);
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

// Classifica uma proposta para a comparacao (ver ComparisonClassification). UMA proposta
// parcial nao derruba mais a comparacao inteira: nenhum 400 de "proposta parcial" e lancado
// aqui. Preco/quantidade invalidos continuam lancando o 400 de sumQuoteItems (dado invalido).
export function classifyForComparison(
  requestedItems: RequestItem[],
  response: {
    id: number;
    offeredPrice: Amount;
    items?: (ResponseItem & { isUnavailable?: boolean })[];
  },
): ComparisonClassification {
  const items = response.items ?? [];
  // Cotacoes legadas sem detalhamento conservam seu contrato de preco agregado.
  if (requestedItems.length === 0 && items.length === 0) {
    return { kind: 'complete', price: Number(response.offeredPrice) };
  }
  const unavailableItemIds = items
    .filter((item) => item.isUnavailable)
    .map((item) => item.quoteRequestItemId);
  const details = diffBasket(requestedItems, items);
  if (isInconsistentBasket(details) || details.missingItemIds.length > 0) {
    return { kind: 'partial', details, unavailableItemIds };
  }
  if (unavailableItemIds.length > 0) {
    return { kind: 'unavailable', unavailableItemIds };
  }
  if (details.quantityMismatches.length > 0) {
    return {
      kind: 'adjusted',
      price: priceAtRequestedQuantity(requestedItems, items),
      quantityMismatches: details.quantityMismatches,
    };
  }
  return { kind: 'complete', price: priceForComparison(requestedItems, response) };
}

// Texto em portugues (backend) com as partes presentes dos motivos, separadas por "; ".
export function describePartialBasket(
  details: PartialBasketDetails,
  nameOf: (id: number) => string,
): string {
  const parts: string[] = [];
  if (details.missingItemIds.length > 0) {
    parts.push(`faltam itens: ${details.missingItemIds.map(nameOf).join(', ')}`);
  }
  if (details.quantityMismatches.length > 0) {
    parts.push(
      `quantidade diferente em ${details.quantityMismatches
        .map((m) => `${nameOf(m.quoteRequestItemId)} (pedido ${Number(m.requested)}, cotado ${Number(m.offered)})`)
        .join(', ')}`,
    );
  }
  if (details.extraItemIds.length > 0) {
    parts.push(`item nao pertence mais a cotacao: ${details.extraItemIds.map(nameOf).join(', ')}`);
  }
  if (details.duplicateItemIds.length > 0) {
    parts.push(`item duplicado: ${details.duplicateItemIds.map(nameOf).join(', ')}`);
  }
  return parts.join('; ');
}
