import { api } from '@/api/client';
import type { QueryClient } from '@tanstack/react-query';
import type { ForecastProdutoCadastro } from '@/services/forecastPendentes';

/** Item ATIVO do catalogo cujo codigo DBCorp nao esta no Forecast (`GET /catalog-items/sem-forecast`). */
export interface CatalogoSemForecastItem {
  id: number;
  commercialName: string;
  marketName: string;
  dbcorpCode: string;
  familyId: number | null;
  family: { id: number; name: string } | null;
}

/** Corpo do campo `forecast` (espelha `catalogItemForecastLinkSchema`, src/validators/domain.ts). */
export type CatalogForecastLink =
  | { modo: 'existente'; productId: number }
  | { modo: 'novo'; nome: string; sourceId: number; familyId: number };

/** `forecastVinculo` (POST/PUT /catalog-items) e `data` (POST /catalog-items/:id/forecast). */
export interface CatalogForecastVinculo {
  situacao: 'adicionado' | 'produto_novo' | 'ja_no_forecast' | 'produto_inativo';
  produto: { id: number; nome: string; origem: 'planilha' | 'dbcorp' };
  codigoId: number;
}

export const catalogForecastKeys = {
  // Filha de ['catalog-items']: o invalidateQueries que a tela ja faz atualiza o painel.
  semForecast: ['catalog-items', 'sem-forecast'] as const,
  // Filha de ['forecast']: gravar vinculo invalida tudo do Forecast.
  produtos: ['forecast', 'produtos-todos'] as const,
};

/** O backend antigo (sem a rota) cai em 400/404 ou na lista paginada: so vale item com `dbcorpCode`. */
export async function listCatalogoSemForecast(): Promise<CatalogoSemForecastItem[]> {
  const response = await api.get<{ data?: unknown }>('/v1/catalog-items/sem-forecast');
  const lista = Array.isArray(response?.data) ? (response.data as Array<Partial<CatalogoSemForecastItem>>) : [];
  return lista.filter(
    (item): item is CatalogoSemForecastItem =>
      typeof item?.id === 'number' && typeof item.dbcorpCode === 'string' && item.dbcorpCode.trim() !== '',
  );
}

export async function vincularItemAoForecast(id: number, vinculo: CatalogForecastLink): Promise<CatalogForecastVinculo> {
  const response = await api.post<{ data: CatalogForecastVinculo }>(`/v1/catalog-items/${id}/forecast`, vinculo);
  return response.data;
}

/** TODOS os produtos do Forecast (ativos e inativos): o inativo tambem "ocupa" o codigo. */
export async function listProdutosDoForecast(): Promise<ForecastProdutoCadastro[]> {
  const response = await api.get<{ data: ForecastProdutoCadastro[] }>('/v1/forecast/products');
  return response.data;
}

export type SituacaoDoCodigo = { tipo: 'livre' } | { tipo: 'ativo' | 'inativo'; produto: ForecastProdutoCadastro };

/** Onde o codigo esta hoje no Forecast (sem caixa nem espacos). */
export function situacaoDoCodigo(produtos: readonly ForecastProdutoCadastro[], codigo: string): SituacaoDoCodigo {
  const alvo = codigo.trim().toUpperCase();
  if (alvo === '') return { tipo: 'livre' };
  const dono = produtos.find((p) => p.codes.some((c) => c.code.trim().toUpperCase() === alvo));
  if (!dono) return { tipo: 'livre' };
  return { tipo: dono.isActive ? 'ativo' : 'inativo', produto: dono };
}

export const TEXTO_ENTRA_NO_CALCULO =
  'O código entra no cálculo do Forecast a partir da próxima pré-visualização ou quinzena importada. A quinzena já gravada não muda.';

export const TEXTO_SEM_FORECAST =
  'Enquanto não forem vinculados, esses códigos aparecem como "Sem cadastro" nos pendentes do Forecast e ficam fora do cálculo.';

/**
 * Reativar item: o codigo esta livre no Forecast? Sem a lista (falha de rede, backend antigo) devolve `false`:
 * segue o fluxo direto e o backend responde com o motivo.
 */
export async function codigoLivreNoForecast(queryClient: QueryClient, codigo: string): Promise<boolean> {
  try {
    const produtos = await queryClient.fetchQuery({
      queryKey: catalogForecastKeys.produtos,
      queryFn: listProdutosDoForecast,
      staleTime: 30_000,
    });
    return situacaoDoCodigo(produtos, codigo).tipo === 'livre';
  } catch {
    return false;
  }
}
