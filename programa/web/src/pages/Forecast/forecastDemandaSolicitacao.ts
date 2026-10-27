import {
  COMMERCIAL_REQUEST_STATUS_LABELS,
  type CommercialRequestForComex,
  type CommercialRequestItemForComex,
} from '@/services/commercialRequests';
import { FORECAST_DEMANDA_KG_MAX } from '@/services/forecastDemandaComercial';
import { kgBr } from './forecastPainel';

// Demanda do comercial puxada de uma Solicitacao (piloto PR5): logica PURA (sem React, sem chamada HTTP).
// Casa os itens das Solicitacoes pendentes/em cotacao com os produtos do Forecast pelo catalogItemId.

/** Decisao 12 do roadmap: so Solicitacao pendente ou em cotacao pode virar demanda. */
export const STATUS_PUXAVEIS = ['pending', 'quoting'] as const;
export type StatusPuxavel = (typeof STATUS_PUXAVEIS)[number];

export interface ProdutoComCatalogo {
  id: number;
  name: string;
  isActive: boolean;
  codes: Array<{ code: string; catalogItemId?: number | null }>;
}

export type SolicitacaoParaDemanda = Pick<CommercialRequestForComex, 'id' | 'status' | 'customerName' | 'createdAt'> & {
  items: Array<Pick<CommercialRequestItemForComex, 'id' | 'catalogItemId' | 'commercialName' | 'quantity' | 'unit'>>;
};

export type MotivoBloqueio = 'sem-produto' | 'produto-inativo' | 'ambiguo' | 'acima-do-maximo';

export interface ItemCasado {
  itemId: number;
  /** null = item novo (desenvolvimento) ainda sem catalogo: cai em "sem-produto". */
  catalogItemId: number | null;
  commercialName: string;
  quantidade: number;
  /** Unidade normalizada (trim + maiusculas). */
  unidade: string;
  /** null = a unidade nao converte para kg: o usuario informa. */
  kg: number | null;
  pedeKg: boolean;
  /** null quando o item esta bloqueado por falta de produto (sem, inativo ou ambiguo). */
  produto: { id: number; name: string; codigo: string } | null;
  bloqueio: { motivo: MotivoBloqueio; texto: string } | null;
}

export interface SolicitacaoCasada {
  id: number;
  status: StatusPuxavel;
  statusTexto: string;
  cliente: string | null;
  /** dd/mm/aaaa em Brasilia. */
  criadaEm: string;
  itens: ItemCasado[];
}

export interface PreenchimentoSolicitacao {
  solicitacaoId: number;
  productId: number;
  /** Codigo casado: a busca do modal precisa deixar o produto visivel. */
  busca: string;
  /** Vazio quando a unidade pede o kg ao usuario. */
  kgTexto: string;
  cliente: string;
  solicitacao: string;
  pedeKg: boolean;
  /** Ex.: "20 BOX". */
  quantidadeTexto: string;
  kg: number | null;
}

export type ProdutoDoIndice = { id: number; name: string; isActive: boolean; codigo: string };

const TEXTO_SEM_PRODUTO = 'Sem produto do Forecast para este item do catálogo.';
const TEXTO_INATIVO = 'O produto do Forecast deste item está inativo: reative-o no cadastro antes de lançar.';
const TEXTO_ACIMA_DO_MAXIMO = `A quantidade convertida passa de ${kgBr(FORECAST_DEMANDA_KG_MAX)} kg, o limite da demanda.`;

const ehPuxavel = (status: string): status is StatusPuxavel => (STATUS_PUXAVEIS as readonly string[]).includes(status);

/** KG direto; TON x 1000; qualquer outra unidade (UN, M3, L, BOX ou desconhecida) pede o kg ao usuario. */
export function kgDaSolicitacao(
  quantidade: number,
  unidade: string,
): { unidade: string; kg: number | null; pedeKg: boolean } {
  const u = unidade.trim().toUpperCase();
  if (u === 'KG') return { unidade: u, kg: quantidade, pedeKg: false };
  if (u === 'TON') return { unidade: u, kg: quantidade * 1000, pedeKg: false };
  return { unidade: u, kg: null, pedeKg: true };
}

/** catalogItemId -> produtos (ativos e inativos), sem repetir produto; codigo = 1o codigo com aquele catalogItemId. */
export function indexarProdutosPorCatalogo(produtos: ProdutoComCatalogo[]): Map<number, ProdutoDoIndice[]> {
  const indice = new Map<number, ProdutoDoIndice[]>();
  for (const produto of produtos) {
    for (const c of produto.codes) {
      if (c.catalogItemId === null || c.catalogItemId === undefined) continue;
      const lista = indice.get(c.catalogItemId) ?? [];
      if (!lista.some((p) => p.id === produto.id)) {
        lista.push({ id: produto.id, name: produto.name, isActive: produto.isActive, codigo: c.code });
      }
      indice.set(c.catalogItemId, lista);
    }
  }
  return indice;
}

export function casarItem(
  item: SolicitacaoParaDemanda['items'][number],
  indice: Map<number, ProdutoDoIndice[]>,
): ItemCasado {
  const { unidade, kg, pedeKg } = kgDaSolicitacao(item.quantity, item.unit);
  const base = {
    itemId: item.id,
    catalogItemId: item.catalogItemId,
    commercialName: item.commercialName,
    quantidade: item.quantity,
    unidade,
    kg,
    pedeKg,
  };
  const bloqueado = (motivo: MotivoBloqueio, texto: string): ItemCasado => ({
    ...base,
    produto: null,
    bloqueio: { motivo, texto },
  });

  const candidatos = item.catalogItemId === null ? [] : (indice.get(item.catalogItemId) ?? []);
  if (candidatos.length === 0) return bloqueado('sem-produto', TEXTO_SEM_PRODUTO);
  const ativos = candidatos.filter((p) => p.isActive);
  const [casado, segundo] = ativos;
  if (!casado) return bloqueado('produto-inativo', TEXTO_INATIVO);
  if (segundo) {
    const nomes = ativos.map((p) => p.name).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return bloqueado(
      'ambiguo',
      `Item ligado a mais de um produto do Forecast (${nomes.join(', ')}): escolha o produto na lista à mão.`,
    );
  }

  const produto = { id: casado.id, name: casado.name, codigo: casado.codigo };
  if (kg !== null && kg > FORECAST_DEMANDA_KG_MAX) {
    return { ...base, produto, bloqueio: { motivo: 'acima-do-maximo', texto: TEXTO_ACIMA_DO_MAXIMO } };
  }
  return { ...base, produto, bloqueio: null };
}

function instante(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Filtra pending/quoting, tira repetidas (1a ocorrencia), ordena por criacao desc (empate: id desc) e casa os itens. */
export function casarSolicitacoes(
  solicitacoes: SolicitacaoParaDemanda[],
  produtos: ProdutoComCatalogo[],
): SolicitacaoCasada[] {
  const indice = indexarProdutosPorCatalogo(produtos);
  const vistas = new Set<number>();
  const unicas: SolicitacaoParaDemanda[] = [];
  for (const s of solicitacoes) {
    if (!ehPuxavel(s.status) || vistas.has(s.id)) continue;
    vistas.add(s.id);
    unicas.push(s);
  }
  unicas.sort((a, b) => instante(b.createdAt) - instante(a.createdAt) || b.id - a.id);
  return unicas.map((s) => {
    const cliente = (s.customerName ?? '').trim();
    return {
      id: s.id,
      status: s.status as StatusPuxavel,
      statusTexto: COMMERCIAL_REQUEST_STATUS_LABELS[s.status],
      cliente: cliente === '' ? null : cliente,
      criadaEm: dataBrDaSolicitacao(s.createdAt),
      itens: s.items.map((item) => casarItem(item, indice)),
    };
  });
}

/** null quando o item esta bloqueado. */
export function preenchimentoDoItem(s: SolicitacaoCasada, item: ItemCasado): PreenchimentoSolicitacao | null {
  if (item.bloqueio || !item.produto) return null;
  return {
    solicitacaoId: s.id,
    productId: item.produto.id,
    busca: item.produto.codigo,
    kgTexto: item.pedeKg || item.kg === null ? '' : String(item.kg),
    cliente: s.cliente ?? '',
    solicitacao: String(s.id),
    pedeKg: item.pedeKg,
    quantidadeTexto: `${item.quantidade} ${item.unidade}`,
    kg: item.kg,
  };
}

/** Aviso "Mostrando N de M" quando a API tem mais Solicitacoes do que a pagina trouxe; null sem truncamento. */
export function avisoTruncamento(totais: Record<StatusPuxavel, { mostradas: number; total: number }>): string | null {
  const rotulos: Record<StatusPuxavel, string> = { pending: 'pendentes', quoting: 'em cotação' };
  const partes = STATUS_PUXAVEIS.filter((s) => totais[s].total > totais[s].mostradas).map(
    (s) => `${totais[s].mostradas} de ${totais[s].total} Solicitações ${rotulos[s]}`,
  );
  if (partes.length === 0) return null;
  return `Mostrando ${partes.join(' e ')} (as mais recentes). As demais estão no módulo Solicitações.`;
}

export function resumoDoPreenchimento(p: PreenchimentoSolicitacao): string {
  if (p.pedeKg || p.kg === null) {
    return `Solicitação nº ${p.solicitacaoId} aplicada: a Solicitação pede ${p.quantidadeTexto}. Informe a quantidade em kg, a data de necessidade e o motivo.`;
  }
  return `Solicitação nº ${p.solicitacaoId} aplicada: produto, quantidade (${kgBr(p.kg)} kg), cliente e número preenchidos. Informe a data de necessidade e o motivo.`;
}

const DATA_BR = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** ISO -> dd/mm/aaaa em Brasilia; texto invalido -> "—". */
export function dataBrDaSolicitacao(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '—' : DATA_BR.format(new Date(t));
}
