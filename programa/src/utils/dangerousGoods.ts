// Itens marcados como Dangerous Goods (DG) pelo fornecedor na resposta. Informativo:
// NAO entra em landed cost, score nem desempate. Item indisponivel nunca conta como DG
// e revisoes/respostas antigas sem o campo tratam ausente como false.
export type DangerousGoodItem = {
  quoteRequestItemId: number;
  productName: string;
};

type DangerousGoodSource = {
  quoteRequestItemId: number;
  isDangerousGood?: boolean | null;
  isUnavailable?: boolean | null;
  quoteRequestItem?: { productName?: string | null } | null;
};

export function buildDangerousGoodItems(
  items: DangerousGoodSource[] | null | undefined,
): DangerousGoodItem[] {
  return (items ?? [])
    .filter((item) => item.isDangerousGood === true && item.isUnavailable !== true)
    .map((item) => ({
      quoteRequestItemId: item.quoteRequestItemId,
      productName: item.quoteRequestItem?.productName ?? '',
    }));
}
