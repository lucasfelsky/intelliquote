// Quantidade decidida de compra (PR3 do piloto do Forecast): funcoes PURAS, sem banco e sem HTTP.
// A decisao vive em `ForecastPurchaseDecision` (por quinzena e produto). Na planilha ela e a coluna AO ("ANALISE
// FORECAST"): o XLSX MACRO exporta a decisao em AO quando existe, senao o `analiseForecast` congelado da quinzena. O
// motor NAO le a decisao (AO nao entra no calculo nem na conferencia).
import type { ItemRelatorioCompras, RelatorioCompras } from './forecastRelatorioCompras';
import { statusDerivadoDoItem, type CotacaoVinculadaData, type StatusDerivado } from './forecastCotacaoVinculo';
import type { StatusCompra } from './forecastTypes';

export interface DecisaoCompraData {
  productId: number;
  quantidadeKg: number;
  status: StatusCompra;
  observacao: string | null;
  /** Qtd. final do relatorio no momento em que a quantidade foi decidida (congelada). */
  sugeridaKg: number;
  /** AN do motor (sinal da planilha: <= 0 = falta) no momento em que a quantidade foi decidida (congelada). */
  demandaKg: number;
  /** E3: item de fora da lista de compra incluido de proposito (candidato a cotacao); false nos demais. */
  incluidoManualmente: boolean;
  decididaPorId: number | null;
  /** ISO 8601. */
  criadaEm: string;
  /** ISO 8601. */
  atualizadaEm: string;
}

// Subconjunto da linha do Prisma que o mapeamento precisa (Decimal chega como objeto com Number()).
export interface DecisaoCompraLinha {
  productId: number;
  quantityKg: unknown;
  status: string;
  note: string | null;
  suggestedKg: unknown;
  demandKg: unknown;
  decidedById: number | null;
  /** Ausente = false (linhas montadas antes da coluna existir, ex.: testes). */
  manuallyIncluded?: boolean;
  /** E4a: ausente = nulo (linhas montadas antes das colunas existirem, ex.: testes). */
  finalKg?: unknown;
  finalAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function paraDecisaoCompraData(row: DecisaoCompraLinha): DecisaoCompraData {
  return {
    productId: row.productId,
    quantidadeKg: Number(row.quantityKg),
    status: row.status as StatusCompra,
    observacao: row.note,
    sugeridaKg: Number(row.suggestedKg),
    demandaKg: Number(row.demandKg),
    incluidoManualmente: row.manuallyIncluded === true,
    decididaPorId: row.decidedById,
    criadaEm: row.createdAt.toISOString(),
    atualizadaEm: row.updatedAt.toISOString(),
  };
}

// Leitura da decisao com o vinculo a cotacao (E4a): campos ADITIVOS sobre `DecisaoCompraData` (a base nao muda, entao o PUT e o
// XLSX seguem iguais). `cotacao` = a cotacao viva mais recente vinculada ao item (ou null); `finalKg`/`finalAt` = Qtd. final
// (nasce nula, gravada no envio); `statusDerivado` segue a regra T6 (ver forecastCotacaoVinculo.ts).
export interface DecisaoCompraLeitura extends DecisaoCompraData {
  cotacao: CotacaoVinculadaData | null;
  finalKg: number | null;
  /** ISO 8601. */
  finalAt: string | null;
  statusDerivado: StatusDerivado;
}

export function paraDecisaoCompraLeitura(
  row: DecisaoCompraLinha,
  cotacao: CotacaoVinculadaData | null,
): DecisaoCompraLeitura {
  const base = paraDecisaoCompraData(row);
  return {
    ...base,
    cotacao,
    finalKg: row.finalKg === null || row.finalKg === undefined ? null : Number(row.finalKg),
    finalAt: row.finalAt ? row.finalAt.toISOString() : null,
    statusDerivado: statusDerivadoDoItem(base.status, cotacao),
  };
}

// Item da lista de compra (grupos[].itens) do produto; so ele aceita decisao nova ou mudanca de quantidade. A linha de um
// grupo de equivalencia carrega o productId do principal.
export function itemDaListaDeCompra(r: RelatorioCompras, productId: number): ItemRelatorioCompras | null {
  for (const grupo of r.grupos) {
    const item = grupo.itens.find((i) => i.productId === productId);
    if (item) return item;
  }
  return null;
}

// Quinzena para o XLSX MACRO: a coluna AO (`analiseForecast`) recebe a decisao (0 conta) e, sem decisao, mantem o valor
// congelado. Devolve um array novo e nao muta a entrada.
export function produtosComDecisao<P extends { productId?: number | null; analiseForecast: number | null }>(
  produtos: P[],
  mapa: ReadonlyMap<number, DecisaoCompraData>,
): P[] {
  return produtos.map((p) => {
    const decisao = p.productId != null ? mapa.get(p.productId) : undefined;
    return decisao ? { ...p, analiseForecast: decisao.quantidadeKg } : p;
  });
}

// Relatorio para o XLSX: so os itens da lista de compra (grupos[].itens) ganham `decisao`. Novo objeto; nao muta.
export function anexarDecisoesAoRelatorio(
  r: RelatorioCompras,
  mapa: ReadonlyMap<number, DecisaoCompraData>,
): RelatorioCompras {
  return {
    ...r,
    grupos: r.grupos.map((g) => ({
      ...g,
      itens: g.itens.map((item) => ({
        ...item,
        decisao: item.productId != null ? (mapa.get(item.productId) ?? null) : null,
      })),
    })),
  };
}
