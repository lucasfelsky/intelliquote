import { api, ApiError } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';

/** Espelha `PendenteCadastro` (src/utils/forecastPendentes.ts). */
export interface ForecastPendente {
  codigo: string;
  /** `produto_inativo` = o codigo pertence a um produto com `isActive: false` (reativa por `POST /forecast/products/:id/reativar`). */
  situacao: 'sem_cadastro' | 'produto_inativo';
  produtoInativo: { id: number; nome: string } | null;
  vendasMes: number;
  vendasAtual: number;
  vendasAnual: number;
  /** Venda dos ultimos 3 meses (base-3 + base-2 do historico + mes anterior). Ausente em backend antigo. */
  vendas3Meses?: number;
  vendasAnteriores?: number;
  programacao: number;
  chegadas: number;
  /** Compra em aberto no FUP (qualquer linha nao concluida). Ausente em backend antigo. */
  comprasEmAberto?: number;
  saldo: number;
}

/** Criterio que o backend aplicou (`PendentesResultado.regra`); ausente em backend antigo. */
export interface ForecastPendentesRegra {
  /** [base-3, base-2, base-1] (YYYY-MM). */
  mesesVenda: string[];
  /** Meses base-3/base-2 sem historico gravado: a lista pode estar incompleta. */
  historicoAusente: string[];
  /** 'chegadas' = quinzena gravada antes da regra de compras em aberto (usa as chegadas aceitas pela F3). */
  compras: 'fup_em_aberto' | 'chegadas';
}

/** Espelha `PendentesResultado`; vem em `ForecastDbcorpSummary.pendentes` (null quando o backend nao montou a quinzena). */
export interface ForecastPendentesResumo {
  itens: ForecastPendente[];
  totalItens: number;
  /** Itens alem do corte (200) que nao vieram em `itens`. */
  omitidos: number;
  /** Codigos so com saldo (sem venda, programacao nem compra em aberto): nao listados, so contados. */
  soSaldo: { codigos: number; kg: number };
  /** Codigos com venda so no mes atual / acumulado anual (sem venda em 3 meses, programacao nem compra): so contados. */
  semVendaRecente?: { codigos: number; vendasAnual: number };
  regra?: ForecastPendentesRegra;
}

/** `GET /forecast/snapshots/:id/pendentes`; `aplicavel: false` = quinzena da planilha (itens vazios). */
export interface ForecastPendentes extends ForecastPendentesResumo {
  aplicavel: boolean;
  snapshotId: number;
  label: string;
}

/** `POST /forecast/products` */
export type ForecastProdutoNovoBody = {
  nome: string;
  codigos: string[];
  sourceId: number;
  familyId: number;
};

export interface ForecastProdutoCriado {
  id: number;
  nome: string;
  ativo: boolean;
  origem: string;
  fonteId: number;
  familiaId: number;
  codigos: Array<{ id: number; posicao: number; codigo: string }>;
}

/** `POST /forecast/products/:id/codigos` */
export interface ForecastCodigoAdicionado {
  produtoId: number;
  /** 'planilha' | 'dbcorp': em produto da planilha o proximo import apaga o codigo se ele nao estiver la. */
  produtoOrigem: string;
  codigo: { id: number; posicao: number; codigo: string };
}

/** `POST /forecast/products/:id/reativar` */
export interface ForecastProdutoReativado {
  id: number;
  nome: string;
  ativo: true;
  /** 'planilha' | 'dbcorp': produto da planilha que nao esta na proxima planilha e inativado de novo pelo import. */
  origem: 'planilha' | 'dbcorp';
  /** false = o produto ja estava ativo (nada foi gravado). */
  alterado: boolean;
}

/** Produto do cadastro (`GET /forecast/products`), so o que o seletor usa. */
export interface ForecastProdutoCadastro {
  id: number;
  name: string;
  isActive: boolean;
  origin?: string | null;
  codes: Array<{ id: number; position: number; code: string }>;
}

export interface ForecastFamilia {
  id: number;
  name: string;
}

export const forecastPendentesKeys = {
  todas: ['forecast', 'pendentes'] as const,
  snapshot: (id: number) => ['forecast', 'pendentes', id] as const,
  familias: ['forecast', 'familias'] as const,
  produtos: ['forecast', 'produtos-cadastro'] as const,
};

export async function getForecastPendentes(snapshotId: number): Promise<ForecastPendentes> {
  const response = await api.get<{ data: ForecastPendentes }>(`/v1/forecast/snapshots/${snapshotId}/pendentes`);
  return response.data;
}

export async function createForecastProduct(body: ForecastProdutoNovoBody): Promise<ForecastProdutoCriado> {
  const response = await api.post<{ data: ForecastProdutoCriado }>('/v1/forecast/products', body);
  return response.data;
}

export async function addForecastProductCode(productId: number, codigo: string): Promise<ForecastCodigoAdicionado> {
  const response = await api.post<{ data: ForecastCodigoAdicionado }>(`/v1/forecast/products/${productId}/codigos`, {
    codigo,
  });
  return response.data;
}

/** Reativa um produto inativo (so o flag; marcas, codigos e embalagens ficam como estao). */
export async function postForecastReativarProduto(productId: number): Promise<ForecastProdutoReativado> {
  const response = await api.post<{ data: ForecastProdutoReativado }>(`/v1/forecast/products/${productId}/reativar`, {});
  return response.data;
}

/** Familias ativas (`GET /item-families` ja filtra ativas; o filtro local protege de backend antigo). */
export async function listFamiliasAtivas(): Promise<ForecastFamilia[]> {
  const response = await api.get<{ data: Array<ForecastFamilia & { isActive?: boolean }> }>('/v1/item-families');
  return response.data.filter((f) => f.isActive !== false).map((f) => ({ id: f.id, name: f.name }));
}

/** Produtos ativos do cadastro (para acrescentar o codigo a um produto existente). */
export async function listProdutosAtivos(): Promise<ForecastProdutoCadastro[]> {
  const response = await api.get<{ data: ForecastProdutoCadastro[] }>('/v1/forecast/products');
  return response.data.filter((p) => p.isActive);
}

const MENSAGEM_OCUPADO = 'O cadastro está ocupado por uma importação. Tente novamente em instantes.';

export const FALHA_AO_CARREGAR = 'Não foi possível carregar os dados do cadastro';

/**
 * Mensagem em portugues para o usuario; 400/409/503 repassam a mensagem do backend. `falhaPadrao` abre a frase dos
 * demais erros HTTP (ex.: leitura usa FALHA_AO_CARREGAR; o padrao serve para gravacao).
 */
export function forecastPendentesErrorMessage(err: unknown, falhaPadrao = 'Não foi possível concluir'): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode completar o cadastro. Peça a um administrador ou comprador.';
      case 404:
        return 'Não encontrado no cadastro do Forecast. Atualize a tela e tente de novo.';
      case 400:
      case 409:
      case 503: {
        const message = messageOf(err);
        if (message && message !== `HTTP ${err.status}`) return message;
        return err.status === 503 ? MENSAGEM_OCUPADO : `Pedido recusado pelo servidor (HTTP ${err.status}).`;
      }
      default:
        return `${falhaPadrao} (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}
