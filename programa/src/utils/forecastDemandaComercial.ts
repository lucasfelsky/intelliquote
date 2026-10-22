// Demanda do comercial do Forecast (PR 6d, Comex): compra pedida pelo comercial por uma programacao futura de cliente que
// ainda NAO esta no horizonte do Forecast. O COMEX lanca a mao (kg, data de necessidade, motivo); este modulo e PURO
// (sem Prisma e sem planilha): recebe as linhas calculadas da quinzena + as demandas abertas e devolve a avaliacao.
//
// Regra (padroes do plano; o Comex ainda nao respondeu as perguntas 10-12):
//  - necessidade ate o ULTIMO mes de programacao do DBCorp (base + 3, colunas AC..AF): a programacao do cliente ja
//    deveria conter o pedido -> NAO soma (evita contar duas vezes) e a linha avisa para conferir;
//  - necessidade depois desse mes: soma o pedido MENOS o saldo que sobraria no mes da necessidade (projecao AH..AM; apos o
//    6o mes, projecao[5] - Q por mes). Com varias demandas do mesmo produto o saldo e consumido em ordem de necessidade;
//  - produto sem linha na quinzena: listado sem calculo ('fora-da-quinzena').
// O item que tambem esta na lista de compra ganha o selo `demandaComercialKg`; a quantidade dele nao muda.
import type { LinhaParaRelatorio } from './forecastRelatorioCompras';

/** Indice (base = 0) do ultimo mes de programacao do DBCorp: AC..AF = base .. base+3. */
export const ULTIMO_MES_DE_PROGRAMACAO = 3;

export type SituacaoDemandaComercial = 'alem-do-horizonte' | 'no-horizonte' | 'fora-da-quinzena';

export interface DemandaComercialAberta {
  id: number;
  productId: number;
  /** Nome do produto no cadastro (usado so quando o produto nao tem linha na quinzena). */
  produto: string;
  fonte: string | null;
  kg: number;
  /** 'AAAA-MM-DD'. */
  necessidade: string;
  motivo: string;
  cliente: string | null;
  solicitacaoId: number | null;
}

export type LinhaParaDemanda = Pick<
  LinhaParaRelatorio,
  'linha' | 'productId' | 'item' | 'fonte' | 'Q' | 'projecao' | 'programacoes' | 'obs'
>;

export interface ItemDemandaComercial {
  id: number;
  /** Linha da quinzena; nulo = produto sem linha nesta quinzena. */
  linha: number | null;
  productId: number;
  item: string;
  fonte: string;
  kg: number;
  necessidade: string;
  /** 'AAAA-MM' do mes da necessidade. */
  anoMes: string;
  motivo: string;
  cliente: string | null;
  solicitacaoId: number | null;
  situacao: SituacaoDemandaComercial;
  /** Programacao do DBCorp no mes da necessidade (so 'no-horizonte' a partir do mes base); nulo nos demais. */
  programacaoDoMes: number | null;
  /** Saldo projetado que sobra no mes da necessidade apos as demandas anteriores; nulo fora do 'alem-do-horizonte'. */
  saldoLivre: number | null;
  /** max(0, kg - saldoLivre) so 'alem-do-horizonte'; 0 nos demais (nao soma). */
  sugerido: number;
  /** O produto tambem esta na lista de compra da quinzena. */
  noRelatorio: boolean;
  obs: string;
}

export interface DemandaComercialDoRelatorio {
  itens: ItemDemandaComercial[];
  totais: { abertas: number; sugeridoKg: number };
}

const arredondar6 = (n: number) => Math.round(n * 1e6) / 1e6;
const semMenosZero = (n: number) => (n === 0 ? 0 : n);

// Meses entre o mes base e o mes da necessidade (negativo = antes do mes base).
function mesesApartirDaBase(baseDate: string, necessidade: string): number {
  const base = /^(\d{4})-(\d{2})/.exec(baseDate);
  const alvo = /^(\d{4})-(\d{2})/.exec(necessidade);
  if (!base || !alvo) throw new Error('Data invalida na demanda do comercial.');
  return (Number(alvo[1]) - Number(base[1])) * 12 + (Number(alvo[2]) - Number(base[2]));
}

// Projecao do saldo no mes `k` (0 = mes base). Depois do 6o mes (k > 5) continua caindo pela media Q.
function projecaoNoMes(l: LinhaParaDemanda, k: number): number {
  if (k <= 5) return l.projecao[k] ?? 0;
  return (l.projecao[5] ?? 0) - l.Q * (k - 5);
}

export function avaliarDemandasComerciais(
  linhas: LinhaParaDemanda[],
  demandas: DemandaComercialAberta[],
  baseDate: string,
  /** Linhas (Produto.linha) que entraram na lista de compra do relatorio. */
  linhasNaLista: ReadonlySet<number> = new Set(),
): DemandaComercialDoRelatorio {
  const linhaDoProduto = new Map<number, LinhaParaDemanda>();
  for (const l of linhas) {
    if (l.productId != null && !linhaDoProduto.has(l.productId)) linhaDoProduto.set(l.productId, l);
  }
  const ordenadas = [...demandas].sort(
    (a, b) => (a.necessidade < b.necessidade ? -1 : a.necessidade > b.necessidade ? 1 : 0) || a.id - b.id,
  );
  // Saldo ja usado por demandas anteriores do mesmo produto (so a parte coberta pelo saldo; o resto foi comprado).
  const consumido = new Map<number, number>();

  const itens = ordenadas.map<ItemDemandaComercial>((d) => {
    const l = linhaDoProduto.get(d.productId);
    const base = {
      id: d.id,
      linha: l ? l.linha : null,
      productId: d.productId,
      item: l ? l.item : d.produto,
      fonte: (l ? l.fonte : (d.fonte ?? '')).trim(),
      kg: d.kg,
      necessidade: d.necessidade,
      anoMes: d.necessidade.slice(0, 7),
      motivo: d.motivo,
      cliente: d.cliente,
      solicitacaoId: d.solicitacaoId,
      noRelatorio: l ? linhasNaLista.has(l.linha) : false,
      obs: l ? (l.obs ?? '').trim() : '',
    };
    if (!l) {
      return { ...base, situacao: 'fora-da-quinzena', programacaoDoMes: null, saldoLivre: null, sugerido: 0 };
    }
    const k = mesesApartirDaBase(baseDate, d.necessidade);
    if (k <= ULTIMO_MES_DE_PROGRAMACAO) {
      return {
        ...base,
        situacao: 'no-horizonte',
        programacaoDoMes: k >= 0 ? semMenosZero(l.programacoes[k] ?? 0) : null,
        saldoLivre: null,
        sugerido: 0,
      };
    }
    const usado = consumido.get(d.productId) ?? 0;
    const saldoLivre = semMenosZero(arredondar6(Math.max(0, projecaoNoMes(l, k) - usado)));
    const sugerido = semMenosZero(arredondar6(Math.max(0, d.kg - saldoLivre)));
    consumido.set(d.productId, usado + arredondar6(d.kg - sugerido));
    return { ...base, situacao: 'alem-do-horizonte', programacaoDoMes: null, saldoLivre, sugerido };
  });

  itens.sort(
    (a, b) =>
      (a.necessidade < b.necessidade ? -1 : a.necessidade > b.necessidade ? 1 : 0) ||
      a.item.localeCompare(b.item, 'pt-BR') ||
      a.id - b.id,
  );
  return {
    itens,
    totais: { abertas: itens.length, sugeridoKg: semMenosZero(arredondar6(itens.reduce((t, i) => t + i.sugerido, 0))) },
  };
}

// Soma do sugerido das demandas de cada linha da lista de compra (so as que realmente somam).
export function sugeridoPorLinha(itens: ItemDemandaComercial[]): Map<number, number> {
  const mapa = new Map<number, number>();
  for (const i of itens) {
    if (i.linha === null || !i.noRelatorio || i.sugerido <= 0) continue;
    mapa.set(i.linha, arredondar6((mapa.get(i.linha) ?? 0) + i.sugerido));
  }
  return mapa;
}
