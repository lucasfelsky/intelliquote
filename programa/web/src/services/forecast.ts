import { api, ApiError } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';
import type { ForecastPendentesResumo } from '@/services/forecastPendentes';

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
  /** Flag X da coluna AX ("nao fraciona"). */
  naoFraciona?: boolean;
  /** PR 6a (opcionais: backend antigo nao manda): produto marcado como compra sob demanda no cadastro ATUAL. */
  sobDemanda?: boolean;
  sobDemandaMotivo?: string | null;
  /** PR 6c (opcionais: backend antigo nao manda): marcas de mes atipico da janela desta quinzena (cadastro ATUAL). */
  mesesForaDaMedia?: ForecastMesForaDaMedia[];
  /** So presente quando a linha tem meses marcados: Q/R/AG acima ja sao SEM esses meses; aqui, os da planilha. */
  mediaAjustada?: ForecastMediaAjustada;
}

/** Mes de venda atipica de um produto dentro da janela da quinzena; `indice`: 0..5 = J..O, 6 = P (mes atual). */
export interface ForecastMesForaDaMedia {
  anoMes: string;
  motivo: string;
  indice: number;
}

/** Valores DA PLANILHA (antes) das medias que mudaram por causa dos meses atipicos. */
export interface ForecastMediaAjustada {
  meses: number[];
  Q: number;
  R: number;
  AG: number;
  /** Todos os meses da media estavam marcados: a media ficou como a da planilha (sem divisao por zero). */
  semMesValido: boolean;
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
  relatorio: (id: number) => ['forecast', 'relatorio', id] as const,
};

export async function listForecastSnapshots(): Promise<ForecastSnapshotSummary[]> {
  const response = await api.get<{ data: ForecastSnapshotSummary[] }>('/v1/forecast/snapshots');
  return response.data;
}

export async function getForecastSnapshot(id: number): Promise<ForecastSnapshotDetail> {
  const response = await api.get<{ data: ForecastSnapshotDetail }>(`/v1/forecast/snapshots/${id}`);
  return response.data;
}

// ---------- relatorio de compras (PR 2A) ----------

/** Espelha src/utils/forecastRelatorioCompras.ts (`GET /forecast/snapshots/:id/relatorio-compras`). */
export interface ForecastEmbalagemDoItem {
  codigo: string;
  quantidade: number;
  rotulo: string | null;
}

/** Pallets fechados ao redor da quantidade sugerida (PR 6e); `abaixo` e `acima` coincidem no multiplo exato. */
export interface ForecastPalletDaOpcao {
  kgPorPallet: number;
  abaixo: { pallets: number; kg: number };
  acima: { pallets: number; kg: number };
}

/** Quantidade do item arredondada para UMA embalagem cadastrada (PR 5B); `destaque` = a que gera a Qtd. final. */
export interface ForecastOpcaoEmbalagem extends ForecastEmbalagemDoItem {
  embalagens: number;
  quantidadeFinal: number;
  destaque: boolean;
  /** PR 6e (opcional: backend antigo nao manda): pallets abaixo/acima; nulo/ausente = embalagem sem pallet. */
  pallet?: ForecastPalletDaOpcao | null;
}

/** Faixas de urgencia do relatorio (PR 2D), da mais para a menos urgente. */
export type ForecastUrgencia = 'sem-estoque' | 'critico' | 'atrasado' | 'no-prazo';

export interface ForecastItemRelatorio {
  linha: number;
  n: number | null;
  /** Produto do cadastro congelado na quinzena; nulo = fora do cadastro (sem botao de embalagem). */
  productId?: number | null;
  item: string;
  codigos: string[];
  status: ForecastStatus;
  demanda: number;
  quantidadeSugerida: number;
  embalagem: {
    usada: ForecastEmbalagemDoItem | null;
    cadastradas: ForecastEmbalagemDoItem[];
    multiplas: boolean;
  };
  /** PR 5B, opcional de proposito: backend antigo nao manda e a tela cai no texto antigo das outras embalagens. */
  porEmbalagem?: ForecastOpcaoEmbalagem[];
  quantidadeEmbalagens: number | null;
  quantidadeFinal: number;
  naoFraciona: boolean;
  /** PR 5B (opcional: backend antigo nao manda): observacao da quinzena; '' = sem observacao. */
  obs?: string;
  /** PR 6c (opcional: backend antigo nao manda): meses de venda atipica fora da media do item ('AAAA-MM'). */
  mesesForaDaMedia?: string[];
  ruptura: { indiceMes: number; anoMes: string; data: string; jaNaDataBase: boolean } | null;
  dataLimite: string | null;
  vencida: boolean;
  leadTimeDias: number;
  emAndamento: {
    chegadas: Array<{ anoMes: string; quantidade: number }>;
    programacoes: Array<{ anoMes: string; quantidade: number }>;
  };
  // Campos do PR 2D: opcionais de proposito (backend antigo = modo legado, sem faixas).
  urgencia?: ForecastUrgencia;
  diasAteRuptura?: number | null;
  posicaoUrgencia?: number;
}

export interface ForecastGrupoRelatorio {
  fonte: string;
  leadTimeDias: number;
  dataLimiteMaisUrgente: string | null;
  vencidas: number;
  urgenciaMaisAlta?: ForecastUrgencia;
  porUrgencia?: Record<ForecastUrgencia, number>;
  itens: ForecastItemRelatorio[];
}

/** Item sem consumo, fora da lista de compra, com estoque ou programacao (PR 2D). */
export interface ForecastItemSemConsumo {
  linha: number;
  n: number | null;
  productId: number | null;
  item: string;
  codigos: string[];
  fonte: string;
  status: ForecastStatus;
  motivos: Array<'programacao' | 'estoque'>;
  estoque: number;
  programado: number;
  programacoes: Array<{ anoMes: string; quantidade: number }>;
  chegadas: Array<{ anoMes: string; quantidade: number }>;
  semLeadTime: boolean;
  /** PR 5B (opcional: backend antigo nao manda): observacao da quinzena; '' = sem observacao. */
  obs?: string;
  /** PR 6a (opcional: backend antigo nao manda): produto marcado como compra sob demanda (so selo). */
  sobDemanda?: boolean;
  /** PR 6c (opcional: backend antigo nao manda): meses de venda atipica fora da media do item ('AAAA-MM'). */
  mesesForaDaMedia?: string[];
}

/** Item sob demanda que entraria na lista de compra, mas fica fora dela (PR 6a). */
export interface ForecastItemSobDemanda {
  linha: number;
  n: number | null;
  productId: number | null;
  item: string;
  codigos: string[];
  fonte: string;
  status: ForecastStatus;
  /** Motivo cadastrado ao marcar; nulo = sem motivo (a tela mostra so o texto padrao). */
  motivo: string | null;
  demanda: number;
  quantidadeSugerida: number;
  estoque: number;
  chegadas: Array<{ anoMes: string; quantidade: number }>;
  programacoes: Array<{ anoMes: string; quantidade: number }>;
  programado: number;
  /** max(0, programacoes - estoque - chegadas). */
  programacaoDescoberta: number;
  obs?: string;
  /** PR 6c (opcional: backend antigo nao manda): meses de venda atipica fora da media do item ('AAAA-MM'). */
  mesesForaDaMedia?: string[];
}

export interface ForecastRelatorioCompras {
  quinzena: { id: number; label: string; baseDate: string; half: number; origin: string; hoje: string };
  totais: {
    itens: number;
    fontes: number;
    vencidas: number;
    semEmbalagem: number;
    multiplasEmbalagens: number;
    /** PR 6e (opcional: backend antigo nao manda): itens com pallet cadastrado em alguma embalagem. */
    comPallet?: number;
    porUrgencia?: Record<ForecastUrgencia, number>;
  };
  fora: {
    semLeadTime: number;
    semConsumoSemFalta: number;
    semConsumoSemMovimento?: number;
    /** PR 6a (opcional: backend antigo nao manda): itens que entrariam na lista mas sao compra sob demanda. */
    sobDemanda?: number;
  };
  urgencia?: { diasCritico: number };
  semConsumo?: { itens: ForecastItemSemConsumo[] };
  /** PR 6a (opcional: backend antigo nao manda). */
  sobDemanda?: { itens: ForecastItemSobDemanda[] };
  grupos: ForecastGrupoRelatorio[];
}

export async function getForecastRelatorioCompras(id: number): Promise<ForecastRelatorioCompras> {
  const response = await api.get<{ data: ForecastRelatorioCompras }>(
    `/v1/forecast/snapshots/${id}/relatorio-compras`,
  );
  return response.data;
}

export const FORECAST_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Baixa o XLSX do relatorio de compras (JSON base64 -> Blob -> <a download>, como downloadSupplierDocument).
 * `hoje` e o da tela (quinzena.hoje): o arquivo sai igual ao que esta exibido.
 */
export async function baixarForecastRelatorioXlsx(id: number, hoje: string): Promise<{ fileName: string }> {
  const response = await api.get<{ data: { fileName: string; contentBase64: string } }>(
    `/v1/forecast/snapshots/${id}/relatorio-compras/xlsx`,
    { hoje },
  );
  const { fileName, contentBase64 } = response.data;
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: FORECAST_XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return { fileName };
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

/** Prazo (dias) das chegadas estimadas do FUP de UMA fonte: DATA PRONTIDAO + n e ETD + n (PR 5A). */
export interface ForecastPrazoEstimativaBody {
  sourceId: number;
  prontidaoDias: number;
  etdDias: number;
}

export type ForecastDbcorpBody = {
  label: string;
  baseDate: string;
  files: ForecastDbcorpFiles;
  /** Prazos por fonte (inteiros 0..365); ausente = o servidor usa o padrao salvo da fonte, senao 35. */
  prazosEstimativa?: ForecastPrazoEstimativaBody[];
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
  // FUP, regra F3 (backend antigo nao manda estes campos)
  regra?: {
    id: string;
    etaPorEtdDias: number;
    etaPorProntidaoDias: number;
    excluiEtaFinal: boolean;
    statusExcluidos: string[];
    /** O prazo de cada fonte vale no lugar dos dias acima, que passam a ser o padrao (backend com PR 5A). */
    prazoPorFonte?: boolean;
  };
  estimadasPorProntidao?: ForecastLinhasKg;
  excluidas?: {
    atracadas: ForecastLinhasKg;
    etaFinalPreenchida: ForecastLinhasKg & {
      porStatus: Array<{ status: string; linhas: number; kg: number }>;
      depoisDaDataBase: ForecastLinhasKg;
    };
  };
  prontidaoNaoReconhecida?: ForecastLinhasKg & {
    detalhes: Array<{ linha: number; status: string; codigo: string; kg: number; texto: string }>;
    omitidos: number;
  };
}

export interface ForecastPrazoChegada {
  prontidaoDias: number;
  etdDias: number;
}

/** Tabela do prazo por fonte (so fontes com linha estimada). */
export interface ForecastPrazosEstimativa {
  padrao: ForecastPrazoChegada;
  fontes: Array<{
    sourceId: number;
    nome: string;
    /** Padrao salvo na fonte (`null` = nunca salvo: usa o padrao). */
    salvo: { prontidaoDias: number | null; etdDias: number | null };
    /** Prazo que esta pre-visualizacao usou. */
    usado: ForecastPrazoChegada;
    prontidao: ForecastLinhasKg;
    etd: ForecastLinhasKg;
  }>;
  /** Codigo sem produto ativo ou produto sem fonte: usa o padrao, nao editavel. */
  semFonte: { prontidao: ForecastLinhasKg; etd: ForecastLinhasKg };
  /** Fontes cujo prazo usado vira o novo padrao salvo no confirm. */
  padroesAlterados: number;
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
  /** Codigos do DBCorp fora do cadastro (PR 3B); ausente/null em backend antigo ou sem quinzena montada. */
  pendentes?: ForecastPendentesResumo | null;
  /** Prazo por fonte (PR 5A); ausente/null em backend antigo ou com erro de leitura: a tabela nao aparece. */
  prazosEstimativa?: ForecastPrazosEstimativa | null;
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
