import { api, ApiError } from '@/api/client';
import type { CommercialRequestForComex, PaginatedResult } from '@/services/commercialRequests';
import { STATUS_PUXAVEIS, type StatusPuxavel } from '@/pages/Forecast/forecastDemandaSolicitacao';

// Solicitacoes puxaveis para a demanda do comercial (piloto PR5). So leitura de `GET /commercial-requests`
// (rota existente do modulo Solicitacoes); o filtro/dedupe/ordem ficam no modulo puro.

/** Maximo aceito pela paginacao do backend (valor maior vira 100). */
export const SOLICITACOES_PAGE_SIZE = 100;

export const forecastSolicitacoesKeys = {
  lista: ['forecast', 'demanda-comercial', 'solicitacoes'] as const,
};

export interface SolicitacoesParaDemanda {
  solicitacoes: CommercialRequestForComex[];
  totais: Record<StatusPuxavel, { mostradas: number; total: number }>;
}

/** O backend filtra por UM status por chamada: uma chamada para `pending` e outra para `quoting`. */
export async function listSolicitacoesParaDemanda(): Promise<SolicitacoesParaDemanda> {
  const respostas = await Promise.all(
    STATUS_PUXAVEIS.map((status) =>
      api.get<PaginatedResult<CommercialRequestForComex>>('/api/v1/commercial-requests', {
        status,
        page: 1,
        pageSize: SOLICITACOES_PAGE_SIZE,
      }),
    ),
  );
  const [pendentes, emCotacao] = respostas;
  if (!pendentes || !emCotacao) throw new Error('Resposta incompleta das Solicitações.');
  const resumo = (r: PaginatedResult<CommercialRequestForComex>) => ({
    mostradas: r.data.length,
    total: r.pagination.totalItems,
  });
  return {
    solicitacoes: [...pendentes.data, ...emCotacao.data],
    totais: { pending: resumo(pendentes), quoting: resumo(emCotacao) },
  };
}

/** Mensagem em portugues para o usuario ao falhar a carga das Solicitacoes. */
export function forecastSolicitacoesErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode consultar as Solicitações. Preencha a demanda à mão.';
      default:
        return `Não foi possível carregar as Solicitações (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}
