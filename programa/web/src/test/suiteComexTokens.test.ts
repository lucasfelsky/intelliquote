/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Base ADITIVA dos tokens --rf-* (Suite COMEX, mock v68). Esta guarda cobre:
//  - paridade: o CSS tem exatamente os tokens da fixture, com os valores da fixture (claro e escuro);
//  - contraste WCAG 2.x nos 2 temas, compondo alpha sobre o --rf-surface do tema;
//  - excecoes de contraste do proprio mock, explicitas (o conjunto de reprovados tem de ser EXATAMENTE a lista);
//  - invariantes da base aditiva: ninguem consome var(--rf-*) e --rf-* so existe nos 2 blocos de token.
// Quando a fase da TROCA passar a consumir os tokens, so os invariantes (ultimo describe) mudam.

const readSource = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readSource('../styles/globals.css');
const loginCss = readSource('../styles/login.css');
const indexHtml = readSource('../../index.html');

interface FixtureToken {
  token: string;
  claro: string;
  escuro: string | null;
  constante: boolean;
  fonte: 'mock' | 'decisao' | 'spec' | 'portal';
  ref: string;
}
const fixture = JSON.parse(readSource('./fixtures/suiteComexTokens.json')) as FixtureToken[];

const tsSources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../test/**', '!../**/*.test.ts', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// ---------- parser minimo (mesma abordagem de themeTokens.test.ts) ----------
const DARK_HEADER = ':root[data-theme="dark"] {';
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

const lightBlock = extractBlock(clean, ':root {');
const darkBlock = extractBlock(lightBlock.rest, DARK_HEADER);
const lightTokens = parseTokens(lightBlock.body);
const darkTokens = parseTokens(darkBlock.body);
const restOfCss = darkBlock.rest;

const rfOf = (tokens: Record<string, string>) => Object.keys(tokens).filter((t) => t.startsWith('--rf-'));
const lightRf = rfOf(lightTokens);
const darkRf = rfOf(darkTokens);

// ---------- paridade com a fixture ----------
describe('--rf-*: paridade CSS x fixture (mock v68)', () => {
  const pairs = fixture.filter((t) => !t.constante);
  const constants = fixture.filter((t) => t.constante);

  it('a fixture tem 81 tokens: 34 pares claro/escuro e 47 constantes, sem repeticao', () => {
    expect(fixture).toHaveLength(81);
    expect(pairs).toHaveLength(34);
    expect(constants).toHaveLength(47);
    expect(new Set(fixture.map((t) => t.token)).size).toBe(81);
  });

  it('a fixture so tem valores publicos: ref e nome de board ou token, nunca URL ou caminho', () => {
    for (const t of fixture) {
      expect(t.token, t.token).toMatch(/^--rf-[a-z0-9-]+$/);
      expect(['mock', 'decisao', 'spec', 'portal'], t.token).toContain(t.fonte);
      expect(t.ref, t.token).not.toMatch(/https?:|[\\/]{2}|[A-Za-z]:\\|\.html|\.json/);
      expect(t.escuro === null, t.token).toBe(t.constante);
    }
  });

  it('o conjunto de --rf-* do :root e exatamente o da fixture', () => {
    expect([...lightRf].sort()).toEqual(fixture.map((t) => t.token).sort());
  });

  it('o valor claro de cada token confere com a fixture', () => {
    const wrong = fixture.filter((t) => lightTokens[t.token] !== t.claro).map((t) => `${t.token}: ${lightTokens[t.token]}`);
    expect(wrong).toEqual([]);
  });

  it('o bloco escuro tem exatamente os 34 pares, com o valor escuro da fixture', () => {
    expect([...darkRf].sort()).toEqual(pairs.map((t) => t.token).sort());
    const wrong = pairs.filter((t) => darkTokens[t.token] !== t.escuro).map((t) => `${t.token}: ${darkTokens[t.token]}`);
    expect(wrong).toEqual([]);
  });

  it('constante nao e repetida no bloco escuro', () => {
    expect(constants.filter((t) => t.token in darkTokens).map((t) => t.token)).toEqual([]);
  });
});

// ---------- cor / contraste ----------
type Rgba = [number, number, number, number];
type Rgb = [number, number, number];

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

const over = ([r, g, b, a]: Rgba, under: Rgb): Rgb => {
  const mix = (c: number, u: number) => Math.round(c * a + u * (1 - a));
  return [mix(r, under[0]), mix(g, under[1]), mix(b, under[2])];
};

function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

const ratioOf = (fg: Rgb, bg: Rgb) => {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

type ThemeName = 'claro' | 'escuro';
const THEMES: Record<ThemeName, Record<string, string>> = {
  claro: lightTokens,
  escuro: { ...lightTokens, ...darkTokens },
};

// Compoe o token (com alpha) sobre o --rf-surface do tema antes de medir.
function opaque(theme: ThemeName, name: string): Rgb {
  const tokens = THEMES[theme];
  const surface = tokens['--rf-surface'];
  const value = tokens[name];
  if (surface === undefined || value === undefined) throw new Error(`token indefinido: ${name}`);
  const [sr, sg, sb] = parseColor(surface);
  return over(parseColor(value), [sr, sg, sb]);
}

const TEXT = 4.5; // texto (AA)
const UI = 3; // componente de UI (AA 1.4.11)

type PairSpec = readonly [fg: string, bg: string, min: number];
const rf = (name: string) => `--rf-${name}`;
const TONES = ['success', 'warning', 'danger', 'info', 'neutral'] as const;
const FC_STATUS = ['pendente', 'cotando', 'confirmado', 'po', 'preco'] as const;

const PAIRS: ReadonlyArray<PairSpec> = [
  [rf('ink'), rf('bg'), TEXT],
  [rf('ink'), rf('surface'), TEXT],
  [rf('ink'), rf('surface-alt'), TEXT],
  [rf('ink-soft'), rf('surface'), TEXT],
  [rf('ink-soft'), rf('surface-alt'), TEXT],
  [rf('primary-700'), rf('surface'), TEXT],
  [rf('primary-700-hover'), rf('surface'), TEXT],
  [rf('on-primary'), rf('primary'), TEXT],
  [rf('on-primary'), rf('primary-hover'), TEXT],
  [rf('sidebar-ink-soft'), rf('primary-strong-hover'), TEXT],
  ...TONES.map((t): PairSpec => [rf(`tone-${t}-fg`), rf(`tone-${t}-bg`), TEXT]),
  [rf('ink'), rf('primary-50'), TEXT],
  [rf('ink'), rf('fc-current-tint'), TEXT],
  [rf('ink'), rf('count-chip'), TEXT],
  [rf('input-border'), rf('surface'), UI],
  [rf('input-border'), rf('surface-alt'), UI],
  [rf('input-border'), rf('input-bg'), UI],
  [rf('action'), rf('surface'), UI],
  ...FC_STATUS.map((s): PairSpec => [rf(`fc-status-${s}`), rf('surface'), UI]),
];

interface Row {
  id: string;
  min: number;
  ratio: number;
  ok: boolean;
}

function measure(): Row[] {
  const rows: Row[] = [];
  for (const theme of ['claro', 'escuro'] as const) {
    for (const [fg, bg, min] of PAIRS) {
      const ratio = ratioOf(opaque(theme, fg), opaque(theme, bg));
      rows.push({ id: `${theme}: ${fg} / ${bg}`, min, ratio: Number(ratio.toFixed(2)), ok: ratio >= min });
    }
  }
  // Selo "Beta" ativo: tag-active-bg compoe sobre a pilula ativa, que compoe sobre a sidebar. A sidebar e igual
  // nos 2 temas; o gradiente e medido nas duas pontas e vale a pior.
  const gradient = (lightTokens['--rf-sidebar-bg'] ?? '').match(/#[0-9a-f]{6}/gi) ?? [];
  const tagFg = parseColor(lightTokens['--rf-sidebar-tag-active-fg'] ?? '');
  const worst = Math.min(
    ...gradient.map((stop) => {
      const base = parseColor(stop);
      const pill = over(parseColor(lightTokens['--rf-sidebar-active-bg'] ?? ''), [base[0], base[1], base[2]]);
      const tagBg = over(parseColor(lightTokens['--rf-sidebar-tag-active-bg'] ?? ''), pill);
      return ratioOf([tagFg[0], tagFg[1], tagFg[2]], tagBg);
    }),
  );
  rows.push({
    id: 'ambos: --rf-sidebar-tag-active-fg / pilula ativa composta',
    min: TEXT,
    ratio: Number(worst.toFixed(2)),
    ok: worst >= TEXT,
  });
  return rows;
}

// Reprovacoes herdadas do PROPRIO mock v68 (copiadas identicas; decisao do Lucas na fase que consumir o token).
// `medido` = razao calculada no planejamento; o teste falha se a medida mudar.
const KNOWN_EXCEPTIONS: ReadonlyArray<{ id: string; medido: number; motivo: string }> = [
  {
    id: 'claro: --rf-fc-status-pendente / --rf-surface',
    medido: 2.42,
    motivo: 'faixa de status 4px "Cotacao nao enviada" (mock); a legenda tem texto; WCAG 1.4.11 pede 3:1',
  },
  {
    id: 'claro: --rf-fc-status-confirmado / --rf-surface',
    medido: 2.23,
    motivo: 'faixa de status 4px "Confirmado, aguarda PO" (mock); a legenda tem texto; WCAG 1.4.11 pede 3:1',
  },
  {
    id: 'ambos: --rf-sidebar-tag-active-fg / pilula ativa composta',
    medido: 3.81,
    motivo: 'selo Beta ativo (texto 10px) do mock; pede 4,5:1; 4,37 na ponta #003241 do gradiente e 3,81 na ponta #004153 (vale a pior)',
  },
];

describe('--rf-*: contraste nos 2 temas (WCAG 2.x, alpha composto sobre --rf-surface)', () => {
  const rows = measure();

  it('mede os pares nos 2 temas', () => {
    console.table(rows.map((r) => ({ par: r.id, min: r.min, ratio: r.ratio, ok: r.ok })));
    expect(rows).toHaveLength(PAIRS.length * 2 + 1);
  });

  it('o conjunto de pares reprovados e EXATAMENTE a lista de excecoes do mock', () => {
    const failing = rows.filter((r) => !r.ok).map((r) => r.id);
    expect(failing.sort()).toEqual(KNOWN_EXCEPTIONS.map((e) => e.id).sort());
  });

  it('cada excecao continua com a razao medida (mudou? atualize a lista e decida)', () => {
    for (const exception of KNOWN_EXCEPTIONS) {
      const row = rows.find((r) => r.id === exception.id);
      expect(row, exception.id).toBeDefined();
      expect(row?.ratio, `${exception.id} (${exception.motivo})`).toBeCloseTo(exception.medido, 1);
    }
  });
});

// ---------- invariantes da base aditiva ----------
describe('--rf-*: invariantes da base aditiva (so a fase da TROCA os remove)', () => {
  it('ninguem consome var(--rf-: globals.css, login.css, index.html e src (nao-teste)', () => {
    expect(css).not.toContain('var(--rf-');
    expect(loginCss).not.toContain('var(--rf-');
    expect(indexHtml).not.toContain('var(--rf-');
    const offenders = Object.entries(tsSources)
      .filter(([, source]) => source.includes('var(--rf-'))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
    expect(Object.keys(tsSources).length).toBeGreaterThan(0);
  });

  it('--rf-* so existe dentro dos 2 blocos de token (nem no resto do CSS, nem no login.css)', () => {
    expect(restOfCss).not.toContain('--rf-');
    expect(loginCss).not.toContain('--rf-');
  });

  it('Sora so aparece na linha --rf-font-display do CSS e na familia do <link> do index.html', () => {
    const soraLines = css.split(/\r?\n/).filter((line) => line.includes('Sora'));
    expect(soraLines).toHaveLength(1);
    expect(soraLines[0]).toMatch(/^\s*--rf-font-display:/);
    expect(loginCss).not.toContain('Sora');
    expect(indexHtml.match(/Sora/g)).toHaveLength(1);
    expect(indexHtml).toContain('&family=Sora:wght@600;700&display=swap');
  });

  it('JetBrains Mono nao e carregada pelo <link> (so token; as regras antigas ja a citam)', () => {
    expect(indexHtml).not.toContain('JetBrains');
  });
});
