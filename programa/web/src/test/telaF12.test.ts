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
  stripComments,
  temasDeTokens,
  tokensDosTemas,
  type CssRule,
  type ThemeName,
} from './rfCss';

// F12-S (globais da F12; Suite COMEX): ghost escuro global (S1), titulo e link no papel claro do escuro (S2), impressao das telas principais (S3),
// fontes sem Roboto/Space Grotesk (S4) e a prova consolidada das bordas decorativas (S5). CSS na regiao `tela F12` (so S3) e nos 2 blocos de token
// (par --rf-ghost-escuro-*); as 12 declaracoes de S1 ficam nas regioes F3a e F6-F11 (cada uma guarda a propria linha no teste da etapa).

const NOME = 'tela F12';
const rawLf = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regs = regioes(rawLf);
const regiao = regs.find((r) => r.nome === NOME);
const fora = foraDasRegioes(rawLf, regs);
const { claro: lightTokens, escuro: darkTokens } = tokensDosTemas(rawLf);
const THEMES = temasDeTokens(lightTokens, darkTokens);
const indexHtml = readSource('../../index.html');

const opaque = (tema: ThemeName, nome: string) => opaqueOf(THEMES[tema], nome);
const ratio = (tema: ThemeName, fg: string, bg: string) => ratioOf(opaque(tema, fg), opaque(tema, bg));

const RAIZES = ['overview-page', 'cotacoes-page', 'cotacao-detalhe-page', 'solicitacoes-page', 'relatorios-page', 'auditoria-page', 'fornecedores-page', 'manual-page'] as const;
const ESCOPO = `body:has(:is(${RAIZES.map((r) => `.${r}`).join(', ')}))`;

const sources = import.meta.glob(['../**/*.tsx', '../**/*.ts', '!../test/**', '!../**/*.test.ts', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

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

const topo: CssRule[] = regiao?.regras ?? [];
const interiores: CssRule[] = topo.flatMap((r) => (r.prelude === '@media print' ? parseRules(r.body) : []));
const seletores = interiores.flatMap((r) => listaDeSeletores(r.prelude));

// ---------- S3: regiao `tela F12` (impressao) ----------
describe('F12-S S3: regiao `tela F12` (so impressao das 7 telas principais e do Manual)', () => {
  it('existe uma vez, logo depois da tela F11 (so espaco entre elas) e e a ultima das regioes', () => {
    expect(regiao).toBeDefined();
    const nomes = regs.map((r) => r.nome);
    expect(nomes.filter((n) => n === NOME)).toHaveLength(1);
    expect(nomes.at(-1)).toBe(NOME);
    expect(nomes.at(-2)).toBe('tela F11');
    const f11 = regs.find((r) => r.nome === 'tela F11');
    expect(rawLf.slice(f11?.fim ?? 0, regiao?.inicio ?? 0).trim()).toBe('');
  });

  it('so tem 1 at-rule de topo: @media print (nenhuma regra solta, nenhum outro @)', () => {
    expect(topo).toHaveLength(1);
    expect(topo[0]?.prelude).toBe('@media print');
    expect(interiores.length).toBeGreaterThan(8);
    for (const r of interiores) expect(r.prelude.startsWith('@'), r.prelude).toBe(false);
  });

  it('todo seletor (cada item da lista) comeca por body:has(:is(as 8 raizes)): o Forecast fica de fora por construcao', () => {
    expect(seletores.length).toBeGreaterThan(8);
    expect(seletores.filter((s) => !s.startsWith(`${ESCOPO} `) && s !== ESCOPO)).toEqual([]);
  });

  it('as 8 raizes existem no codigo, cada uma em ao menos 1 pagina, e nenhuma esta no Forecast', () => {
    const paginas = Object.entries(sources).filter(([caminho]) => /\/pages\//.test(caminho));
    for (const raiz of RAIZES) expect(paginas.some(([, src]) => new RegExp(`['"\`\\s]${raiz}['"\`\\s]`).test(src)), raiz).toBe(true);
    const forecast = Object.entries(sources).filter(([caminho]) => /\/pages\/Forecast(\.tsx|\/)/.test(caminho));
    expect(forecast.length).toBeGreaterThan(5);
    for (const [caminho, src] of forecast) for (const raiz of RAIZES) expect(src, `${caminho}: ${raiz}`).not.toContain(raiz);
  });

  it('nenhuma classe do Forecast (fc*-, fdec-, fgc-) e so as classes previstas (as 8 raizes, o shell, a tabela, o cartao, a paginacao, as tabelas de Respostas e Fornecedores e as colunas de acoes)', () => {
    const classes = new Set(seletores.flatMap((s) => classesDoSeletor(s)));
    expect([...classes].filter((c) => /^(fc[a-z]*-|fdec|fgc|fcr)/.test(c))).toEqual([]);
    const previstas = new Set<string>([
      ...RAIZES,
      'sidebar',
      'topbar',
      'page-header__actions',
      'pagination',
      'app-shell',
      'app-shell__content',
      'card',
      'kpi',
      'cmp-card',
      'table-wrapper',
      'table',
      // largura fixa e nowrap de Respostas e Fornecedores (estouravam o A4)
      'respostas-tab__tabela',
      'respostas-tab__fornecedor',
      'respostas-tab__th-pagamento',
      'respostas-tab__num',
      'fornecedores-tabela',
      'fornecedores-linha',
      // coluna de acoes (some no papel)
      'row-actions',
      'solicitacoes-tabela',
      'sol-cell-actions',
      'solicitacoes-ver',
      // Manual (M6): o que some ou perde rolagem no papel
      'manual-indice',
      'manual-indice-select',
      'manual-busca',
      'manual-layout',
      'manual-capitulo',
      'manual-rolagem',
      'manual-svg--fluxo',
      'manual-svg--ciclo',
      'manual-regua',
      'manual-figura',
    ]);
    expect([...classes].filter((c) => !previstas.has(c))).toEqual([]);
    for (const raiz of RAIZES) expect(classes.has(raiz), raiz).toBe(true);
  });

  it('Manual no papel (M6): some indice, seletor e busca; capitulo em bloco sem sombra; figuras e tabelas sem rolagem e sem min-width; figura nao quebra no meio', () => {
    const decl = (seletor: string) => {
      const out: Record<string, string> = {};
      for (const r of interiores) {
        if (!listaDeSeletores(r.prelude).includes(seletor)) continue;
        for (const [, prop, valor] of r.body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) {
          if (prop !== undefined && valor !== undefined) out[prop] = valor.replace(/\s+/g, ' ').trim();
        }
      }
      return out;
    };
    expect(decl(`${ESCOPO} :is(.manual-indice, .manual-indice-select, .manual-busca)`)).toEqual({ display: 'none' });
    expect(decl(`${ESCOPO} .manual-layout`)).toEqual({ display: 'block' });
    expect(decl(`${ESCOPO} .manual-capitulo`)).toEqual({ 'box-shadow': 'none' });
    expect(decl(`${ESCOPO} .manual-rolagem`)).toEqual({ overflow: 'visible' });
    expect(decl(`${ESCOPO} :is(.manual-svg--fluxo, .manual-svg--ciclo, .manual-regua)`)).toEqual({ 'min-width': '0' });
    expect(decl(`${ESCOPO} .manual-figura`)).toEqual({ 'break-inside': 'avoid' });
    // so ha regras manual-* na regiao quando sob o escopo da impressao (as 8 raizes)
    expect(seletores.filter((s) => /manual-/.test(s.replace(ESCOPO, '')) && !s.startsWith(`${ESCOPO} `))).toEqual([]);
  });

  it('sem !important, sem cor literal e sem declaracao de token; so a regiao muda o papel (nada de print nos tokens)', () => {
    const limpo = regiao?.limpo ?? '';
    expect(limpo).not.toContain('!important');
    expect(limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\bhwb\(|\boklch\(/);
    expect(limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
  });

  it('o papel perde sidebar, topbar, acoes do cabecalho e paginacao; o shell vira bloco sem fundo; cartoes sem sombra; tabela sem rolagem; thead repete; linha nao quebra', () => {
    const decl = (seletor: string) => {
      const out: Record<string, string> = {};
      for (const r of interiores) {
        if (!listaDeSeletores(r.prelude).includes(seletor)) continue;
        for (const [, prop, valor] of r.body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) {
          if (prop !== undefined && valor !== undefined) out[prop] = valor.replace(/\s+/g, ' ').trim();
        }
      }
      return out;
    };
    expect(decl(`${ESCOPO} :is(.sidebar, .topbar, .page-header__actions, .pagination)`)).toEqual({ display: 'none' });
    expect(decl(`${ESCOPO} .app-shell`)).toEqual({ display: 'block', 'min-height': '0', background: 'none', '-webkit-print-color-adjust': 'exact', 'print-color-adjust': 'exact' });
    expect(decl(`${ESCOPO} .app-shell__content`)).toEqual({ 'max-width': 'none', padding: '0' });
    expect(decl(`${ESCOPO} :is(.card, .kpi, .cmp-card)`)).toEqual({ 'box-shadow': 'none' });
    expect(decl(`${ESCOPO} .table-wrapper`)).toEqual({ overflow: 'visible' });
    expect(decl(`${ESCOPO} .table`)).toEqual({ 'min-width': '0', 'font-size': '12px' });
    expect(decl(`${ESCOPO} .table > :is(thead, tbody) > tr > :is(th, td)`)).toEqual({ padding: '8px 6px', 'white-space': 'normal' });
    expect(decl(`${ESCOPO} thead`)).toEqual({ display: 'table-header-group' });
    expect(decl(`${ESCOPO} tr`)).toEqual({ 'break-inside': 'avoid' });
    expect(decl(ESCOPO)).toEqual({ height: 'auto' });
  });

  it('nenhuma regra de impressao quebra palavra no meio: sem overflow-wrap/word-break/hyphens (so quebra em espaco; a sonda --impressao mede 0 palavra quebrada)', () => {
    expect(regiao?.limpo ?? '').not.toMatch(/overflow-wrap|word-break|word-wrap|hyphens/);
  });

  it('a coluna de acoes some no papel: ultima coluna das tabelas com .row-actions e as 2 (ou 1) colunas de acoes e "Ver itens" da Solicitacoes COMEX, sem tocar a linha de detalhe (colspan)', () => {
    const decl = (seletor: string) => interiores.find((r) => listaDeSeletores(r.prelude).includes(seletor))?.body.replace(/\s+/g, ' ').trim();
    const cont = (seletor: string) => seletores.filter((s) => s.startsWith(`${ESCOPO} ${seletor}`));
    expect(cont('.table:has(> tbody > tr > td:not([colspan]):last-child > .row-actions)')).toEqual([
      `${ESCOPO} .table:has(> tbody > tr > td:not([colspan]):last-child > .row-actions) > :is(thead, tbody) > tr > :is(th, td):not([colspan]):last-child`,
    ]);
    expect(decl(cont('.table:has(> tbody > tr > td:not([colspan]):last-child > .row-actions)')[0] ?? '')).toBe('display: none;');
    const comexComAcoes = `${ESCOPO} .solicitacoes-tabela:has(> tbody > tr > td.sol-cell-actions:not(.solicitacoes-ver)) > :is(thead, tbody) > tr > :is(th, td):not([colspan]):nth-last-child(-n+2)`;
    const comexSemAcoes = `${ESCOPO} .solicitacoes-tabela:not(:has(> tbody > tr > td.sol-cell-actions:not(.solicitacoes-ver))) > :is(thead, tbody) > tr > :is(th, td):not([colspan]):last-child`;
    expect(decl(comexComAcoes)).toBe('display: none;');
    expect(decl(comexSemAcoes)).toBe('display: none;');
  });

  it('3 regras de tabela por pagina (Respostas e Fornecedores): sem largura fixa e sem nowrap que estouram o papel A4', () => {
    const decl = (seletor: string) => interiores.find((r) => listaDeSeletores(r.prelude).includes(seletor))?.body.replace(/\s+/g, ' ').trim();
    expect(decl(`${ESCOPO} .respostas-tab__tabela :is(.respostas-tab__fornecedor, .respostas-tab__th-pagamento)`)).toBe('width: auto; min-width: 0;');
    expect(decl(`${ESCOPO} .respostas-tab__tabela .respostas-tab__num`)).toBe('white-space: normal;');
    expect(decl(`${ESCOPO} .fornecedores-page .fornecedores-tabela > tbody > tr.fornecedores-linha > td`)).toBe('padding: 8px 6px; white-space: normal;');
  });
});

// ---------- S1: ghost escuro global ----------
describe('F12-S S1: ghost escuro global (par --rf-ghost-escuro-borda / --rf-ghost-escuro-texto)', () => {
  const f12 = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f12.json');

  it('a fixture suiteComexTokens.f12.json tem os 2 pares (decisao, board 12b) e o CSS confere nos 2 temas', () => {
    expect(f12.map((t) => t.token)).toEqual(['--rf-ghost-escuro-borda', '--rf-ghost-escuro-texto']);
    expect(f12.find((t) => t.token === '--rf-ghost-escuro-borda')).toMatchObject({ claro: '#004153', escuro: 'rgba(20, 221, 167, 0.55)', constante: false, fonte: 'decisao', ref: 'board 12b' });
    expect(f12.find((t) => t.token === '--rf-ghost-escuro-texto')).toMatchObject({ claro: '#004153', escuro: '#5ff0c8', constante: false, fonte: 'decisao', ref: 'board 12b' });
    for (const t of f12) {
      expect(lightTokens[t.token], t.token).toBe(t.claro);
      expect(darkTokens[t.token], t.token).toBe(t.escuro);
    }
  });

  it('no claro o par e IDENTICO ao --rf-action (nada muda); a ancora `tokens F12 (qa)` vem depois da `tokens F11` nos 2 blocos', () => {
    expect(lightTokens['--rf-ghost-escuro-borda']).toBe(lightTokens['--rf-action']);
    expect(lightTokens['--rf-ghost-escuro-texto']).toBe(lightTokens['--rf-action']);
    const ancora = '/* tokens F12 (qa) */';
    expect(rawLf.split(ancora)).toHaveLength(3);
    const posicoes = [...rawLf.matchAll(/\/\* tokens F12 \(qa\) \*\//g)].map((m) => m.index ?? 0);
    const f11 = [...rawLf.matchAll(/\/\* tokens F11 \(administracao\) \*\//g)].map((m) => m.index ?? 0);
    expect(f11).toHaveLength(2);
    posicoes.forEach((p, i) => expect(p, `bloco ${i}`).toBeGreaterThan(f11[i] ?? Infinity));
  });

  it('contraste do par no escuro: texto 10,43 (--rf-surface), 8,77 (--rf-surface-alt), 12,54 (--rf-bg); borda composta 3,59 (>= 3)', () => {
    expect(ratio('escuro', '--rf-ghost-escuro-texto', '--rf-surface')).toBeCloseTo(10.43, 1);
    expect(ratio('escuro', '--rf-ghost-escuro-texto', '--rf-surface-alt')).toBeCloseTo(8.77, 1);
    expect(ratio('escuro', '--rf-ghost-escuro-texto', '--rf-bg')).toBeCloseTo(12.54, 1);
    expect(ratio('escuro', '--rf-ghost-escuro-borda', '--rf-surface')).toBeCloseTo(3.59, 1);
    for (const bg of ['--rf-surface', '--rf-surface-alt', '--rf-bg']) {
      expect(ratio('escuro', '--rf-ghost-escuro-texto', bg), bg).toBeGreaterThanOrEqual(4.5);
      expect(ratio('claro', '--rf-ghost-escuro-texto', bg), bg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('os 2 tokens sao usados SO nas 12 declaracoes (12 bordas e 5 cores) e so DENTRO das regioes; a compat Forecast F3 segue em --rf-action', () => {
    const compat = regs.find((r) => r.nome === 'compat Forecast F3');
    const dentro = regs.map((r) => r.limpo).join('\n');
    expect(dentro.split('var(--rf-ghost-escuro-borda)')).toHaveLength(13);
    expect(dentro.split('var(--rf-ghost-escuro-texto)')).toHaveLength(6);
    expect(fora).not.toContain('var(--rf-ghost-escuro');
    expect(compat?.limpo).not.toContain('--rf-ghost-escuro');
    for (const r of regs) {
      for (const regra of r.regras) {
        if (!/--rf-ghost-escuro-(borda|texto)/.test(regra.body)) continue;
        expect(r.nome, regra.prelude).toMatch(/^(componentes F3a|tela F(6|7|8|9|10|11))$/);
        // so border (borda do secundario) e color; nunca hover, pressionado, desabilitado ou destrutivo
        expect(regra.prelude.replace(':not(.danger-button)', ''), regra.prelude).not.toMatch(/:(hover|active|disabled|focus)|danger/);
      }
    }
  });

  it('nenhuma regra fora da compat Forecast F3 tem borda de secundario em var(--rf-action): so a compat, 1 vez', () => {
    const compat = regs.find((r) => r.nome === 'compat Forecast F3');
    const todas = rawLf.split('1.5px solid var(--rf-action)').length - 1;
    const naCompat = (compat?.limpo ?? '').split('1.5px solid var(--rf-action)').length - 1;
    expect(todas).toBe(1);
    expect(naCompat).toBe(1);
  });
});

// ---------- S2: titulo e link no papel claro do escuro ----------
describe('F12-S S2: titulo e link no papel claro (Jodit, previa da assinatura) no escuro', () => {
  const escopo = ':root[data-theme="dark"] :is(.paper-surface, .jodit-container, .jodit-popup, .jodit-dialog)';
  const css = stripComments(rawLf);
  const regras = parseRules(css);

  it('as 2 regras existem (h1-h3 em --ink; a e a:hover em --primary-700) fora das regioes, sem !important e sem token --rf-', () => {
    const titulos = regras.find((r) => listaDeSeletores(r.prelude).includes(`${escopo} :is(h1, h2, h3)`));
    expect(titulos?.body.replace(/\s+/g, ' ').trim()).toBe('color: var(--ink);');
    const links = regras.find((r) => listaDeSeletores(r.prelude).includes(`${escopo} a:hover`));
    expect(listaDeSeletores(links?.prelude ?? '')).toEqual([`${escopo} a`, `${escopo} a:hover`]);
    expect(links?.body.replace(/\s+/g, ' ').trim()).toBe('color: var(--primary-700);');
    expect(fora).toContain(`${escopo} :is(h1, h2, h3) {`);
  });

  it('o escopo "papel claro" segue intacto (religa color e os tokens de texto) e as 2 regras vem depois do ::placeholder dele', () => {
    const ph = `${escopo} ::placeholder {`;
    const h = `${escopo} :is(h1, h2, h3) {`;
    const base = `${escopo} {\n  color-scheme: light;\n  --ink: var(--paper-ink);\n  --ink-soft: var(--paper-ink-soft);\n  --ink-muted: var(--paper-placeholder);\n  --primary-700: var(--paper-link);\n  color: var(--ink);\n}`;
    expect(rawLf).toContain(base);
    expect(rawLf.indexOf(h)).toBeGreaterThan(rawLf.indexOf(ph));
    expect(rawLf.indexOf(ph)).toBeGreaterThan(rawLf.indexOf(base));
  });
});

// ---------- S4: fontes ----------
describe('F12-S S4: o <link> do Google Fonts so baixa Manrope e Sora', () => {
  it('index.html sem Roboto nem Space Grotesk; a familia segue como o suiteComexTokens exige', () => {
    expect(indexHtml).not.toMatch(/Roboto|Space\+Grotesk|Space Grotesk/);
    expect(indexHtml).toContain('family=Manrope:wght@400;500;600;700;800&family=Sora:wght@400;600;700&display=swap');
    expect(indexHtml.match(/fonts\.googleapis\.com\/css2/g)).toHaveLength(1);
  });

  it('nenhum CSS nem .tsx usa Roboto ou Space Grotesk', () => {
    expect(rawLf).not.toMatch(/Roboto|Space Grotesk/);
    const usam = Object.entries(sources).filter(([, src]) => /Roboto|Space Grotesk/.test(src)).map(([caminho]) => caminho);
    expect(usam).toEqual([]);
  });
});

// ---------- S5: bordas decorativas x estados ----------
describe('F12-S S5: nenhum ESTADO depende so de borda decorativa (< 3:1)', () => {
  // DECORATIVAS registradas pelas telas F4-F11 (razao medida sobre --rf-surface do tema; a faixa da linha expandida sobre --rf-surface-alt):
  // abaixo de 3:1 por desenho, sempre acompanhadas de texto, icone ou fundo. Se a razao mudar, atualize a lista e DECIDA.
  const DECORATIVAS: ReadonlyArray<{ token: string; bg?: string; claro: number | null; escuro: number | null }> = [
    { token: '--rf-border', claro: 1.33, escuro: 1.38 },
    { token: '--rf-divider', claro: 1.2, escuro: 1.26 },
    { token: '--rf-empty-border', claro: 1.69, escuro: 1.97 },
    { token: '--rf-kpi-destaque-borda', claro: 1.44, escuro: 2 },
    { token: '--rf-cc-auto-borda', claro: 1.55, escuro: 2.26 },
    { token: '--rf-vencedora-borda', claro: 1.68, escuro: 8.42 },
    { token: '--rf-aviso-borda', claro: 1.42, escuro: 2.27 },
    { token: '--rf-aviso-borda-suave', claro: 1.38, escuro: 2 },
    { token: '--rf-popover-aviso-borda', claro: 1.52, escuro: 2.56 },
    { token: '--rf-cmp-criterio-borda', claro: 1.33, escuro: 2 },
    { token: '--rf-score-trilho', claro: 1.2, escuro: 1.43 },
    // faixa de 3 px da linha expandida de Fornecedores (claro; no escuro o --rf-primary passa de 3)
    { token: '--rf-primary', bg: '--rf-surface-alt', claro: 1.65, escuro: null },
    // legadas do Forecast (bloco intocado)
    { token: '--border', claro: 1.33, escuro: 1.38 },
    { token: '--border-strong', claro: 2.22, escuro: null },
    { token: '--tone-warning-border-strong', claro: 2.19, escuro: null },
    { token: '--primary', claro: 1.76, escuro: null },
  ];

  it('as DECORATIVAS tem a razao medida nos 2 temas (e todas existem)', () => {
    for (const d of DECORATIVAS) {
      if (d.claro !== null) expect(ratio('claro', d.token, d.bg ?? '--rf-surface'), `claro ${d.token}`).toBeCloseTo(d.claro, 2);
      if (d.escuro !== null) expect(ratio('escuro', d.token, d.bg ?? '--rf-surface'), `escuro ${d.token}`).toBeCloseTo(d.escuro, 2);
    }
  });

  it('ESTADO >= 3:1 nos 2 temas: borda do campo, --rf-action, borda do ghost escuro e --rf-danger', () => {
    const ESTADO: ReadonlyArray<readonly [fg: string, bg: string]> = [
      ['--rf-input-border', '--rf-surface'],
      ['--rf-input-border', '--rf-surface-alt'],
      ['--rf-input-border', '--rf-input-bg'],
      ['--rf-action', '--rf-surface'],
      ['--rf-action', '--rf-bg'],
      ['--rf-ghost-escuro-borda', '--rf-surface'],
      ['--rf-danger', '--rf-surface'],
    ];
    for (const tema of ['claro', 'escuro'] as const) {
      for (const [fg, bg] of ESTADO) expect(ratio(tema, fg, bg), `${tema}: ${fg} / ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
});
