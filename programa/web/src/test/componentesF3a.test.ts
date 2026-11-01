/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  classesDoSeletor,
  fixtureUniao,
  foraDasRegioes,
  parseRules,
  ratioOf,
  readSource,
  regioes,
  opaque as opaqueOf,
  temasDeTokens,
  tokensDosTemas,
  ultimoComposto,
  type CssRule,
  type Rgb,
  type ThemeName,
} from './rfCss';

// F3a (Suite COMEX, mock v68, boards Componentes "Botoes", "Campos" e "Selecao"): botoes e campos. So CSS, dentro da regiao
// `componentes F3a` do globals.css. Esta guarda cobre: os 9 tokens da etapa, o contraste dos pares novos nos 2 temas, as receitas
// (PLAN 2.3 e F3a passo 4), os invariantes da regiao (classes permitidas, at-rules, reduced-motion, sem cor literal) e que
// nenhum seletor antigo dos componentes migrados sobrou fora das regioes. Apoio: ./rfCss.ts.

const NOME = 'componentes F3a';
const rawLf = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regs = regioes(rawLf);
const regiao = regs.find((r) => r.nome === NOME);
const fora = foraDasRegioes(rawLf, regs);
const { claro: lightTokens, escuro: darkTokens } = tokensDosTemas(rawLf);
const THEMES = temasDeTokens(lightTokens, darkTokens);

// ---------- utilitarios de CSS ----------
// Separa a lista de seletores por virgula FORA de parenteses/colchetes (`:is(table, .row-actions) .ghost-button` e um item so).
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

// Todas as regras "planas" (seletor + corpo), entrando em @media/@supports. Ignora @keyframes e demais at-rules.
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

// ---------- listas da etapa ----------
// Classes que a regiao pode citar (inclui contexto: .modal-actions, .row-actions).
const PERMITIDAS_F3A = new Set([
  'primary-button',
  'ghost-button',
  'ghost-button--sm',
  'danger-button',
  'link-button',
  'icon-button',
  'icon-button--danger',
  'btn-spinner',
  'input',
  'select',
  'textarea',
  'textarea--code',
  'field-label',
  'field-hint',
  'field-error',
  'field',
  'field--inline',
  'file-input',
  'checkbox-field',
  'modal-actions',
  'row-actions',
]);

// Classes cujas regras antigas MIGRARAM para a regiao. `.link-button` e `.row-actions` ficam de fora de proposito: o `.link-button`
// e o `.row-actions .ghost-button` antigos foram apagados pela F3c (PLAN 10.5; o componentesF3c.test verifica).
const MIGRADAS_F3A = new Set([
  'primary-button',
  'ghost-button',
  'ghost-button--sm',
  'danger-button',
  'icon-button',
  'icon-button--danger',
  'btn-spinner',
  'input',
  'select',
  'textarea',
  'textarea--code',
  'field-label',
  'field-hint',
  'field-error',
  'field',
  'field--inline',
  'file-input',
  'checkbox-field',
]);

describe('F3a: regiao e tokens', () => {
  it('a regiao `componentes F3a` existe e tem regras', () => {
    expect(regiao).toBeDefined();
    expect(planas.length).toBeGreaterThan(40);
  });

  it('a fixture da etapa tem 9 tokens (8 pares + 1 constante) e todos estao no CSS', () => {
    const f3a = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f3a.json');
    expect(f3a).toHaveLength(9);
    expect(f3a.filter((t) => !t.constante)).toHaveLength(8);
    expect(f3a.filter((t) => t.constante).map((t) => t.token)).toEqual(['--rf-shadow-primary-hover']);
    for (const t of f3a) expect(lightTokens[t.token], t.token).toBe(t.claro);
    expect(f3a.filter((t) => !t.constante && darkTokens[t.token] !== t.escuro)).toEqual([]);
  });

  it('o chevron do select e um data URI sem `;`, sem `#` cru e sem chaves (parsers dos testes e do harness)', () => {
    for (const valor of [lightTokens['--rf-select-chevron'], darkTokens['--rf-select-chevron']]) {
      expect(valor).toMatch(/^url\("data:image\/svg\+xml,%3Csvg /);
      expect(valor).not.toMatch(/[;#{}]/);
    }
    expect(lightTokens['--rf-select-chevron']).toContain("stroke='%234a6472'");
    expect(darkTokens['--rf-select-chevron']).toContain("stroke='%239fb6bf'");
  });

  it('nenhum token existente foi tocado: os tokens da F3a sao todos NOVOS em relacao a base (84)', () => {
    const base = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.json').map((t) => t.token);
    for (const t of fixtureUniao().filter((x) => x.arquivo === 'suiteComexTokens.f3a.json')) expect(base).not.toContain(t.token);
  });
});

// ---------- contraste dos pares novos (2 temas) ----------
const TEXT = 4.5;
const UI = 3;
const rf = (n: string) => `--rf-${n}`;
type Par = readonly [fg: string, bg: string, min: number];
const PAIRS_F3A: ReadonlyArray<Par> = [
  [rf('on-primary'), rf('primary-pressed'), TEXT],
  [rf('action'), rf('action-hover-bg'), TEXT],
  [rf('action-pressed'), rf('action-pressed-bg'), TEXT],
  [rf('action'), rf('bg'), TEXT],
  [rf('action-pressed'), rf('disabled-bg'), TEXT],
  [rf('on-danger'), rf('danger'), TEXT],
  [rf('on-danger'), rf('danger-hover'), TEXT],
  [rf('on-danger'), rf('danger-pressed'), TEXT],
  [rf('tone-danger-fg'), rf('surface'), TEXT],
  [rf('danger'), rf('surface'), UI],
  [rf('ink-soft'), rf('input-bg'), UI],
  [rf('action'), rf('input-bg'), UI],
];

describe('F3a: contraste dos pares novos nos 2 temas (alpha composto sobre --rf-surface)', () => {
  const opaque = (theme: ThemeName, name: string): Rgb => opaqueOf(THEMES[theme], name);
  const rows = (['claro', 'escuro'] as const).flatMap((theme) =>
    PAIRS_F3A.map(([fg, bg, min]) => {
      const ratio = ratioOf(opaque(theme, fg), opaque(theme, bg));
      return { id: `${theme}: ${fg} / ${bg}`, min, ratio: Number(ratio.toFixed(2)), ok: ratio >= min };
    }),
  );

  it('mede os pares (12 x 2 temas)', () => {
    console.table(rows.map((r) => ({ par: r.id, min: r.min, ratio: r.ratio, ok: r.ok })));
    expect(rows).toHaveLength(PAIRS_F3A.length * 2);
  });

  it('todos os pares passam: a F3a nao acrescenta excecao de contraste (as 3 do mock seguem so em suiteComexTokens)', () => {
    expect(rows.filter((r) => !r.ok).map((r) => `${r.id}: ${r.ratio} < ${r.min}`)).toEqual([]);
  });
});

// ---------- receitas ----------
describe('F3a: botoes (PLAN 2.3)', () => {
  it('medidas comuns: 44 de altura minima, raio 12, 700 14px na fonte sans, sem `height` fixo', () => {
    const d = naRegiao('.primary-button');
    expect(d['min-height']).toBe('44px');
    expect(d['padding']).toBe('0 16px');
    expect(d['border-radius']).toBe('var(--rf-radius-button)');
    expect(d['font-family']).toBe('var(--rf-font-sans)');
    expect(d['font-size']).toBe('14px');
    expect(d['font-weight']).toBe('700');
    for (const r of planas.filter((x) => listaDeSeletores(x.prelude).some((s) => /\.(primary|ghost|danger)-button\b/.test(s)))) {
      expect(r.body, r.prelude).not.toMatch(/(^|[;\s{])height\s*:/);
    }
  });

  it('primario: menta, hover com sombra, pressionado, desabilitado sem opacity', () => {
    expect(naRegiao('.primary-button')).toMatchObject({ border: '0', background: 'var(--rf-primary)', color: 'var(--rf-on-primary)' });
    expect(naRegiao('.primary-button:hover:not(:disabled)')).toMatchObject({
      background: 'var(--rf-primary-hover)',
      'box-shadow': 'var(--rf-shadow-primary-hover)',
    });
    expect(naRegiao('.primary-button:active:not(:disabled)')).toMatchObject({ background: 'var(--rf-primary-pressed)', transform: 'scale(0.97)' });
    expect(naRegiao('.primary-button:disabled')).toMatchObject({ background: 'var(--rf-disabled-bg)', color: 'var(--rf-disabled-fg)' });
  });

  it('secundario (.ghost-button): borda 1,5 --rf-action, fundo --rf-surface, hover/pressionado/desabilitado', () => {
    expect(naRegiao('.ghost-button')).toMatchObject({
      padding: '0 16px',
      border: '1.5px solid var(--rf-ghost-escuro-borda)',
      background: 'var(--rf-surface)',
      color: 'var(--rf-ghost-escuro-texto)',
    });
    expect(naRegiao('.ghost-button:hover:not(:disabled)').background).toBe('var(--rf-action-hover-bg)');
    expect(naRegiao('.ghost-button:active:not(:disabled)')).toMatchObject({
      'border-color': 'var(--rf-action-pressed)',
      background: 'var(--rf-action-pressed-bg)',
      color: 'var(--rf-action-pressed)',
      transform: 'scale(0.97)',
    });
    expect(naRegiao('.ghost-button:disabled')).toMatchObject({
      'border-color': 'var(--rf-border)',
      background: 'var(--rf-surface)',
      color: 'var(--rf-disabled-fg)',
    });
  });

  it('fantasma (so em .modal-actions): sem borda, transparente, hover --rf-bg, pressionado --rf-disabled-bg', () => {
    expect(naRegiao('.modal-actions .ghost-button')).toMatchObject({ border: '0', background: 'transparent', color: 'var(--rf-action)' });
    expect(naRegiao('.modal-actions .ghost-button:hover:not(:disabled)').background).toBe('var(--rf-bg)');
    expect(naRegiao('.modal-actions .ghost-button:active:not(:disabled)')).toMatchObject({
      background: 'var(--rf-disabled-bg)',
      color: 'var(--rf-action-pressed)',
      transform: 'scale(0.97)',
    });
  });

  it('acao de linha (table, .row-actions, --sm): 36, raio 10, 0 12px, 700 13px, fantasma, hover --rf-bg', () => {
    const seletor = ':is(table, .row-actions) .ghost-button';
    expect(naRegiao(seletor)).toMatchObject({
      'min-height': '36px',
      padding: '0 12px',
      border: '0',
      'border-radius': 'var(--rf-radius-control)',
      background: 'transparent',
      color: 'var(--rf-action)',
      'font-size': '13px',
    });
    expect(naRegiao('.ghost-button--sm')['min-height']).toBe('36px');
    expect(naRegiao(`${seletor}:hover:not(:disabled)`).background).toBe('var(--rf-bg)');
    expect(naRegiao(`${seletor}:active:not(:disabled)`)).toMatchObject({ background: 'var(--rf-disabled-bg)', transform: 'scale(0.97)' });
  });

  it('fantasma destrutivo (.ghost-button.danger-button): texto vermelho, sem borda, hover --rf-tone-danger-bg', () => {
    expect(naRegiao('.ghost-button.danger-button')).toMatchObject({ border: '0', background: 'transparent', color: 'var(--rf-tone-danger-fg)' });
    expect(naRegiao('.ghost-button.danger-button:hover:not(:disabled)').background).toBe('var(--rf-tone-danger-bg)');
  });

  it('destrutivo (cheio): --rf-danger / --rf-on-danger, 0 18px, hover e pressionado proprios', () => {
    expect(naRegiao('.danger-button')).toMatchObject({ padding: '0 18px', border: '0', background: 'var(--rf-danger)', color: 'var(--rf-on-danger)' });
    expect(naRegiao('.danger-button:hover:not(:disabled)').background).toBe('var(--rf-danger-hover)');
    expect(naRegiao('.danger-button:active:not(:disabled)')).toMatchObject({ background: 'var(--rf-danger-pressed)', transform: 'scale(0.97)' });
    expect(naRegiao('.danger-button:disabled')).toMatchObject({ background: 'var(--rf-disabled-bg)', color: 'var(--rf-disabled-fg)' });
  });

  it('foco: anel duplo (superficie + acao) com outline transparente; no destrutivo o anel externo e --rf-danger', () => {
    const geral = naRegiao(
      '.primary-button:focus-visible:not(:disabled)',
    );
    expect(geral).toMatchObject({
      outline: '2px solid transparent',
      'outline-offset': '2px',
      'box-shadow': '0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-action)',
    });
    expect(naRegiao('.danger-button:focus-visible:not(:disabled)')['box-shadow']).toBe('0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-danger)');
  });

  it('carregando (aria-busy + disabled) mantem a cor de repouso e o cursor de progresso', () => {
    expect(naRegiao('.primary-button[aria-busy="true"]:disabled')).toMatchObject({ background: 'var(--rf-primary)', cursor: 'progress' });
    expect(naRegiao('.danger-button[aria-busy="true"]:disabled')).toMatchObject({ background: 'var(--rf-danger)', cursor: 'progress' });
  });

  it('desabilitado nunca usa opacity (so --rf-disabled-bg/--rf-disabled-fg)', () => {
    for (const r of planas) {
      if (listaDeSeletores(r.prelude).some((s) => s.includes(':disabled'))) expect(r.body, r.prelude).not.toContain('opacity');
    }
  });

  it('.link-button: 700 13px --rf-action, 8px 6px, sem caixa', () => {
    expect(naRegiao('.link-button')).toMatchObject({
      padding: '8px 6px',
      border: '0',
      background: 'transparent',
      color: 'var(--rf-action)',
      'font-size': '13px',
      'font-weight': '700',
    });
  });

  it('.icon-button: 36x36, raio 10, fundo --rf-surface-alt; --danger em --rf-tone-danger-fg', () => {
    expect(naRegiao('.icon-button')).toMatchObject({
      width: '36px',
      height: '36px',
      'border-radius': 'var(--rf-radius-control)',
      background: 'var(--rf-surface-alt)',
    });
    expect(naRegiao('.icon-button--danger').color).toBe('var(--rf-tone-danger-fg)');
  });

  it('.btn-spinner: 14px, borda 2px a 25% da cor do texto com topo currentColor, usa o @keyframes spin existente', () => {
    expect(naRegiao('.btn-spinner')).toMatchObject({
      width: '14px',
      height: '14px',
      border: '2px solid color-mix(in srgb, currentColor 25%, transparent)',
      'border-top-color': 'currentColor',
      animation: 'spin 0.8s linear infinite',
    });
    expect(fora).toMatch(/@keyframes spin\s*\{/);
    expect(regiao?.limpo).not.toContain('@keyframes');
  });

  it('pointer: coarse leva as acoes de 36 para 44 (linha, --sm, .link-button, .icon-button)', () => {
    const d = declaracoes(coarse, ':is(table, .row-actions) .ghost-button');
    expect(d['min-height']).toBe('44px');
    expect(declaracoes(coarse, '.ghost-button--sm')['min-height']).toBe('44px');
    expect(declaracoes(coarse, '.link-button')['min-height']).toBe('44px');
    expect(declaracoes(coarse, '.icon-button')).toMatchObject({ width: '44px', height: '44px' });
  });
});

describe('F3a: campos e selecao', () => {
  it('.input/.select/.textarea: 44, padding 0 14px, borda 1,5 --rf-input-border (D3), raio controle, 500 14px', () => {
    const d = naRegiao('.input');
    expect(d).toMatchObject({
      width: '100%',
      padding: '0 14px',
      border: '1.5px solid var(--rf-input-border)',
      'border-radius': 'var(--rf-radius-control)',
      'background-color': 'var(--rf-input-bg)',
      color: 'var(--rf-ink)',
      'font-family': 'var(--rf-font-sans)',
      'font-size': '14px',
      'font-weight': '500',
    });
    expect(naRegiao('.input')['min-height']).toBe('44px');
    expect(naRegiao('.select')['min-height']).toBe('44px');
    expect(naRegiao('.field--inline select')['min-height']).toBe('44px');
    expect(naRegiao('.textarea')).toMatchObject({ padding: '10px 14px', resize: 'vertical' });
    expect(naRegiao('.textarea')['min-height']).toBeUndefined();
  });

  it('textarea.input (6 usos no app) recebe a receita do textarea: padding 10px 14px, resize vertical, sem altura minima de 44', () => {
    expect(naRegiao('textarea.input')).toMatchObject({ padding: '10px 14px', resize: 'vertical', 'min-height': '0' });
    expect(naRegiao('textarea.input')['border-radius']).toBeUndefined();
  });

  it('select.input (2 usos no app) recebe a receita do select: chevron do token, 600, sem aparencia nativa, padding-right 36px', () => {
    expect(naRegiao('select.input')).toMatchObject({
      appearance: 'none',
      'padding-right': '36px',
      'background-image': 'var(--rf-select-chevron)',
      'background-position': 'right 12px center',
      'background-size': '16px 16px',
      'font-weight': '600',
    });
  });

  it('hover: borda --rf-ink-soft; foco: borda --rf-action + halo 4px; invalido: --rf-danger; desabilitado: --rf-disabled-*', () => {
    expect(naRegiao('.input:hover')['border-color']).toBe('var(--rf-ink-soft)');
    expect(naRegiao('.input:focus')).toMatchObject({ 'border-color': 'var(--rf-action)', 'box-shadow': '0 0 0 4px var(--rf-focus-halo)' });
    expect(naRegiao('.input[aria-invalid="true"]')['border-color']).toBe('var(--rf-danger)');
    expect(naRegiao('.input:disabled')).toMatchObject({ 'background-color': 'var(--rf-disabled-bg)', color: 'var(--rf-disabled-fg)' });
  });

  it('.select: sem aparencia nativa, chevron do token a 12px da direita, padding-right 36px', () => {
    const d = naRegiao('.select');
    expect(d).toMatchObject({
      appearance: 'none',
      'padding-right': '36px',
      'background-image': 'var(--rf-select-chevron)',
      'background-position': 'right 12px center',
    });
  });

  it('.field-label: 13/600 --rf-ink, sem caixa alta e sem letter-spacing; .field > span igual', () => {
    for (const s of ['.field-label', '.field > span']) {
      const d = naRegiao(s);
      expect(d['font-size'], s).toBe('13px');
      expect(d['font-weight'], s).toBe('600');
      expect(d['color'], s).toBe('var(--rf-ink)');
      expect(d['text-transform'], s).toBeUndefined();
      expect(d['letter-spacing'], s).toBeUndefined();
    }
  });

  it('.field-hint: 12 --rf-ink-soft; .field-error: 12/600 --rf-tone-danger-fg', () => {
    expect(naRegiao('.field-hint')).toMatchObject({ 'font-size': '12px', color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.field-error')).toMatchObject({ 'font-size': '12px', 'font-weight': '600', color: 'var(--rf-tone-danger-fg)' });
  });

  it('.checkbox-field: 13/600; input 18x18 com accent-color --rf-action; rotulo desabilitado em --rf-disabled-fg', () => {
    expect(naRegiao('.checkbox-field')).toMatchObject({ 'font-size': '13px', 'font-weight': '600', color: 'var(--rf-ink)' });
    expect(naRegiao('.checkbox-field input')).toMatchObject({ width: '18px', height: '18px', 'accent-color': 'var(--rf-action)' });
    expect(naRegiao('.checkbox-field:has(input:disabled)').color).toBe('var(--rf-disabled-fg)');
  });

  it('.file-input: borda 1,5 tracejada --rf-input-border, raio 10; botao do seletor = secundario pequeno (36)', () => {
    expect(naRegiao('.file-input')).toMatchObject({
      border: '1.5px dashed var(--rf-input-border)',
      'border-radius': 'var(--rf-radius-control)',
    });
    expect(naRegiao('.file-input::file-selector-button')).toMatchObject({
      'min-height': '36px',
      padding: '0 12px',
      border: '1.5px solid var(--rf-ghost-escuro-borda)',
      'border-radius': 'var(--rf-radius-control)',
      'font-size': '13px',
      'font-weight': '700',
    });
  });

  it('as 3 classes novas (.field-hint, .field-error, .btn-spinner) existem so na regiao', () => {
    for (const c of ['.field-hint', '.field-error', '.btn-spinner']) {
      expect(Object.keys(naRegiao(c)).length, c).toBeGreaterThan(0);
      expect(fora, c).not.toMatch(new RegExp(`${c.replace('.', '\\.')}(?![\\w-])`));
    }
  });
});

// ---------- invariantes da regiao ----------
describe('F3a: invariantes da regiao `componentes F3a`', () => {
  const seletores = planas.flatMap((r) => listaDeSeletores(r.prelude));

  it('toda classe citada num seletor da regiao pertence a PERMITIDAS_F3A', () => {
    const fora_ = [...new Set(seletores.flatMap(classesDoSeletor))].filter((c) => !PERMITIDAS_F3A.has(c));
    expect(fora_).toEqual([]);
  });

  it('at-rules permitidos: so @media (pointer: coarse) e @media (prefers-reduced-motion: reduce); sem @keyframes nem @media print', () => {
    const atRules = topo.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    expect([...atRules].sort()).toEqual(['@media (pointer: coarse)', '@media (prefers-reduced-motion: reduce)']);
    expect(regiao?.limpo).not.toContain('@media print');
    for (const m of topo.filter((r) => r.prelude.startsWith('@media'))) {
      for (const inner of parseRules(m.body)) expect(inner.prelude.startsWith('@'), inner.prelude).toBe(false);
    }
  });

  it('sem cor literal: so var(--...) e keywords (transparent, currentColor)', () => {
    expect(regiao?.limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it('a regiao nao declara token (--rf-*) e consome var(--rf-', () => {
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    expect(regiao?.limpo).toContain('var(--rf-');
  });

  it('reduced-motion: todo :active com transform, toda transition com transform e toda animation tem contrapartida', () => {
    const doReduzido = new Set(reduzido.flatMap((r) => listaDeSeletores(r.prelude)));
    const comTransformAtivo = semMedia.filter((r) => listaDeSeletores(r.prelude).some((s) => s.includes(':active')) && /transform\s*:/.test(r.body));
    expect(comTransformAtivo.length).toBeGreaterThan(0);
    for (const r of comTransformAtivo) {
      for (const s of listaDeSeletores(r.prelude)) {
        expect(doReduzido.has(s), `:active sem contrapartida em reduced-motion: ${s}`).toBe(true);
        expect(declaracoes(reduzido, s).transform, s).toBe('none');
      }
    }
    // transition com transform: o bloco reduzido refaz a transition so com cor
    const comTransicaoDeTransform = semMedia.filter((r) => /transition\s*:[^;]*\btransform\b/.test(r.body));
    expect(comTransicaoDeTransform.length).toBeGreaterThan(0);
    for (const r of comTransicaoDeTransform) {
      for (const s of listaDeSeletores(r.prelude)) {
        const d = declaracoes(reduzido, s);
        expect(d.transition, `transition com transform sem contrapartida: ${s}`).toBeDefined();
        expect(d.transition, s).not.toContain('transform');
      }
    }
    // animation: o spinner segue girando (indicador essencial), mas em outra duracao no modo reduzido
    const comAnimacao = semMedia.filter((r) => /animation\s*:/.test(r.body));
    expect(comAnimacao.length).toBeGreaterThan(0);
    for (const r of comAnimacao) {
      for (const s of listaDeSeletores(r.prelude)) expect(declaracoes(reduzido, s)['animation-duration'], s).toBeDefined();
    }
  });
});

// ---------- fora das regioes ----------
// Regra "fora": nenhum seletor (cada item da lista sozinho) fora das regioes cujo ULTIMO composto tenha classe de MIGRADAS_F3A e
// cujas demais classes tambem sejam todas de MIGRADAS_F3A. `.fcd-acoes .ghost-button` e `.row-actions > button` passam.
describe('F3a: nada dos componentes migrados sobrou fora das regioes', () => {
  const foraLimpo = fora.replace(/\/\*[\s\S]*?\*\//g, '');
  const foraSeletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));

  it('MIGRADAS_F3A: 0 seletores antigos fora das regioes', () => {
    const violacoes = foraSeletores.filter((s) => {
      const ultimas = classesDoSeletor(ultimoComposto(s));
      if (!ultimas.some((c) => MIGRADAS_F3A.has(c))) return false;
      return classesDoSeletor(s).every((c) => MIGRADAS_F3A.has(c));
    });
    expect(violacoes).toEqual([]);
  });

  it('as sobrescritas do Forecast e de telas (com classe propria) continuam fora da regiao', () => {
    expect(foraSeletores).toContain('.fcd-acoes .ghost-button');
    expect(foraSeletores).toContain('.fc-busca .input');
    expect(foraSeletores).not.toContain('.row-actions .ghost-button');
    expect(foraSeletores).not.toContain('.link-button');
  });

  it('o rotulo "field-label" nao tem mais caixa alta em nenhuma regra fora da regiao', () => {
    const regrasDoRotulo = regrasPlanas(parseRules(foraLimpo)).filter((r) => listaDeSeletores(r.prelude).some((s) => /(^| )\.field-label$/.test(s)));
    for (const r of regrasDoRotulo) expect(r.body, r.prelude).not.toContain('text-transform');
  });
});
