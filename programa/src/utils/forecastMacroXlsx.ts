// XLSX da quinzena congelada no layout da aba FORECAST (MACRO) do PO.COMP.01 (fase 4). A aba traz as FORMULAS vivas
// (forecastMacroLayout.ts) com o resultado do motor em cache, mais as abas de entrada que elas leem (arquivo
// autocontido e reimportavel por parseForecastWorkbook) e uma aba Regras. Nada aqui le banco nem relogio: quem chama
// entrega a quinzena, a data do calculo e as marcas de mes atipico.
import exceljs from 'exceljs';
import {
  FORECAST_MARGEM_LAST_ROW,
  FORECAST_MAX_CODES_PER_PRODUCT,
  FORECAST_ORIGIN_DBCORP,
  FORECAST_SHEETS,
} from '../constants/forecast';
import { PROJECAO_5O_MES_SOMA_CHEGADA, calcular, valorDaColuna } from './forecastEngine';
import {
  CABECALHOS_FIXOS,
  COLUNAS_COM_FORMULA,
  COLUNAS_MACRO,
  COLUNAS_MES_CHEGADA,
  COLUNAS_MES_CONSUMO,
  COLUNAS_MES_PROGRAMACAO,
  COLUNAS_MES_PROGRAMACAO_FINAL,
  COLUNAS_CODIGO,
  COLUNAS_OCULTAS,
  COR_DO_STATUS,
  FAIXAS_LINHA_1,
  FORMATOS,
  LARGURAS,
  LAYOUT_MACRO,
  PRIMEIRA_LINHA_PRODUTO,
  estiloCabecalho,
  estiloProduto,
  formulaDaColuna,
  regrasCondicionais,
  rotuloMesSeguinte,
  ultimaLinhaDaMargem,
  type ColunaComFormula,
  type ContextoFormula,
  type EstiloMacro,
} from './forecastMacroLayout';
import { STATUS_ROTULO_XLSX, dataBr } from './forecastRelatorioComprasXlsx';
import type { LinhaCalculada, Produto, Quinzena } from './forecastTypes';

export interface EntradaForecastMacro {
  quinzena: Quinzena;
  hoje: string; // YYYY-MM-DD: data do calculo (base da coluna CHEG.)
  half: 1 | 2;
  origin: string;
  somarChegada5oMes?: boolean; // default: regra AL do Comex (PROJECAO_5O_MES_SOMA_CHEGADA)
  mesesForaDaMedia?: ReadonlyMap<number, ReadonlySet<number>>; // por Produto.linha (indices 0..6)
}

type Resultado = number | string | Date | { error: '#N/A' };

const ERRO_NA = { error: '#N/A' } as const;
const NOME_ABA_REGRAS = 'Regras';

export function nomeArquivoForecastMacro(q: { label: string; hoje: string }): string {
  const limpo = (v: string) => v.replace(/[^0-9A-Za-z-]/g, '-');
  return `forecast-macro-${limpo(q.label)}-${limpo(q.hoje)}.xlsx`;
}

// MARGEM do arquivo: so a margem que o AR usa. Mapa da 1a ocorrencia por codigo (maiusculas, como o motor); para cada
// produto, o 1o codigo presente vira 1 linha (codigo como esta na MARGEM), sem repetir codigo.
export function margemUsada(q: Quinzena): Array<{ codigo: string; margem: number | null }> {
  const primeira = new Map<string, { codigo: string; margem: number | null }>();
  for (const m of q.entradas.margem) {
    if (!m.codigo) continue;
    const k = m.codigo.toUpperCase();
    if (!primeira.has(k)) primeira.set(k, m);
  }
  const usados = new Set<string>();
  const saida: Array<{ codigo: string; margem: number | null }> = [];
  for (const p of q.produtos) {
    for (const c of p.codigos) {
      if (!c) continue;
      const k = c.toUpperCase();
      const m = primeira.get(k);
      if (!m) continue;
      if (!usados.has(k)) {
        usados.add(k);
        saida.push({ codigo: m.codigo, margem: m.margem });
      }
      break;
    }
  }
  return saida;
}

// CLIENTES ATIVOS do arquivo: so os codigos dos produtos, na ordem original (nenhum nome de cliente existe no snapshot).
export function clientesDosProdutos(q: Quinzena): string[] {
  const codigos = new Set(q.produtos.flatMap((p) => p.codigos.filter(Boolean).map((c) => c.toUpperCase())));
  return q.entradas.clientesAtivos.filter((c) => c && codigos.has(c.toUpperCase()));
}

export interface ContextoRegrasMacro {
  label: string;
  origin: string;
  dataBase: string;
  hoje: string;
  somarChegada5oMes: boolean;
  produtosComMarca: number;
  linhasMargem?: number; // codigos escritos na aba MARGEM
}

export function PARAGRAFOS_REGRAS_MACRO(ctx: ContextoRegrasMacro): string[] {
  const origem = ctx.origin === FORECAST_ORIGIN_DBCORP ? 'relatórios DBCorp' : 'planilha';
  const paragrafos = [
    `Gerado pelo IntelliQuote da quinzena ${ctx.label} (${origem}), data-base ${dataBr(ctx.dataBase)}, calculada em ${dataBr(ctx.hoje)}. As fórmulas são as da aba FORECAST (MACRO) do PO.COMP.01; cada célula já traz o resultado calculado pelo sistema e o Excel recalcula ao abrir.`,
  ];
  if (ctx.somarChegada5oMes) {
    paragrafos.push(
      'A projeção do 5º mês (AL) soma a chegada desse mês (coluna Z) e AM herda. A planilha original não somava; ao reimportar este arquivo, o selo de conferência (que segue a regra da planilha) aponta diferença só em AL/AM nas linhas com chegada no 5º mês.',
    );
  }
  paragrafos.push(
    "Clientes ativos (AS) contam o intervalo fixo 'CLIENTES ATIVOS'!$C$6:$C$100000 (na planilha original o intervalo deslizava linha a linha).",
    'Os alertas de AH a AM comparam sempre com a média trimestral (coluna Q).',
    'Consumo do mês (AG): na 1ª quinzena é a média trimestral; na 2ª, o maior entre a média trimestral e a venda do mês atual.',
    'CHEG. (AP) = data do cálculo + lead time da fonte (a planilha original usava HOJE()).',
  );
  if (ctx.produtosComMarca > 0) {
    paragrafos.push(
      `${ctx.produtosComMarca} produto(s) com mês de venda atípico marcado no cadastro: as médias Q e R desconsideram esses meses (a fórmula da linha mostra quais entram); com o mês atual marcado, o consumo do mês (AG) é a média.`,
    );
  }
  paragrafos.push(
    `Cor da célula do item: verde = ${STATUS_ROTULO_XLSX.po}; laranja = ${STATUS_ROTULO_XLSX.confirmado}; amarelo = ${STATUS_ROTULO_XLSX.cotando}; azul = ${STATUS_ROTULO_XLSX.preco}; sem cor = ${STATUS_ROTULO_XLSX.nao}.`,
    'MARGEM traz só a margem que a coluna AR usa; CLIENTES ATIVOS, só os códigos dos produtos; preço fechado aparece só como X. As abas de entrada têm só as colunas usadas pelas fórmulas.',
  );
  const n = ctx.linhasMargem ?? 0;
  if (n + 1 > FORECAST_MARGEM_LAST_ROW) {
    paragrafos.push(
      `A aba MARGEM tem ${n} códigos (linhas 2 a ${n + 1}) e a coluna AR procura até a linha ${n + 1}. O PO.COMP.01 e o importador do IntelliQuote leem a MARGEM só até a linha ${FORECAST_MARGEM_LAST_ROW}: ao reimportar este arquivo, os códigos abaixo dessa linha ficam sem margem e o selo de conferência aponta diferença na coluna AR desses produtos.`,
    );
  }
  return paragrafos;
}

// ---- Estilo ----
const BORDA_FINA: Partial<exceljs.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

function aplicarEstilo(cell: exceljs.Cell, e: EstiloMacro, borda = true, semQuebra = false): void {
  cell.font = {
    name: e.fonte.nome,
    size: e.fonte.tamanho,
    bold: e.fonte.negrito ?? false,
    ...(e.fonte.cor ? { color: { argb: e.fonte.cor } } : {}),
  };
  if (e.fundo) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: e.fundo } };
  if (e.horizontal || e.vertical || semQuebra) {
    cell.alignment = {
      ...(e.horizontal ? { horizontal: e.horizontal } : {}),
      ...(e.vertical ? { vertical: e.vertical } : {}),
      ...(semQuebra ? { wrapText: false } : {}),
    };
  }
  if (e.numFmt && e.numFmt !== FORMATOS.geral) cell.numFmt = e.numFmt;
  if (borda) cell.border = BORDA_FINA;
}

// ---- Resultado em cache ----
function resultadoDaColuna(l: LinhaCalculada, col: ColunaComFormula): Resultado {
  if (col === 'AP') {
    const m = l.AP ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(l.AP) : null;
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : ERRO_NA;
  }
  const v = valorDaColuna(l, col as Parameters<typeof valorDaColuna>[1]);
  return v === null ? ERRO_NA : v;
}

const textoSeX = (v: string): string | null => (v.trim().toUpperCase() === 'X' ? 'X' : null);
const textoOuNulo = (v: string): string | null => (v === '' ? null : v);

// ---- Aba FORECAST (MACRO) ----
function escreverFaixas(ws: exceljs.Worksheet): void {
  for (const f of FAIXAS_LINHA_1) {
    const estilo: EstiloMacro = {
      fonte:
        f.fonte === 'Calibri'
          ? { nome: 'Calibri', tamanho: 11, negrito: true }
          : { nome: 'Bookman Old Style', tamanho: 10, negrito: true, cor: f.corFonte },
      ...(f.fundo ? { fundo: f.fundo } : {}),
      horizontal: f.horizontal,
      vertical: 'middle',
    };
    const inicio = COLUNAS_MACRO.indexOf(f.de);
    const fim = COLUNAS_MACRO.indexOf(f.ate);
    for (let i = inicio; i <= fim; i++) aplicarEstilo(ws.getCell(`${COLUNAS_MACRO[i]}1`), estilo);
    if (f.texto) ws.getCell(`${f.de}1`).value = f.texto;
    if (f.de !== f.ate) ws.mergeCells(`${f.de}1:${f.ate}1`);
  }
  // Borda fina em toda a linha 1 de B a AZ (inclui as colunas sem faixa).
  for (const col of COLUNAS_MACRO) {
    if (col !== 'A') ws.getCell(`${col}1`).border = BORDA_FINA;
  }
}

function escreverCabecalhos(ws: exceljs.Worksheet, q: Quinzena): void {
  const celula = (col: string, valor: exceljs.CellValue) => {
    ws.getCell(`${col}2`).value = valor;
  };
  for (const [col, texto] of Object.entries(CABECALHOS_FIXOS)) celula(col, texto);
  COLUNAS_MES_CONSUMO.forEach((col, i) => celula(col, q.mesesConsumo[i] ?? ''));
  COLUNAS_MES_CHEGADA.forEach((col, i) => celula(col, q.mesesChegada[i] ?? ''));
  COLUNAS_MES_PROGRAMACAO.forEach((col, i) => {
    const prog = q.mesesProgramacao[i] ?? '';
    const igual = prog === q.mesesChegada[i];
    // A planilha traz =V2..Y2; so vale se a programacao usa o mesmo mes da chegada.
    celula(col, igual ? { formula: `${COLUNAS_MES_CHEGADA[i]}2`, result: prog } : prog);
    const final = COLUNAS_MES_PROGRAMACAO_FINAL[i];
    celula(final, { formula: `${col}2`, result: prog });
  });
  const quinto = q.mesesChegada[4] ?? '';
  celula('AL', quinto);
  celula('AM', rotuloMesSeguinte(quinto));
  for (const col of COLUNAS_MACRO) {
    const estilo = estiloCabecalho(col);
    if (estilo) aplicarEstilo(ws.getCell(`${col}2`), estilo, true, true);
  }
}

function escreverProduto(
  ws: exceljs.Worksheet,
  p: Produto,
  l: LinhaCalculada,
  r: number,
  ctx: ContextoFormula,
): void {
  const valor = (col: string, v: exceljs.CellValue) => {
    ws.getCell(`${col}${r}`).value = v;
  };
  valor('A', p.n ?? null);
  COLUNAS_CODIGO.forEach((col, i) => valor(col, textoOuNulo(p.codigos[i] ?? '')));
  valor('I', p.item);
  ['J', 'K', 'L', 'M', 'N'].forEach((col, i) => valor(col, p.historico[i] ?? 0));
  for (const col of COLUNAS_COM_FORMULA) {
    valor(col, { formula: formulaDaColuna(col, r, ctx), result: resultadoDaColuna(l, col) });
  }
  valor('AO', p.analiseForecast ?? null);
  valor('AT', textoOuNulo(p.obs));
  valor('AU', textoOuNulo(p.fonte));
  valor('AV', textoSeX(p.precoFechado));
  valor('AW', textoOuNulo(p.embalagem));
  valor('AX', textoSeX(p.naoFraciona));
  valor('AY', textoOuNulo(p.qtdAmostra));
  valor('AZ', textoOuNulo(p.solicitarAmostra));
  for (const col of COLUNAS_MACRO) aplicarEstilo(ws.getCell(`${col}${r}`), estiloProduto(col));
  const cor = COR_DO_STATUS[p.status] ?? null;
  if (cor) ws.getCell(`I${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
}

function escreverAbaMacro(
  workbook: exceljs.Workbook,
  e: EntradaForecastMacro,
  linhas: LinhaCalculada[],
  somarChegada5oMes: boolean,
  ultimaLinhaMargem: number,
): number {
  const q = e.quinzena;
  const ws = workbook.addWorksheet(LAYOUT_MACRO.nomeAba, {
    pageSetup: { paperSize: LAYOUT_MACRO.papelA4, orientation: 'portrait' },
    properties: { defaultColWidth: LAYOUT_MACRO.larguraPadrao },
  });
  for (const col of COLUNAS_MACRO) {
    const coluna = ws.getColumn(col);
    coluna.width = LARGURAS[col];
    if (COLUNAS_OCULTAS.includes(col)) coluna.hidden = true;
  }
  ws.getRow(1).height = LAYOUT_MACRO.alturaLinha1;
  escreverFaixas(ws);
  escreverCabecalhos(ws, q);

  let comMarca = 0;
  q.produtos.forEach((p, i) => {
    const fora = e.mesesForaDaMedia?.get(p.linha);
    const ctx: ContextoFormula = {
      half: e.half,
      somarChegada5oMes,
      hoje: e.hoje,
      fora,
      ultimaLinhaMargem,
      codigos: p.codigos,
      fonte: p.fonte,
    };
    if (fora && [...fora].some((m) => Number.isInteger(m) && m >= 0 && m <= 6)) comMarca++;
    escreverProduto(ws, p, linhas[i], PRIMEIRA_LINHA_PRODUTO + i, ctx);
  });

  const ultima = Math.max(PRIMEIRA_LINHA_PRODUTO, 2 + q.produtos.length);
  // `tabSelected` existe no XML do exceljs mas nao no tipo da visao congelada (por isso a variavel intermediaria).
  const visao = {
    state: 'frozen' as const,
    xSplit: LAYOUT_MACRO.xSplit,
    ySplit: LAYOUT_MACRO.ySplit,
    topLeftCell: LAYOUT_MACRO.topLeftCell,
    activeCell: LAYOUT_MACRO.topLeftCell,
    zoomScale: LAYOUT_MACRO.zoom,
    zoomScaleNormal: LAYOUT_MACRO.zoom,
    tabSelected: true,
  };
  ws.views = [visao];
  ws.autoFilter = `A2:${LAYOUT_MACRO.ultimaColuna}${ultima}`;
  for (const regra of regrasCondicionais(ultima)) {
    ws.addConditionalFormatting({
      ref: regra.ref,
      rules: [
        {
          type: 'expression',
          priority: regra.prioridade,
          formulae: [regra.formula],
          style: {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: regra.fundo }, bgColor: { argb: regra.fundo } },
            ...(regra.fonte ? { font: { color: { argb: regra.fonte.cor }, bold: regra.fonte.negrito } } : {}),
          },
        },
      ],
    });
  }
  return comMarca;
}

// ---- Abas de entrada ----
function larguras(ws: exceljs.Worksheet, colunas: Record<string, number>): void {
  for (const [col, w] of Object.entries(colunas)) ws.getColumn(col).width = w;
}

function congelar(ws: exceljs.Worksheet, linhasFixas: number): void {
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: linhasFixas, topLeftCell: `A${linhasFixas + 1}` }];
}

const negrito = (cell: exceljs.Cell) => {
  cell.font = { bold: true };
};

function abaLancamentos(
  workbook: exceljs.Workbook,
  nome: string,
  nota: string | null,
  opcoes: {
    estado?: 'hidden';
    linhaCabecalho: number;
    cabecalhos: Record<string, string>;
    larguras: Record<string, number>;
    colCodigo: string;
    colQtd: string;
    colMes?: string;
    formatoQtd: string;
    dados: Array<{ codigo: string; qtd: number; mes?: string }>;
  },
): void {
  const ws = workbook.addWorksheet(nome, opcoes.estado ? { state: opcoes.estado } : undefined);
  if (nota) ws.getCell('A1').value = nota;
  for (const [col, texto] of Object.entries(opcoes.cabecalhos)) {
    const cell = ws.getCell(`${col}${opcoes.linhaCabecalho}`);
    cell.value = texto;
    negrito(cell);
  }
  larguras(ws, opcoes.larguras);
  congelar(ws, opcoes.linhaCabecalho);
  if (opcoes.colMes) ws.getColumn(opcoes.colMes).numFmt = FORMATOS.texto;
  opcoes.dados.forEach((d, i) => {
    const r = opcoes.linhaCabecalho + 1 + i;
    ws.getCell(`${opcoes.colCodigo}${r}`).value = d.codigo;
    const qtd = ws.getCell(`${opcoes.colQtd}${r}`);
    qtd.value = d.qtd;
    qtd.numFmt = opcoes.formatoQtd;
    if (opcoes.colMes) {
      const mes = ws.getCell(`${opcoes.colMes}${r}`);
      mes.value = d.mes ?? '';
      mes.numFmt = FORMATOS.texto;
    }
  });
}

function abaLeadtime(workbook: exceljs.Workbook, q: Quinzena): void {
  const ws = workbook.addWorksheet(FORECAST_SHEETS.leadtime);
  ws.getCell('A1').value = 'FONTE';
  ws.mergeCells('A1:A2');
  ws.getCell('B1').value = 'LEADTIME (DIAS)';
  ws.mergeCells('B1:G1');
  const cab = ['PRONTIDÃO', 'FERIADOS', 'EMBARQUE', 'TRANSIT', 'LIBERAÇÃO', 'TOTAL'];
  ['B', 'C', 'D', 'E', 'F', 'G'].forEach((col, i) => {
    ws.getCell(`${col}2`).value = cab[i];
  });
  for (const ref of ['A1', 'B1', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2']) negrito(ws.getCell(ref));
  ws.getColumn('A').width = 23.33;
  congelar(ws, 2);
  q.entradas.leadtime.forEach((l, i) => {
    const r = 3 + i;
    ws.getCell(`A${r}`).value = l.fonte;
    // So o total (B..F ficam vazios: a quinzena guarda apenas o total) e como VALOR, nunca soma de B..F.
    if (l.total !== null) ws.getCell(`G${r}`).value = l.total;
  });
}

function abaMargem(workbook: exceljs.Workbook, margens: Array<{ codigo: string; margem: number | null }>): void {
  const ws = workbook.addWorksheet(FORECAST_SHEETS.margem);
  ws.getCell('A1').value = 'DIRETO';
  ws.getCell('B1').value = 'MARGEM';
  negrito(ws.getCell('A1'));
  negrito(ws.getCell('B1'));
  larguras(ws, { A: 10, B: 12.11 });
  congelar(ws, 1);
  margens.forEach((m, i) => {
    const r = 2 + i;
    ws.getCell(`A${r}`).value = m.codigo;
    if (m.margem !== null) {
      const cell = ws.getCell(`B${r}`);
      cell.value = m.margem;
      cell.numFmt = '0.00%';
    }
  });
}

function abaClientes(workbook: exceljs.Workbook, nota: string, codigos: string[]): void {
  const ws = workbook.addWorksheet(FORECAST_SHEETS.clientesAtivos);
  ws.getCell('A1').value = nota;
  ws.getCell('C5').value = 'Código Item';
  negrito(ws.getCell('C5'));
  ws.getColumn('C').width = 14;
  congelar(ws, 5);
  codigos.forEach((c, i) => {
    ws.getCell(`C${6 + i}`).value = c;
  });
}

function abaRegras(workbook: exceljs.Workbook, paragrafos: string[]): void {
  const ws = workbook.addWorksheet(NOME_ABA_REGRAS);
  ws.getColumn('A').width = 120;
  paragrafos.forEach((texto, i) => {
    const cell = ws.getCell(`A${i + 1}`);
    cell.value = texto;
    cell.alignment = { wrapText: true, vertical: 'top' };
  });
}

const FORMATO_ESTOQUE = '#0.00;\\-#0.00;#0.00';
const FORMATO_VENDAS = '#,##0.00_);(#,##0.00)';

export async function gerarXlsxForecastMacro(e: EntradaForecastMacro): Promise<Buffer> {
  const q = e.quinzena;
  q.produtos.forEach((p) => {
    if (p.codigos.length !== FORECAST_MAX_CODES_PER_PRODUCT) {
      throw new Error(`Produto com codigos fora do padrao de ${FORECAST_MAX_CODES_PER_PRODUCT} posicoes (linha ${p.linha}).`);
    }
  });

  const somarChegada5oMes = e.somarChegada5oMes ?? PROJECAO_5O_MES_SOMA_CHEGADA;
  const linhas = calcular(q, {
    hoje: e.hoje,
    quinzena: e.half,
    somarChegada5oMes,
    mesesForaDaMedia: e.mesesForaDaMedia,
  });
  const margens = margemUsada(q);
  const nota = `Gerado pelo IntelliQuote (quinzena ${q.id}). Só as colunas usadas pelas fórmulas da aba FORECAST (MACRO).`;

  const workbook = new exceljs.Workbook();
  workbook.creator = 'IntelliQuote';
  workbook.calcProperties.fullCalcOnLoad = true;

  const produtosComMarca = escreverAbaMacro(workbook, e, linhas, somarChegada5oMes, ultimaLinhaDaMargem(margens.length));

  const en = q.entradas;
  abaLancamentos(workbook, FORECAST_SHEETS.estoque, nota, {
    linhaCabecalho: 6,
    cabecalhos: { A: 'Código', E: 'Saldo Físico Disponível' },
    larguras: { A: 9.44, E: 10.44 },
    colCodigo: 'A',
    colQtd: 'E',
    formatoQtd: FORMATO_ESTOQUE,
    dados: en.estoque,
  });
  const vendas = [
    { nome: FORECAST_SHEETS.vendasMes, dados: en.vendasMes, larguras: { B: 8.11, D: 10.55 } },
    { nome: FORECAST_SHEETS.vendasAtual, dados: en.vendasAtual, larguras: { B: 8.44, D: 13.89 } },
    { nome: FORECAST_SHEETS.vendasAnual, dados: en.vendasAnual, larguras: { B: 9.44, D: 15.89 }, oculta: true },
  ];
  for (const v of vendas) {
    abaLancamentos(workbook, v.nome, nota, {
      ...(v.oculta ? { estado: 'hidden' as const } : {}),
      linhaCabecalho: 5,
      cabecalhos: { B: 'Item', D: 'Quantidade' },
      larguras: v.larguras,
      colCodigo: 'B',
      colQtd: 'D',
      formatoQtd: FORMATO_VENDAS,
      dados: v.dados,
    });
  }
  abaLancamentos(workbook, FORECAST_SHEETS.programacoes, nota, {
    linhaCabecalho: 6,
    cabecalhos: { A: 'CÓDIGO', D: 'QUANTIDADE KG', I: 'MÊS' },
    larguras: { A: 10.33, D: 11.55, I: 7.33 },
    colCodigo: 'A',
    colQtd: 'D',
    colMes: 'I',
    formatoQtd: FORMATO_VENDAS,
    dados: en.programacoes,
  });
  abaLancamentos(workbook, FORECAST_SHEETS.chegadas, null, {
    linhaCabecalho: 1,
    cabecalhos: { E: 'Cod SQ', L: 'Qtde', Z: 'MÊS' },
    larguras: { E: 10.33, L: 10.33, Z: 9.33 },
    colCodigo: 'E',
    colQtd: 'L',
    colMes: 'Z',
    formatoQtd: FORMATO_VENDAS,
    dados: en.chegadas,
  });
  abaLeadtime(workbook, q);
  abaMargem(workbook, margens);
  abaClientes(workbook, nota, clientesDosProdutos(q));

  abaRegras(
    workbook,
    PARAGRAFOS_REGRAS_MACRO({
      label: q.id,
      origin: e.origin,
      dataBase: q.dataBase,
      hoje: e.hoje,
      somarChegada5oMes,
      produtosComMarca,
      linhasMargem: margens.length,
    }),
  );

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
