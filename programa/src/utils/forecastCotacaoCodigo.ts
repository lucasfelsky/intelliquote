import { chaveFonte } from './forecastCotacaoVinculo';

export interface CodigoPorFonteEntrada {
  fonte: string;
  requestCode: string;
}

export interface CodigosPorFonte {
  /** Chave da fonte (`chaveFonte`) -> codigo informado (ja normalizado pelo validador). */
  mapa: Map<string, string>;
  /** Fontes informadas que nao existem no lote (texto original, na ordem recebida). */
  foraDoLote: string[];
}

// Casa o codigo de cotacao informado por fonte com as fontes do lote, pela chave normalizada (trim + maiusculas). Pura: sem
// I/O. Fonte sem entrada fica fora do mapa (a cotacao dela segue com o codigo gerado).
export function codigosPorFonte(
  entrada: ReadonlyArray<CodigoPorFonteEntrada> | undefined,
  chavesDoLote: ReadonlySet<string>,
): CodigosPorFonte {
  const mapa = new Map<string, string>();
  const foraDoLote: string[] = [];
  for (const { fonte, requestCode } of entrada ?? []) {
    const chave = chaveFonte(fonte);
    if (chavesDoLote.has(chave)) mapa.set(chave, requestCode);
    else foraDoLote.push(fonte.trim());
  }
  return { mapa, foraDoLote };
}
