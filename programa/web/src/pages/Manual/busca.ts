// Busca do Manual: normalizacao sem acento e minusculas, e o corte de um texto em fatias (com e sem o termo) para o destaque.
// Sem dependencia de React: testado em busca.test.ts.

// Termo com menos de 2 caracteres nao filtra nada (tudo continua visivel).
export const TERMO_MINIMO = 2;

// "Acao" = "acao" = "AÇÃO". NFD separa a letra do acento; o intervalo U+0300-U+036F e o dos acentos combinantes.
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Termo digitado -> termo de busca: normalizado, sem espacos nas pontas nem repetidos; '' quando curto demais.
export function termoDeBusca(entrada: string): string {
  const termo = normalizar(entrada).replace(/\s+/g, ' ').trim();
  return termo.length >= TERMO_MINIMO ? termo : '';
}

// Texto de um capitulo para o indice de busca (espacos colapsados, normalizado).
export function textoParaIndice(texto: string): string {
  return normalizar(texto).replace(/\s+/g, ' ').trim();
}

export interface Fatia {
  texto: string;
  marca: boolean;
}

// Corta `texto` nas ocorrencias de `termo` (JA normalizado). A busca e feita no texto normalizado, mas as fatias saem do texto ORIGINAL (com acento e caixa):
// cada caractere normalizado lembra de qual trecho do original veio, mesmo quando a normalizacao muda o comprimento.
export function fatiar(texto: string, termo: string): Fatia[] {
  if (!termo || !texto) return [{ texto, marca: false }];
  let normalizado = '';
  const inicioNoOriginal: number[] = [];
  const fimNoOriginal: number[] = [];
  let posicao = 0;
  for (const caractere of texto) {
    const parte = normalizar(caractere);
    for (let i = 0; i < parte.length; i++) {
      inicioNoOriginal.push(posicao);
      fimNoOriginal.push(posicao + caractere.length);
    }
    normalizado += parte;
    posicao += caractere.length;
  }
  const fatias: Fatia[] = [];
  let cursor = 0;
  let busca = 0;
  for (;;) {
    const achou = normalizado.indexOf(termo, busca);
    if (achou < 0) break;
    const inicio = inicioNoOriginal[achou] ?? cursor;
    const fim = fimNoOriginal[achou + termo.length - 1] ?? texto.length;
    busca = achou + termo.length;
    if (inicio < cursor) continue;
    if (inicio > cursor) fatias.push({ texto: texto.slice(cursor, inicio), marca: false });
    fatias.push({ texto: texto.slice(inicio, fim), marca: true });
    cursor = fim;
  }
  if (cursor < texto.length) fatias.push({ texto: texto.slice(cursor), marca: false });
  return fatias.length > 0 ? fatias : [{ texto, marca: false }];
}

export function contemTermo(textoNormalizado: string, termo: string): boolean {
  return !termo || textoNormalizado.includes(termo);
}
