import { api } from '@/api/client';
import type { ForecastStatus } from '@/services/forecast';

// Quantidade decidida de compra por item e quinzena (PR3 do piloto do Forecast; coluna AO da planilha).
// Espelha src/services/ForecastDecisaoCompraService.ts e src/validators/forecast.ts (o backend revalida). A gravacao (PUT por
// item) saiu do front na E8: o pop-up "Criar cotacao" grava a decisao junto do lote (services/forecastCotacaoLote.ts).

/** Mesmo vocabulario da cor do item na planilha (e da coluna Status do relatorio). */
export type ForecastDecisaoStatus = ForecastStatus;

/** `GET /forecast/snapshots/:id/decisoes` (um item por produto decidido). */
export interface ForecastDecisao {
  productId: number;
  quantidadeKg: number;
  status: ForecastDecisaoStatus;
  observacao: string | null;
  /** Qtd. final do relatorio na hora da decisao (congelada). */
  sugeridaKg: number;
  /** Demanda (AN) do motor na hora da decisao (congelada; <= 0 = falta). */
  demandaKg: number;
  decididaPorId: number | null;
  criadaEm: string;
  atualizadaEm: string;
  /** E3: item de fora da lista de compra incluido de proposito (opcional: backend antigo nao manda). */
  incluidoManualmente?: boolean;
  /** E4a: cotacao viva mais recente vinculada ao item (opcional: backend antigo nao manda). */
  cotacao?: ForecastCotacaoVinculada | null;
  /** E4a: Qtd. final gravada no envio/fechamento (nula = ainda nao enviada). */
  finalKg?: number | null;
  finalAt?: string | null;
  statusDerivado?: ForecastDecisaoStatus | 'cotacao_criada';
}

/** 'criada' = aberta e ainda nao enviada; 'enviada' = aberta e enviada a fornecedores; depois 'fechada' e 'po_enviada'. */
export interface ForecastCotacaoVinculada {
  id: number;
  requestCode: string;
  statusCotacao: 'criada' | 'enviada' | 'fechada' | 'po_enviada';
}

/** Cotacao aberta (criada ou enviada): o backend recusa cotar de novo o mesmo item enquanto ela estiver aberta. */
export function cotacaoAbertaDaDecisao(decisao: ForecastDecisao | undefined): ForecastCotacaoVinculada | null {
  const c = decisao?.cotacao;
  return c && (c.statusCotacao === 'criada' || c.statusCotacao === 'enviada') ? c : null;
}

export const FORECAST_DECISAO_KG_MAX = 10_000_000;
export const FORECAST_DECISAO_OBSERVACAO_MAX = 300;

export const forecastDecisoesKeys = {
  lista: (snapshotId: number) => ['forecast', 'decisoes', snapshotId] as const,
};

/** Resposta sem `decisoes` (ex.: GET generico de teste) vale lista vazia: a coluna nao quebra a tela. */
export async function listForecastDecisoes(snapshotId: number): Promise<ForecastDecisao[]> {
  const r = await api.get<{ data?: { decisoes?: ForecastDecisao[] } }>(`/v1/forecast/snapshots/${snapshotId}/decisoes`);
  return Array.isArray(r?.data?.decisoes) ? r.data.decisoes : [];
}
