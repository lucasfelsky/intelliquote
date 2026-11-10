// Regras PURAS do vinculo cotacao <-> Forecast (E4a do relatorio de compras enxuto): quantidade e codigo da cotacao (espelho
// de web/src/pages/Forecast/forecastGerarCotacaoRegras.ts) e status derivado do item. Sem banco e sem HTTP.
import type { StatusCompra } from './forecastTypes';

/** Maior inteiro aceito pelo banco (`QuoteRequestItem.quantity Int`). */
export const INT_MAX = 2147483647;

export const MOTIVO_SEM_FONTE = 'Item sem fonte.';
export const MOTIVO_SEM_VINCULO = 'Nenhum código deste produto está vinculado a um item do catálogo.';
export const MOTIVO_ACIMA_LIMITE = 'Quantidade acima do limite da cotação.';

/** Teto em kg inteiro; arredonda a 3 casas antes para o ruido de ponto flutuante nao virar +1 kg (mesma regra do front). */
export function kgInteiroParaCima(n: number): number {
  return Math.ceil(Math.round(n * 1000) / 1000);
}

export interface CodigoVinculavel {
  code: string;
  position: number;
  catalogItemId: number | null;
  /** Embalagem principal do produto (`ForecastProductCode.packagingIsPrimary`). */
  principal?: boolean;
}

/**
 * Codigo que vira o item da cotacao: o da embalagem principal (se vinculado ao catalogo); senao o 1o vinculado por
 * `position`; nenhum vinculado = `null`.
 */
export function codigoParaCotacao<T extends CodigoVinculavel>(codes: readonly T[]): T | null {
  const vinculados = codes.filter((c) => c.catalogItemId !== null).sort((a, b) => a.position - b.position);
  return vinculados.find((c) => c.principal === true) ?? vinculados[0] ?? null;
}

/** Chave de comparacao da fonte (igual a `chaveDaFonte` dos candidatos: trim + maiusculas). */
export const chaveFonte = (fonte: string): string => fonte.trim().toUpperCase();

// ---------------------------------------------------------------------------------------------------------------------
// Status derivado (T6). Vocabulario de `statusCotacao` da cotacao vinculada: 'criada' (aberta, ainda nao enviada),
// 'enviada' (aberta e ja enviada a fornecedores), 'fechada', 'po_enviada'. `statusDerivado` do item soma 'cotacao_criada'
// ao vocabulario salvo da decisao.
export type StatusCotacaoVinculada = 'criada' | 'enviada' | 'fechada' | 'po_enviada';
export type StatusDerivado = StatusCompra | 'cotacao_criada';

export interface CotacaoVinculadaData {
  id: number;
  requestCode: string;
  statusCotacao: StatusCotacaoVinculada;
}

export function statusDaCotacao(q: {
  status: 'open' | 'closed';
  purchaseOrderSentAt: Date | null;
  enviada: boolean;
}): StatusCotacaoVinculada {
  if (q.purchaseOrderSentAt) return 'po_enviada';
  if (q.status === 'closed') return 'fechada';
  return q.enviada ? 'enviada' : 'criada';
}

// Ordem de progresso do status da decisao: um gancho so AVANCA, nunca regride (ex.: 'po' e 'preco' nao voltam a 'confirmado').
// Status desconhecido (texto livre no banco) conta como o mais baixo.
const ORDEM_STATUS: Record<StatusCompra, number> = { nao: 0, cotando: 1, confirmado: 2, po: 3, preco: 4 };

export function ordemDoStatus(status: string): number {
  return (ORDEM_STATUS as Record<string, number>)[status] ?? -1;
}

/** Leva `atual` a `alvo` so se `alvo` estiver adiante; senao devolve `atual` (sem regredir). */
export function avancarStatus(atual: StatusCompra, alvo: StatusCompra): StatusCompra {
  return ordemDoStatus(alvo) > ordemDoStatus(atual) ? alvo : atual;
}

// Sem cotacao vinculada vale o status salvo/congelado (itens antigos nao mudam). Criada (nao enviada) = 'cotacao_criada';
// enviada = 'cotando'; fechada = 'confirmado'; PO enviada = 'po'. Em todos os casos sem regredir um status salvo mais
// adiante (preco/po/confirmado): os ganchos de E4a/E4b ja gravam o mesmo status, a leitura so cobre o intervalo entre o
// evento e a gravacao (e cotacoes anteriores ao gancho).
export function statusDerivadoDoItem(salvo: StatusCompra, cotacao: CotacaoVinculadaData | null): StatusDerivado {
  if (!cotacao) return salvo;
  switch (cotacao.statusCotacao) {
    case 'criada':
      return 'cotacao_criada';
    case 'enviada':
      return avancarStatus(salvo, 'cotando');
    case 'fechada':
      return avancarStatus(salvo, 'confirmado');
    case 'po_enviada':
      return avancarStatus(salvo, 'po');
  }
}

/**
 * Qtd. final de UM item no fechamento (E4b): soma das quantidades das respostas VENCEDORAS do item (na pratica uma so: ha no
 * maximo um vencedor por cotacao), ignorando as nao positivas (item indisponivel grava 0). Sem vencedor para o item = a
 * quantidade cotada (nunca zera nem apaga). `origem` diz de onde veio, para o AuditLog.
 */
export function quantidadeFinalNoFechamento(
  cotada: number,
  quantidadesVencedoras: readonly number[],
): { kg: number; origem: 'vencedora' | 'cotada' } {
  const validas = quantidadesVencedoras.filter((q) => Number.isFinite(q) && q > 0);
  if (validas.length === 0) return { kg: cotada, origem: 'cotada' };
  return { kg: validas.reduce((soma, q) => soma + q, 0), origem: 'vencedora' };
}
