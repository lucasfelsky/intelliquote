/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Apoio COMUM dos testes que leem o globals.css e as fixtures de tokens --rf-* (Suite COMEX). Nao e um teste.
// Antes da F3-0 estas funcoes viviam copiadas dentro de suiteComexTokens.test.ts; a F3a/F3b/F3c/F3d (frentes paralelas) importam daqui.

// ---------- leitura ----------
export const readSource = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

export const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

// ---------- parser minimo (mesma abordagem de themeTokens.test.ts) ----------
export function extractBlock(source: string, header: string): { body: string; rest: string } {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`bloco nao encontrado: ${header}`);
  let depth = 0;
  for (let i = start + header.length - 1; i < source.length; i++) {
    const ch = source.charAt(i);
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      return {
        body: source.slice(start + header.length, i),
        rest: source.slice(0, start) + source.slice(i + 1),
      };
    }
  }
  throw new Error(`bloco sem fechamento: ${header}`);
}

export function parseTokens(body: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined) tokens[name] = value.replace(/\s+/g, ' ').trim();
  }
  return tokens;
}

export interface CssRule {
  prelude: string;
  body: string;
}

export function parseRules(text: string): CssRule[] {
  const rules: CssRule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      const ch = text.charAt(j);
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    rules.push({ prelude: text.slice(i, open).trim(), body: text.slice(open + 1, j - 1) });
    i = j;
  }
  return rules;
}

// ---------- regioes delimitadas ----------
// `/* >>> <nome> (Suite COMEX) >>> */ ... /* <<< <nome> <<< */`. Operam sobre o CSS com quebras LF.
export interface Regiao {
  nome: string;
  inicio: number;
  fim: number; // indice logo depois do marcador de fim
  bruto: string; // do marcador de inicio ao de fim, inclusive
  limpo: string; // bruto sem comentarios
  regras: CssRule[];
}

export function regioes(cssLf: string): Regiao[] {
  const out: Regiao[] = [];
  for (const m of cssLf.matchAll(/\/\* >>> (.+?) \(Suite COMEX\) >>> \*\//g)) {
    const nome = m[1];
    if (nome === undefined) continue;
    const inicio = m.index ?? 0;
    const fimMarcador = `/* <<< ${nome} <<< */`;
    const posFim = cssLf.indexOf(fimMarcador, inicio);
    if (posFim < 0) throw new Error(`regiao sem marcador de fim: ${nome}`);
    const fim = posFim + fimMarcador.length;
    const bruto = cssLf.slice(inicio, fim);
    const limpo = stripComments(bruto);
    out.push({ nome, inicio, fim, bruto, limpo, regras: parseRules(limpo) });
  }
  return out;
}

// CSS sem o texto de TODAS as regioes.
export function foraDasRegioes(cssLf: string, regs: Regiao[] = regioes(cssLf)): string {
  let out = '';
  let cursor = 0;
  for (const r of [...regs].sort((a, b) => a.inicio - b.inicio)) {
    out += cssLf.slice(cursor, r.inicio);
    cursor = r.fim;
  }
  return out + cssLf.slice(cursor);
}

// ---------- seletores ----------
// Classes citadas num seletor (ignora atributos, strings e numeros decimais). `:root[data-theme="dark"]` nao tem classe.
export function classesDoSeletor(seletor: string): string[] {
  const semTexto = seletor.replace(/"[^"]*"|'[^']*'/g, '""').replace(/\[[^\]]*\]/g, '');
  return [...semTexto.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? '');
}

// Ultimo composto do seletor (depois do ultimo combinador de descendente/filho/irmao fora de parenteses e colchetes).
export function ultimoComposto(seletor: string): string {
  let depth = 0;
  let atual = '';
  let ultimo = '';
  for (const ch of seletor.trim()) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && /[\s>+~]/.test(ch)) {
      if (atual) ultimo = atual;
      atual = '';
    } else {
      atual += ch;
    }
  }
  return atual || ultimo;
}

// ---------- fixtures ----------
export interface FixtureToken {
  token: string;
  claro: string;
  escuro: string | null;
  constante: boolean;
  fonte: 'mock' | 'decisao' | 'spec' | 'portal';
  ref: string;
}

// UNIAO de suiteComexTokens.json (base, 84) com suiteComexTokens.f3a/.f3b/.f3c/.f3d.json (um arquivo por etapa; so aditivo).
export function fixtureUniao(): Array<FixtureToken & { arquivo: string }> {
  const arquivos = import.meta.glob('./fixtures/suiteComexTokens*.json', { eager: true, import: 'default' }) as Record<string, FixtureToken[]>;
  return Object.entries(arquivos)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([arquivo, tokens]) => tokens.map((t) => ({ ...t, arquivo: arquivo.replace('./fixtures/', '') })));
}

// ---------- tokens por tema ----------
const DARK_HEADER = ':root[data-theme="dark"] {';

// Tokens do :root (claro) e do bloco escuro (so o que o bloco redeclara), extraidos do CSS sem as regioes e sem comentarios.
export function tokensDosTemas(cssLf: string): { claro: Record<string, string>; escuro: Record<string, string>; resto: string } {
  const limpo = stripComments(foraDasRegioes(cssLf));
  const claro = extractBlock(limpo, ':root {');
  const escuro = extractBlock(claro.rest, DARK_HEADER);
  return { claro: parseTokens(claro.body), escuro: parseTokens(escuro.body), resto: escuro.rest };
}

// ---------- cor / contraste (WCAG 2.x) ----------
export type Rgba = [number, number, number, number];
export type Rgb = [number, number, number];

export function parseColor(value: string): Rgba {
  const v = value.trim().toLowerCase();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)?.[1];
  if (hexMatch) {
    const hex = hexMatch.length === 3 ? [...hexMatch].map((c) => c + c).join('') : hexMatch;
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new Error(`cor nao suportada: ${value}`);
}

export const over = ([r, g, b, a]: Rgba, under: Rgb): Rgb => {
  const mix = (c: number, u: number) => Math.round(c * a + u * (1 - a));
  return [mix(r, under[0]), mix(g, under[1]), mix(b, under[2])];
};

export function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export const ratioOf = (fg: Rgb, bg: Rgb) => {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

export type ThemeName = 'claro' | 'escuro';

// Cor opaca do token no tema (alpha composto sobre o --rf-surface do tema). `tokens` = claro ou { ...claro, ...escuro }.
export function opaque(tokens: Record<string, string>, name: string): Rgb {
  const surface = tokens['--rf-surface'];
  const value = tokens[name];
  if (surface === undefined || value === undefined) throw new Error(`token indefinido: ${name}`);
  const [sr, sg, sb] = parseColor(surface);
  return over(parseColor(value), [sr, sg, sb]);
}

export const temasDeTokens = (claro: Record<string, string>, escuro: Record<string, string>): Record<ThemeName, Record<string, string>> => ({
  claro,
  escuro: { ...claro, ...escuro },
});
