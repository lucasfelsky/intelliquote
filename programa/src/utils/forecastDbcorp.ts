// Parsers dos relatorios DBCorp (.xlsx) que alimentam uma quinzena do Forecast (estoque D2, decidida pelo
// Lucas em 2026-10-21; FUP regra F3, decidida em 2026-10-22). Recebem Buffer (+ data base quando a janela
// de meses importa), nao tocam em banco e devolvem avisos/erros em vez de abortar. Colunas sempre
// localizadas pelo cabecalho. As regras do FUP (F3, prontidao) vivem em forecastDbcorpRegras.ts (puro).
import exceljs from 'exceljs';
import {
  FORECAST_DBCORP_DEPOSITOS_EXCLUIDOS,
  FORECAST_DBCORP_HEADERS,
  FORECAST_DBCORP_HEADERS_OPCIONAIS,
  FORECAST_DBCORP_HEADER_SCAN_ROWS,
  FORECAST_DBCORP_JANELA_PROGRAMACAO_MESES,
  FORECAST_DBCORP_PROGRAMACAO_STATUS,
  FORECAST_DBCORP_SALDO_EMPRESA,
  FORECAST_DBCORP_SEM_DEPOSITO,
  FORECAST_DBCORP_SLOTS,
  FORECAST_MAX_SHEET_ROWS,
  type ForecastDbcorpSlot,
} from '../constants/forecast';
import { HttpError } from './http';
import { rotuloDoYearMonth, yearMonthsDaJanela } from './forecastMonths';
import { findHeaderColumn, txt, valor, type Bruto } from './forecastXlsx';
import { normalizeProductCode } from './forecastWorkbook';
import type { Lancamento, LancamentoMensal } from './forecastTypes';
import {
  Acumulador,
  aplicarRegrasFup,
  comprasEmAbertoDoFup,
  dateKeyDaCelula,
  normalizeDbcorpText,
  plural,
  round6,
  type DataDaCelula,
  type FupLinha,
  type LinhasKg,
  type ResultadoRegrasFup,
  type ResumoRelatorio,
} from './forecastDbcorpRegras';

// Movidos para forecastDbcorpRegras.ts (puro); reexportados porque testes e o harness importam daqui.
export { dateKeyDaCelula, normalizeDbcorpText };
export type { DataDaCelula, LinhasKg, ResumoRelatorio };

// --- Tipos -----------------------------------------------------------------------------------------

export interface DepositoResumo {
  deposito: string;
  incluido: boolean;
  linhas: number;
  saldo: number;
}

export interface ParsedSaldo extends ResumoRelatorio {
  linhas: Lancamento[];
  porDeposito: DepositoResumo[];
  outrasEmpresas: Array<{ empresa: string; linhas: number; saldo: number }>;
}

export interface ParsedVendas extends ResumoRelatorio {
  linhas: Lancamento[];
  empresas: string[];
}

export interface ParsedProgramacao extends ResumoRelatorio {
  linhas: LancamentoMensal[];
  foraDaJanela: { antes: number; depois: number };
  porStatus: Array<{ status: string; incluido: boolean; linhas: number; qtd: number }>;
}

// Resultado das regras do FUP (forecastDbcorpRegras.ts) + os erros de leitura da planilha.
export type ParsedFup = ResultadoRegrasFup & Pick<ResumoRelatorio, 'erros'> & { comprasEmAberto: Lancamento[] };

export interface ParsedClientesAtivos extends ResumoRelatorio {
  linhas: string[];
}

export interface ParsedMargem extends ResumoRelatorio {
  linhas: Array<{ codigo: string; margem: number | null }>;
}

// --- Helpers ---------------------------------------------------------------------------------------

const isBlank = (b: Bruto): boolean => b === null || (typeof b === 'string' && b.trim() === '');

const isQtd = (b: Bruto): b is number => typeof b === 'number' && Number.isFinite(b);

type Aba = { ws: exceljs.Worksheet; erro: null } | { ws: null; erro: string };

async function carregarAba(buffer: Buffer, slot: ForecastDbcorpSlot): Promise<Aba> {
  const rotulo = FORECAST_DBCORP_SLOTS[slot];
  const workbook = new exceljs.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new HttpError(400, `Arquivo do relatorio ${rotulo} invalido (envie .xlsx).`);
  }
  const ws = workbook.worksheets[0];
  if (!ws) {
    throw new HttpError(400, `Arquivo do relatorio ${rotulo} invalido (envie .xlsx).`);
  }
  if (ws.rowCount > FORECAST_MAX_SHEET_ROWS) {
    return {
      ws: null,
      erro: `Relatorio ${rotulo}: linhas demais (limite de ${FORECAST_MAX_SHEET_ROWS}).`,
    };
  }
  return { ws, erro: null };
}

type Cabecalho =
  | { ok: true; linha: number; colunas: number[] }
  | { ok: false; erros: string[] };

// Primeira linha, entre as primeiras N, que contem TODOS os cabecalhos. Sem ela, um erro por coluna
// faltante da linha que mais se aproxima.
function localizarCabecalho(
  ws: exceljs.Worksheet,
  slot: ForecastDbcorpSlot,
  headers: readonly string[],
): Cabecalho {
  const limite = Math.min(FORECAST_DBCORP_HEADER_SCAN_ROWS, ws.rowCount);
  let melhor: { achadas: number; faltantes: string[] } | null = null;
  for (let r = 1; r <= limite; r++) {
    const row = ws.getRow(r);
    const colunas: number[] = [];
    const faltantes: string[] = [];
    for (const header of headers) {
      const coluna = findHeaderColumn(row, [header]);
      if (coluna === null) faltantes.push(header);
      else colunas.push(coluna);
    }
    if (faltantes.length === 0) return { ok: true, linha: r, colunas };
    if (melhor === null || colunas.length > melhor.achadas) {
      melhor = { achadas: colunas.length, faltantes };
    }
  }
  const faltantes = melhor?.faltantes ?? [...headers];
  return {
    ok: false,
    erros: faltantes.map(
      (h) =>
        `Relatorio ${FORECAST_DBCORP_SLOTS[slot]}: coluna "${h}" nao encontrada nas ${FORECAST_DBCORP_HEADER_SCAN_ROWS} primeiras linhas.`,
    ),
  };
}

function semLinhas(erros: string[]): ResumoRelatorio {
  return new Acumulador().resumo([], erros);
}

// --- SALDO (DS9004) --------------------------------------------------------------------------------

const DEPOSITOS_EXCLUIDOS = new Set(FORECAST_DBCORP_DEPOSITOS_EXCLUIDOS.map(normalizeDbcorpText));
const EMPRESA_SALDO = normalizeDbcorpText(FORECAST_DBCORP_SALDO_EMPRESA);

export async function parseSaldo(buffer: Buffer): Promise<ParsedSaldo> {
  const vazio = (erros: string[]): ParsedSaldo => ({
    ...semLinhas(erros),
    linhas: [],
    porDeposito: [],
    outrasEmpresas: [],
  });
  const aba = await carregarAba(buffer, 'saldo');
  if (aba.ws === null) return vazio([aba.erro]);
  const ws = aba.ws;
  const cab = localizarCabecalho(ws, 'saldo', FORECAST_DBCORP_HEADERS.saldo);
  if (!cab.ok) return vazio(cab.erros);
  const [cCodigo, cDeposito, cSaldo, cEmpresa] = cab.colunas;

  const acc = new Acumulador();
  const linhas: Lancamento[] = [];
  const depositos = new Map<string, DepositoResumo>();
  const empresas = new Map<string, { empresa: string; linhas: number; saldo: number }>();

  for (let r = cab.linha + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const bCodigo = valor(row.getCell(cCodigo));
    const bDeposito = valor(row.getCell(cDeposito));
    const bSaldo = valor(row.getCell(cSaldo));
    const bEmpresa = valor(row.getCell(cEmpresa));
    if ([bCodigo, bDeposito, bSaldo, bEmpresa].every(isBlank)) continue;

    const codigo = normalizeProductCode(txt(bCodigo));
    if (!codigo) {
      acc.ignorar('sem codigo');
      continue;
    }
    if (!isQtd(bSaldo)) {
      acc.ignorar('quantidade nao numerica');
      continue;
    }
    const empresa = normalizeDbcorpText(txt(bEmpresa));
    if (empresa !== EMPRESA_SALDO) {
      const entry = empresas.get(empresa) ?? { empresa: empresa || '(sem empresa)', linhas: 0, saldo: 0 };
      entry.linhas++;
      entry.saldo += bSaldo;
      empresas.set(empresa, entry);
      acc.ignorar('outra empresa');
      continue;
    }

    const deposito = normalizeDbcorpText(txt(bDeposito)) || FORECAST_DBCORP_SEM_DEPOSITO;
    const incluido = !DEPOSITOS_EXCLUIDOS.has(deposito);
    const entry = depositos.get(deposito) ?? { deposito, incluido, linhas: 0, saldo: 0 };
    entry.linhas++;
    entry.saldo += bSaldo;
    depositos.set(deposito, entry);
    if (!incluido) {
      acc.ignorar('deposito excluido');
      continue;
    }
    linhas.push({ codigo, qtd: bSaldo });
    acc.usar(bSaldo);
  }

  const avisos: string[] = [];
  if (acc.usadas === 0) {
    avisos.push(
      `Relatorio ${FORECAST_DBCORP_SLOTS.saldo} sem saldo valido da empresa ${FORECAST_DBCORP_SALDO_EMPRESA}.`,
    );
  }
  const porDeposito = [...depositos.values()]
    .map((d) => ({ ...d, saldo: round6(d.saldo) }))
    .sort(
      (a, b) =>
        Number(b.incluido) - Number(a.incluido) || b.saldo - a.saldo || a.deposito.localeCompare(b.deposito),
    );
  const outrasEmpresas = [...empresas.values()]
    .map((e) => ({ ...e, saldo: round6(e.saldo) }))
    .sort((a, b) => b.linhas - a.linhas || a.empresa.localeCompare(b.empresa));
  return { ...acc.resumo(avisos, []), linhas, porDeposito, outrasEmpresas };
}

// --- VENDAS (DS9003): o mesmo relatorio em 3 slots -------------------------------------------------

export async function parseVendas(
  buffer: Buffer,
  slot: 'vendasMes' | 'vendasAtual' | 'vendasAnual',
): Promise<ParsedVendas> {
  const rotulo = FORECAST_DBCORP_SLOTS[slot];
  const vazio = (erros: string[]): ParsedVendas => ({ ...semLinhas(erros), linhas: [], empresas: [] });
  const aba = await carregarAba(buffer, slot);
  if (aba.ws === null) return vazio([aba.erro]);
  const ws = aba.ws;
  const cab = localizarCabecalho(ws, slot, FORECAST_DBCORP_HEADERS.vendas);
  if (!cab.ok) return vazio(cab.erros);
  const [cCodigo, cQtd, cEmpresa] = cab.colunas;

  const acc = new Acumulador();
  const linhas: Lancamento[] = [];
  const empresas = new Set<string>();
  for (let r = cab.linha + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const bCodigo = valor(row.getCell(cCodigo));
    const bQtd = valor(row.getCell(cQtd));
    const bEmpresa = valor(row.getCell(cEmpresa));
    if ([bCodigo, bQtd, bEmpresa].every(isBlank)) continue;

    const codigo = normalizeProductCode(txt(bCodigo));
    if (!codigo) {
      acc.ignorar('sem codigo'); // inclui o rodape "Soma = ..."
      continue;
    }
    if (!isQtd(bQtd)) {
      acc.ignorar('quantidade nao numerica');
      continue;
    }
    const empresa = normalizeDbcorpText(txt(bEmpresa));
    if (empresa) empresas.add(empresa);
    linhas.push({ codigo, qtd: bQtd });
    acc.usar(bQtd);
  }

  const avisos: string[] = [];
  const erros: string[] = [];
  const empresasOrdenadas = [...empresas].sort();
  if (empresasOrdenadas.length > 1) {
    avisos.push(
      `Relatorio ${rotulo} traz mais de uma empresa (${empresasOrdenadas.join(', ')}); todas foram somadas.`,
    );
  }
  if (acc.usadas === 0) {
    if (slot === 'vendasMes') {
      erros.push('Relatorio de vendas do mes anterior sem linhas validas.');
    } else {
      avisos.push(`Relatorio ${rotulo} sem linhas validas.`);
    }
  }
  return { ...acc.resumo(avisos, erros), linhas, empresas: empresasOrdenadas };
}

// --- PROGRAMACAO -----------------------------------------------------------------------------------

export async function parseProgramacao(buffer: Buffer, baseDate: string): Promise<ParsedProgramacao> {
  const vazio = (erros: string[]): ParsedProgramacao => ({
    ...semLinhas(erros),
    linhas: [],
    foraDaJanela: { antes: 0, depois: 0 },
    porStatus: [],
  });
  const aba = await carregarAba(buffer, 'programacao');
  if (aba.ws === null) return vazio([aba.erro]);
  const ws = aba.ws;
  const cab = localizarCabecalho(ws, 'programacao', FORECAST_DBCORP_HEADERS.programacao);
  if (!cab.ok) return vazio(cab.erros);
  const [cStatus, cData, cCodigo, cQtd] = cab.colunas;

  const janela = yearMonthsDaJanela(baseDate, FORECAST_DBCORP_JANELA_PROGRAMACAO_MESES);
  const statusAceito = normalizeDbcorpText(FORECAST_DBCORP_PROGRAMACAO_STATUS);
  const acc = new Acumulador();
  const linhas: LancamentoMensal[] = [];
  const foraDaJanela = { antes: 0, depois: 0 };
  const status = new Map<string, { status: string; incluido: boolean; linhas: number; qtd: number }>();

  for (let r = cab.linha + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const bStatus = valor(row.getCell(cStatus));
    const bData = valor(row.getCell(cData));
    const bCodigo = valor(row.getCell(cCodigo));
    const bQtd = valor(row.getCell(cQtd));
    if ([bStatus, bData, bCodigo, bQtd].every(isBlank)) continue;

    const codigo = normalizeProductCode(txt(bCodigo));
    if (!codigo) {
      acc.ignorar('sem codigo');
      continue;
    }
    if (!isQtd(bQtd)) {
      acc.ignorar('quantidade nao numerica');
      continue;
    }
    const nomeStatus = normalizeDbcorpText(txt(bStatus)) || '(sem status)';
    const incluido = nomeStatus === statusAceito;
    const entry = status.get(nomeStatus) ?? { status: nomeStatus, incluido, linhas: 0, qtd: 0 };
    entry.linhas++;
    entry.qtd += bQtd;
    status.set(nomeStatus, entry);
    if (!incluido) {
      acc.ignorar(`status diferente de ${FORECAST_DBCORP_PROGRAMACAO_STATUS}`);
      continue;
    }

    const data = dateKeyDaCelula(bData);
    if (data.tipo !== 'data') {
      acc.ignorar('sem data de faturamento valida');
      continue;
    }
    // Compara 'YYYY-MM' inteiro: o motor casa so pelo MM, entao 12 meses a frente nao pode entrar.
    const yearMonth = data.key.slice(0, 7);
    if (yearMonth < janela[0]) {
      foraDaJanela.antes++;
      acc.ignorar('fora da janela (antes do mes base)');
      continue;
    }
    if (yearMonth > janela[janela.length - 1]) {
      foraDaJanela.depois++;
      acc.ignorar('fora da janela (depois dos 4 meses)');
      continue;
    }
    linhas.push({ codigo, qtd: bQtd, mes: rotuloDoYearMonth(yearMonth) });
    acc.usar(bQtd);
  }

  const avisos: string[] = [];
  if (foraDaJanela.antes > 0 || foraDaJanela.depois > 0) {
    avisos.push(
      `PROGRAMACAO: ${foraDaJanela.antes} ${plural(foraDaJanela.antes, 'linha pendente', 'linhas pendentes')} com faturamento antes do mes base e ${foraDaJanela.depois} depois da janela de ${FORECAST_DBCORP_JANELA_PROGRAMACAO_MESES} meses foram ignoradas.`,
    );
  }
  const semData = acc.ignoradas['sem data de faturamento valida'] ?? 0;
  if (semData > 0) {
    avisos.push(`PROGRAMACAO: ${semData} ${plural(semData, 'linha pendente', 'linhas pendentes')} sem Data Faturamento valida foram ignoradas.`);
  }
  const porStatus = [...status.values()]
    .map((s) => ({ ...s, qtd: round6(s.qtd) }))
    .sort((a, b) => Number(b.incluido) - Number(a.incluido) || b.linhas - a.linhas || a.status.localeCompare(b.status));
  return { ...acc.resumo(avisos, []), linhas, foraDaJanela, porStatus };
}

// --- FUP (chegadas) --------------------------------------------------------------------------------

// Colunas opcionais do FUP, na MESMA linha do cabecalho: sem elas a linha cai em "sem data" (com aviso).
const [HEADER_DATA_PO, HEADER_PRONTIDAO] = FORECAST_DBCORP_HEADERS_OPCIONAIS.fup;

export async function parseFup(buffer: Buffer, baseDate: string): Promise<ParsedFup> {
  const aba = await carregarAba(buffer, 'fup');
  if (aba.ws === null) return semLinhasFup(baseDate, [aba.erro]);
  const ws = aba.ws;
  const cab = localizarCabecalho(ws, 'fup', FORECAST_DBCORP_HEADERS.fup);
  if (!cab.ok) return semLinhasFup(baseDate, cab.erros);
  const [cStatus, cCodigo, cKg, cEtd, cEta, cEtaFinal] = cab.colunas;
  const cabecalho = ws.getRow(cab.linha);
  const cDataPo = findHeaderColumn(cabecalho, [HEADER_DATA_PO]);
  const cProntidao = findHeaderColumn(cabecalho, [HEADER_PRONTIDAO]);

  const linhasFup: FupLinha[] = [];
  for (let r = cab.linha + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const bStatus = valor(row.getCell(cStatus));
    const bCodigo = valor(row.getCell(cCodigo));
    const bKg = valor(row.getCell(cKg));
    const bEtd = valor(row.getCell(cEtd));
    const bEta = valor(row.getCell(cEta));
    const bEtaFinal = valor(row.getCell(cEtaFinal));
    const bDataPo = cDataPo === null ? null : valor(row.getCell(cDataPo));
    const bProntidao = cProntidao === null ? null : valor(row.getCell(cProntidao));
    if ([bStatus, bCodigo, bKg, bEtd, bEta, bEtaFinal, bDataPo, bProntidao].every(isBlank)) continue;
    linhasFup.push({
      linha: r,
      status: txt(bStatus),
      codigo: normalizeProductCode(txt(bCodigo)),
      kg: isQtd(bKg) ? bKg : null,
      dataPo: dateKeyDaCelula(bDataPo),
      prontidao: txt(bProntidao).trim(),
      etd: dateKeyDaCelula(bEtd),
      eta: dateKeyDaCelula(bEta),
      etaFinal: dateKeyDaCelula(bEtaFinal),
    });
  }

  const resultado = aplicarRegrasFup(linhasFup, baseDate);
  const avisosColuna: string[] = [];
  if (cProntidao === null) {
    avisosColuna.push(
      `FUP: coluna "${HEADER_PRONTIDAO}" não encontrada - linhas sem ETA nem ETD ficam de fora.`,
    );
  }
  if (cDataPo === null) {
    avisosColuna.push(`FUP: coluna "${HEADER_DATA_PO}" não encontrada - o ano da ${HEADER_PRONTIDAO} usa a data base.`);
  }
  return {
    ...resultado,
    avisos: [...avisosColuna, ...resultado.avisos],
    erros: [],
    comprasEmAberto: comprasEmAbertoDoFup(linhasFup),
  };
}

// FUP que nao pode ser lido (aba grande demais, cabecalho incompleto): sem linhas e com o(s) erro(s).
function semLinhasFup(baseDate: string, erros: string[]): ParsedFup {
  return { ...aplicarRegrasFup([], baseDate), erros, comprasEmAberto: [] };
}

// --- CLIENTES ATIVOS (DS9002), opcional ------------------------------------------------------------

export async function parseClientesAtivos(buffer: Buffer): Promise<ParsedClientesAtivos> {
  const aba = await carregarAba(buffer, 'clientesAtivos');
  if (aba.ws === null) return { ...semLinhas([aba.erro]), linhas: [] };
  const ws = aba.ws;
  const cab = localizarCabecalho(ws, 'clientesAtivos', FORECAST_DBCORP_HEADERS.clientesAtivos);
  if (!cab.ok) return { ...semLinhas(cab.erros), linhas: [] };
  const [cCodigo] = cab.colunas;

  const acc = new Acumulador();
  const linhas: string[] = [];
  for (let r = cab.linha + 1; r <= ws.rowCount; r++) {
    const codigo = normalizeProductCode(txt(valor(ws.getRow(r).getCell(cCodigo))));
    if (!codigo) continue;
    linhas.push(codigo); // 1 linha = 1 cliente ativo do codigo
    acc.usar(1);
  }
  return { ...acc.resumo([], []), linhas };
}

// --- MARGEM, opcional (layout da aba MARGEM: A codigo, B margem, dados a partir da linha 2) --------

export async function parseMargem(buffer: Buffer): Promise<ParsedMargem> {
  const aba = await carregarAba(buffer, 'margem');
  if (aba.ws === null) return { ...semLinhas([aba.erro]), linhas: [] };
  const ws = aba.ws;

  const acc = new Acumulador();
  const linhas: Array<{ codigo: string; margem: number | null }> = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const bCodigo = valor(row.getCell(1));
    const bMargem = valor(row.getCell(2));
    if (isBlank(bCodigo) && isBlank(bMargem)) continue;
    const codigo = normalizeProductCode(txt(bCodigo));
    if (!codigo) {
      acc.ignorar('sem codigo');
      continue;
    }
    linhas.push({ codigo, margem: isQtd(bMargem) ? bMargem : null });
    acc.usar(1);
  }
  return { ...acc.resumo([], []), linhas };
}
