// Tamanhos de pallet de UM codigo (puro, sem Prisma): o 1o fica em packagingPalletKg e os demais em
// packagingPalletExtraKg, na ordem do cadastro.

const valido = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Lista unica (ordem preservada) com o 1o tamanho e os extras; ignora nulos, zeros e repetidos. */
export function palletsDoCadastro(primeiro: number | null, extras: readonly number[]): number[] {
  const saida: number[] = [];
  for (const n of [primeiro, ...extras]) {
    if (valido(n) && !saida.includes(n)) saida.push(n);
  }
  return saida;
}

/** Lista -> as duas colunas do cadastro (1o tamanho + extras). */
export function colunasDePallet(lista: readonly number[]): {
  packagingPalletKg: number | null;
  packagingPalletExtraKg: number[];
} {
  return { packagingPalletKg: lista[0] ?? null, packagingPalletExtraKg: lista.slice(1) };
}

export interface EdicaoDePallet {
  /** Legado: troca SO o 1o tamanho e mantem os extras; null apaga todos; ausente = mantem. */
  palletKg?: number | null;
  /** Novo: substitui a lista inteira ([] = sem pallet); ausente = mantem. */
  palletsKg?: number[];
}

/** Lista de pallets do codigo depois da edicao (a quantidade nula zera a lista no service, nao aqui). */
export function palletsDesejados(atual: readonly number[], edicao: EdicaoDePallet | undefined): number[] {
  if (edicao?.palletsKg !== undefined) return palletsDoCadastro(null, edicao.palletsKg);
  if (!edicao || edicao.palletKg === undefined) return [...atual];
  if (edicao.palletKg === null) return [];
  return palletsDoCadastro(edicao.palletKg, atual.slice(1));
}
