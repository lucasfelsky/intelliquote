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

// ---------------------------------------------------------------------------------------------------------------------
// Vincular cotacao EXISTENTE a um item do Forecast (PR2). Regras puras: o service so le/grava e aplica o que daqui sai.

/** So itens em KG entram no Forecast (a quantidade da decisao e em kg). */
export const ehKg = (unit: string): boolean => unit.trim().toUpperCase() === 'KG';

export const MOTIVO_NAO_KG = (unit: string): string => `O item está em ${unit.trim() || 'UN'}; só itens em KG entram no Forecast.`;

export interface VinculoForecast {
  snapshotId: number;
  productId: number;
}

export interface ItemDoProdutoNaCotacao {
  id: number;
  unit: string;
  quantity: number;
  /** Vinculo atual do item da cotacao ao Forecast (nulo = solto). */
  vinculo: VinculoForecast | null;
}

export interface EntradaDecidirVinculo {
  snapshotId: number;
  productId: number;
  quoteRequestId: number;
  requestCode: string;
  cotacaoAberta: boolean;
  /** Itens vivos da cotacao cujo item de catalogo e de QUALQUER embalagem do produto (D6). */
  itensDoProduto: readonly ItemDoProdutoNaCotacao[];
  /** OUTRA cotacao aberta e viva ja ligada a este (quinzena, produto); nulo = nenhuma. */
  outraAbertaLigada: { id: number; requestCode: string } | null;
  substituir: boolean;
}

export type DecisaoDeVinculo =
  | { tipo: 'erro'; status: 400 | 409; motivo: string }
  | { tipo: 'nenhuma' }
  | {
      tipo: 'vincular' | 'trocar';
      /** Itens KG a ligar (os que ainda nao estao ligados a esta quinzena/produto). */
      ligar: number[];
      /** Itens KG que estavam ligados a OUTRA quinzena: o vinculo e MOVIDO (D1). */
      mover: Array<{ itemId: number; de: VinculoForecast }>;
      /** Soma da quantidade (kg) de TODOS os itens KG do produto na cotacao. */
      quantidadeCotada: number;
    };

const erroVinculo = (status: 400 | 409, motivo: string): DecisaoDeVinculo => ({ tipo: 'erro', status, motivo });

/**
 * Decide o que fazer ao ligar uma cotacao existente a (quinzena, produto). Ordem das regras: fechada 409 -> sem item do
 * produto 400 -> nenhum item em KG 400 -> item ligado a OUTRO produto da MESMA quinzena 409 -> tudo ja ligado a este = nenhuma
 * (idempotente) -> outra cotacao aberta ja ligada sem `substituir` 409 / com `substituir` = trocar -> vincular.
 */
export function decidirVinculo(entrada: EntradaDecidirVinculo): DecisaoDeVinculo {
  const { snapshotId, productId, requestCode } = entrada;
  if (!entrada.cotacaoAberta) return erroVinculo(409, `A cotação ${requestCode} está fechada.`);
  if (entrada.itensDoProduto.length === 0) return erroVinculo(400, `A cotação ${requestCode} não tem o item.`);

  const emKg = entrada.itensDoProduto.filter((i) => ehKg(i.unit));
  if (emKg.length === 0) return erroVinculo(400, MOTIVO_NAO_KG(entrada.itensDoProduto[0].unit));

  const aEste = (v: VinculoForecast | null): boolean => v !== null && v.snapshotId === snapshotId && v.productId === productId;
  if (emKg.some((i) => i.vinculo !== null && i.vinculo.snapshotId === snapshotId && i.vinculo.productId !== productId)) {
    return erroVinculo(409, 'Um item da cotação já está ligado a outro produto desta quinzena.');
  }
  if (emKg.every((i) => aEste(i.vinculo))) return { tipo: 'nenhuma' };

  if (entrada.outraAbertaLigada && entrada.outraAbertaLigada.id !== entrada.quoteRequestId && entrada.substituir !== true) {
    return erroVinculo(409, `O item já está na cotação aberta ${entrada.outraAbertaLigada.requestCode}. Use Trocar.`);
  }

  const quantidadeCotada = emKg.reduce((soma, i) => soma + i.quantity, 0);
  if (quantidadeCotada > INT_MAX) return erroVinculo(400, MOTIVO_ACIMA_LIMITE);

  const mover: Array<{ itemId: number; de: VinculoForecast }> = [];
  for (const i of emKg) {
    if (i.vinculo !== null && i.vinculo.snapshotId !== snapshotId) mover.push({ itemId: i.id, de: i.vinculo });
  }
  return {
    tipo: entrada.outraAbertaLigada && entrada.outraAbertaLigada.id !== entrada.quoteRequestId ? 'trocar' : 'vincular',
    ligar: emKg.filter((i) => !aEste(i.vinculo)).map((i) => i.id),
    mover,
    quantidadeCotada,
  };
}

/**
 * Efeito, na decisao do item, de SAIR de uma cotacao (desvincular ou trocar): a Qtd. final e zerada se veio dessa cotacao
 * (volta a "-", como antes do envio) e o status volta a 'nao' SO se estava 'cotando' (o unico status que uma cotacao ABERTA
 * grava, via envio) e o item nao ficou com outra cotacao ativa. 'confirmado'/'po'/'preco' vem de fechamento, PO ou preco
 * fechado e NAO regridem. Esta e a UNICA excecao a regra "nunca regride"; vale so para desvincular/trocar: `avancarStatus` e os
 * ganchos de envio/fechamento/PO seguem sem regredir.
 */
export function decisaoAoSairDaCotacao(
  atual: { status: StatusCompra; finalQuoteRequestId: number | null },
  quoteRequestIdAntiga: number,
  ficaComOutraAtiva: boolean,
): { status: StatusCompra; zerarFinal: boolean } {
  return {
    zerarFinal: atual.finalQuoteRequestId === quoteRequestIdAntiga,
    status: !ficaComOutraAtiva && atual.status === 'cotando' ? 'nao' : atual.status,
  };
}

export interface PatchDeEntradaNaCotacao {
  finalKg?: number;
  finalAt?: Date;
  finalQuoteRequestId?: number;
  status?: StatusCompra;
  /** Campos que mudam (vazio = nada a gravar). */
  camposAlterados: string[];
}

/**
 * Efeito, na decisao do item, de ENTRAR numa cotacao (vincular/trocar): cotacao nao enviada nao grava nada; ja enviada aplica
 * a regra do envio (D4) com a mesma semantica de `registrarEnvio`: Qtd. final = quantidade cotada, `finalAt` (mantido se a
 * Qtd. final ja era desta cotacao), `finalQuoteRequestId` e status 'nao' -> 'cotando' (sem regredir os demais).
 */
export function decisaoAoEntrarNaCotacao(
  atual: { status: StatusCompra; finalKg: number | null; finalAt: Date | null; finalQuoteRequestId: number | null },
  entrada: { quoteRequestId: number; enviada: boolean; quantidadeCotada: number },
  agora: Date,
): PatchDeEntradaNaCotacao {
  if (!entrada.enviada) return { camposAlterados: [] };
  const primeiroEnvio = atual.finalQuoteRequestId !== entrada.quoteRequestId || atual.finalAt === null;
  const status: StatusCompra = atual.status === 'nao' ? 'cotando' : atual.status;
  const mudou = primeiroEnvio || atual.finalKg !== entrada.quantidadeCotada || status !== atual.status;
  if (!mudou) return { camposAlterados: [] };
  return {
    finalKg: entrada.quantidadeCotada,
    finalAt: primeiroEnvio ? agora : (atual.finalAt as Date),
    finalQuoteRequestId: entrada.quoteRequestId,
    status,
    camposAlterados: ['finalKg', ...(primeiroEnvio ? ['finalAt'] : []), 'finalQuoteRequestId', ...(status !== atual.status ? ['status'] : [])],
  };
}
