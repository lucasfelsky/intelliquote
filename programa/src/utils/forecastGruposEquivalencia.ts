// Grupos de equivalencia do Forecast (PR 6b, Comex): produtos que sao o MESMO material (nomes ou fontes diferentes) tem o
// estoque avaliado SOMADO. Funcao PURA sobre as linhas ja calculadas pelo motor (sem Prisma, sem planilha): o motor continua
// POR PRODUTO (paridade com a planilha); o grupo e so uma camada de relatorio.
//
// Formula (componentes somados, nao "soma das AN"): para os membros presentes na quinzena,
//   U_g = soma U_i;  cheg_g = soma cheg_i (mes a mes);  prog_g = soma prog_i;  Q_g = soma Q_i;  AG_g = soma AG_i;
//   projecao_g = soma projecao_i (mes a mes);  T_g = soma T_i, com T_i = Q_i / 30 * AQ_i (cada membro com o lead time da
//   SUA fonte; membro sem lead time entra com T_i = 0 e NAO perde o estoque);
//   AN_g = U_g + soma(cheg_g) - T_g - Q_g - soma(prog_g).
// Com lead time em todos os membros AN_g = soma AN_i (linearidade). Cobertura = (U_g + soma(cheg_g)) / Q_g meses.
// O grupo vira UMA linha sintetica que passa pelo pipeline do relatorio (ruptura, embalagem, urgencia) com os dados do
// produto PRINCIPAL (codigos, fonte, lead time, status, nao fraciona, observacao). Principal ausente da quinzena (ou sem
// principal cadastrado): o membro de maior media na quinzena (empate: menor linha). Grupo com menos de 2 membros na
// quinzena e ignorado (o membro continua avulso).
import type { LinhaParaRelatorio } from './forecastRelatorioCompras';

export interface GrupoDeEquivalencia {
  id: number;
  nome: string;
  principalProductId: number | null;
  productIds: number[];
  /** Observacao do grupo no cadastro (restricoes da equivalencia, ex.: cliente com um so item homologado). */
  observacao?: string | null;
}

/** Um membro do grupo na quinzena, com os componentes que entram na soma. */
export interface MembroDoGrupo {
  linha: number;
  productId: number;
  item: string;
  codigos: string[];
  fonte: string;
  principal: boolean;
  /** U do membro. */
  estoque: number;
  /** Soma das chegadas do membro (5 meses). */
  chegadas: number;
  /** Soma das programacoes do membro (4 meses). */
  programado: number;
  /** Q do membro (media trimestral, ja sem os meses atipicos marcados). */
  mediaTrimestral: number;
  /** AN do membro sozinho; nulo = membro sem lead time. */
  demandaIndividual: number | null;
  semLeadTime: boolean;
  obs: string;
}

/** Totais do grupo (o que a linha sintetica usa) + membros. */
export interface DadosDoGrupo {
  id: number;
  nome: string;
  principalProductId: number;
  principalItem: string;
  /** Observacao do grupo (so trim); vazia quando o cadastro nao tem. */
  observacao: string;
  membros: MembroDoGrupo[];
  estoque: number;
  chegadas: number;
  programado: number;
  mediaTrimestral: number;
  /** Seguranca (T) somada, cada membro pelo lead time da sua fonte; membro sem lead time conta 0. */
  seguranca: number;
  /** AN_g; nulo so quando NENHUM membro tem lead time. */
  demanda: number | null;
  /** (estoque + chegadas) / media, em meses; nulo sem consumo. */
  cobertura: number | null;
}

export interface LinhaDeGrupo {
  dados: DadosDoGrupo;
  /** Linha sintetica (numero = o da linha do principal). */
  linha: LinhaParaRelatorio;
  /** Linhas originais dos membros. */
  membros: LinhaParaRelatorio[];
}

export interface LinhasAgrupadas {
  /** Linhas da quinzena na ordem original, com o grupo no lugar da linha do principal e sem os outros membros. */
  linhas: LinhaParaRelatorio[];
  /** So as linhas que nao entraram em nenhum grupo. */
  avulsas: LinhaParaRelatorio[];
  grupos: LinhaDeGrupo[];
}

const soma = (xs: number[]) => xs.reduce((total, v) => total + v, 0);
const somaChegadas = (l: Pick<LinhaParaRelatorio, 'chegadas'>) => soma(l.chegadas.slice(0, 5));
const somaProgramacoes = (l: Pick<LinhaParaRelatorio, 'programacoes'>) => soma(l.programacoes.slice(0, 4));
const seguranca = (l: Pick<LinhaParaRelatorio, 'Q' | 'AQ'>) => (l.AQ === null ? 0 : (l.Q / 30) * l.AQ);

// Soma mes a mes (o maior vetor define o tamanho).
function somaPorMes(vetores: number[][]): number[] {
  const tamanho = Math.max(0, ...vetores.map((v) => v.length));
  return Array.from({ length: tamanho }, (_, i) => soma(vetores.map((v) => v[i] ?? 0)));
}

function escolherPrincipal(membros: LinhaParaRelatorio[], principalProductId: number | null): LinhaParaRelatorio {
  const cadastrado = principalProductId === null ? undefined : membros.find((m) => m.productId === principalProductId);
  if (cadastrado) return cadastrado;
  return [...membros].sort((a, b) => b.Q - a.Q || a.linha - b.linha)[0];
}

// Meses atipicos (PR 6c): o grupo mostra a uniao das marcas dos membros e compara a soma das medias da planilha com a
// soma das medias usadas, entao o aviso aparece quando algum membro teve a compra mudada pela marca.
function marcasDoGrupo(membros: LinhaParaRelatorio[]): Pick<LinhaParaRelatorio, 'mesesForaDaMedia' | 'mediaAjustada'> {
  const marcados = membros.filter((m) => (m.mesesForaDaMedia?.length ?? 0) > 0);
  if (marcados.length === 0) return {};
  const porMes = new Map<string, { anoMes: string; indice?: number }>();
  for (const m of marcados) {
    for (const marca of m.mesesForaDaMedia ?? []) {
      const atual = porMes.get(marca.anoMes);
      if (!atual) porMes.set(marca.anoMes, { ...marca });
      else if (atual.indice !== undefined) {
        atual.indice = marca.indice === undefined ? undefined : Math.min(atual.indice, marca.indice);
      }
    }
  }
  const meses = [...porMes.values()].sort((a, b) => a.anoMes.localeCompare(b.anoMes));
  const mediaAjustada = {
    Q: soma(membros.map((m) => m.mediaAjustada?.Q ?? m.Q)),
    AG: soma(membros.map((m) => m.mediaAjustada?.AG ?? m.AG)),
  };
  return { mesesForaDaMedia: meses, mediaAjustada };
}

function montarGrupo(grupo: GrupoDeEquivalencia, membros: LinhaParaRelatorio[]): LinhaDeGrupo {
  const principal = escolherPrincipal(membros, grupo.principalProductId);
  const comLeadTime = membros.filter((m) => m.AN !== null);
  const U = soma(membros.map((m) => m.U));
  const chegadas = soma(membros.map(somaChegadas));
  const programado = soma(membros.map(somaProgramacoes));
  const Q = soma(membros.map((m) => m.Q));
  const T = soma(membros.map(seguranca));
  const demanda = comLeadTime.length === 0 ? null : U + chegadas - T - Q - programado;
  const leadTimes = membros.flatMap((m) => (m.AQ === null ? [] : [m.AQ]));
  const dados: DadosDoGrupo = {
    id: grupo.id,
    nome: grupo.nome,
    principalProductId: principal.productId as number,
    principalItem: principal.item,
    observacao: (grupo.observacao ?? '').trim(),
    membros: membros.map<MembroDoGrupo>((m) => ({
      linha: m.linha,
      productId: m.productId as number,
      item: m.item,
      codigos: m.codigos,
      fonte: m.fonte.trim(),
      principal: m === principal,
      estoque: m.U,
      chegadas: somaChegadas(m),
      programado: somaProgramacoes(m),
      mediaTrimestral: m.Q,
      demandaIndividual: m.AN,
      semLeadTime: m.AN === null,
      obs: (m.obs ?? '').trim(),
    })),
    estoque: U,
    chegadas,
    programado,
    mediaTrimestral: Q,
    seguranca: T,
    demanda,
    cobertura: Q > 0 ? (U + chegadas) / Q : null,
  };
  const linha: LinhaParaRelatorio = {
    linha: principal.linha,
    n: principal.n ?? null,
    productId: principal.productId,
    item: grupo.nome,
    codigos: principal.codigos,
    fonte: principal.fonte,
    status: principal.status,
    Q,
    AG: soma(membros.map((m) => m.AG)),
    U,
    AN: demanda,
    // Data-limite pelo lead time do principal; principal sem lead time: o maior dos membros que tem.
    AQ: principal.AQ ?? (leadTimes.length > 0 ? Math.max(...leadTimes) : null),
    projecao: somaPorMes(membros.map((m) => m.projecao)),
    chegadas: somaPorMes(membros.map((m) => m.chegadas)),
    programacoes: somaPorMes(membros.map((m) => m.programacoes)),
    naoFraciona: principal.naoFraciona === true,
    obs: principal.obs ?? '',
    ...marcasDoGrupo(membros),
  };
  return { dados, linha, membros };
}

/**
 * Agrupa as linhas da quinzena. Sem grupos (ou grupos sem 2 membros presentes) devolve as mesmas linhas, na mesma ordem.
 * Um produto pertence a um unico grupo (o primeiro da lista vence; o cadastro ja garante isso).
 */
export function agruparLinhas(linhas: LinhaParaRelatorio[], grupos: GrupoDeEquivalencia[]): LinhasAgrupadas {
  const linhaDoProduto = new Map<number, LinhaParaRelatorio>();
  for (const l of linhas) {
    if (l.productId != null && !linhaDoProduto.has(l.productId)) linhaDoProduto.set(l.productId, l);
  }
  const usadas = new Set<LinhaParaRelatorio>();
  const montados: LinhaDeGrupo[] = [];
  for (const grupo of grupos) {
    const membros: LinhaParaRelatorio[] = [];
    for (const id of new Set(grupo.productIds)) {
      const l = linhaDoProduto.get(id);
      if (l && !usadas.has(l)) membros.push(l);
    }
    if (membros.length < 2) continue;
    membros.forEach((m) => usadas.add(m));
    montados.push(montarGrupo(grupo, membros));
  }
  const porPrincipal = new Map(
    montados.map((g) => [g.membros.find((m) => m.linha === g.linha.linha) as LinhaParaRelatorio, g]),
  );
  const ordenadas: LinhaParaRelatorio[] = [];
  const avulsas: LinhaParaRelatorio[] = [];
  for (const l of linhas) {
    const g = porPrincipal.get(l);
    if (g) ordenadas.push(g.linha);
    else if (!usadas.has(l)) {
      ordenadas.push(l);
      avulsas.push(l);
    }
  }
  return { linhas: ordenadas, avulsas, grupos: montados };
}

/**
 * Linhas para a demanda do comercial (PR 6d): o pedido de QUALQUER membro (principal inclusive) e avaliado contra o saldo
 * e as programacoes SOMADOS do grupo (a `linha` e a do grupo; produto, item, fonte e observacao continuam os do membro).
 */
export function linhasParaDemandaComercial(linhas: LinhaParaRelatorio[], grupos: LinhaDeGrupo[]): LinhaParaRelatorio[] {
  const clones = new Map<LinhaParaRelatorio, LinhaParaRelatorio>();
  for (const g of grupos) {
    for (const m of g.membros) {
      clones.set(m, { ...g.linha, productId: m.productId, item: m.item, fonte: m.fonte, obs: m.obs ?? '' });
    }
  }
  return linhas.map((l) => clones.get(l) ?? l);
}

/** Grupo do produto como a quinzena calculada o entrega em cada linha (cadastro ATUAL). */
export interface GrupoDaLinha {
  id: number;
  nome: string;
  principalProductId: number | null;
  observacao?: string | null;
}

/** Monta os grupos a partir das linhas que carregam `grupo` (os membros ausentes da quinzena nao importam). */
export function gruposDasLinhas(
  linhas: Array<{ productId?: number | null; grupo?: GrupoDaLinha | null }>,
): GrupoDeEquivalencia[] {
  const porId = new Map<number, GrupoDeEquivalencia>();
  for (const l of linhas) {
    if (l.productId == null || !l.grupo) continue;
    const existente = porId.get(l.grupo.id);
    if (existente) existente.productIds.push(l.productId);
    else {
      porId.set(l.grupo.id, {
        id: l.grupo.id,
        nome: l.grupo.nome,
        principalProductId: l.grupo.principalProductId,
        observacao: l.grupo.observacao ?? null,
        productIds: [l.productId],
      });
    }
  }
  return [...porId.values()].sort((a, b) => a.id - b.id);
}
