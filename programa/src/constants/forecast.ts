// Limites, nomes de aba e mensagens da importacao da planilha de Forecast (PO.COMP.01).

// A planilha viaja em base64 dentro do JSON; o corpo inteiro (planilha + metadados) fica
// limitado a 10MB no parser de /api/v1/forecast/import (src/app.ts). Cloud Run aceita ate 32MB.
export const FORECAST_JSON_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

// Tamanho maximo da string base64 aceita pelo validator (rejeita com 400 antes de decodificar):
// o limite do corpo menos folga para os demais campos do JSON.
export const FORECAST_BASE64_MAX_LENGTH = FORECAST_JSON_BODY_LIMIT_BYTES - 64 * 1024;

export const FORECAST_TOO_LARGE_MESSAGE =
  'O envio excede o limite de 10MB (incluindo a codificacao base64).';

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

// Origem das quinzenas (ForecastSnapshot.origin).
export const FORECAST_ORIGIN_WORKBOOK = 'planilha';
export const FORECAST_ORIGIN_DBCORP = 'dbcorp';

// --- Quinzena a partir dos relatorios DBCorp (estoque D2, decidida pelo Lucas em 2026-10-21; FUP F3, 2026-10-22) ---
// Comparacao de texto (deposito, empresa, status) sempre normalizada: sem acento, espacos
// colapsados, trim, maiusculas.

// Estoque = SALDO desta empresa.
export const FORECAST_DBCORP_SALDO_EMPRESA = 'SQ QUIMICA';

// Depositos que NAO contam como estoque (nota da aba ESTOQUE do Comex). LAB - AMOSTRA aparece como
// LABORATORIO - AMOSTRA no DS9004: as duas grafias entram; comparacao normalizada.
export const FORECAST_DBCORP_DEPOSITOS_EXCLUIDOS = [
  'AMOSTRA',
  'CMC',
  'CORREÇÃO',
  'LAB - AMOSTRA',
  'LABORATORIO - AMOSTRA',
  'PRODUCAO',
  'QUALIDADE',
  'QUALIDADE SUL',
  'REFUGO',
  'SEPARAÇÃO',
] as const;

// Rotulo do preview para saldo sem deposito (no relatorio vem vazio ou so espacos).
export const FORECAST_DBCORP_SEM_DEPOSITO = '(sem deposito)';

// PROGRAMACAO: so este status entra.
export const FORECAST_DBCORP_PROGRAMACAO_STATUS = 'Pendente';

// FUP: este status (com ou sem acento) nao entra.
export const FORECAST_DBCORP_FUP_STATUS_IGNORADO = 'CONCLUÍDO';

// FUP, regra F3 (decidida pelo Lucas em 2026-10-22; revoga a parte da D2 que incluia as atracadas e usava
// ETA FINAL como data): atracada aguardando liberacao NAO entra (a carga ja pode estar no estoque) e linha
// com ETA FINAL preenchida NAO entra (ja chegou). Comparacao de status normalizada.
export const FORECAST_DBCORP_FUP_REGRA = 'F3';
export const FORECAST_DBCORP_FUP_STATUS_EXCLUIDOS = ['ATRAC. AG. LIBERAÇÃO'] as const;
export const FORECAST_DBCORP_FUP_EXCLUI_ETA_FINAL = true;

// FUP sem ETA (CHEGADA): chegada estimada = ETD (EMBARQUE) + N dias.
export const FORECAST_DBCORP_ETA_POR_ETD_DIAS = 35;

// FUP sem ETA (CHEGADA) nem ETD (EMBARQUE): chegada estimada = DATA PRONTIDAO + N dias. Configuravel aqui;
// 35 ficou mais perto da planilha que 65 na analise de 2026-10-22.
export const FORECAST_DBCORP_ETA_POR_PRONTIDAO_DIAS = 35;

// Colunas do FUP que nao derrubam a importacao quando faltam (so geram aviso).
export const FORECAST_DBCORP_HEADERS_OPCIONAIS = { fup: ['DATA PO', 'DATA PRONTIDÃO'] } as const;

// Linhas detalhadas (prontidao nao reconhecida) devolvidas no resumo; a contagem total vai sempre.
export const FORECAST_DBCORP_MAX_DETALHES = 50;

// Janelas em meses a partir do mes base: PROGRAMACAO = AC..AF, chegadas = V..Z.
export const FORECAST_DBCORP_JANELA_PROGRAMACAO_MESES = 4;
export const FORECAST_DBCORP_JANELA_CHEGADA_MESES = 5;

// O cabecalho do relatorio e a primeira linha, entre as N primeiras, que traga todos os obrigatorios.
export const FORECAST_DBCORP_HEADER_SCAN_ROWS = 10;

// Relatorios enviados (um slot por arquivo). As 3 vendas sao o MESMO relatorio (DS9003) em periodos
// diferentes, escolhidos pelo usuario.
export const FORECAST_DBCORP_SLOTS = {
  saldo: 'SALDO',
  vendasMes: 'VENDAS do mes anterior',
  vendasAtual: 'VENDAS do mes atual (ate o dia 15)',
  vendasAnual: 'VENDAS anual',
  programacao: 'PROGRAMACAO',
  fup: 'FUP',
  clientesAtivos: 'CLIENTES ATIVOS',
  margem: 'MARGEM',
} as const;

export type ForecastDbcorpSlot = keyof typeof FORECAST_DBCORP_SLOTS;

// Cabecalhos obrigatorios por relatorio (grafia real; comparacao sem acento/caixa, com trim).
// MARGEM nao tem: e lida por posicao (A codigo, B margem, dados a partir da linha 2).
export const FORECAST_DBCORP_HEADERS = {
  saldo: ['Código', 'Depósito', 'Saldo Físico Disponível', 'Empresa'],
  vendas: ['Item', 'Quantidade', 'Empresa'],
  programacao: ['Status', 'Data Faturamento', 'Cód. Item', 'Qtde.'],
  fup: ['STATUS', 'CÓD. SQ', 'QTD - KGS', 'ETD (EMBARQUE)', 'ETA (CHEGADA)', 'ETA FINAL'],
  clientesAtivos: ['Código Item'],
} as const;
