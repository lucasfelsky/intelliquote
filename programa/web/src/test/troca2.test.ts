/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// TROCA-2 (plano 16.4-16.6): os tokens LEGADOS (sem prefixo --rf-) passam a ter, nos 2 temas, os valores da identidade nova.
//  (a) cada token legado tem EXATAMENTE o valor da tabela 16.4 (claro e escuro efetivo);
//  (b) os tokens com equivalente --rf-* (regras R1/R2) sao IGUAIS a ele no mesmo tema (trava a paleta unica);
//  (c) os 7 tokens da comparacao antiga (--winner-*, --cmp-criteria-bg) nao existem;
//  (d) nenhuma regra morta da limpeza 16.5 voltou ao CSS, e as vivas seguem;
//  (e) contraste WCAG 2.x dos pares dos 2 temas, com a lista exata de excecoes HERDADAS e a razao medida;
//  (f) nenhum token legado declara var(--rf-...): o valor e LITERAL (a fixture suiteComexTokens*.json so cobre --rf-*);
//  (g) scrollbar-color do escuro.
// O arquivo nao le o git: a tabela abaixo e a fonte.

const readSource = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

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
const darkBlock = extractBlock(lightBlock.rest, ':root[data-theme="dark"] {');
const lightTokens = parseTokens(lightBlock.body);
const darkTokens = parseTokens(darkBlock.body);
// Valor efetivo no escuro: o que o bloco escuro nao redeclara vem do :root (tokens "constante").
const darkEffective: Record<string, string> = { ...lightTokens, ...darkTokens };

// [token, claro, escuro | '=' (constante: nao e redeclarado no bloco escuro)] - plano 16.4, valores LITERAIS.
type Row = readonly [string, string, string];
const SAME = '=';
const TABELA: ReadonlyArray<Row> = [
  ['--bg', '#eef2f1', '#061a22'],
  ['--surface', '#ffffff', '#0f2b35'],
  ['--surface-alt', '#f5f8f7', '#163845'],
  ['--ink', '#0b2430', '#e8f4f6'],
  ['--ink-soft', '#4a6472', '#9fb6bf'],
  ['--primary', '#14dda7', '#14dda7'],
  ['--primary-700', '#007864', '#14dda7'],
  ['--primary-50', '#e2f6f0', 'rgba(20, 221, 167, 0.14)'],
  ['--danger', '#9a2a21', '#ff9b90'],
  ['--warning', '#8a5a0a', '#f2c14e'],
  ['--info', '#155793', '#9cc3ff'],
  ['--border', '#d5e2de', 'rgba(74, 222, 200, 0.14)'],
  ['--border-strong', '#9fb1b8', '#5d7a84'],
  ['--radius', '14px', SAME],
  ['--radius-sm', '8px', SAME],
  ['--shadow', '0 8px 28px rgba(0, 65, 83, 0.08)', '0 0 0 1px rgba(255, 255, 255, 0.06), 0 8px 28px rgba(0, 0, 0, 0.45)'],
  ['--shadow-sm', '0 2px 8px rgba(0, 65, 83, 0.06)', '0 2px 8px rgba(0, 0, 0, 0.35)'],
  ['--surface-muted', '#fbfdfc', '#0a222b'],
  ['--surface-faded', '#fafcfb', '#0a222b'],
  ['--ink-muted', '#6b7f88', '#7d939b'],
  ['--ink-faint', '#9aa4ad', '#8fa6ae'],
  ['--input-bg', '#ffffff', '#061a22'],
  ['--input-border', '#6b7f88', '#64848d'],
  ['--scorebar-fill', 'var(--border-strong)', '#6a8a91'],
  ['--paper', '#ffffff', SAME],
  ['--paper-ink', '#1f1c18', SAME],
  ['--paper-ink-soft', '#4a5560', SAME],
  ['--paper-link', '#00735c', SAME],
  ['--paper-placeholder', '#757575', SAME],
  ['--logo-chip-bg', '#ffffff', '#e8f4f6'],
  ['--toast-bg', '#0b2430', '#163845'],
  ['--code-bg', '#0e1b26', SAME],
  ['--code-fg', '#f4f8f7', SAME],
  ['--selection-bg', '#0a5468', SAME],
  ['--primary-hover', '#2ee8b5', '#2ee8b5'],
  ['--primary-strong', '#004153', SAME],
  ['--primary-strong-hover', '#003241', SAME],
  ['--toast-action-hover', '#0a5468', SAME],
  ['--on-primary', '#0b2430', '#0b2430'],
  ['--on-strong', '#ffffff', SAME],
  ['--primary-tint', 'rgba(20, 221, 167, 0.15)', 'rgba(20, 221, 167, 0.18)'],
  ['--focus-ring', 'rgba(20, 221, 167, 0.18)', 'rgba(20, 221, 167, 0.40)'],
  ['--focus-ring-strong', 'rgba(20, 221, 167, 0.22)', 'rgba(20, 221, 167, 0.50)'],
  ['--focus-ring-card', 'rgba(20, 221, 167, 0.32)', 'rgba(20, 221, 167, 0.60)'],
  ['--danger-strong', '#c2362b', SAME],
  ['--warning-strong', '#8a5a0a', SAME],
  ['--tone-warning-bg', '#fdf3dc', 'rgba(242, 193, 78, 0.14)'],
  ['--tone-warning-bg-alt', '#fdf3dc', 'rgba(242, 193, 78, 0.14)'],
  ['--tone-warning-bg-soft', '#fff9ec', 'rgba(242, 193, 78, 0.08)'],
  ['--tone-warning-fg-strong', '#6b4a0c', '#f2c14e'],
  ['--tone-warning-border', '#e9cf96', 'rgba(242, 193, 78, 0.4)'],
  ['--tone-warning-border-strong', '#d6a85a', 'rgba(242, 193, 78, 0.55)'],
  ['--tone-warning-border-soft', '#f0d9a6', 'rgba(242, 193, 78, 0.3)'],
  ['--tone-warning-icon-bg', '#f8e6bd', 'rgba(242, 193, 78, 0.22)'],
  ['--tone-warning-icon-fg', '#8a5a0a', '#f2c14e'],
  ['--tone-danger-bg', '#fdecea', 'rgba(229, 72, 60, 0.18)'],
  ['--tone-danger-bg-soft', '#fdf1ec', 'rgba(229, 72, 60, 0.11)'],
  ['--tone-danger-bg-alt', '#fde8e2', 'rgba(229, 72, 60, 0.18)'],
  ['--tone-info-bg', '#e6f0fa', 'rgba(91, 159, 255, 0.16)'],
  ['--tone-info-border', '#b9dcf2', 'rgba(91, 159, 255, 0.35)'],
  ['--tone-success-bg', '#e2f6f0', 'rgba(20, 221, 167, 0.14)'],
  ['--tone-success-fg', '#00604f', '#5ff0c8'],
  ['--tone-neutral-bg', '#eceff0', 'rgba(159, 182, 191, 0.14)'],
  ['--tone-neutral-fg', '#475861', '#c3d3d9'],
  ['--star-on', '#f5a623', '#f5b942'],
  ['--star-off', '#c9c9c9', '#7d939b'],
  ['--shadow-logo', '0 2px 6px rgba(0, 65, 83, 0.08)', '0 2px 6px rgba(0, 0, 0, 0.4)'],
  ['--shadow-logo-lg', '0 4px 14px rgba(0, 65, 83, 0.10)', '0 4px 14px rgba(0, 0, 0, 0.45)'],
  ['--shadow-hover', '0 4px 14px rgba(0, 65, 83, 0.08)', '0 4px 14px rgba(0, 0, 0, 0.45)'],
  ['--shadow-popout', '0 24px 60px rgba(0, 65, 83, 0.28)', '0 24px 60px rgba(0, 0, 0, 0.6)'],
  ['--shadow-thumb', '0 2px 4px rgba(0, 0, 0, 0.18)', '0 2px 4px rgba(0, 0, 0, 0.5)'],
  ['--slider-thumb-ring', '#ffffff', '#0f2b35'],
  ['--overlay', 'rgba(11, 36, 48, 0.55)', 'rgba(0, 0, 0, 0.65)'],
  ['--overlay-popout', 'rgba(11, 36, 48, 0.55)', 'rgba(0, 0, 0, 0.65)'],
  ['--hover-tint', 'rgba(0, 0, 0, 0.04)', 'rgba(255, 255, 255, 0.05)'],
  ['--count-tint', 'rgba(0, 0, 0, 0.06)', 'rgba(255, 255, 255, 0.10)'],
  ['--on-strong-tint', 'rgba(255, 255, 255, 0.22)', SAME],
  ['--toast-outline', 'rgba(255, 255, 255, 0.45)', SAME],
  ['--toast-hover-tint', 'rgba(255, 255, 255, 0.1)', SAME],
];

const legados = (tokens: Record<string, string>) => Object.keys(tokens).filter((t) => !t.startsWith('--rf-'));

describe('TROCA-2: valores dos tokens legados (16.4)', () => {
  it('a tabela cobre exatamente os tokens legados do :root (nenhum a mais, nenhum a menos)', () => {
    expect(TABELA.map(([t]) => t).sort()).toEqual(legados(lightTokens).sort());
  });

  it('o bloco escuro redeclara so os legados que a tabela marca como variaveis (os "constante" ficam so no :root)', () => {
    const esperados = TABELA.filter(([, , d]) => d !== SAME).map(([t]) => t);
    const constantes = TABELA.filter(([, , d]) => d === SAME).map(([t]) => t);
    expect(legados(darkTokens).sort()).toEqual(esperados.sort());
    expect(constantes.filter((t) => t in darkTokens)).toEqual([]);
  });

  it('cada token legado tem EXATAMENTE o valor da tabela no claro', () => {
    for (const [token, claro] of TABELA) expect(lightTokens[token], `${token} (claro)`).toBe(claro);
  });

  it('cada token legado tem EXATAMENTE o valor da tabela no escuro (efetivo)', () => {
    for (const [token, claro, escuro] of TABELA) {
      expect(darkEffective[token], `${token} (escuro)`).toBe(escuro === SAME ? claro : escuro);
    }
  });
});

// [token legado, equivalente --rf-*, temas em que o valor e IGUAL ao do equivalente] (regras R1/R2 do 16.4).
type Par = readonly [string, string, 'ambos' | 'claro' | 'escuro'];
const EQUIVALENTES: ReadonlyArray<Par> = [
  ['--bg', '--rf-bg', 'ambos'],
  ['--surface', '--rf-surface', 'ambos'],
  ['--surface-alt', '--rf-surface-alt', 'ambos'],
  ['--ink', '--rf-ink', 'ambos'],
  ['--ink-soft', '--rf-ink-soft', 'ambos'],
  ['--primary', '--rf-primary', 'ambos'],
  ['--primary-700', '--rf-primary-700', 'ambos'],
  ['--primary-50', '--rf-primary-50', 'ambos'],
  ['--danger', '--rf-tone-danger-fg', 'ambos'],
  ['--warning', '--rf-tone-warning-fg', 'ambos'],
  ['--info', '--rf-tone-info-fg', 'ambos'],
  ['--border', '--rf-border', 'ambos'],
  ['--border-strong', '--rf-score-outros', 'ambos'],
  ['--surface-muted', '--rf-cmp-criterio-faixa', 'escuro'],
  ['--surface-faded', '--rf-cmp-criterio-faixa', 'escuro'],
  ['--ink-muted', '--rf-disabled-fg', 'ambos'],
  ['--input-bg', '--rf-input-bg', 'ambos'],
  ['--input-border', '--rf-input-border', 'ambos'],
  ['--logo-chip-bg', '--rf-ink', 'escuro'],
  ['--toast-bg', '--rf-toast-bg', 'ambos'],
  ['--selection-bg', '--rf-navy-soft', 'ambos'],
  ['--primary-hover', '--rf-primary-hover', 'ambos'],
  ['--primary-strong', '--rf-primary-strong', 'ambos'],
  ['--primary-strong-hover', '--rf-primary-strong-hover', 'ambos'],
  ['--toast-action-hover', '--rf-navy-soft', 'ambos'],
  ['--on-primary', '--rf-on-primary', 'ambos'],
  ['--danger-strong', '--rf-tone-danger-solid', 'ambos'],
  ['--warning-strong', '--rf-tone-warning-fg', 'claro'],
  ['--tone-warning-bg', '--rf-tone-warning-bg', 'ambos'],
  ['--tone-warning-bg-alt', '--rf-tone-warning-bg', 'ambos'],
  ['--tone-warning-fg-strong', '--rf-tone-warning-fg', 'escuro'],
  ['--tone-warning-border', '--rf-popover-aviso-borda', 'ambos'],
  ['--tone-warning-border-soft', '--rf-aviso-borda-suave', 'ambos'],
  ['--tone-warning-icon-bg', '--rf-aviso-icone-bg', 'ambos'],
  ['--tone-warning-icon-fg', '--rf-tone-warning-fg', 'ambos'],
  ['--tone-danger-bg', '--rf-tone-danger-bg', 'ambos'],
  ['--tone-info-bg', '--rf-tone-info-bg', 'ambos'],
  ['--tone-success-bg', '--rf-tone-success-bg', 'ambos'],
  ['--tone-success-fg', '--rf-tone-success-fg', 'ambos'],
  ['--tone-neutral-bg', '--rf-tone-neutral-bg', 'ambos'],
  ['--tone-neutral-fg', '--rf-tone-neutral-fg', 'ambos'],
  ['--star-off', '--rf-disabled-fg', 'escuro'],
  ['--slider-thumb-ring', '--rf-surface', 'escuro'],
  ['--overlay', '--rf-overlay', 'claro'],
  ['--overlay-popout', '--rf-overlay', 'claro'],
];

describe('TROCA-2: paleta unica (legado = --rf-* de mesmo papel, no mesmo tema)', () => {
  it('os tokens com equivalente tem o MESMO valor literal do --rf-* correspondente', () => {
    for (const [token, rf, temas] of EQUIVALENTES) {
      if (temas !== 'escuro') expect(lightTokens[token], `${token} = ${rf} (claro)`).toBe(lightTokens[rf]);
      if (temas !== 'claro') expect(darkEffective[token], `${token} = ${rf} (escuro)`).toBe(darkEffective[rf]);
    }
  });

  it('nenhum token legado declara var(--rf-...): o valor e literal (nos 2 blocos)', () => {
    const refs = [
      ...legados(lightTokens).filter((t) => (lightTokens[t] ?? '').includes('var(--rf-')),
      ...legados(darkTokens).filter((t) => (darkTokens[t] ?? '').includes('var(--rf-')),
    ];
    expect(refs).toEqual([]);
  });
});

describe('TROCA-2: limpeza (16.5)', () => {
  it('os 7 tokens da comparacao antiga nao existem (nem declarados, nem usados)', () => {
    const sairam = [
      '--winner-bg',
      '--winner-border',
      '--winner-track',
      '--winner-glow',
      '--winner-glow-soft',
      '--winner-glow-none',
      '--cmp-criteria-bg',
    ];
    for (const t of sairam) {
      expect(lightTokens[t], `${t} (claro)`).toBeUndefined();
      expect(darkTokens[t], `${t} (escuro)`).toBeUndefined();
      expect(css.includes(t), `${t} em qualquer lugar do CSS`).toBe(false);
    }
  });

  it('nenhum seletor das regras mortas existe no CSS', () => {
    const mortos =
      /^\s*\.(weight-grid|weight-slider|toast--|help-list|dispatcher-row--nested|dispatcher-group|dispatch-event__tokens|dispatch-token|muted\b|meta-grid|text-xs|item-form__scope|item-form__check)/;
    const achados = css
      .split('\n')
      .map((linha, i) => ({ linha: linha.trim(), n: i + 1 }))
      .filter(({ linha }) => mortos.test(linha));
    expect(achados).toEqual([]);
  });

  it('as regras vivas vizinhas das removidas seguem no CSS', () => {
    for (const vivo of [
      '.page-header__actions {',
      '.dispatcher-master-detail {',
      '.dispatcher-list {',
      '.dispatcher-row {',
      '.dispatch-event {',
      '.preview-frame {',
      '.form-grid {',
      '.text-sm {',
      '.sr-only {',
      '.item-form__error {',
      '.sol-items-list {',
      '@keyframes spin',
    ]) {
      expect(clean, vivo).toContain(vivo);
    }
  });
});

// ---------- contraste (WCAG 2.x; alfa composto sobre o --surface do tema, como no themeTokens.test.ts) ----------
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

function contrast(fg: string, bg: string, tokens: Record<string, string>): number {
  const a = luminance(opaque(tokens, `--${fg}`));
  const b = luminance(opaque(tokens, `--${bg}`));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT = 4.5;
const UI = 3;
// Pares do 16.4 (os mesmos do themeTokens.test.ts, sem os 3 que citavam tokens removidos, mais os de tons).
const PARES: ReadonlyArray<readonly [string, string, number]> = [
  ['ink', 'bg', TEXT],
  ['ink', 'surface', TEXT],
  ['ink', 'surface-alt', TEXT],
  ['ink-soft', 'surface', TEXT],
  ['ink-soft', 'surface-alt', TEXT],
  ['ink-soft', 'surface-muted', TEXT],
  ['ink-muted', 'surface', TEXT],
  ['ink-muted', 'input-bg', TEXT],
  ['ink-faint', 'surface', TEXT],
  ['ink-faint', 'surface-alt', TEXT],
  ['primary-700', 'surface', TEXT],
  ['primary-700', 'primary-50', TEXT],
  ['primary-700', 'surface-alt', TEXT],
  ['primary', 'surface', TEXT],
  ['danger', 'surface', TEXT],
  ['danger', 'tone-danger-bg', TEXT],
  ['danger', 'tone-danger-bg-soft', TEXT],
  ['ink', 'tone-danger-bg-soft', TEXT],
  ['ink-soft', 'tone-danger-bg-soft', TEXT],
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
  ['ink', 'selection-bg', TEXT],
  ['input-border', 'input-bg', UI],
  ['input-border', 'surface', UI],
  ['scorebar-fill', 'surface-alt', UI],
  ['star-on', 'surface', UI],
  ['star-off', 'surface', UI],
  ['paper-ink', 'paper', TEXT],
  ['primary-700', 'surface-alt', UI],
  ['tone-warning-fg-strong', 'tone-warning-bg-soft', TEXT],
  ['ink', 'tone-warning-bg-soft', TEXT],
  ['ink-soft', 'tone-warning-bg', TEXT],
  ['ink-soft', 'primary-50', TEXT],
  ['primary-700', 'tone-success-bg', TEXT],
  ['warning', 'tone-warning-bg-soft', TEXT],
  ['info', 'surface-alt', TEXT],
  ['danger', 'surface-alt', TEXT],
  ['border-strong', 'surface', UI],
  ['border', 'surface', UI],
  ['primary', 'surface', UI],
  ['tone-warning-border-strong', 'surface', UI],
];

// Excecoes HERDADAS (abaixo do minimo; nenhuma piora em relacao a antes da TROCA-2, exceto o --primary como TEXTO, que
// passa a ser so preenchimento - 16.4/D-T2-01). Chave `fg|bg|min`; razao medida (2 casas). O F13 decide as do Forecast.
const EXCECOES_CLARO: Record<string, number> = {
  'ink-muted|surface|4.5': 4.19, // melhora (era 3,81); 3 regras do Forecast
  'ink-muted|input-bg|4.5': 4.19, // melhora (era 3,81)
  'ink-faint|surface|4.5': 2.53, // fica; 4 regras do Forecast
  'ink-faint|surface-alt|4.5': 2.37, // melhora (era 2,27)
  'primary|surface|4.5': 1.76, // so preenchimento/borda/ponto no Forecast; nenhuma regra usa como cor de texto (era 2,81)
  'ink|selection-bg|4.5': 1.89, // --selection-bg so existe no escuro (7,54 la)
  'scorebar-fill|surface-alt|3': 2.08, // sem uso
  'star-on|surface|3': 2.03, // fica
  'star-off|surface|3': 1.66, // fica (sem uso)
  'border-strong|surface|3': 2.22, // decorativa (era 1,67)
  'border|surface|3': 1.33, // decorativa
  'primary|surface|3': 1.76, // idem 'primary|surface|4.5'
  'tone-warning-border-strong|surface|3': 2.19, // decorativa; fica
};
const EXCECOES_ESCURO: Record<string, number> = {
  'border|surface|3': 1.38, // decorativa (borda translucida sobre o --surface)
};

describe('TROCA-2: contraste dos pares nos 2 temas (alfa composto sobre o --surface do tema)', () => {
  const chave = (fg: string, bg: string, min: number) => `${fg}|${bg}|${min}`;

  it('claro: todo par passa, salvo a lista exata de excecoes herdadas (com a razao medida)', () => {
    const rows = PARES.map(([fg, bg, min]) => ({ k: chave(fg, bg, min), min, ratio: contrast(fg, bg, lightTokens) }));
    const falhas = rows.filter((r) => r.ratio < r.min).map((r) => r.k);
    expect(falhas.sort()).toEqual(Object.keys(EXCECOES_CLARO).sort());
    for (const [k, medido] of Object.entries(EXCECOES_CLARO)) {
      const r = rows.find((x) => x.k === k);
      expect(r, k).toBeDefined();
      expect(r?.ratio ?? 0, k).toBeCloseTo(medido, 2);
    }
  });

  it('escuro: todo par passa, salvo a decorativa --border sobre --surface (1,38)', () => {
    const rows = PARES.map(([fg, bg, min]) => ({ k: chave(fg, bg, min), min, ratio: contrast(fg, bg, darkEffective) }));
    const falhas = rows.filter((r) => r.ratio < r.min).map((r) => r.k);
    expect(falhas.sort()).toEqual(Object.keys(EXCECOES_ESCURO).sort());
    for (const [k, medido] of Object.entries(EXCECOES_ESCURO)) {
      expect(rows.find((x) => x.k === k)?.ratio ?? 0, k).toBeCloseTo(medido, 2);
    }
  });
});

describe('TROCA-2: fora dos tokens', () => {
  it('scrollbar-color do escuro: trilho = --rf-bg escuro (#061a22)', () => {
    expect(darkBlock.body).toMatch(/scrollbar-color:\s*#3d5a62 #061a22;/);
    expect(darkTokens['--rf-bg']).toBe('#061a22');
  });
});
