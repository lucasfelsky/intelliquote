// Regras puras do "Gerar cotacao" a partir de uma linha do relatorio de compras (piloto PR6): formato do link, escolha do codigo
// vinculado ao catalogo, quantidade em kg inteiro e motivos para o botao ficar desabilitado. Sem React nem HTTP.

export const PARAM_FROM_FORECAST = 'fromForecast';

/** Maior inteiro aceito pelo banco (`QuoteRequestItem.quantity Int`, ids). */
export const INT_MAX = 2147483647;

export const MOTIVO_FORA_CADASTRO = 'Item fora do cadastro do Forecast.';
export const MOTIVO_VERIFICANDO = 'Verificando o vínculo com o catálogo…';
export const MOTIVO_ERRO_VINCULO = 'Não foi possível verificar o vínculo com o catálogo. Recarregue a página.';
export const MOTIVO_SEM_VINCULO = 'Nenhum código deste produto está vinculado a um item do catálogo.';
export const MOTIVO_NAO_COMPRAR = 'A decisão salva desta quinzena é não comprar (0 kg).';
export const MOTIVO_SEM_QUANTIDADE = 'Sem quantidade a comprar nesta quinzena.';
export const MOTIVO_ACIMA_LIMITE = 'Quantidade acima do limite da cotação.';

/** `/cotacoes/nova?fromForecast=<snapshotId>-<productId>`. */
export function linkGerarCotacao(snapshotId: number, productId: number): string {
  return `/cotacoes/nova?${PARAM_FROM_FORECAST}=${snapshotId}-${productId}`;
}

export interface ParamFromForecast {
  snapshotId: number;
  productId: number;
}

const REGEX_PARAM = /^([1-9][0-9]{0,9})-([1-9][0-9]{0,9})$/;

/** Ausente = `null` (hook inerte); presente e malformado = `'invalido'`. */
export function lerParamFromForecast(raw: string | null): ParamFromForecast | null | 'invalido' {
  if (raw === null) return null;
  const m = REGEX_PARAM.exec(raw);
  if (!m) return 'invalido';
  const snapshotId = Number(m[1]);
  const productId = Number(m[2]);
  if (snapshotId > INT_MAX || productId > INT_MAX) return 'invalido';
  return { snapshotId, productId };
}

export interface CodigoVinculavel {
  code: string;
  position: number;
  catalogItemId: number | null;
}

/**
 * Codigo que vira o item da cotacao: o da embalagem principal (se vinculado ao catalogo); senao o 1o vinculado por
 * `position`; nenhum vinculado = `null`.
 */
export function codigoParaCotacao<T extends CodigoVinculavel>(
  codes: readonly T[],
  principalCodigo: string | null | undefined,
): T | null {
  const vinculados = codes.filter((c) => c.catalogItemId !== null).sort((a, b) => a.position - b.position);
  const principal = principalCodigo ? vinculados.find((c) => c.code === principalCodigo) : undefined;
  return principal ?? vinculados[0] ?? null;
}

/** Teto em kg inteiro; arredonda a 3 casas antes para o ruido de ponto flutuante nao virar +1 kg. */
export function kgInteiroParaCima(n: number): number {
  return Math.ceil(Math.round(n * 1000) / 1000);
}

export type OrigemQuantidade = 'decidida' | 'sugerida';

export type QuantidadeParaCotacao =
  | { ok: true; quantidade: number; origem: OrigemQuantidade }
  | { ok: false; motivo: string };

/** `decisaoKg` e a quantidade da decisao SALVA (`null`/`undefined` = sem decisao); `quantidadeFinal` e a sugerida do relatorio. */
export function quantidadeParaCotacao(
  decisaoKg: number | null | undefined,
  quantidadeFinal: number,
): QuantidadeParaCotacao {
  const temDecisao = decisaoKg !== null && decisaoKg !== undefined;
  if (temDecisao && decisaoKg === 0) return { ok: false, motivo: MOTIVO_NAO_COMPRAR };
  const bruta = temDecisao ? decisaoKg : quantidadeFinal;
  if (!Number.isFinite(bruta)) return { ok: false, motivo: MOTIVO_SEM_QUANTIDADE };
  const quantidade = kgInteiroParaCima(bruta);
  if (quantidade <= 0) return { ok: false, motivo: MOTIVO_SEM_QUANTIDADE };
  if (quantidade > INT_MAX) return { ok: false, motivo: MOTIVO_ACIMA_LIMITE };
  return { ok: true, quantidade, origem: temDecisao ? 'decidida' : 'sugerida' };
}

/** So o rotulo da quinzena: o texto pode chegar ao fornecedor (nunca nome de cliente, produto ou observacao). */
export function descricaoDoForecast(label: string): string {
  return `Forecast ${label}`;
}

export interface EntradaMotivoDoBotao {
  productId: number | null;
  produtosCarregando: boolean;
  produtosErro: boolean;
  /** Codigos do produto no cadastro do Forecast; `undefined` = produto fora da lista. */
  codes: readonly CodigoVinculavel[] | undefined;
  decisaoKg: number | null | undefined;
  quantidadeFinal: number;
}

/** Motivo visivel do botao desabilitado, na ordem do plano; `null` = pode gerar. */
export function motivoDoBotao(e: EntradaMotivoDoBotao): string | null {
  if (e.productId === null) return MOTIVO_FORA_CADASTRO;
  if (e.produtosCarregando) return MOTIVO_VERIFICANDO;
  if (e.produtosErro) return MOTIVO_ERRO_VINCULO;
  if (!e.codes || codigoParaCotacao(e.codes, null) === null) return MOTIVO_SEM_VINCULO;
  const quantidade = quantidadeParaCotacao(e.decisaoKg, e.quantidadeFinal);
  return quantidade.ok ? null : quantidade.motivo;
}
