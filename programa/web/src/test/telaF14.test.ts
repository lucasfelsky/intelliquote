/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  classesDoSeletor,
  fixtureUniao,
  foraDasRegioes,
  opaque,
  parseColor,
  parseRules,
  ratioOf,
  readSource,
  regioes,
  stripComments,
  temasDeTokens,
  tokensDosTemas,
  type CssRule,
} from './rfCss';

// F14 (IQ Indent, PR 1: cadastros; mock v5): regiao `tela F14` do globals.css e os 3 tokens ambar. Esta guarda cobre: a regiao (unica, a ULTIMA, contigua a `tela F13`),
// o prefixo `.indent-page` em todo seletor, so token `--rf-*` (sem cor literal, sem declaracao de token, sem !important, sem @media print, sem at-rule), a caixa de produtos com
// `max-height: 190px`, os 3 tokens da fixture `suiteComexTokens.f14.json` nos 2 temas (valor da fixture; uso so nas regioes `shell F2` e `tela F14`), o contraste do ambar e a ancora
// `tokens F14 (indent)` nos 2 blocos, depois da `tokens F13 (forecast)`. As regras da variante da sidebar/topbar ficam na regiao `shell F2` (seletores .sidebar / .app-shell).

const NOME = 'tela F14';
const PREFIXO = '.indent-page';
const ANCORA = '/* tokens F14 (indent) */';
const rawLf = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regs = regioes(rawLf);
const regiao = regs.find((r) => r.nome === NOME);
const fora = foraDasRegioes(rawLf, regs);
const { claro: lightTokens, escuro: darkTokens } = tokensDosTemas(rawLf);
const THEMES = temasDeTokens(lightTokens, darkTokens);

const fixtureF14 = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f14.json');

// Seletores de uma lista "a, b" sem quebrar em virgulas dentro de parenteses (:is(...), :not(...)).
function listaDeSeletores(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let atual = '';
  for (const ch of prelude) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      if (atual.trim()) out.push(atual.replace(/\s+/g, ' ').trim());
      atual = '';
    } else atual += ch;
  }
  if (atual.trim()) out.push(atual.replace(/\s+/g, ' ').trim());
  return out;
}

const topo: CssRule[] = regiao?.regras ?? [];
const seletores = topo.flatMap((r) => listaDeSeletores(r.prelude));
const limpo = regiao?.limpo ?? '';

describe('F14: regiao `tela F14` (IQ Indent)', () => {
  it('existe uma vez, logo depois da tela F13 (so espaco entre elas) e e a ULTIMA das regioes', () => {
    expect(regiao).toBeDefined();
    const nomes = regs.map((r) => r.nome);
    expect(nomes.filter((n) => n === NOME)).toHaveLength(1);
    expect(nomes.at(-1)).toBe(NOME);
    expect(nomes.at(-2)).toBe('tela F13');
    const f13 = regs.find((r) => r.nome === 'tela F13');
    expect(rawLf.slice(f13?.fim ?? 0, regiao?.inicio ?? 0).trim()).toBe('');
    expect(rawLf.split(`/* >>> ${NOME} (Suite COMEX) >>> */`)).toHaveLength(2);
    expect(rawLf.split(`/* <<< ${NOME} <<< */`)).toHaveLength(2);
  });

  it('tem regras e todas sao de topo (nenhum at-rule: sem @media, sem @keyframes)', () => {
    expect(topo.length).toBeGreaterThan(30);
    expect(topo.filter((r) => r.prelude.startsWith('@'))).toEqual([]);
  });

  it('todo seletor (cada item da lista) comeca por .indent-page', () => {
    expect(seletores.length).toBeGreaterThan(30);
    expect(seletores.filter((s) => s !== PREFIXO && !s.startsWith(`${PREFIXO} `))).toEqual([]);
  });

  it('as classes que a regiao consome sao do Indent (indent-*), da raiz (.indent-page) ou contexto do app (nao redefine .chip/.table/.badge fora do prefixo)', () => {
    const proprias = new Set<string>();
    for (const sel of seletores) for (const c of classesDoSeletor(sel)) if (c.startsWith('indent-')) proprias.add(c);
    for (const esperada of [
      'indent-busca',
      'indent-chips',
      'indent-tabela',
      'indent-tabela-caixa',
      'indent-tag',
      'indent-tag-row',
      'indent-cell-main',
      'indent-cell-sub',
      'indent-num',
      'indent-linha-clicavel',
      'indent-opcoes',
      'indent-opcao',
      'indent-check',
      'indent-produtos-caixa',
      'indent-parceria',
      'indent-switch',
      'indent-vazio',
      'indent-form',
      'indent-campos',
    ]) {
      expect(proprias.has(esperada), esperada).toBe(true);
    }
  });

  it('so token --rf-*: sem cor literal (hex, rgb, hsl), sem cor nomeada de fundo/texto, sem !important, sem @media print e sem declaracao de token', () => {
    expect(limpo).toContain('var(--rf-');
    expect(limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(limpo).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    expect(limpo).not.toContain('!important');
    expect(limpo).not.toContain('@media print');
    expect(limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    // todo var() da regiao e --rf-*
    const vars = [...limpo.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '');
    expect(vars.filter((v) => !v.startsWith('--rf-'))).toEqual([]);
    // cor nomeada comum nos valores (white/black/transparent-like): so `transparent` e `currentColor` sao aceitos
    const nomeadas = [...limpo.matchAll(/:\s*[^;{}]*\b(white|black|red|green|blue|gray|grey|orange|yellow)\b[^;{}]*;/gi)].map((m) => m[0]);
    expect(nomeadas).toEqual([]);
  });

  it('a caixa rolavel de produtos do fornecedor tem max-height: 190px e overflow: auto', () => {
    const regra = topo.find((r) => listaDeSeletores(r.prelude).includes(`${PREFIXO} .indent-produtos-caixa`));
    expect(regra).toBeDefined();
    expect(regra?.body).toMatch(/max-height:\s*190px/);
    expect(regra?.body).toMatch(/overflow:\s*auto/);
    expect(regra?.body).toMatch(/border:\s*1px solid var\(--rf-border\)/);
    expect(regra?.body).toMatch(/border-radius:\s*var\(--rf-radius-button\)/); // 12px, como as caixas internas do mock
    expect(regra?.body).toMatch(/padding:\s*4px/);
  });

  it('modais: cabecalho e faixa de acoes ficam fixos (sticky) e so o corpo rola; titulo 18px; dica de campo 11px/400/soft (mais forte que .field > span)', () => {
    const corpo = (sel: string) => topo.find((r) => listaDeSeletores(r.prelude).includes(sel))?.body ?? '';
    expect(corpo(`${PREFIXO} .modal-content`)).toMatch(/scroll-padding:\s*108px 0/);
    expect(corpo(`${PREFIXO} .modal-header`)).toMatch(/position:\s*sticky/);
    expect(corpo(`${PREFIXO} .modal-header`)).toMatch(/top:\s*0/);
    expect(corpo(`${PREFIXO} .modal-header`)).toContain('background: var(--rf-surface)');
    expect(corpo(`${PREFIXO} .indent-form > .modal-actions`)).toMatch(/position:\s*sticky/);
    expect(corpo(`${PREFIXO} .indent-form > .modal-actions`)).toMatch(/bottom:\s*0/);
    expect(corpo(`${PREFIXO} .modal-header h2`)).toMatch(/font-size:\s*18px/);
    const dica = corpo(`${PREFIXO} .field > .field-hint`);
    expect(dica).toMatch(/font-size:\s*11px/);
    expect(dica).toMatch(/font-weight:\s*400/);
    expect(dica).toContain('color: var(--rf-ink-soft)');
  });

  it('tabela: colunas numericas em mono/nowrap e densidade do mock (10px 14px); cabecalho da pagina com subtitulo 14px/62ch', () => {
    const corpo = (sel: string) => topo.find((r) => listaDeSeletores(r.prelude).includes(sel))?.body ?? '';
    expect(corpo(`${PREFIXO} .indent-num`)).toContain('font-family: var(--rf-font-mono)');
    expect(corpo(`${PREFIXO} .indent-num`)).toMatch(/white-space:\s*nowrap/);
    expect(corpo(`${PREFIXO} .indent-tabela td`)).toMatch(/padding:\s*10px 14px/);
    expect(corpo(`${PREFIXO} > .page-header .page-subtitle`)).toMatch(/font-size:\s*14px/);
    expect(corpo(`${PREFIXO} > .page-header .page-subtitle`)).toMatch(/max-width:\s*62ch/);
  });

  it('o eyebrow da pagina usa o ambar 700 e o do modal (.modal-eyebrow) existe so sob a raiz', () => {
    const eyebrow = topo.find((r) => listaDeSeletores(r.prelude).includes(`${PREFIXO} .eyebrow`));
    expect(eyebrow?.body).toContain('var(--rf-indent-acc-700)');
    expect(seletores).toContain(`${PREFIXO} .modal-eyebrow`);
    expect(seletores.filter((s) => s.includes('.modal-eyebrow') && !s.startsWith(PREFIXO))).toEqual([]);
  });

  it('o cartao de modo de restricao marca o escolhido pela classe is-selected (sem aria-checked no label) e a chave (switch) usa so token', () => {
    expect(seletores).toContain(`${PREFIXO} .indent-opcao.is-selected`);
    expect(limpo).not.toContain('aria-checked');
    expect(seletores).toContain(`${PREFIXO} .indent-switch input:checked + i`);
    const knob = topo.find((r) => listaDeSeletores(r.prelude).includes(`${PREFIXO} .indent-switch i::after`));
    expect(knob?.body).toContain('background: var(--rf-on-action)');
  });
});

describe('F14: tokens ambar (ancora `tokens F14 (indent)` nos 2 blocos e fixture f14)', () => {
  it('a ancora existe 1 vez em cada bloco (claro e escuro), depois da `tokens F13 (forecast)` e do par F13-E', () => {
    expect(rawLf.split(ANCORA)).toHaveLength(3);
    const posicoes = [...rawLf.matchAll(/\/\* tokens F14 \(indent\) \*\//g)].map((m) => m.index ?? 0);
    const f13 = [...rawLf.matchAll(/\/\* tokens F13 \(forecast\) \*\//g)].map((m) => m.index ?? 0);
    const fimE = [...rawLf.matchAll(/\/\* -- <<< tokens F13-E -- \*\//g)].map((m) => m.index ?? 0);
    expect(posicoes).toHaveLength(2);
    expect(f13).toHaveLength(2);
    expect(fimE).toHaveLength(2);
    posicoes.forEach((p, i) => {
      expect(p, `bloco ${i}`).toBeGreaterThan(f13[i] ?? Infinity);
      expect(p, `bloco ${i}`).toBeGreaterThan(fimE[i] ?? Infinity);
      // logo depois do par F13-E: so espaco e comentario entre eles
      expect(rawLf.slice((fimE[i] ?? 0) + '/* -- <<< tokens F13-E -- */'.length, p).trim(), `bloco ${i}`).toBe('');
    });
  });

  it('a fixture f14 tem os 3 tokens: --rf-indent-acc constante e -700/-50 em pares claro/escuro, fonte mock', () => {
    expect(fixtureF14.map((t) => t.token).sort()).toEqual(['--rf-indent-acc', '--rf-indent-acc-50', '--rf-indent-acc-700']);
    const porNome = Object.fromEntries(fixtureF14.map((t) => [t.token, t]));
    expect(porNome['--rf-indent-acc']).toMatchObject({ claro: '#f5a524', escuro: null, constante: true, fonte: 'mock', ref: 'IQ Indent v5' });
    expect(porNome['--rf-indent-acc-700']).toMatchObject({ claro: '#8a5200', escuro: '#f2c46b', constante: false, fonte: 'mock' });
    expect(porNome['--rf-indent-acc-50']).toMatchObject({ claro: '#fff4df', escuro: '#33290f', constante: false, fonte: 'mock' });
  });

  it('os 3 tokens existem nos 2 temas com o valor da fixture (hex minusculo); o constante so no :root', () => {
    for (const t of fixtureF14) {
      expect(lightTokens[t.token], t.token).toBe(t.claro);
      expect(t.claro, t.token).toBe(t.claro.toLowerCase());
      if (t.constante) expect(darkTokens[t.token], t.token).toBeUndefined();
      else {
        expect(darkTokens[t.token], t.token).toBe(t.escuro);
        expect(t.escuro, t.token).toBe(t.escuro?.toLowerCase());
      }
    }
  });

  it('os 3 tokens so sao USADOS nas regioes `shell F2` e `tela F14` (nem fora das regioes nem nas demais)', () => {
    for (const t of fixtureF14) {
      const uso = `var(${t.token})`;
      expect(fora, t.token).not.toContain(uso);
      for (const r of regs.filter((x) => x.nome !== 'shell F2' && x.nome !== NOME)) expect(r.limpo, `${r.nome}: ${t.token}`).not.toContain(uso);
    }
    const shell = regs.find((r) => r.nome === 'shell F2')?.limpo ?? '';
    expect(shell).toContain('var(--rf-indent-acc)');
    expect(limpo).toContain('var(--rf-indent-acc-700)');
  });

  it('as regras da variante da sidebar/topbar vivem na regiao `shell F2` (seletores do shell) e consomem o ambar', () => {
    const shell = regs.find((r) => r.nome === 'shell F2');
    const regras = shell?.regras ?? [];
    const selShell = regras.flatMap((r) => (r.prelude.startsWith('@media') ? parseRules(r.body).flatMap((i) => listaDeSeletores(i.prelude)) : listaDeSeletores(r.prelude)));
    for (const esperado of [
      '.sidebar__brand-text',
      '.sidebar__brand-tag',
      '.sidebar--indent .sidebar__link--active',
      '.sidebar--indent .sidebar__link--active:focus-visible',
      '.sidebar__nav--voltar .sidebar__link',
      '.app-shell--indent .topbar',
      '.sidebar--colapsada .sidebar__brand-tag',
    ]) {
      expect(selShell, esperado).toContain(esperado);
    }
    const tag = regras.find((r) => listaDeSeletores(r.prelude).includes('.sidebar__brand-tag'));
    expect(tag?.body).toContain('background: var(--rf-indent-acc)');
    expect(tag?.body).toContain('color: var(--rf-on-primary)');
    const topbar = regras.find((r) => listaDeSeletores(r.prelude).includes('.app-shell--indent .topbar'));
    expect(topbar?.body).toMatch(/border-top:\s*3px solid var\(--rf-indent-acc\)/);
    const ativo = regras.find((r) => listaDeSeletores(r.prelude).includes('.sidebar--indent .sidebar__link--active'));
    expect(ativo?.body).toContain('inset 3px 0 0 var(--rf-indent-acc)');
    expect(ativo?.body).toContain('inset 0 0 0 1px var(--rf-sidebar-active-ring)');
  });
});

describe('F14: contraste do ambar (WCAG 2.x, nos 2 temas)', () => {
  const TEXT = 4.5;

  it('o texto do selo (--rf-on-primary) sobre o ambar constante (--rf-indent-acc) passa 4,5:1', () => {
    for (const tema of ['claro', 'escuro'] as const) {
      const ratio = ratioOf(opaque(THEMES[tema], '--rf-on-primary'), opaque(THEMES[tema], '--rf-indent-acc'));
      expect(ratio, tema).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it('o eyebrow (--rf-indent-acc-700) passa 4,5:1 sobre --rf-bg, --rf-surface e --rf-surface-alt', () => {
    for (const tema of ['claro', 'escuro'] as const) {
      for (const fundo of ['--rf-bg', '--rf-surface', '--rf-surface-alt']) {
        const ratio = ratioOf(opaque(THEMES[tema], '--rf-indent-acc-700'), opaque(THEMES[tema], fundo));
        expect(ratio, `${tema}: --rf-indent-acc-700 / ${fundo}`).toBeGreaterThanOrEqual(TEXT);
      }
    }
  });

  it('os valores sao os do mock: ambar #f5a524 (constante), 700 #8a5200/#f2c46b e 50 #fff4df/#33290f', () => {
    expect(parseColor(lightTokens['--rf-indent-acc'] ?? '')).toEqual([245, 165, 36, 1]);
    expect(parseColor(lightTokens['--rf-indent-acc-700'] ?? '')).toEqual([138, 82, 0, 1]);
    expect(parseColor(darkTokens['--rf-indent-acc-700'] ?? '')).toEqual([242, 196, 107, 1]);
    expect(parseColor(lightTokens['--rf-indent-acc-50'] ?? '')).toEqual([255, 244, 223, 1]);
    expect(parseColor(darkTokens['--rf-indent-acc-50'] ?? '')).toEqual([51, 41, 15, 1]);
    expect(stripComments(rawLf)).not.toMatch(/--rf-indent-acc[\w-]*:\s*#[0-9A-F]*[A-F]/);
  });
});
