// Colunas da quantidade decidida de compra (PR3) no XLSX do relatorio. Modulo proprio e SEM import de
// forecastRelatorioComprasXlsx.ts: o relatorio importa daqui (spread de `as const` em constante de modulo), entao um import
// no sentido contrario criaria ciclo e o spread cairia na zona morta (TDZ).
import type { DecisaoCompraData } from './forecastDecisaoCompra';

// Entram imediatamente antes de 'Observacao', que continua a ultima coluna.
export const COLUNAS_DECISAO_XLSX = ['Qtd. decidida (kg)', 'Status da decisão', 'Obs. da decisão'] as const;
export const LARGURAS_DECISAO_XLSX = [14, 24, 40];
// Texto livre/rotulo longo: quebra linha em vez de cortar.
export const TEXTO_QUEBRA_DECISAO_XLSX = ['Status da decisão', 'Obs. da decisão'] as const;

// 3 valores, na ordem de COLUNAS_DECISAO_XLSX. Sem decisao = celulas vazias. A quantidade sai como numero (0 e uma decisao
// valida: nao comprar); o status usa os mesmos rotulos da coluna Status da tela.
export function celulasDaDecisao(
  decisao: DecisaoCompraData | null | undefined,
  rotulos: Record<string, string>,
): Array<string | number> {
  if (!decisao) return ['', '', ''];
  return [decisao.quantidadeKg, rotulos[decisao.status] ?? decisao.status, decisao.observacao ?? ''];
}
