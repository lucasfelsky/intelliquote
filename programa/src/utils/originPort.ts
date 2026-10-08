// Porto de origem informado pelo fornecedor (geral da proposta + por item).
// Informativo: nao entra em frete, landed cost, score nem desempate.
//
// Regra de heranca (espelhada em public/portal.html e em web/src/services/quoteResponses.ts):
//  - gravar item: vazio/igual a geral => null (= herda); senao o valor trimado
//  - exibir item: item || geral || null

export const ORIGIN_PORT_MAX_LENGTH = 120;

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function sameOrigin(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = clean(a);
  const right = clean(b);
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

/** Valor a persistir no item: null quando vazio ou igual a geral (= herda). */
export function normalizeItemOriginPort(
  item: string | null | undefined,
  general: string | null | undefined,
): string | null {
  const value = clean(item);
  if (!value) return null;
  if (sameOrigin(value, general)) return null;
  return value;
}

/** Origem efetiva de um item: a propria, ou a geral quando herda. */
export function effectiveOriginPort(
  item: string | null | undefined,
  general: string | null | undefined,
): string | null {
  return clean(item) ?? clean(general) ?? null;
}

export interface ItemOriginInput {
  quoteRequestItemId: number;
  originPort?: string | null;
  quoteRequestItem?: { productName?: string | null } | null;
}

export interface ItemOrigin {
  quoteRequestItemId: number;
  productName: string | null;
  originPort: string | null;
  overridden: boolean;
}

export function buildItemOrigins(
  items: ItemOriginInput[] | null | undefined,
  general: string | null | undefined,
): ItemOrigin[] {
  return (items ?? []).map((item) => {
    const own = clean(item.originPort);
    return {
      quoteRequestItemId: item.quoteRequestItemId,
      productName: item.quoteRequestItem?.productName ?? null,
      originPort: effectiveOriginPort(own, general),
      overridden: own !== null && !sameOrigin(own, general),
    };
  });
}
