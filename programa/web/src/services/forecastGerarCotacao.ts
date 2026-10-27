import { api, ApiError } from '@/api/client';

// Leituras do "Gerar cotacao" a partir do relatorio de compras (piloto PR6): vinculo dos codigos do Forecast com o catalogo
// (`GET /forecast/products`) e o item do catalogo (`GET /catalog-items/:id`). So leitura; a cotacao sai pelo fluxo da CotacaoNova.

export const forecastGerarCotacaoKeys = {
  produtos: ['forecast', 'gerar-cotacao', 'produtos'] as const,
  catalogo: (id: number) => ['forecast', 'gerar-cotacao', 'catalogo', id] as const,
};

/** Codigo do cadastro do Forecast com o item do catalogo vinculado (so os campos usados). */
export interface ForecastCodigoParaCotacao {
  code: string;
  position: number;
  catalogItemId: number | null;
  catalogItem: { id: number; commercialName: string; marketName: string } | null;
}

export interface ForecastProdutoParaCotacao {
  id: number;
  name: string;
  /** Ordenados por `position`. */
  codes: ForecastCodigoParaCotacao[];
}

/** Resposta sem lista (ex.: GET generico de teste) vale lista vazia: o botao so mostra o motivo. */
export async function listForecastProdutosParaCotacao(): Promise<ForecastProdutoParaCotacao[]> {
  const response = await api.get<{ data?: ForecastProdutoParaCotacao[] }>('/v1/forecast/products');
  if (!Array.isArray(response?.data)) return [];
  return response.data.map((p) => ({
    id: p.id,
    name: p.name,
    codes: (p.codes ?? [])
      .map((c) => ({
        code: c.code,
        position: c.position,
        catalogItemId: c.catalogItemId ?? null,
        catalogItem: c.catalogItem
          ? { id: c.catalogItem.id, commercialName: c.catalogItem.commercialName, marketName: c.catalogItem.marketName }
          : null,
      }))
      .sort((a, b) => a.position - b.position),
  }));
}

/** Item do catalogo (resposta crua, sem envelope `data`). */
export interface CatalogItemParaCotacao {
  id: number;
  commercialName: string;
  marketName: string;
  isActive: boolean;
}

export async function getCatalogItemParaCotacao(id: number): Promise<CatalogItemParaCotacao> {
  const item = await api.get<CatalogItemParaCotacao>(`/v1/catalog-items/${id}`);
  return {
    id: item.id,
    commercialName: item.commercialName,
    marketName: item.marketName,
    isActive: item.isActive,
  };
}

/** Mensagem em portugues para o usuario; os demais status mostram so o HTTP. */
export function forecastGerarCotacaoErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode ler o vínculo com o catálogo.';
      case 404:
        return 'Item do catálogo não encontrado.';
      default:
        return `Não foi possível ler o vínculo com o catálogo (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}
