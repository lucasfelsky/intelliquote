// Textos puros do relatorio de compras (PR 5B): Observacao e quantidade arredondada para cada embalagem; (PR 6e) pallets;
// (PR 6c) meses atipicos.
// Copia exata em src/utils/forecastRelatorioComprasXlsx.ts (`textoOpcaoDeEmbalagem`, `textoPallet`, `PARAGRAFO_EMBALAGEM_XLSX`);
// a igualdade tela x XLSX e provada em tests/forecast-relatorio-compras-xlsx.test.ts.
import type {
  ForecastItemRelatorio,
  ForecastOpcaoEmbalagem,
  ForecastPalletDaOpcao,
  ForecastRelatorioCompras,
} from '@/services/forecast';
import { kgBr, mesAbrevDoAnoMes } from './forecastPainel';

/** Terceiro paragrafo das regras (tela e aba Regras do XLSX). */
export const PARAGRAFO_EMBALAGEM =
  'Quantidade sugerida = demanda em módulo. Com embalagem cadastrada, arredonda para cima em múltiplos da embalagem (a principal; sem principal, a do primeiro código). Com mais de uma embalagem, mostra também a quantidade arredondada para cada uma, para o comprador escolher na compra; a Qtd. final usa a embalagem em destaque. Com pallet cadastrado, mostra também os pallets fechados abaixo e acima da quantidade sugerida; a Qtd. final continua pela embalagem.';

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

/**
 * Pallets fechados abaixo e acima da quantidade sugerida, ex.: `Pallet de 600 kg: 2 pallets = 1.200 kg (abaixo) ·
 * 3 pallets = 1.800 kg (acima)`. Multiplo exato: so `(exato)`; nada abaixo de 1 pallet: so `(acima)`. Sem pallet: null.
 */
export function textoPallet(p: ForecastPalletDaOpcao | null | undefined): string | null {
  if (!p) return null;
  const parte = (v: { pallets: number; kg: number }, marca: string) =>
    `${v.pallets} ${v.pallets === 1 ? 'pallet' : 'pallets'} = ${kgBr(v.kg)} kg (${marca})`;
  const inicio = `Pallet de ${kgBr(p.kgPorPallet)} kg: `;
  if (p.abaixo.pallets === p.acima.pallets) return inicio + parte(p.acima, 'exato');
  if (p.abaixo.pallets === 0) return inicio + parte(p.acima, 'acima');
  return `${inicio}${parte(p.abaixo, 'abaixo')} · ${parte(p.acima, 'acima')}`;
}

/** Pallet da embalagem em destaque (a que gera a Qtd. final); null sem pallet ou com backend antigo. */
export function palletDoDestaque(item: Pick<ForecastItemRelatorio, 'porEmbalagem'>): string | null {
  return textoPallet(item.porEmbalagem?.find((o) => o.destaque)?.pallet);
}

/** Cada embalagem que NAO esta em destaque com o pallet dela logo abaixo (mesma ordem de `linhasOutrasEmbalagens`). */
export function opcoesOutrasComPallet(
  item: Pick<ForecastItemRelatorio, 'embalagem' | 'porEmbalagem'>,
): Array<{ texto: string; pallet: string | null }> {
  const { usada, multiplas } = item.embalagem;
  if (!multiplas || !usada || !item.porEmbalagem) {
    return linhasOutrasEmbalagens(item).map((texto) => ({ texto, pallet: null }));
  }
  return item.porEmbalagem
    .filter((o) => !o.destaque)
    .map((o) => ({ texto: textoOpcaoDeEmbalagem(o), pallet: textoPallet(o.pallet) }));
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

// ---- Compra sob demanda (PR 6a): copia exata em src/utils/forecastRelatorioComprasXlsx.ts (guarda de paridade no teste) ----

export const MOTIVO_SOB_DEMANDA_PADRAO = 'Compra sob programação do cliente';

/** Motivo exibido: o padrao, seguido do motivo cadastrado quando houver. */
export function textoMotivoSobDemanda(motivo: string | null | undefined): string {
  return motivo ? `${MOTIVO_SOB_DEMANDA_PADRAO}: ${motivo}` : MOTIVO_SOB_DEMANDA_PADRAO;
}

export function resumoSobDemanda(n: number): string {
  return `${n} sob demanda (fora da lista de compra)`;
}

export function paragrafoSobDemanda(): string {
  return 'Itens marcados como "compra sob demanda" saem da lista de compra: só se compra com programação do cliente. A seção mostra a programação ainda não coberta por estoque e chegadas.';
}

export function tituloSobDemanda(n: number): string {
  return `Sob demanda: só com programação do cliente · ${n} ${n === 1 ? 'item' : 'itens'}`;
}

/** Nota sob a tabela da secao (so na tela): o que a coluna "Programação descoberta" mede. */
export const APOIO_SOB_DEMANDA =
  'Programação descoberta = programações − estoque − chegadas (nunca negativa). Só informativo: o item não entra na lista de compra.';

// ---- Meses atipicos (PR 6c): copia exata em src/utils/forecastRelatorioComprasXlsx.ts (guarda de paridade no teste) ----

/** Meses fora da media do item, ex.: `ago/2026, set/2026` (vazio = nenhum; backend antigo = sem o campo). */
export function textoMesesForaDaMedia(anoMeses: string[] | null | undefined): string {
  return (anoMeses ?? []).map(mesAbrevDoAnoMes).join(', ');
}

/** Linha do selo na celula Item do relatorio: `Média sem: ago/2026`; null quando a media e a da planilha. */
export function textoMediaSem(anoMeses: string[] | null | undefined): string | null {
  const texto = textoMesesForaDaMedia(anoMeses);
  return texto ? `Média sem: ${texto}` : null;
}

/** Itens (lista de compra, sem consumo e sob demanda) cuja media usa meses excluidos. */
export function contarComMesesForaDaMedia(
  r: Pick<ForecastRelatorioCompras, 'grupos' | 'semConsumo' | 'sobDemanda'>,
): number {
  const itens: Array<{ mesesForaDaMedia?: string[] }> = [
    ...r.grupos.flatMap((g) => g.itens),
    ...(r.semConsumo?.itens ?? []),
    ...(r.sobDemanda?.itens ?? []),
  ];
  return itens.filter((i) => (i.mesesForaDaMedia ?? []).length > 0).length;
}

export function resumoMesesForaDaMedia(n: number): string {
  return `${n} ${n === 1 ? 'item usa' : 'itens usam'} média sem meses atípicos`;
}

export function paragrafoMesesForaDaMedia(): string {
  return 'Meses marcados como venda atípica ficam fora das médias trimestral e semestral (e do consumo do mês, se marcado o mês atual). A conferência com a planilha usa a regra original.';
}
