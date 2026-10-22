import { api } from '@/api/client';

/**
 * Espelha `ForecastSourceService.list` (src/services/ForecastSourceService.ts): `GET /forecast/sources`.
 * Fonte = origem/fornecedor do produto no Forecast; o lead time pertence a ela (nao ao produto).
 */
export interface ForecastFonte {
  id: number;
  name: string;
  /** Dias de lead time; `null` = fonte sem lead time cadastrado (nao serve para cadastrar produto). */
  leadTimeDays: number | null;
  clearanceDays: number | null;
  isActive: boolean;
  _count?: { products: number };
}

export const forecastFontesKeys = {
  todas: ['forecast', 'fontes'] as const,
};

export async function listForecastSources(): Promise<ForecastFonte[]> {
  const response = await api.get<{ data: ForecastFonte[] }>('/v1/forecast/sources');
  return response.data;
}

/** `PATCH /forecast/sources/:id` (admin e comprador; AuditLog no backend). So o lead time. */
export async function patchForecastSourceLeadTime(id: number, leadTimeDays: number): Promise<ForecastFonte> {
  const response = await api.patch<{ data: ForecastFonte }>(`/v1/forecast/sources/${id}`, { leadTimeDays });
  return response.data;
}
