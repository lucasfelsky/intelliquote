// Ocasioes que afetam o lead time no relatorio de compras (PR 3 das ocasioes): camada pos-motor, PURA (sem Prisma, sem
// exceljs, sem relogio) e so INFORMATIVA. Anexa blocos OPCIONAIS ao item, ao grupo de fonte e ao relatorio; nenhum campo
// existente muda (AQ, leadTimeDias, dataLimite, vencida, urgencia, ordem, quantidades). Toda a regra de ocasiao esta em
// forecastOcasioes.ts (PR 1); aqui so se casa o item com a fonte do cadastro e se monta o bloco.
//
// Regras de encaixe (decisoes do plano):
//  - O lead time usado e o AQ CONGELADO da quinzena (a data-limite normal e ruptura - AQ); etapas, pais e situacao da fonte
//    vem do cadastro ATUAL (mesmo criterio de atipicos e grupos).
//  - A fonte do item e a do grupo do relatorio (grupo de equivalencia: a da linha do grupo, a do principal; membros de
//    outras fontes nao sao avaliados, o item e um so).
//  - Sem ocasiao ativa o contexto nem chega aqui (o service devolve null) e o relatorio sai identico ao de hoje.
import {
  dataLimiteAjustada,
  leadTimeAjustado,
  type EtapaOcasiao,
  type FonteLeadTime,
  type OcasiaoAplicada,
  type OcasiaoLeadTime,
} from './forecastOcasioes';
import { somarDias } from './forecastMonths';
import { isValidDateKey } from './supplierDocumentDates';
import type { GrupoRelatorioCompras, ItemRelatorioCompras, RelatorioCompras } from './forecastRelatorioCompras';

/** ForecastSource ATUAL, sem leadTimeDays (o lead time usado e o AQ congelado da quinzena). */
export interface FonteDoCadastro {
  id: number;
  countryCode: string | null;
  ativa: boolean;
  readinessDays: number | null;
  shippingDays: number | null;
  transitDays: number | null;
  clearanceDays: number | null;
}

export interface ContextoOcasioes {
  /** So ativas, por id. */
  ocasioes: OcasiaoLeadTime[];
  /** id -> name (texto livre; so para a resposta e a planilha). */
  nomes: ReadonlyMap<number, string>;
  /** Chave = normalizedName (trim + maiusculas). */
  fontes: ReadonlyMap<string, FonteDoCadastro>;
}

/** `indisponivel` = a leitura das ocasioes falhou; o relatorio sai sem o bloco e avisa. */
export type OcasioesDoCalculo = ContextoOcasioes | { indisponivel: true };

export interface OcasiaoDoItem {
  id: number;
  nome: string;
  etapa: EtapaOcasiao;
  dias: number;
}

export interface OcasioesDoItem {
  /** Soma sem teto (pode ser 0 se so cruzou ocasiao de 0 dias). */
  extraDias: number;
  /** leadTimeDias + extraDias. */
  leadTimeAjustado: number;
  /** AAAA-MM-DD. */
  dataLimiteAjustada: string;
  /** A ajustada ja venceu e a normal nao (a normal vencida ja aparece como "Vencida"). */
  antesDeHoje: boolean;
  /** AAAA-MM-DD: data de emissao usada na estimativa (nunca antes de hoje). */
  emissaoAvaliada: string;
  /** AAAA-MM-DD = emissaoAvaliada + leadTimeAjustado. */
  chegadaEstimada: string;
  /** Na ordem da util (etapas em sequencia, depois 'total'). */
  ocasioes: OcasiaoDoItem[];
  componentesAusentes?: true;
  oscilou?: true;
}

export interface OcasioesDoGrupo {
  /** Itens do grupo com bloco. */
  itensAfetados: number;
  /** Uniao distinta dos itens, ordem por id. */
  ocasioes: Array<{ id: number; nome: string; etapa: EtapaOcasiao }>;
  componentesAusentes?: true;
}

export type OcasioesDoRelatorio =
  | {
      estado: 'ok';
      ativas: number;
      itensAfetados: number;
      ocasioesQueCruzam: number;
      antesDeHoje: number;
      itensSemFonteCadastrada: number;
      fontesSemPais: number;
    }
  | { estado: 'indisponivel' };

/** Bloco da linha da quinzena calculada (memoria de calculo): a PO sai HOJE. */
export interface OcasioesDaPoHoje {
  extraDias: number;
  leadTimeAjustado: number;
  /** hoje + leadTimeAjustado (AAAA-MM-DD); compara com AP = hoje + AQ. */
  chegadaEstimada: string;
  ocasioes: OcasiaoDoItem[];
  componentesAusentes?: true;
}

// Mesma regra de normalizeSourceName (forecastWorkbook.ts:27); nao importar: aquele arquivo puxa exceljs.
export const chaveDaFonte = (fonte: string): string => fonte.trim().toUpperCase();

const nomeDaOcasiao = (ctx: ContextoOcasioes, id: number): string => ctx.nomes.get(id) ?? `Ocasião ${id}`;

const paraOcasiaoDoItem = (ctx: ContextoOcasioes, o: OcasiaoAplicada): OcasiaoDoItem => ({
  id: o.id,
  nome: nomeDaOcasiao(ctx, o.id),
  etapa: o.etapa,
  dias: o.dias,
});

// Fonte do cadastro no formato da util, com o lead time CONGELADO da quinzena (nunca o leadTimeDays do cadastro).
const fonteParaUtil = (fonte: FonteDoCadastro, leadTimeDias: number): FonteLeadTime => ({
  id: fonte.id,
  countryCode: fonte.countryCode,
  ativa: fonte.ativa,
  leadTimeDays: leadTimeDias,
  readinessDays: fonte.readinessDays,
  shippingDays: fonte.shippingDays,
  transitDays: fonte.transitDays,
  clearanceDays: fonte.clearanceDays,
});

export function ocasioesDoItem(
  e: { fonte: string; leadTimeDias: number; ruptura: string | null; vencida: boolean; hoje: string },
  ctx: ContextoOcasioes,
): OcasioesDoItem | null {
  if (e.ruptura === null) {
    return null;
  }
  const cadastro = ctx.fontes.get(chaveDaFonte(e.fonte));
  if (!cadastro) {
    return null;
  }
  const r = dataLimiteAjustada({
    fonte: fonteParaUtil(cadastro, e.leadTimeDias),
    ocasioes: ctx.ocasioes,
    ruptura: e.ruptura,
    hoje: e.hoje,
  });
  if (r === null || r.ocasioes.length === 0) {
    return null;
  }
  return {
    extraDias: r.extraDias,
    leadTimeAjustado: r.leadTimeAjustado,
    dataLimiteAjustada: r.dataLimiteAjustada,
    antesDeHoje: r.antesDeHoje && !e.vencida,
    emissaoAvaliada: r.emissaoAvaliada,
    chegadaEstimada: r.chegadaEstimada,
    ocasioes: r.ocasioes.map((o) => paraOcasiaoDoItem(ctx, o)),
    ...(r.componentesAusentes ? { componentesAusentes: true as const } : {}),
    ...(r.oscilou ? { oscilou: true as const } : {}),
  };
}

function blocoDoGrupo(itens: OcasioesDoItem[]): OcasioesDoGrupo {
  const porId = new Map<number, { id: number; nome: string; etapa: EtapaOcasiao }>();
  for (const bloco of itens) {
    for (const o of bloco.ocasioes) {
      if (!porId.has(o.id)) {
        porId.set(o.id, { id: o.id, nome: o.nome, etapa: o.etapa });
      }
    }
  }
  return {
    itensAfetados: itens.length,
    ocasioes: [...porId.values()].sort((a, b) => a.id - b.id),
    ...(itens.some((i) => i.componentesAusentes) ? { componentesAusentes: true as const } : {}),
  };
}

// Novo objeto (padrao de anexarDecisoesAoRelatorio): as chaves novas entram sempre como ULTIMA chave e so quando ha bloco;
// nenhum campo existente e reescrito. `{ indisponivel }` acrescenta so o aviso no topo.
export function anexarOcasioesAoRelatorio(r: RelatorioCompras, ctx: OcasioesDoCalculo): RelatorioCompras {
  if ('indisponivel' in ctx) {
    return { ...r, ocasioes: { estado: 'indisponivel' } };
  }
  const hoje = r.quinzena.hoje;
  const haOcasiaoDePais = ctx.ocasioes.some((o) => o.ativa && o.escopo === 'pais');
  const idsQueCruzam = new Set<number>();
  let itensAfetados = 0;
  let antesDeHoje = 0;
  let itensSemFonteCadastrada = 0;
  let fontesSemPais = 0;

  const grupos = r.grupos.map<GrupoRelatorioCompras>((g) => {
    const chave = chaveDaFonte(g.fonte);
    const cadastro = ctx.fontes.get(chave);
    if (cadastro && cadastro.ativa && cadastro.countryCode === null && haOcasiaoDePais) {
      fontesSemPais += 1;
    }
    const blocos: OcasioesDoItem[] = [];
    const itens = g.itens.map<ItemRelatorioCompras>((item) => {
      // Fonte vazia nao e "fora do cadastro": nao ha fonte a cadastrar (o item so fica sem bloco).
      if (!cadastro && chave !== '' && item.ruptura !== null) {
        itensSemFonteCadastrada += 1;
      }
      const bloco = ocasioesDoItem(
        {
          fonte: g.fonte,
          leadTimeDias: item.leadTimeDias,
          ruptura: item.ruptura ? item.ruptura.data : null,
          vencida: item.vencida,
          hoje,
        },
        ctx,
      );
      if (!bloco) {
        return item;
      }
      blocos.push(bloco);
      itensAfetados += 1;
      if (bloco.antesDeHoje) antesDeHoje += 1;
      for (const o of bloco.ocasioes) idsQueCruzam.add(o.id);
      return { ...item, ocasioes: bloco };
    });
    return blocos.length > 0 ? { ...g, itens, ocasioes: blocoDoGrupo(blocos) } : g;
  });

  return {
    ...r,
    grupos,
    ocasioes: {
      estado: 'ok',
      ativas: ctx.ocasioes.length,
      itensAfetados,
      ocasioesQueCruzam: idsQueCruzam.size,
      antesDeHoje,
      itensSemFonteCadastrada,
      fontesSemPais,
    },
  };
}

// Memoria de calculo: a PO sai HOJE (emissao = hoje) com o AQ congelado da linha; sem AQ, fonte fora do cadastro ou sem
// ocasiao cruzando = sem bloco.
export function ocasioesDaPoHoje(
  l: { fonte: string; AQ: number | null },
  hoje: string,
  ctx: ContextoOcasioes,
): OcasioesDaPoHoje | null {
  if (l.AQ === null) {
    return null;
  }
  const cadastro = ctx.fontes.get(chaveDaFonte(l.fonte));
  if (!cadastro) {
    return null;
  }
  const r = leadTimeAjustado(fonteParaUtil(cadastro, l.AQ), ctx.ocasioes, hoje);
  if (r === null || r.ocasioes.length === 0) {
    return null;
  }
  // Efeito invalido no cadastro (NaN, valor absurdo) gera data invalida: lanca, e quem chama descarta o bloco (sem 500).
  const chegadaEstimada = somarDias(hoje, r.leadTimeAjustado);
  if (!isValidDateKey(chegadaEstimada)) {
    throw new Error(`Data invalida: ${chegadaEstimada}`);
  }
  return {
    extraDias: r.extraDias,
    leadTimeAjustado: r.leadTimeAjustado,
    chegadaEstimada,
    ocasioes: r.ocasioes.map((o) => paraOcasiaoDoItem(ctx, o)),
    ...(r.componentesAusentes ? { componentesAusentes: true as const } : {}),
  };
}

// Memoria de calculo do painel: bloco por linha (so as linhas que alguma ocasiao cruza). Pode lancar com dado ruim no cadastro
// (efeito invalido gera data invalida); quem chama descarta o bloco de todas as linhas.
export function ocasioesDaPoHojePorLinha(
  linhas: ReadonlyArray<{ linha: number; fonte: string; AQ: number | null }>,
  hoje: string,
  ctx: ContextoOcasioes,
): Map<number, OcasioesDaPoHoje> {
  const blocos = new Map<number, OcasioesDaPoHoje>();
  for (const l of linhas) {
    const bloco = ocasioesDaPoHoje(l, hoje, ctx);
    if (bloco) blocos.set(l.linha, bloco);
  }
  return blocos;
}
