// Parser da planilha de Forecast (.xlsx, PO.COMP.01). Porte de Forecast-prototipo/scripts/importar.ts
// (mesmas abas, linhas iniciais e colunas), a partir de um Buffer e devolvendo avisos/erros em vez de
// abortar. O parser nao toca em banco.
import exceljs from 'exceljs';
import {
  FORECAST_LABEL_PATTERN,
  FORECAST_MARGEM_LAST_ROW,
  FORECAST_MAX_PRODUCTS,
  FORECAST_MAX_SHEET_ROWS,
  FORECAST_OBS_MAX_CHARS,
  FORECAST_SHEETS,
  FORECAST_STATUS_COLORS,
} from '../constants/forecast';
import { HttpError } from './http';
import { anoMesDoRotulo, mesesHistorico } from './forecastMonths';
import { mesComoTexto, num, temFormula, txt, valor, type Bruto } from './forecastXlsx';
import type { Entradas, Lancamento, LancamentoMensal, Produto, Quinzena, StatusCompra } from './forecastTypes';
import { COLUNAS_CONFERIDAS } from './forecastTypes';
import { isValidDateKey } from './supplierDocumentDates';

// Chave de comparacao de produto: espacos colapsados, maiusculas.
export function normalizeProductName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toUpperCase();
}

// Chave de comparacao de fonte (chave do PROCV da planilha): trim + maiusculas.
export function normalizeSourceName(name: string): string {
  return name.trim().toUpperCase();
}

// Chave de comparacao de codigo DBCorp: trim + maiusculas.
export function normalizeProductCode(code: string): string {
  return code.trim().toUpperCase();
}

export interface ForecastWorkbookSource {
  name: string; // como na planilha
  normalizedName: string;
  readinessDays: number | null; // LEADTIME B..F
  holidaysDays: number | null;
  shippingDays: number | null;
  transitDays: number | null;
  clearanceDays: number | null;
  total: number | null; // LEADTIME G
}

export interface ParsedForecastWorkbook {
  quinzena: Quinzena;
  fontes: ForecastWorkbookSource[];
  // VENDAS MENSAL = relatorio completo do mes anterior (base-1), lido pelo cabecalho O2.
  vendasMensal: { yearMonth: string | null; linhas: Lancamento[] };
  avisos: string[];
  erros: string[];
}

export interface ParseForecastWorkbookOptions {
  label: string;
  baseDate: string; // YYYY-MM-DD
  fileName?: string;
}

const STATUS_COLORS: Record<string, StatusCompra> = FORECAST_STATUS_COLORS;

const MACRO_FIRST_ROW = 3;
const CODE_COLUMNS = ['B', 'C', 'D', 'E', 'F', 'G', 'H'];
const HISTORY_COLUMNS = ['J', 'K', 'L', 'M', 'N'];

function emptyEntradas(): Entradas {
  return {
    estoque: [],
    vendasMes: [],
    vendasAtual: [],
    vendasAnual: [],
    programacoes: [],
    chegadas: [],
    leadtime: [],
    margem: [],
    clientesAtivos: [],
  };
}

function emptyQuinzena(options: ParseForecastWorkbookOptions): Quinzena {
  return {
    id: options.label,
    arquivo: options.fileName ?? '',
    dataBase: options.baseDate,
    mesesConsumo: [],
    mesesChegada: [],
    mesesProgramacao: [],
    produtos: [],
    entradas: emptyEntradas(),
    esperado: {},
  };
}

function eachRow(ws: exceljs.Worksheet, start: number, f: (row: exceljs.Row) => void): void {
  for (let i = start; i <= ws.rowCount; i++) f(ws.getRow(i));
}

function intOrNull(v: Bruto): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

export async function parseForecastWorkbook(
  buffer: Buffer,
  options: ParseForecastWorkbookOptions,
): Promise<ParsedForecastWorkbook> {
  const avisos: string[] = [];
  const erros: string[] = [];
  const quinzena = emptyQuinzena(options);
  const result: ParsedForecastWorkbook = {
    quinzena,
    fontes: [],
    vendasMensal: { yearMonth: null, linhas: [] },
    avisos,
    erros,
  };

  if (!FORECAST_LABEL_PATTERN.test(options.label)) {
    erros.push('Rotulo da quinzena invalido (use o formato NN-q, ex.: 10-2).');
  }
  if (!isValidDateKey(options.baseDate)) {
    erros.push('Data base invalida (use AAAA-MM-DD).');
  }

  const workbook = new exceljs.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new HttpError(400, 'Arquivo invalido. Envie a planilha de Forecast em formato .xlsx.');
  }

  const sheets = {} as Record<keyof typeof FORECAST_SHEETS, exceljs.Worksheet>;
  for (const key of Object.keys(FORECAST_SHEETS) as Array<keyof typeof FORECAST_SHEETS>) {
    const name = FORECAST_SHEETS[key];
    const ws = workbook.getWorksheet(name);
    if (!ws) {
      erros.push(`Aba "${name}" nao encontrada.`);
      continue;
    }
    if (ws.rowCount > FORECAST_MAX_SHEET_ROWS) {
      erros.push(`Aba "${name}" tem linhas demais (limite de ${FORECAST_MAX_SHEET_ROWS}).`);
      continue;
    }
    sheets[key] = ws;
  }
  if (Object.keys(sheets).length !== Object.keys(FORECAST_SHEETS).length) {
    return result;
  }

  const macro = sheets.macro;
  const cab = (col: string) => txt(valor(macro.getCell(`${col}2`)));

  // --- FORECAST (MACRO): produtos + valores que o Excel calculou -------------------------------
  const produtos: Produto[] = [];
  const esperado: Quinzena['esperado'] = {};
  for (let r = MACRO_FIRST_ROW; r <= macro.rowCount; r++) {
    const c = (col: string) => macro.getCell(`${col}${r}`);
    // So linhas com formula em Q (a ultima linha da aba e um item sem calculo).
    const item = txt(valor(c('I'))).replace(/\s+/g, ' ').trim();
    if (!item || !temFormula(c('Q'))) continue;
    const fill = c('I').fill as exceljs.FillPattern | undefined;
    const argb = fill?.type === 'pattern' ? fill.fgColor?.argb : undefined;
    const n = valor(c('A'));
    const analise = valor(c('AO'));
    produtos.push({
      linha: r,
      n: typeof n === 'number' ? n : null,
      item,
      codigos: CODE_COLUMNS.map((k) => txt(valor(c(k)))),
      historico: HISTORY_COLUMNS.map((k) => num(valor(c(k)))),
      analiseForecast: typeof analise === 'number' ? analise : null,
      obs: txt(valor(c('AT'))).trim(),
      fonte: txt(valor(c('AU'))),
      precoFechado: txt(valor(c('AV'))).trim(),
      embalagem: txt(valor(c('AW'))).trim(),
      naoFraciona: txt(valor(c('AX'))).trim(),
      qtdAmostra: txt(valor(c('AY'))).trim(),
      solicitarAmostra: txt(valor(c('AZ'))).trim(),
      status: (argb && STATUS_COLORS[argb]) || 'nao',
    });
    const esp: Record<string, Bruto> = {};
    for (const col of COLUNAS_CONFERIDAS) esp[col] = valor(c(col));
    esperado[String(r)] = esp;
  }

  if (produtos.length === 0) {
    erros.push(`Nenhum produto encontrado na aba "${FORECAST_SHEETS.macro}".`);
  }
  if (produtos.length > FORECAST_MAX_PRODUCTS) {
    erros.push(`A planilha tem ${produtos.length} produtos (limite de ${FORECAST_MAX_PRODUCTS}).`);
  }

  // --- Abas de entrada -------------------------------------------------------------------------
  const lanc = (ws: exceljs.Worksheet, inicio: number, colCod: string, colQtd: string): Lancamento[] => {
    const out: Lancamento[] = [];
    eachRow(ws, inicio, (row) => {
      const codigo = txt(valor(row.getCell(colCod)));
      const q = valor(row.getCell(colQtd));
      if (codigo && typeof q === 'number') out.push({ codigo, qtd: q });
    });
    return out;
  };
  const lancMes = (
    ws: exceljs.Worksheet,
    inicio: number,
    colCod: string,
    colQtd: string,
    colMes: string,
  ): LancamentoMensal[] => {
    const out: LancamentoMensal[] = [];
    eachRow(ws, inicio, (row) => {
      const codigo = txt(valor(row.getCell(colCod)));
      const q = valor(row.getCell(colQtd));
      const mes = mesComoTexto(valor(row.getCell(colMes)));
      if (codigo && typeof q === 'number' && mes) out.push({ codigo, qtd: q, mes });
    });
    return out;
  };

  const entradas: Entradas = {
    estoque: lanc(sheets.estoque, 7, 'A', 'E'),
    vendasMes: lanc(sheets.vendasMes, 6, 'B', 'D'),
    vendasAtual: lanc(sheets.vendasAtual, 6, 'B', 'D'),
    vendasAnual: lanc(sheets.vendasAnual, 6, 'B', 'D'),
    programacoes: lancMes(sheets.programacoes, 7, 'A', 'D', 'I'),
    chegadas: lancMes(sheets.chegadas, 2, 'E', 'L', 'Z'),
    leadtime: [],
    margem: [],
    clientesAtivos: [],
  };

  const fontes: ForecastWorkbookSource[] = [];
  const fontesVistas = new Set<string>();
  eachRow(sheets.leadtime, 3, (row) => {
    const name = txt(valor(row.getCell('A')));
    const total = valor(row.getCell('G'));
    if (!name) return;
    entradas.leadtime.push({ fonte: name, total: typeof total === 'number' ? total : null });
    const normalizedName = normalizeSourceName(name);
    if (fontesVistas.has(normalizedName)) {
      avisos.push(`Fonte repetida na LEADTIME: "${name.trim()}" (vale a primeira ocorrencia).`);
      return;
    }
    fontesVistas.add(normalizedName);
    fontes.push({
      name: name.trim(),
      normalizedName,
      readinessDays: intOrNull(valor(row.getCell('B'))),
      holidaysDays: intOrNull(valor(row.getCell('C'))),
      shippingDays: intOrNull(valor(row.getCell('D'))),
      transitDays: intOrNull(valor(row.getCell('E'))),
      clearanceDays: intOrNull(valor(row.getCell('F'))),
      total: typeof total === 'number' ? Math.round(total) : null,
    });
  });

  eachRow(sheets.margem, 2, (row) => {
    if (row.number > FORECAST_MARGEM_LAST_ROW) return; // a formula da planilha olha MARGEM!A2:A413
    const codigo = txt(valor(row.getCell('A')));
    const m = valor(row.getCell('B'));
    if (codigo) entradas.margem.push({ codigo, margem: typeof m === 'number' ? m : null });
  });
  eachRow(sheets.clientesAtivos, 6, (row) => {
    const codigo = txt(valor(row.getCell('C')));
    if (codigo) entradas.clientesAtivos.push(codigo);
  });

  quinzena.mesesConsumo = ['J', 'K', 'L', 'M', 'N', 'O', 'P'].map(cab);
  quinzena.mesesChegada = ['V', 'W', 'X', 'Y', 'Z'].map(cab);
  quinzena.mesesProgramacao = ['AC', 'AD', 'AE', 'AF'].map(cab);
  quinzena.produtos = produtos;
  quinzena.entradas = entradas;
  quinzena.esperado = esperado;
  result.fontes = fontes;

  // --- Consistencia do cadastro ----------------------------------------------------------------
  const nomes = new Map<string, number>();
  const codigos = new Map<string, number>();
  for (const p of produtos) {
    if (p.obs.length > FORECAST_OBS_MAX_CHARS) {
      erros.push(`Observacao (coluna AT) da linha ${p.linha} tem ${p.obs.length} caracteres (limite de ${FORECAST_OBS_MAX_CHARS}).`);
    }
    const nome = normalizeProductName(p.item);
    const nomeAnterior = nomes.get(nome);
    if (nomeAnterior !== undefined) {
      erros.push(`Produto duplicado: "${p.item}" (linhas ${nomeAnterior} e ${p.linha}).`);
    } else {
      nomes.set(nome, p.linha);
    }
    for (const codigo of p.codigos) {
      if (!codigo.trim()) continue;
      const chave = normalizeProductCode(codigo);
      const linhaAnterior = codigos.get(chave);
      if (linhaAnterior !== undefined) {
        erros.push(
          linhaAnterior === p.linha
            ? `Codigo ${chave} repetido no mesmo produto (linha ${p.linha}).`
            : `Codigo ${chave} em 2 produtos (linhas ${linhaAnterior} e ${p.linha}).`,
        );
      } else {
        codigos.set(chave, p.linha);
      }
    }
  }

  const semLeadtime = new Set<string>();
  for (const p of produtos) {
    const fonte = p.fonte.trim();
    if (fonte && !fontesVistas.has(normalizeSourceName(fonte)) && !semLeadtime.has(normalizeSourceName(fonte))) {
      semLeadtime.add(normalizeSourceName(fonte));
      avisos.push(`Fonte "${fonte}" de produto nao consta na aba ${FORECAST_SHEETS.leadtime}.`);
    }
  }

  // --- Mes da VENDAS MENSAL --------------------------------------------------------------------
  let yearMonth: string | null = null;
  if (isValidDateKey(options.baseDate)) {
    try {
      yearMonth = anoMesDoRotulo(mesComoTexto(valor(macro.getCell('O2'))), options.baseDate);
    } catch {
      erros.push('Nao foi possivel identificar o mes da VENDAS MENSAL (cabecalho O2 da aba FORECAST (MACRO)).');
    }
    if (yearMonth !== null) {
      const esperadoMes = mesesHistorico(options.baseDate).anterior;
      if (yearMonth !== esperadoMes) {
        avisos.push(
          `O mes da VENDAS MENSAL (${yearMonth}) difere do mes anterior a data base (${esperadoMes}).`,
        );
      }
    }
  }
  result.vendasMensal = { yearMonth, linhas: entradas.vendasMes };

  return result;
}
