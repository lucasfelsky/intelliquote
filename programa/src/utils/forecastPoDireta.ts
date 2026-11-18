// Regras PURAS da PO direta do Forecast (item de preco fechado, sem cotacao). Sem banco e sem HTTP.

export const PO_DIRETA_STATUS = ['enviando', 'enviada', 'falhou'] as const;
export type PoDiretaStatus = (typeof PO_DIRETA_STATUS)[number];

/** Teto em kg (`ForecastPurchaseOrder.quantityKg` e `Decimal(18,6)`; 1 bilhao de kg ja e absurdo para uma PO). */
export const PO_DIRETA_KG_MAX = 1_000_000_000;

/** Chave de idempotencia gerada pelo cliente ao abrir o envio (UUID ou parecido): 8 a 64 caracteres seguros. */
const CHAVE = /^[A-Za-z0-9_-]{8,64}$/;

export const chaveDeEnvioValida = (chave: string): boolean => CHAVE.test(chave);

/** Quantidade em kg: finita, > 0, ate `PO_DIRETA_KG_MAX` e ate 3 casas decimais (mesma regra da quantidade das solicitacoes). */
export function quantidadeDaPoValida(kg: number): boolean {
  if (!Number.isFinite(kg) || kg <= 0 || kg > PO_DIRETA_KG_MAX) return false;
  return Math.abs(kg * 1000 - Math.round(kg * 1000)) < 1e-6;
}

/** Codigo curto (sem texto livre) gravado em `failureCode`: so letras minusculas, digitos, `_` e `-`, ate 40 caracteres. */
export function codigoDeFalha(texto: string): string {
  const limpo = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return limpo === '' ? 'erro' : limpo;
}
