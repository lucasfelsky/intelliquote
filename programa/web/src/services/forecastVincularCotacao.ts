import { api, ApiError } from '@/api/client';
import type { ForecastDecisao } from '@/services/forecastDecisoes';
import { messageOf } from '@/services/quoteResponses';

// Vincular uma cotacao EXISTENTE (aberta) a um item do Relatorio de compras do Forecast (PR2). Espelha
// src/services/ForecastCotacaoVinculoService.ts e src/validators/forecast.ts (o backend revalida).

export interface VinculoForecastItem {
  snapshotId: number;
  productId: number;
}

export interface CotacaoAbertaParaVinculo {
  id: number;
  requestCode: string;
  createdAt: string;
  /** ISO 8601; chave de ordenacao da lista de cotacoes (muda so na reabertura). */
  listedAt: string;
  statusCotacao: 'criada' | 'enviada';
  fornecedores: string[];
  itens: Array<{
    quoteRequestItemId: number;
    productName: string;
    quantity: number;
    unit: string;
    emKg: boolean;
    vinculo: VinculoForecastItem | null;
  }>;
  vinculadaAEsteItem: boolean;
  podeVincular: boolean;
  /** Por que nao pode vincular (ex.: item em UN). */
  motivo: string | null;
}

export interface CotacoesAbertasParaVinculo {
  snapshotId: number;
  productId: number;
  cotacoes: CotacaoAbertaParaVinculo[];
}

export interface VinculoCotacaoGravado {
  acao: 'vincular' | 'trocar' | 'nenhuma';
  quoteRequestId: number;
  requestCode: string;
  itensVinculados: number;
  movidosDeOutraQuinzena: number;
  decisao: ForecastDecisao;
}

export interface VinculoCotacaoDesfeito {
  acao: 'desvincular' | 'nenhuma';
  decisao: ForecastDecisao | null;
}

export type VinculoCotacaoPut = {
  quoteRequestId: number;
  /** Trocar: solta a cotacao aberta atual deste item. */
  substituir?: boolean;
};

export const forecastVincularCotacaoKeys = {
  abertas: (snapshotId: number, productId: number) => ['forecast', 'vincular-cotacao', snapshotId, productId] as const,
};

const base = (snapshotId: number) => `/v1/forecast/snapshots/${snapshotId}`;

export async function getCotacoesAbertasParaVinculo(
  snapshotId: number,
  productId: number,
): Promise<CotacoesAbertasParaVinculo> {
  const r = await api.get<{ data: CotacoesAbertasParaVinculo }>(`${base(snapshotId)}/cotacoes-abertas/${productId}`);
  return r.data;
}

export async function putVinculoCotacao(
  snapshotId: number,
  productId: number,
  body: VinculoCotacaoPut,
): Promise<VinculoCotacaoGravado> {
  const r = await api.put<{ data: VinculoCotacaoGravado }>(`${base(snapshotId)}/vinculo-cotacao/${productId}`, body);
  return r.data;
}

export async function deleteVinculoCotacao(snapshotId: number, productId: number): Promise<VinculoCotacaoDesfeito> {
  const r = await api.del<{ data: VinculoCotacaoDesfeito }>(`${base(snapshotId)}/vinculo-cotacao/${productId}`);
  return r.data;
}

/** Mensagem em portugues para o usuario; 400/404/409 repassam a mensagem do backend. */
export function forecastVinculoErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'Você não tem permissão para vincular cotações.';
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      const message = messageOf(err);
      if (message && message !== `HTTP ${err.status}`) return message;
    }
  }
  return 'Não foi possível vincular a cotação. Tente novamente.';
}
