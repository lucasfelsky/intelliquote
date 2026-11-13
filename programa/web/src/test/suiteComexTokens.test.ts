/// <reference types="node" />
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  fixtureUniao,
  foraDasRegioes,
  opaque as opaqueOf,
  over,
  parseColor,
  parseRules,
  ratioOf,
  readSource,
  regioes,
  temasDeTokens,
  tokensDosTemas,
  type FixtureToken,
  type Rgb,
  type Rgba,
  type ThemeName,
} from './rfCss';

// Base ADITIVA dos tokens --rf-* (Suite COMEX, mock v68). Esta guarda cobre:
//  - paridade: o CSS tem exatamente os tokens da UNIAO das fixtures (suiteComexTokens.json + suiteComexTokens.f3x.json), com os valores
//    de cada fixture (claro e escuro). A fixture base continua afirmando 84/36/48 para si; cada etapa da F3 acrescenta o seu arquivo;
//  - contraste WCAG 2.x nos 2 temas, compondo alpha sobre o --rf-surface do tema;
//  - excecoes de contraste do proprio mock, explicitas (o conjunto de reprovados tem de ser EXATAMENTE a lista);
//  - invariantes: so consomem var(--rf-*) as regioes delimitadas, contiguas: uma lista FIXA (base da pagina, shell F2, componentes F3a, F3b, F3c, F3d, compat Forecast F3) e depois
//    so regioes `tela F<n>` com n estritamente crescente (F4, F5, ...; vazia e permitida); --rf-* so e DECLARADO nos 2 blocos de token; login.css (se existir: a F4 o apaga), index.html e src/**/*.{ts,tsx} nao-teste seguem sem consumo.
//  - O que cada regiao F3 pode conter (seletores, at-rules, reduced-motion, MIGRADAS) e conferido pelo teste da PROPRIA etapa
//    (componentesF3a.test.ts ... F3d), nao aqui. PAIRS e KNOWN_EXCEPTIONS deste arquivo nao mudam mais na F3: pares novos ficam no teste da etapa.
// Funcoes de apoio: ./rfCss.ts (nao e teste).

const css = readSource('../styles/globals.css');
const loginCss = existsSync(new URL('../styles/login.css', import.meta.url)) ? readSource('../styles/login.css') : '';
const indexHtml = readSource('../../index.html');

const fixtureBase = JSON.parse(readSource('./fixtures/suiteComexTokens.json')) as FixtureToken[];
const fixture = fixtureUniao();

const tsSources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../test/**', '!../**/*.test.ts', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// ---------- regioes e blocos de token ----------
const SHELL_NOME = 'shell F2';
// Lista FIXA, na ordem em que aparecem no CSS: a base, o shell, as 4 etapas da F3 (cada uma pode estar vazia) e a compat do Forecast.
// Depois dela, so `tela F<n>` com n estritamente crescente (as ondas novas nao editam mais este teste).
const REGIOES_FIXAS = ['base da pagina', 'shell F2', 'componentes F3a', 'componentes F3b', 'componentes F3c', 'componentes F3d', 'compat Forecast F3'] as const;
const TELA = /^tela F(\d+)$/;
const rawLf = css.replace(/\r\n/g, '\n');
const regs = regioes(rawLf);
const cssOutsideRegions = foraDasRegioes(rawLf, regs);
const shell = regs.find((r) => r.nome === SHELL_NOME);
const regionClean = shell?.limpo ?? '';
const regionRules = shell?.regras ?? [];
const { claro: lightTokens, escuro: darkTokens, resto: restOfCss } = tokensDosTemas(rawLf);

const rfOf = (tokens: Record<string, string>) => Object.keys(tokens).filter((t) => t.startsWith('--rf-'));
const lightRf = rfOf(lightTokens);
const darkRf = rfOf(darkTokens);

// ---------- paridade com a fixture ----------
describe('--rf-*: paridade CSS x fixtures (mock v68)', () => {
  const pairs = fixture.filter((t) => !t.constante);
  const constants = fixture.filter((t) => t.constante);

  it('a fixture base tem 84 tokens: 36 pares claro/escuro e 48 constantes, sem repeticao', () => {
    expect(fixtureBase).toHaveLength(84);
    expect(fixtureBase.filter((t) => !t.constante)).toHaveLength(36);
    expect(fixtureBase.filter((t) => t.constante)).toHaveLength(48);
    expect(new Set(fixtureBase.map((t) => t.token)).size).toBe(84);
  });

  it('a uniao das fixtures contem a base e nao repete nenhum token', () => {
    expect(fixture.length).toBeGreaterThanOrEqual(84);
    expect(new Set(fixture.map((t) => t.token)).size).toBe(fixture.length);
    for (const t of fixtureBase) expect(fixture.map((x) => x.token), t.token).toContain(t.token);
    const arquivos = [...new Set(fixture.map((t) => t.arquivo))];
    expect(arquivos).toContain('suiteComexTokens.json');
    for (const arquivo of arquivos) expect(arquivo, arquivo).toMatch(/^suiteComexTokens(\.f(3[a-d]|[4-9]|1[0-2]|13[b-e]|14))?\.json$/);
  });

  it('os 3 tokens da F2 (desenhados pelo mock) estao na fixture', () => {
    const byName = Object.fromEntries(fixture.map((t) => [t.token, t]));
    expect(byName['--rf-control-hover-border']).toMatchObject({ claro: '#b9cbc6', escuro: 'rgba(74, 222, 200, 0.28)', fonte: 'mock' });
    expect(byName['--rf-avatar-ring']).toMatchObject({ claro: 'none', escuro: '0 0 0 1px rgba(20, 221, 167, 0.35)', fonte: 'mock' });
    expect(byName['--rf-brand-tile-on-navy']).toMatchObject({ claro: 'rgba(255, 255, 255, 0.10)', escuro: null, constante: true, fonte: 'mock' });
  });

  it('a fixture so tem valores publicos: ref e nome de board ou token, nunca URL ou caminho', () => {
    for (const t of fixture) {
      expect(t.token, t.token).toMatch(/^--rf-[a-z0-9-]+$/);
      expect(['mock', 'decisao', 'spec', 'portal'], t.token).toContain(t.fonte);
      expect(t.ref, t.token).not.toMatch(/https?:|[\\/]{2}|[A-Za-z]:\\|\.html|\.json/);
      expect(t.escuro === null, t.token).toBe(t.constante);
    }
  });

  it('o conjunto de --rf-* do :root e exatamente o da uniao das fixtures', () => {
    expect([...lightRf].sort()).toEqual(fixture.map((t) => t.token).sort());
  });

  it('o valor claro de cada token confere com a fixture', () => {
    const wrong = fixture.filter((t) => lightTokens[t.token] !== t.claro).map((t) => `${t.token}: ${lightTokens[t.token]}`);
    expect(wrong).toEqual([]);
  });

  it('o bloco escuro tem exatamente os pares da uniao, com o valor escuro da fixture', () => {
    expect([...darkRf].sort()).toEqual(pairs.map((t) => t.token).sort());
    const wrong = pairs.filter((t) => darkTokens[t.token] !== t.escuro).map((t) => `${t.token}: ${darkTokens[t.token]}`);
    expect(wrong).toEqual([]);
  });

  it('constante nao e repetida no bloco escuro', () => {
    expect(constants.filter((t) => t.token in darkTokens).map((t) => t.token)).toEqual([]);
  });
});

// ---------- cor / contraste ----------
const THEMES = temasDeTokens(lightTokens, darkTokens);

// Compoe o token (com alpha) sobre o --rf-surface do tema antes de medir.
const opaque = (theme: ThemeName, name: string): Rgb => opaqueOf(THEMES[theme], name);

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

  // ---- Shell F2: estados compostos sobre o navy. A sidebar e igual nos 2 temas (tokens constantes); cada estado
  // e medido nas 2 pontas do gradiente e vale a pior.
  const tok = (name: string): Rgba => parseColor(lightTokens[name] ?? '');
  const rgbOf = ([r, g, b]: Rgba): Rgb => [r, g, b];
  const stops = gradient.map((stop) => rgbOf(parseColor(stop)));
  const onNavy = (id: string, min: number, fg: string, layers: string[]) => {
    const worstOfStops = Math.min(
      ...stops.map((navy) => {
        const bg = layers.reduce<Rgb>((under, layer) => over(tok(layer), under), navy);
        return ratioOf(over(tok(fg), bg), bg);
      }),
    );
    rows.push({ id: `ambos: ${id}`, min, ratio: Number(worstOfStops.toFixed(2)), ok: worstOfStops >= min });
  };
  onNavy('sidebar link ativo (--rf-sidebar-ink / pilula ativa)', TEXT, '--rf-sidebar-ink', ['--rf-sidebar-active-bg']);
  onNavy('sidebar hover (--rf-sidebar-ink / hover)', TEXT, '--rf-sidebar-ink', ['--rf-sidebar-hover']);
  onNavy('sidebar item inativo (--rf-sidebar-ink-soft / navy)', TEXT, '--rf-sidebar-ink-soft', []);
  onNavy('rotulo ADMINISTRACAO (--rf-sidebar-ink-soft / navy)', TEXT, '--rf-sidebar-ink-soft', []);
  onNavy('selo inativo (--rf-sidebar-tag-fg / --rf-sidebar-tag-bg)', TEXT, '--rf-sidebar-tag-fg', ['--rf-sidebar-tag-bg']);
  onNavy('marca (--rf-sidebar-brand-ink / navy)', TEXT, '--rf-sidebar-brand-ink', []);
  onNavy('botao de tema (--rf-sidebar-ink-soft / navy)', TEXT, '--rf-sidebar-ink-soft', []);
  onNavy('botao de tema em hover (--rf-sidebar-ink / --rf-sidebar-hover)', TEXT, '--rf-sidebar-ink', ['--rf-sidebar-hover']);
  onNavy('anel de foco (--rf-primary / navy)', UI, '--rf-primary', []);
  const avatar = ratioOf(rgbOf(tok('--rf-sidebar-ink')), rgbOf(tok('--rf-primary-strong')));
  rows.push({ id: 'ambos: avatar (--rf-sidebar-ink / --rf-primary-strong)', min: TEXT, ratio: Number(avatar.toFixed(2)), ok: avatar >= TEXT });
  const contador = ratioOf(rgbOf(tok('--rf-on-primary')), rgbOf(tok('--rf-primary')));
  rows.push({ id: 'ambos: contador (--rf-on-primary / --rf-primary)', min: TEXT, ratio: Number(contador.toFixed(2)), ok: contador >= TEXT });
  // Foco da topbar: --rf-action (anel externo) contra o fundo da pagina, em cada tema.
  for (const theme of ['claro', 'escuro'] as const) {
    const ratio = ratioOf(opaque(theme, '--rf-action'), opaque(theme, '--rf-bg'));
    rows.push({ id: `${theme}: foco da topbar (--rf-action / --rf-bg)`, min: UI, ratio: Number(ratio.toFixed(2)), ok: ratio >= UI });
  }
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
    expect(rows).toHaveLength(PAIRS.length * 2 + 1 + 13);
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

// ---------- invariantes ----------
const ALLOWED_AT_RULES = [
  '@keyframes rf-page-enter',
  '@keyframes rf-page-fade',
  '@keyframes rf-dica-in', // dica do icone da sidebar recolhida
  '@media (max-width: 880px)',
  '@media (min-width: 881px)', // sidebar recolhida (so icones): so existe acima do breakpoint de empilhar
  '@media (pointer: coarse)',
  '@media (prefers-reduced-motion: reduce)',
];
// O \b do PLAN nao casa sufixos BEM (.sidebar__link: "r" e "_" sao ambos \w); basta o proximo caractere nao ser alfanumerico.
const SHELL_SELECTOR = /^(:root\[data-theme="dark"\]\s+)?(\.app-shell|\.sidebar|\.topbar|\.brand-mark|\.sq-logo)(?![A-Za-z0-9])/;

function regionSelectors(): string[] {
  const out: string[] = [];
  for (const rule of regionRules) {
    if (rule.prelude.startsWith('@media')) {
      for (const inner of parseRules(rule.body)) out.push(...inner.prelude.split(',').map((x) => x.trim()));
    } else if (!rule.prelude.startsWith('@')) {
      out.push(...rule.prelude.split(',').map((x) => x.trim()));
    }
  }
  return out;
}

describe('--rf-*: invariantes (so as regioes permitidas consomem; so os 2 blocos declaram)', () => {
  it('as regioes permitidas existem uma vez cada, na ordem (fixas e depois tela F<n> crescente), todas contiguas', () => {
    const nomes = regs.map((r) => r.nome);
    expect(nomes.slice(0, REGIOES_FIXAS.length)).toEqual([...REGIOES_FIXAS]);
    const telas = nomes.slice(REGIOES_FIXAS.length);
    for (const nome of telas) expect(nome).toMatch(TELA);
    const numeros = telas.map((nome) => Number(TELA.exec(nome)?.[1]));
    numeros.forEach((n, i) => {
      if (i > 0) expect(n, telas[i]).toBeGreaterThan(numeros[i - 1] ?? Infinity);
    });
    for (const nome of nomes) {
      expect(rawLf.split(`/* >>> ${nome} (Suite COMEX) >>> */`), nome).toHaveLength(2);
      expect(rawLf.split(`/* <<< ${nome} <<< */`), nome).toHaveLength(2);
    }
    for (let i = 1; i < regs.length; i++) {
      const anterior = regs[i - 1];
      const atual = regs[i];
      expect(anterior && atual && anterior.fim <= atual.inicio, nomes[i]).toBe(true);
      expect(rawLf.slice(anterior?.fim ?? 0, atual?.inicio ?? 0).trim(), `entre ${nomes[i - 1]} e ${nomes[i]}`).toBe('');
    }
  });

  it('o shell F2 tem regras; as regioes F3 podem estar vazias (cada etapa confere a sua)', () => {
    expect(shell).toBeDefined();
    expect(regionRules.length).toBeGreaterThan(20);
  });

  it('var(--rf- so aparece DENTRO de alguma regiao (nada fora delas, nem nos blocos de token)', () => {
    expect(cssOutsideRegions).not.toContain('var(--rf-');
    expect(regionClean).toContain('var(--rf-');
  });

  it('nenhuma regiao DECLARA --rf-*: so usa var()', () => {
    for (const r of regs) expect(r.limpo, r.nome).not.toMatch(/(^|[;{\s])--rf-[\w-]+\s*:/);
  });

  it('todo seletor do shell F2 e do shell (app-shell, sidebar, topbar, brand-mark, sq-logo)', () => {
    const selectors = regionSelectors();
    expect(selectors.length).toBeGreaterThan(40);
    expect(selectors.filter((sel) => !SHELL_SELECTOR.test(sel))).toEqual([]);
  });

  it('shell F2: so os at-rules previstos (keyframes de entrada, <= 880, >= 881 da sidebar recolhida, pointer: coarse e reduced-motion)', () => {
    const atRules = regionRules.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    expect(atRules.filter((a) => !ALLOWED_AT_RULES.includes(a))).toEqual([]);
    for (const required of ALLOWED_AT_RULES) expect(atRules, required).toContain(required);
    for (const rule of regionRules.filter((r) => r.prelude.startsWith('@media'))) {
      for (const inner of parseRules(rule.body)) expect(inner.prelude.startsWith('@'), inner.prelude).toBe(false);
    }
  });

  it('o resto do CSS segue sem --rf- (fora das regioes e dos 2 blocos) e o login.css nao usa token', () => {
    expect(restOfCss).not.toContain('--rf-');
    expect(loginCss).not.toContain('--rf-');
  });

  it('login.css, index.html e src (nao-teste) nao consomem var(--rf-: componentes usam classes, nunca estilo inline com token', () => {
    expect(loginCss).not.toContain('var(--rf-');
    expect(indexHtml).not.toContain('var(--rf-');
    const offenders = Object.entries(tsSources)
      .filter(([, source]) => source.includes('var(--rf-'))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
    expect(Object.keys(tsSources).length).toBeGreaterThan(0);
  });

  it('Sora so aparece na linha --rf-font-display do CSS e na familia do <link> do index.html', () => {
    const soraLines = css.split(/\r?\n/).filter((line) => line.includes('Sora'));
    expect(soraLines).toHaveLength(1);
    expect(soraLines[0]).toMatch(/^\s*--rf-font-display:/);
    expect(loginCss).not.toContain('Sora');
    expect(indexHtml.match(/Sora/g)).toHaveLength(1);
    expect(indexHtml).toContain('&family=Sora:wght@400;600;700&display=swap');
  });

  it('JetBrains Mono nao e carregada pelo <link> (F2-D1: so token; o shell cai em ui-monospace)', () => {
    expect(indexHtml).not.toContain('JetBrains');
  });
});
