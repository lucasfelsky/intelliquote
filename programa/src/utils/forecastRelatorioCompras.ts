// Relatorio de compras do Forecast (PR 2A): funcoes PURAS sobre a quinzena JA calculada pelo motor.
// Sem banco, sem HTTP e sem parser de origem; o campo `origin` so e repassado para exibicao.
//
// Regra de ruptura (estimativa mensal-linear; trocar a regra = mexer so em `dataDeRuptura`):
//  - `projecao[i]` = saldo no FIM do mes base+i (i = 0..5). Consumo do mes: AG no mes base, Q nos demais.
//  - Disponivel antes do consumo do mes: D_i = projecao[i] + consumo_i (identidade do motor; chegadas e
//    programacoes do mes ficam implicitas).
//  - Mes da ruptura = primeiro i com projecao[i] < 0. Nenhum negativo nos 6 meses -> sem ruptura.
//  - Periodo do mes: no mes base vai da data-base ao ultimo dia do mes; nos demais, do dia 1 ao ultimo dia.
//  - Dia estimado: se D_i <= 0 ou consumo_i <= 0 -> inicio do periodo; senao inicio + floor(dias * D_i /
//    consumo_i) (consumo linear dentro do periodo), sempre dentro do mes.
// Data-limite do pedido = ruptura - lead time (AQ, dias corridos, sem folga). Vencida = data-limite < hoje.
//
// Urgencia (PR 2D, Comex 2026-10-22), 4 faixas em ordem de prioridade; dias = dias de hoje ate a ruptura estimada:
//  - sem ruptura em 6 meses -> 'no-prazo'; ruptura na data-base ou dias <= 0 -> 'sem-estoque';
//    dias <= N (DIAS_RUPTURA_CRITICA) -> 'critico'; data-limite vencida -> 'atrasado'; o resto -> 'no-prazo'.
//  - Ordem da lista: faixa -> dias ate a ruptura -> data-limite -> nome -> linha.
// Secao "Atencao: sem consumo": itens fora da lista de compra com media trimestral <= 0 e estoque ou programacao
// (so para conferencia, sem quantidade sugerida). Sem consumo, estoque nem programacao: so a contagem.
//
// Embalagens (PR 5B, Comex): a Qtd. final usa a embalagem em destaque (principal; sem principal, a do primeiro
// codigo cadastrado). Com mais de uma embalagem cadastrada o item ainda traz a quantidade arredondada para CADA
// uma (`porEmbalagem`), so para o comprador escolher na compra: nada disso muda a Qtd. final nem e persistido.
// Observacao (PR 5B): texto livre da quinzena (coluna AT da planilha), repassado como esta (so trim).
// Pallet fechado (PR 6e, Comex): o cadastro pode dizer quantos kg tem UM pallet da embalagem (`palletKg`, opcao de
// compra informada pelo cadastro, nao regra: pode nao ser multiplo da embalagem). Cada opcao de embalagem traz entao os pallets fechados ABAIXO e ACIMA da quantidade sugerida
// (`pallet`), so para o comprador escolher na compra: a Qtd. final continua sendo a da embalagem em destaque e nada
// disso e persistido.
//
// Compra sob demanda (PR 6a, Comex): produto marcado so e comprado quando o cliente envia a programacao. A linha que
// entraria na lista de compra NAO vira item: vai para `sobDemanda.itens` (com o motivo e a programacao ainda nao coberta
// por estoque e chegadas) e conta em `fora.sobDemanda`; nunca volta sozinha para a lista principal. Linha sob demanda
// que nao entraria nao muda; sem consumo so ganha o selo. O motor nao e tocado: a marca vem do cadastro ATUAL.
//
// Meses atipicos (PR 6c, Comex): o motor ja entrega Q/AN/projecao SEM os meses marcados; o relatorio so repassa QUAIS
// meses ficaram fora da media (`mesesForaDaMedia`, 'YYYY-MM' em ordem cronologica) para tela e XLSX avisarem. Sem marca
// o item sai como antes (lista vazia).
//
// Demanda do comercial (PR 6d, Comex): pedidos abertos lancados a mao para programacoes futuras (fora do horizonte do
// DBCorp) ganham a secao `demandaComercial` (regra pura em forecastDemandaComercial.ts); o item da lista de compra que
// tem pedido a somar ganha so o selo `demandaComercialKg` (a quantidade dele nao muda). Sem demandas a secao sai vazia.
//
// Grupos de equivalencia (PR 6b, Comex): produtos que sao o MESMO material tem o estoque avaliado SOMADO (regra pura em
// forecastGruposEquivalencia.ts). O grupo vira UMA linha sintetica (dados do produto PRINCIPAL) que passa por este mesmo
// pipeline: ruptura, embalagem/pallet (do principal), urgencia, sob demanda (so a marca do principal) e demanda do
// comercial (pedido de qualquer membro usa o saldo do grupo). Os membros saem da lista individual (nunca contam duas
// vezes); grupo coberto (a linha dele nao entraria) manda os membros que entrariam sozinhos para `cobertosPorGrupo`, com o
// motivo. Meses atipicos (6c): cada membro ja traz a sua media ajustada (a soma e natural). O motor nao e tocado.
//
// Encaixe de novas fontes de dados: qualquer provedor de entradas (planilha, DBCorp, futuro gateway) so
// precisa produzir a quinzena normalizada; este modulo consome o resultado do motor. Um provedor de
// embalagens so precisa devolver `EmbalagemCadastrada[]` (hoje `ForecastProductService.embalagensDosCodigos`,
// que le o cadastro por codigo; amanha o gateway DBCorp grava nas mesmas colunas).
import {
  avaliarDemandasComerciais,
  sugeridoPorLinha,
  type DemandaComercialAberta,
  type DemandaComercialDoRelatorio,
} from './forecastDemandaComercial';
import type { DecisaoCompraData } from './forecastDecisaoCompra';
import {
  agruparLinhas,
  linhasParaDemandaComercial,
  type DadosDoGrupo,
  type GrupoDeEquivalencia,
} from './forecastGruposEquivalencia';
import { somarDias, yearMonthsDaJanela } from './forecastMonths';
import { palletsDoCadastro } from './forecastPallets';
import { daysUntil, isValidDateKey } from './supplierDocumentDates';

export interface LinhaParaRelatorio {
  linha: number;
  n?: number | null;
  productId?: number | null;
  item: string;
  codigos: string[];
  fonte: string;
  status: string;
  Q: number;
  AG: number;
  U: number;
  AN: number | null;
  AQ: number | null;
  projecao: number[];
  chegadas: number[];
  programacoes: number[];
  naoFraciona?: boolean;
  /** Observacao congelada da quinzena (AT da planilha / notas do produto); ausente = ''. */
  obs?: string;
  /** PR 6c: meses de venda atipica que ficaram fora da media da linha (ja na janela da quinzena); ausente = nenhum. */
  mesesForaDaMedia?: Array<{ anoMes: string; /** 0..5 = J..O, 6 = P; ausente = conta como mes que muda a compra. */ indice?: number }>;
  /** PR 6c: Q e AG DA PLANILHA (todos os meses), so presentes com marca; comparados com Q/AG para saber se a marca mudou a compra. */
  mediaAjustada?: { Q: number; AG: number };
}

export interface QuinzenaParaRelatorio {
  id: number;
  label: string;
  baseDate: string;
  half: number;
  origin: string;
  hoje: string;
  linhas: LinhaParaRelatorio[];
}

export interface EmbalagemCadastrada {
  codigo: string;
  quantidade: number;
  rotulo?: string | null;
  principal?: boolean;
  /** kg de UM pallet fechado desta embalagem; ausente/nulo = sem pallet. */
  palletKg?: number | null;
  /** TODOS os tamanhos de pallet do codigo, o 1o primeiro; ausente = usa so `palletKg`. */
  palletsKg?: number[] | null;
}

export interface RupturaEstimada {
  indiceMes: number;
  anoMes: string;
  data: string;
  jaNaDataBase: boolean;
}

export interface EmbalagemDoItem {
  codigo: string;
  quantidade: number;
  rotulo: string | null;
  /** So quando o cadastro tem pallet (item sem pallet sai com o mesmo formato de antes). E o 1o tamanho. */
  palletKg?: number;
  /** Demais tamanhos de pallet do codigo; so existe com 2 ou mais tamanhos (com 0/1 a saida e a de antes). */
  outrosPalletsKg?: number[];
}

/** Pallets fechados ao redor da quantidade sugerida; `abaixo` e `acima` coincidem quando o multiplo e exato. */
export interface PalletDaOpcao {
  kgPorPallet: number;
  abaixo: { pallets: number; kg: number };
  acima: { pallets: number; kg: number };
}

export interface EscolhaDeEmbalagem {
  usada: EmbalagemDoItem | null;
  cadastradas: EmbalagemDoItem[];
  multiplas: boolean;
}

/** Quantidade do item arredondada para UMA embalagem cadastrada; `destaque` = a que gera a Qtd. final. */
export interface OpcaoDeEmbalagem extends Omit<EmbalagemDoItem, 'palletKg' | 'outrosPalletsKg'> {
  embalagens: number;
  quantidadeFinal: number;
  destaque: boolean;
  /** Multiplos de pallet abaixo/acima da quantidade sugerida; nulo = embalagem sem pallet (ou nada a comprar). */
  pallet: PalletDaOpcao | null;
  /** Pallets dos demais tamanhos (mesma ordem do cadastro); so com 2+ tamanhos e algo a comprar. */
  outrosPallets?: PalletDaOpcao[];
}

export interface ItemRelatorioCompras {
  linha: number;
  n: number | null;
  productId: number | null;
  item: string;
  codigos: string[];
  status: string;
  demanda: number;
  quantidadeSugerida: number;
  embalagem: EscolhaDeEmbalagem;
  /** Uma opcao por embalagem cadastrada (ordem EMB.1..7); vazio sem embalagem. A de `destaque` = Qtd. final. */
  porEmbalagem: OpcaoDeEmbalagem[];
  quantidadeEmbalagens: number | null;
  quantidadeFinal: number;
  naoFraciona: boolean;
  /** Observacao da quinzena ('' quando nao ha). */
  obs: string;
  /** Meses de venda atipica fora da media deste item (PR 6c), 'YYYY-MM' cronologico; vazio = media da planilha. */
  mesesForaDaMedia: string[];
  /** PR 6d: kg a somar pelos pedidos abertos do comercial (alem do horizonte); ausente = nenhum. */
  demandaComercialKg?: number;
  /** PR 6b: o item e a linha de um GRUPO de equivalencia (nome do grupo em `item`; os membros vem aqui). */
  grupo?: DadosDoGrupo;
  /** PR3: so no XLSX (anexado em ForecastSnapshotService); ausente na rota JSON. */
  decisao?: DecisaoCompraData | null;
  ruptura: RupturaEstimada | null;
  dataLimite: string | null;
  vencida: boolean;
  leadTimeDias: number;
  emAndamento: {
    chegadas: Array<{ anoMes: string; quantidade: number }>;
    programacoes: Array<{ anoMes: string; quantidade: number }>;
  };
  urgencia: UrgenciaId;
  diasAteRuptura: number | null;
  /** 0-based na ordem global de urgencia; tela e XLSX ordenam por este numero sem repetir a regra. */
  posicaoUrgencia: number;
}

export interface GrupoRelatorioCompras {
  fonte: string;
  leadTimeDias: number;
  dataLimiteMaisUrgente: string | null;
  vencidas: number;
  urgenciaMaisAlta: UrgenciaId;
  porUrgencia: Record<UrgenciaId, number>;
  itens: ItemRelatorioCompras[];
}

export type MotivoSemConsumo = 'programacao' | 'estoque';

export interface ItemSemConsumo {
  linha: number;
  n: number | null;
  productId: number | null;
  item: string;
  codigos: string[];
  fonte: string;
  status: string;
  motivos: MotivoSemConsumo[];
  estoque: number;
  programado: number;
  programacoes: Array<{ anoMes: string; quantidade: number }>;
  chegadas: Array<{ anoMes: string; quantidade: number }>;
  semLeadTime: boolean;
  /** Observacao da quinzena ('' quando nao ha). */
  obs: string;
  /** Meses de venda atipica fora da media deste item (PR 6c); vazio = media da planilha. */
  mesesForaDaMedia: string[];
  /** Produto marcado como compra sob demanda (so selo; a lista continua a mesma). */
  sobDemanda: boolean;
  /** PR 6b: a linha e um grupo de equivalencia (sem consumo no grupo todo). */
  grupo?: DadosDoGrupo;
}

// Item sob demanda que entraria na lista de compra: fica fora dela e aparece em secao propria.
export interface ItemSobDemanda {
  linha: number;
  n: number | null;
  productId: number | null;
  item: string;
  codigos: string[];
  fonte: string;
  status: string;
  /** Motivo cadastrado ao marcar o produto; nulo = marcado sem motivo. */
  motivo: string | null;
  /** AN do motor (<= 0), so informativo: a quantidade que a lista de compra sugeriria. */
  demanda: number;
  quantidadeSugerida: number;
  estoque: number;
  chegadas: Array<{ anoMes: string; quantidade: number }>;
  programacoes: Array<{ anoMes: string; quantidade: number }>;
  programado: number;
  /** max(0, programacoes - estoque - chegadas): o que a programacao do cliente ainda nao tem de cobertura. */
  programacaoDescoberta: number;
  /** Observacao da quinzena ('' quando nao ha): o item sai da lista de compra, a nota vai junto. */
  obs: string;
  /** Meses de venda atipica fora da media deste item (PR 6c); vazio = media da planilha. */
  mesesForaDaMedia: string[];
  /** PR 6b: a linha e um grupo de equivalencia cujo principal esta marcado como sob demanda. */
  grupo?: DadosDoGrupo;
}

// Membro que entraria sozinho na lista de compra, mas o estoque SOMADO do grupo o cobre (PR 6b).
export interface ItemCobertoPorGrupo {
  linha: number;
  n: number | null;
  productId: number;
  item: string;
  codigos: string[];
  fonte: string;
  status: string;
  /** AN do membro sozinho (<= 0): o que a lista de compra sugeriria. */
  demanda: number;
  quantidadeSugerida: number;
  grupoId: number;
  grupoNome: string;
  /** Produto principal do grupo (o que compraria se o grupo precisasse). */
  principalItem: string;
  /** Observacao do grupo no cadastro (so trim); vazia sem texto. A equivalencia pode nao valer para todos os clientes. */
  grupoObservacao: string;
  /** Estoque somado do grupo (kg) e cobertura em meses ((estoque + chegadas) / media do grupo). */
  estoqueDoGrupo: number;
  cobertura: number | null;
  obs: string;
  mesesForaDaMedia: string[];
}

export type SituacaoDoGrupo = 'na-lista' | 'sob-demanda' | 'coberto' | 'sem-lead-time';

/** Grupo formado na quinzena (2 ou mais membros presentes) e o que aconteceu com ele no relatorio. */
export interface GrupoNoRelatorio extends DadosDoGrupo {
  situacao: SituacaoDoGrupo;
}

export interface RelatorioCompras {
  quinzena: { id: number; label: string; baseDate: string; half: number; origin: string; hoje: string };
  totais: {
    itens: number;
    fontes: number;
    vencidas: number;
    semEmbalagem: number;
    multiplasEmbalagens: number;
    /** Itens com pallet cadastrado em ao menos uma embalagem. */
    comPallet: number;
    porUrgencia: Record<UrgenciaId, number>;
  };
  fora: {
    semLeadTime: number;
    semConsumoSemFalta: number;
    semConsumoSemMovimento: number;
    /** Itens que entrariam na lista de compra mas estao marcados como compra sob demanda. */
    sobDemanda: number;
    /** PR 6b: membros que entrariam sozinhos na lista, mas o estoque somado do grupo cobre. */
    cobertosPorGrupo: number;
  };
  urgencia: { diasCritico: number };
  semConsumo: { itens: ItemSemConsumo[] };
  sobDemanda: { itens: ItemSobDemanda[] };
  /** PR 6d: pedidos abertos do comercial (lancados a mao); vazio sem pedidos. */
  demandaComercial: DemandaComercialDoRelatorio;
  /** PR 6b: membros fora da lista de compra por cobertura do grupo; vazio sem grupos. */
  cobertosPorGrupo: { itens: ItemCobertoPorGrupo[] };
  /** PR 6b: grupos formados na quinzena (ordem alfabetica), com o destino de cada um; vazio sem grupos. */
  gruposDeEquivalencia: GrupoNoRelatorio[];
  grupos: GrupoRelatorioCompras[];
}

export type UrgenciaId = 'sem-estoque' | 'critico' | 'atrasado' | 'no-prazo';

// Prioridade: o indice na lista e a ordem das faixas.
export const URGENCIAS: readonly UrgenciaId[] = ['sem-estoque', 'critico', 'atrasado', 'no-prazo'];

// Comex 2026-10-22: 15 dias (uma quinzena). 0 desliga a faixa "Ruptura em ate N dias".
export const DIAS_RUPTURA_CRITICA = 15;

// Varias embalagens no item: usa a marcada como principal; sem principal, a de menor posicao (EMB.1 -> EMB.7).
export const REGRA_EMBALAGEM = 'principal-depois-menor-posicao' as const;

// Tolerancia numerica do arredondamento (evita 2,0000000000005 virar 3 embalagens).
const EPS = 1e-9;

const pad2 = (n: number) => String(n).padStart(2, '0');

const semMenosZero = (n: number) => (n === 0 ? 0 : n);

const arredondar6 = (n: number) => Math.round(n * 1e6) / 1e6;

// Item com demanda a comprar: lead time conhecido, demanda <= 0 e (consumo > 0 ou falta real).
// Fora: sem lead time (AN nulo) e sem consumo com demanda = 0. Sem consumo com demanda < 0 entra.
export function entraNoRelatorio(l: Pick<LinhaParaRelatorio, 'AN' | 'Q'>): boolean {
  return l.AN !== null && l.AN <= 0 && (l.Q > 0 || l.AN < 0);
}

export function dataDeRuptura(
  l: Pick<LinhaParaRelatorio, 'projecao' | 'Q' | 'AG'>,
  baseDate: string,
): RupturaEstimada | null {
  const indice = l.projecao.findIndex((p) => p < 0);
  if (indice < 0) {
    return null;
  }
  const anoMes = yearMonthsDaJanela(baseDate, 6)[indice];
  if (!anoMes) {
    return null;
  }
  const ano = Number(anoMes.slice(0, 4));
  const mes = Number(anoMes.slice(5, 7));
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diaInicio = indice === 0 ? Number(baseDate.slice(8, 10)) : 1;
  const inicio = `${anoMes}-${pad2(diaInicio)}`;
  const dias = ultimoDia - diaInicio + 1;
  const consumo = indice === 0 ? l.AG : l.Q;
  const disponivel = l.projecao[indice] + consumo;

  if (disponivel <= 0 || consumo <= 0) {
    return { indiceMes: indice, anoMes, data: inicio, jaNaDataBase: indice === 0 };
  }
  const deslocamento = Math.min(dias - 1, Math.floor((dias * disponivel) / consumo + EPS));
  return { indiceMes: indice, anoMes, data: somarDias(inicio, deslocamento), jaNaDataBase: false };
}

export function dataLimiteDoPedido(ruptura: string, leadTimeDias: number): string {
  return somarDias(ruptura, -leadTimeDias);
}

export function escolherEmbalagem(codigos: string[], embalagens: EmbalagemCadastrada[]): EscolhaDeEmbalagem {
  const validas = new Map<string, EmbalagemCadastrada>();
  for (const e of embalagens) {
    if (!Number.isFinite(e.quantidade) || e.quantidade <= 0) continue;
    const chave = e.codigo.toUpperCase();
    if (!validas.has(chave)) validas.set(chave, e);
  }

  const cadastradas: EmbalagemDoItem[] = [];
  let principal: EmbalagemDoItem | null = null;
  const vistos = new Set<string>();
  for (const codigo of codigos) {
    const chave = codigo.toUpperCase();
    const emb = validas.get(chave);
    if (!codigo || !emb || vistos.has(chave)) continue;
    vistos.add(chave);
    const dado: EmbalagemDoItem = { codigo, quantidade: emb.quantidade, rotulo: emb.rotulo ?? null };
    // Lista completa informada (`palletsKg`) manda e o 1o dela e o palletKg; sem ela vale so `palletKg`.
    const pallets = emb.palletsKg ? palletsDoCadastro(null, emb.palletsKg) : palletsDoCadastro(emb.palletKg ?? null, []);
    if (pallets.length > 0) dado.palletKg = pallets[0];
    if (pallets.length > 1) dado.outrosPalletsKg = pallets.slice(1);
    cadastradas.push(dado);
    if (principal === null && emb.principal === true) principal = dado;
  }

  return {
    usada: principal ?? cadastradas[0] ?? null,
    cadastradas,
    multiplas: cadastradas.length > 1,
  };
}

export function arredondarPorEmbalagem(
  quantidade: number,
  porEmbalagem: number,
): { embalagens: number; quantidade: number } {
  if (!Number.isFinite(porEmbalagem) || porEmbalagem <= 0) {
    throw new Error('Quantidade por embalagem invalida.');
  }
  const embalagens = Math.max(0, Math.ceil(quantidade / porEmbalagem - EPS));
  return { embalagens: semMenosZero(embalagens), quantidade: semMenosZero(embalagens * porEmbalagem) };
}

// Pallets fechados abaixo e acima da quantidade (kg). A base e a quantidade SUGERIDA, nao a Qtd. final ja
// arredondada pela embalagem. Multiplo exato: abaixo == acima.
export function opcoesDePallet(quantidade: number, kgPorPallet: number): PalletDaOpcao {
  if (!Number.isFinite(kgPorPallet) || kgPorPallet <= 0) {
    throw new Error('Quantidade por pallet invalida.');
  }
  const pallets = (n: number) => ({ pallets: semMenosZero(n), kg: semMenosZero(arredondar6(n * kgPorPallet)) });
  return {
    kgPorPallet,
    abaixo: pallets(Math.max(0, Math.floor(quantidade / kgPorPallet + EPS))),
    acima: pallets(Math.max(0, Math.ceil(quantidade / kgPorPallet - EPS))),
  };
}

// O pallet cabe um numero inteiro de vezes a embalagem (tolerancia de 1e-6 kg para os decimais)? Nao e mais regra
// bloqueante (rodada 5 do Comex); continua exportada (consumida pelo preview local do Forecast).
export function palletEMultiploDaEmbalagem(palletKg: number, embalagemKg: number): boolean {
  if (!Number.isFinite(palletKg) || !Number.isFinite(embalagemKg) || palletKg <= 0 || embalagemKg <= 0) return false;
  const vezes = Math.round(palletKg / embalagemKg);
  return vezes >= 1 && Math.abs(palletKg - vezes * embalagemKg) <= 1e-6;
}

// Uma opcao por embalagem cadastrada (mesma ordem de `escolha.cadastradas`), cada uma com a quantidade do item
// arredondada para cima nos multiplos dela. A `destaque` e a `escolha.usada`: mesmos numeros de quantidadeFinal.
// Com pallet cadastrado (e algo a comprar) a opcao traz tambem os pallets fechados abaixo e acima da quantidade.
export function arredondarParaCadaEmbalagem(quantidade: number, escolha: EscolhaDeEmbalagem): OpcaoDeEmbalagem[] {
  return escolha.cadastradas.map(({ palletKg, outrosPalletsKg, ...e }) => {
    const arredondado = arredondarPorEmbalagem(quantidade, e.quantidade);
    const opcao: OpcaoDeEmbalagem = {
      ...e,
      embalagens: arredondado.embalagens,
      quantidadeFinal: arredondado.quantidade,
      destaque: e.codigo === escolha.usada?.codigo,
      pallet: palletKg !== undefined && quantidade > 0 ? opcoesDePallet(quantidade, palletKg) : null,
    };
    if (outrosPalletsKg && outrosPalletsKg.length > 0 && quantidade > 0) {
      opcao.outrosPallets = outrosPalletsKg.map((kg) => opcoesDePallet(quantidade, kg));
    }
    return opcao;
  });
}

function mesesComValor(valores: number[], anoMes: string[]): Array<{ anoMes: string; quantidade: number }> {
  const saida: Array<{ anoMes: string; quantidade: number }> = [];
  valores.forEach((quantidade, i) => {
    if (quantidade > 0 && anoMes[i]) saida.push({ anoMes: anoMes[i], quantidade });
  });
  return saida;
}

// So avisa no relatorio quando a marca MUDA a compra: marca em J/K/L muda so R (nao entra em T, AN nem na projecao), e
// marca que nao altera Q/AG (ex.: os 3 meses do trimestre marcados = sem mes valido) deixa a linha igual a da planilha.
// A memoria de calculo da tela continua mostrando todas as marcas.
const MIN_INDICE_QUE_MUDA_A_COMPRA = 3; // M, N, O (Q) e P (AG)
const mesmoValor = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const mesesForaDaMediaDaLinha = (
  l: Pick<LinhaParaRelatorio, 'mesesForaDaMedia' | 'mediaAjustada' | 'Q' | 'AG'>,
): string[] => {
  const relevantes = (l.mesesForaDaMedia ?? []).filter(
    (m) => m.indice === undefined || m.indice >= MIN_INDICE_QUE_MUDA_A_COMPRA,
  );
  if (relevantes.length === 0) return [];
  if (l.mediaAjustada && mesmoValor(l.mediaAjustada.Q, l.Q) && mesmoValor(l.mediaAjustada.AG, l.AG)) return [];
  return relevantes.map((m) => m.anoMes);
};

const compararTexto = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

// Datas (YYYY-MM-DD) comparam como texto; nulo vai por ultimo.
function compararDataNulaPorUltimo(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function contarPorUrgencia(itens: Array<Pick<ItemRelatorioCompras, 'urgencia'>>): Record<UrgenciaId, number> {
  const contagem: Record<UrgenciaId, number> = { 'sem-estoque': 0, critico: 0, atrasado: 0, 'no-prazo': 0 };
  for (const i of itens) contagem[i.urgencia] += 1;
  return contagem;
}

// Faixa de urgencia do item. Nao altera a data de ruptura nem a data-limite: so classifica.
export function urgenciaDoItem(
  item: Pick<ItemRelatorioCompras, 'ruptura' | 'vencida'>,
  hoje: string,
  diasCritico: number,
): { urgencia: UrgenciaId; diasAteRuptura: number | null } {
  if (item.ruptura === null) {
    return { urgencia: 'no-prazo', diasAteRuptura: null };
  }
  const dias = daysUntil(item.ruptura.data, hoje);
  if (item.ruptura.jaNaDataBase || dias <= 0) {
    return { urgencia: 'sem-estoque', diasAteRuptura: dias };
  }
  if (dias <= diasCritico) {
    return { urgencia: 'critico', diasAteRuptura: dias };
  }
  return { urgencia: item.vencida ? 'atrasado' : 'no-prazo', diasAteRuptura: dias };
}

function compararNumeroNuloPorUltimo(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

type ChaveDeUrgencia = Pick<ItemRelatorioCompras, 'urgencia' | 'diasAteRuptura' | 'dataLimite' | 'item' | 'linha'>;

// Faixa -> dias ate a ruptura (nulo por ultimo) -> data-limite (nula por ultimo) -> nome -> linha.
export function compararUrgencia(a: ChaveDeUrgencia, b: ChaveDeUrgencia): number {
  return (
    URGENCIAS.indexOf(a.urgencia) - URGENCIAS.indexOf(b.urgencia) ||
    compararNumeroNuloPorUltimo(a.diasAteRuptura, b.diasAteRuptura) ||
    compararDataNulaPorUltimo(a.dataLimite, b.dataLimite) ||
    compararTexto(a.item, b.item) ||
    a.linha - b.linha
  );
}

// Todos os itens do relatorio numa lista unica na ordem de urgencia, cada um com a fonte do seu grupo.
export function itensNaOrdemDeUrgencia(
  r: Pick<RelatorioCompras, 'grupos'>,
): Array<{ item: ItemRelatorioCompras; fonte: string }> {
  return r.grupos
    .flatMap((g) => g.itens.map((item) => ({ item, fonte: g.fonte })))
    .sort((a, b) => a.item.posicaoUrgencia - b.item.posicaoUrgencia);
}

const somaProgramacoes = (l: Pick<LinhaParaRelatorio, 'programacoes'>) =>
  l.programacoes.slice(0, 4).reduce((total, v) => total + v, 0);

// Motivos para a linha aparecer em "Atencao: sem consumo" (vazio = nao aparece). Ordem fixa: programacao, estoque.
export function motivosSemConsumo(
  l: Pick<LinhaParaRelatorio, 'AN' | 'Q' | 'U' | 'programacoes'>,
): MotivoSemConsumo[] {
  if (entraNoRelatorio(l) || l.Q > 0) {
    return [];
  }
  const motivos: MotivoSemConsumo[] = [];
  if (somaProgramacoes(l) > 0) motivos.push('programacao');
  if (l.U > 0) motivos.push('estoque');
  return motivos;
}

const somaChegadas = (l: Pick<LinhaParaRelatorio, 'chegadas'>) =>
  l.chegadas.slice(0, 5).reduce((total, v) => total + v, 0);

function compararSobDemanda(a: ItemSobDemanda, b: ItemSobDemanda): number {
  return (
    b.programacaoDescoberta - a.programacaoDescoberta ||
    compararTexto(a.fonte, b.fonte) ||
    compararTexto(a.item, b.item) ||
    a.linha - b.linha
  );
}

function compararSemConsumo(a: ItemSemConsumo, b: ItemSemConsumo): number {
  const pa = a.motivos.includes('programacao') ? 0 : 1;
  const pb = b.motivos.includes('programacao') ? 0 : 1;
  return pa - pb || compararTexto(a.fonte, b.fonte) || compararTexto(a.item, b.item) || a.linha - b.linha;
}

export function montarRelatorioCompras(
  q: QuinzenaParaRelatorio,
  embalagens: EmbalagemCadastrada[],
  // `sobDemanda`: chave = productId do cadastro; sem a opcao o resultado e o mesmo de antes (so ganha secao vazia).
  // `demandasComerciais` (PR 6d): pedidos abertos do cadastro; sem a opcao a secao sai vazia.
  // `grupos` (PR 6b): grupos de equivalencia do cadastro; sem a opcao nada muda (a secao e a lista saem vazias).
  opcoes: {
    diasCritico?: number;
    sobDemanda?: ReadonlyMap<number, { motivo: string | null }>;
    demandasComerciais?: DemandaComercialAberta[];
    grupos?: GrupoDeEquivalencia[];
  } = {},
): RelatorioCompras {
  const diasCritico = opcoes.diasCritico ?? DIAS_RUPTURA_CRITICA;
  const regraSobDemanda = (l: Pick<LinhaParaRelatorio, 'productId'>) =>
    l.productId != null ? opcoes.sobDemanda?.get(l.productId) : undefined;
  if (!Number.isInteger(diasCritico) || diasCritico < 0) {
    throw new Error('Limite de dias da faixa critica invalido.');
  }
  if (!isValidDateKey(q.baseDate)) {
    throw new Error(`Data base invalida: ${String(q.baseDate)}`);
  }
  if (!isValidDateKey(q.hoje)) {
    throw new Error(`Data invalida: ${String(q.hoje)}`);
  }
  const meses = yearMonthsDaJanela(q.baseDate, 6);
  // Grupos de equivalencia (PR 6b): o grupo ocupa o lugar do principal; os outros membros saem da lista individual.
  const agrupado = agruparLinhas(q.linhas, opcoes.grupos ?? []);
  const grupoDaLinha = new Map(agrupado.grupos.map((g) => [g.linha.linha, g.dados]));
  const comGrupo = (l: Pick<LinhaParaRelatorio, 'linha'>) => {
    const grupo = grupoDaLinha.get(l.linha);
    return grupo ? { grupo } : {};
  };

  let semLeadTime = 0;
  let semConsumoSemFalta = 0;
  let semConsumoSemMovimento = 0;
  const semConsumoItens: ItemSemConsumo[] = [];
  const sobDemandaItens: ItemSobDemanda[] = [];
  const porFonte = new Map<string, { fonte: string; leadTimeDias: number; itens: ItemRelatorioCompras[] }>();

  // Fora da lista de compra: sem consumo com estoque ou programacao vai para a secao de atencao; sem nada, so conta.
  const registrarSemConsumo = (l: LinhaParaRelatorio) => {
    if (l.Q > 0) return;
    const motivos = motivosSemConsumo(l);
    if (motivos.length === 0) {
      semConsumoSemMovimento += 1;
      return;
    }
    semConsumoItens.push({
      linha: l.linha,
      n: l.n ?? null,
      productId: l.productId ?? null,
      item: l.item,
      codigos: l.codigos,
      fonte: l.fonte.trim(),
      status: l.status,
      motivos,
      estoque: l.U,
      programado: somaProgramacoes(l),
      programacoes: mesesComValor(l.programacoes.slice(0, 4), meses),
      chegadas: mesesComValor(l.chegadas.slice(0, 5), meses),
      semLeadTime: l.AN === null,
      obs: (l.obs ?? '').trim(),
      mesesForaDaMedia: mesesForaDaMediaDaLinha(l),
      sobDemanda: regraSobDemanda(l) !== undefined,
      ...comGrupo(l),
    });
  };

  for (const l of agrupado.linhas) {
    if (l.AN === null) {
      registrarSemConsumo(l);
      semLeadTime += 1;
      continue;
    }
    if (!entraNoRelatorio(l)) {
      registrarSemConsumo(l);
      if (l.AN <= 0) semConsumoSemFalta += 1;
      continue;
    }

    // Compra sob demanda: o item que entraria sai da lista de compra e vai para a secao propria, com o motivo.
    const sob = regraSobDemanda(l);
    if (sob) {
      const programado = somaProgramacoes(l);
      sobDemandaItens.push({
        linha: l.linha,
        n: l.n ?? null,
        productId: l.productId ?? null,
        item: l.item,
        codigos: l.codigos,
        fonte: l.fonte.trim(),
        status: l.status,
        motivo: sob.motivo,
        demanda: semMenosZero(l.AN),
        quantidadeSugerida: semMenosZero(Math.abs(l.AN)),
        estoque: l.U,
        chegadas: mesesComValor(l.chegadas.slice(0, 5), meses),
        programacoes: mesesComValor(l.programacoes.slice(0, 4), meses),
        programado,
        programacaoDescoberta: semMenosZero(Math.max(0, arredondar6(programado - l.U - somaChegadas(l)))),
        obs: (l.obs ?? '').trim(),
        mesesForaDaMedia: mesesForaDaMediaDaLinha(l),
        ...comGrupo(l),
      });
      continue;
    }

    const leadTimeDias = l.AQ ?? 0;
    const quantidadeSugerida = semMenosZero(Math.abs(l.AN));
    const embalagem = escolherEmbalagem(l.codigos, embalagens);
    const arredondado = embalagem.usada
      ? arredondarPorEmbalagem(quantidadeSugerida, embalagem.usada.quantidade)
      : null;
    const ruptura = dataDeRuptura(l, q.baseDate);
    const dataLimite = ruptura ? dataLimiteDoPedido(ruptura.data, leadTimeDias) : null;

    const item: ItemRelatorioCompras = {
      linha: l.linha,
      n: l.n ?? null,
      productId: l.productId ?? null,
      item: l.item,
      codigos: l.codigos,
      status: l.status,
      demanda: semMenosZero(l.AN),
      quantidadeSugerida,
      embalagem,
      porEmbalagem: arredondarParaCadaEmbalagem(quantidadeSugerida, embalagem),
      quantidadeEmbalagens: arredondado ? arredondado.embalagens : null,
      quantidadeFinal: arredondado ? arredondado.quantidade : quantidadeSugerida,
      naoFraciona: l.naoFraciona === true,
      obs: (l.obs ?? '').trim(),
      mesesForaDaMedia: mesesForaDaMediaDaLinha(l),
      ...comGrupo(l),
      ruptura,
      dataLimite,
      vencida: dataLimite !== null && dataLimite < q.hoje,
      leadTimeDias,
      emAndamento: {
        chegadas: mesesComValor(l.chegadas.slice(0, 5), meses),
        programacoes: mesesComValor(l.programacoes.slice(0, 4), meses),
      },
      urgencia: 'no-prazo',
      diasAteRuptura: null,
      posicaoUrgencia: 0,
    };
    Object.assign(item, urgenciaDoItem(item, q.hoje, diasCritico));

    const chave = l.fonte.trim().toUpperCase();
    const grupo = porFonte.get(chave);
    if (grupo) {
      grupo.itens.push(item);
    } else {
      porFonte.set(chave, { fonte: l.fonte.trim(), leadTimeDias, itens: [item] });
    }
  }

  // Ordem global de urgencia; `posicaoUrgencia` e gravada no item para tela e XLSX nao repetirem a regra.
  [...porFonte.values()]
    .flatMap((g) => g.itens)
    .sort(compararUrgencia)
    .forEach((item, i) => {
      item.posicaoUrgencia = i;
    });

  const grupos: GrupoRelatorioCompras[] = [...porFonte.values()].map((g) => {
    const itens = [...g.itens].sort((a, b) => a.posicaoUrgencia - b.posicaoUrgencia);
    return {
      fonte: g.fonte,
      leadTimeDias: g.leadTimeDias,
      dataLimiteMaisUrgente: itens.reduce<string | null>(
        (menor, i) => (compararDataNulaPorUltimo(i.dataLimite, menor) < 0 ? i.dataLimite : menor),
        null,
      ),
      vencidas: itens.filter((i) => i.vencida).length,
      urgenciaMaisAlta: itens[0].urgencia,
      porUrgencia: contarPorUrgencia(itens),
      itens,
    };
  });
  grupos.sort((a, b) => a.itens[0].posicaoUrgencia - b.itens[0].posicaoUrgencia);
  semConsumoItens.sort(compararSemConsumo);
  sobDemandaItens.sort(compararSobDemanda);

  // Cobertura pelo grupo (PR 6b): o grupo cuja linha nao entraria na lista cobre os membros que entrariam sozinhos.
  const cobertosItens: ItemCobertoPorGrupo[] = [];
  const gruposDeEquivalencia = agrupado.grupos
    .map<GrupoNoRelatorio>((g) => {
      const situacao: SituacaoDoGrupo =
        g.linha.AN === null
          ? 'sem-lead-time'
          : !entraNoRelatorio(g.linha)
            ? 'coberto'
            : regraSobDemanda(g.linha)
              ? 'sob-demanda'
              : 'na-lista';
      if (situacao === 'coberto') {
        for (const m of g.membros) {
          if (m.AN === null || !entraNoRelatorio(m)) continue;
          cobertosItens.push({
            linha: m.linha,
            n: m.n ?? null,
            productId: m.productId as number,
            item: m.item,
            codigos: m.codigos,
            fonte: m.fonte.trim(),
            status: m.status,
            demanda: semMenosZero(m.AN),
            quantidadeSugerida: semMenosZero(Math.abs(m.AN)),
            grupoId: g.dados.id,
            grupoNome: g.dados.nome,
            principalItem: g.dados.principalItem,
            grupoObservacao: g.dados.observacao,
            estoqueDoGrupo: g.dados.estoque,
            cobertura: g.dados.cobertura,
            obs: (m.obs ?? '').trim(),
            mesesForaDaMedia: mesesForaDaMediaDaLinha(m),
          });
        }
      }
      return { ...g.dados, situacao };
    })
    .sort((a, b) => compararTexto(a.nome, b.nome) || a.id - b.id);
  cobertosItens.sort(
    (a, b) => compararTexto(a.grupoNome, b.grupoNome) || compararTexto(a.item, b.item) || a.linha - b.linha,
  );

  const todos = grupos.flatMap((g) => g.itens);
  const demandaComercial = avaliarDemandasComerciais(
    linhasParaDemandaComercial(q.linhas, agrupado.grupos),
    opcoes.demandasComerciais ?? [],
    q.baseDate,
    new Set(todos.map((i) => i.linha)),
  );
  for (const [linha, kg] of sugeridoPorLinha(demandaComercial.itens)) {
    const item = todos.find((i) => i.linha === linha);
    if (item) item.demandaComercialKg = kg;
  }
  return {
    quinzena: {
      id: q.id,
      label: q.label,
      baseDate: q.baseDate,
      half: q.half,
      origin: q.origin,
      hoje: q.hoje,
    },
    totais: {
      itens: todos.length,
      fontes: grupos.length,
      vencidas: todos.filter((i) => i.vencida).length,
      semEmbalagem: todos.filter((i) => i.embalagem.usada === null).length,
      multiplasEmbalagens: todos.filter((i) => i.embalagem.multiplas).length,
      comPallet: todos.filter((i) => i.porEmbalagem.some((o) => o.pallet !== null)).length,
      porUrgencia: contarPorUrgencia(todos),
    },
    fora: {
      semLeadTime,
      semConsumoSemFalta,
      semConsumoSemMovimento,
      sobDemanda: sobDemandaItens.length,
      cobertosPorGrupo: cobertosItens.length,
    },
    urgencia: { diasCritico },
    semConsumo: { itens: semConsumoItens },
    sobDemanda: { itens: sobDemandaItens },
    demandaComercial,
    cobertosPorGrupo: { itens: cobertosItens },
    gruposDeEquivalencia,
    grupos,
  };
}
