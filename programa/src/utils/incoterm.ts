import { Incoterm, Prisma } from '@prisma/client';

export const ALL_INCOTERMS: readonly Incoterm[] = Object.values(Incoterm);

// Vazio = todos; gravamos os 11 para os `includes` do QuoteResponseController
// continuarem valendo. Dedup + ordem canonica do enum.
export function normalizeAcceptedIncoterms(list: readonly Incoterm[]): Incoterm[] {
  if (list.length === 0) return [...ALL_INCOTERMS];
  const set = new Set(list);
  return ALL_INCOTERMS.filter((term) => set.has(term));
}

export function formatIncoterms(incoterms: Incoterm[]): string {
  return incoterms.join(' / ');
}

// Edicao manual (PUT do comprador) recria os itens: preserva o historico de
// `incotermPrices` do portal, ajustando o incoterm principal ao novo preco e
// recalculando totalPrice pela quantidade nova. Se o incoterm principal mudou
// para um ausente na lista, ACRESCENTA a entrada (mantem o invariante do portal:
// o principal esta na lista e seu preco == unitPrice do item).
export function mergeManualIncotermPrices(
  previous: Prisma.JsonValue | null | undefined,
  mainIncoterm: Incoterm,
  unitPrice: number,
  quantity: number,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!Array.isArray(previous)) return Prisma.DbNull;
  const entries: Array<{ incoterm: string; unitPrice: number }> = [];
  for (const raw of previous) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    // O portal grava unitPrice como string decimal ("10.00"); aceita string ou number.
    const valid =
      (typeof entry.unitPrice === 'number' ||
        (typeof entry.unitPrice === 'string' && entry.unitPrice.trim() !== '')) &&
      Number.isFinite(Number(entry.unitPrice));
    if (typeof entry.incoterm !== 'string' || !valid) continue;
    entries.push({ incoterm: entry.incoterm, unitPrice: Number(entry.unitPrice) });
  }
  if (entries.length === 0) return Prisma.DbNull;
  const main = entries.find((entry) => entry.incoterm === mainIncoterm);
  if (main) {
    main.unitPrice = unitPrice;
  } else {
    entries.push({ incoterm: mainIncoterm, unitPrice });
  }
  return entries.map((entry) => ({
    incoterm: entry.incoterm,
    unitPrice: new Prisma.Decimal(entry.unitPrice).toFixed(2),
    totalPrice: new Prisma.Decimal(entry.unitPrice).times(quantity).toFixed(2),
  }));
}
