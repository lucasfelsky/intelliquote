/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guarda do CSS do shell (F2, mock v68): foco, alvo de toque e movimento, que o jsdom nao mede.
// Le o globals.css (unico CSS do app) e confere a regiao delimitada "shell F2" e que nenhuma regra antiga do shell
// sobrou fora dela.

// O caminho vai por variavel: com literal, o Vite reescreve new URL('...', import.meta.url) como asset (http).
const readSource = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const REGION_START = '/* >>> shell F2 (Suite COMEX) >>> */';
const REGION_END = '/* <<< shell F2 <<< */';
const start = css.indexOf(REGION_START);
const end = css.indexOf(REGION_END);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const region = stripComments(start >= 0 && end > start ? css.slice(start, end + REGION_END.length) : '');
const outside = stripComments(start >= 0 && end > start ? css.slice(0, start) + css.slice(end + REGION_END.length) : css);

interface CssRule {
  prelude: string;
  body: string;
}

function parseRules(text: string): CssRule[] {
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

const topRules = parseRules(region);
const mediaBody = (name: string) => topRules.find((r) => r.prelude === name)?.body ?? '';
const plainRules = topRules.filter((r) => !r.prelude.startsWith('@'));

/** Declaracoes (propriedade -> valor) de TODAS as regras da lista cujo seletor (item da lista) e exatamente `selector`. */
function declarations(rules: CssRule[], selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (!rule.prelude.split(',').map((x) => x.trim()).includes(selector)) continue;
    for (const [, prop, value] of rule.body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) {
      if (prop !== undefined && value !== undefined) out[prop] = value.replace(/\s+/g, ' ').trim();
    }
  }
  return out;
}

const decl = (selector: string) => declarations(plainRules, selector);
const mediaDecl = (media: string, selector: string) => declarations(parseRules(mediaBody(media)), selector);

describe('shell F2: layout e medidas do mock', () => {
  it('a regiao existe e tem regras', () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(plainRules.length).toBeGreaterThan(40);
  });

  it('.app-shell: coluna de 256px + 1fr, altura minima da viewport', () => {
    expect(decl('.app-shell')['grid-template-columns']).toMatch(/^256px 1fr$/);
    expect(decl('.app-shell')['min-height']).toBe('100vh');
  });

  it('.app-shell__content: padding do mock e max-width mantido (F2-D4)', () => {
    expect(decl('.app-shell__content').padding).toBe('28px clamp(16px, 3vw, 40px) 40px');
    expect(decl('.app-shell__content')['max-width']).toBe('1200px');
  });

  it('.sidebar: 256 de coluna, gradiente por token, sticky 100vh com rolagem interna (F2-D7)', () => {
    const sidebar = decl('.sidebar');
    expect(sidebar.padding).toBe('24px 16px 18px');
    expect(sidebar.gap).toBe('24px');
    expect(sidebar.background).toBe('var(--rf-sidebar-bg)');
    expect(sidebar.position).toBe('sticky');
    expect(sidebar.height).toBe('100vh');
    expect(sidebar['overflow-y']).toBe('auto');
  });

  it('.sidebar__link: altura 44, raio do botao, 14px/600, padding 0 12px 0 14px', () => {
    const link = decl('.sidebar__link');
    expect(link.height).toBe('44px');
    expect(link['border-radius']).toBe('var(--rf-radius-button)');
    expect(link.padding).toBe('0 12px 0 14px');
    expect(link['font-size']).toBe('14px');
    expect(link['font-weight']).toBe('600');
  });

  it('.sidebar__brand-name: 2px acima (top -2px) e line-height 40px', () => {
    const name = decl('.sidebar__brand-name');
    expect(name.top).toBe('-2px');
    expect(name.position).toBe('relative');
    expect(name['line-height']).toBe('40px');
    expect(name['font-family']).toBe('var(--rf-font-display)');
  });

  it('.topbar: altura minima 76px; fundo transparente (F2-D3); borda inferior por token', () => {
    const topbar = decl('.topbar');
    expect(topbar['min-height']).toBe('76px');
    expect(topbar.background).toBe('transparent');
    expect(topbar['border-bottom']).toBe('1px solid var(--rf-border)');
    expect(topbar.padding).toBe('14px clamp(16px, 3vw, 40px)');
  });

  it('.topbar__account e .topbar__user: altura 44', () => {
    expect(decl('.topbar__account').height).toBe('44px');
    expect(decl('.topbar__user').height).toBe('44px');
  });
});

describe('shell F2: foco visivel (anel por box-shadow, sem outline)', () => {
  it.each(['.sidebar__link:focus-visible', '.sidebar__theme:focus-visible', '.sidebar__logout:focus-visible'])(
    '%s tem box-shadow com anel navy + menta',
    (selector) => {
      const focus = decl(selector);
      expect(focus['box-shadow'], selector).toBe('0 0 0 2px var(--rf-primary-strong), 0 0 0 4px var(--rf-primary)');
      expect(focus.outline, selector).toBe('none');
    },
  );

  it('.topbar__account:focus-visible: anel de 3px na superficie e 5px na cor de acao', () => {
    const focus = decl('.topbar__account:focus-visible');
    expect(focus['box-shadow']).toBe('0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-action)');
    expect(focus.outline).toBe('none');
  });

  it('link ativo focado mantem o anel interno do item ativo', () => {
    expect(decl('.sidebar__link--active:focus-visible')['box-shadow']).toContain('inset 0 0 0 1px var(--rf-sidebar-active-ring)');
  });
});

describe('shell F2: alvo de toque (F2-D2)', () => {
  it('mouse segue o canvas v72: tema 40 e Sair 44', () => {
    expect(decl('.sidebar__theme').height).toBe('40px');
    expect(decl('.sidebar__logout').height).toBe('44px');
  });

  it('@media (pointer: coarse) leva o botao de tema a 44 (Sair ja e 44)', () => {
    expect(mediaDecl('@media (pointer: coarse)', '.sidebar__theme').height).toBe('44px');
    expect(mediaDecl('@media (pointer: coarse)', '.theme-toggle--navy .theme-toggle__option')).toEqual({});
  });
});

describe('shell F2b: rodape da sidebar (canvas v72)', () => {
  it('.sidebar__footer: empurrado para baixo, coluna, gap 6', () => {
    const footer = decl('.sidebar__footer');
    expect(footer['margin-top']).toBe('auto');
    expect(footer['flex-direction']).toBe('column');
    expect(footer.gap).toBe('6px');
  });

  it.each(['.sidebar__theme', '.sidebar__logout'])('%s: 176 centralizado, padding 0 14px, gap 12, raio do botao, 600 13px', (selector) => {
    const botao = decl(selector);
    expect(botao['align-self'], selector).toBe('center');
    expect(botao.width, selector).toBe('176px');
    expect(botao['box-sizing'], selector).toBe('border-box');
    expect(botao.padding, selector).toBe('0 14px');
    expect(botao.gap, selector).toBe('12px');
    expect(botao['justify-content'], selector).toBe('center');
    expect(botao['text-align'], selector).toBe('center');
    expect(botao.border, selector).toBe('0');
    expect(botao['border-radius'], selector).toBe('var(--rf-radius-button)');
    expect(botao.background, selector).toBe('transparent');
    expect(botao.color, selector).toBe('var(--rf-sidebar-ink-soft)');
    expect(botao.font, selector).toBe('600 13px var(--rf-font-sans)');
    expect(botao.transition, selector).toContain('var(--rf-dur-base)');
  });

  it.each(['.sidebar__theme:hover', '.sidebar__logout:hover'])('%s: fundo de hover e texto claro por token', (selector) => {
    const hover = decl(selector);
    expect(hover.background, selector).toBe('var(--rf-sidebar-hover)');
    expect(hover.color, selector).toBe('var(--rf-sidebar-ink)');
  });

  it('.sidebar__signature: centralizada, padding-top 8, sem clique nem selecao', () => {
    const assinatura = decl('.sidebar__signature');
    expect(assinatura.display).toBe('flex');
    expect(assinatura['justify-content']).toBe('center');
    expect(assinatura['padding-top']).toBe('8px');
    expect(assinatura['pointer-events']).toBe('none');
    expect(assinatura['user-select']).toBe('none');
  });

  it('.sq-logo*: tokens, pesos e espacamentos do board (tom dark)', () => {
    expect(decl('.sq-logo').display).toBe('inline-flex');
    expect(decl('.sq-logo')['align-items']).toBe('center');
    expect(decl('.sq-logo__symbol')['flex-shrink']).toBe('0');
    expect(decl('.sq-logo__ring').stroke).toBe('var(--rf-sidebar-ink)');
    expect(decl('.sq-logo__green').fill).toBe('var(--rf-primary)');
    const palavras = decl('.sq-logo__words');
    expect(palavras.display).toBe('inline-flex');
    expect(palavras['align-items']).toBe('baseline');
    expect(palavras['white-space']).toBe('nowrap');
    expect(palavras['line-height']).toBe('1');
    expect(palavras['font-family']).toBe('var(--rf-font-display)');
    const sq = decl('.sq-logo__sq');
    expect(sq['font-weight']).toBe('600');
    expect(sq['letter-spacing']).toBe('-0.04em');
    expect(sq.color).toBe('var(--rf-sidebar-ink)');
    const quimica = decl('.sq-logo__chem');
    expect(quimica['font-weight']).toBe('400');
    expect(quimica['letter-spacing']).toBe('-0.03em');
    expect(quimica.color).toBe('var(--rf-sidebar-ink-soft)');
  });

  it('nenhum opacity / filter / box-shadow em .sq-logo* nem em .sidebar__signature', () => {
    const regras = plainRules.filter((r) => /\.(sq-logo|sidebar__signature)(?![A-Za-z0-9])/.test(r.prelude));
    expect(regras.length).toBeGreaterThanOrEqual(8);
    for (const regra of regras) {
      expect(regra.body, regra.prelude).not.toMatch(/(^|[;{\s])(opacity|filter|box-shadow|text-shadow)\s*:/);
    }
  });

  it('.sidebar__version: centralizada, 11px com line-height 15px, cor suave por token', () => {
    const versao = decl('.sidebar__version');
    expect(versao['text-align']).toBe('center');
    expect(versao['font-size']).toBe('11px');
    expect(versao['line-height']).toBe('15px');
    expect(versao.color).toBe('var(--rf-sidebar-ink-soft)');
    expect(versao.padding).toBeUndefined();
  });

  it('o seletor segmentado .theme-toggle saiu de TODO o CSS (regiao e fora dela)', () => {
    expect(region).not.toContain('theme-toggle');
    expect(outside).not.toContain('theme-toggle');
  });
});

describe('shell F2: entrada de pagina (500ms) e reduced-motion', () => {
  it('@keyframes rf-page-enter sobe 12px com opacidade', () => {
    const keyframes = topRules.find((r) => r.prelude === '@keyframes rf-page-enter');
    expect(keyframes).toBeDefined();
    expect(keyframes?.body).toContain('translateY(12px)');
    expect(keyframes?.body).toMatch(/opacity:\s*0/);
  });

  it('.app-shell__content > * usa rf-page-enter com --rf-dur-page, --rf-ease-out e backwards', () => {
    const animation = decl('.app-shell__content > *').animation;
    expect(animation).toBe('rf-page-enter var(--rf-dur-page) var(--rf-ease-out) backwards');
  });

  it('reduced-motion troca a animacao por fade de 150ms linear, sem deslocamento', () => {
    const body = mediaBody('@media (prefers-reduced-motion: reduce)');
    const animation = declarations(parseRules(body), '.app-shell__content > *').animation;
    expect(animation).toBe('rf-page-fade 150ms linear backwards');
    const fade = topRules.find((r) => r.prelude === '@keyframes rf-page-fade');
    expect(fade?.body).not.toContain('transform');
  });

  it('a animacao so atinge os filhos do conteudo: sidebar e topbar nao tem animation', () => {
    for (const selector of ['.sidebar', '.topbar', '.app-shell']) expect(decl(selector).animation, selector).toBeUndefined();
  });
});

describe('shell F2: <= 880px (sem hamburguer; F12)', () => {
  it('uma coluna, sidebar estatica e de altura automatica, coluna navy desligada, padding 16', () => {
    expect(mediaDecl('@media (max-width: 880px)', '.app-shell')['grid-template-columns']).toBe('1fr');
    expect(mediaDecl('@media (max-width: 880px)', '.app-shell')['background-image']).toBe('none');
    expect(mediaDecl('@media (max-width: 880px)', '.sidebar').position).toBe('static');
    expect(mediaDecl('@media (max-width: 880px)', '.sidebar').height).toBe('auto');
    expect(mediaDecl('@media (max-width: 880px)', '.app-shell__content').padding).toBe('16px');
  });
});

describe('shell F2: nenhuma regra antiga do shell fora da regiao', () => {
  it('fora da regiao, .sidebar / .topbar / .app-shell so aparecem na impressao do relatorio de compras', () => {
    const offenders: string[] = [];
    const visit = (rules: CssRule[]) => {
      for (const rule of rules) {
        if (rule.prelude.startsWith('@') && !rule.prelude.startsWith('@keyframes')) {
          visit(parseRules(rule.body));
        } else if (/\.(sidebar|topbar|app-shell|sq-logo|brand-mark)(?![A-Za-z0-9])/.test(rule.prelude)) {
          if (!rule.prelude.startsWith('body:has(.fcr-resumo)')) offenders.push(rule.prelude);
        }
      }
    };
    visit(parseRules(outside));
    expect(offenders).toEqual([]);
  });

  it('as regras de impressao do Forecast continuam (mesmos nomes de classe)', () => {
    expect(outside).toContain('body:has(.fcr-resumo) :is(.sidebar, .topbar,');
    expect(outside).toContain('body:has(.fcr-resumo) .app-shell { display: block;');
  });

  it('o seletor morto .topbar__user > .ghost-button saiu da lista de nowrap', () => {
    expect(outside).not.toContain('.topbar__user > .ghost-button');
  });
});
