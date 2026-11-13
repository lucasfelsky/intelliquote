// Notas do negocio do Pipedrive -> texto e itens propostos do IQ Indent. Funcoes PURAS (sem banco, sem IO, sem console).
// Sem dependencia de HTML: o backend nao tem parser, entao o HTML e percorrido por um tokenizador linear proprio.
// O resultado de `noteHtmlToText` e TEXTO (a web mostra em <pre>); nunca e reinjetado como HTML e nada e executado.
// Dados de teste: so fixtures ficticias (o repositorio e PUBLICO).
import { cleanProposedName, normalizeItemNameKey } from './commercialItemName';
import type { PdNote } from '../lib/pipedriveClient';

export const NOTE_HTML_MAX_CHARS = 100_000;
export const NOTE_TEXT_MAX_CHARS = 20_000;
export const NOTE_MAX_ITEMS = 50;
const MAX_ITEM_TEXT_CHARS = 160;
const MAX_QUANTITY_KG = 1e9;

// ---------- HTML -> texto ----------

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: '\u00a0',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
const ENTITY_PATTERN = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(nbsp|amp|lt|gt|quot|apos));/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const BLOCK_TAGS = new Set(['div', 'p', 'li', 'ul', 'ol', 'table', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const DROP_WITH_CONTENT = new Set(['script', 'style']);
const CLOSE_SCRIPT = /<\/script/gi;
const CLOSE_STYLE = /<\/style/gi;

/** Decodifica uma unica vez (sem dupla decodificacao); codigo fora de 1..0x10FFFF ou substituto mantem o literal. */
function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (literal, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) {
      return NAMED_ENTITIES[name.toLowerCase()] ?? literal;
    }
    const code = dec !== undefined ? Number(dec) : Number.parseInt(hex as string, 16);
    if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return literal;
    }
    return String.fromCodePoint(code);
  });
}

/**
 * HTML da nota -> texto. Percorre as tags em passo unico (linear): `<script>`/`<style>` somem com o conteudo, `<br>` e
 * fechamento de bloco viram quebra de linha, fim de celula vira TAB (o conteudo da celula fica em uma linha so), as
 * demais tags somem (o texto de `<a data-mentions>` fica). Tag aberta sem `>` descarta o resto.
 */
export function noteHtmlToText(html: string): string {
  const src = String(html ?? '').slice(0, NOTE_HTML_MAX_CHARS);
  let out = '';
  let inCell = false;
  let i = 0;

  const ensureLineStart = (): void => {
    if (!inCell && out !== '' && !out.endsWith('\n')) {
      out += '\n';
    }
  };
  // <br> sempre quebra (linha em branco = <div><br></div>); fechamento de bloco so quebra se a linha ainda esta aberta.
  const lineBreak = (): void => {
    out += inCell ? ' ' : '\n';
  };
  const closeBlock = (): void => {
    if (inCell) {
      out += ' ';
    } else if (out !== '' && !out.endsWith('\n')) {
      out += '\n';
    }
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, lt);

    if (!/[A-Za-z!/?]/.test(src.charAt(lt + 1))) {
      out += '<'; // "a < b": nao e tag
      i = lt + 1;
      continue;
    }
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end === -1) {
        break;
      }
      i = end + 3;
      continue;
    }
    const gt = src.indexOf('>', lt + 1);
    if (gt === -1) {
      break;
    }
    i = gt + 1;

    const tag = /^(\/?)\s*([A-Za-z][A-Za-z0-9]*)/.exec(src.slice(lt + 1, gt));
    if (!tag) {
      continue; // <!DOCTYPE ...>, <?xml ...>
    }
    const closing = tag[1] === '/';
    const name = (tag[2] as string).toLowerCase();

    if (DROP_WITH_CONTENT.has(name) && !closing) {
      // Fecha com busca por regex sobre `src` (sem baixar a caixa do texto: toLowerCase pode mudar o comprimento).
      const closer = name === 'script' ? CLOSE_SCRIPT : CLOSE_STYLE;
      closer.lastIndex = i;
      const closeMatch = closer.exec(src);
      if (closeMatch === null) {
        break;
      }
      const closeEnd = src.indexOf('>', closeMatch.index);
      if (closeEnd === -1) {
        break;
      }
      i = closeEnd + 1;
      continue;
    }
    if (name === 'br') {
      lineBreak();
    } else if (name === 'td' || name === 'th') {
      if (closing) {
        inCell = false;
        out += '\t';
      } else {
        inCell = true;
      }
    } else if (name === 'tr') {
      inCell = false;
      if (closing) {
        closeBlock();
      } else {
        ensureLineStart();
      }
    } else if (BLOCK_TAGS.has(name)) {
      if (closing) {
        closeBlock();
      } else {
        ensureLineStart();
      }
    }
  }

  const lines = decodeEntities(out)
    .replace(/\u00a0/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \f\v]+/g, ' ')
        .replace(/ ?\t ?/g, '\t')
        .replace(/^ +/, '')
        .trimEnd(), // nesta altura a linha nao tem \n, \r nem NBSP; trimEnd e linear (a regex `[ \t]+$` era quadratica)
    );

  const compact: string[] = [];
  for (const line of lines) {
    if (line === '' && (compact.length === 0 || compact[compact.length - 1] === '')) {
      continue;
    }
    compact.push(line);
  }
  while (compact.length > 0 && compact[compact.length - 1] === '') {
    compact.pop();
  }
  return compact.join('\n').slice(0, NOTE_TEXT_MAX_CHARS);
}

/** `data-mentions="AUTOR:MENCIONADO"` (ids do Pipedrive) em ordem de aparicao. */
export function extractMentions(html: string): Array<{ authorId: number; mentionedId: number }> {
  const result: Array<{ authorId: number; mentionedId: number }> = [];
  const source = String(html ?? '').slice(0, NOTE_HTML_MAX_CHARS);
  for (const match of source.matchAll(/data-mentions="(\d+):(\d+)"/g)) {
    result.push({ authorId: Number(match[1]), mentionedId: Number(match[2]) });
  }
  return result;
}

// ---------- quantidade e incoterm ----------

const INCOTERMS = 'EXW|FCA|FAS|FOB|CFR|CPT|CIF|CIP|DAP|DPU|DDP';
const INCOTERM_CODE = new RegExp(`^(?:${INCOTERMS})$`, 'i');
// "CFR Santos" ou "CFR Santos - Fabricante Exemplo": incoterm, porto/destino, fornecedor/fabricante (opcional).
const INCOTERM_LINE = new RegExp(`^(${INCOTERMS})\\s+(.+?)(?:\\s+[-–]\\s+(.+))?$`, 'i');
// O mesmo no fim de uma linha de quantidade: "500.000 kg - CFR Santos".
const INCOTERM_TAIL = new RegExp(`\\s+[-–]\\s+(${INCOTERMS})\\s+(.+?)(?:\\s+[-–]\\s+(.+))?$`, 'i');
const QUANTITY_TOKEN = '(\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,(\\d+))?\\s*(kg|kgs|t|ton|mt)?';
const QUANTITY_ONLY = new RegExp(`^${QUANTITY_TOKEN}$`, 'i');
const QUANTITY_TAIL = new RegExp(`(?<![\\d.,])${QUANTITY_TOKEN}\\s*$`, 'i');
const IGNORED_LINE = /pode(?:m)?\s+(?:cotar|atualizar)|por favor|obrigad|bom dia|boa tarde/i;

/** Converte os grupos (inteiro com ponto de milhar, decimal, unidade) em kg; `null` se <= 0 ou > 1e9. */
function quantityToKg(integer: string, decimal: string | undefined, unit: string | undefined): number | null {
  const base = Number(`${integer.replace(/\./g, '')}${decimal ? `.${decimal}` : ''}`);
  const factor = unit && /^(t|ton|mt)$/i.test(unit) ? 1000 : 1;
  const kg = Math.round(base * factor * 1000) / 1000;
  return Number.isFinite(kg) && kg > 0 && kg <= MAX_QUANTITY_KG ? kg : null;
}

/** Texto que e SO quantidade pt-BR ("2.000", "2,5 t", "25 MT", "500.000 kg"); outro texto -> `undefined`. */
export function parseQuantityKg(text: string): number | null | undefined {
  const match = QUANTITY_ONLY.exec(text.trim());
  return match ? quantityToKg(match[1] as string, match[2], match[3]) : undefined;
}

// ---------- itens ----------

export interface NoteCatalogProduct {
  id: number;
  name: string;
  acronym?: string | null;
  synonyms?: string[] | null;
}

export interface ParsedNoteItem {
  text: string;
  quantityKg: number | null;
  productId: number | null;
  /** Numero da linha (1-based) no texto da nota. */
  line: number;
}

export interface ParsedDealNote {
  mode: 'table' | 'lines' | 'none';
  items: ParsedNoteItem[];
  incoterm: string | null;
  destination: string | null;
  supplierHint: string | null;
  ignoredLines: number;
}

/** Casa o texto com UM produto do catalogo (nome, sinonimo ou sigla; sigla entre parenteses); 0 ou varios -> `null`. */
function matchCatalog(text: string, catalog: NoteCatalogProduct[]): number | null {
  if (catalog.length === 0) {
    return null;
  }
  const candidates = new Set<string>();
  const textKey = normalizeItemNameKey(text);
  if (textKey) {
    candidates.add(textKey);
  }
  const paren = /\(([^()]+)\)\s*$/.exec(text);
  if (paren) {
    const parenKey = normalizeItemNameKey(paren[1] as string);
    const withoutParenKey = normalizeItemNameKey(text.slice(0, paren.index));
    if (parenKey) candidates.add(parenKey);
    if (withoutParenKey) candidates.add(withoutParenKey);
  }
  const ids = new Set<number>();
  for (const product of catalog) {
    const keys = [product.name, product.acronym ?? '', ...(product.synonyms ?? [])]
      .map((value) => normalizeItemNameKey(value))
      .filter((value) => value !== '');
    if (keys.some((key) => candidates.has(key))) {
      ids.add(product.id);
    }
  }
  return ids.size === 1 ? ([...ids][0] as number) : null;
}

interface Metadata {
  incoterm: string | null;
  destination: string | null;
  supplierHint: string | null;
}

function takeMetadata(target: Metadata, incoterm: string | null, destination?: string | null, supplier?: string | null): void {
  if (incoterm && target.incoterm !== null) {
    return; // o primeiro incoterm citado vale por inteiro (nao mistura porto/fornecedor de linhas diferentes)
  }
  if (incoterm) {
    target.incoterm = incoterm.toUpperCase();
  }
  const dest = destination ? cleanProposedName(destination) : '';
  if (dest && target.destination === null) {
    target.destination = dest;
  }
  const hint = supplier ? cleanProposedName(supplier) : '';
  if (hint && target.supplierHint === null) {
    target.supplierHint = hint;
  }
}

const HAS_LETTER = /\p{L}/u;

/** Remove separadores e espacos do fim (laco linear; a regex `[-:;,]+\s*$` e quadratica em "-----...x"). */
function stripTrailingSeparators(text: string): string {
  let end = text.length;
  while (end > 0 && /[\s\-–:;,]/.test(text.charAt(end - 1))) {
    end -= 1;
  }
  return text.slice(0, end);
}

function isTableRow(line: string): boolean {
  return line.includes('\t') && line.split('\t').filter((cell) => cell.trim() !== '').length >= 2;
}

interface HeaderMap {
  product: number;
  quantity: number;
  incoterm: number;
  destination: number;
  supplier: number;
}

/** Linha sem digitos com uma celula produto|descri|item|material e outra quant|qtd|volume|kg|ton. */
function detectHeader(cells: string[]): HeaderMap | null {
  if (cells.some((cell) => /\d/.test(cell))) {
    return null;
  }
  const map: HeaderMap = { product: -1, quantity: -1, incoterm: -1, destination: -1, supplier: -1 };
  cells.forEach((cell, index) => {
    const key = cell.toLowerCase();
    if (map.product === -1 && /produto|descri|item|material/.test(key)) {
      map.product = index;
    } else if (map.quantity === -1 && /quant|qtd|volume|\bkg\b|ton/.test(key)) {
      map.quantity = index;
    } else if (map.incoterm === -1 && /incoterm/.test(key)) {
      map.incoterm = index;
    } else if (map.destination === -1 && /porto|destino/.test(key)) {
      map.destination = index;
    } else if (map.supplier === -1 && /fornecedor|fabricante/.test(key)) {
      map.supplier = index;
    }
  });
  return map.product !== -1 && map.quantity !== -1 ? map : null;
}

function readTableRow(cells: string[], header: HeaderMap | null, meta: Metadata): { text: string; quantityKg: number | null } | null {
  if (!header && INCOTERM_CODE.test(cells[0] ?? '')) {
    takeMetadata(meta, cells[0] as string, cells[1], cells[2]);
    return null; // linha "CFR | Santos | Fabricante": metadado, nao item
  }
  let productCell: string | undefined;
  let quantityCell: string | undefined;
  if (header) {
    productCell = cells[header.product];
    quantityCell = cells[header.quantity];
    const incotermCell = header.incoterm === -1 ? undefined : cells[header.incoterm];
    takeMetadata(
      meta,
      incotermCell && INCOTERM_CODE.test(incotermCell) ? incotermCell : null,
      header.destination === -1 ? null : cells[header.destination],
      header.supplier === -1 ? null : cells[header.supplier],
    );
  } else {
    productCell = cells.find((cell) => HAS_LETTER.test(cell) && !INCOTERM_CODE.test(cell) && parseQuantityKg(cell) === undefined);
    for (let index = cells.length - 1; index >= 0; index -= 1) {
      if (parseQuantityKg(cells[index] as string) !== undefined) {
        quantityCell = cells[index];
        break;
      }
    }
  }
  const text = cleanProposedName(productCell ?? '');
  if (text === '' || !HAS_LETTER.test(text) || text.length > MAX_ITEM_TEXT_CHARS) {
    return null;
  }
  const quantity = quantityCell === undefined ? undefined : parseQuantityKg(quantityCell);
  return { text, quantityKg: quantity ?? null };
}

/**
 * Texto da nota -> itens propostos + incoterm/destino/fornecedor citados.
 * Tabela (celulas separadas por TAB): com cabecalho (produto + quantidade) ou sem (1a celula com letras = produto,
 * ultima celula so-quantidade = quantidade). Sem itens na tabela, cada linha de texto vira item (texto + quantidade
 * FINAL pt-BR). Linhas soltas com incoterm sao metadados do pedido. Maximo de 50 itens; o usuario sempre confirma.
 */
export function parseDealNote(text: string, catalog: NoteCatalogProduct[] = []): ParsedDealNote {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const meta: Metadata = { incoterm: null, destination: null, supplierHint: null };
  let ignored = 0;

  // 1) tabelas
  const tableItems: ParsedNoteItem[] = [];
  const tableLineNumbers = new Set<number>();
  let header: HeaderMap | null = null;
  let blockStart = true;
  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    if (!isTableRow(raw)) {
      blockStart = true;
      header = null;
      return;
    }
    tableLineNumbers.add(lineNumber);
    const cells = raw.split('\t').map((cell) => cleanProposedName(cell));
    if (blockStart) {
      blockStart = false;
      header = detectHeader(cells);
      if (header) {
        return;
      }
    }
    const row = readTableRow(cells, header, meta);
    if (row === null) {
      return;
    }
    if (tableItems.length >= NOTE_MAX_ITEMS) {
      ignored += 1;
      return;
    }
    tableItems.push({ text: row.text, quantityKg: row.quantityKg, productId: matchCatalog(row.text, catalog), line: lineNumber });
  });

  // 2) linhas soltas: metadados e, sem itens na tabela, itens
  const useLines = tableItems.length === 0;
  const lineItems: ParsedNoteItem[] = [];
  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    if (tableLineNumbers.has(lineNumber)) {
      return;
    }
    const line = cleanProposedName(raw);
    if (line === '') {
      return;
    }
    if (line.startsWith('@') || line.endsWith('?') || IGNORED_LINE.test(line)) {
      ignored += 1;
      return;
    }
    const whole = INCOTERM_LINE.exec(line);
    if (whole) {
      takeMetadata(meta, whole[1] as string, whole[2], whole[3]);
      return;
    }
    if (!useLines) {
      ignored += 1;
      return;
    }

    let body = line;
    const tail = INCOTERM_TAIL.exec(body);
    if (tail) {
      takeMetadata(meta, tail[1] as string, tail[2], tail[3]);
      body = body.slice(0, tail.index);
    }
    body = cleanProposedName(body.replace(/^[-–•*·]\s+/, '').replace(/^(?:cotar|cota[cç][aã]o de)\s+/i, ''));

    const quantityOnly = parseQuantityKg(body);
    if (quantityOnly !== undefined) {
      const previous = lineItems[lineItems.length - 1];
      if (previous && previous.quantityKg === null) {
        previous.quantityKg = quantityOnly; // quantidade na linha seguinte ao nome
      } else {
        ignored += 1;
      }
      return;
    }

    let name = body;
    let quantityKg: number | null = null;
    const trailing = QUANTITY_TAIL.exec(body);
    if (trailing) {
      name = cleanProposedName(stripTrailingSeparators(body.slice(0, trailing.index)));
      quantityKg = quantityToKg(trailing[1] as string, trailing[2], trailing[3]);
    }
    if (name === '' || !HAS_LETTER.test(name) || name.length > MAX_ITEM_TEXT_CHARS) {
      ignored += 1;
      return;
    }
    if (lineItems.length >= NOTE_MAX_ITEMS) {
      ignored += 1;
      return;
    }
    lineItems.push({ text: name, quantityKg, productId: matchCatalog(name, catalog), line: lineNumber });
  });

  // Sem tabela, uma lista em texto precisa de ao menos uma quantidade; texto corrido sem numero (resposta da equipe,
  // comentario) nao gera item. Com uma quantidade, linhas de nome sem quantidade na mesma lista continuam itens.
  const linesAreAList = lineItems.some((item) => item.quantityKg !== null);
  if (!linesAreAList) {
    ignored += lineItems.length;
    lineItems.length = 0;
  }

  const items = useLines ? lineItems : tableItems;
  return {
    mode: tableItems.length > 0 ? 'table' : lineItems.length > 0 ? 'lines' : 'none',
    items,
    incoterm: meta.incoterm,
    destination: meta.destination,
    supplierHint: meta.supplierHint,
    ignoredLines: ignored,
  };
}

// ---------- qual nota vale ----------

export interface SelectedItemsNote {
  note: PdNote;
  text: string;
  parsed: ParsedDealNote;
}

/**
 * Escolhe a UNICA nota que alimenta os itens. Descarta as do usuario "equipe Compras" (`comexUserId`, respostas);
 * candidatas = as que mencionam esse usuario ou tem tabela (sem `comexUserId` ou sem autor: tem tabela ou item
 * parseavel); sem candidata, todas as restantes. Vale a MAIS RECENTE com >= 1 item; sem nenhuma, a mais recente
 * candidata (0 itens: "Itens a digitar"). Sem notas utilizaveis -> `null`.
 */
export function selectItemsNote(
  notes: PdNote[],
  options: { comexUserId?: number | null; catalog?: NoteCatalogProduct[] } = {},
): SelectedItemsNote | null {
  const comexUserId = options.comexUserId ?? null;
  const catalog = options.catalog ?? [];

  const remaining = notes
    .filter((note) => !(comexUserId !== null && note.authorId !== null && note.authorId === comexUserId))
    .map((note) => {
      const text = noteHtmlToText(note.html);
      return { note, text, parsed: parseDealNote(text, catalog), hasTable: /<table\b/i.test(note.html) };
    })
    .sort((a, b) => b.note.addTime.getTime() - a.note.addTime.getTime() || b.note.id - a.note.id);

  if (remaining.length === 0) {
    return null;
  }

  const isCandidate = (entry: (typeof remaining)[number]): boolean => {
    if (comexUserId !== null && entry.note.authorId !== null) {
      return entry.hasTable || extractMentions(entry.note.html).some((mention) => mention.mentionedId === comexUserId);
    }
    return entry.hasTable || entry.parsed.items.length > 0;
  };
  const candidates = remaining.filter(isCandidate);
  const pool = candidates.length > 0 ? candidates : remaining;
  const chosen = pool.find((entry) => entry.parsed.items.length > 0) ?? (pool[0] as (typeof remaining)[number]);
  return { note: chosen.note, text: chosen.text, parsed: chosen.parsed };
}
