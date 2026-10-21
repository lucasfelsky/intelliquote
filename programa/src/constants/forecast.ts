// Limites, nomes de aba e mensagens da importacao da planilha de Forecast (PO.COMP.01).

// A planilha viaja em base64 dentro do JSON; o corpo inteiro (planilha + metadados) fica
// limitado a 10MB no parser de /api/v1/forecast/import (src/app.ts). Cloud Run aceita ate 32MB.
export const FORECAST_JSON_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

// Tamanho maximo da string base64 aceita pelo validator (rejeita com 400 antes de decodificar):
// o limite do corpo menos folga para os demais campos do JSON.
export const FORECAST_BASE64_MAX_LENGTH = FORECAST_JSON_BODY_LIMIT_BYTES - 64 * 1024;

export const FORECAST_TOO_LARGE_MESSAGE =
  'A planilha excede o limite de envio de 10MB (incluindo a codificacao base64).';

// Mais produtos que isso na aba FORECAST (MACRO) e tratado como planilha errada.
export const FORECAST_MAX_PRODUCTS = 500;

// Teto de linhas por aba (a maior aba real, CLIENTES ATIVOS, tem ~2.400).
export const FORECAST_MAX_SHEET_ROWS = 50_000;

// Quantidade maxima de divergencias devolvidas na conferencia (a contagem total vai sempre).
export const FORECAST_MAX_DIVERGENCES = 50;

// Quantidade maxima de avisos individuais (movimentacao de codigos etc.) antes de agrupar.
export const FORECAST_MAX_DETAIL_WARNINGS = 20;

// Ate 7 codigos por produto (EMB.1..EMB.7 = colunas B..H).
export const FORECAST_MAX_CODES_PER_PRODUCT = 7;

// Rotulo da quinzena: `NN-q` (mes + quinzena 1 ou 2), ex.: 10-2.
export const FORECAST_LABEL_PATTERN = /^\d{2}-[12]$/;

// Linhas de cabecalho/limite da aba MARGEM: a formula da planilha olha MARGEM!A2:A413.
export const FORECAST_MARGEM_LAST_ROW = 413;

export const FORECAST_SHEETS = {
  macro: 'FORECAST (MACRO)',
  estoque: 'ESTOQUE',
  vendasMes: 'VENDAS MENSAL',
  vendasAtual: 'VENDAS ATUAL (DIA 15)',
  vendasAnual: 'VENDAS ANUAL',
  programacoes: 'PROGRAMAÇÕES',
  chegadas: 'CHEGADAS',
  leadtime: 'LEADTIME',
  margem: 'MARGEM',
  clientesAtivos: 'CLIENTES ATIVOS',
} as const;

// Cor (ARGB) da celula do item na aba FORECAST (MACRO) -> status da compra.
export const FORECAST_STATUS_COLORS = {
  FF00B050: 'po',
  FFFFC000: 'confirmado',
  FFFFFF00: 'cotando',
  FF00B0F0: 'preco',
} as const;

// Opcoes do confirm da importacao da planilha.
export const FORECAST_ORIGIN_WORKBOOK = 'planilha';
