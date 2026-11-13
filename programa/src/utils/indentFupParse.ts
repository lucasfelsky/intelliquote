// Leitura da FUP Importacao Indent (aba de vendas + aba DASH): funcoes de IO sobre o exceljs, sem banco e sem console.
// Colunas localizadas por CABECALHO (nunca por posicao fixa). As colunas de comissao 33-36 (pagamento, invoice,
// representante, status) NAO sao lidas; so o SUBTOTAL COMISSAO (col 14) e lido, e apenas para conferir totais com o DASH.
// O repositorio e PUBLICO: nenhum dado real da planilha entra em codigo ou teste.
import ExcelJS from 'exceljs';
import { type Bruto, normalizeHeader, num, temFormula, txt, valor } from './forecastXlsx';

export const ABA_VENDAS = 'INDENT SALES';
export const ABA_DASH = 'DASH';

/** Linha da planilha de vendas, valores "como o Excel mostra" (datas ja em YYYY-MM-DD pelas partes UTC). */
export interface FupRow {
  linha: number;
  fornecedor: string;
  cliente: string;
  importador: string;
  po: string;
  refCliente: string;
  dataPo: Bruto;
  produto: string;
  ncm: Bruto;
  quantidade: Bruto;
  precoFornecedor: Bruto;
  precoCliente: Bruto;
  subtotal: Bruto;
  /** Resultado gravado de SUBTOTAL COMISSAO. Uso exclusivo: somar por mes para a reconciliacao com o DASH. */
  comissaoSubtotal: Bruto;
  /** Texto da formula do SUBTOTAL (sem `=`), ou null quando e valor fixo. */
  subtotalFormula: string | null;
  /** Campos cuja celula e formula SEM resultado gravado (o exceljs devolve 0). */
  formulaSemResultado: string[];
  incoterm: string;
  commercialInvoice: string;
  aprovDocs: string;
  coa: string;
  hbl: string;
  tracking: string;
  origem: string;
  destino: string;
  navio: string;
  closing: Bruto;
  etd: Bruto;
  eta: Bruto;
  status: string;
  followUp: string;
  extra: string;
  pagamento: string;
  dueDate: Bruto;
  pagamentoFornecedor: string;
}

type Tipo = 'texto' | 'numero';
interface CampoSpec {
  campo: keyof Omit<FupRow, 'linha' | 'subtotalFormula' | 'formulaSemResultado'>;
  rotulos: string[];
  tipo: Tipo | 'bruto';
  obrigatorio: boolean;
}

// Rotulos sem acento/caixa e com espacos/quebras colapsados (ver chaveCabecalho).
const CAMPOS: CampoSpec[] = [
  { campo: 'fornecedor', rotulos: ['fornecedor'], tipo: 'texto', obrigatorio: true },
  { campo: 'cliente', rotulos: ['cliente'], tipo: 'texto', obrigatorio: true },
  { campo: 'importador', rotulos: ['importador'], tipo: 'texto', obrigatorio: false },
  { campo: 'po', rotulos: ['po'], tipo: 'texto', obrigatorio: true },
  { campo: 'refCliente', rotulos: ['ref cliente'], tipo: 'texto', obrigatorio: false },
  { campo: 'dataPo', rotulos: ['data po'], tipo: 'bruto', obrigatorio: true },
  { campo: 'produto', rotulos: ['produtos', 'produto'], tipo: 'texto', obrigatorio: true },
  { campo: 'ncm', rotulos: ['ncm'], tipo: 'bruto', obrigatorio: false },
  { campo: 'quantidade', rotulos: ['qtd - kgs'], tipo: 'bruto', obrigatorio: true },
  { campo: 'precoFornecedor', rotulos: ['preco (usd) fornece.'], tipo: 'bruto', obrigatorio: false },
  { campo: 'precoCliente', rotulos: ['preco (usd) cliente'], tipo: 'bruto', obrigatorio: false },
  { campo: 'subtotal', rotulos: ['subtotal'], tipo: 'bruto', obrigatorio: true },
  { campo: 'comissaoSubtotal', rotulos: ['subtotal comissao'], tipo: 'bruto', obrigatorio: true },
  { campo: 'incoterm', rotulos: ['incoterm'], tipo: 'texto', obrigatorio: false },
  { campo: 'commercialInvoice', rotulos: ['comercial invoice'], tipo: 'texto', obrigatorio: false },
  { campo: 'aprovDocs', rotulos: ['aprov. docs'], tipo: 'texto', obrigatorio: false },
  { campo: 'coa', rotulos: ['coa'], tipo: 'texto', obrigatorio: false },
  { campo: 'hbl', rotulos: ['hbl'], tipo: 'texto', obrigatorio: false },
  { campo: 'tracking', rotulos: ['tracking number'], tipo: 'texto', obrigatorio: false },
  { campo: 'origem', rotulos: ['origem pais'], tipo: 'texto', obrigatorio: false },
  { campo: 'destino', rotulos: ['destino'], tipo: 'texto', obrigatorio: false },
  { campo: 'navio', rotulos: ['navio'], tipo: 'texto', obrigatorio: false },
  { campo: 'closing', rotulos: ['closing date'], tipo: 'bruto', obrigatorio: false },
  { campo: 'etd', rotulos: ['etd'], tipo: 'bruto', obrigatorio: false },
  { campo: 'eta', rotulos: ['eta'], tipo: 'bruto', obrigatorio: false },
  { campo: 'status', rotulos: ['status'], tipo: 'texto', obrigatorio: false },
  { campo: 'followUp', rotulos: ['follow-up'], tipo: 'texto', obrigatorio: false },
  // `extra` = coluna SEM nome logo depois de FOLLOW-UP (resolvida a parte).
  { campo: 'pagamento', rotulos: ['payment terms'], tipo: 'texto', obrigatorio: false },
  { campo: 'dueDate', rotulos: ['due date'], tipo: 'bruto', obrigatorio: false },
  { campo: 'pagamentoFornecedor', rotulos: ['pagamento fornecedor'], tipo: 'texto', obrigatorio: false },
];

/** Cabecalho "como o Excel mostra", sem acento/caixa e com espacos e quebras de linha colapsados. */
export function chaveCabecalho(valorCelula: string): string {
  return normalizeHeader(valorCelula).replace(/\s+/g, ' ').trim();
}

export interface PerfilColuna {
  campo: string;
  coluna: number;
  /** Cabecalho com quebras de linha trocadas por espaco (vazio na coluna sem nome). */
  cabecalho: string;
  total: number;
  vazios: number;
  numeros: number;
  textos: number;
  datas: number;
  formulas: number;
  formulasSemResultado: number;
}

export interface FupLida {
  linhas: FupRow[];
  perfil: PerfilColuna[];
  /** Linhas de dados totalmente vazias (ignoradas). */
  linhasVaziasIgnoradas: number;
  /** Colunas obrigatorias ausentes no cabecalho (leitura falha). */
  colunasAusentes: string[];
}

function vazia(v: Bruto): boolean {
  return v === null || (typeof v === 'string' && v.trim() === '');
}

function ehData(cell: ExcelJS.Cell): boolean {
  const v = cell.value as unknown;
  if (v instanceof Date) return true;
  return typeof v === 'object' && v !== null && 'result' in v && (v as { result: unknown }).result instanceof Date;
}

function semResultado(cell: ExcelJS.Cell): boolean {
  if (!temFormula(cell)) return false;
  return (cell.value as unknown as { result?: unknown }).result === undefined;
}

function textoDaFormula(cell: ExcelJS.Cell): string | null {
  if (!temFormula(cell)) return null;
  try {
    const f = cell.formula;
    return typeof f === 'string' && f !== '' ? f.replace(/^=/, '') : null;
  } catch {
    return null;
  }
}

function acharLinhaCabecalho(ws: ExcelJS.Worksheet): number | null {
  const limite = Math.min(ws.rowCount, 10);
  for (let r = 1; r <= limite; r += 1) {
    const row = ws.getRow(r);
    const chaves = new Set<string>();
    for (let c = 1; c <= row.cellCount; c += 1) chaves.add(chaveCabecalho(txt(valor(row.getCell(c)))));
    if (chaves.has('fornecedor') && chaves.has('po') && chaves.has('data po')) return r;
  }
  return null;
}

/** Le a aba de vendas. Colunas 33-36 (comissao/representante) nunca sao tocadas. */
export function lerVendas(ws: ExcelJS.Worksheet): FupLida {
  const vazioRetorno = (colunasAusentes: string[]): FupLida => ({
    linhas: [],
    perfil: [],
    linhasVaziasIgnoradas: 0,
    colunasAusentes,
  });
  const linhaCab = acharLinhaCabecalho(ws);
  if (linhaCab === null) return vazioRetorno(['cabecalho']);

  const cab = ws.getRow(linhaCab);
  const colunaPorChave = new Map<string, number>();
  for (let c = 1; c <= cab.cellCount; c += 1) {
    const chave = chaveCabecalho(txt(valor(cab.getCell(c))));
    if (chave !== '' && !colunaPorChave.has(chave)) colunaPorChave.set(chave, c);
  }

  const colunas = new Map<string, number>();
  const ausentes: string[] = [];
  for (const spec of CAMPOS) {
    const col = spec.rotulos.map((r) => colunaPorChave.get(r)).find((c) => c !== undefined);
    if (col === undefined) {
      if (spec.obrigatorio) ausentes.push(spec.rotulos[0]);
    } else {
      colunas.set(spec.campo, col);
    }
  }
  // Coluna sem nome logo depois de FOLLOW-UP.
  const colFollow = colunas.get('followUp');
  if (colFollow !== undefined && chaveCabecalho(txt(valor(cab.getCell(colFollow + 1)))) === '') {
    colunas.set('extra', colFollow + 1);
  }
  if (ausentes.length > 0) return vazioRetorno(ausentes);

  const perfil = new Map<string, PerfilColuna>();
  for (const [campo, coluna] of colunas) {
    perfil.set(campo, {
      campo,
      coluna,
      cabecalho: txt(valor(cab.getCell(coluna))).replace(/\s+/g, ' ').trim(),
      total: 0,
      vazios: 0,
      numeros: 0,
      textos: 0,
      datas: 0,
      formulas: 0,
      formulasSemResultado: 0,
    });
  }

  const linhas: FupRow[] = [];
  let vazias = 0;
  for (let r = linhaCab + 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const bruto = new Map<string, Bruto>();
    const sem: string[] = [];
    let alguma = false;
    for (const [campo, coluna] of colunas) {
      const cell = row.getCell(coluna);
      const v = valor(cell);
      bruto.set(campo, v);
      // Formula sem resultado vale 0 em valor(): conta como "preenchido" so se a celula tem formula.
      const comFormula = temFormula(cell);
      const preenchido = !vazia(v) || comFormula;
      if (preenchido) alguma = true;
      const p = perfil.get(campo);
      if (p) {
        p.total += 1;
        if (vazia(v) && !comFormula) p.vazios += 1;
        else if (ehData(cell)) p.datas += 1;
        else if (typeof v === 'number') p.numeros += 1;
        else p.textos += 1;
        if (comFormula) {
          p.formulas += 1;
          if (semResultado(cell)) {
            p.formulasSemResultado += 1;
            sem.push(campo);
          }
        }
      }
    }
    if (!alguma) {
      vazias += 1;
      // Linha vazia nao conta no perfil.
      for (const campo of colunas.keys()) {
        const p = perfil.get(campo);
        if (p) {
          p.total -= 1;
          p.vazios -= 1;
        }
      }
      continue;
    }
    const t = (campo: string): string => txt(bruto.get(campo) ?? null).trim();
    const b = (campo: string): Bruto => bruto.get(campo) ?? null;
    const colSub = colunas.get('subtotal');
    linhas.push({
      linha: r,
      fornecedor: t('fornecedor'),
      cliente: t('cliente'),
      importador: t('importador'),
      po: t('po'),
      refCliente: t('refCliente'),
      dataPo: b('dataPo'),
      produto: t('produto'),
      ncm: b('ncm'),
      quantidade: b('quantidade'),
      precoFornecedor: b('precoFornecedor'),
      precoCliente: b('precoCliente'),
      subtotal: b('subtotal'),
      comissaoSubtotal: b('comissaoSubtotal'),
      subtotalFormula: colSub === undefined ? null : textoDaFormula(row.getCell(colSub)),
      formulaSemResultado: sem,
      incoterm: t('incoterm'),
      commercialInvoice: t('commercialInvoice'),
      aprovDocs: t('aprovDocs'),
      coa: t('coa'),
      hbl: t('hbl'),
      tracking: t('tracking'),
      origem: t('origem'),
      destino: t('destino'),
      navio: t('navio'),
      closing: b('closing'),
      etd: b('etd'),
      eta: b('eta'),
      status: t('status'),
      followUp: t('followUp'),
      extra: t('extra'),
      pagamento: t('pagamento'),
      dueDate: b('dueDate'),
      pagamentoFornecedor: t('pagamentoFornecedor'),
    });
  }
  return { linhas, perfil: [...perfil.values()], linhasVaziasIgnoradas: vazias, colunasAusentes: [] };
}

// ---------- DASH ----------

export interface MetricasMes {
  comissao: number;
  faturamento: number;
  volume: number;
}

export interface DashFup {
  anos: number[];
  /** Chave `YYYY-MM`. */
  meses: Record<string, MetricasMes>;
  /** Linha "Total Geral" por ano (chave = ano). */
  totais: Record<string, MetricasMes>;
}

const MESES_ROTULO: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};

function metricaDoRotulo(rotulo: string): keyof MetricasMes | null {
  const k = chaveCabecalho(rotulo);
  if (k === 'comissao') return 'comissao';
  if (k === 'faturamento') return 'faturamento';
  if (k === 'volume') return 'volume';
  return null;
}

/**
 * Le o grid da tabela dinamica por ROTULOS: linha de metricas (COMISSAO/FATURAMENTO/VOLUME), linha de anos logo
 * acima (celula mesclada repete ou nao o ano: carrega o ultimo), linhas de mes (jan..dez) e "Total Geral".
 * Devolve null se nao achar a linha de metricas nem nenhuma linha de mes (layout desconhecido).
 */
export function lerDash(ws: ExcelJS.Worksheet): DashFup | null {
  let linhaMetricas = 0;
  for (let r = 1; r <= ws.rowCount && linhaMetricas === 0; r += 1) {
    const row = ws.getRow(r);
    let achou = 0;
    for (let c = 1; c <= row.cellCount; c += 1) if (metricaDoRotulo(txt(valor(row.getCell(c)))) !== null) achou += 1;
    if (achou >= 3) linhaMetricas = r;
  }
  if (linhaMetricas === 0) return null;

  // Colunas de dados: metrica + ano da linha acima (ultimo ano numerico visto, da esquerda para a direita).
  const metricasRow = ws.getRow(linhaMetricas);
  const anosRow = ws.getRow(Math.max(1, linhaMetricas - 1));
  const colunas: { coluna: number; ano: number; metrica: keyof MetricasMes }[] = [];
  let anoAtual: number | null = null;
  let primeiraColunaMetrica = 0;
  for (let c = 1; c <= metricasRow.cellCount; c += 1) {
    const anoTxt = txt(valor(anosRow.getCell(c))).trim();
    if (/^\d{4}$/.test(anoTxt)) anoAtual = Number(anoTxt);
    const metrica = metricaDoRotulo(txt(valor(metricasRow.getCell(c))));
    if (metrica !== null && anoAtual !== null) {
      if (primeiraColunaMetrica === 0) primeiraColunaMetrica = c;
      colunas.push({ coluna: c, ano: anoAtual, metrica });
    }
  }
  if (colunas.length === 0) return null;
  const colRotuloLinha = Math.max(1, primeiraColunaMetrica - 1);

  const meses: Record<string, MetricasMes> = {};
  const totais: Record<string, MetricasMes> = {};
  const vazioM = (): MetricasMes => ({ comissao: 0, faturamento: 0, volume: 0 });
  for (let r = linhaMetricas + 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const rotulo = chaveCabecalho(txt(valor(row.getCell(colRotuloLinha))));
    const mes = MESES_ROTULO[rotulo.slice(0, 3)];
    const ehTotal = rotulo.startsWith('total');
    if (!ehTotal && mes === undefined) continue;
    for (const { coluna, ano, metrica } of colunas) {
      const valorCelula = num(valor(row.getCell(coluna)));
      if (ehTotal) {
        totais[String(ano)] = totais[String(ano)] ?? vazioM();
        totais[String(ano)][metrica] = valorCelula;
      } else {
        const chave = `${ano}-${String(mes).padStart(2, '0')}`;
        meses[chave] = meses[chave] ?? vazioM();
        meses[chave][metrica] = valorCelula;
      }
    }
  }
  // Nenhum rotulo de mes reconhecido (layout mudou): nao ha o que reconciliar, e nao pode parecer "tudo desatualizado".
  if (Object.keys(meses).length === 0) return null;
  const anos = [...new Set(colunas.map((c) => c.ano))].sort((a, b) => a - b);
  return { anos, meses, totais };
}

export interface FupArquivo extends FupLida {
  dash: DashFup | null;
}

export function lerFupDeWorkbook(wb: ExcelJS.Workbook): FupArquivo {
  const vendas = wb.getWorksheet(ABA_VENDAS);
  if (!vendas) {
    return { linhas: [], perfil: [], linhasVaziasIgnoradas: 0, colunasAusentes: [`aba ${ABA_VENDAS}`], dash: null };
  }
  const lida = lerVendas(vendas);
  const dashWs = wb.getWorksheet(ABA_DASH);
  return { ...lida, dash: dashWs ? lerDash(dashWs) : null };
}

/** Leitura somente: o arquivo original nunca e alterado. */
export async function lerFupArquivo(caminho: string): Promise<FupArquivo> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  return lerFupDeWorkbook(wb);
}
