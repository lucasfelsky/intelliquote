import { api, ApiError } from '@/api/client';

/** Espelha `ForecastUltimoPrecoData` (src/services/ForecastUltimoPrecoService.ts): `GET /forecast/products/:id/ultimo-preco`. */
export interface ForecastUltimoPreco {
  /** Valor com 2 casas, em texto (ex.: "12.34"). */
  valorUnitario: string;
  /** Texto livre da cotacao (nem sempre uma moeda ISO). */
  moeda: string;
  unidade: string;
  incoterm: string;
  /** So o nome do fornecedor. */
  fornecedor: string;
  cotacao: { id: number; codigo: string };
  /** AAAA-MM-DD; nulo quando a cotacao esta aberta (so PO enviada). */
  fechadaEm: string | null;
  /** AAAA-MM-DD; nulo quando a PO nao foi enviada. */
  poEnviadaEm: string | null;
  catalogItemId: number;
  codigos: string[];
}

export type ForecastUltimoPrecoMotivo = 'sem_vinculo_catalogo' | 'sem_cotacao_vencedora';

export interface ForecastUltimoPrecoData {
  productId: number;
  ultimoPreco: ForecastUltimoPreco | null;
  motivo: ForecastUltimoPrecoMotivo | null;
}

export const forecastUltimoPrecoKeys = {
  produto: (id: number) => ['forecast', 'ultimo-preco', id] as const,
};

export async function getForecastUltimoPreco(id: number): Promise<ForecastUltimoPrecoData> {
  const response = await api.get<{ data?: ForecastUltimoPrecoData }>(`/v1/forecast/products/${id}/ultimo-preco`);
  const data = response?.data;
  // Sem a chave `ultimoPreco` nao e a resposta deste contrato (ex.: proxy ou backend antigo): nunca mostrar "sem preco".
  if (!data || typeof data !== 'object' || !('ultimoPreco' in data)) {
    throw new Error('Resposta inesperada do servidor.');
  }
  return data;
}

/** Mensagem em portugues para o usuario. */
export function forecastUltimoPrecoErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não tem acesso aos preços negociados.';
      case 404:
        return 'Produto não encontrado no cadastro do Forecast.';
      default:
        return `Não foi possível buscar o último preço (HTTP ${err.status}).`;
    }
  }
  return 'Não foi possível buscar o último preço. Verifique a conexão e tente de novo.';
}
