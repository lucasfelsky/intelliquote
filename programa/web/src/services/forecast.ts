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

// ---------- importacao da quinzena (PR 1D-2) ----------

// Espelha src/constants/forecast.ts; o backend revalida.
export const FORECAST_JSON_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
export const FORECAST_BASE64_MAX_LENGTH = FORECAST_JSON_BODY_LIMIT_BYTES - 64 * 1024;

export type ForecastDbcorpSlot =
  | 'saldo'
  | 'vendasMes'
  | 'vendasAtual'
  | 'vendasAnual'
  | 'programacao'
  | 'fup'
  | 'clientesAtivos'
  | 'margem';

export interface ForecastHistoricoMensal {
  yearMonth: string | null;
  linhas: number;
  novas: number;
  alteradas: number;
  removidas: number;
}

/** Resumo do preview/confirm da planilha (`ForecastImportSummary` do backend). */
export interface ForecastImportSummary {
  label: string;
  baseDate: string;
  half: 1 | 2;
  produtos: { total: number; novos: number; alterados: number; inativados: number };
  codigos: { total: number; vinculadosCatalogo: number; movidos: number };
  fontes: { total: number; novas: number; alteradas: number; comFornecedor: number };
  historico: ForecastHistoricoMensal;
  conferencia: ForecastConferencia;
  avisos: string[];
  erros: string[];
}

export type ForecastImportOptions = {
  atualizarCadastro: boolean;
  gravarHistorico: boolean;
  criarQuinzena: boolean;
};

export type ForecastWorkbookBody = {
  contentBase64: string;
  fileName: string;
  label: string;
  baseDate: string;
};

export type ForecastArquivoBody = { fileName: string; contentBase64: string };

export type ForecastDbcorpFiles = {
  saldo: ForecastArquivoBody;
  vendasMes: ForecastArquivoBody;
  vendasAtual?: ForecastArquivoBody;
  vendasAnual: ForecastArquivoBody;
  programacao: ForecastArquivoBody;
  fup: ForecastArquivoBody;
  clientesAtivos?: ForecastArquivoBody;
  margem?: ForecastArquivoBody;
};

export type ForecastDbcorpBody = {
  label: string;
  baseDate: string;
  files: ForecastDbcorpFiles;
};

export interface ForecastLinhasKg {
  linhas: number;
  kg: number;
}

export interface ForecastPorStatus {
  status: string;
  incluido: boolean;
  linhas: number;
  /** PROGRAMACAO */
  qtd?: number;
  /** FUP */
  kg?: number;
}

/** Um relatorio no resumo do preview; os campos opcionais dependem do slot. */
export interface ForecastRelatorioResumo {
  fileName: string;
  lidas: number;
  usadas: number;
  ignoradas: Record<string, number>;
  total: number;
  avisos: string[];
  erros: string[];
  totalCasado: number | null;
  codigosSemProduto: number | null;
  // SALDO
  porDeposito?: Array<{ deposito: string; incluido: boolean; linhas: number; saldo: number }>;
  outrasEmpresas?: Array<{ empresa: string; linhas: number; saldo: number }>;
  // VENDAS
  empresas?: string[];
  // PROGRAMACAO e FUP
  porStatus?: ForecastPorStatus[];
  foraDaJanela?: { antes: number; depois: number };
  // FUP
  estimadasPorEtd?: ForecastLinhasKg;
  vencidasNoMesBase?: ForecastLinhasKg;
  semData?: ForecastLinhasKg & { porStatus: Array<{ status: string; linhas: number; kg: number }> };
  depoisDaJanela?: ForecastLinhasKg;
}

/** Resumo do preview dos relatorios DBCorp (`ForecastDbcorpSummary` do backend). */
export interface ForecastDbcorpSummary {
  label: string;
  baseDate: string;
  half: 1 | 2;
  meses: ForecastMonths;
  produtos: { total: number };
  historico: {
    meses: Array<{ yearMonth: string; linhas: number }>;
    ausentes: string[];
    mesAnterior: ForecastHistoricoMensal | null;
  };
  relatorios: Partial<Record<ForecastDbcorpSlot, ForecastRelatorioResumo>>;
  avisos: string[];
  erros: string[];
}

export type ForecastWorkbookConfirmResult = ForecastImportSummary & {
  snapshotId: number | null;
  options: ForecastImportOptions;
};

export type ForecastDbcorpConfirmResult = ForecastDbcorpSummary & { snapshotId: number };

export async function previewForecastWorkbook(body: ForecastWorkbookBody): Promise<ForecastImportSummary> {
  const response = await api.post<{ data: ForecastImportSummary }>('/v1/forecast/import/workbook/preview', body);
  return response.data;
}

export async function confirmForecastWorkbook(
  body: ForecastWorkbookBody,
  options: ForecastImportOptions,
): Promise<ForecastWorkbookConfirmResult> {
  const response = await api.post<{ data: ForecastWorkbookConfirmResult }>(
    '/v1/forecast/import/workbook/confirm',
    { ...body, options },
  );
  return response.data;
}

export async function previewForecastDbcorp(body: ForecastDbcorpBody): Promise<ForecastDbcorpSummary> {
  const response = await api.post<{ data: ForecastDbcorpSummary }>('/v1/forecast/import/dbcorp/preview', body);
  return response.data;
}

export async function confirmForecastDbcorp(body: ForecastDbcorpBody): Promise<ForecastDbcorpConfirmResult> {
  const response = await api.post<{ data: ForecastDbcorpConfirmResult }>('/v1/forecast/import/dbcorp/confirm', body);
  return response.data;
}

/** Falha detectada no navegador antes de qualquer POST (limite, extensao, arquivo vazio, leitura). */
export class ForecastLocalError extends Error {}

/** Mensagem em portugues para a importacao (a de leitura, `forecastErrorMessage`, fala de acesso ao painel). */
export function forecastImportErrorMessage(err: unknown, label: string): string {
  if (err instanceof ForecastLocalError) return err.message;
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Só administradores e compradores podem importar quinzenas.';
      case 404:
        return 'O servidor ainda não tem esta importação. Aguarde a atualização do sistema.';
      case 409:
        return `Já existe a quinzena ${label}. Nada foi gravado.`;
      case 413:
        return 'O envio passa do limite de 10 MB (somando todos os arquivos). Nada foi gravado.';
      case 400: {
        const message = messageOf(err);
        return message && message !== 'HTTP 400' ? message : 'Pedido recusado pelo servidor (HTTP 400).';
      }
      case 502:
      case 503:
      case 504:
        return 'O servidor demorou para responder. Confira a lista de quinzenas antes de tentar de novo: a importação pode ter sido concluída.';
      default:
        return `Não foi possível concluir a importação (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}
