import { Incoterm, Prisma } from '@prisma/client';

// Regra unica de montagem dos dados de um QuoteRequestItem (Novo item, criacao de
// cotacao a partir de solicitacao do comercial e vinculo a cotacao existente).
// Funcao pura: a validacao (catalogo ativo, PO da cotacao, formato) fica no chamador.
export interface QuoteRequestItemFactoryInput {
  quoteRequestId: number;
  catalogItemId: number | null;
  // Nome comercial do catalogo (usado quando nao ha texto livre).
  catalogCommercialName?: string | null;
  // Texto livre informado pelo usuario (ja validado como nao vazio, ou undefined).
  productName?: string | null;
  itemCode?: string | null;
  description?: string | null;
  quantity: number;
  unit: string;
  desiredIncoterm?: string | null;
  destinationPort?: string | null;
  // Porto padrao da cotacao, herdado quando o item nao trouxe porto proprio.
  quoteDestinationPort?: string | null;
  targetPrice?: number | string | null;
  notes?: string | null;
  purchaseOrderId?: number | null;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildQuoteRequestItemCreateData(
  input: QuoteRequestItemFactoryInput,
): Prisma.QuoteRequestItemUncheckedCreateInput {
  // productName fica com o nome comercial (uso interno); o fornecedor vera o marketName.
  const productName = hasText(input.productName)
    ? input.productName.trim()
    : (input.catalogCommercialName ?? '');

  // Se o item nao trouxe incoterm proprio, fica null -- a exibicao resolve o fallback
  // exibindo os incoterms aceitos pela cotacao.
  // Porto: se o item nao trouxe porto proprio, herda da cotacao.
  return {
    quoteRequestId: input.quoteRequestId,
    catalogItemId: input.catalogItemId,
    itemCode: hasText(input.itemCode) ? input.itemCode.trim().toUpperCase() : null,
    productName,
    description: hasText(input.description) ? input.description.trim() : null,
    quantity: Number(input.quantity),
    unit: input.unit.trim().toUpperCase(),
    desiredIncoterm: input.desiredIncoterm ? (String(input.desiredIncoterm) as Incoterm) : null,
    destinationPort: hasText(input.destinationPort)
      ? input.destinationPort.trim()
      : (input.quoteDestinationPort ?? null),
    targetPrice:
      input.targetPrice !== undefined && input.targetPrice !== null
        ? Number(input.targetPrice)
        : null,
    notes: hasText(input.notes) ? input.notes.trim() : null,
    purchaseOrderId: input.purchaseOrderId ?? null,
  };
}
