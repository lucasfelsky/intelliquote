import { api, ApiError } from '@/api/client';
import type { ForecastUrgencia } from '@/services/forecast';
import { messageOf } from '@/services/quoteResponses';

// Criar cotacao a partir do Forecast (E6 do relatorio enxuto): candidatos por fonte (E3), rascunho (E5) e criacao em lote,
// uma cotacao por fonte (E4a). Espelha src/routes/ForecastRoutes.ts, src/services/ForecastRascunhoCotacaoService.ts,
// src/utils/forecastCandidatosCotacao.ts e src/services/ForecastCotacaoLoteService.ts (o backend revalida tudo).

export const forecastCotacaoLoteKeys = {
  candidatos: (snapshotId: number, fonte: string | null) =>
    ['forecast', 'candidatos', snapshotId, fonte === null ? 'todas' : fonte.trim().toUpperCase()] as const,
  rascunho: (snapshotId: number) => ['forecast', 'rascunho-cotacao', snapshotId] as const,
};

// ---------- candidatos (E3) ----------

export type ForecastMotivoForaDaLista = 'sem-falta' | 'sob-demanda' | 'coberto-por-grupo' | 'sem-consumo-com-movimento';

export interface ForecastCandidato {
  productId: number;
  item: string;
  codigos: string[];
  fonte: string;
  /** Consumo previsto nos 6 meses da projecao; sempre > 0. */
  demandaKg: number;
  /** O que a lista de compra sugeriria; nulo quando o calculo nao aponta compra. */
  quantidadeSugeridaKg: number | null;
  motivoForaDaLista: ForecastMotivoForaDaLista;
  /** 'AAAA-MM'; nulo = saldo ja negativo no mes base. */
  coberturaAteMes: string | null;
  coberturaAteOFimDaJanela: boolean;
  urgencia: ForecastUrgencia | null;
  grupoNome: string | null;
}

export interface ForecastCandidatos {
  snapshotId: number;
  label: string;
  fonte: string | null;
  fontes: Array<{ fonte: string; itens: ForecastCandidato[] }>;
}

/** `GET /forecast/snapshots/:id/candidatos-cotacao[?fonte=]`; sem `fonte` devolve todas, agrupado por fonte. */
export async function getForecastCandidatos(snapshotId: number, fonte: string | null): Promise<ForecastCandidatos> {
  const r = await api.get<{ data?: Partial<ForecastCandidatos> }>(
    `/v1/forecast/snapshots/${snapshotId}/candidatos-cotacao`,
    fonte === null ? undefined : { fonte },
  );
  const d = r?.data ?? {};
  return {
    snapshotId: d.snapshotId ?? snapshotId,
    label: d.label ?? '',
    fonte: d.fonte ?? null,
    fontes: Array.isArray(d.fontes) ? d.fontes : [],
  };
}

// ---------- rascunho (E5) ----------

export interface ForecastRascunhoItem {
  productId: number;
  quantidadeKg: number;
  observacao: string | null;
}

export interface ForecastRascunho {
  snapshotId: number;
  itens: ForecastRascunhoItem[];
  criadoEm: string;
  /** Devolva no PUT seguinte para a checagem de concorrencia (409 se mudou em outra aba). */
  atualizadoEm: string;
}

export interface ForecastRascunhoGravado {
  acao: 'create' | 'update' | 'delete' | 'nenhuma';
  rascunho: ForecastRascunho | null;
}

/** Sem rascunho = `null`. */
export async function getForecastRascunho(snapshotId: number): Promise<ForecastRascunho | null> {
  const r = await api.get<{ data?: ForecastRascunho | null }>(`/v1/forecast/snapshots/${snapshotId}/rascunho-cotacao`);
  const d = r?.data;
  // Resposta sem `itens` (ex.: GET generico de teste) vale "sem rascunho".
  return d && Array.isArray(d.itens) ? d : null;
}

/** Lista COMPLETA de itens (vazia apaga). `atualizadoEm`: o do rascunho lido (`null` = nao havia rascunho). */
export async function putForecastRascunho(
  snapshotId: number,
  corpo: { itens: ForecastRascunhoItem[]; atualizadoEm: string | null },
): Promise<ForecastRascunhoGravado> {
  const r = await api.put<{ data: ForecastRascunhoGravado }>(`/v1/forecast/snapshots/${snapshotId}/rascunho-cotacao`, corpo);
  return r.data;
}

export async function deleteForecastRascunho(snapshotId: number): Promise<void> {
  await api.del(`/v1/forecast/snapshots/${snapshotId}/rascunho-cotacao`);
}

// ---------- criacao em lote (E4a) ----------

export interface ForecastCotacaoLoteItem {
  productId: number;
  quantidadeKg: number;
  observacao?: string | null;
  /** Item de fora da lista de compra: reenviar SEMPRE `true` (o backend recusa sem ela). */
  incluidoManualmente?: boolean;
  /** `atualizadaEm` da decisao que a tela leu; `null` = nao havia decisao; ausente = nao confere. */
  atualizadoEm?: string | null;
}

export interface ForecastCotacaoCriada {
  id: number;
  requestCode: string;
  fonte: string;
  itens: Array<{ productId: number; item: string; quantidadeKg: number }>;
}

export interface ForecastCotacoesCriadas {
  snapshotId: number;
  label: string;
  cotacoes: ForecastCotacaoCriada[];
}

/** `POST /forecast/snapshots/:id/cotacoes`: cria UMA cotacao por fonte, tudo ou nada. */
export async function postForecastCotacoes(
  snapshotId: number,
  corpo: { itens: ForecastCotacaoLoteItem[] },
): Promise<ForecastCotacoesCriadas> {
  const r = await api.post<{ data: ForecastCotacoesCriadas }>(`/v1/forecast/snapshots/${snapshotId}/cotacoes`, corpo);
  return r.data;
}

function mensagemDoBackend(err: ApiError): string | null {
  const message = messageOf(err);
  return message && message !== `HTTP ${err.status}` ? message : null;
}

/** Gerar as cotacoes: 400/409 repassam a mensagem do backend (lista os itens com problema). */
export function forecastLoteErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode criar cotações.';
      case 404:
        return 'Quinzena não encontrada (pode ter sido excluída).';
      case 400:
      case 409:
        return mensagemDoBackend(err) ?? `Pedido recusado pelo servidor (HTTP ${err.status}).`;
      default:
        return `Não foi possível gerar as cotações (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}

/** Rascunho: 409 vira a mensagem do backend (outra aba alterou); os demais, texto proprio. */
export function forecastRascunhoErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode guardar rascunho de cotação.';
      case 404:
        return 'Quinzena não encontrada (pode ter sido excluída).';
      case 400:
      case 409:
        return mensagemDoBackend(err) ?? `Pedido recusado pelo servidor (HTTP ${err.status}).`;
      default:
        return `Não foi possível salvar o rascunho (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}

/** Candidatos de uma fonte: 404 = a fonte nao existe mais nesta quinzena. */
export function forecastCandidatosErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Fonte não encontrada nesta quinzena.';
    return `Não foi possível carregar os itens com demanda (HTTP ${err.status}).`;
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}
