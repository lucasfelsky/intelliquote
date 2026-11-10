// Candidatos a cotacao do Forecast (E3 do relatorio enxuto): itens da quinzena que NAO estao na lista de compra, mas tem
// demanda; servem ao convite "quer incluir na cotacao?" e a busca "adicionar outro item". Funcao PURA sobre as linhas ja
// calculadas pelo motor e sobre o relatorio de compras (sem banco, sem HTTP). Nada aqui altera o motor, o relatorio nem o
// XLSX: a classificacao REAPROVEITA as secoes do relatorio (sobDemanda, cobertosPorGrupo, semConsumo) e so acrescenta os
// itens "sem falta", que o relatorio nao traz.
//
// demandaKg (consumo previsto no horizonte da projecao do motor, 6 meses = mes base + 5): AG + 5 x Q + soma(programacoes
// dos 4 meses). Sao as MESMAS parcelas de saida da projecao (AH..AM: AG no mes base, Q nos demais, menos as programacoes), ou
// seja, projecao[5] = U + chegadas - demandaKg. Q ja vem sem os meses atipicos marcados (PR 6c). Item "tem demanda" quando
// demandaKg > 0; so estoque parado (sem consumo e sem programacao) nao e candidato. Linha de grupo de equivalencia usa os
// totais do grupo (mesma linha sintetica do relatorio); membro coberto usa a sua propria linha.
//
// Classificacao (`motivoForaDaLista`), na ordem do relatorio:
//  - 'sob-demanda': esta em relatorio.sobDemanda (entraria na lista, mas o produto e comprado so com programacao);
//  - 'sem-consumo-com-movimento': esta em relatorio.semConsumo (media <= 0) e tem programacao ou venda no mes (demandaKg > 0);
//  - 'coberto-por-grupo': esta em relatorio.cobertosPorGrupo (o estoque somado do grupo cobre o membro);
//  - 'sem-falta': tem lead time e consumo, mas o calculo nao aponta compra (AN > 0).
// Item SEM lead time (AN nulo) ou codigo pendente de cadastro NUNCA e candidato, em nenhuma combinacao (inclusive sem consumo
// com programacao): vai para `excluidos` com motivo 'sem-lead-time'. Assim o `anMotorKg` congelado na decisao e sempre o AN
// real do motor. Membro de grupo que nao e a linha do grupo nem esta coberto sai quieto: ele e comprado pela
// linha do grupo (principal). Um productId aparece uma vez; "coberto-por-grupo" vence a linha do grupo do mesmo principal.
//
// Excluidos (contados, nunca listados): sem productId ('sem-cadastro'), sem fonte ('sem-fonte'), sem codigo vinculado ao
// catalogo ('sem-vinculo-catalogo': nao viram cotacao) e sem lead time. So contam itens que teriam demanda.
import { agruparLinhas, type GrupoDeEquivalencia } from './forecastGruposEquivalencia';
import { yearMonthsDaJanela } from './forecastMonths';
import {
  DIAS_RUPTURA_CRITICA,
  dataDeRuptura,
  dataLimiteDoPedido,
  urgenciaDoItem,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
  type RelatorioCompras,
  type UrgenciaId,
} from './forecastRelatorioCompras';

export const MOTIVOS_FORA_DA_LISTA = [
  'sem-falta',
  'sob-demanda',
  'coberto-por-grupo',
  'sem-consumo-com-movimento',
] as const;
export type MotivoForaDaLista = (typeof MOTIVOS_FORA_DA_LISTA)[number];

export const MOTIVOS_EXCLUIDOS = ['sem-cadastro', 'sem-fonte', 'sem-vinculo-catalogo', 'sem-lead-time'] as const;
export type MotivoExcluido = (typeof MOTIVOS_EXCLUIDOS)[number];

// Meses da projecao do motor (AH..AM).
const MESES_DO_HORIZONTE = 6;

export interface CandidatoCotacao {
  productId: number;
  /** Nome do produto; linha de grupo de equivalencia traz o nome do grupo. */
  item: string;
  codigos: string[];
  fonte: string;
  /** Consumo previsto nos 6 meses da projecao (ver cabecalho do arquivo); sempre > 0. */
  demandaKg: number;
  /** O que a lista de compra sugeriria (|AN|, kg, sem embalagem); nulo quando o calculo nao aponta compra. */
  quantidadeSugeridaKg: number | null;
  motivoForaDaLista: MotivoForaDaLista;
  /** 'AAAA-MM': ultimo mes, em sequencia a partir do mes base, em que o saldo projetado nao fica negativo; nulo = saldo ja negativo no mes base. */
  coberturaAteMes: string | null;
  /** true = nenhum saldo negativo nos 6 meses (`coberturaAteMes` e o ultimo mes da janela, "pelo menos"). */
  coberturaAteOFimDaJanela: boolean;
  /** Mesma regra do relatorio; nulo quando nao ha ruptura nos 6 meses. */
  urgencia: UrgenciaId | null;
  /** Nome do grupo de equivalencia quando o item e a linha do grupo ou membro coberto por ele. */
  grupoNome: string | null;
}

/** Uso interno (nao sai na API): chave da fonte e AN do motor, que a decisao congela como `demandKg`. */
export interface CandidatoComFonte extends CandidatoCotacao {
  /** Chave de comparacao da fonte (trim + maiusculas). */
  fonteChave: string;
  /** AN do motor (sinal da planilha) no momento da leitura; sempre presente (sem lead time nunca e candidato). */
  anMotorKg: number;
}

export interface ExcluidoDoCandidato {
  motivo: MotivoExcluido;
  fonte: string;
}

export interface CandidatosDaQuinzena {
  candidatos: CandidatoComFonte[];
  excluidos: ExcluidoDoCandidato[];
}

export interface ExcluidosContados {
  motivo: MotivoExcluido;
  quantidade: number;
}

export interface CandidatosAgrupados {
  /** Fonte pedida (nome canonico); nulo = todas. */
  fonte: string | null;
  fontes: Array<{ fonte: string; itens: CandidatoCotacao[] }>;
  excluidos: ExcluidosContados[];
}

const semMenosZero = (n: number) => (n === 0 ? 0 : n);
const arredondar6 = (n: number) => Math.round(n * 1e6) / 1e6;
const somar = (xs: number[]) => xs.reduce((total, v) => total + v, 0);

export const chaveDaFonte = (fonte: string) => fonte.trim().toUpperCase();

export function demandaDoHorizonte(l: Pick<LinhaParaRelatorio, 'AG' | 'Q' | 'programacoes'>): number {
  return semMenosZero(arredondar6(l.AG + (MESES_DO_HORIZONTE - 1) * l.Q + somar(l.programacoes.slice(0, 4))));
}

function cobertura(
  l: Pick<LinhaParaRelatorio, 'projecao'>,
  baseDate: string,
): { coberturaAteMes: string | null; coberturaAteOFimDaJanela: boolean } {
  const meses = yearMonthsDaJanela(baseDate, MESES_DO_HORIZONTE);
  const negativo = l.projecao.findIndex((p) => p < 0);
  if (negativo < 0) return { coberturaAteMes: meses[MESES_DO_HORIZONTE - 1], coberturaAteOFimDaJanela: true };
  return { coberturaAteMes: negativo === 0 ? null : meses[negativo - 1], coberturaAteOFimDaJanela: false };
}

function urgenciaDe(
  l: Pick<LinhaParaRelatorio, 'projecao' | 'Q' | 'AG' | 'AQ'>,
  q: Pick<QuinzenaParaRelatorio, 'baseDate' | 'hoje'>,
  diasCritico: number,
): UrgenciaId | null {
  const ruptura = dataDeRuptura(l, q.baseDate);
  if (ruptura === null) return null;
  const dataLimite = dataLimiteDoPedido(ruptura.data, l.AQ ?? 0);
  return urgenciaDoItem({ ruptura, vencida: dataLimite < q.hoje }, q.hoje, diasCritico).urgencia;
}

export interface OpcoesCandidatos {
  /** Grupos de equivalencia (os mesmos que o relatorio usou). */
  grupos?: GrupoDeEquivalencia[];
  /** productIds com ao menos um codigo vinculado a item do catalogo. */
  produtosComVinculoCatalogo: ReadonlySet<number>;
  diasCritico?: number;
}

export function montarCandidatosCotacao(
  q: QuinzenaParaRelatorio,
  relatorio: RelatorioCompras,
  opcoes: OpcoesCandidatos,
): CandidatosDaQuinzena {
  const diasCritico = opcoes.diasCritico ?? DIAS_RUPTURA_CRITICA;
  const agrupado = agruparLinhas(q.linhas, opcoes.grupos ?? []);
  const nomeDoGrupoDaLinha = new Map(agrupado.grupos.map((g) => [g.linha.linha, g.dados.nome]));
  const linhaDoGrupo = new Map(agrupado.grupos.map((g) => [g.dados.id, g.linha]));
  const linhaPorNumero = new Map(q.linhas.map((l) => [l.linha, l]));

  const naLista = new Set(relatorio.grupos.flatMap((g) => g.itens.map((i) => i.linha)));
  const sobDemanda = new Map(relatorio.sobDemanda.itens.map((i) => [i.linha, i]));
  const semConsumo = new Set(relatorio.semConsumo.itens.map((i) => i.linha));

  const porProduto = new Map<number, CandidatoComFonte>();
  // Um item excluido conta UMA vez (chave = productId; sem productId, o numero da linha), mesmo que apareca como linha do
  // grupo e como membro coberto.
  const excluidosPorChave = new Map<string, ExcluidoDoCandidato>();

  // Aplica as exclusoes (sem cadastro, sem fonte, sem lead time, sem catalogo) e guarda o candidato. Sem lead time NUNCA e
  // candidato (nem sem consumo com programacao, nem codigo pendente de cadastro): `anMotorKg` do candidato e sempre o AN real.
  const registrar = (
    alvo: { productId: number | null; linha: number; fonte: string; semLeadTime: boolean },
    montar: (anMotorKg: number) => Omit<CandidatoComFonte, 'productId' | 'fonte' | 'fonteChave' | 'anMotorKg'>,
    anMotorKg: number | null,
  ) => {
    const { productId, fonte: fonteBruta } = alvo;
    const fonte = fonteBruta.trim();
    const chave = productId !== null ? `p${productId}` : `l${alvo.linha}`;
    const excluir = (motivo: MotivoExcluido) => {
      excluidosPorChave.set(chave, { motivo, fonte });
    };
    if (productId === null) return excluir('sem-cadastro');
    if (fonte === '') return excluir('sem-fonte');
    if (alvo.semLeadTime || anMotorKg === null) return excluir('sem-lead-time');
    if (!opcoes.produtosComVinculoCatalogo.has(productId)) return excluir('sem-vinculo-catalogo');
    excluidosPorChave.delete(chave);
    porProduto.set(productId, {
      ...montar(anMotorKg),
      productId,
      fonte,
      fonteChave: chaveDaFonte(fonte),
      anMotorKg,
    });
  };

  for (const l of agrupado.linhas) {
    if (naLista.has(l.linha)) continue;
    const demandaKg = demandaDoHorizonte(l);
    if (demandaKg <= 0) continue;
    const sob = sobDemanda.get(l.linha);
    const motivo: MotivoForaDaLista = sob
      ? 'sob-demanda'
      : semConsumo.has(l.linha)
        ? 'sem-consumo-com-movimento'
        : 'sem-falta';
    registrar(
      {
        productId: l.productId ?? null,
        linha: l.linha,
        fonte: l.fonte,
        // Sem lead time (AN nulo) ou codigo pendente de cadastro: o relatorio nao os trata como compra; so contam nos excluidos.
        semLeadTime: l.AN === null || l.pendenteCadastro !== undefined,
      },
      () => ({
        item: l.item,
        codigos: l.codigos,
        demandaKg,
        quantidadeSugeridaKg: sob ? sob.quantidadeSugerida : null,
        motivoForaDaLista: motivo,
        ...cobertura(l, q.baseDate),
        urgencia: urgenciaDe(l, q, diasCritico),
        grupoNome: nomeDoGrupoDaLinha.get(l.linha) ?? null,
      }),
      l.AN,
    );
  }

  // Membros que entrariam sozinhos, mas o estoque somado do grupo cobre: demanda propria, cobertura pela linha do grupo.
  for (const m of relatorio.cobertosPorGrupo.itens) {
    const propria = linhaPorNumero.get(m.linha);
    const grupo = linhaDoGrupo.get(m.grupoId);
    if (!propria || !grupo) continue;
    const demandaKg = demandaDoHorizonte(propria);
    if (demandaKg <= 0) continue;
    registrar(
      { productId: m.productId, linha: m.linha, fonte: m.fonte, semLeadTime: false },
      () => ({
        item: m.item,
        codigos: m.codigos,
        demandaKg,
        quantidadeSugeridaKg: m.quantidadeSugerida,
        motivoForaDaLista: 'coberto-por-grupo',
        ...cobertura(grupo, q.baseDate),
        urgencia: urgenciaDe(grupo, q, diasCritico),
        grupoNome: m.grupoNome,
      }),
      m.demanda,
    );
  }

  return { candidatos: [...porProduto.values()], excluidos: [...excluidosPorChave.values()] };
}

const compararTexto = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

/** Candidato valido de um produto (a mesma regra da listagem); nulo = nao e candidato. */
export function candidatoDoProduto(r: CandidatosDaQuinzena, productId: number): CandidatoComFonte | null {
  return r.candidatos.find((c) => c.productId === productId) ?? null;
}

/** Agrupa por fonte (ordem alfabetica; itens por demanda decrescente) e conta os excluidos da fonte pedida (ou de todas). Com `fonte`, ela sempre aparece, mesmo sem itens. */
export function agruparPorFonte(r: CandidatosDaQuinzena, fonte: string | null): CandidatosAgrupados {
  const chave = fonte === null ? null : chaveDaFonte(fonte);
  const candidatos = r.candidatos.filter((c) => chave === null || c.fonteChave === chave);
  const excluidosDaFonte = r.excluidos.filter((e) => chave === null || chaveDaFonte(e.fonte) === chave);

  const porFonte = new Map<string, { fonte: string; itens: CandidatoComFonte[] }>();
  if (chave !== null) porFonte.set(chave, { fonte: fonte as string, itens: [] });
  for (const c of candidatos) {
    const atual = porFonte.get(c.fonteChave);
    if (atual) atual.itens.push(c);
    else porFonte.set(c.fonteChave, { fonte: c.fonte, itens: [c] });
  }

  const fontes = [...porFonte.values()]
    .map((g) => ({
      fonte: g.fonte,
      itens: g.itens
        .sort((a, b) => b.demandaKg - a.demandaKg || compararTexto(a.item, b.item) || a.productId - b.productId)
        .map(({ fonteChave: _ignorada, anMotorKg: _an, ...item }) => item),
    }))
    .sort((a, b) => compararTexto(a.fonte, b.fonte));

  const contagem = new Map<MotivoExcluido, number>();
  for (const e of excluidosDaFonte) contagem.set(e.motivo, (contagem.get(e.motivo) ?? 0) + 1);
  return {
    fonte,
    fontes,
    excluidos: MOTIVOS_EXCLUIDOS.flatMap((motivo) =>
      contagem.has(motivo) ? [{ motivo, quantidade: contagem.get(motivo) as number }] : [],
    ),
  };
}
