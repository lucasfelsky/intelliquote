// Linha do item na rota `/forecast/item/:linha`: so inteiro positivo em digitos ("3"). "1e1", "0x3", " 3", "+3", "3.0" e "0" nao sao
// linha: viram NaN, que nunca casa com nenhum item (mesmo tratamento de "Item nao encontrado nesta quinzena").
export function linhaDaRota(texto: string | undefined): number {
  if (texto === undefined || !/^\d+$/.test(texto)) return Number.NaN;
  const linha = Number(texto);
  return Number.isSafeInteger(linha) && linha > 0 ? linha : Number.NaN;
}
