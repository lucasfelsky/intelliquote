import { api, ApiError } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';
import type { ForecastFonte } from '@/services/forecastFontes';

// Ocasioes que afetam o lead time (PR 2, web): feriados, fechamento de fabrica, greve, pico de frete.
// Espelha src/services/ForecastOcasioesService.ts e src/validators/forecast.ts (o backend revalida). Por enquanto
// so informam: nenhum calculo do Forecast usa as ocasioes.

export type ForecastOcasiaoEscopo = 'global' | 'pais' | 'fonte';
export type ForecastOcasiaoEtapa = 'total' | 'prontidao' | 'embarque' | 'transito' | 'liberacao';
export type ForecastOcasiaoEfeito = 'dias' | 'percentual';
export type ForecastOcasiaoRecorrencia = 'nenhuma' | 'anual';

/** Uma ocorrencia concreta (AAAA-MM-DD, inclusiva) de uma ocasiao dentro da janela pedida. */
export interface ForecastOcasiaoOcorrencia {
  inicio: string;
  fim: string;
}

export interface ForecastOcasiao {
  id: number;
  name: string;
  scopeType: ForecastOcasiaoEscopo;
  countryCode: string | null;
  sourceId: number | null;
  source: { id: number; name: string; isActive: boolean } | null;
  startDate: string;
  endDate: string;
  recurrence: ForecastOcasiaoRecorrencia;
  component: ForecastOcasiaoEtapa;
  effectKind: ForecastOcasiaoEfeito;
  effectValue: number;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** `null` sem janela na consulta; com janela, as ocorrencias dentro dela (o backend expande a recorrencia). */
  ocorrencias: ForecastOcasiaoOcorrencia[] | null;
}

/** Corpo do POST: so dias (percentual nao e cadastrado pela tela); `isActive` nasce true no backend. */
export type ForecastOcasiaoNova = {
  name: string;
  scopeType: ForecastOcasiaoEscopo;
  countryCode: string | null;
  sourceId: number | null;
  startDate: string;
  endDate: string;
  recurrence: ForecastOcasiaoRecorrencia;
  component: ForecastOcasiaoEtapa;
  effectKind: 'dias';
  effectValue: number;
  notes: string | null;
};

/** PATCH em blocos atomicos: escopo, periodo e efeito vao completos ou nao vao. */
export type ForecastOcasiaoEdicao = Partial<ForecastOcasiaoNova & { isActive: boolean }>;

export const FORECAST_OCASIAO_NOME_MAX = 120;
export const FORECAST_OCASIAO_OBS_MAX = 300;
export const FORECAST_OCASIAO_DURACAO_MAX_DIAS = 120;
export const FORECAST_OCASIAO_DIAS_MAX = 120;
export const FORECAST_OCASIOES_LISTA_MAX = 500;

export const forecastOcasioesKeys = {
  todas: ['forecast', 'ocasioes'] as const,
  lista: ['forecast', 'ocasioes', 'lista'] as const,
  ano: (ano: number) => ['forecast', 'ocasioes', 'ano', ano] as const,
};

const PATH = '/v1/forecast/lead-time-events';

/** Sem janela: lista pura (`ocorrencias: null`). Com janela: so as ocasioes com ocorrencia nela. */
export async function listarOcasioes(janela?: { de: string; ate: string }): Promise<ForecastOcasiao[]> {
  const response = janela
    ? await api.get<{ data: ForecastOcasiao[] }>(PATH, { de: janela.de, ate: janela.ate })
    : await api.get<{ data: ForecastOcasiao[] }>(PATH);
  return response.data;
}

export async function criarOcasiao(body: ForecastOcasiaoNova): Promise<ForecastOcasiao> {
  const response = await api.post<{ data: ForecastOcasiao }>(PATH, body);
  return response.data;
}

export async function alterarOcasiao(id: number, body: ForecastOcasiaoEdicao): Promise<ForecastOcasiao> {
  const response = await api.patch<{ data: ForecastOcasiao }>(`${PATH}/${id}`, body);
  return response.data;
}

export async function excluirOcasiao(id: number): Promise<{ id: number }> {
  const response = await api.del<{ data: { id: number } }>(`${PATH}/${id}`);
  return response.data;
}

/** `PATCH /forecast/sources/:id` so com o pais (ISO-2 ou `null` para remover). */
export async function patchForecastSourceCountry(id: number, countryCode: string | null): Promise<ForecastFonte> {
  const response = await api.patch<{ data: ForecastFonte }>(`/v1/forecast/sources/${id}`, { countryCode });
  return response.data;
}

function temMensagemNoCorpo(err: ApiError): boolean {
  const body = err.body as { message?: unknown } | null;
  return Boolean(body) && typeof body === 'object' && typeof body?.message === 'string';
}

/** 404 com JSON `{ message }` = registro inexistente; 404 sem isso = rota inexistente (backend antigo). */
export function ocasiaoSumiu(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && temMensagemNoCorpo(err);
}

function mensagemDoBackend(err: ApiError): string {
  const message = messageOf(err);
  return message && message !== `HTTP ${err.status}` ? message : `Pedido recusado pelo servidor (HTTP ${err.status}).`;
}

/** Mensagem em portugues para o usuario; 400/409 repassam a mensagem do backend. */
export function forecastOcasioesErrorMessage(err: unknown, acao: 'listar' | 'salvar' | 'excluir'): string {
  if (!(err instanceof ApiError)) return 'Sem conexão com o servidor. Tente de novo.';
  switch (err.status) {
    case 401:
      return 'Sua sessão expirou. Entre de novo.';
    case 403:
      return acao === 'listar'
        ? 'Seu perfil não tem acesso às ocasiões do Forecast.'
        : 'Seu perfil não pode cadastrar nem alterar ocasiões.';
    case 404:
      if (acao === 'listar' || !temMensagemNoCorpo(err)) {
        return 'O servidor ainda não tem o cadastro de ocasiões. Aguarde a atualização do sistema.';
      }
      return 'Esta ocasião não existe mais (pode ter sido excluída). A lista foi atualizada.';
    case 400:
    case 409:
      return mensagemDoBackend(err);
    default:
      if (acao === 'listar') return `Não foi possível carregar as ocasiões (HTTP ${err.status}).`;
      if (acao === 'salvar') return `Não foi possível salvar a ocasião (HTTP ${err.status}).`;
      return `Não foi possível excluir a ocasião (HTTP ${err.status}).`;
  }
}

export function forecastPaisFonteErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Sem conexão com o servidor. Tente de novo.';
  switch (err.status) {
    case 401:
      return 'Sua sessão expirou. Entre de novo.';
    case 403:
      return 'Seu perfil não pode alterar o país das fontes.';
    case 404:
      return 'Fonte não encontrada (pode ter sido removida).';
    case 400:
      return mensagemDoBackend(err);
    default:
      return `Não foi possível salvar o país da fonte (HTTP ${err.status}).`;
  }
}
