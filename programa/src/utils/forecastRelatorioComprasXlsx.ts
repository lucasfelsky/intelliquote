// Exportacao XLSX do relatorio de compras do Forecast (PR 2B; urgencia e "sem consumo" no PR 2D).
// Util PURO: recebe o relatorio ja montado (o mesmo objeto que a tela exibe) e so FORMATA.
// Nao recalcula nada (ruptura, data-limite, urgencia, embalagem, ordem, filtro) e nao depende da origem dos dados.
// Datas saem como texto dd/mm/aaaa, igual a tela. Rotulos e formatos espelham o web
// (guarda de paridade em tests/forecast-relatorio-compras-xlsx.test.ts).
import exceljs from 'exceljs';
import type { ItemDemandaComercial } from './forecastDemandaComercial';
import { URGENCIAS, itensNaOrdemDeUrgencia } from './forecastRelatorioCompras';
import type {
  GrupoRelatorioCompras,
  ItemRelatorioCompras,
  ItemSemConsumo,
  ItemSobDemanda,
  MotivoSemConsumo,
  OpcaoDeEmbalagem,
  PalletDaOpcao,
  RelatorioCompras,
  UrgenciaId,
} from './forecastRelatorioCompras';

export const ABA_RELATORIO = 'Relatório de compras';
export const ABA_POR_URGENCIA = 'Por urgência';
export const ABA_SEM_CONSUMO = 'Atenção sem consumo';
export const ABA_SOB_DEMANDA = 'Sob demanda';
export const ABA_DEMANDA_COMERCIAL = 'Demanda do comercial';
export const ABA_REGRAS = 'Regras';

// As colunas da tela (+ Urgencia e Dias ate a ruptura); Item / Embalagem / Data-limite desdobradas em colunas filtraveis.
// Colunas novas entram no fim, mas a Observacao (PR 5B) continua a ULTIMA: 'Meses fora da média' (PR 6c) entra antes dela.
export const COLUNAS_RELATORIO_XLSX = [
  'Item',
  'Urgência',
  'Códigos',
  'Não fraciona',
  'Status',
  'Demanda',
  'Qtd. sugerida',
  'Embalagem',
  'Arredondamento',
  'Outras embalagens',
  'Qtd. final',
  'Saldo zera',
  'Ruptura',
  'Dias até a ruptura',
  'Data-limite',
  'Vencida',
  'Em andamento',
  'Meses fora da média',
  'Observação',
] as const;

// Aba "Por urgencia": lista unica; ganha a coluna Fonte depois de Urgencia.
export const COLUNAS_POR_URGENCIA_XLSX = [
  'Item',
  'Urgência',
  'Fonte',
  ...COLUNAS_RELATORIO_XLSX.slice(COLUNAS_RELATORIO_XLSX.indexOf('Códigos')),
] as const;

export const COLUNAS_SEM_CONSUMO_XLSX = [
  'Item',
  'Códigos',
  'Fonte',
  'Status',
  'Motivo',
  'Estoque',
  'Programado',
  'Programações',
  'Chegadas',
  'Meses fora da média',
  'Observação',
] as const;

// Aba "Sob demanda" (PR 6a): so existe quando ha item sob demanda; Observacao segue a ultima coluna.
export const COLUNAS_SOB_DEMANDA_XLSX = [
  'Item',
  'Códigos',
  'Fonte',
  'Status',
  'Motivo',
  'Demanda',
  'Programações',
  'Programação descoberta',
  'Estoque',
  'Chegadas',
  'Meses fora da média',
  'Observação',
] as const;

// Aba "Demanda do comercial" (PR 6d): so existe quando ha pedido aberto; mesmas colunas da tela (sem Acoes) e a
// Observacao segue a ultima coluna.
export const COLUNAS_DEMANDA_COMERCIAL_XLSX = [
  'Item',
  'Fonte',
  'Necessidade',
  'Pedido (kg)',
  'Saldo livre no mês',
  'Sugerido',
  'Motivo',
  'Cliente',
  'Solicitação',
  'Situação',
  'Observação',
] as const;

// Copia exata de STATUS_ROTULO (web/src/pages/Forecast/forecastPainel.ts).
export const STATUS_ROTULO_XLSX: Record<string, string> = {
  nao: 'Cotação não enviada',
  cotando: 'Cotando',
  confirmado: 'Confirmado, aguarda PO',
  po: 'PO enviada',
  preco: 'Só atualização de preço',
};

const MES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;
const INT_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const KG_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const TRACO = '—';

const COL_ITEM = 1;
// Colunas de texto que podem passar da largura: quebram linha em vez de cortar (ex.: Arredondamento tem ate 42 caracteres).
const NOMES_TEXTO_QUEBRA = [
  'Item',
  'Urgência',
  'Códigos',
  'Status',
  'Embalagem',
  'Arredondamento',
  'Outras embalagens',
  'Ruptura',
  'Em andamento',
  'Meses fora da média',
  'Observação',
] as const;
const NOMES_NUMERICOS = ['Demanda', 'Qtd. sugerida', 'Qtd. final'] as const;
const LARGURAS = [34, 22, 22, 14, 24, 11, 13, 30, 34, 30, 11, 12, 18, 12, 13, 10, 28, 20, 40];
const LARGURAS_POR_URGENCIA = [34, 22, 24, ...LARGURAS.slice(2)];
const LARGURAS_SEM_CONSUMO = [34, 22, 24, 24, 26, 11, 12, 30, 30, 20, 40];
const LARGURAS_SOB_DEMANDA = [34, 22, 24, 24, 40, 11, 30, 14, 11, 30, 20, 40];
const LARGURAS_DEMANDA_COMERCIAL = [34, 22, 14, 14, 16, 14, 40, 26, 13, 44, 40];

const plural = (n: number, singular: string, pluralForm: string) => (n === 1 ? singular : pluralForm);

// 'AAAA-MM-DD' -> 'dd/mm/aaaa' pelo texto (sem Date: evita o dia anterior em BRT); nulo/invalido -> '—'.
export function dataBr(key: string | null): string {
  const m = key ? /^(\d{4})-(\d{2})-(\d{2})/.exec(key) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : TRACO;
}

// '2026-10' -> 'out/2026'; invalido -> '—'.
export function mesAbrev(anoMes: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(anoMes);
  const abrev = m ? MES_ABREV[Number(m[2]) - 1] : undefined;
  return m && abrev ? `${abrev}/${m[1]}` : TRACO;
}

// kg de embalagem: ate 3 casas pt-BR (0,5 / 2,25 / 25), sem arredondar para inteiro; igual ao kgBr do web.
export function kgBr(v: number): string {
  return KG_BR.format(v);
}

// Inteiro pt-BR com milhar e sinal tipografico, igual ao do web.
export function inteiroBr(v: number): string {
  const arredondado = Math.round(v);
  return (arredondado < 0 ? '−' : '') + INT_BR.format(Math.abs(arredondado));
}

// ---- Textos de urgencia e de "sem consumo" ----
// Copia EXATA de web/src/pages/Forecast/forecastRelatorioUrgencia.ts (guarda de paridade no teste).
export { URGENCIAS as URGENCIAS_XLSX };

export function rotuloUrgencia(u: UrgenciaId, diasCritico: number): string {
  switch (u) {
    case 'sem-estoque':
      return 'Sem estoque agora';
    case 'critico':
      return `Ruptura em até ${diasCritico} dias`;
    case 'atrasado':
      return 'Atrasado';
    default:
      return 'No prazo';
  }
}

export function resumoDeUrgencia(porUrgencia: Record<UrgenciaId, number>, diasCritico: number): string {
  const a = porUrgencia['sem-estoque'];
  const b = porUrgencia.critico;
  const c = porUrgencia.atrasado;
  const d = porUrgencia['no-prazo'];
  const partes = [`${a} sem estoque agora`];
  if (diasCritico > 0) partes.push(`${b} com ruptura em até ${diasCritico} dias`);
  partes.push(`${c} ${c === 1 ? 'atrasado' : 'atrasados'}`, `${d} no prazo`);
  return `Urgência: ${partes.join(' · ')}`;
}

export function paragrafoUrgencia(diasCritico: number): string {
  const critica =
    diasCritico > 0
      ? `"Ruptura em até ${diasCritico} dias" = ainda há estoque e a ruptura estimada cai nos próximos ${diasCritico} dias; `
      : '';
  return `Urgência: "Sem estoque agora" = a ruptura cai na data-base ou já passou na data de hoje; ${critica}"Atrasado" = a data-limite do pedido já passou; "No prazo" = o restante, inclusive sem ruptura em 6 meses. A lista segue essa ordem e, dentro de cada faixa, os dias até a ruptura e depois a data-limite.`;
}

export function textoMotivos(motivos: MotivoSemConsumo[], sobDemanda = false): string {
  const textos: string[] = motivos.map((m) => (m === 'programacao' ? 'tem programação' : 'tem estoque'));
  if (sobDemanda) textos.push('compra sob demanda');
  return textos.join(' · ');
}

// Copia EXATA de web/src/pages/Forecast/forecastRelatorioTextos.ts (guarda de paridade no teste): compra sob demanda.
export const MOTIVO_SOB_DEMANDA_PADRAO = 'Compra sob programação do cliente';

export function textoMotivoSobDemanda(motivo: string | null): string {
  return motivo ? `${MOTIVO_SOB_DEMANDA_PADRAO}: ${motivo}` : MOTIVO_SOB_DEMANDA_PADRAO;
}

export function resumoSobDemanda(n: number): string {
  return `${n} sob demanda (fora da lista de compra)`;
}

export function paragrafoSobDemanda(): string {
  return 'Itens marcados como "compra sob demanda" saem da lista de compra: só se compra com programação do cliente. A seção mostra a programação ainda não coberta por estoque e chegadas.';
}

// ---- Meses atipicos (PR 6c): copia EXATA de web/src/pages/Forecast/forecastRelatorioTextos.ts (guarda de paridade no teste) ----

// Meses fora da media do item, ex.: 'ago/2026, set/2026' (vazio = nenhum; a celula fica vazia).
export function textoMesesForaDaMedia(anoMeses: string[]): string {
  return anoMeses.map(mesAbrev).join(', ');
}

// Itens (lista de compra, sem consumo e sob demanda) cuja media usa meses excluidos.
export function contarComMesesForaDaMedia(
  r: Pick<RelatorioCompras, 'grupos' | 'semConsumo' | 'sobDemanda'>,
): number {
  const itens: Array<{ mesesForaDaMedia: string[] }> = [
    ...r.grupos.flatMap((g) => g.itens),
    ...r.semConsumo.itens,
    ...r.sobDemanda.itens,
  ];
  return itens.filter((i) => i.mesesForaDaMedia.length > 0).length;
}

export function resumoMesesForaDaMedia(n: number): string {
  return `${n} ${n === 1 ? 'item usa' : 'itens usam'} média sem meses atípicos`;
}

export function paragrafoMesesForaDaMedia(): string {
  return 'Meses marcados como venda atípica ficam fora das médias trimestral e semestral (e do consumo do mês, se marcado o mês atual). A conferência com a planilha usa a regra original.';
}

// ---- Demanda do comercial (PR 6d): copia EXATA de web/src/pages/Forecast/forecastRelatorioTextos.ts (guarda de paridade no teste) ----

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

export function textoSituacaoDemanda(i: Pick<ItemDemandaComercial, 'situacao' | 'sugerido'>): string {
  if (i.situacao === 'no-horizonte') return 'Dentro do horizonte: não soma';
  if (i.situacao === 'fora-da-quinzena') return 'Fora desta quinzena: sem cálculo';
  return i.sugerido > 0 ? 'Além do horizonte: soma ao Forecast' : 'Além do horizonte: coberta pelo saldo';
}

export const CONFIRA_PROGRAMACOES = 'Confira se já está nas programações; se estiver, marque "virou programação".';

/** Aviso sob a situacao (nulo = nada a avisar). */
export function textoAvisoDemanda(
  i: Pick<ItemDemandaComercial, 'situacao' | 'programacaoDoMes' | 'anoMes'>,
): string | null {
  if (i.situacao === 'fora-da-quinzena') return 'O produto não tem linha nesta quinzena.';
  if (i.situacao !== 'no-horizonte') return null;
  if (i.programacaoDoMes === null) return CONFIRA_PROGRAMACOES;
  const mes = mesAbrev(i.anoMes);
  return i.programacaoDoMes > 0
    ? `Programação de ${mes}: ${inteiroBr(i.programacaoDoMes)}. ${CONFIRA_PROGRAMACOES}`
    : `Sem programação em ${mes}. ${CONFIRA_PROGRAMACOES}`;
}

/** Numero da Solicitacao do IntelliQuote (so rastreio): `#12`; sem numero, traco. */
export const textoSolicitacao = (id: number | null): string => (id === null ? TRACO : `#${id}`);

export function resumoSemConsumo(emAtencao: number, semMovimento: number): string {
  return `Sem consumo: ${emAtencao} em atenção (com estoque ou programação, fora da lista de compra) · ${semMovimento} sem estoque nem programação`;
}

export function paragrafoSemConsumo(): string {
  return 'Atenção: sem consumo = média trimestral zero, fora da lista de compra, mas com estoque ou programação. Aparece só para conferência, sem quantidade sugerida. Itens sem consumo, estoque nem programação ficam fora e só entram na contagem.';
}

export function tituloDoGrupo(g: GrupoRelatorioCompras, diasCritico: number): string {
  const urgente = g.dataLimiteMaisUrgente ? `mais urgente ${dataBr(g.dataLimiteMaisUrgente)}` : 'sem data-limite';
  let titulo = `${g.fonte || 'Sem fonte'} · lead time ${g.leadTimeDias} dias · ${urgente}`;
  if (g.porUrgencia['sem-estoque'] > 0) {
    titulo += ` · ${g.porUrgencia['sem-estoque']} sem estoque agora`;
  } else if (diasCritico > 0 && g.porUrgencia.critico > 0) {
    titulo += ` · ${g.porUrgencia.critico} com ruptura em até ${diasCritico} dias`;
  }
  return g.vencidas > 0 ? `${titulo} · ${g.vencidas} ${plural(g.vencidas, 'vencida', 'vencidas')}` : titulo;
}

export function linhasDoResumo(r: RelatorioCompras): string[] {
  const { quinzena, totais, fora } = r;
  const linhas = [
    'Forecast de compras · Relatório de compras',
    'Beta · Em validação: confira os números com a planilha do Forecast.',
    `Quinzena ${quinzena.label} (base ${dataBr(quinzena.baseDate)}) · datas conferidas em ${dataBr(quinzena.hoje)}`,
    `${totais.itens} ${plural(totais.itens, 'item', 'itens')} em ${totais.fontes} ${plural(totais.fontes, 'fonte', 'fontes')}`,
    `${totais.vencidas} com data-limite vencida`,
    resumoDeUrgencia(totais.porUrgencia, r.urgencia.diasCritico),
    `${totais.semEmbalagem} sem embalagem cadastrada`,
  ];
  if (totais.multiplasEmbalagens > 0) {
    linhas.push(`${totais.multiplasEmbalagens} com mais de uma embalagem`);
  }
  if (totais.comPallet > 0) {
    linhas.push(`${totais.comPallet} com pallet cadastrado`);
  }
  linhas.push(`Fora do relatório: ${fora.semLeadTime} sem lead time, ${fora.semConsumoSemFalta} sem consumo e sem falta`);
  linhas.push(resumoSemConsumo(r.semConsumo.itens.length, fora.semConsumoSemMovimento));
  if (fora.sobDemanda > 0) {
    linhas.push(resumoSobDemanda(fora.sobDemanda));
  }
  const comMesesForaDaMedia = contarComMesesForaDaMedia(r);
  if (comMesesForaDaMedia > 0) {
    linhas.push(resumoMesesForaDaMedia(comMesesForaDaMedia));
  }
  const { abertas, sugeridoKg } = r.demandaComercial.totais;
  if (abertas > 0) {
    linhas.push(resumoDemandaComercial(abertas, sugeridoKg));
  }
  return linhas;
}

function textoEmbalagem(item: ItemRelatorioCompras): string {
  const { usada } = item.embalagem;
  if (!usada) {
    return 'Embalagem não cadastrada';
  }
  const nome = usada.rotulo ?? `${kgBr(usada.quantidade)} kg`;
  const principal = `${item.quantidadeEmbalagens} × ${nome} (código ${usada.codigo})`;
  // Pallet da embalagem em destaque: linha extra na mesma celula (sem coluna nova; Observacao segue a ultima).
  const pallet = item.porEmbalagem.find((o) => o.destaque)?.pallet;
  return pallet ? `${principal}\n${textoPallet(pallet)}` : principal;
}

// Copia EXATA de textoOpcaoDeEmbalagem (web/src/pages/Forecast/forecastRelatorioTextos.ts; guarda de paridade no teste):
// quantidade do item arredondada para UMA embalagem cadastrada, ex.: '3 × 200 kg (código C0002) = 600 kg'.
export function textoOpcaoDeEmbalagem(op: OpcaoDeEmbalagem): string {
  const nome = op.rotulo ?? `${kgBr(op.quantidade)} kg`;
  return `${op.embalagens} × ${nome} (código ${op.codigo}) = ${kgBr(op.quantidadeFinal)} kg`;
}

// Copia EXATA de textoPallet (web/.../forecastRelatorioTextos.ts; guarda de paridade no teste): pallets fechados
// abaixo e acima da quantidade sugerida, ex.: 'Pallet de 600 kg: 2 pallets = 1.200 kg (abaixo) · 3 pallets = 1.800 kg (acima)'.
// Multiplo exato: so '(exato)'; nada abaixo de 1 pallet: so '(acima)'.
export function textoPallet(p: PalletDaOpcao): string {
  const parte = (v: { pallets: number; kg: number }, marca: string) =>
    `${v.pallets} ${v.pallets === 1 ? 'pallet' : 'pallets'} = ${kgBr(v.kg)} kg (${marca})`;
  const inicio = `Pallet de ${kgBr(p.kgPorPallet)} kg: `;
  if (p.abaixo.pallets === p.acima.pallets) return inicio + parte(p.acima, 'exato');
  if (p.abaixo.pallets === 0) return inicio + parte(p.acima, 'acima');
  return `${inicio}${parte(p.abaixo, 'abaixo')} · ${parte(p.acima, 'acima')}`;
}

// Copia EXATA de PARAGRAFO_EMBALAGEM (web/.../forecastRelatorioTextos.ts); e o 3o paragrafo da aba Regras.
export const PARAGRAFO_EMBALAGEM_XLSX =
  'Quantidade sugerida = demanda em módulo. Com embalagem cadastrada, arredonda para cima em múltiplos da embalagem (a principal; sem principal, a do primeiro código). Com mais de uma embalagem, mostra também a quantidade arredondada para cada uma, para o comprador escolher na compra; a Qtd. final usa a embalagem em destaque. Com pallet cadastrado, mostra também os pallets fechados abaixo e acima da quantidade sugerida; a Qtd. final continua pela embalagem.';

const linhasChegada = (chegadas: Array<{ anoMes: string; quantidade: number }>) =>
  chegadas.map((c) => `Chegada ${mesAbrev(c.anoMes)}: ${inteiroBr(c.quantidade)}`);
const linhasProgramacao = (programacoes: Array<{ anoMes: string; quantidade: number }>) =>
  programacoes.map((p) => `Programação ${mesAbrev(p.anoMes)}: ${inteiroBr(p.quantidade)}`);
const juntarLinhas = (linhas: string[]) => (linhas.length > 0 ? linhas.join('\n') : TRACO);

function textoEmAndamento(item: ItemRelatorioCompras): string {
  const { chegadas, programacoes } = item.emAndamento;
  return juntarLinhas([...linhasChegada(chegadas), ...linhasProgramacao(programacoes)]);
}

// 19 valores, na ordem de COLUNAS_RELATORIO_XLSX.
export function celulasDoItem(item: ItemRelatorioCompras, diasCritico: number): Array<string | number> {
  const { usada, multiplas } = item.embalagem;
  const { ruptura } = item;
  // Uma linha por opcao nao destacada (a destacada ja esta em Embalagem e Qtd. final); o pallet da opcao vem logo abaixo.
  const outras =
    multiplas && usada
      ? item.porEmbalagem
          .filter((o) => !o.destaque)
          .flatMap((o) => (o.pallet ? [textoOpcaoDeEmbalagem(o), textoPallet(o.pallet)] : [textoOpcaoDeEmbalagem(o)]))
          .join('\n')
      : '';
  const rupturaTexto = ruptura
    ? ruptura.jaNaDataBase
      ? 'já na data-base'
      : dataBr(ruptura.data)
    : 'sem ruptura em 6 meses';
  // Selo do comercial (PR 6d): 2a linha da celula Item, como na tela (sem coluna nova; Observacao segue a ultima).
  const selo = item.demandaComercialKg && item.demandaComercialKg > 0 ? seloDemandaComercial(item.demandaComercialKg) : '';
  return [
    selo ? `${item.item}\n${selo}` : item.item,
    rotuloUrgencia(item.urgencia, diasCritico),
    item.codigos.join(' · '),
    item.naoFraciona ? 'Não fraciona' : '',
    STATUS_ROTULO_XLSX[item.status] ?? item.status,
    item.demanda,
    item.quantidadeSugerida,
    textoEmbalagem(item),
    multiplas && usada ? `Arredondado pela embalagem do código ${usada.codigo}` : '',
    outras,
    item.quantidadeFinal,
    ruptura ? mesAbrev(ruptura.anoMes) : TRACO,
    rupturaTexto,
    item.diasAteRuptura === null ? TRACO : item.diasAteRuptura,
    item.dataLimite ? dataBr(item.dataLimite) : TRACO,
    item.vencida ? 'Vencida' : '',
    textoEmAndamento(item),
    textoMesesForaDaMedia(item.mesesForaDaMedia),
    item.obs,
  ];
}

export function celulasDoItemSemConsumo(item: ItemSemConsumo): Array<string | number> {
  return [
    item.item,
    item.codigos.join(' · '),
    `${item.fonte || 'Sem fonte'}${item.semLeadTime ? ' (sem lead time)' : ''}`,
    STATUS_ROTULO_XLSX[item.status] ?? item.status,
    textoMotivos(item.motivos, item.sobDemanda),
    item.estoque,
    item.programado,
    juntarLinhas(linhasProgramacao(item.programacoes)),
    juntarLinhas(linhasChegada(item.chegadas)),
    textoMesesForaDaMedia(item.mesesForaDaMedia),
    item.obs,
  ];
}

// 12 valores, na ordem de COLUNAS_SOB_DEMANDA_XLSX.
export function celulasDoItemSobDemanda(item: ItemSobDemanda): Array<string | number> {
  return [
    item.item,
    item.codigos.join(' · '),
    item.fonte || 'Sem fonte',
    STATUS_ROTULO_XLSX[item.status] ?? item.status,
    textoMotivoSobDemanda(item.motivo),
    item.demanda,
    juntarLinhas(linhasProgramacao(item.programacoes)),
    item.programacaoDescoberta,
    item.estoque,
    juntarLinhas(linhasChegada(item.chegadas)),
    textoMesesForaDaMedia(item.mesesForaDaMedia),
    item.obs,
  ];
}

// 11 valores, na ordem de COLUNAS_DEMANDA_COMERCIAL_XLSX. Sem calculo (saldo/sugerido nulos) sai o traco.
export function celulasDaDemandaComercial(item: ItemDemandaComercial): Array<string | number> {
  const aviso = textoAvisoDemanda(item);
  const situacao = textoSituacaoDemanda(item);
  return [
    item.item,
    item.fonte || 'Sem fonte',
    dataBr(item.necessidade),
    item.kg,
    item.saldoLivre === null ? TRACO : item.saldoLivre,
    item.situacao === 'alem-do-horizonte' ? item.sugerido : TRACO,
    item.motivo,
    item.cliente ?? TRACO,
    textoSolicitacao(item.solicitacaoId),
    aviso ? `${situacao}\n${aviso}` : situacao,
    item.obs,
  ];
}

export function nomeArquivoRelatorioCompras(q: { label: string; hoje: string }): string {
  const limpo = (v: string) => v.replace(/[^0-9A-Za-z-]/g, '-');
  return `relatorio-compras-${limpo(q.label)}-${limpo(q.hoje)}.xlsx`;
}

// Texto da aba Regras: os paragrafos do <details> da tela + nota de origem do arquivo.
export function paragrafosDeRegras(
  diasCritico: number,
  comSobDemanda = false,
  comMesesForaDaMedia = false,
  comDemandaComercial = false,
): string[] {
  return [
    'O saldo zera no primeiro mês em que a projeção do estoque fica negativa. O dia da ruptura é uma estimativa: o consumo do mês é distribuído de forma linear (no mês base, a partir da data-base).',
    'Data-limite do pedido = ruptura − lead time da fonte, em dias corridos e sem folga. Vencida: a data-limite já passou na data de hoje.',
    PARAGRAFO_EMBALAGEM_XLSX,
    paragrafoUrgencia(diasCritico),
    paragrafoSemConsumo(),
    ...(comSobDemanda ? [paragrafoSobDemanda()] : []),
    ...(comMesesForaDaMedia ? [paragrafoMesesForaDaMedia()] : []),
    ...(comDemandaComercial ? [paragrafoDemandaComercial()] : []),
    'Arquivo gerado do mesmo relatório exibido na tela (quinzena calculada).',
  ];
}

const COR_CABECALHO = 'FFE5E7EB';
const COR_FAIXA = 'FFDBEAFE';
// Mesmo valor do token claro --tone-danger-bg-soft; so as 2 faixas criticas ganham fundo.
const COR_CRITICA_FUNDO = 'FFFDF1EC';
const COR_VENCIDA_TEXTO = 'FFB91C1C';
const COR_CINZA = 'FF6B7280';

function preencher(cor: string): exceljs.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
}

const PAGINA_PAISAGEM: Partial<exceljs.PageSetup> = {
  orientation: 'landscape',
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
};

function estilizarCabecalho(row: exceljs.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = preencher(COR_CABECALHO);
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
}

// Formata a linha de um item; `colunas` diz em que posicao cada coluna esta (aba por fonte ou aba por urgencia).
function formatarLinhaDeItem(row: exceljs.Row, item: ItemRelatorioCompras, colunas: readonly string[]): void {
  const col = (nome: string) => colunas.indexOf(nome) + 1;
  row.alignment = { vertical: 'top' };
  for (const nome of NOMES_TEXTO_QUEBRA) {
    row.getCell(col(nome)).alignment = { vertical: 'top', wrapText: true };
  }
  for (const nome of NOMES_NUMERICOS) {
    row.getCell(col(nome)).numFmt = '0.0';
  }
  if (item.diasAteRuptura !== null) {
    row.getCell(col('Dias até a ruptura')).numFmt = '0';
  }
  row.getCell(col('Qtd. final')).font = { bold: true };
  row.getCell(col('Urgência')).font = { bold: true };
  if (item.naoFraciona) {
    row.getCell(col('Não fraciona')).font = { bold: true };
  }
  row.getCell(col('Embalagem')).font = item.embalagem.usada
    ? { bold: true }
    : { italic: true, color: { argb: COR_CINZA } };
  if (item.urgencia === 'sem-estoque' || item.urgencia === 'critico') {
    for (let c = 1; c <= colunas.length; c += 1) {
      row.getCell(c).fill = preencher(COR_CRITICA_FUNDO);
    }
  }
  if (item.vencida) {
    row.getCell(col('Vencida')).font = { bold: true, color: { argb: COR_VENCIDA_TEXTO } };
  }
}

function adicionarGrupo(ws: exceljs.Worksheet, g: GrupoRelatorioCompras, diasCritico: number): void {
  const total = COLUNAS_RELATORIO_XLSX.length;

  const faixa = ws.addRow([tituloDoGrupo(g, diasCritico)]);
  ws.mergeCells(faixa.number, 1, faixa.number, total);
  faixa.getCell(1).font = { bold: true };
  faixa.getCell(1).fill = preencher(COR_FAIXA);

  estilizarCabecalho(ws.addRow([...COLUNAS_RELATORIO_XLSX]));

  for (const item of g.itens) {
    const row = ws.addRow(celulasDoItem(item, diasCritico));
    formatarLinhaDeItem(row, item, COLUNAS_RELATORIO_XLSX);
  }

  ws.addRow([]);
}

function adicionarAbaPorUrgencia(workbook: exceljs.Workbook, r: RelatorioCompras): void {
  const ws = workbook.addWorksheet(ABA_POR_URGENCIA);
  ws.columns = LARGURAS_POR_URGENCIA.map((width) => ({ width }));
  ws.pageSetup = { ...PAGINA_PAISAGEM };
  estilizarCabecalho(ws.addRow([...COLUNAS_POR_URGENCIA_XLSX]));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS_POR_URGENCIA_XLSX.length } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const lista = itensNaOrdemDeUrgencia(r);
  if (lista.length === 0) {
    ws.addRow(['Nenhum item com demanda ≤ 0 nesta quinzena.']);
    return;
  }
  for (const { item, fonte } of lista) {
    const c = celulasDoItem(item, r.urgencia.diasCritico);
    const row = ws.addRow([c[0], c[1], fonte || 'Sem fonte', ...c.slice(2)]);
    formatarLinhaDeItem(row, item, COLUNAS_POR_URGENCIA_XLSX);
  }
}

function adicionarAbaSemConsumo(workbook: exceljs.Workbook, r: RelatorioCompras): void {
  const ws = workbook.addWorksheet(ABA_SEM_CONSUMO);
  ws.columns = LARGURAS_SEM_CONSUMO.map((width) => ({ width }));
  ws.pageSetup = { ...PAGINA_PAISAGEM };
  estilizarCabecalho(ws.addRow([...COLUNAS_SEM_CONSUMO_XLSX]));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS_SEM_CONSUMO_XLSX.length } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  if (r.semConsumo.itens.length === 0) {
    ws.addRow(['Nenhum item sem consumo com estoque ou programação.']);
    return;
  }
  const col = (nome: (typeof COLUNAS_SEM_CONSUMO_XLSX)[number]) => COLUNAS_SEM_CONSUMO_XLSX.indexOf(nome) + 1;
  for (const item of r.semConsumo.itens) {
    const row = ws.addRow(celulasDoItemSemConsumo(item));
    row.alignment = { vertical: 'top' };
    for (const nome of ['Item', 'Códigos', 'Fonte', 'Status', 'Motivo', 'Programações', 'Chegadas', 'Meses fora da média', 'Observação'] as const) {
      row.getCell(col(nome)).alignment = { vertical: 'top', wrapText: true };
    }
    row.getCell(col('Estoque')).numFmt = '0.0';
    row.getCell(col('Programado')).numFmt = '0.0';
  }
}

function adicionarAbaSobDemanda(workbook: exceljs.Workbook, r: RelatorioCompras): void {
  const ws = workbook.addWorksheet(ABA_SOB_DEMANDA);
  ws.columns = LARGURAS_SOB_DEMANDA.map((width) => ({ width }));
  ws.pageSetup = { ...PAGINA_PAISAGEM };
  estilizarCabecalho(ws.addRow([...COLUNAS_SOB_DEMANDA_XLSX]));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS_SOB_DEMANDA_XLSX.length } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const col = (nome: (typeof COLUNAS_SOB_DEMANDA_XLSX)[number]) => COLUNAS_SOB_DEMANDA_XLSX.indexOf(nome) + 1;
  for (const item of r.sobDemanda.itens) {
    const row = ws.addRow(celulasDoItemSobDemanda(item));
    row.alignment = { vertical: 'top' };
    for (const nome of ['Item', 'Códigos', 'Fonte', 'Status', 'Motivo', 'Programações', 'Chegadas', 'Meses fora da média', 'Observação'] as const) {
      row.getCell(col(nome)).alignment = { vertical: 'top', wrapText: true };
    }
    row.getCell(col('Demanda')).numFmt = '0.0';
    row.getCell(col('Programação descoberta')).numFmt = '0.0';
    row.getCell(col('Estoque')).numFmt = '0.0';
    if (item.programacaoDescoberta > 0) {
      row.getCell(col('Programação descoberta')).font = { bold: true, color: { argb: COR_VENCIDA_TEXTO } };
    }
  }
}

function adicionarAbaDemandaComercial(workbook: exceljs.Workbook, r: RelatorioCompras): void {
  const ws = workbook.addWorksheet(ABA_DEMANDA_COMERCIAL);
  ws.columns = LARGURAS_DEMANDA_COMERCIAL.map((width) => ({ width }));
  ws.pageSetup = { ...PAGINA_PAISAGEM };
  estilizarCabecalho(ws.addRow([...COLUNAS_DEMANDA_COMERCIAL_XLSX]));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS_DEMANDA_COMERCIAL_XLSX.length } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const col = (nome: (typeof COLUNAS_DEMANDA_COMERCIAL_XLSX)[number]) =>
    COLUNAS_DEMANDA_COMERCIAL_XLSX.indexOf(nome) + 1;
  for (const item of r.demandaComercial.itens) {
    const row = ws.addRow(celulasDaDemandaComercial(item));
    row.alignment = { vertical: 'top' };
    for (const nome of ['Item', 'Fonte', 'Motivo', 'Cliente', 'Situação', 'Observação'] as const) {
      row.getCell(col(nome)).alignment = { vertical: 'top', wrapText: true };
    }
    for (const nome of ['Pedido (kg)', 'Saldo livre no mês', 'Sugerido'] as const) {
      row.getCell(col(nome)).numFmt = '#,##0.###';
    }
    if (item.sugerido > 0) {
      row.getCell(col('Sugerido')).font = { bold: true };
    }
  }
}

export async function gerarXlsxRelatorioCompras(r: RelatorioCompras): Promise<Buffer> {
  const workbook = new exceljs.Workbook();
  const ws = workbook.addWorksheet(ABA_RELATORIO);
  ws.columns = LARGURAS.map((width) => ({ width }));
  ws.pageSetup = { ...PAGINA_PAISAGEM };

  linhasDoResumo(r).forEach((texto, i) => {
    const row = ws.addRow([texto]);
    if (i === 0) {
      row.getCell(COL_ITEM).font = { bold: true, size: 14 };
    }
  });
  ws.addRow([]);

  if (r.grupos.length === 0) {
    ws.addRow(['Nenhum item com demanda ≤ 0 nesta quinzena.']);
  } else {
    for (const g of r.grupos) {
      adicionarGrupo(ws, g, r.urgencia.diasCritico);
    }
  }

  adicionarAbaPorUrgencia(workbook, r);
  adicionarAbaSemConsumo(workbook, r);
  const comSobDemanda = r.sobDemanda.itens.length > 0;
  if (comSobDemanda) {
    adicionarAbaSobDemanda(workbook, r);
  }
  const comDemandaComercial = r.demandaComercial.itens.length > 0;
  if (comDemandaComercial) {
    adicionarAbaDemandaComercial(workbook, r);
  }

  const regras = workbook.addWorksheet(ABA_REGRAS);
  regras.columns = [{ width: 120 }];
  paragrafosDeRegras(
    r.urgencia.diasCritico,
    comSobDemanda,
    contarComMesesForaDaMedia(r) > 0,
    comDemandaComercial,
  ).forEach((texto) => {
    const row = regras.addRow([texto]);
    row.getCell(1).alignment = { vertical: 'top', wrapText: true };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
