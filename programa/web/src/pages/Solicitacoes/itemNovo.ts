// Item novo (solicitacao de desenvolvimento): helpers puros, sem React.

export const NEW_ITEM_BADGE = 'Item novo';
export const DEVELOPMENT_BADGE = 'Desenvolvimento';

/** Igual a cleanProposedName do backend (src/utils/commercialItemName.ts): trim + espacos colapsados. */
export function cleanProposedName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Igual a normalizeItemNameKey do backend: sem acento, minusculas, espacos colapsados. */
export function normalizeItemNameKey(raw: string): string {
  return cleanProposedName(raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * O termo digitado e igual (ignorando acento, caixa e espacos) ao nome de algum item
 * cadastrado retornado pela busca? Se sim, o comercial deve selecionar o item, nao criar um novo.
 */
export function hasExactCatalogMatch(
  term: string,
  results: ReadonlyArray<{ commercialName: string }>,
): boolean {
  const key = normalizeItemNameKey(term);
  if (key === '') return false;
  return results.some((item) => normalizeItemNameKey(item.commercialName) === key);
}
