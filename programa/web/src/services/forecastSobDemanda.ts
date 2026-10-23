import { api, ApiError } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';

/** Espelha `ForecastSobDemandaData` (src/services/ForecastSobDemandaService.ts): `PATCH /forecast/products/:id/compra-sob-demanda`. */
export interface ForecastSobDemanda {
  productId: number;
  sobDemanda: boolean;
  motivo: string | null;
}

export type ForecastSobDemandaPatch = {
  sobDemanda: boolean;
  /** Opcional (3 a 300 caracteres); ignorado quando `sobDemanda` e false. */
  motivo?: string | null;
};

export const FORECAST_SOB_DEMANDA_MOTIVO_MAX = 300;

export async function patchForecastSobDemanda(
  productId: number,
  body: ForecastSobDemandaPatch,
): Promise<ForecastSobDemanda> {
  const response = await api.patch<{ data: ForecastSobDemanda }>(
    `/v1/forecast/products/${productId}/compra-sob-demanda`,
    body,
  );
  return response.data;
}

/** Mensagem em portugues para o usuario; 400 repassa a mensagem do backend. */
export function forecastSobDemandaErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode marcar compra sob demanda.';
      case 404:
        return 'Produto não encontrado no cadastro do Forecast.';
      case 400: {
        const message = messageOf(err);
        return message && message !== `HTTP ${err.status}`
          ? message
          : `Pedido recusado pelo servidor (HTTP ${err.status}).`;
      }
      default:
        return `Não foi possível salvar a compra sob demanda (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}
