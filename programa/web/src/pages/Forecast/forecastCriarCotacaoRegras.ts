import type { ForecastItemRelatorio, ForecastUrgencia } from '@/services/forecast';
import type { ForecastCandidato, ForecastCotacaoLoteItem, ForecastRascunhoItem } from '@/services/forecastCotacaoLote';
import { FORECAST_DECISAO_OBSERVACAO_MAX, type ForecastDecisao } from '@/services/forecastDecisoes';
import { lerKgBr } from '@/services/forecastDemandaComercial';
import { kgParaCampo, sugeridaParaCampo, validarDecisao } from './forecastDecisaoCampos';
import {
  codigoParaCotacao,
  kgInteiroParaCima,
  MOTIVO_ERRO_VINCULO,
  MOTIVO_SEM_VINCULO,
  MOTIVO_VERIFICANDO,
  quantidadeParaCotacao,
  type CodigoVinculavel,
} from './forecastGerarCotacaoRegras';
import { kgBr, mesAbrevDoAnoMes } from './forecastPainel';
import { rotuloUrgencia } from './forecastRelatorioUrgencia';

// Regras puras do pop-up "Criar cotacao" (E6 do relatorio enxuto): itens agrupados por fonte, quantidade a cotar, bloqueios,
// resumo "Serao geradas N cotacoes", etiquetas dos candidatos e a conversao de/para o rascunho e o corpo do lote.
// Sem React nem HTTP.

export const MOTIVO_SEM_FONTE = 'Item sem fonte.';
export const MOTIVO_INDISPONIVEL = 'Este item não está mais disponível para cotação nesta quinzena. Tire-o da cotação.';
export const MAX_ITENS_DO_LOTE = 100;

/** Linha escolhida na tabela do relatorio (o item e a fonte do grupo em que aparece). */
export interface ItemSelecionado {
  item: ForecastItemRelatorio;
  fonte: string;
}

/** 'lista' = item da lista de compra; 'candidato' = de fora da lista (vai com `incluidoManualmente: true`). */
export type OrigemDoItem = 'lista' | 'candidato';

export interface ItemDaCotacao {
  productId: number;
  nome: string;
  codigos: string[];
  /** Vazio = sem fonte (bloqueado). */
  fonte: string;
  origem: OrigemDoItem;
  /** Referencia mostrada na coluna "Sugerida": Qtd. final do relatorio (lista) ou o que a lista sugeriria (candidato). */
  sugeridaKg: number | null;
  /** Campo da quantidade a cotar (texto, pt-BR). */
  kg: string;
  obs: string;
  /** Dica do porque a quantidade veio vazia (ex.: decisao salva = nao comprar). */
  dicaKg?: string;
  /** Etiqueta do motivo (candidato) ou da urgencia (lista). */
  etiqueta?: string;
  /** Item do rascunho que nao esta mais na lista nem entre os candidatos. */
  indisponivel?: boolean;
}

export const chaveDaFonte = (fonte: string): string => fonte.trim().toUpperCase();
export const nomeDaFonte = (fonte: string): string => fonte.trim() || 'Sem fonte';

const plural = (n: number, singular: string, pluralForm: string) => (n === 1 ? singular : pluralForm);

// ---------- montagem dos itens ----------

function quantidadeInicial(
  decisaoKg: number | null | undefined,
  quantidadeFinal: number,
): { kg: string; dicaKg?: string } {
  const q = quantidadeParaCotacao(decisaoKg, quantidadeFinal);
  return q.ok ? { kg: kgParaCampo(q.quantidade) } : { kg: '', dicaKg: q.motivo };
}

export function etiquetaDaUrgencia(u: ForecastUrgencia | undefined, diasCritico: number): string {
  return u ? rotuloUrgencia(u, diasCritico) : 'Na lista de compra';
}

/** Item da lista de compra; a quantidade nasce da decisao salva ou da Qtd. final calculada. */
export function itemDaLista(
  { item, fonte }: ItemSelecionado,
  decisao: ForecastDecisao | undefined,
  diasCritico: number,
): ItemDaCotacao | null {
  if (item.productId === null || item.productId === undefined) return null;
  return {
    productId: item.productId,
    nome: item.item,
    codigos: item.codigos,
    fonte,
    origem: 'lista',
    sugeridaKg: item.quantidadeFinal,
    ...quantidadeInicial(decisao?.quantidadeKg, item.quantidadeFinal),
    obs: decisao?.observacao ?? '',
    etiqueta: etiquetaDaUrgencia(item.urgencia, diasCritico),
  };
}

/** Candidato (item de fora da lista): quantidade nasce da sugerida (vazia quando o calculo nao aponta compra). */
export function itemDeCandidato(c: ForecastCandidato, decisao?: ForecastDecisao): ItemDaCotacao {
  const base =
    decisao !== undefined && decisao.quantidadeKg > 0
      ? { kg: kgParaCampo(kgInteiroParaCima(decisao.quantidadeKg)) }
      : c.quantidadeSugeridaKg !== null && c.quantidadeSugeridaKg > 0
        ? { kg: kgParaCampo(kgInteiroParaCima(c.quantidadeSugeridaKg)) }
        : { kg: '', dicaKg: 'Sem falta calculada: informe a quantidade a cotar.' };
  return {
    productId: c.productId,
    nome: c.item,
    codigos: c.codigos,
    fonte: c.fonte,
    origem: 'candidato',
    sugeridaKg: c.quantidadeSugeridaKg,
    ...base,
    obs: decisao?.observacao ?? '',
    etiqueta: etiquetaDoCandidato(c),
  };
}

/** Item que estava no rascunho mas sumiu da lista e dos candidatos. */
export function itemIndisponivel(r: ForecastRascunhoItem): ItemDaCotacao {
  return {
    productId: r.productId,
    nome: `Produto ${r.productId}`,
    codigos: [],
    fonte: '',
    origem: 'candidato',
    sugeridaKg: null,
    kg: r.quantidadeKg > 0 ? kgParaCampo(r.quantidadeKg) : '',
    obs: r.observacao ?? '',
    indisponivel: true,
  };
}

/** Quantidade e observacao guardadas no rascunho valem sobre o padrao do item. */
export function comValoresDoRascunho(base: ItemDaCotacao, r: ForecastRascunhoItem): ItemDaCotacao {
  return {
    ...base,
    kg: r.quantidadeKg > 0 ? kgParaCampo(r.quantidadeKg) : '',
    obs: r.observacao ?? '',
    dicaKg: r.quantidadeKg > 0 ? undefined : base.dicaKg,
  };
}

/** Etiqueta do motivo pelo qual o candidato nao esta na lista de compra. */
export function etiquetaDoCandidato(c: Pick<ForecastCandidato, 'motivoForaDaLista' | 'coberturaAteMes' | 'coberturaAteOFimDaJanela' | 'grupoNome'>): string {
  switch (c.motivoForaDaLista) {
    case 'sem-falta': {
      if (c.coberturaAteMes === null) return 'Sem falta no cálculo';
      const mes = mesAbrevDoAnoMes(c.coberturaAteMes);
      return c.coberturaAteOFimDaJanela ? `Sem falta: estoque cobre pelo menos até ${mes}` : `Sem falta: estoque cobre até ${mes}`;
    }
    case 'sob-demanda':
      return 'Compra sob demanda';
    case 'coberto-por-grupo':
      return c.grupoNome ? `Coberto pelo grupo ${c.grupoNome}` : 'Coberto por grupo de equivalência';
    default:
      return 'Sem consumo na média, com movimento';
  }
}

// ---------- quantidade e validacao ----------

export interface QuantidadeValidada {
  /** kg digitado; nulo = invalido ou vazio. */
  kg: number | null;
  erro?: string;
}

/** Quantidade a cotar: obrigatoria e maior que zero (a decisao aceita 0, a cotacao nao). */
export function validarQuantidadeACotar(texto: string): QuantidadeValidada {
  if (texto.trim() === '') return { kg: null, erro: 'Informe a quantidade a cotar.' };
  const v = validarDecisao({ kg: texto, observacao: '' });
  if (v.erros.kg) return { kg: null, erro: v.erros.kg };
  const kg = v.valores?.quantidadeKg ?? null;
  if (kg === null) return { kg: null, erro: 'Informe a quantidade a cotar.' };
  if (kg <= 0) return { kg: null, erro: 'A quantidade a cotar deve ser maior que zero.' };
  return { kg };
}

export function validarObservacao(texto: string): string | undefined {
  return texto.trim().length > FORECAST_DECISAO_OBSERVACAO_MAX
    ? `A observação aceita no máximo ${FORECAST_DECISAO_OBSERVACAO_MAX} caracteres.`
    : undefined;
}

/** A cotacao leva o kg inteiro para cima: avisa quando o digitado tem casas decimais. */
export function avisoDeArredondamento(kg: number | null): string | undefined {
  if (kg === null) return undefined;
  const inteiro = kgInteiroParaCima(kg);
  return inteiro === kg ? undefined : `A cotação leva ${kgBr(inteiro)} kg (inteiro, para cima).`;
}

export function textoUsarSugerida(item: Pick<ItemDaCotacao, 'sugeridaKg'>): string | null {
  return item.sugeridaKg !== null && item.sugeridaKg > 0 ? sugeridaParaCampo(item.sugeridaKg) : null;
}

// ---------- bloqueios ----------

export interface ContextoDeBloqueio {
  produtosCarregando: boolean;
  produtosErro: boolean;
  /** Codigos do produto no cadastro; `undefined` = produto fora do cadastro. */
  codesDe: (productId: number) => readonly CodigoVinculavel[] | undefined;
  /** Codigo da cotacao aberta que ja tem o item (`null` = nenhuma). */
  cotacaoAbertaDe: (productId: number) => string | null;
}

/** Motivo que impede o item de virar cotacao (mesmos motivos do botao "Gerar cotacao" de antes); `null` = pode. */
export function motivoDeBloqueio(item: ItemDaCotacao, ctx: ContextoDeBloqueio): string | null {
  if (item.indisponivel) return MOTIVO_INDISPONIVEL;
  if (item.fonte.trim() === '') return MOTIVO_SEM_FONTE;
  const aberta = ctx.cotacaoAbertaDe(item.productId);
  if (aberta) return `Este item já está na cotação aberta ${aberta}.`;
  if (ctx.produtosCarregando) return MOTIVO_VERIFICANDO;
  if (ctx.produtosErro) return MOTIVO_ERRO_VINCULO;
  const codes = ctx.codesDe(item.productId);
  if (!codes || codigoParaCotacao(codes, null) === null) return MOTIVO_SEM_VINCULO;
  return null;
}

// ---------- agrupamento por fonte e resumo ----------

export interface GrupoDeFonte {
  chave: string;
  fonte: string;
  itens: ItemDaCotacao[];
}

/** Agrupa na ordem em que a fonte aparece; itens sem fonte ficam num grupo "Sem fonte". */
export function agruparPorFonte(itens: readonly ItemDaCotacao[]): GrupoDeFonte[] {
  const grupos = new Map<string, GrupoDeFonte>();
  for (const item of itens) {
    const chave = chaveDaFonte(item.fonte);
    const grupo = grupos.get(chave);
    if (grupo) grupo.itens.push(item);
    else grupos.set(chave, { chave, fonte: nomeDaFonte(item.fonte), itens: [item] });
  }
  return [...grupos.values()];
}

/** "Serao geradas 2 cotacoes: FONTE 002 (3 itens) e FONTE 003 (1 item)." */
export function textoResumoCotacoes(grupos: readonly GrupoDeFonte[]): string {
  const validos = grupos.filter((g) => g.chave !== '');
  if (validos.length === 0) return 'Nenhuma cotação será gerada: escolha ao menos um item.';
  const partes = validos.map((g) => `${g.fonte} (${g.itens.length} ${plural(g.itens.length, 'item', 'itens')})`);
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes[0];
  return validos.length === 1
    ? `Será gerada 1 cotação: ${lista}.`
    : `Serão geradas ${validos.length} cotações: ${lista}.`;
}

export function textoBotaoGerar(nCotacoes: number): string {
  return nCotacoes <= 1 ? 'Gerar cotação' : `Gerar ${nCotacoes} cotações`;
}

// ---------- rascunho e lote ----------

/** Item para o rascunho: quantidade invalida ou vazia vai como 0 (volta como campo vazio). */
export function paraItemDoRascunho(item: ItemDaCotacao): ForecastRascunhoItem {
  const lido = lerKgBr(item.kg);
  const valido = lido !== null && lido >= 0 && lido <= 10_000_000 && /^\d+(\.\d{1,3})?$/.test(String(lido));
  const obs = item.obs.trim().slice(0, FORECAST_DECISAO_OBSERVACAO_MAX);
  return { productId: item.productId, quantidadeKg: valido ? lido : 0, observacao: obs === '' ? null : obs };
}

/**
 * Item do lote. `incluidoManualmente: true` SEMPRE que o item e de fora da lista (o backend recusa sem ela). `atualizadoEm`
 * e o `atualizadaEm` da decisao que a tela leu (`null` = nao havia); `leuDecisoes: false` nao manda (nada para conferir).
 */
export function paraItemDoLote(
  item: ItemDaCotacao,
  kg: number,
  decisao: ForecastDecisao | undefined,
  leuDecisoes: boolean,
): ForecastCotacaoLoteItem {
  const obs = item.obs.trim();
  return {
    productId: item.productId,
    quantidadeKg: kg,
    observacao: obs === '' ? null : obs,
    ...(item.origem === 'candidato' ? { incluidoManualmente: true } : {}),
    ...(leuDecisoes ? { atualizadoEm: decisao?.atualizadaEm ?? null } : {}),
  };
}
