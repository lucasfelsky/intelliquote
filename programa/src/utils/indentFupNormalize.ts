// Normalizacao da FUP Importacao Indent: funcoes PURAS (sem banco, sem IO, sem console).
// Os dicionarios abaixo (pais, cidade/fabrica, porto) guardam SO nomes geograficos: o repositorio e PUBLICO e nenhum
// nome de empresa, produto, preco ou dado da planilha pode entrar aqui.
import { cleanProposedName, normalizeItemNameKey } from './commercialItemName';
import type { Bruto } from './forecastXlsx';
import type { FupRow } from './indentFupParse';

// ---------- texto e numeros ----------

/** Maiusculas, sem acento, espacos colapsados. */
export function semAcentoMaiusculo(raw: string): string {
  return cleanProposedName(raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

/** Chave "aproximada": mesma chave de cadastro sem pontuacao, hifen e espacos (so para achar quase-duplicatas). */
export function chaveAproximada(raw: string): string {
  return normalizeItemNameKey(raw).replace(/[^a-z0-9]/g, '');
}

/** Arredonda antes de virar Decimal (3279.9999999999995 -> 3280). */
export function arredondar(x: number, casas: number): number {
  const f = 10 ** casas;
  return Math.round(x * f) / f;
}

// ---------- fornecedor (D2/D10) ----------

export type RegraFornecedor = 'SEM_VARIANTE' | 'PARENTESES' | 'NUMERO_FINAL' | 'COMPOSTO_BARRA';

export interface GrupoFornecedor {
  /** Nome base proposto (antes do sufixo/da barra), como escrito na planilha. */
  base: string;
  baseChave: string;
  /** Fabrica derivada do sufixo (maiuscula) ou, no composto, o texto depois da barra. */
  plant: string | null;
  regra: RegraFornecedor;
  /** Composto com barra: NAO agrupa sozinho (precisa de decisao no de-para). */
  composto: boolean;
}

/**
 * Agrupamento automatico de variantes de fornecedor: sufixo entre parenteses ou numero final (1-2 digitos) vira a
 * fabrica do MESMO fornecedor; composto com barra so propoe (antes da barra = fornecedor, depois = fabrica).
 */
export function agruparFornecedor(raw: string): GrupoFornecedor {
  const limpo = cleanProposedName(raw);
  if (limpo.includes('/')) {
    const partes = limpo.split('/').map((p) => cleanProposedName(p));
    const base = partes[0];
    const depois = partes.slice(1).join('/');
    return {
      base,
      baseChave: normalizeItemNameKey(base),
      plant: depois === '' ? null : depois.toUpperCase(),
      regra: 'COMPOSTO_BARRA',
      composto: true,
    };
  }
  const par = /^(.*\S)\s*\(([^()]+)\)$/.exec(limpo);
  if (par && par[1].trim() !== '') {
    const base = cleanProposedName(par[1]);
    return {
      base,
      baseChave: normalizeItemNameKey(base),
      plant: cleanProposedName(par[2]).toUpperCase(),
      regra: 'PARENTESES',
      composto: false,
    };
  }
  const num = /^(.*[^\d\s])\s+(\d{1,2})$/.exec(limpo);
  if (num) {
    const base = cleanProposedName(num[1]);
    return { base, baseChave: normalizeItemNameKey(base), plant: num[2], regra: 'NUMERO_FINAL', composto: false };
  }
  return { base: limpo, baseChave: normalizeItemNameKey(limpo), plant: null, regra: 'SEM_VARIANTE', composto: false };
}

/** `curta` e subsequencia de `longa` com a mesma 1a letra (possivel sigla/abreviacao; so sugestao a validar). */
export function possivelSigla(curta: string, longa: string): boolean {
  const c = chaveAproximada(curta);
  const l = chaveAproximada(longa);
  if (c.length < 2 || c.length > 5 || l.length < c.length + 2 || c[0] !== l[0]) return false;
  let i = 0;
  for (const ch of l) if (ch === c[i]) i += 1;
  return i === c.length;
}

// ---------- incoterm ----------

export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const;
export type IncotermCodigo = (typeof INCOTERMS)[number];

export interface IncotermNormalizado {
  incoterm: IncotermCodigo | null;
  local: string | null;
  raw: string | null;
  alerta: string | null;
}

export function normalizarIncoterm(raw: string): IncotermNormalizado {
  const original = cleanProposedName(raw);
  if (original === '' || original === '-') return { incoterm: null, local: null, raw: null, alerta: null };
  const texto = semAcentoMaiusculo(original).replace(/^(FCL|LCL)\s*[-:]?\s*/, '');
  const achado = new RegExp(`\\b(${INCOTERMS.join('|')})\\b`).exec(texto);
  if (!achado) return { incoterm: null, local: null, raw: original, alerta: 'incoterm não reconhecido' };
  const resto = texto
    .slice(achado.index + achado[0].length)
    .replace(/^[\s\-:]+/, '')
    .replace(/[()]/g, '')
    .trim();
  return {
    incoterm: achado[1] as IncotermCodigo,
    local: resto === '' ? null : normalizarDestino(resto).destino,
    raw: original,
    alerta: achado.index > 0 ? 'incoterm não estava no início do texto' : null,
  };
}

// ---------- origem ----------

const PAISES = new Set([
  'CHINA',
  'TAIWAN',
  'HONG KONG',
  'INDIA',
  'ARGENTINA',
  'BRASIL',
  'ESTADOS UNIDOS',
  'ALEMANHA',
  'COREIA DO SUL',
  'JAPAO',
  'TAILANDIA',
  'VIETNA',
  'ITALIA',
  'ESPANHA',
  'TURQUIA',
]);
const PAIS_ALIAS: Record<string, string> = { USA: 'ESTADOS UNIDOS', EUA: 'ESTADOS UNIDOS', GERMANY: 'ALEMANHA' };
// Cidade/polo conhecido -> pais.
const CIDADE_PAIS: Record<string, string> = {
  SHANGHAI: 'CHINA',
  ZHUHAI: 'CHINA',
  SUZHOU: 'CHINA',
  QINGDAO: 'CHINA',
  NINGBO: 'CHINA',
  TIANJIN: 'CHINA',
  SHENZHEN: 'CHINA',
  GUANGZHOU: 'CHINA',
  XIAMEN: 'CHINA',
  DALIAN: 'CHINA',
  LUZHU: 'TAIWAN',
  KAOHSIUNG: 'TAIWAN',
  TAIPEI: 'TAIWAN',
};
// Grafias alternativas de uma mesma cidade (unificadas para a grafia do dicionario).
const GRAFIA_CIDADE: Record<string, string> = { LUCHU: 'LUZHU' };

export interface OrigemNormalizada {
  pais: string | null;
  /** Detalhe (cidade/polo) vindo de " - " ou de parenteses. */
  detalhe: string | null;
  raw: string | null;
  reconhecida: boolean;
}

export function normalizarOrigem(raw: string): OrigemNormalizada {
  const original = cleanProposedName(raw);
  if (original === '' || original === '-') return { pais: null, detalhe: null, raw: null, reconhecida: true };
  const partes = semAcentoMaiusculo(original)
    .split(/[()\-–]/)
    .map((p) => cleanProposedName(p))
    .filter((p) => p !== '')
    .map((p) => GRAFIA_CIDADE[p] ?? PAIS_ALIAS[p] ?? p);
  let pais = partes.find((p) => PAISES.has(p)) ?? null;
  if (pais === null) {
    const cidade = partes.find((p) => CIDADE_PAIS[p] !== undefined);
    pais = cidade === undefined ? null : CIDADE_PAIS[cidade];
  }
  const detalhe = partes.find((p) => p !== pais) ?? null;
  return { pais, detalhe, raw: original, reconhecida: pais !== null };
}

// ---------- destino ----------

// Chave (sem acento, maiuscula) -> nome canonico. So geografia.
const DESTINOS: Record<string, string> = {
  SANTOS: 'SANTOS',
  'RIO GRANDE': 'RIO GRANDE',
  PARANAGUA: 'PARANAGUA',
  'BUENOS AIRES': 'BUENOS AIRES',
  NAVEGANTES: 'NAVEGANTES',
  ITAJAI: 'ITAJAI',
  'ITAJAI (NVT)': 'ITAJAI',
  ITAPOA: 'ITAPOA',
  VITORIA: 'VITORIA',
  SALVADOR: 'SALVADOR',
  CALLAO: 'CALLAO',
  'PERU (CALLAO)': 'CALLAO',
  PERU: 'PERU',
  COLOMBIA: 'COLOMBIA',
  CHILE: 'CHILE',
  ARGENTINA: 'ARGENTINA',
  'SAO PAULO': 'SAO PAULO',
  SHANGHAI: 'SHANGHAI',
  ZHUHAI: 'ZHUHAI',
  TAIWAN: 'TAIWAN',
};

export interface DestinoNormalizado {
  destino: string | null;
  raw: string | null;
  reconhecido: boolean;
}

export function normalizarDestino(raw: string): DestinoNormalizado {
  const original = cleanProposedName(raw);
  if (original === '' || original === '-') return { destino: null, raw: null, reconhecido: true };
  const chave = semAcentoMaiusculo(original);
  const canonico = DESTINOS[chave];
  return canonico === undefined
    ? { destino: chave, raw: original, reconhecido: false }
    : { destino: canonico, raw: original, reconhecido: true };
}

// ---------- pagamento ----------

export interface PagamentoNormalizado {
  dias: number | null;
  base: string | null;
  amostra: boolean;
  raw: string | null;
  /** Reconhecido por regra (dias+base, adiantado ou amostra); o resto fica so em `raw`. */
  padronizado: boolean;
}

export function normalizarPagamento(raw: string): PagamentoNormalizado {
  const original = cleanProposedName(raw);
  if (original === '' || original === '-') return { dias: null, base: null, amostra: false, raw: null, padronizado: true };
  const t = semAcentoMaiusculo(original);
  if (t === 'SAMPLES WITH NO COMMERCIAL VALUE') {
    return { dias: null, base: null, amostra: true, raw: original, padronizado: true };
  }
  if (/^T\/T\s+(IN\s+)?ADVANCE$/.test(t)) {
    return { dias: 0, base: 'ADVANCE', amostra: false, raw: original, padronizado: true };
  }
  const m = /^(\d+)\s*DAYS?\s+(FROM|AFTER)\s+(.+)$/.exec(t);
  if (m) {
    return {
      dias: Number(m[1]),
      base: m[2] === 'AFTER' ? `AFTER ${m[3]}` : m[3],
      amostra: false,
      raw: original,
      padronizado: true,
    };
  }
  return { dias: null, base: null, amostra: false, raw: original, padronizado: false };
}

// ---------- NCM ----------

export interface NcmNormalizado {
  /** 8 digitos sem pontos, ou null. */
  ncm: string | null;
  raw: string | null;
  alerta: string | null;
}

export function normalizarNcm(bruto: Bruto): NcmNormalizado {
  const texto = bruto === null ? '' : String(bruto).trim();
  if (texto === '' || texto === '-') return { ncm: null, raw: null, alerta: null };
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length === 8) return { ncm: digitos, raw: texto, alerta: null };
  return { ncm: null, raw: texto, alerta: 'NCM inválido' };
}

// ---------- datas ----------

export interface DataInterpretada {
  /** YYYY-MM-DD (so partes UTC / texto dd/mm/aa; nunca toISOString nem hora local). */
  data: string | null;
  /** Texto original quando nao virou data. */
  bruto: string | null;
  alerta: string | null;
}

function dataValida(a: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(a, m - 1, d));
  if (t.getUTCFullYear() !== a || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function interpretarData(bruto: Bruto): DataInterpretada {
  if (bruto === null) return { data: null, bruto: null, alerta: null };
  if (typeof bruto === 'number') return { data: null, bruto: String(bruto), alerta: 'data inválida' };
  const texto = bruto.trim();
  if (texto === '' || texto === '-') return { data: null, bruto: null, alerta: null };
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (iso) {
    const d = dataValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return d === null ? { data: null, bruto: texto, alerta: 'data inválida' } : { data: d, bruto: null, alerta: null };
  }
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(texto);
  if (br) {
    const ano = br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]);
    const d = dataValida(ano, Number(br[2]), Number(br[1]));
    if (d !== null) return { data: d, bruto: null, alerta: null };
  }
  return { data: null, bruto: texto, alerta: 'data inválida' };
}

// ---------- PO ----------

export interface PoInterpretado {
  /** Chave de comparacao do texto do PO (normalizeItemNameKey). */
  chave: string;
  seq: number | null;
  ano: number | null;
}

/** Padrao "... NNN-AA" (com revisao opcional ".N"); fora do padrao -> seq/ano nulos. */
export function interpretarPo(po: string): PoInterpretado {
  const limpo = cleanProposedName(po);
  const m = /(\d{1,4})-(\d{2})(?:\.\d+)?$/.exec(limpo);
  return {
    chave: normalizeItemNameKey(limpo),
    seq: m ? Number(m[1]) : null,
    ano: m ? 2000 + Number(m[2]) : null,
  };
}

export function chaveOrdem(poChave: string, fornecedorChave: string, clienteChave: string): string {
  return `${poChave}|${fornecedorChave}|${clienteChave}`;
}

export function chaveLinha(produtoChave: string, ordinal: number): string {
  return `${produtoChave}#${ordinal}`;
}

// ---------- janela de vinculos fornecedor-produto (D9) ----------

export interface LinkWindow {
  /** Dia inicial INCLUSIVO (YYYY-MM-DD). */
  start: string;
  /** Dia final INCLUSIVO: a data de referencia. */
  end: string;
  months: number;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Valida uma data YYYY-MM-DD real (sem hora, sem fuso). */
export function isValidDateKey(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m !== null && dataValida(Number(m[1]), Number(m[2]), Number(m[3])) === value;
}

/**
 * Janela [referencia - N meses, referencia], ambos os dias inclusivos, so com aritmetica de chave de data
 * (sem Date local nem toISOString). Dia inexistente no mes de destino vira o ultimo dia (31/05 - 3 meses = 28/02).
 * Devolve null se a referencia for invalida ou N < 1.
 */
export function linkWindow(referenceDate: string, months: number): LinkWindow | null {
  if (!isValidDateKey(referenceDate) || !Number.isInteger(months) || months < 1) return null;
  const y = Number(referenceDate.slice(0, 4));
  const m = Number(referenceDate.slice(5, 7));
  const d = Number(referenceDate.slice(8, 10));
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const ultimoDia = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return { start: `${pad(ny, 4)}-${pad(nm)}-${pad(Math.min(d, ultimoDia))}`, end: referenceDate, months };
}

export function isWithinLinkWindow(poDate: string, window: LinkWindow): boolean {
  return poDate >= window.start && poDate <= window.end;
}

// ---------- decisao do de-para ----------

export type Decisao =
  | { tipo: 'CRIAR' }
  | { tipo: 'USAR'; id: number }
  | { tipo: 'AGRUPAR'; alvo: string }
  | { tipo: 'IGNORAR' }
  | { tipo: 'INVALIDA'; texto: string };

/** `CRIAR` | `USAR:<id>` | `AGRUPAR:<texto FUP>` | `IGNORAR`; vazio -> null (sem decisao). */
export function interpretarDecisao(raw: string): Decisao | null {
  const texto = raw.trim();
  if (texto === '') return null;
  const maiusculo = texto.toUpperCase();
  if (maiusculo === 'CRIAR') return { tipo: 'CRIAR' };
  if (maiusculo === 'IGNORAR') return { tipo: 'IGNORAR' };
  const usar = /^USAR\s*:\s*(\d+)$/.exec(maiusculo);
  if (usar) return { tipo: 'USAR', id: Number(usar[1]) };
  const agrupar = /^AGRUPAR\s*:\s*(.+)$/i.exec(texto);
  if (agrupar && agrupar[1].trim() !== '') return { tipo: 'AGRUPAR', alvo: agrupar[1].trim() };
  return { tipo: 'INVALIDA', texto };
}

// ---------- linha ----------

export const MOTIVO_QUANTIDADE = 'quantidade inválida (estorno não suportado)';
export const MOTIVO_COMPOSTO = 'fornecedor composto sem decisão';

export interface LinhaNormalizada {
  linha: number;
  fornecedorRaw: string;
  clienteRaw: string;
  importadorRaw: string;
  produtoRaw: string;
  po: string;
  refCliente: string;
  grupoFornecedor: GrupoFornecedor;
  clienteChave: string;
  produtoChave: string;
  poInfo: PoInterpretado;
  dataPo: string | null;
  quantidadeKg: number | null;
  precoFornecedor: number | null;
  precoCliente: number | null;
  subtotal: number | null;
  /** Resultado gravado de SUBTOTAL COMISSAO: SO para somar por mes na reconciliacao com o DASH. Nunca em relatorio por linha. */
  comissaoSubtotal: number;
  /** Quantidade crua (numerica) para a reconciliacao: o DASH soma o que esta na celula. */
  quantidadeBruta: number;
  subtotalBruto: number;
  isSample: boolean;
  incoterm: IncotermNormalizado;
  origem: OrigemNormalizada;
  destino: DestinoNormalizado;
  pagamento: PagamentoNormalizado;
  ncm: NcmNormalizado;
  closing: string | null;
  etd: string | null;
  eta: string | null;
  dueDate: string | null;
  datesRaw: Record<string, string>;
  /** Motivos de rejeicao independentes de cadastro/de-para. */
  rejeicoes: string[];
  alertas: string[];
}

const FORMULA_PRECO_FORNECEDOR = /^\$?(J\$?\d+\*\$?I\$?\d+|I\$?\d+\*\$?J\$?\d+)$/i;
const NOMES_CAMPO: Record<string, string> = {
  dataPo: 'DATA PO',
  quantidade: 'QTD',
  precoFornecedor: 'preço do fornecedor',
  precoCliente: 'preço do cliente',
  subtotal: 'SUBTOTAL',
  closing: 'CLOSING',
  etd: 'ETD',
  eta: 'ETA',
  dueDate: 'DUE DATE',
};

function numeroOuNulo(bruto: Bruto, casas: number, alertas: string[], nomeCampo: string): number | null {
  if (bruto === null) return null;
  if (typeof bruto === 'number') {
    if (!Number.isFinite(bruto)) return null;
    return arredondar(bruto, casas);
  }
  if (bruto.trim() === '' || bruto.trim() === '-') return null;
  alertas.push(`${nomeCampo} não numérico`);
  return null;
}

/** Normaliza uma linha da FUP sem consultar cadastro nem de-para (ver conferencia para a resolucao). */
export function normalizarLinha(r: FupRow): LinhaNormalizada {
  const rejeicoes: string[] = [];
  const alertas: string[] = [];
  const datesRaw: Record<string, string> = {};

  if (r.fornecedor === '') rejeicoes.push('fornecedor ausente');
  if (r.cliente === '') rejeicoes.push('cliente ausente');
  if (r.po === '') rejeicoes.push('PO ausente');
  if (r.produto === '') rejeicoes.push('produto ausente');

  const dataPo = interpretarData(r.dataPo);
  if (dataPo.data === null) rejeicoes.push('DATA PO inválida ou ausente');

  const q = typeof r.quantidade === 'number' && Number.isFinite(r.quantidade) ? r.quantidade : null;
  const quantidadeKg = q !== null && q > 0 ? arredondar(q, 3) : null;
  if (quantidadeKg === null) rejeicoes.push(MOTIVO_QUANTIDADE);

  const precoFornecedor = numeroOuNulo(r.precoFornecedor, 6, alertas, NOMES_CAMPO.precoFornecedor);
  const precoCliente = numeroOuNulo(r.precoCliente, 6, alertas, NOMES_CAMPO.precoCliente);
  const subtotal = numeroOuNulo(r.subtotal, 6, alertas, NOMES_CAMPO.subtotal);
  if (precoFornecedor === null) alertas.push('preço do fornecedor ausente');
  if (precoCliente === null) alertas.push('preço do cliente ausente');
  if (r.subtotalFormula !== null && FORMULA_PRECO_FORNECEDOR.test(r.subtotalFormula.replace(/\s+/g, ''))) {
    alertas.push('SUBTOTAL calculado com o preço do fornecedor');
  }
  for (const campo of r.formulaSemResultado) {
    // A comissao nunca entra em alerta por linha (so no perfil da coluna e na reconciliacao agregada).
    if (campo === 'comissaoSubtotal') continue;
    alertas.push(`fórmula sem resultado gravado: ${NOMES_CAMPO[campo] ?? campo}`);
  }

  const ncm = normalizarNcm(r.ncm);
  if (ncm.alerta !== null) alertas.push(ncm.alerta);

  const datas: Record<'closing' | 'etd' | 'eta' | 'dueDate', string | null> = {
    closing: null,
    etd: null,
    eta: null,
    dueDate: null,
  };
  for (const campo of ['closing', 'etd', 'eta', 'dueDate'] as const) {
    const d = interpretarData(r[campo]);
    datas[campo] = d.data;
    if (d.bruto !== null) datesRaw[campo] = d.bruto;
    if (d.alerta !== null) alertas.push(`${d.alerta}: ${NOMES_CAMPO[campo]}`);
  }
  if (dataPo.data !== null && datas.etd !== null && datas.etd < dataPo.data) alertas.push('ETD anterior à DATA PO');
  if (datas.etd !== null && datas.eta !== null && datas.eta < datas.etd) alertas.push('ETA anterior ao ETD');

  const poInfo = interpretarPo(r.po);
  if (dataPo.data !== null && poInfo.ano !== null && Number(dataPo.data.slice(0, 4)) !== poInfo.ano) {
    alertas.push('ano da DATA PO difere do AA do PO');
  }

  const incoterm = normalizarIncoterm(r.incoterm);
  if (incoterm.alerta !== null) alertas.push(incoterm.alerta);
  const origem = normalizarOrigem(r.origem);
  if (!origem.reconhecida) alertas.push('origem não reconhecida');
  const pagamento = normalizarPagamento(r.pagamento);

  return {
    linha: r.linha,
    fornecedorRaw: r.fornecedor,
    clienteRaw: r.cliente,
    importadorRaw: r.importador,
    produtoRaw: r.produto,
    po: r.po,
    refCliente: r.refCliente,
    grupoFornecedor: agruparFornecedor(r.fornecedor),
    clienteChave: normalizeItemNameKey(r.cliente),
    produtoChave: normalizeItemNameKey(r.produto),
    poInfo,
    dataPo: dataPo.data,
    quantidadeKg,
    precoFornecedor,
    precoCliente,
    subtotal,
    comissaoSubtotal: typeof r.comissaoSubtotal === 'number' ? r.comissaoSubtotal : 0,
    quantidadeBruta: typeof r.quantidade === 'number' ? r.quantidade : 0,
    subtotalBruto: typeof r.subtotal === 'number' ? r.subtotal : 0,
    isSample: pagamento.amostra,
    incoterm,
    origem,
    destino: normalizarDestino(r.destino),
    pagamento,
    ncm,
    closing: datas.closing,
    etd: datas.etd,
    eta: datas.eta,
    dueDate: datas.dueDate,
    datesRaw,
    rejeicoes,
    alertas,
  };
}
