// Meses atipicos do Forecast (PR 6c): funcoes PURAS que ligam os meses marcados de um produto (YYYY-MM) aos indices
// da janela de vendas da quinzena. Sem banco e sem HTTP, nem planilha: o provedor das marcas (hoje o cadastro ATUAL,
// ForecastMesesAtipicosService.doProdutos) so precisa devolver { anoMes, motivo }.
//
// Indices (os mesmos de OpcoesCalculo.mesesForaDaMedia no motor): 0..4 = J..N (base-6 .. base-2), 5 = O (base-1),
// 6 = P (mes base, venda ate o dia 15). Mes fora dessa janela e ignorado: a marca continua gravada e volta a valer
// em outra quinzena cuja janela o contenha.
import { mesesHistorico, yearMonthsDaJanela } from './forecastMonths';

export const INDICE_MES_ATUAL = 6;

export interface MesMarcado {
  anoMes: string;
  motivo: string;
}

export interface MesMarcadoNaJanela extends MesMarcado {
  /** 0..5 = J..O, 6 = P (mes atual). */
  indice: number;
}

// Os 7 meses da janela de vendas da quinzena, na ordem dos indices (J..N, O, P).
export function mesesDaJanelaDeVendas(baseDate: string): string[] {
  const { historico, anterior } = mesesHistorico(baseDate);
  return [...historico, anterior, yearMonthsDaJanela(baseDate, 1)[0]];
}

// Indices dos meses informados que estao na janela da quinzena (os demais sao ignorados).
export function indicesForaDaMedia(baseDate: string, anoMeses: string[]): Set<number> {
  const janela = mesesDaJanelaDeVendas(baseDate);
  const indices = new Set<number>();
  for (const anoMes of anoMeses) {
    const i = janela.indexOf(anoMes);
    if (i >= 0) indices.add(i);
  }
  return indices;
}

// Marcas do produto que cabem na janela, em ordem de indice (cronologica).
export function marcasNaJanela(baseDate: string, marcas: MesMarcado[]): MesMarcadoNaJanela[] {
  const janela = mesesDaJanelaDeVendas(baseDate);
  return marcas
    .flatMap((m) => {
      const indice = janela.indexOf(m.anoMes);
      return indice >= 0 ? [{ ...m, indice }] : [];
    })
    .sort((a, b) => a.indice - b.indice);
}

// Mapa para `calcular(q, { mesesForaDaMedia })`: chave = Produto.linha. `marcados` = anoMes por productId do cadastro;
// produto sem productId (fora do cadastro) ou sem marca na janela nao entra no mapa (calculo identico ao da planilha).
export function mapaForaDaMedia(
  produtos: Array<{ linha: number; productId?: number | null }>,
  marcados: ReadonlyMap<number, string[]>,
  baseDate: string,
): Map<number, Set<number>> {
  const mapa = new Map<number, Set<number>>();
  for (const p of produtos) {
    if (p.productId == null) continue;
    const indices = indicesForaDaMedia(baseDate, marcados.get(p.productId) ?? []);
    if (indices.size > 0) mapa.set(p.linha, indices);
  }
  return mapa;
}
