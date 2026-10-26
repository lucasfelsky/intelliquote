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

/** Espelha `ForecastSourceService.prazoReal`: estatistica de dias de UMA fonte (media por chegada do FUP). */
export interface ForecastPrazoRealEstatistica {
  chegadas: number;
  media: number;
  mediana: number;
  min: number;
  max: number;
  /** Menos chegadas que `minChegadas`: a media nao e confiavel. */
  poucasChegadas: boolean;
}

export type ForecastPrazoRealMotivo = 'sem_quinzena_dbcorp' | 'quinzena_sem_historico';

export interface ForecastPrazoRealFonte {
  sourceId: number;
  nome: string;
  leadTimeDays: number | null;
  clearanceDays: number | null;
  /** Dias ETD -> chegada que o FUP usa hoje para esta fonte (`arrivalFromEtdDays ?? padrao`). */
  etdDiasUsado: number;
  /** `null` = sem quinzena utilizavel; `po`/`etd` `null` = fonte sem amostra. */
  real: { po: ForecastPrazoRealEstatistica | null; etd: ForecastPrazoRealEstatistica | null } | null;
}

/** `GET /forecast/sources/prazo-real` (todos os papeis COMEX; so leitura). */
export interface ForecastPrazoReal {
  quinzena: { id: number; label: string; baseDate: string } | null;
  disponivel: boolean;
  motivo: ForecastPrazoRealMotivo | null;
  janelaDias: number;
  minChegadas: number;
  padraoEtdDias: number;
  fontes: ForecastPrazoRealFonte[];
  semFonte: { chegadas: number };
}

export const forecastFontesKeys = {
  todas: ['forecast', 'fontes'] as const,
  prazoReal: ['forecast', 'fontes', 'prazo-real'] as const,
};

export async function listForecastSources(): Promise<ForecastFonte[]> {
  const response = await api.get<{ data: ForecastFonte[] }>('/v1/forecast/sources');
  return response.data;
}

export async function getForecastPrazoReal(): Promise<ForecastPrazoReal> {
  const response = await api.get<{ data: ForecastPrazoReal }>('/v1/forecast/sources/prazo-real');
  return response.data;
}

/** `PATCH /forecast/sources/:id` (admin e comprador; AuditLog no backend). So o lead time. */
export async function patchForecastSourceLeadTime(id: number, leadTimeDays: number): Promise<ForecastFonte> {
  const response = await api.patch<{ data: ForecastFonte }>(`/v1/forecast/sources/${id}`, { leadTimeDays });
  return response.data;
}
