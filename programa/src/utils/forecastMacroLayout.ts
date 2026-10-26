// Layout da aba FORECAST (MACRO) do PO.COMP.01 no XLSX gerado pelo IntelliQuote (fase 4): letras, larguras, colunas
// ocultas, congelamento, faixas, formatos, cores e as FORMULAS vivas de cada coluna calculada (O..AS). PURO: sem
// biblioteca de planilha, sem banco e sem relogio. O gerador (forecastMacroXlsx.ts) so aplica estas constantes.
// Regra de manutencao: mudou o calculo em forecastEngine.ts, ajuste as formulas daqui; tests/forecast-macro-xlsx.test.ts
// avalia as formulas do arquivo e compara com o motor em todas as celulas conferidas.
import { FORECAST_MARGEM_LAST_ROW, FORECAST_SHEETS } from '../constants/forecast';

// EMB.1..EMB.7 (B..H): os 7 termos de toda formula por codigo.
export const COLUNAS_CODIGO = ['B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export const PRIMEIRA_LINHA_PRODUTO = 3;

// Colunas A..AZ, na ordem da planilha.
export const COLUNAS_MACRO: readonly string[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W',
  'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP', 'AQ',
  'AR', 'AS', 'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ',
];

// Colunas com formula por linha de produto.
export const COLUNAS_COM_FORMULA = [
  'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ',
  'AK', 'AL', 'AM', 'AN', 'AP', 'AQ', 'AR', 'AS',
] as const;
export type ColunaComFormula = (typeof COLUNAS_COM_FORMULA)[number];

export const CORES = {
  verde: 'FF00CC99',
  amarelo: 'FFFFFF00',
  laranja: 'FFFFC000',
  vermelho: 'FFFF0000',
  branco: 'FFFFFFFF',
  preto: 'FF000000',
  // Cores de tema da planilha, resolvidas para ARGB (o arquivo gerado traz o tema do proprio gerador).
  seguranca: 'FFEEECE1',
  chegada: 'FFDDD9C3',
  margem: 'FFC6D9F1',
  clientes: 'FFD7E4BD',
  demandaNegativa: 'FFF2DCDB',
  alertaLaranja: 'FFF79646',
  alertaPicoVenda: 'FFFFC7CE',
} as const;

// Fundo solido do item (coluna I) por status; 'nao' fica sem fundo. Inversa de FORECAST_STATUS_COLORS.
export const COR_DO_STATUS: Record<string, string | null> = {
  po: 'FF00B050',
  confirmado: 'FFFFC000',
  cotando: 'FFFFFF00',
  preco: 'FF00B0F0',
  nao: null,
};

export const FORMATOS = {
  geral: 'General',
  inteiro: '_-* #,##0_-;\\-* #,##0_-;_-* "-"??_-;_-@_-',
  umaCasa: '0.0',
  duasCasas: '0.00',
  zero: '0',
  decimal1: '_-* #,##0.0_-;\\-* #,##0.0_-;_-* "-"?_-;_-@_-',
  dataCurta: 'd-mmm',
  percentual: '0.0%',
  texto: '@',
} as const;

export const LARGURAS: Record<string, number> = {
  A: 4.44, B: 7.55, C: 7.55, D: 7.55, E: 7.55, F: 7.55, G: 7.55, H: 7.55, I: 32.66,
  J: 9.33, K: 9.33, L: 9.33, M: 9.33, N: 9.33, O: 9.33, P: 10.33, Q: 10, R: 10, S: 9.33, T: 11.33, U: 10.44,
  V: 8.89, W: 8.89, X: 8.89, Y: 8.89, Z: 8.66, AA: 6.89, AB: 1.66, AC: 8.89, AD: 8.89, AE: 8.89, AF: 9.33,
  AG: 9.66, AH: 7.66, AI: 7.89, AJ: 7.66, AK: 7.89, AL: 7.66, AM: 9, AN: 10, AO: 10.66, AP: 8.11, AQ: 4.55,
  AR: 6.44, AS: 4.55, AT: 42.44, AU: 13.33, AV: 5.89, AW: 15.44, AX: 6, AY: 7.55, AZ: 27.33,
};

export const COLUNAS_OCULTAS: readonly string[] = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'AG'];

export const LAYOUT_MACRO = {
  nomeAba: FORECAST_SHEETS.macro,
  xSplit: 9,
  ySplit: 2,
  topLeftCell: 'J3',
  zoom: 90,
  alturaLinha1: 16.2,
  larguraPadrao: 9, // a coluna AM tem 9: a largura igual a padrao nao e gravada por coluna, vale a da aba
  papelA4: 9,
  ultimaColuna: 'AZ',
} as const;

export interface EstiloMacro {
  fonte: { nome: 'Calibri' | 'Bookman Old Style'; tamanho: number; negrito?: boolean; cor?: string };
  fundo?: string;
  horizontal?: 'left' | 'center' | 'right';
  vertical?: 'middle' | 'top';
  numFmt?: string;
}

const bookman = (cor: string, negrito = false, tamanho = 10): EstiloMacro['fonte'] => ({
  nome: 'Bookman Old Style',
  tamanho,
  negrito,
  cor,
});
const calibri = (tamanho = 10, negrito = false): EstiloMacro['fonte'] => ({ nome: 'Calibri', tamanho, negrito });

// ---- Linha 1: faixas ----
export interface FaixaMacro {
  de: string;
  ate: string; // = de quando nao mescla
  texto: string;
  fundo: string | null;
  corFonte: string;
  horizontal: 'left' | 'center';
  fonte: 'Calibri' | 'Bookman Old Style';
}

const faixa = (
  de: string,
  ate: string,
  texto: string,
  fundo: string | null,
  corFonte: string,
  horizontal: 'left' | 'center' = 'center',
  fonte: FaixaMacro['fonte'] = 'Bookman Old Style',
): FaixaMacro => ({ de, ate, texto, fundo, corFonte, horizontal, fonte });

export const FAIXAS_LINHA_1: readonly FaixaMacro[] = [
  faixa('B', 'B', 'CÓD. SQ', null, CORES.preto, 'left', 'Calibri'),
  faixa('I', 'I', '', CORES.verde, CORES.branco),
  faixa('J', 'P', 'CONSUMO', CORES.vermelho, CORES.preto),
  faixa('Q', 'Q', 'TRIM.', CORES.verde, CORES.branco),
  faixa('R', 'R', 'SEM.', CORES.verde, CORES.branco),
  faixa('S', 'S', 'ANUAL', CORES.verde, CORES.branco),
  faixa('T', 'U', 'ESTOQUE', CORES.amarelo, CORES.preto),
  faixa('V', 'Z', 'CHEGADAS', CORES.vermelho, CORES.preto),
  faixa('AA', 'AA', 'Meses X', CORES.verde, CORES.branco, 'left'),
  faixa('AB', 'AB', '', CORES.verde, CORES.branco),
  faixa('AC', 'AF', 'PROGRAMAÇÕES', CORES.amarelo, CORES.preto),
  faixa('AG', 'AM', 'FINAL', CORES.verde, CORES.branco),
  faixa('AN', 'AZ', 'COMPRAS', CORES.verde, CORES.branco),
];

// ---- Linha 2: cabecalhos fixos (os de mes vem do snapshot) ----
export const CABECALHOS_FIXOS: Record<string, string> = {
  B: 'EMB.1', C: 'EMB.2', D: 'EMB.3', E: 'EMB.4', F: 'EMB.5', G: 'EMB.6', H: 'EMB.7',
  I: 'ITENS', Q: 'MED.', R: 'MED.', S: 'MED.', T: 'SEGURANÇA', U: 'TOTAL', AA: 'Estoque', AG: 'MED vs ATUAL',
  AN: 'DEMANDA', AO: 'ANALISE FORECAST', AP: 'CHEG.', AQ: 'LEADTIME TOTAL (dias)',
  AR: 'CURVA POR MARGEM (A,B,C,D,E)', AS: 'CLIENTES ATIVOS ULTIMOS 3 MESES', AT: 'OBS.', AU: 'Fonte',
  AV: 'Preço fechado?', AW: 'Embalagem', AX: 'ITENS QUE NÃO FRACIONAM', AY: 'QTD AMOSTRA/PACOTE',
  AZ: 'SOLICITAR AMOSTRA COM PROXIMA COMPRA?',
};

export const COLUNAS_MES_CONSUMO = ['J', 'K', 'L', 'M', 'N', 'O', 'P'] as const;
export const COLUNAS_MES_CHEGADA = ['V', 'W', 'X', 'Y', 'Z'] as const;
export const COLUNAS_MES_PROGRAMACAO = ['AC', 'AD', 'AE', 'AF'] as const;
export const COLUNAS_MES_PROGRAMACAO_FINAL = ['AH', 'AI', 'AJ', 'AK'] as const;

const AMARELOS_LINHA_2 = new Set(['O', 'P', 'U', 'AC', 'AD', 'AE', 'AF']);
const ehCodigo = (col: string) => (COLUNAS_CODIGO as readonly string[]).includes(col);

// Estilo do cabecalho (linha 2) de uma coluna: verde (fonte branca), amarelo ou laranja (fonte preta).
export function estiloCabecalho(col: string): EstiloMacro | null {
  if (col === 'A') return null;
  if (ehCodigo(col)) return { fonte: calibri(11, true), horizontal: 'left', vertical: 'middle' };
  const tamanho = col === 'AX' || col === 'AY' || col === 'AZ' ? 11 : 10;
  if (AMARELOS_LINHA_2.has(col)) {
    return { fonte: bookman(CORES.preto, true, tamanho), fundo: CORES.amarelo, horizontal: 'left', vertical: 'middle' };
  }
  if (col === 'T') {
    return { fonte: bookman(CORES.preto, true, tamanho), fundo: CORES.laranja, horizontal: 'left', vertical: 'middle' };
  }
  return { fonte: bookman(CORES.branco, true, tamanho), fundo: CORES.verde, horizontal: 'left', vertical: 'middle' };
}

// ---- Linhas de produto: estilo por coluna ----
const centro = (fonte: EstiloMacro['fonte'], numFmt: string, extra: Partial<EstiloMacro> = {}): EstiloMacro => ({
  fonte,
  horizontal: 'center',
  numFmt,
  ...extra,
});

export function estiloProduto(col: string): EstiloMacro {
  if (col === 'A' || ehCodigo(col)) return centro(calibri(10), FORMATOS.geral);
  if (col === 'I') return { fonte: bookman(CORES.preto, true), numFmt: FORMATOS.geral };
  if (['J', 'K', 'L', 'M', 'N', 'O', 'P', 'U'].includes(col)) return centro(bookman(CORES.preto), FORMATOS.inteiro);
  if (['Q', 'R', 'S', 'AA'].includes(col)) return centro(bookman(CORES.preto), FORMATOS.umaCasa);
  if (col === 'T') return centro(bookman(CORES.preto), FORMATOS.umaCasa, { fundo: CORES.seguranca });
  if (['V', 'W', 'X', 'Y', 'Z', 'AC', 'AD', 'AE', 'AF'].includes(col)) {
    return { fonte: bookman(CORES.preto), fundo: CORES.branco, numFmt: FORMATOS.inteiro };
  }
  switch (col) {
    case 'AB': return { fonte: calibri(10), fundo: CORES.laranja, numFmt: FORMATOS.geral };
    case 'AG': return { fonte: bookman(CORES.preto), horizontal: 'right', numFmt: FORMATOS.duasCasas };
    case 'AH': case 'AI': case 'AJ': case 'AK': case 'AL': case 'AM':
      return { fonte: bookman(CORES.preto), horizontal: 'right', numFmt: FORMATOS.zero };
    case 'AN':
      return { fonte: calibri(10), fundo: CORES.branco, horizontal: 'left', vertical: 'middle', numFmt: FORMATOS.decimal1 };
    case 'AO':
      return { fonte: calibri(10), fundo: CORES.branco, horizontal: 'center', vertical: 'middle', numFmt: FORMATOS.decimal1 };
    case 'AP':
      return { fonte: calibri(10, true), fundo: CORES.chegada, horizontal: 'center', vertical: 'middle', numFmt: FORMATOS.dataCurta };
    case 'AQ':
      return { fonte: calibri(10), fundo: CORES.chegada, horizontal: 'center', vertical: 'middle', numFmt: FORMATOS.geral };
    case 'AR':
      return { fonte: calibri(10), fundo: CORES.margem, horizontal: 'center', vertical: 'middle', numFmt: FORMATOS.percentual };
    case 'AS':
      return { fonte: calibri(10), fundo: CORES.clientes, horizontal: 'center', vertical: 'middle', numFmt: FORMATOS.geral };
    case 'AT': return { fonte: calibri(10), vertical: 'middle', numFmt: FORMATOS.geral };
    case 'AU': return { fonte: calibri(10), horizontal: 'left', numFmt: FORMATOS.geral };
    case 'AV': return { fonte: calibri(10), horizontal: 'center', numFmt: FORMATOS.geral };
    case 'AW': return { fonte: calibri(10), horizontal: 'left', numFmt: FORMATOS.geral };
    case 'AX': return { fonte: calibri(11), horizontal: 'center', numFmt: FORMATOS.geral };
    default: return { fonte: calibri(11), horizontal: 'left', numFmt: FORMATOS.geral }; // AY, AZ
  }
}

// ---- Referencias e formulas ----
// Nome de aba na formula: so [A-Za-z0-9_] dispensa aspas simples.
export function referenciaAba(nome: string): string {
  return /^[A-Za-z0-9_]+$/.test(nome) ? nome : `'${nome.replace(/'/g, "''")}'`;
}

const ABA = {
  vendasMes: referenciaAba(FORECAST_SHEETS.vendasMes),
  vendasAtual: referenciaAba(FORECAST_SHEETS.vendasAtual),
  vendasAnual: referenciaAba(FORECAST_SHEETS.vendasAnual),
  estoque: referenciaAba(FORECAST_SHEETS.estoque),
  chegadas: referenciaAba(FORECAST_SHEETS.chegadas),
  programacoes: referenciaAba(FORECAST_SHEETS.programacoes),
  leadtime: referenciaAba(FORECAST_SHEETS.leadtime),
  margem: referenciaAba(FORECAST_SHEETS.margem),
  clientesAtivos: referenciaAba(FORECAST_SHEETS.clientesAtivos),
};

// Intervalo fixo da CLIENTES ATIVOS (a planilha original deslizava linha a linha).
export const INTERVALO_CLIENTES = `${ABA.clientesAtivos}!$C$6:$C$100000`;

// Colunas da media cujo indice (base + i) NAO esta marcado como atipico; todas marcadas: todas (como o motor).
export function colunasDaMedia(colunas: readonly string[], base: number, fora?: ReadonlySet<number>): string[] {
  const validas = colunas.filter((_, i) => !fora?.has(base + i));
  return validas.length === 0 ? [...colunas] : validas;
}

// '02' -> '03'; '12' -> '01'.
export function rotuloMesSeguinte(mm: string): string {
  const n = Number(mm);
  if (!Number.isInteger(n) || n < 1 || n > 12) return '';
  return String((n % 12) + 1).padStart(2, '0');
}

export interface ContextoFormula {
  half: 1 | 2;
  somarChegada5oMes: boolean;
  hoje: string; // YYYY-MM-DD
  fora?: ReadonlySet<number>; // indices 0..6 marcados (J..P)
  ultimaLinhaMargem: number;
  codigos?: readonly string[]; // 7 posicoes alinhadas a B..H: valor da celula, para escapar curinga no criterio
  fonte?: string; // valor da celula AU, idem (criterio do VLOOKUP da AQ)
}

// Curinga (* ? ~) no valor de uma celula vira criterio de SUMIF/SUMIFS/COUNTIF/VLOOKUP: escapa com ~ so quando o valor
// tem curinga. Escapar sempre trocaria a celula vazia por "" (criterio que casa celulas vazias) e quebraria a paridade.
export const TEM_CURINGA = /[*?~]/;
export function criterioLiteral(ref: string, valor: string | null | undefined): string {
  if (!valor || !TEM_CURINGA.test(valor)) return ref;
  return `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(${ref},"~","~~"),"*","~*"),"?","~?")`;
}

const porCodigo = (
  r: number,
  corpo: (ref: string) => string,
  ancora = '',
  codigos?: readonly string[],
): string =>
  `SUM(${COLUNAS_CODIGO.map((c, i) => corpo(criterioLiteral(`${ancora}${c}${r}`, codigos?.[i]))).join(',')})`;

const somaIf = (aba: string, colCodigo: string, colQtd: string, r: number, codigos?: readonly string[]): string =>
  porCodigo(
    r,
    (ref) => `SUMIF(${aba}!${colCodigo}:${colCodigo},${ref},${aba}!${colQtd}:${colQtd})`,
    '',
    codigos,
  );

const somaIfs = (
  aba: string,
  colQtd: string,
  colCodigo: string,
  colMes: string,
  cabecalho: string,
  r: number,
  codigos?: readonly string[],
): string =>
  porCodigo(
    r,
    (ref) =>
      `SUMIFS(${aba}!$${colQtd}:$${colQtd},${aba}!$${colCodigo}:$${colCodigo},${ref},${aba}!$${colMes}:$${colMes},${cabecalho})`,
    '$',
    codigos,
  );

function formulaAR(r: number, ultimaLinhaMargem: number, codigos?: readonly string[]): string {
  const tabela = `${ABA.margem}!$A$2:$B$${ultimaLinhaMargem}`;
  const procura = (c: string) => {
    const i = COLUNAS_CODIGO.indexOf(c as (typeof COLUNAS_CODIGO)[number]);
    return `VLOOKUP(${criterioLiteral(`${c}${r}`, codigos?.[i])},${tabela},2,0)`;
  };
  let formula = `IFERROR(${procura('H')},"")`;
  for (const c of ['G', 'F', 'E', 'D', 'C', 'B']) formula = `IFERROR(${procura(c)},${formula})`;
  return formula;
}

function formulaAP(hoje: string, r: number): string {
  const [ano, mes, dia] = hoje.split('-').map(Number);
  return `DATE(${ano},${mes},${dia})+AQ${r}`;
}

// Formula (sem o '=') da coluna calculada `col` na linha `r`.
export function formulaDaColuna(col: ColunaComFormula, r: number, ctx: ContextoFormula): string {
  const fora = ctx.fora;
  switch (col) {
    case 'O': return somaIf(ABA.vendasMes, 'B', 'D', r, ctx.codigos);
    case 'P': return somaIf(ABA.vendasAtual, 'B', 'D', r, ctx.codigos);
    case 'Q': {
      const cols = colunasDaMedia(['M', 'N', 'O'], 3, fora);
      return `(${cols.map((c) => `${c}${r}`).join('+')})/${cols.length}`;
    }
    case 'R': {
      const cols = colunasDaMedia(['J', 'K', 'L', 'M', 'N', 'O'], 0, fora);
      return `(${cols.map((c) => `${c}${r}`).join('+')})/${cols.length}`;
    }
    case 'S': return `(${somaIf(ABA.vendasAnual, 'B', 'D', r, ctx.codigos)})/11`;
    case 'T': return `Q${r}/30*AQ${r}`;
    case 'U': return somaIf(ABA.estoque, 'A', 'E', r, ctx.codigos);
    case 'V': case 'W': case 'X': case 'Y': case 'Z':
      return somaIfs(ABA.chegadas, 'L', 'E', 'Z', `${col}$2`, r, ctx.codigos);
    case 'AA': return `IF(Q${r}=0,"0",SUM(U${r}:Z${r})/Q${r})`;
    case 'AC': case 'AD': case 'AE': case 'AF':
      return somaIfs(ABA.programacoes, 'D', 'A', 'I', `${col}$2`, r, ctx.codigos);
    case 'AG':
      return ctx.half === 1 || fora?.has(6) ? `Q${r}` : `IF(Q${r}<P${r},P${r},Q${r})`;
    case 'AH': return `U${r}+V${r}-AC${r}-AG${r}`;
    case 'AI': return `AH${r}+W${r}-Q${r}-AD${r}`;
    case 'AJ': return `AI${r}+X${r}-Q${r}-AE${r}`;
    case 'AK': return `AJ${r}+Y${r}-Q${r}-AF${r}`;
    case 'AL': return ctx.somarChegada5oMes ? `AK${r}+Z${r}-Q${r}` : `AK${r}-Q${r}`;
    case 'AM': return `AL${r}-Q${r}`;
    case 'AN': return `(SUM(U${r}:Z${r})-T${r})-Q${r}-(SUM(AC${r}:AF${r}))`;
    case 'AP': return formulaAP(ctx.hoje, r);
    case 'AQ': return `VLOOKUP(${criterioLiteral(`AU${r}`, ctx.fonte)},${ABA.leadtime}!A:G,7,0)`;
    case 'AR': return formulaAR(r, ctx.ultimaLinhaMargem, ctx.codigos);
    case 'AS':
      return COLUNAS_CODIGO.map((c, i) => `COUNTIF(${INTERVALO_CLIENTES},${criterioLiteral(`${c}${r}`, ctx.codigos?.[i])})`).join('+');
  }
}

// Ultima linha da MARGEM que o AR olha: a da planilha (413) ou mais, se o arquivo tiver mais margens.
export const ultimaLinhaDaMargem = (linhasMargem: number): number =>
  Math.max(FORECAST_MARGEM_LAST_ROW, 1 + linhasMargem);

// ---- Formatacao condicional (uma regra por faixa; alerta sempre pela media trimestral $Q) ----
export interface RegraCondicional {
  ref: string;
  formula: string;
  fundo: string;
  fonte?: { cor: string; negrito: boolean };
  prioridade: number;
}

export function regrasCondicionais(ultimaLinha: number): RegraCondicional[] {
  const p = PRIMEIRA_LINHA_PRODUTO;
  return [
    { ref: `A${p}:A${ultimaLinha}`, formula: `COUNTIF($A$${p}:$A$${ultimaLinha},A${p})>1`, fundo: CORES.vermelho, prioridade: 1 },
    { ref: `P${p}:P${ultimaLinha}`, formula: `P${p}>$Q${p}`, fundo: CORES.alertaPicoVenda, prioridade: 2 },
    {
      ref: `AH${p}:AM${ultimaLinha}`,
      formula: `AH${p}<$Q${p}`,
      fundo: CORES.vermelho,
      fonte: { cor: CORES.branco, negrito: true },
      prioridade: 3,
    },
    { ref: `AH${p}:AM${ultimaLinha}`, formula: `AH${p}<$Q${p}*3`, fundo: CORES.alertaLaranja, prioridade: 4 },
    { ref: `AN${p}:AN${ultimaLinha}`, formula: `AND(ISNUMBER(AN${p}),AN${p}<=0)`, fundo: CORES.demandaNegativa, prioridade: 5 },
  ];
}
