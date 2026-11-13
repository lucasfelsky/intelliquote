// FUP SINTETICA (anonimizada, gerada por codigo) para os testes da conferencia da FUP Indent.
// Nenhum nome, produto, preco ou quantidade e real: tudo aqui e inventado. Nada e gravado em disco: o workbook e
// escrito em buffer e lido de volta (para exercitar o mesmo caminho de leitura do exceljs que a planilha real usa).
import ExcelJS from 'exceljs';

export const HEADERS = [
  'FORNECEDOR',
  'CLIENTE',
  'IMPORTADOR',
  'PO',
  'REF CLIENTE',
  'DATA PO',
  'PRODUTOS',
  'NCM',
  'QTD - KGS',
  'PREÇO (USD)\nFORNECE.',
  'PREÇO (USD)\nCLIENTE',
  'SUBTOTAL',
  'COMISSÃO\nUSD/KG',
  'SUBTOTAL\nCOMISSÃO',
  'INCOTERM',
  'COMERCIAL INVOICE',
  'APROV. DOCS',
  'COA',
  'HBL',
  'TRACKING NUMBER',
  'ORIGEM \nPAÍS',
  'DESTINO',
  'NAVIO',
  'CLOSING DATE',
  'ETD',
  'ETA',
  'STATUS',
  'FOLLOW-UP',
  null, // coluna 29 sem nome
  'PAYMENT TERMS',
  'DUE DATE',
  'PAGAMENTO FORNECEDOR',
  'PAGAMENTO COMISSÃO',
  'INVOICE DE COMISSÃO',
  'REP. COMERCIAL',
  'STATUS\nCOMM.',
] as const;

/** Textos que NUNCA podem aparecer na leitura (colunas 33-36). */
export const SENTINELAS_COLUNAS_33_36 = ['SENT-PAGCOM', 'SENT-INVCOM', 'SENT-REPCOM', 'SENT-STCOM'];

type Dado = Date | string | number | null;
export interface Spec {
  forn: string;
  cli: string;
  imp: string;
  po: string;
  ref: string;
  data: Dado;
  prod: string | { richText: { text: string }[] };
  ncm: Dado;
  qtd: Dado;
  pf: number | null;
  pc: number | null;
  /** 'auto' = formula I*K com resultado; 'jxi' = formula J*I; numero = valor fixo; null = vazio. */
  sub: 'auto' | 'jxi' | number | null;
  /** 'auto' = formula com resultado (qtd x 0,1); 'semResultado' = formula sem resultado; numero fixo; null. */
  com: 'auto' | 'semResultado' | number | null;
  inc: string;
  orig: string;
  dest: string;
  closing: Dado;
  etd: Dado;
  eta: Dado;
  status: string;
  extra: string;
  pag: string;
  due: Dado;
}

/** Data de referencia fixa dos testes da janela de vinculos. */
export const DATA_REFERENCIA_FIXTURE = '2026-11-13';

export const utc = (a: number, m: number, d: number): Date => new Date(Date.UTC(a, m - 1, d));

const PADRAO: Spec = {
  forn: 'FORN ALFA',
  cli: 'CLIENTE UM',
  imp: 'CLIENTE UM',
  po: 'ALFA TST 001-24',
  ref: 'REF-1',
  data: utc(2024, 1, 15),
  prod: 'PRODUTO X-100',
  ncm: '1111.22.33',
  qtd: 1000,
  pf: 1.5,
  pc: 2,
  sub: 'auto',
  com: 'auto',
  inc: 'FCL - CFR SANTOS',
  orig: 'CHINA (SHANGHAI)',
  dest: 'SANTOS',
  closing: utc(2024, 1, 25),
  etd: utc(2024, 2, 1),
  eta: utc(2024, 3, 10),
  status: 'ENTREGUE',
  extra: '',
  pag: '90 days from B/L date',
  due: utc(2024, 6, 1),
};

const L = (o: Partial<Spec> = {}): Spec => ({ ...PADRAO, ...o });

/** ~45 linhas cobrindo os casos de borda do plano. A ordem importa (ordinais e numeros de linha). */
export const LINHAS_SINTETICAS: Spec[] = [
  // 1-3: variantes de fornecedor
  L(),
  L({ forn: 'FORN ALFA (FAB 1)', po: 'ALFA TST 002-24', data: utc(2024, 1, 20), orig: 'TAIWAN - LUCHU' }),
  L({ forn: 'FORN ALFA (FAB 2)', po: 'ALFA TST 003-24', data: utc(2024, 2, 5), orig: 'TAIWAN - LUZHU' }),
  // 4: numero final
  L({ forn: 'FORN BETA 2', po: 'BETA TST 001-24', data: utc(2024, 2, 10), prod: 'PRODUTO Y-200', ncm: '4444.55.66' }),
  L({ forn: 'FORN BETA', po: 'BETA TST 002-24', data: utc(2024, 2, 11), prod: 'PRODUTO Y-200', ncm: '4444.55.66' }),
  // 6: composto com barra (sem decisao = rejeitada)
  L({ forn: 'FORN GAMA/FORN DELTA', po: 'GAMA TST 001-24', data: utc(2024, 3, 1) }),
  // 7-8: caixa/acento/espacos e quase-duplicata de produto
  L({ cli: 'cliente  úm ', imp: 'OUTRO IMPORTADOR', po: 'ALFA TST 004-24', data: utc(2024, 3, 5), prod: 'Produto X-100 ' }),
  L({ po: 'ALFA TST 005-24', data: utc(2024, 3, 6), prod: 'PRODUTO X 100' }),
  // 9-10: preco 0 e preco vazio
  L({ po: 'ALFA TST 006-24', data: utc(2024, 3, 7), pf: 0, prod: 'PRODUTO Z-300' }),
  L({ po: 'ALFA TST 007-24', data: utc(2024, 3, 8), pf: null, prod: 'PRODUTO Z-300' }),
  // 11-13: quantidade invalida
  L({ po: 'ALFA TST 008-24', data: utc(2024, 3, 9), qtd: 0, sub: 0, com: 0 }),
  L({ po: 'ALFA TST 009-24', data: utc(2024, 3, 9), qtd: -5, sub: -10, com: -0.5 }),
  L({ po: 'ALFA TST 010-24', data: utc(2024, 3, 9), qtd: 'abc', sub: null, com: null }),
  // 14-15: mesmo PO com clientes diferentes
  L({ po: 'ALFA TST 011-24', data: utc(2024, 4, 2), cli: 'CLIENTE DOIS' }),
  L({ po: 'ALFA TST 011-24', data: utc(2024, 4, 2), cli: 'CLIENTE TRES' }),
  // 16-17: PO + produto repetido (ordinal)
  L({ po: 'ALFA TST 012-24', data: utc(2024, 4, 10), prod: 'PRODUTO W-400', qtd: 500 }),
  L({ po: 'ALFA TST 012-24', data: utc(2024, 4, 10), prod: 'PRODUTO W-400', qtd: 700 }),
  // 18: amostra
  L({ po: 'ALFA TST 013-24', data: utc(2024, 4, 12), pag: 'SAMPLES WITH NO COMMERCIAL VALUE', prod: 'PRODUTO S-500' }),
  // 19-20: datas em 31/12 e 01/01 (UTC)
  L({ po: 'ALFA TST 014-24', data: utc(2024, 12, 31), etd: utc(2025, 1, 5), eta: utc(2025, 2, 1) }),
  L({ po: 'ALFA TST 001-25', data: utc(2025, 1, 1), etd: utc(2025, 1, 20), eta: utc(2025, 2, 20) }),
  // 21-24: datas em texto
  L({ po: 'ALFA TST 002-25', data: utc(2025, 1, 10), eta: '31/11/24' }),
  L({ po: 'ALFA TST 003-25', data: utc(2025, 1, 11), eta: '-', etd: '05/02/25' }),
  L({ po: 'ALFA TST 004-25', data: utc(2025, 1, 12), etd: '03/0218' }),
  L({ po: 'ALFA TST 005-25', data: utc(2025, 1, 13), due: '18//01/26', closing: '10/01/2025' }),
  // 25-26: DATA PO invalida / ausente
  L({ po: 'ALFA TST 006-25', data: 'em breve' }),
  L({ po: 'ALFA TST 007-25', data: null }),
  // 27: ponto flutuante
  L({ po: 'ALFA TST 008-25', data: utc(2025, 2, 3), qtd: 3279.9999999999995, pc: 2, sub: 'auto', prod: 'PRODUTO F-600' }),
  // 28-29: formula sem resultado (comissao) e SUBTOTAL com preco do fornecedor
  L({ po: 'ALFA TST 009-25', data: utc(2025, 2, 4), com: 'semResultado' }),
  L({ po: 'ALFA TST 010-25', data: utc(2025, 2, 5), sub: 'jxi' }),
  // 30-32: NCM
  L({ po: 'ALFA TST 011-25', data: utc(2025, 2, 6), ncm: '1111.22', prod: 'PRODUTO N-700' }),
  L({ po: 'ALFA TST 012-25', data: utc(2025, 2, 7), ncm: '-', prod: 'PRODUTO N-700' }),
  L({ po: 'ALFA TST 013-25', data: utc(2025, 2, 8), ncm: '9999.88.77', prod: 'PRODUTO X-100' }),
  // 33-36: campos obrigatorios ausentes
  L({ po: 'ALFA TST 014-25', data: utc(2025, 3, 1), forn: '' }),
  L({ po: 'ALFA TST 015-25', data: utc(2025, 3, 1), cli: '' }),
  L({ po: '', data: utc(2025, 3, 1) }),
  L({ po: 'ALFA TST 016-25', data: utc(2025, 3, 1), prod: '' }),
  // 37-39: incoterm
  L({ po: 'ALFA TST 017-25', data: utc(2025, 3, 2), inc: 'FOB-SHANGHAI' }),
  L({ po: 'ALFA TST 018-25', data: utc(2025, 3, 3), inc: 'COURIER X (DAP-LOCAL Z)' }),
  L({ po: 'ALFA TST 019-25', data: utc(2025, 3, 4), inc: 'XYZ SANTOS' }),
  // 40-42: origem, destino e pagamento
  L({ po: 'ALFA TST 020-25', data: utc(2025, 3, 5), orig: 'NINGBO (CHINA)', dest: 'ITAJAÍ' }),
  L({ po: 'ALFA TST 021-25', data: utc(2025, 3, 6), pag: 'T/T ADVANCE', dest: 'PERU (CALLAO)' }),
  L({ po: 'ALFA TST 022-25', data: utc(2025, 3, 7), pag: '50% T/T ADV. 50% ARRIVAL', orig: 'LUGAR INEXISTENTE' }),
  // 43: texto rico no produto + ano do PO diferente da DATA PO
  L({ po: 'ALFA TST 023-24', data: utc(2025, 3, 8), prod: { richText: [{ text: 'PRODUTO ' }, { text: 'R-800' }] } }),
  // 44: ETD antes da DATA PO e ETA antes do ETD
  L({ po: 'ALFA TST 024-25', data: utc(2025, 4, 1), etd: utc(2025, 3, 1), eta: utc(2025, 2, 1) }),
  // 45: 2023 (fora do DASH)
  L({ po: 'ALFA TST 001-23', data: utc(2023, 6, 6) }),
  // 46-49: limite da janela de vinculos (referencia 2026-11-13): 24 meses = 2024-11-13, 12 meses = 2025-11-13
  L({ forn: 'FORN LIM', po: 'LIM TST 001-24', data: utc(2024, 11, 13), prod: 'PRODUTO L-1' }),
  L({ forn: 'FORN LIM', po: 'LIM TST 002-24', data: utc(2024, 11, 12), prod: 'PRODUTO L-2' }),
  L({ forn: 'FORN LIM', po: 'LIM TST 001-25', data: utc(2025, 11, 13), prod: 'PRODUTO L-3' }),
  L({ forn: 'FORN LIM', po: 'LIM TST 002-25', data: utc(2025, 11, 12), prod: 'PRODUTO L-4' }),
  // 50-51: rejeitadas com fornecedor/cliente/produto EXCLUSIVOS (nao aparecem em nenhuma linha aceita)
  L({ forn: 'FORN SO REJEITADA', cli: 'CLIENTE SO REJEITADO', po: 'REJ TST 001-25', data: utc(2025, 5, 5), prod: 'PRODUTO SO REJEITADO', qtd: 0, sub: 0, com: 0 }),
  L({ forn: 'FORN SO REJEITADA', cli: 'CLIENTE SO REJEITADO', po: 'REJ TST 002-25', data: null, prod: 'PRODUTO SO REJEITADO 2' }),
];

export interface MetricasEsperadas {
  comissao: number;
  faturamento: number;
  volume: number;
}

function valorSub(s: Spec): number | null {
  if (s.sub === null) return null;
  const q = typeof s.qtd === 'number' ? s.qtd : 0;
  if (s.sub === 'auto') return q * (s.pc ?? 0);
  if (s.sub === 'jxi') return (s.pf ?? 0) * q;
  return s.sub;
}
function valorCom(s: Spec): number | null {
  if (s.com === null) return null;
  const q = typeof s.qtd === 'number' ? s.qtd : 0;
  if (s.com === 'auto') return Math.round(q * 0.1 * 100) / 100;
  if (s.com === 'semResultado') return 0;
  return s.com;
}

/** Totais por `YYYY-MM` calculados DIRETO dos specs (independente do codigo testado): so linhas com DATA PO Date. */
export function esperadoPorMes(specs: readonly Spec[] = LINHAS_SINTETICAS): Record<string, MetricasEsperadas> {
  const mapa: Record<string, MetricasEsperadas> = {};
  for (const s of specs) {
    if (!(s.data instanceof Date)) continue;
    const k = `${s.data.getUTCFullYear()}-${String(s.data.getUTCMonth() + 1).padStart(2, '0')}`;
    const m = (mapa[k] ??= { comissao: 0, faturamento: 0, volume: 0 });
    m.comissao += valorCom(s) ?? 0;
    m.faturamento += valorSub(s) ?? 0;
    m.volume += typeof s.qtd === 'number' ? s.qtd : 0;
  }
  return mapa;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export interface OpcoesFup {
  /** Soma em um mes do DASH (ex.: { '2024-03': { faturamento: 1 } }). */
  ajusteDash?: Record<string, Partial<MetricasEsperadas>>;
  /** Zera o DASH de um mes (tabela dinamica nao atualizada). */
  zerarDash?: string[];
  /** Zera so algumas metricas do DASH de um mes (DASH PARCIAL: nao e "desatualizado", e divergencia). */
  zerarMetricaDash?: Record<string, ('comissao' | 'faturamento' | 'volume')[]>;
  /** Soma na linha "Total Geral" do ano (alem do que a soma dos meses ja da). Chave = ano (ex.: '2025'). */
  ajusteTotalDash?: Record<string, Partial<MetricasEsperadas>>;
  /** Troca os rotulos de mes do DASH (layout desconhecido: nenhum mes reconhecido). */
  rotulosMesDash?: string[];
  specs?: Spec[];
}

function celulaSub(s: Spec, r: number): ExcelJS.CellValue {
  const v = valorSub(s);
  if (s.sub === null) return null;
  if (s.sub === 'auto') return v === 0 ? { formula: `I${r}*K${r}` } : { formula: `I${r}*K${r}`, result: v as number };
  if (s.sub === 'jxi') return { formula: `J${r}*I${r}`, result: v as number };
  return s.sub;
}
function celulaCom(s: Spec, r: number): ExcelJS.CellValue {
  if (s.com === null) return null;
  if (s.com === 'semResultado') return { formula: `M${r}*I${r}` };
  if (s.com === 'auto') return { formula: `M${r}*I${r}`, result: valorCom(s) as number };
  return s.com;
}

/** Monta o workbook, grava em buffer e le de volta (mesmo caminho de leitura de um .xlsx real). */
export async function montarFupSintetica(opcoes: OpcoesFup = {}): Promise<ExcelJS.Workbook> {
  const specs = opcoes.specs ?? LINHAS_SINTETICAS;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('INDENT SALES');
  ws.addRow([...HEADERS]);
  specs.forEach((s, i) => {
    const r = i + 2;
    const v: ExcelJS.CellValue[] = new Array(36).fill(null);
    v[0] = s.forn === '' ? null : s.forn;
    v[1] = s.cli === '' ? null : s.cli;
    v[2] = s.imp;
    v[3] = s.po === '' ? null : s.po;
    v[4] = s.ref;
    v[5] = s.data;
    v[6] = s.prod === '' ? null : s.prod;
    v[7] = s.ncm;
    v[8] = s.qtd;
    v[9] = s.pf;
    v[10] = s.pc;
    v[11] = celulaSub(s, r);
    v[12] = 0.1;
    v[13] = celulaCom(s, r);
    v[14] = s.inc === '' ? null : s.inc;
    v[15] = 'INV-1';
    v[20] = s.orig === '' ? null : s.orig;
    v[21] = s.dest === '' ? null : s.dest;
    v[23] = s.closing;
    v[24] = s.etd;
    v[25] = s.eta;
    v[26] = s.status;
    v[28] = s.extra === '' ? null : s.extra;
    v[29] = s.pag;
    v[30] = s.due;
    // Colunas 33-36: nunca podem ser lidas.
    v[32] = SENTINELAS_COLUNAS_33_36[0];
    v[33] = SENTINELAS_COLUNAS_33_36[1];
    v[34] = SENTINELAS_COLUNAS_33_36[2];
    v[35] = SENTINELAS_COLUNAS_33_36[3];
    ws.addRow(v);
  });
  // Linha totalmente vazia no fim (ignorada pela leitura).
  ws.addRow(new Array(36).fill(null));

  // DASH coerente: anos 2024-2025 (3 colunas por ano), meses jan..dez, "Total Geral".
  const dash = wb.addWorksheet('DASH');
  const esperado = esperadoPorMes(specs);
  dash.getCell(4, 2).value = 'Rótulos de Coluna';
  for (let a = 0; a < 2; a += 1) {
    const ano = 2024 + a;
    ['COMISSÃO', 'FATURAMENTO', 'VOLUME'].forEach((m, j) => {
      dash.getCell(5, 2 + a * 3 + j).value = ano;
      dash.getCell(6, 2 + a * 3 + j).value = m;
    });
  }
  dash.getCell(6, 1).value = 'MÊSES';
  const totais = [0, 0, 0, 0, 0, 0];
  MESES.forEach((nome, mi) => {
    const row = 7 + mi;
    dash.getCell(row, 1).value = opcoes.rotulosMesDash?.[mi] ?? nome;
    for (let a = 0; a < 2; a += 1) {
      const chave = `${2024 + a}-${String(mi + 1).padStart(2, '0')}`;
      const e = esperado[chave] ?? { comissao: 0, faturamento: 0, volume: 0 };
      const aj = opcoes.ajusteDash?.[chave] ?? {};
      const zerar = opcoes.zerarDash?.includes(chave) ?? false;
      const parcial = opcoes.zerarMetricaDash?.[chave] ?? [];
      const vals = zerar
        ? [0, 0, 0]
        : [
            parcial.includes('comissao') ? 0 : e.comissao + (aj.comissao ?? 0),
            parcial.includes('faturamento') ? 0 : e.faturamento + (aj.faturamento ?? 0),
            parcial.includes('volume') ? 0 : e.volume + (aj.volume ?? 0),
          ];
      vals.forEach((x, j) => {
        dash.getCell(row, 2 + a * 3 + j).value = x;
        totais[a * 3 + j] += x;
      });
    }
  });
  dash.getCell(19, 1).value = 'Total Geral';
  const chavesMetrica = ['comissao', 'faturamento', 'volume'] as const;
  totais.forEach((x, j) => {
    const ano = String(2024 + Math.floor(j / 3));
    const extra = opcoes.ajusteTotalDash?.[ano]?.[chavesMetrica[j % 3]] ?? 0;
    dash.getCell(19, 2 + j).value = x + extra;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const lido = new ExcelJS.Workbook();
  await lido.xlsx.load(buffer);
  return lido;
}
