// Nome de item novo digitado pelo comercial (solicitacao de desenvolvimento).
// O web tem copia identica de normalizeItemNameKey em pages/Solicitacoes/itemNovo.ts.

/** trim + espacos internos colapsados ("  Acido   Citrico " -> "Acido Citrico"). */
export function cleanProposedName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Chave de comparacao: nome limpo, sem acento e em minusculas ("Ácido  Cítrico" -> "acido citrico"). */
export function normalizeItemNameKey(raw: string): string {
  return cleanProposedName(raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
