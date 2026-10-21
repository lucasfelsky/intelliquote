import { api, ApiError } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';

export type ForecastStatus = 'nao' | 'cotando' | 'confirmado' | 'po' | 'preco';
export type ForecastOrigin = 'planilha' | 'dbcorp';

export interface ForecastMonths {
  consumo: string[];
  chegada: string[];
  programacao: string[];
}

/** Item da lista de quinzenas (`GET /forecast/snapshots`). `baseDate` vem como ISO completo. */
export interface ForecastSnapshotSummary {
  id: number;
  label: string;
  baseDate: string;
  half: number;
  origin: ForecastOrigin;
  months: ForecastMonths;
  files: unknown[];
  createdById: number | null;
  createdAt: string;
}

/** Uma linha calculada pelo motor + dados do produto congelado na quinzena. */
export interface ForecastLinha {
  linha: number;
  O: number;
  P: number;
  Q: number;
  R: number;
  S: number;
  T: number | null;
  U: number;
  chegadas: number[];
  AA: number | string;
  programacoes: number[];
  AG: number;
  projecao: number[];
  AN: number | null;
  AQ: number | null;
  AP: string | null;
  AR: number | string;
  AS: number;
  item: string;
  codigos: string[];
  fonte: string;
  status: ForecastStatus;
  analiseForecast: number | null;
  productId: number | null;
  // Opcionais: um backend anterior ao PR 1D-1 nao devolve estes quatro campos.
  n?: number | null;
  historico?: number[];
  obs?: string;
  /** Selo "Fixo": so sim/nao. O valor do preco fechado nunca sai da API. */
  precoFixo?: boolean;
}

export interface ForecastDivergencia {
  linha: number;
  item: string;
  coluna: string;
  esperado: number | string | null;
  calculado: number | string | null;
}

export interface ForecastConferencia {
  celulas: number;
  batem: number;
  porColuna: Record<string, { celulas: number; batem: number }>;
  totalDivergencias: number;
  divergencias: ForecastDivergencia[];
}

/** Quinzena calculada (`GET /forecast/snapshots/:id`). `baseDate` vem como AAAA-MM-DD. */
export interface ForecastSnapshotDetail {
  id: number;
  label: string;
  baseDate: string;
  half: number;
  origin: ForecastOrigin;
  hoje: string;
  months: ForecastMonths;
  files: unknown[];
  createdAt: string;
  linhas: ForecastLinha[];
  conferencia: ForecastConferencia | null;
}

export const forecastKeys = {
  snapshots: ['forecast', 'snapshots'] as const,
  snapshot: (id: number) => ['forecast', 'snapshot', id] as const,
};

export async function listForecastSnapshots(): Promise<ForecastSnapshotSummary[]> {
  const response = await api.get<{ data: ForecastSnapshotSummary[] }>('/v1/forecast/snapshots');
  return response.data;
}

export async function getForecastSnapshot(id: number): Promise<ForecastSnapshotDetail> {
  const response = await api.get<{ data: ForecastSnapshotDetail }>(`/v1/forecast/snapshots/${id}`);
  return response.data;
}

/** Mensagem em portugues para o usuario; 400/409/413 repassam a mensagem do backend. */
export function forecastErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não tem acesso ao Forecast.';
      case 404:
        return 'Quinzena não encontrada (pode ter sido removida).';
      case 400:
      case 409:
      case 413: {
        const message = messageOf(err);
        return message && message !== `HTTP ${err.status}`
          ? message
          : `Pedido recusado pelo servidor (HTTP ${err.status}).`;
      }
      default:
        return `Não foi possível carregar o Forecast (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}
