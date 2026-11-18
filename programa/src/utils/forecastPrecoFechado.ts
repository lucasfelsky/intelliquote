// Regras PURAS do preco fechado do Forecast (valor por kg + moeda, incoterm e validade). Sem banco e sem HTTP.
// So admin e comprador leem e editam o VALOR; os demais perfis veem so o selo (`precoFixo`).

export const PRECO_FECHADO_MOEDAS = ['USD', 'EUR', 'BRL'] as const;
export type PrecoFechadoMoeda = (typeof PRECO_FECHADO_MOEDAS)[number];

/** Teto do preco por kg (`fixedPrice` e `Decimal(14,4)`). */
export const PRECO_FECHADO_MAX = 9_999_999_999;

export type EstadoDoPrecoFechado = 'ok' | 'sem_valor' | 'vencido';

export interface TermosDoPrecoFechado {
  valorPorKg: number | null;
  moeda: string | null;
  incoterm: string | null;
  /** AAAA-MM-DD. */
  validoAte: string | null;
}

/** Preco por kg: > 0, ate `PRECO_FECHADO_MAX` e ate 4 casas decimais (a coluna). */
export function valorPorKgValido(valor: number): boolean {
  if (!Number.isFinite(valor) || valor <= 0 || valor > PRECO_FECHADO_MAX) return false;
  return Math.abs(valor * 10_000 - Math.round(valor * 10_000)) < 1e-6;
}

/**
 * `sem_valor` = falta qualquer termo (valor, moeda, incoterm ou validade): so se envia PO com o preco COMPLETO;
 * `vencido` = a validade ja passou (`hoje` e AAAA-MM-DD em Sao Paulo; o proprio dia da validade ainda vale);
 * `ok` = completo e valido.
 */
export function estadoDoPrecoFechado(t: TermosDoPrecoFechado, hoje: string): EstadoDoPrecoFechado {
  if (t.valorPorKg === null || !t.moeda || !t.incoterm || !t.validoAte) return 'sem_valor';
  return t.validoAte < hoje ? 'vencido' : 'ok';
}

const dataBr = (key: string): string => `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;

/** Motivo de bloqueio do envio da PO direta para o estado do preco; `null` = pode enviar. */
export function motivoDoPrecoBloqueado(estado: EstadoDoPrecoFechado, validoAte: string | null): string | null {
  if (estado === 'ok') return null;
  if (estado === 'vencido' && validoAte) return `O preço fechado venceu em ${dataBr(validoAte)}. Atualize o preço antes de enviar a PO.`;
  return 'O preço fechado deste item ainda não foi cadastrado. Defina o preço antes de enviar a PO.';
}
