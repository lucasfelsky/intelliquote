/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guarda do tema escuro (globals.css e o unico CSS do app):
//  - nenhuma cor literal fora dos blocos de token (so var(--x));
//  - valores claros congelados + paridade claro/escuro dos tokens;
//  - todo var(--x) usado esta definido;
//  - contraste WCAG 2.x dos pares do escuro, calculado a partir do proprio CSS;
//  - cores literais em .tsx so na allowlist; estrutura do script anti-flash do index.html.

// Vitest zera o conteudo de `.css?raw` (css desligado por padrao); le do disco.
const readSource = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readSource('../styles/globals.css');
const indexHtml = readSource('../../index.html');

const tsxSources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
const ALLOWED_OVERLAY_FALLBACK = 'var(--overlay, rgba(0, 30, 30, 0.5))';
const DARK_HEADER = ':root[data-theme="dark"] {';

// Tokens iguais nos dois temas: ficam so no :root (nao sao repetidos no bloco escuro).
const SAME_IN_BOTH_THEMES = [
  '--primary-strong',
  '--primary-strong-hover',
  '--toast-action-hover',
  '--on-strong',
  '--danger-strong',
  '--warning-strong',
  '--on-strong-tint',
  '--toast-outline',
  '--toast-hover-tint',
  '--paper',
  '--paper-ink',
  '--paper-ink-soft',
  '--paper-link',
  '--paper-placeholder',
  '--code-bg',
  '--code-fg',
  '--selection-bg',
  '--radius',
  '--radius-sm',
];

// Valores do :root claro em origin/main f74c579 (nao podem mudar).
const FROZEN_LIGHT: Record<string, string> = {
  '--bg': '#f5f8f7',
  '--surface': '#ffffff',
  '--surface-alt': '#eef4f1',
  '--ink': '#1f1c18',
  '--ink-soft': '#4a5560',
  '--primary': '#00ae91',
  '--primary-700': '#00735c',
  '--primary-50': '#e3f5f0',
  '--danger': '#a4370c',
  '--warning': '#7a5a07',
  '--info': '#16568c',
  '--border': '#dce9e5',
  '--border-strong': '#b7cdc5',
  '--shadow': '0 8px 28px rgba(0, 40, 40, 0.08)',
  '--shadow-sm': '0 2px 8px rgba(0, 40, 40, 0.06)',
};

// ---------- parser minimo ----------
const clean = css.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');

function extractBlock(source: string, header: string): { body: string; rest: string } {
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

function parseTokens(body: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined) tokens[name] = value.replace(/\s+/g, ' ').trim();
  }
  return tokens;
}

const light = extractBlock(clean, ':root {');
const dark = extractBlock(light.rest, DARK_HEADER);
const lightTokens = parseTokens(light.body);
const darkTokens = parseTokens(dark.body);
const restOfCss = dark.rest;

// ---------- cor / contraste ----------
type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba {
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

function resolveToken(tokens: Record<string, string>, name: string, depth = 0): string {
  const value = tokens[name];
  if (value === undefined) throw new Error(`token indefinido: ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (ref) {
    if (depth > 10) throw new Error(`ciclo em ${name}`);
    return resolveToken(tokens, ref, depth + 1);
  }
  return value;
}

const darkAll: Record<string, string> = { ...lightTokens, ...darkTokens };

// Tokens com alpha sao compostos sobre --surface do tema antes de medir.
function opaque(tokens: Record<string, string>, name: string): [number, number, number] {
  const [surfaceR, surfaceG, surfaceB] = parseColor(resolveToken(tokens, '--surface'));
  const [r, g, b, a] = parseColor(resolveToken(tokens, name));
  const mix = (c: number, under: number) => Math.round(c * a + under * (1 - a));
  return [mix(r, surfaceR), mix(g, surfaceG), mix(b, surfaceB)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(fg: string, bg: string, tokens: Record<string, string> = darkAll): number {
  const a = luminance(opaque(tokens, `--${fg}`));
  const b = luminance(opaque(tokens, `--${bg}`));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// [texto/UI, fundo, minimo]: 4.5 = texto (AA); 3 = componente de UI (AA 1.4.11).
const TEXT = 4.5;
const UI = 3;
const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ['ink', 'bg', TEXT],
  ['ink', 'surface', TEXT],
  ['ink', 'surface-alt', TEXT],
  ['ink-soft', 'surface', TEXT],
  ['ink-soft', 'surface-alt', TEXT],
  ['ink-soft', 'surface-muted', TEXT],
  ['ink-muted', 'surface', TEXT],
  ['ink-muted', 'input-bg', TEXT],
  ['ink-muted', 'cmp-criteria-bg', TEXT],
  ['ink-faint', 'surface', TEXT],
  ['ink-faint', 'surface-alt', TEXT],
  ['primary-700', 'surface', TEXT],
  ['primary-700', 'primary-50', TEXT],
  ['primary-700', 'surface-alt', TEXT],
  ['primary', 'surface', TEXT],
  ['danger', 'surface', TEXT],
  ['danger', 'tone-danger-bg', TEXT],
  ['danger', 'tone-danger-bg-soft', TEXT],
  ['danger', 'tone-danger-bg-alt', TEXT],
  ['warning', 'surface', TEXT],
  ['warning', 'tone-warning-bg', TEXT],
  ['tone-warning-fg-strong', 'tone-warning-bg', TEXT],
  ['tone-warning-fg-strong', 'tone-warning-bg-alt', TEXT],
  ['tone-warning-icon-fg', 'tone-warning-icon-bg', TEXT],
  ['info', 'surface', TEXT],
  ['info', 'tone-info-bg', TEXT],
  ['tone-success-fg', 'tone-success-bg', TEXT],
  ['tone-neutral-fg', 'tone-neutral-bg', TEXT],
  ['on-primary', 'primary', TEXT],
  ['on-primary', 'primary-hover', TEXT],
  ['on-strong', 'primary-strong', TEXT],
  ['on-strong', 'primary-strong-hover', TEXT],
  ['on-strong', 'danger-strong', TEXT],
  ['on-strong', 'warning-strong', TEXT],
  ['on-strong', 'toast-bg', TEXT],
  ['on-strong', 'toast-action-hover', TEXT],
  ['ink', 'winner-bg', TEXT],
  ['ink', 'selection-bg', TEXT],
  ['input-border', 'input-bg', UI],
  ['input-border', 'surface', UI],
  ['scorebar-fill', 'surface-alt', UI],
  ['primary', 'winner-track', UI],
  ['star-on', 'surface', UI],
  ['star-off', 'surface', UI],
  // "papel claro" (Jodit / previa da assinatura): constantes sobre o branco do papel
  ['paper-ink', 'paper', TEXT],
  ['paper-ink-soft', 'paper', TEXT],
  ['paper-link', 'paper', TEXT],
  ['paper-placeholder', 'paper', TEXT],
  // anel do toggle selecionado (--primary-700) contra o fundo do grupo (--surface-alt)
  ['primary-700', 'surface-alt', UI],
];

describe('tema escuro: guarda do CSS', () => {
  it('nao ha cor literal fora dos blocos de token (so var(--x))', () => {
    const offenders = restOfCss
      .split('\n')
      .map((line) => line.replace(ALLOWED_OVERLAY_FALLBACK, ''))
      .filter((line) => COLOR_LITERAL.test(line));
    expect(offenders).toEqual([]);
  });

  it('o bloco :root do claro tem os 15 valores originais congelados', () => {
    for (const [token, value] of Object.entries(FROZEN_LIGHT)) {
      expect(lightTokens[token], token).toBe(value);
    }
  });

  it('paridade: todo token claro tem par escuro (salvo as constantes) e vice-versa', () => {
    const missingInDark = Object.keys(lightTokens).filter(
      (t) => !(t in darkTokens) && !SAME_IN_BOTH_THEMES.includes(t),
    );
    expect(missingInDark).toEqual([]);
    const onlyInDark = Object.keys(darkTokens).filter((t) => !(t in lightTokens));
    expect(onlyInDark).toEqual([]);
    const redundant = SAME_IN_BOTH_THEMES.filter((t) => t in darkTokens);
    expect(redundant).toEqual([]);
    const unknownConstants = SAME_IN_BOTH_THEMES.filter((t) => !(t in lightTokens));
    expect(unknownConstants).toEqual([]);
  });

  it('todo var(--x) usado esta definido (fallback var(--x, ...) conta; --val e local)', () => {
    const used = new Set<string>();
    for (const [, name] of css.matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)) if (name) used.add(name);
    const defined = new Set(Object.keys(lightTokens));
    const undefinedVars = [...used].filter((t) => !defined.has(t) && t !== '--val');
    expect(undefinedVars).toEqual([]);
  });

  it('contraste AA dos pares do tema escuro (texto >= 4.5, UI >= 3)', () => {
    const rows = PAIRS.map(([fg, bg, min]) => {
      const ratio = contrast(fg, bg);
      return { fg: `--${fg}`, bg: `--${bg}`, min, ratio: Number(ratio.toFixed(2)), ok: ratio >= min };
    });
    console.table(rows);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
  });

  it('contraste do anel do toggle selecionado tambem no claro (>= 3)', () => {
    expect(contrast('primary-700', 'surface-alt', lightTokens)).toBeGreaterThanOrEqual(UI);
  });

  it('escopo "papel claro" no escuro religa color e os tokens de texto (Jodit e assinatura)', () => {
    const header = ':root[data-theme="dark"] :is(.paper-surface, .jodit-container, .jodit-popup, .jodit-dialog) {';
    const rule = extractBlock(clean, header).body;
    expect(rule).toMatch(/(^|[;\s])color:\s*var\(--ink\)\s*;/);
    expect(rule).toMatch(/--ink:\s*var\(--paper-ink\)/);
    expect(rule).toMatch(/--ink-soft:\s*var\(--paper-ink-soft\)/);
    expect(rule).toMatch(/--primary-700:\s*var\(--paper-link\)/);
    expect(rule).toMatch(/color-scheme:\s*light/);
    // placeholder do escopo vence o global (seletor mais especifico)
    expect(clean).toContain(`${header.slice(0, -2)} ::placeholder {`);
  });
});

describe('tema escuro: .tsx e index.html', () => {
  const ALLOWED_TSX_LITERALS: Record<string, string[]> = {
    // fallbacks de var() cujo token existe (nunca usados)
    'components/CreditPartnersSection.tsx': ['var(--border, #dde3ea)'],
    'components/SupplierDocumentsSection.tsx': ['var(--border, #dde3ea)', 'var(--surface, #fff)'],
    'pages/Forwarders.tsx': ['var(--border, #dde3ea)'],
    'pages/Solicitacoes/ComercialView.tsx': ['var(--border, #dde3ea)'],
    // previa da assinatura de e-mail: papel branco por definicao
    'pages/MinhaConta.tsx': ["'#fff'", "'#1F2933'", "'#7A848C'"],
    // srcDoc da previa de e-mail (iframe claro)
    'pages/Templates.tsx': ['color:#888'],
    // stops da <mask> do fundo do login: luminancia da mascara, nao cor visivel
    'components/LoginBackdrop.tsx': ['stopColor="#000"', 'stopColor="#fff"'],
  };

  it('cores literais em .tsx (exceto testes) so nas linhas da allowlist', () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(tsxSources)) {
      if (/\.test\.tsx$/.test(path)) continue;
      const file = path.replace(/^\.\.\//, '');
      const allowed = ALLOWED_TSX_LITERALS[file] ?? [];
      source.split(/\r?\n/).forEach((line, i) => {
        if (COLOR_LITERAL.test(line) && !allowed.some((snippet) => line.includes(snippet))) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('previa da assinatura (MinhaConta) usa o escopo paper-surface', () => {
    const source = tsxSources['../pages/MinhaConta.tsx'] ?? '';
    expect(source).toMatch(/className="paper-surface"\s+data-testid="signature-preview"/);
  });

  it('index.html: script anti-flash antes do bundle e metas theme-color por esquema', () => {
    expect(indexHtml).toContain("'iq-theme'");
    expect(indexHtml).toContain('data-theme');
    expect(indexHtml).toMatch(/<meta name="theme-color" content="#00ae91" media="\(prefers-color-scheme: light\)"/);
    expect(indexHtml).toMatch(/<meta name="theme-color" content="#0b1518" media="\(prefers-color-scheme: dark\)"/);
    const script = indexHtml.indexOf('<script>');
    const bundle = indexHtml.indexOf('/src/main.tsx');
    expect(script).toBeGreaterThan(-1);
    expect(bundle).toBeGreaterThan(script);
  });
});
