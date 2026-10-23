// Textos puros do relatorio de compras (PR 5B): Observacao e quantidade arredondada para cada embalagem; (PR 6e) pallets;
// (PR 6c) meses atipicos; (PR 6d) demanda do comercial; (PR 6b) grupos de equivalencia.
// Copia exata em src/utils/forecastRelatorioComprasXlsx.ts (`textoOpcaoDeEmbalagem`, `textoPallet`, `PARAGRAFO_EMBALAGEM_XLSX`);
// a igualdade tela x XLSX e provada em tests/forecast-relatorio-compras-xlsx.test.ts.
import type {
  ForecastDadosDoGrupo,
  ForecastItemCobertoPorGrupo,
  ForecastItemDemandaComercial,
  ForecastItemRelatorio,
  ForecastOpcaoEmbalagem,
  ForecastPalletDaOpcao,
  ForecastRelatorioCompras,
  ForecastSituacaoDoGrupo,
} from '@/services/forecast';
import { d1, inteiroBr, kgBr, mesAbrevDoAnoMes } from './forecastPainel';

/** Terceiro paragrafo das regras (tela e aba Regras do XLSX). */
export const PARAGRAFO_EMBALAGEM =
  'Quantidade sugerida = demanda em módulo. Com embalagem cadastrada, arredonda para cima em múltiplos da embalagem (a principal; sem principal, a do primeiro código). Com mais de uma embalagem, mostra também a quantidade arredondada para cada uma, para o comprador escolher na compra; a Qtd. final usa a embalagem em destaque. O pallet é uma opção de compra informada pelo cadastro, não uma regra, e pode não ser múltiplo da embalagem: com pallet cadastrado, mostra também os pallets abaixo e acima da quantidade sugerida (a conta é em kg do pallet); a Qtd. final continua pela embalagem.';

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

// ---- Demanda do comercial (PR 6d): copia exata em src/utils/forecastRelatorioComprasXlsx.ts (guarda de paridade no teste) ----

export function tituloDemandaComercial(n: number): string {
  return `Demanda do comercial · ${n} ${n === 1 ? 'pedido aberto' : 'pedidos abertos'}`;
}

export function resumoDemandaComercial(abertas: number, sugeridoKg: number): string {
  return `${abertas} ${abertas === 1 ? 'demanda do comercial aberta' : 'demandas do comercial abertas'} (${kgBr(sugeridoKg)} kg ${sugeridoKg === 1 ? 'sugerido' : 'sugeridos'})`;
}

export function paragrafoDemandaComercial(): string {
  return 'Demanda do comercial: compras pedidas pelo comercial para programações fora do horizonte. Soma ao Forecast o pedido menos o saldo que sobraria no mês da necessidade; dentro do horizonte de programação não soma (deve estar nas programações).';
}

/** Selo no item da lista de compra: `+ 1.100 kg pedidos pelo comercial`. */
export function seloDemandaComercial(kg: number): string {
  return `+ ${kgBr(kg)} kg pedidos pelo comercial`;
}

export function textoSituacaoDemanda(i: Pick<ForecastItemDemandaComercial, 'situacao' | 'sugerido'>): string {
  if (i.situacao === 'no-horizonte') return 'Dentro do horizonte: não soma';
  if (i.situacao === 'fora-da-quinzena') return 'Fora desta quinzena: sem cálculo';
  return i.sugerido > 0 ? 'Além do horizonte: soma ao Forecast' : 'Além do horizonte: coberta pelo saldo';
}

export const CONFIRA_PROGRAMACOES = 'Confira se já está nas programações; se estiver, marque "virou programação".';

/** Aviso sob a situacao (nulo = nada a avisar). */
export function textoAvisoDemanda(
  i: Pick<ForecastItemDemandaComercial, 'situacao' | 'programacaoDoMes' | 'anoMes'>,
): string | null {
  if (i.situacao === 'fora-da-quinzena') return 'O produto não tem linha nesta quinzena.';
  if (i.situacao !== 'no-horizonte') return null;
  if (i.programacaoDoMes === null) return CONFIRA_PROGRAMACOES;
  const mes = mesAbrevDoAnoMes(i.anoMes);
  return i.programacaoDoMes > 0
    ? `Programação de ${mes}: ${inteiroBr(i.programacaoDoMes)}. ${CONFIRA_PROGRAMACOES}`
    : `Sem programação em ${mes}. ${CONFIRA_PROGRAMACOES}`;
}

/** Numero da Solicitacao do IntelliQuote (so rastreio): `#12`; sem numero, traco. */
export const textoSolicitacao = (id: number | null): string => (id === null ? '—' : `#${id}`);

/** Nota sob a tabela da secao (so na tela). */
export const APOIO_DEMANDA_COMERCIAL =
  'Sugerido = pedido − saldo livre no mês da necessidade (nunca negativo). Pedido fechado (comprada, virou programação ou cancelada) sai desta seção. Pedido dentro do horizonte de programação não soma.';

// ---- Grupos de equivalencia (PR 6b): copia exata em src/utils/forecastRelatorioComprasXlsx.ts (guarda de paridade no teste) ----

const COBERTURA_BR = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Cobertura do grupo em meses, 1 casa (`8,0 meses`); sem consumo, `sem consumo`. */
export function textoCobertura(cobertura: number | null): string {
  return cobertura === null ? 'sem consumo' : `${COBERTURA_BR.format(cobertura)} meses`;
}

/** Frase fixa do motivo de "coberto" (e ressalva da equivalencia): a equivalencia nao vale sempre para todos os clientes. */
export const FRASE_EQUIVALENCIA_NEM_SEMPRE =
  'Equivalência pode não valer para todos os clientes: confira a observação do grupo antes de dispensar a compra.';

/** Observacao do grupo (cadastro) na linha do grupo e no motivo de "coberto"; sem texto, nada. */
export function textoObservacaoDoGrupo(obs: string | null | undefined): string | null {
  const texto = (obs ?? '').trim();
  return texto ? `Observação do grupo: ${texto}` : null;
}

/**
 * Motivo do membro fora da lista de compra: `Coberto pelo grupo X: estoque somado 1.200 kg, cobertura 8,0 meses ·
 * Observação do grupo: ... · Equivalência pode não valer ...` (a observacao so entra quando o grupo tem uma).
 */
export function textoMotivoCobertoPorGrupo(
  i: Pick<ForecastItemCobertoPorGrupo, 'grupoNome' | 'estoqueDoGrupo' | 'cobertura' | 'grupoObservacao'>,
): string {
  const base = `Coberto pelo grupo ${i.grupoNome}: estoque somado ${kgBr(i.estoqueDoGrupo)} kg`;
  const cobertura =
    i.cobertura === null ? `${base}, sem consumo no grupo` : `${base}, cobertura ${textoCobertura(i.cobertura)}`;
  const obs = textoObservacaoDoGrupo(i.grupoObservacao);
  return obs ? `${cobertura} · ${obs} · ${FRASE_EQUIVALENCIA_NEM_SEMPRE}` : `${cobertura} · ${FRASE_EQUIVALENCIA_NEM_SEMPRE}`;
}

export function resumoCobertosPorGrupo(n: number): string {
  return `${n} ${n === 1 ? 'item coberto' : 'itens cobertos'} por grupo de equivalência`;
}

export function tituloCobertosPorGrupo(n: number): string {
  return `Cobertos pelo grupo de equivalência · ${n} ${n === 1 ? 'item' : 'itens'}`;
}

/** Nota sob a tabela da secao (so na tela). */
export const APOIO_COBERTOS_POR_GRUPO =
  'Estes itens entrariam na lista de compra sozinhos, mas o estoque somado do grupo os cobre. Se algum produto não for o mesmo material, tire-o do grupo em "Grupos de equivalência".';

export function paragrafoGruposDeEquivalencia(): string {
  return 'Grupos de equivalência: produtos que são o mesmo material (nomes ou fontes diferentes) têm o estoque avaliado somado. A demanda do grupo soma estoque, chegadas, programações, médias e a segurança de cada membro (lead time da fonte de cada um); a compra sai pelo produto principal, com a embalagem e o pallet dele. Compra sob demanda: vale só a marca do produto principal. Meses atípicos: cada membro usa a sua média ajustada. Demanda do comercial: o pedido de qualquer membro usa o saldo somado do grupo. A equivalência nem sempre vale para todos os clientes (depende da demanda do cliente ou do preço; alguns clientes têm apenas um item do grupo homologado): confira a observação do grupo antes de dispensar a compra.';
}

/** Linha de apoio sob o item do grupo: `Compra pelo produto principal: PRODUTO 001`. */
export function textoPrincipalDoGrupo(principalItem: string): string {
  return `Compra pelo produto principal: ${principalItem}`;
}

/** Resumo do grupo: `Estoque somado 300 kg · cobertura 2,0 meses · segurança somada 300 kg`. */
export function textoResumoDoGrupo(g: Pick<ForecastDadosDoGrupo, 'estoque' | 'cobertura' | 'seguranca'>): string {
  return `Estoque somado ${kgBr(g.estoque)} kg · cobertura ${textoCobertura(g.cobertura)} · segurança somada ${kgBr(g.seguranca)} kg`;
}

export function textoSituacaoDoGrupo(s: ForecastSituacaoDoGrupo): string {
  switch (s) {
    case 'na-lista':
      return 'Na lista de compra';
    case 'sob-demanda':
      return 'Fora da lista: principal sob demanda';
    case 'coberto':
      return 'Coberto pelo estoque somado';
    default:
      return 'Fora da lista: nenhum membro com lead time';
  }
}

/** Demanda individual de um membro (`-300,0`); sem lead time: `sem lead time`. */
export function textoDemandaIndividual(demanda: number | null): string {
  return demanda === null ? 'sem lead time' : d1(demanda);
}

/** Selo do produto na memoria de calculo: `Grupo: GRUPO SINTETICO`. */
export function textoSeloDoGrupo(nome: string): string {
  return `Grupo: ${nome}`;
}
