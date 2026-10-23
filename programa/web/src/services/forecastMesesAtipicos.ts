import { api, ApiError } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';

/** Espelha `ForecastMesesAtipicosData` (src/services/ForecastMesesAtipicosService.ts): `PUT /forecast/products/:id/meses-atipicos`. */
export interface ForecastMesesAtipicos {
  productId: number;
  /** Todas as marcas do produto depois de gravar (inclusive as de meses fora da janela desta quinzena). */
  meses: Array<{ anoMes: string; motivo: string }>;
}

export type ForecastMesesAtipicosPut = {
  meses: Array<{ anoMes: string; motivo: string }>;
  /** Meses que a tela mostrou: so eles sao substituidos (marcas de outros meses, de outras quinzenas, ficam). */
  janela?: string[];
};

// Espelham src/validators/forecast.ts; o backend revalida.
export const FORECAST_MESES_ATIPICOS_MOTIVO_MIN = 3;
export const FORECAST_MESES_ATIPICOS_MOTIVO_MAX = 300;

export async function putForecastMesesAtipicos(
  productId: number,
  body: ForecastMesesAtipicosPut,
): Promise<ForecastMesesAtipicos> {
  const response = await api.put<{ data: ForecastMesesAtipicos }>(
    `/v1/forecast/products/${productId}/meses-atipicos`,
    body,
  );
  return response.data;
}

/** Mensagem em portugues para o usuario; 400 repassa a mensagem do backend. */
export function forecastMesesAtipicosErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode marcar meses atípicos.';
      case 404:
        return 'Produto não encontrado no cadastro do Forecast.';
      case 400: {
        const message = messageOf(err);
        return message && message !== `HTTP ${err.status}`
          ? message
          : `Pedido recusado pelo servidor (HTTP ${err.status}).`;
      }
      default:
        return `Não foi possível salvar os meses atípicos (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}
