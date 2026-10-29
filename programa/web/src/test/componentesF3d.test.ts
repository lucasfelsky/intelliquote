/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  classesDoSeletor,
  fixtureUniao,
  foraDasRegioes,
  opaque as opaqueOf,
  parseRules,
  ratioOf,
  readSource,
  regioes,
  temasDeTokens,
  tokensDosTemas,
  ultimoComposto,
  type CssRule,
  type Rgb,
  type ThemeName,
} from './rfCss';

// F3d (Suite COMEX, mock v68; boards Componentes, Cotacoes, CotacoesEstados e Movimento): abas, paginacao, estrelas, cartao, vazio, erro,
// skeleton e spinner. CSS na regiao `componentes F3d` do globals.css, mais os 3 primitivos TSX (Tabs, Pagination, StarRating), que so
// trocam estilo inline por classe. Esta guarda cobre: os 3 tokens da etapa, o contraste (e as 2 excecoes do mock), as receitas, os
// invariantes da regiao (classes permitidas, at-rules, reduced-motion, sem cor literal) e que nada migrado sobrou fora dela.

const NOME = 'componentes F3d';
const rawLf = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regs = regioes(rawLf);
const regiao = regs.find((r) => r.nome === NOME);
const fora = foraDasRegioes(rawLf, regs);
const { claro: lightTokens, escuro: darkTokens } = tokensDosTemas(rawLf);
const THEMES = temasDeTokens(lightTokens, darkTokens);

// ---------- utilitarios de CSS ----------
// Separa a lista de seletores por virgula FORA de parenteses/colchetes.
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

const ehAninhavel = (prelude: string) => /^@(media|supports)\b/.test(prelude);

function regrasPlanas(rules: CssRule[]): CssRule[] {
  const out: CssRule[] = [];
  for (const r of rules) {
    if (ehAninhavel(r.prelude)) out.push(...regrasPlanas(parseRules(r.body)));
    else if (!r.prelude.startsWith('@')) out.push(r);
  }
  return out;
}

function declaracoes(rules: CssRule[], seletor: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rules) {
    if (!listaDeSeletores(r.prelude).includes(seletor)) continue;
    for (const [, prop, valor] of r.body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) {
      if (prop !== undefined && valor !== undefined) out[prop] = valor.replace(/\s+/g, ' ').trim();
    }
  }
  return out;
}

const topo = regiao?.regras ?? [];
const planas = regrasPlanas(topo);
const semMedia = topo.filter((r) => !r.prelude.startsWith('@'));
const naRegiao = (seletor: string) => declaracoes(semMedia, seletor);
const mediaDe = (nome: string) => parseRules(topo.find((r) => r.prelude === nome)?.body ?? '');
const coarse = mediaDe('@media (pointer: coarse)');
const reduzido = mediaDe('@media (prefers-reduced-motion: reduce)');
const keyframes = (nome: string) => parseRules(topo.find((r) => r.prelude === `@keyframes ${nome}`)?.body ?? '');
const compacto = (texto: string | undefined) => (texto ?? '').replace(/\s+/g, ' ').trim();

// ---------- listas da etapa ----------
// Classes que a regiao pode citar (inclui `ghost-button`, de contexto: `.pagination .ghost-button`).
const PERMITIDAS_F3D = new Set([
  'tabs-list',
  'tabs-trigger',
  'tabs-trigger--active',
  'tabs-panel',
  'pagination',
  'pagination__info',
  'pagination__num',
  'ghost-button',
  'star-rating',
  'star-rating__star',
  'star-rating__star--on',
  'star-rating__star--off',
  'star-rating__button',
  'star-rating__value',
  'card',
  'empty-state',
  'empty-state__icon',
  'empty-state__title',
  'empty-state__text',
  'empty-state--erro',
  'skeleton',
  'spinner',
  'spinner--sm',
  'spinner--fullscreen',
]);

// Classes cujas regras antigas MIGRARAM para a regiao (`ghost-button` e da F3a e fica de fora; `.tabs-root` nunca teve regra).
const MIGRADAS_F3D = new Set([...PERMITIDAS_F3D].filter((c) => c !== 'ghost-button'));

describe('F3d: regiao e tokens', () => {
  it('a regiao `componentes F3d` existe e tem regras', () => {
    expect(regiao).toBeDefined();
    expect(planas.length).toBeGreaterThan(30);
  });

  it('a fixture da etapa tem 3 pares (nenhuma constante) e todos estao no CSS, nos 2 temas', () => {
    const f3d = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f3d.json');
    expect(f3d.map((t) => t.token)).toEqual(['--rf-skeleton-base', '--rf-skeleton-shine', '--rf-empty-border']);
    expect(f3d.filter((t) => t.constante)).toEqual([]);
    for (const t of f3d) {
      expect(lightTokens[t.token], t.token).toBe(t.claro);
      expect(darkTokens[t.token], t.token).toBe(t.escuro);
    }
  });

  it('valores do mock: skeleton #e3ecea > #f7faf9 (D-F3-08), tracejado #b9cbc6 (D-F3-09); escuro do Portal e do token de hover do campo', () => {
    expect(lightTokens['--rf-skeleton-base']).toBe('#e3ecea');
    expect(lightTokens['--rf-skeleton-shine']).toBe('#f7faf9');
    expect(lightTokens['--rf-empty-border']).toBe('#b9cbc6');
    expect(darkTokens['--rf-skeleton-base']).toBe('#163845');
    expect(darkTokens['--rf-skeleton-shine']).toBe('#1d4250');
    expect(darkTokens['--rf-empty-border']).toBe('rgba(74, 222, 200, 0.28)');
    expect(darkTokens['--rf-empty-border']).toBe(darkTokens['--rf-control-hover-border']);
  });

  it('nenhum token existente foi tocado: os 3 da F3d sao NOVOS em relacao a base (84)', () => {
    const base = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.json').map((t) => t.token);
    for (const t of fixtureUniao().filter((x) => x.arquivo === 'suiteComexTokens.f3d.json')) expect(base).not.toContain(t.token);
  });
});

// ---------- contraste ----------
const TEXT = 4.5;
const UI = 3;
const rf = (n: string) => `--rf-${n}`;
type Par = readonly [fg: string, bg: string, min: number];
// Sem par novo de token (os 3 sao decorativos), mas as combinacoes que a F3d pinta sobre superficies sao medidas aqui nos 2 temas.
const PAIRS_F3D: ReadonlyArray<Par> = [
  [rf('ink-soft'), rf('surface'), TEXT], // aba inativa, info da paginacao, texto do vazio sobre cartao
  [rf('ink'), rf('surface'), TEXT], // aba ativa/hover, titulo do vazio, valor da estrela
  [rf('ink-soft'), rf('bg'), TEXT], // .empty-state direto sobre o fundo da pagina
  [rf('action'), rf('surface'), UI], // foco duplo e topo do spinner
  [rf('primary-700'), rf('surface'), UI], // icone do vazio
  [rf('danger'), rf('tone-danger-bg'), UI], // icone do erro dentro do circulo
  [rf('tone-warning-fg'), rf('surface'), UI], // contorno da estrela cheia
  [rf('input-border'), rf('surface'), UI], // estrela vazia (D-F3-07: --rf-input-border, nao os #9fb1b8 do mock)
];
// Excecoes de contraste NOVAS do mock, mantidas como no board e registradas aqui (PLAN D-F3-07 e D-F3-09). Faixa = valor medido +- 0,05.
const EXCECOES_DO_MOCK: ReadonlyArray<{ id: string; fg: string; bg: string; tema: ThemeName; esperado: number }> = [
  { id: 'barra da aba ativa (menta sobre branco)', fg: rf('primary'), bg: rf('surface'), tema: 'claro', esperado: 1.76 },
  { id: 'tracejado do vazio (#b9cbc6 sobre branco)', fg: rf('empty-border'), bg: rf('surface'), tema: 'claro', esperado: 1.69 },
];

describe('F3d: contraste nos 2 temas (alpha composto sobre --rf-surface)', () => {
  const opaque = (theme: ThemeName, name: string): Rgb => opaqueOf(THEMES[theme], name);
  const rows = (['claro', 'escuro'] as const).flatMap((theme) =>
    PAIRS_F3D.map(([fg, bg, min]) => {
      const ratio = ratioOf(opaque(theme, fg), opaque(theme, bg));
      return { id: `${theme}: ${fg} / ${bg}`, min, ratio: Number(ratio.toFixed(2)), ok: ratio >= min };
    }),
  );

  it('mede os pares (8 x 2 temas)', () => {
    console.table(rows.map((r) => ({ par: r.id, min: r.min, ratio: r.ratio, ok: r.ok })));
    expect(rows).toHaveLength(PAIRS_F3D.length * 2);
  });

  it('todos os pares passam', () => {
    expect(rows.filter((r) => !r.ok).map((r) => `${r.id}: ${r.ratio} < ${r.min}`)).toEqual([]);
  });

  it('excecoes do mock (decorativas; o estado tambem vem do texto e do aria-selected): barra da aba 1,76:1 e tracejado do vazio 1,69:1', () => {
    for (const e of EXCECOES_DO_MOCK) {
      const ratio = ratioOf(opaque(e.tema, e.fg), opaque(e.tema, e.bg));
      expect(ratio, e.id).toBeGreaterThan(e.esperado - 0.05);
      expect(ratio, e.id).toBeLessThan(e.esperado + 0.05);
      expect(ratio, `${e.id} segue abaixo de 3:1 (excecao registrada)`).toBeLessThan(UI);
    }
  });

  it('a estrela vazia NAO usa os #9fb1b8 do mock (2,22:1): usa --rf-input-border (D-F3-07)', () => {
    const mock = ratioOf([0x9f, 0xb1, 0xb8], opaque('claro', rf('surface')));
    expect(mock).toBeLessThan(UI);
    expect(naRegiao('.star-rating__star--off').stroke).toBe('var(--rf-input-border)');
    expect(regiao?.limpo).not.toMatch(/9fb1b8/i);
  });
});

// ---------- receitas ----------
describe('F3d: abas (Tabs)', () => {
  it('.tabs-list: flex, gap 4, linha inferior de 1 px --rf-border (sombra interna sobre 1 px de padding), margem 16 e rolagem horizontal', () => {
    expect(naRegiao('.tabs-list')).toEqual({
      display: 'flex',
      gap: '4px',
      'margin-bottom': '16px',
      'padding-bottom': '1px',
      'box-shadow': 'inset 0 -1px 0 var(--rf-border)',
      'overflow-x': 'auto',
    });
    // desvio registrado do PLAN (border-bottom): com overflow-x: auto a barra (bottom: -1px) sairia cortada; a linha e a barra ficam iguais ao board
    expect(naRegiao('.tabs-list')).not.toHaveProperty('border-bottom');
  });

  it('.tabs-trigger: 44 de altura minima, 0 16, sem fundo e sem borda, 700 14 --rf-ink-soft, cor em --rf-dur-base', () => {
    expect(naRegiao('.tabs-trigger')).toMatchObject({
      position: 'relative',
      'min-height': '44px',
      padding: '0 16px',
      border: '0',
      background: 'transparent',
      color: 'var(--rf-ink-soft)',
      'font-family': 'var(--rf-font-sans)',
      'font-size': '14px',
      'font-weight': '700',
      transition: 'color var(--rf-dur-base)',
    });
    expect(naRegiao('.tabs-trigger')).not.toHaveProperty('height');
  });

  it('hover e aba ativa em --rf-ink', () => {
    expect(naRegiao('.tabs-trigger:hover')).toEqual({ color: 'var(--rf-ink)' });
    expect(naRegiao('.tabs-trigger--active')).toEqual({ color: 'var(--rf-ink)' });
  });

  it('barra da aba ativa: 3 px, --rf-primary, raio 3, left/right 12, bottom -1, abre do centro com rf-tab-bar', () => {
    expect(naRegiao('.tabs-trigger--active::after')).toEqual({
      content: '""',
      position: 'absolute',
      left: '12px',
      right: '12px',
      bottom: '-1px',
      height: '3px',
      'border-radius': '3px',
      background: 'var(--rf-primary)',
      'transform-origin': 'center',
      animation: 'rf-tab-bar var(--rf-dur-base) var(--rf-ease-out) both',
    });
    const [de, para] = keyframes('rf-tab-bar');
    expect(de?.prelude).toBe('from');
    expect(compacto(de?.body)).toBe('transform: scaleX(0);');
    expect(para?.prelude).toBe('to');
    expect(compacto(para?.body)).toBe('transform: scaleX(1);');
  });

  it('foco duplo INTERNO (superficie fora, acao dentro; o anel externo do mock seria cortado pelo overflow-x da lista) com outline transparente; painel sem outline', () => {
    expect(naRegiao('.tabs-trigger:focus-visible')).toEqual({
      outline: '2px solid transparent',
      'outline-offset': '-4px',
      'box-shadow': 'inset 0 0 0 2px var(--rf-surface), inset 0 0 0 4px var(--rf-action)',
    });
    expect(naRegiao('.tabs-panel')).toEqual({ outline: 'none' });
  });

  it('reduced-motion: a barra da aba nao anima', () => {
    expect(declaracoes(reduzido, '.tabs-trigger--active::after')).toEqual({ animation: 'none' });
  });

  it('o foco antigo (.tabs-trigger:focus-visible) saiu de fora da regiao; as sobrescritas do Forecast ficam', () => {
    const foraLimpo = fora.replace(/\/\*[\s\S]*?\*\//g, '');
    const seletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));
    expect(seletores).not.toContain('.tabs-trigger:focus-visible');
    expect(seletores).toContain('.fci-modal .tabs-trigger:focus-visible');
    expect(seletores).toContain('.fco-abas .tabs-trigger:focus-visible');
  });
});

describe('F3d: paginacao', () => {
  it('.pagination: flex, space-between, wrap, gap 12, padding 12 20 (board Cotacoes), sem borda nem margem', () => {
    expect(naRegiao('.pagination')).toEqual({
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      'flex-wrap': 'wrap',
      gap: '12px',
      padding: '12px 20px',
    });
  });

  it('info 13 --rf-ink-soft sem quebra; numeros em mono com tabular-nums', () => {
    expect(naRegiao('.pagination__info')).toEqual({ 'font-size': '13px', color: 'var(--rf-ink-soft)', 'white-space': 'nowrap' });
    expect(naRegiao('.pagination__num')).toEqual({ 'font-family': 'var(--rf-font-mono)', 'font-variant-numeric': 'tabular-nums' });
  });

  it('botoes = secundario pequeno: 36, 0 12, raio 10, 13 px; sem opacity (desabilitado vem da F3a: borda --rf-border, texto --rf-disabled-fg)', () => {
    expect(naRegiao('.pagination .ghost-button')).toEqual({
      'min-height': '36px',
      padding: '0 12px',
      'border-radius': 'var(--rf-radius-control)',
      'font-size': '13px',
    });
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])opacity\s*:/);
  });

  it('pointer: coarse leva os botoes a 44', () => {
    expect(declaracoes(coarse, '.pagination .ghost-button')).toEqual({ 'min-height': '44px' });
  });

  it('o .pagination button:disabled { opacity } antigo saiu', () => {
    const foraLimpo = fora.replace(/\/\*[\s\S]*?\*\//g, '');
    const seletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));
    expect(seletores.filter((s) => s.includes('.pagination'))).toEqual([]);
  });
});

describe('F3d: estrelas', () => {
  it('leitura: 16 px, gap 2, traco 1,4; cheia = --rf-tone-warning-solid com contorno --rf-tone-warning-fg', () => {
    expect(naRegiao('.star-rating')).toEqual({ display: 'inline-flex', 'align-items': 'center', gap: '2px' });
    expect(naRegiao('.star-rating__star')).toMatchObject({ width: '16px', height: '16px', 'stroke-width': '1.4', 'stroke-linejoin': 'round' });
    expect(naRegiao('.star-rating__star--on')).toEqual({ fill: 'var(--rf-tone-warning-solid)', stroke: 'var(--rf-tone-warning-fg)' });
  });

  it('vazia: sem fundo e contorno --rf-input-border (D-F3-07)', () => {
    expect(naRegiao('.star-rating__star--off')).toEqual({ fill: 'none', stroke: 'var(--rf-input-border)' });
  });

  it('edicao: botao 28x28 (44 com pointer: coarse), estrela de 20, gap 4, foco duplo de 2/4 e hover 1,12 do mock', () => {
    expect(naRegiao('.star-rating[role="radiogroup"]')).toEqual({ gap: '4px' });
    expect(naRegiao('.star-rating__button')).toMatchObject({ width: '28px', height: '28px', padding: '0', border: '0', background: 'transparent' });
    expect(naRegiao('.star-rating__button .star-rating__star')).toEqual({ width: '20px', height: '20px' });
    expect(naRegiao('.star-rating__button .star-rating__star--off')).toEqual({ 'stroke-width': '1.6' });
    expect(naRegiao('.star-rating__button:focus-visible')).toMatchObject({
      outline: '2px solid transparent',
      'box-shadow': '0 0 0 2px var(--rf-surface), 0 0 0 4px var(--rf-action)',
    });
    expect(naRegiao('.star-rating__button:hover')).toEqual({ transform: 'scale(1.12)' });
    expect(declaracoes(coarse, '.star-rating__button')).toEqual({ width: '44px', height: '44px' });
  });

  it('valor: mono 12/600 tabular-nums em --rf-ink (como os 3 boards: Componentes, Fornecedores e Relatorios)', () => {
    expect(naRegiao('.star-rating__value')).toEqual({
      'margin-left': '4px',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '12px',
      'font-weight': '600',
      'font-variant-numeric': 'tabular-nums',
      color: 'var(--rf-ink)',
    });
  });

  it('reduced-motion: as estrelas de edicao nao crescem no hover', () => {
    expect(declaracoes(reduzido, '.star-rating__button')).toEqual({ transition: 'none' });
    expect(declaracoes(reduzido, '.star-rating__button:hover')).toEqual({ transform: 'none' });
  });
});

describe('F3d: cartao, vazio e erro', () => {
  it('.card: --rf-surface, borda 1 --rf-border, raio --rf-radius-panel (22), padding 22 24, SEM sombra (D-F3-10)', () => {
    expect(naRegiao('.card')).toEqual({
      padding: '22px 24px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-panel)',
      background: 'var(--rf-surface)',
    });
    expect(Object.keys(naRegiao('.card'))).not.toContain('box-shadow');
    expect(regiao?.limpo).not.toContain('.card:hover');
  });

  it('.empty-state: tracejado --rf-empty-border, raio 16, padding 28, centro, sem fundo, 14 --rf-ink-soft', () => {
    const d = naRegiao('.empty-state');
    expect(d).toEqual({
      padding: '28px',
      border: '1px dashed var(--rf-empty-border)',
      'border-radius': 'var(--rf-radius-card)',
      'text-align': 'center',
      'font-size': '14px',
      color: 'var(--rf-ink-soft)',
    });
    expect(Object.keys(d)).not.toContain('background');
  });

  it('opt-ins: icone 36 em --rf-primary-700, titulo 15/700 --rf-ink, texto 13 --rf-ink-soft', () => {
    expect(naRegiao('.empty-state__icon')).toMatchObject({ color: 'var(--rf-primary-700)', margin: '0 auto 8px' });
    expect(naRegiao('.empty-state__icon svg')).toMatchObject({ width: '36px', height: '36px', stroke: 'currentColor', 'stroke-width': '1.5' });
    expect(naRegiao('.empty-state__title')).toMatchObject({ 'font-size': '15px', 'font-weight': '700', color: 'var(--rf-ink)' });
    expect(naRegiao('.empty-state__text')).toMatchObject({ 'font-size': '13px', 'line-height': '1.5', color: 'var(--rf-ink-soft)' });
  });

  it('erro (.empty-state--erro): icone --rf-danger no circulo de 48 --rf-tone-danger-bg (board CotacoesEstados)', () => {
    expect(naRegiao('.empty-state--erro .empty-state__icon')).toEqual({
      width: '48px',
      height: '48px',
      'border-radius': 'var(--rf-radius-pill)',
      background: 'var(--rf-tone-danger-bg)',
      color: 'var(--rf-danger)',
    });
    expect(naRegiao('.empty-state--erro .empty-state__icon svg')).toEqual({ width: '24px', height: '24px', 'stroke-width': '1.7' });
  });
});

describe('F3d: skeleton e spinner', () => {
  it('.skeleton: gradiente base > brilho > base em 200%, raio 6, rf-shimmer de 1,4 s linear infinito', () => {
    expect(naRegiao('.skeleton')).toEqual({
      display: 'block',
      'border-radius': '6px',
      background: 'linear-gradient(90deg, var(--rf-skeleton-base) 0%, var(--rf-skeleton-shine) 50%, var(--rf-skeleton-base) 100%)',
      'background-size': '200% 100%',
      animation: 'rf-shimmer 1.4s linear infinite',
    });
    const [de, para] = keyframes('rf-shimmer');
    expect(compacto(de?.body)).toBe('background-position: 100% 0;');
    expect(compacto(para?.body)).toBe('background-position: -100% 0;');
  });

  it('reduced-motion: o skeleton fica parado (animation: none)', () => {
    expect(declaracoes(reduzido, '.skeleton')).toEqual({ animation: 'none' });
  });

  it('spinner: geometria de antes (36/3, sm 18/2, fullscreen fixo) com trilho --rf-border, topo --rf-action e fundo --rf-bg', () => {
    expect(naRegiao('.spinner')).toEqual({
      width: '36px',
      height: '36px',
      border: '3px solid var(--rf-border)',
      'border-top-color': 'var(--rf-action)',
      'border-radius': '50%',
      animation: 'spin 0.8s linear infinite',
    });
    expect(naRegiao('.spinner--sm')).toEqual({ width: '18px', height: '18px', 'border-width': '2px' });
    expect(naRegiao('.spinner--fullscreen')).toEqual({
      position: 'fixed',
      inset: '0',
      display: 'grid',
      'place-items': 'center',
      background: 'var(--rf-bg)',
      'z-index': '9999',
    });
  });

  it('o spinner segue girando no modo reduzido (indicador essencial), mais devagar; o @keyframes spin continua fora da regiao', () => {
    expect(declaracoes(reduzido, '.spinner')).toEqual({ 'animation-duration': '2.4s' });
    expect(fora).toContain('@keyframes spin');
    expect(regiao?.limpo).not.toContain('@keyframes spin');
  });
});

// ---------- invariantes da regiao ----------
describe('F3d: invariantes da regiao `componentes F3d`', () => {
  const seletores = planas.flatMap((r) => listaDeSeletores(r.prelude));

  it('toda classe citada num seletor da regiao pertence a PERMITIDAS_F3D', () => {
    const fora_ = [...new Set(seletores.flatMap(classesDoSeletor))].filter((c) => !PERMITIDAS_F3D.has(c));
    expect(fora_).toEqual([]);
  });

  it('at-rules permitidos: pointer: coarse, reduced-motion e os 2 @keyframes rf-* da etapa; sem @media print', () => {
    const atRules = topo.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    expect([...atRules].sort()).toEqual(['@keyframes rf-shimmer', '@keyframes rf-tab-bar', '@media (pointer: coarse)', '@media (prefers-reduced-motion: reduce)']);
    expect(regiao?.limpo).not.toContain('@media print');
    for (const m of topo.filter((r) => r.prelude.startsWith('@media'))) {
      for (const inner of parseRules(m.body)) expect(inner.prelude.startsWith('@'), inner.prelude).toBe(false);
    }
  });

  it('sem cor literal e sem opacity: so var(--...) e keywords (transparent, currentColor)', () => {
    expect(regiao?.limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])opacity\s*:/);
  });

  it('a regiao nao declara token (--*) e consome var(--rf-', () => {
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    expect(regiao?.limpo).toContain('var(--rf-');
  });

  it('reduced-motion: toda animation, toda transition com transform e todo hover com transform tem contrapartida', () => {
    const doReduzido = new Set(reduzido.flatMap((r) => listaDeSeletores(r.prelude)));
    // animation (fora dos @keyframes): cada seletor aparece no bloco reduzido com animation: none ou animation-duration
    const comAnimacao = semMedia.filter((r) => /(^|[;{\s])animation\s*:/.test(r.body));
    expect(comAnimacao.map((r) => r.prelude).sort()).toEqual(['.skeleton', '.spinner', '.tabs-trigger--active::after']);
    for (const r of comAnimacao) {
      for (const s of listaDeSeletores(r.prelude)) {
        const d = declaracoes(reduzido, s);
        expect(d.animation === 'none' || d['animation-duration'] !== undefined, `animation sem contrapartida: ${s}`).toBe(true);
      }
    }
    // transition com transform: o bloco reduzido a zera
    const comTransicaoDeTransform = semMedia.filter((r) => /transition\s*:[^;]*\btransform\b/.test(r.body));
    expect(comTransicaoDeTransform.map((r) => r.prelude)).toEqual(['.star-rating__button']);
    for (const r of comTransicaoDeTransform) {
      for (const s of listaDeSeletores(r.prelude)) expect(declaracoes(reduzido, s).transition, s).toBe('none');
    }
    // :hover/:active com transform
    const comTransformInterativo = semMedia.filter((r) => /:(hover|active)/.test(r.prelude) && /(^|[;{\s])transform\s*:/.test(r.body));
    expect(comTransformInterativo.map((r) => r.prelude)).toEqual(['.star-rating__button:hover']);
    for (const r of comTransformInterativo) {
      for (const s of listaDeSeletores(r.prelude)) {
        expect(doReduzido.has(s), s).toBe(true);
        expect(declaracoes(reduzido, s).transform, s).toBe('none');
      }
    }
  });
});

// ---------- fora das regioes ----------
// Regra "fora": nenhum seletor (cada item da lista sozinho) fora das regioes cujo ULTIMO composto tenha classe de MIGRADAS_F3D e
// cujas demais classes tambem sejam todas de MIGRADAS_F3D. `.fci-modal .tabs-trigger:focus-visible` e `.fco-abas .tabs-trigger` passam.
describe('F3d: nada dos componentes migrados sobrou fora das regioes', () => {
  const foraLimpo = fora.replace(/\/\*[\s\S]*?\*\//g, '');
  const foraSeletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));

  it('MIGRADAS_F3D: 0 seletores antigos fora das regioes', () => {
    const violacoes = foraSeletores.filter((s) => {
      const ultimas = classesDoSeletor(ultimoComposto(s));
      if (!ultimas.some((c) => MIGRADAS_F3D.has(c))) return false;
      return classesDoSeletor(s).every((c) => MIGRADAS_F3D.has(c));
    });
    expect(violacoes).toEqual([]);
  });

  it('as sobrescritas do Forecast (com classe propria) continuam fora da regiao', () => {
    expect(foraSeletores).toContain('.fci-modal .tabs-panel:focus-visible');
    expect(foraSeletores).toContain('.fcc-modal .tabs-trigger:focus-visible');
    expect(foraSeletores).toContain('.fco-abas .tabs-trigger:focus-visible');
  });
});

// ---------- primitivos TSX ----------
describe('F3d: Tabs, Pagination e StarRating sem estilo inline, cor literal ou glifo de estrela', () => {
  it.each(['Tabs.tsx', 'Pagination.tsx', 'StarRating.tsx'])('%s', (arquivo) => {
    const texto = readSource(`../components/${arquivo}`);
    expect(texto).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--rf-|style=\{\{|★|☆|&times;/);
  });
});
