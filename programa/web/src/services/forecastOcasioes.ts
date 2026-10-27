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

// Textos que o BACKEND devolve em 400/409 (ele nao muda): as chaves sao literais dele, com o "a" escapado.
const TEXTO_WEB_DO_BACKEND: Readonly<Record<string, string>> = {
  'Já existe uma ocasi\u00e3o ativa com o mesmo alcance, período e etapa. Edite a existente.':
    'Já existe um evento ativo com o mesmo alcance, período e etapa. Edite o existente.',
  'Informe o nome da ocasi\u00e3o.': 'Informe o nome do evento.',
  'Ocasi\u00e3o global n\u00e3o tem país nem fonte.': 'Evento de todas as fontes não tem país nem fonte.',
  'Informe o país da ocasi\u00e3o.': 'Informe o país do evento.',
  'Ocasi\u00e3o de país n\u00e3o tem fonte.': 'Evento por país não tem fonte.',
  'Informe a fonte da ocasi\u00e3o.': 'Informe a fonte do evento.',
  'Ocasi\u00e3o de fonte n\u00e3o tem país.': 'Evento por fonte não tem país.',
  'Informe o que alterar na ocasi\u00e3o.': 'Informe o que alterar no evento.',
};

function mensagemDoBackend(err: ApiError): string {
  const message = messageOf(err);
  if (!message || message === `HTTP ${err.status}`) return `Pedido recusado pelo servidor (HTTP ${err.status}).`;
  return TEXTO_WEB_DO_BACKEND[message] ?? message;
}

/** Mensagem em portugues para o usuario; 400/409 repassam a mensagem do backend (as 8 conhecidas, traduzidas). */
export function forecastOcasioesErrorMessage(err: unknown, acao: 'listar' | 'salvar' | 'excluir'): string {
  if (!(err instanceof ApiError)) return 'Sem conexão com o servidor. Tente de novo.';
  switch (err.status) {
    case 401:
      return 'Sua sessão expirou. Entre de novo.';
    case 403:
      return acao === 'listar'
        ? 'Seu perfil não tem acesso aos eventos estrangeiros do Forecast.'
        : 'Seu perfil não pode cadastrar nem alterar eventos estrangeiros.';
    case 404:
      if (acao === 'listar' || !temMensagemNoCorpo(err)) {
        return 'O servidor ainda não tem o cadastro de eventos estrangeiros. Aguarde a atualização do sistema.';
      }
      return 'Este evento não existe mais (pode ter sido excluído). A lista foi atualizada.';
    case 400:
    case 409:
      return mensagemDoBackend(err);
    default:
      if (acao === 'listar') return `Não foi possível carregar os eventos (HTTP ${err.status}).`;
      if (acao === 'salvar') return `Não foi possível salvar o evento (HTTP ${err.status}).`;
      return `Não foi possível excluir o evento (HTTP ${err.status}).`;
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
