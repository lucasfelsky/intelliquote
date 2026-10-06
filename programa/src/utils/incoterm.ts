import { Incoterm } from '@prisma/client';

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
