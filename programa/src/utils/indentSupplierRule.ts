// Restricao de fornecedores por cliente no IQ Indent (so no backend; o front apenas exibe o resultado).

export type IndentRuleMode = 'LIVRE' | 'APROVADOS' | 'BLOQUEIO';

export const BLOCKED_REASON_APPROVED_ONLY = 'Fora da lista de fornecedores aprovados do cliente';
export const BLOCKED_REASON_BLOCKLIST = 'Fornecedor bloqueado por este cliente';

export interface SupplierRuleResult {
  allowed: boolean;
  blockedReason: string | null;
}

/**
 * APROVADOS: so quem esta na lista. BLOQUEIO: todos, menos quem esta na lista. LIVRE: todos.
 * `hasPartnership` NAO entra na regra.
 */
export function evaluateSupplierRule(
  mode: IndentRuleMode,
  ruleSupplierIds: Set<number>,
  supplierId: number,
): SupplierRuleResult {
  if (mode === 'APROVADOS' && !ruleSupplierIds.has(supplierId)) {
    return { allowed: false, blockedReason: BLOCKED_REASON_APPROVED_ONLY };
  }
  if (mode === 'BLOQUEIO' && ruleSupplierIds.has(supplierId)) {
    return { allowed: false, blockedReason: BLOCKED_REASON_BLOCKLIST };
  }
  return { allowed: true, blockedReason: null };
}

/**
 * Cobertura do fornecedor: quantos itens do pedido ele ja forneceu (produto no seu catalogo).
 * Item sem produto (`null`) conta no total e nunca e coberto.
 */
export function computeCoverage(
  itemProductIds: Array<number | null>,
  supplierProductIds: Set<number>,
): { covered: number; total: number } {
  const covered = itemProductIds.filter((id) => id !== null && supplierProductIds.has(id)).length;
  return { covered, total: itemProductIds.length };
}
