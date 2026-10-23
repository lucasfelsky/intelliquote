import { api, ApiError } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';

// Grupos de equivalencia (PR 6b): produtos que sao o MESMO material (nomes ou fontes diferentes) tem o estoque avaliado
// somado no relatorio de compras. Espelha src/services/ForecastGrupoEquivalenciaService.ts e src/validators/forecast.ts
// (o backend revalida).

/** `GET/POST/PATCH /forecast/equivalence-groups`. */
export interface ForecastGrupoEquivalencia {
  id: number;
  nome: string;
  observacao: string | null;
  /** Produto pelo qual a compra sai; nulo = o membro de maior media na quinzena. */
  principalProdutoId: number | null;
  membros: Array<{
    id: number;
    nome: string;
    fonte: string | null;
    ativo: boolean;
    /** Marca de compra sob demanda do membro: dentro do grupo ela e ignorada (so a do principal vale). */
    sobDemanda: boolean;
  }>;
}

export type ForecastGrupoNovo = {
  nome: string;
  observacao?: string | null;
  produtoIds: number[];
  principalProdutoId?: number | null;
};

/** Edicao: so os campos enviados mudam; `produtoIds` substitui o conjunto de membros. */
export type ForecastGrupoEdicao = Partial<ForecastGrupoNovo>;

export const FORECAST_GRUPO_NOME_MAX = 120;
export const FORECAST_GRUPO_OBSERVACAO_MAX = 300;
export const FORECAST_GRUPO_MEMBROS_MIN = 2;
export const FORECAST_GRUPO_MEMBROS_MAX = 20;

export const forecastGruposKeys = {
  lista: ['forecast', 'grupos'] as const,
  produtos: ['forecast', 'grupos', 'produtos'] as const,
};

export async function listForecastGrupos(): Promise<ForecastGrupoEquivalencia[]> {
  const response = await api.get<{ data: ForecastGrupoEquivalencia[] }>('/v1/forecast/equivalence-groups');
  return response.data;
}

export async function createForecastGrupo(body: ForecastGrupoNovo): Promise<ForecastGrupoEquivalencia> {
  const response = await api.post<{ data: ForecastGrupoEquivalencia }>('/v1/forecast/equivalence-groups', body);
  return response.data;
}

export async function patchForecastGrupo(id: number, body: ForecastGrupoEdicao): Promise<ForecastGrupoEquivalencia> {
  const response = await api.patch<{ data: ForecastGrupoEquivalencia }>(`/v1/forecast/equivalence-groups/${id}`, body);
  return response.data;
}

export async function deleteForecastGrupo(id: number): Promise<{ id: number }> {
  const response = await api.del<{ data: { id: number } }>(`/v1/forecast/equivalence-groups/${id}`);
  return response.data;
}

/** Produto do cadastro do Forecast para a busca do grupo (`GET /forecast/products`, so os campos usados). */
export interface ForecastProdutoParaGrupo {
  id: number;
  name: string;
  isActive: boolean;
  source: { name: string } | null;
  codes: Array<{ code: string }>;
  /** Grupo atual do produto (backend antigo nao manda: tratado como avulso). */
  equivalenceGroupId: number | null;
}

export async function listForecastProdutosParaGrupo(): Promise<ForecastProdutoParaGrupo[]> {
  const response = await api.get<{
    data: Array<{
      id: number;
      name: string;
      isActive: boolean;
      source?: { name: string } | null;
      codes?: Array<{ code: string }>;
      equivalenceGroupId?: number | null;
    }>;
  }>('/v1/forecast/products');
  return response.data.map((p) => ({
    id: p.id,
    name: p.name,
    isActive: p.isActive,
    source: p.source ? { name: p.source.name } : null,
    codes: (p.codes ?? []).map((c) => ({ code: c.code })),
    equivalenceGroupId: p.equivalenceGroupId ?? null,
  }));
}

const semAcento = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Produtos ativos que casam com a busca (nome ou codigo). Os que ja estao num grupo (`grupoAtualId` = o grupo em edicao,
 * que continua livre para os seus membros) saem da lista de candidatos.
 */
export function filtrarProdutosParaGrupo(
  produtos: ForecastProdutoParaGrupo[],
  busca: string,
  grupoAtualId: number | null = null,
): ForecastProdutoParaGrupo[] {
  const termo = semAcento(busca.trim());
  const livres = produtos.filter(
    (p) => p.isActive && (p.equivalenceGroupId === null || p.equivalenceGroupId === grupoAtualId),
  );
  if (!termo) return livres;
  return livres.filter((p) => semAcento(p.name).includes(termo) || p.codes.some((c) => semAcento(c.code).includes(termo)));
}

/** Mensagem em portugues para o usuario; 400/409 repassam a mensagem do backend. */
export function forecastGrupoErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode criar nem alterar grupos de equivalência.';
      case 404:
        return 'Grupo não encontrado (pode ter sido desfeito).';
      case 400:
      case 409: {
        const message = messageOf(err);
        return message && message !== `HTTP ${err.status}`
          ? message
          : `Pedido recusado pelo servidor (HTTP ${err.status}).`;
      }
      default:
        return `Não foi possível salvar o grupo de equivalência (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}

// ---------- validacao do formulario (espelha o Zod do backend, que revalida) ----------

export type CampoGrupo = 'nome' | 'observacao' | 'produtos' | 'principal';

export interface GrupoValidado {
  erros: Partial<Record<CampoGrupo, string>>;
  /** Preenchido so sem erro. */
  valores: { nome: string; observacao: string | null; produtoIds: number[]; principalProdutoId: number | null } | null;
}

export function validarGrupo(campos: {
  nome: string;
  observacao: string;
  produtoIds: number[];
  principalProdutoId: number | null;
}): GrupoValidado {
  const erros: GrupoValidado['erros'] = {};
  const nome = campos.nome.trim();
  if (nome === '') erros.nome = 'Informe o nome do grupo.';
  else if (nome.length > FORECAST_GRUPO_NOME_MAX) {
    erros.nome = `O nome do grupo aceita no máximo ${FORECAST_GRUPO_NOME_MAX} caracteres.`;
  }
  const observacao = campos.observacao.trim();
  if (observacao.length > FORECAST_GRUPO_OBSERVACAO_MAX) {
    erros.observacao = `A observação aceita no máximo ${FORECAST_GRUPO_OBSERVACAO_MAX} caracteres.`;
  }
  const { produtoIds } = campos;
  if (produtoIds.length < FORECAST_GRUPO_MEMBROS_MIN) {
    erros.produtos = `Escolha ao menos ${FORECAST_GRUPO_MEMBROS_MIN} produtos para formar um grupo.`;
  } else if (produtoIds.length > FORECAST_GRUPO_MEMBROS_MAX) {
    erros.produtos = `Um grupo aceita no máximo ${FORECAST_GRUPO_MEMBROS_MAX} produtos.`;
  }
  if (campos.principalProdutoId !== null && !produtoIds.includes(campos.principalProdutoId)) {
    erros.principal = 'O produto principal precisa ser um dos produtos do grupo.';
  }
  if (Object.keys(erros).length > 0) return { erros, valores: null };
  return {
    erros,
    valores: {
      nome,
      observacao: observacao === '' ? null : observacao,
      produtoIds,
      principalProdutoId: campos.principalProdutoId,
    },
  };
}
