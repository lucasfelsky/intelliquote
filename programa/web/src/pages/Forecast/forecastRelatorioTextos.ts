// Textos puros do relatorio de compras (PR 5B): Observacao e quantidade arredondada para cada embalagem.
// Copia exata em src/utils/forecastRelatorioComprasXlsx.ts (`textoOpcaoDeEmbalagem`, `PARAGRAFO_EMBALAGEM_XLSX`);
// a igualdade tela x XLSX e provada em tests/forecast-relatorio-compras-xlsx.test.ts.
import type { ForecastItemRelatorio, ForecastOpcaoEmbalagem } from '@/services/forecast';
import { kgBr } from './forecastPainel';

/** Terceiro paragrafo das regras (tela e aba Regras do XLSX). */
export const PARAGRAFO_EMBALAGEM =
  'Quantidade sugerida = demanda em módulo. Com embalagem cadastrada, arredonda para cima em múltiplos da embalagem (a principal; sem principal, a do primeiro código). Com mais de uma embalagem, mostra também a quantidade arredondada para cada uma, para o comprador escolher na compra; a Qtd. final usa a embalagem em destaque.';

/** Quantidade do item arredondada para UMA embalagem, ex.: `3 × 200 kg (código C0002) = 600 kg`. */
export function textoOpcaoDeEmbalagem(op: ForecastOpcaoEmbalagem): string {
  const nome = op.rotulo ?? `${kgBr(op.quantidade)} kg`;
  return `${op.embalagens} × ${nome} (código ${op.codigo}) = ${kgBr(op.quantidadeFinal)} kg`;
}

/**
 * Linhas das embalagens que NAO estao em destaque (vazio com uma so embalagem ou nenhuma). Backend antigo (sem
 * `porEmbalagem`): uma unica linha no texto de antes, `Outras: C0004 (200 kg)`.
 */
export function linhasOutrasEmbalagens(item: Pick<ForecastItemRelatorio, 'embalagem' | 'porEmbalagem'>): string[] {
  const { usada, cadastradas, multiplas } = item.embalagem;
  if (!multiplas || !usada) return [];
  if (item.porEmbalagem) return item.porEmbalagem.filter((o) => !o.destaque).map(textoOpcaoDeEmbalagem);
  const outras = cadastradas.filter((e) => e.codigo !== usada.codigo);
  return [`Outras: ${outras.map((e) => `${e.codigo} (${kgBr(e.quantidade)} kg)`).join(', ')}`];
}

/** `title` do selo "Arredondado pela embalagem do codigo ...": as mesmas opcoes que aparecem na celula. */
export function tituloOutrasEmbalagens(item: Pick<ForecastItemRelatorio, 'embalagem' | 'porEmbalagem'>): string {
  const { usada, cadastradas } = item.embalagem;
  if (item.porEmbalagem) {
    return `Outras embalagens: ${item.porEmbalagem
      .filter((o) => !o.destaque)
      .map(textoOpcaoDeEmbalagem)
      .join('; ')}`;
  }
  const outras = cadastradas.filter((e) => e.codigo !== usada?.codigo);
  return `Outras embalagens: ${outras.map((e) => `${e.codigo} (${kgBr(e.quantidade)} kg)`).join(', ')}`;
}

/** `Obs.: texto` ou `null` quando nao ha observacao (backend antigo = sem o campo). */
export function textoObservacao(obs: string | null | undefined): string | null {
  const texto = (obs ?? '').trim();
  return texto ? `Obs.: ${texto}` : null;
}
