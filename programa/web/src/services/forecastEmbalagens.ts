import { api, ApiError } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';

/** Espelha `ForecastEmbalagensData` (src/services/ForecastProductService.ts): `GET`/`PATCH /forecast/products/:id/embalagens`. */
export interface ForecastEmbalagemCodigo {
  id: number;
  posicao: number;
  codigo: string;
  quantidadeKg: number | null;
  /** PR 6e (opcional: backend antigo nao manda): kg de UM pallet (opcao de compra; nao precisa ser multiplo da quantidade); nulo = sem pallet. */
  palletKg?: number | null;
  rotulo: string | null;
  principal: boolean;
  origem: 'manual' | 'dbcorp' | null;
  /** AAAA-MM-DD da ultima gravacao. */
  atualizadoEm: string | null;
}

export interface ForecastEmbalagens {
  produto: { id: number; nome: string; ativo: boolean; embalagemPlanilha: string | null; naoFraciona: boolean };
  codigos: ForecastEmbalagemCodigo[];
  /** Codigo cuja embalagem o relatorio usa (principal; senao o primeiro com quantidade). */
  usadaCodigoId: number | null;
}

export type ForecastEmbalagemEdicao = {
  codigoId: number;
  quantidadeKg: number | null;
  rotulo?: string | null;
  /** Ausente = mantem; null = sem pallet; numero = kg de um pallet fechado. */
  palletKg?: number | null;
};

export type ForecastEmbalagensPatch = {
  embalagens?: ForecastEmbalagemEdicao[];
  /** Ausente = mantem; null = nenhuma principal; numero = esse codigo. */
  principalCodigoId?: number | null;
};

export const forecastEmbalagensKeys = {
  todas: ['forecast', 'embalagens'] as const,
  produto: (id: number) => ['forecast', 'embalagens', id] as const,
};

export async function getForecastEmbalagens(id: number): Promise<ForecastEmbalagens> {
  const response = await api.get<{ data: ForecastEmbalagens }>(`/v1/forecast/products/${id}/embalagens`);
  return response.data;
}

export async function patchForecastEmbalagens(
  id: number,
  body: ForecastEmbalagensPatch,
): Promise<ForecastEmbalagens> {
  const response = await api.patch<{ data: ForecastEmbalagens }>(`/v1/forecast/products/${id}/embalagens`, body);
  return response.data;
}

/** Mensagem em portugues para o usuario; 400/409/503 repassam a mensagem do backend. */
export function forecastEmbalagensErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode editar embalagens.';
      case 404:
        return 'Produto não encontrado no cadastro do Forecast.';
      case 400:
      case 409:
      case 503: {
        const message = messageOf(err);
        return message && message !== `HTTP ${err.status}`
          ? message
          : `Pedido recusado pelo servidor (HTTP ${err.status}).`;
      }
      default:
        return `Não foi possível carregar as embalagens (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}
