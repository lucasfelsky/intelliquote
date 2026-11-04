/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  foraDasRegioes,
  opaque as opaqueOf,
  parseRules,
  ratioOf,
  readSource,
  regioes,
  stripComments,
  temasDeTokens,
  tokensDosTemas,
  type CssRule,
  type Rgb,
  type ThemeName,
} from './rfCss';

// TROCA-1 (Suite COMEX, mock v68; boards Cotacoes, CotacaoResumo, Overview, SolicitacoesComex, Fornecedores, ForecastPainel e os *Escuro):
// base da pagina (fundo, texto base, links, h1-h3, eyebrow, pagina e cabecalho de pagina). CSS na regiao `base da pagina` do globals.css,
// logo antes do shell. NENHUM valor de token antigo muda (themeTokens.test.ts e FROZEN_LIGHT ficam como estao: a TROCA-2 e outra fase).
// Esta guarda cobre: a regiao (posicao, seletores permitidos, declaracoes exatas, sem !important/at-rule/transicao/cor literal), que nada
// da base sobrou fora dela, que o .app-shell usa --rf-bg e nenhuma regiao usa var(--bg), e o contraste nos 2 temas do texto --rf-* sobre os
// fundos ANTIGOS (as telas ainda nao migradas mantem cartoes antigos) e sobre --rf-bg (eyebrow e subtitulo).

const NOME = 'base da pagina';
const rawLf = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regs = regioes(rawLf);
const regiao = regs.find((r) => r.nome === NOME);
const fora = foraDasRegioes(rawLf, regs);
const { claro: lightTokens, escuro: darkTokens } = tokensDosTemas(rawLf);
const THEMES = temasDeTokens(lightTokens, darkTokens);

// ---------- utilitarios de CSS ----------
function listaDeSeletores(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let atual = '';
  for (const ch of prelude) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(atual.replace(/\s+/g, ' ').trim());
      atual = '';
    } else atual += ch;
  }
  if (atual.trim()) out.push(atual.replace(/\s+/g, ' ').trim());
  return out;
}

function declaracoes(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, prop, valor] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) {
    if (prop !== undefined && valor !== undefined) out[prop] = valor.replace(/\s+/g, ' ').trim();
  }
  return out;
}

const preludeNorm = (r: CssRule) => listaDeSeletores(r.prelude).join(', ');
const regras = regiao?.regras ?? [];
const regrasFora = parseRules(stripComments(fora));
const declsDe = (seletor: string) => declaracoes(regras.find((r) => preludeNorm(r) === seletor)?.body ?? '');

// ---------- o que a TROCA-1 define (tabela 13.1 do plano) ----------
const FONTE_DISPLAY = 'var(--rf-font-display)';
const MARGEM_ANTIGA = '0 0 12px 0';

const ESPERADO: ReadonlyArray<readonly [seletor: string, decls: Record<string, string>]> = [
  [
    'body',
    {
      background: 'var(--rf-bg)',
      color: 'var(--rf-ink)',
      'font-family': 'var(--rf-font-sans)',
      '-webkit-font-smoothing': 'antialiased',
      '-moz-osx-font-smoothing': 'grayscale',
    },
  ],
  ['a', { color: 'var(--rf-primary-700)', 'text-decoration': 'none' }],
  ['a:hover', { 'text-decoration': 'underline' }],
  [':where(a):hover', { color: 'var(--rf-primary-700-hover)' }],
  [
    'h1',
    {
      margin: MARGEM_ANTIGA,
      'font-family': FONTE_DISPLAY,
      'font-size': '30px',
      'font-weight': '700',
      'letter-spacing': '-0.02em',
      'line-height': '1.15',
      color: 'var(--rf-ink)',
    },
  ],
  ['h2', { margin: MARGEM_ANTIGA, 'font-family': FONTE_DISPLAY, 'font-size': '20px', 'font-weight': '700', 'letter-spacing': '-0.01em', color: 'var(--rf-ink)' }],
  ['h3', { margin: MARGEM_ANTIGA, 'font-family': FONTE_DISPLAY, 'font-size': '16px', 'font-weight': '700', color: 'var(--rf-ink)' }],
  [
    '.eyebrow',
    {
      'text-transform': 'uppercase',
      'letter-spacing': '1.5px',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '11px',
      'font-weight': '600',
      color: 'var(--rf-primary-700)',
      'margin-bottom': '4px',
    },
  ],
  ['.page', { display: 'flex', 'flex-direction': 'column', gap: '20px' }],
  [
    '.page > .page-header',
    { display: 'flex', 'flex-wrap': 'wrap', 'justify-content': 'space-between', 'align-items': 'flex-end', gap: '12px' },
  ],
  ['.page > .page-header > :first-child', { display: 'flex', 'flex-direction': 'column', gap: '4px', 'min-width': '0' }],
  ['.page > .page-header > :first-child > .eyebrow, .page > .page-header > :first-child > h1', { margin: '0' }],
  [
    '.page > .page-header h1 + p, .page-subtitle, .page__subtitle',
    { margin: '0', 'font-size': '15px', 'line-height': '1.6', color: 'var(--rf-ink-soft)', 'max-width': '720px' },
  ],
  ['.page > .page-header > .page-header__actions', { gap: '8px', 'align-items': 'center' }],
];

const ELEMENTOS_PERMITIDOS = new Set(['body', 'a', 'h1', 'h2', 'h3', 'p']);
const PERMITIDAS_BASE = new Set(['eyebrow', 'page', 'page-header', 'page-header__actions', 'page-subtitle', 'page__subtitle']);

// Seletor so com elementos body/a/h1/h2/h3 (e o `p` do subtitulo `h1 + p`) e as classes de PERMITIDAS_BASE; pseudo e :root[data-theme="dark"] livres.
function violacoesDoSeletor(seletor: string): string[] {
  const limpo = seletor
    .replace(/:root\[data-theme="dark"\]/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/::?[\w-]+(\([^)]*\))?/g, ' ');
  const out: string[] = [];
  for (const [, classe] of limpo.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    if (classe !== undefined && !PERMITIDAS_BASE.has(classe)) out.push(`classe .${classe}`);
  }
  const semClasses = limpo.replace(/\.(-?[_a-zA-Z][\w-]*)/g, ' ');
  for (const [, elemento] of semClasses.matchAll(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g)) {
    if (elemento !== undefined && !ELEMENTOS_PERMITIDOS.has(elemento)) out.push(`elemento ${elemento}`);
  }
  return out;
}

describe('TROCA-1: regiao `base da pagina`', () => {
  it('existe uma vez, e fica imediatamente antes do shell F2 (so espaco entre as duas)', () => {
    expect(rawLf.split(`/* >>> ${NOME} (Suite COMEX) >>> */`)).toHaveLength(2);
    expect(rawLf.split(`/* <<< ${NOME} <<< */`)).toHaveLength(2);
    expect(regs[0]?.nome).toBe(NOME);
    expect(regs[1]?.nome).toBe('shell F2');
    expect(rawLf.slice(regs[0]?.fim ?? 0, regs[1]?.inicio ?? 0).trim()).toBe('');
  });

  it('tem exatamente as regras da tabela da TROCA-1, na ordem', () => {
    expect(regras.map(preludeNorm)).toEqual(ESPERADO.map(([seletor]) => seletor));
  });

  it('cada regra tem EXATAMENTE as declaracoes do board (sem a mais, sem a menos)', () => {
    for (const [seletor, decls] of ESPERADO) expect(declsDe(seletor), seletor).toEqual(decls);
  });

  it('todo seletor usa so body, a, h1, h2, h3 e as classes da base da pagina', () => {
    const seletores = regras.flatMap((r) => listaDeSeletores(r.prelude));
    expect(seletores.length).toBeGreaterThan(10);
    for (const seletor of seletores) expect(violacoesDoSeletor(seletor), seletor).toEqual([]);
    // o detector de violacao pega o que deve pegar (sanidade do proprio teste)
    expect(violacoesDoSeletor('.page h4')).toEqual(['elemento h4']);
    expect(violacoesDoSeletor('.card h1')).toEqual(['classe .card']);
    expect(violacoesDoSeletor(':root[data-theme="dark"] a:hover')).toEqual([]);
  });

  it('sem at-rule, !important, transicao, animacao nem cor literal; so var(--rf-*)', () => {
    const bruto = regiao?.limpo ?? '';
    expect(regras.filter((r) => r.prelude.startsWith('@'))).toEqual([]);
    expect(bruto).not.toContain('!important');
    expect(bruto).not.toMatch(/(^|[;{\s])(transition|animation)\s*:/);
    expect(bruto).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    for (const [, nome] of bruto.matchAll(/var\(\s*(--[\w-]+)/g)) expect(nome, 'token de var()').toMatch(/^--rf-/);
    expect(bruto).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
  });
});

describe('TROCA-1: nada da base sobrou fora da regiao', () => {
  const FORA_PROIBIDOS = ['body', 'a', 'a:hover', 'h1', 'h2', 'h3', '.eyebrow', '.page'];

  it('nenhum seletor de nivel superior igual a body, a, a:hover, h1, h2, h3, .eyebrow ou .page', () => {
    // O reset "html, body, #root { height: 100%; margin: 0 }" e anterior e nao e base de pagina: fica (so tamanho e margem).
    const RESET = 'html, body, #root';
    const achados = regrasFora.filter((r) => !r.prelude.startsWith('@') && preludeNorm(r) !== RESET).flatMap((r) => listaDeSeletores(r.prelude));
    expect(achados.filter((s) => FORA_PROIBIDOS.includes(s))).toEqual([]);
    expect(regrasFora.filter((r) => preludeNorm(r) === RESET).map((r) => declaracoes(r.body))).toEqual([{ height: '100%', margin: '0' }]);
  });

  it('h4 e p globais seguem como estavam (D-T-04); regras com classe a mais seguem validas', () => {
    const decls = (seletor: string) => regrasFora.filter((r) => preludeNorm(r) === seletor).map((r) => declaracoes(r.body));
    expect(decls('h4')).toEqual([{ margin: MARGEM_ANTIGA, color: 'var(--ink)' }]);
    expect(decls('p')).toEqual([{ margin: '0 0 8px 0', 'line-height': '1.5', color: 'var(--ink-soft)' }]);
    expect(regrasFora.some((r) => preludeNorm(r) === '.page-header__actions')).toBe(true);
    expect(regrasFora.some((r) => preludeNorm(r) === '.page-header__actions > button, .page-header__actions > a')).toBe(true);
  });
});

describe('TROCA-1: fundo da pagina', () => {
  it('o .app-shell usa var(--rf-bg) (o fundo visivel atras do conteudo) e nenhuma regiao usa var(--bg)', () => {
    const shell = regs.find((r) => r.nome === 'shell F2');
    const appShell = shell?.regras.find((r) => preludeNorm(r) === '.app-shell');
    expect(declaracoes(appShell?.body ?? '')['background-color']).toBe('var(--rf-bg)');
    for (const r of regs) expect(r.limpo, r.nome).not.toContain('var(--bg)');
  });

  it('depois da TROCA-2 os tokens usados pelos boards v68 e o --bg legado tem o mesmo valor do --rf-bg nos 2 temas', () => {
    expect(lightTokens['--rf-bg']).toBe('#eef2f1');
    expect(darkTokens['--rf-bg']).toBe('#061a22');
    expect(lightTokens['--rf-ink']).toBe('#0b2430');
    expect(darkTokens['--rf-ink']).toBe('#e8f4f6');
    expect(lightTokens['--rf-primary-700']).toBe('#007864');
    expect(darkTokens['--rf-primary-700']).toBe('#14dda7');
    expect(lightTokens['--bg']).toBe('#eef2f1');
    expect(darkTokens['--bg']).toBe('#061a22');
  });
});

// ---------- contraste (WCAG 2.x) nos 2 temas ----------
// Texto --rf-* sobre os fundos ANTIGOS (cartoes das telas ainda nao migradas) e sobre --rf-bg (eyebrow e subtitulo da pagina).
const TEXT = 4.5;
const FUNDOS_ANTIGOS = ['--surface', '--surface-alt', '--surface-muted'] as const;
const opaque = (tema: ThemeName, nome: string): Rgb => opaqueOf(THEMES[tema], nome);

const PARES: ReadonlyArray<readonly [fg: string, bg: string]> = [
  ...FUNDOS_ANTIGOS.map((bg) => ['--rf-ink', bg] as const),
  ...FUNDOS_ANTIGOS.map((bg) => ['--rf-ink-soft', bg] as const),
  ['--rf-primary-700', '--surface'],
  ['--rf-primary-700', '--surface-alt'],
  ['--rf-primary-700-hover', '--surface'],
  ['--rf-primary-700-hover', '--surface-alt'],
  ['--rf-ink-soft', '--rf-bg'],
  ['--rf-primary-700', '--rf-bg'],
  ['--rf-primary-700-hover', '--rf-bg'],
];

describe('TROCA-1: contraste do texto novo sobre fundos antigos e sobre --rf-bg (>= 4,5 nos 2 temas)', () => {
  const linhas = (['claro', 'escuro'] as const).flatMap((tema) =>
    PARES.map(([fg, bg]) => ({ id: `${tema}: ${fg} / ${bg}`, ratio: ratioOf(opaque(tema, fg), opaque(tema, bg)) })),
  );

  it('mede todos os pares nos 2 temas', () => {
    console.table(linhas.map((l) => ({ par: l.id, ratio: Number(l.ratio.toFixed(2)) })));
    expect(linhas).toHaveLength(PARES.length * 2);
  });

  it('nenhum par fica abaixo de 4,5:1', () => {
    expect(linhas.filter((l) => l.ratio < TEXT).map((l) => `${l.id} = ${l.ratio.toFixed(2)}`)).toEqual([]);
  });

  it('o eyebrow (#007864 sobre o fundo claro da pagina e do cartao antigo) passa AA', () => {
    expect(ratioOf(opaque('claro', '--rf-primary-700'), opaque('claro', '--surface-alt'))).toBeGreaterThanOrEqual(TEXT);
    expect(ratioOf(opaque('claro', '--rf-primary-700'), opaque('claro', '--rf-bg'))).toBeGreaterThanOrEqual(TEXT);
  });
});
