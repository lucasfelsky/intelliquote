/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  classesDoSeletor,
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

// F3b (Suite COMEX): selos, chips, alertas, banners e tabelas. So CSS: a regiao `componentes F3b` do globals.css.
// Esta guarda afirma as receitas do mock (boards Componentes e Cotacoes), os invariantes da PROPRIA regiao
// (classes permitidas, at-rules, sem animacao) e que nenhum seletor migrado ficou fora dela.
// Botoes e campos sao da F3a (componentesF3a.test.ts); modal/toast da F3c; abas/paginacao/estrelas/cartao/vazio da F3d.

const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regs = regioes(css);
const regiao = regs.find((r) => r.nome === 'componentes F3b');
const regras: CssRule[] = regiao?.regras ?? [];
const limpo = regiao?.limpo ?? '';

// Classes que a regiao F3b pode citar em QUALQUER seletor (inclui as de contexto: .table, .row-actions...).
const PERMITIDAS_F3B = new Set([
  'badge',
  'badge--success',
  'badge--muted',
  'badge--warning',
  'badge--danger',
  'badge--info',
  'badge--dot',
  'chip',
  'chip--active',
  'chip--static',
  'chip-row',
  'chip-list',
  'alert',
  'alert--error',
  'alert--success',
  'alert--warning',
  'alert--info',
  'banner',
  'banner--ok',
  'banner--warning',
  'banner--error',
  'table',
  'table--dense',
  'table-wrapper',
  'row-actions',
  'row-actions--nowrap',
  'cell-nowrap',
  'cell-truncate',
  'col-status',
]);

// Classes cujas regras tem de morar so na regiao (seletor fora dela so passa com classe de tela/Forecast).
const MIGRADAS_F3B = new Set(PERMITIDAS_F3B);

// ---------- leitura das regras da regiao ----------
// Separa a lista de seletores por virgula FORA de parenteses (:is(.a, .b) e um seletor so).
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
    } else {
      atual += ch;
    }
  }
  if (atual.trim()) out.push(atual.replace(/\s+/g, ' ').trim());
  return out;
}

function declaracoes(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const parte of body.split(';')) {
    const i = parte.indexOf(':');
    if (i < 0) continue;
    const nome = parte.slice(0, i).trim();
    if (nome) out[nome] = parte.slice(i + 1).replace(/\s+/g, ' ').trim();
  }
  return out;
}

interface Achatada {
  seletor: string;
  decls: Record<string, string>;
  media: string | null;
}

function achatar(rules: CssRule[], media: string | null = null): Achatada[] {
  const out: Achatada[] = [];
  for (const r of rules) {
    if (r.prelude.startsWith('@media')) out.push(...achatar(parseRules(r.body), r.prelude));
    else if (!r.prelude.startsWith('@')) {
      for (const seletor of listaDeSeletores(r.prelude)) {
        out.push({ seletor, decls: declaracoes(r.body), media });
      }
    }
  }
  return out;
}

const achatadas = achatar(regras);

// Declaracoes efetivas do seletor EXATO (ultima regra vence, como na cascata de mesma especificidade).
function de(seletor: string): Record<string, string> {
  const hit = achatadas.filter((a) => a.seletor === seletor);
  if (hit.length === 0) throw new Error(`seletor ausente na regiao F3b: ${seletor}`);
  return Object.assign({}, ...hit.map((h) => h.decls)) as Record<string, string>;
}

// ---------- tokens e contraste (pares novos da etapa, nos 2 temas) ----------
const { claro, escuro } = tokensDosTemas(css);
const TEMAS = temasDeTokens(claro, escuro);
const opaque = (tema: ThemeName, nome: string): Rgb => opaqueOf(TEMAS[tema], nome);
const TEXT = 4.5;

const PAIRS_F3B: ReadonlyArray<readonly [fg: string, bg: string, min: number]> = [
  ['--rf-on-action', '--rf-action', TEXT],
  // chip estatico: texto --rf-ink sobre o tom neutro
  ['--rf-ink', '--rf-tone-neutral-bg', TEXT],
  // chip ativo/inativo e tabela: texto sobre o fundo da superficie e do hover da linha
  ['--rf-ink', '--rf-surface-alt', TEXT],
  ['--rf-ink-soft', '--rf-surface-alt', TEXT],
];

describe('F3b: token novo e contraste', () => {
  it('--rf-on-action: branco no claro e navy no escuro (par, nao constante)', () => {
    expect(claro['--rf-on-action']).toBe('#ffffff');
    expect(escuro['--rf-on-action']).toBe('#0b2430');
  });

  it('pares novos >= 4,5 nos 2 temas', () => {
    const baixos: string[] = [];
    for (const tema of ['claro', 'escuro'] as const) {
      for (const [fg, bg, min] of PAIRS_F3B) {
        const ratio = ratioOf(opaque(tema, fg), opaque(tema, bg));
        if (ratio < min) baixos.push(`${tema}: ${fg} / ${bg} = ${ratio.toFixed(2)}`);
      }
    }
    expect(baixos).toEqual([]);
  });
});

// ---------- invariantes da regiao ----------
describe('F3b: regiao `componentes F3b`', () => {
  it('existe, tem regras e nao declara --rf-*', () => {
    expect(regiao).toBeDefined();
    expect(regras.length).toBeGreaterThan(30);
    expect(limpo).not.toMatch(/(^|[;{\s])--rf-[\w-]+\s*:/);
    expect(limpo).toContain('var(--rf-');
  });

  it('toda classe citada em qualquer seletor pertence a PERMITIDAS_F3B', () => {
    const fora = achatadas.flatMap((a) => classesDoSeletor(a.seletor)).filter((c) => !PERMITIDAS_F3B.has(c));
    expect([...new Set(fora)]).toEqual([]);
  });

  it('at-rules: so a media da .table--dense (<= 1200px); sem print, keyframes ou animacao', () => {
    const atRules = regras.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    expect(atRules).toEqual(['@media (max-width: 1200px)']);
    expect(achatadas.filter((a) => a.media !== null).map((a) => a.seletor)).toEqual(['.table--dense th', '.table--dense td']);
    expect(limpo).not.toContain('@media print');
    expect(limpo).not.toContain('@keyframes');
    // invariante de movimento: sem transform e sem animation na regiao, entao nada exige reduced-motion
    expect(limpo).not.toMatch(/(^|[;{\s])(animation|transform)\s*:/);
    expect(limpo).not.toMatch(/transition\s*:[^;]*transform/);
  });

  it('sem cor literal, sem opacity e sem height fixo (so tokens)', () => {
    expect(limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(limpo).not.toMatch(/(^|[;{\s])opacity\s*:/);
    // height fixo so nos pseudo-elementos decorativos (ponto do selo e icone do alerta)
    for (const a of achatadas.filter((x) => !x.seletor.includes('::before'))) expect(Object.keys(a.decls), a.seletor).not.toContain('height');
  });

  it('nenhum seletor migrado ficou FORA das regioes (ultimo composto + demais classes todas migradas)', () => {
    const fora = foraDasRegioes(css, regs).replace(/\/\*[\s\S]*?\*\//g, '');
    const infratores: string[] = [];
    const varrer = (rules: CssRule[]) => {
      for (const r of rules) {
        if (r.prelude.startsWith('@media') || r.prelude.startsWith('@supports')) {
          varrer(parseRules(r.body));
        } else if (!r.prelude.startsWith('@')) {
          for (const seletor of listaDeSeletores(r.prelude)) {
            const ultimas = classesDoSeletor(ultimoComposto(seletor));
            const todas = classesDoSeletor(seletor);
            if (ultimas.some((c) => MIGRADAS_F3B.has(c)) && todas.every((c) => MIGRADAS_F3B.has(c))) infratores.push(seletor);
          }
        }
      }
    };
    varrer(parseRules(fora));
    expect(infratores).toEqual([]);
  });
});

// ---------- receitas ----------
describe('F3b: selos', () => {
  it('pilula 24 / 0 10 / gap 6 / 12 700 com raio de pilula', () => {
    expect(de('.badge')).toMatchObject({
      display: 'inline-flex',
      'align-items': 'center',
      gap: '6px',
      'min-height': '24px',
      padding: '0 10px',
      'border-radius': 'var(--rf-radius-pill)',
      'font-size': '12px',
      'font-weight': '700',
    });
  });

  it('.badge puro tem o tom de sucesso (mantem o "Em dia"), igual ao --success', () => {
    const puro = de('.badge');
    const sucesso = de('.badge--success');
    expect(puro.background).toBe('var(--rf-tone-success-bg)');
    expect(puro.color).toBe('var(--rf-tone-success-fg)');
    expect({ background: puro.background, color: puro.color }).toEqual(sucesso);
  });

  it.each([
    ['.badge--muted', 'neutral'],
    ['.badge--warning', 'warning'],
    ['.badge--danger', 'danger'],
    ['.badge--info', 'info'],
  ])('%s usa o tom %s do mock', (seletor, tom) => {
    expect(de(seletor)).toEqual({ background: `var(--rf-tone-${tom}-bg)`, color: `var(--rf-tone-${tom}-fg)` });
  });

  it('.badge--dot::before: ponto de 6 px com o --rf-tone-*-solid de cada tom', () => {
    expect(de('.badge--dot::before')).toMatchObject({
      content: '""',
      width: '6px',
      height: '6px',
      'border-radius': 'var(--rf-radius-pill)',
      background: 'var(--rf-tone-success-solid)',
    });
    for (const tom of ['warning', 'danger', 'info']) {
      expect(de(`.badge--${tom}.badge--dot::before`).background).toBe(`var(--rf-tone-${tom}-solid)`);
    }
    expect(de('.badge--muted.badge--dot::before').background).toBe('var(--rf-tone-neutral-solid)');
  });

  it('no escuro o ponto acompanha o texto do tom (currentColor), como no board CotacoesEscuro', () => {
    expect(de(':root[data-theme="dark"] .badge--dot::before')).toEqual({ background: 'currentColor' });
  });
});

describe('F3b: chips', () => {
  it('.chip: 32 / 0 14 / 600 13, borda 1 --rf-border sobre --rf-surface', () => {
    expect(de('.chip')).toMatchObject({
      'min-height': '32px',
      padding: '0 14px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-pill)',
      background: 'var(--rf-surface)',
      color: 'var(--rf-ink)',
      'font-size': '13px',
      'font-weight': '600',
    });
  });

  it('.chip--active: --rf-action com --rf-on-action, 700, sem borda (tambem no hover)', () => {
    expect(de('.chip--active')).toMatchObject({ border: '0', background: 'var(--rf-action)', color: 'var(--rf-on-action)', 'font-weight': '700' });
    expect(de('.chip.chip--active:hover')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
  });

  it('.chip--static: 24 / 0 9 / mono 11 600 sobre o tom neutro com --rf-ink', () => {
    expect(de('.chip--static')).toMatchObject({
      'min-height': '24px',
      padding: '0 9px',
      background: 'var(--rf-tone-neutral-bg)',
      color: 'var(--rf-ink)',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '11px',
      'font-weight': '600',
    });
  });

  it('no escuro o chip estatico usa --rf-surface-alt (board CotacoesEscuro), tambem no hover', () => {
    expect(de(':root[data-theme="dark"] .chip--static')).toEqual({ background: 'var(--rf-surface-alt)' });
    expect(de(':root[data-theme="dark"] .chip--static:hover')).toEqual({ background: 'var(--rf-surface-alt)' });
  });

  it('.chip-row e .chip-list movidos sem mudanca', () => {
    expect(de('.chip-row')).toEqual({ display: 'flex', 'flex-wrap': 'wrap', gap: '6px' });
    expect(de('.chip-list')).toEqual({ display: 'flex', 'flex-wrap': 'wrap', gap: '0.4rem', 'margin-top': '0.6rem' });
  });
});

describe('F3b: alertas e banners', () => {
  const MASCARAS = {
    sucesso: 'm5 12 5 5 9-10',
    atencao: 'M12 3 2 20h20zM12 10v4M12 17h.01',
    critico: 'M12 8v5M12 16h.01',
    info: 'M12 11v5M12 8h.01',
  };

  it('.alert e .banner: bloco com padding-left 44, raio --rf-radius-alert, 14/600, 1,45, sem borda', () => {
    for (const seletor of ['.alert', '.banner']) {
      expect(de(seletor), seletor).toMatchObject({
        position: 'relative',
        display: 'block',
        padding: '12px 16px 12px 44px',
        border: '0',
        'border-radius': 'var(--rf-radius-alert)',
        'font-size': '14px',
        'font-weight': '600',
        'line-height': '1.45',
      });
    }
  });

  it('icone de 18 px em ::before (left 16, top 13) por mask-image com currentColor, sem cor literal', () => {
    for (const seletor of ['.alert::before', '.banner::before']) {
      expect(de(seletor), seletor).toMatchObject({
        content: '""',
        position: 'absolute',
        left: '16px',
        top: '13px',
        width: '18px',
        height: '18px',
        'background-color': 'currentColor',
      });
      expect(de(seletor)['mask-image'], seletor).toContain("stroke='currentColor'");
    }
  });

  it('cada tom tem o seu icone do design-spec (check, triangulo, circulo-alerta, circulo-i)', () => {
    expect(de('.alert--success::before')['mask-image']).toContain(MASCARAS.sucesso);
    expect(de('.banner--ok::before')['mask-image']).toContain(MASCARAS.sucesso);
    expect(de('.alert--warning::before')['mask-image']).toContain(MASCARAS.atencao);
    expect(de('.banner--warning::before')['mask-image']).toContain(MASCARAS.atencao);
    expect(de('.alert--error::before')['mask-image']).toContain(MASCARAS.critico);
    expect(de('.banner--error::before')['mask-image']).toContain(MASCARAS.critico);
    expect(de('.alert::before')['mask-image']).toContain(MASCARAS.info);
  });

  it('data URI sem ; # ou chaves (os parsers de token e de regra dependem disso)', () => {
    for (const a of achatadas.filter((x) => x.decls['mask-image'])) {
      const uri = a.decls['mask-image'] ?? '';
      expect(uri, a.seletor).not.toMatch(/[#{}]/);
    }
  });

  it.each([
    ['.alert--error', 'danger'],
    ['.alert--success', 'success'],
    ['.alert--warning', 'warning'],
    ['.alert--info', 'info'],
    ['.banner--ok', 'success'],
    ['.banner--warning', 'warning'],
    ['.banner--error', 'danger'],
  ])('%s usa o tom %s', (seletor, tom) => {
    expect(de(seletor)).toEqual({ background: `var(--rf-tone-${tom}-bg)`, color: `var(--rf-tone-${tom}-fg)` });
  });

  it('.alert e .banner sem tom = informacao (D-F3-04)', () => {
    expect(de('.alert')).toMatchObject({ background: 'var(--rf-tone-info-bg)', color: 'var(--rf-tone-info-fg)' });
    expect(de('.banner')).toMatchObject({ background: 'var(--rf-tone-info-bg)', color: 'var(--rf-tone-info-fg)' });
  });
});

describe('F3b: tabela', () => {
  it('.table: 14 px na cor --rf-ink; th/td com borda --rf-divider e alinhamento a esquerda', () => {
    expect(de('.table')).toMatchObject({ 'font-size': '14px', color: 'var(--rf-ink)', width: '100%', 'border-collapse': 'collapse' });
    expect(de('.table td')).toMatchObject({
      padding: '14px 16px',
      'border-bottom': '1px solid var(--rf-divider)',
      'vertical-align': 'middle',
      'text-align': 'left',
    });
  });

  it('.table th: 12 700 --rf-ink-soft sobre --rf-surface-alt, 12/16, nowrap e SEM caixa alta', () => {
    const th = de('.table th');
    expect(th).toMatchObject({
      padding: '12px 16px',
      'font-size': '12px',
      'font-weight': '700',
      color: 'var(--rf-ink-soft)',
      background: 'var(--rf-surface-alt)',
      'white-space': 'nowrap',
    });
    expect(Object.keys(th)).not.toContain('text-transform');
    expect(Object.keys(th)).not.toContain('letter-spacing');
  });

  it('no escuro a linha do cabecalho fecha com --rf-border (board CotacoesEscuro)', () => {
    expect(de(':root[data-theme="dark"] .table th')).toEqual({ 'border-bottom-color': 'var(--rf-border)' });
  });

  it('hover da linha em --rf-surface-alt', () => {
    expect(de('.table tr:hover td')).toEqual({ background: 'var(--rf-surface-alt)' });
  });

  it('.table--dense mantem o padding 8 8 na media <= 1200px, depois de .table th/td', () => {
    const dense = achatadas.filter((a) => a.seletor === '.table--dense th');
    expect(dense).toHaveLength(1);
    expect(dense[0]?.media).toBe('@media (max-width: 1200px)');
    expect(dense[0]?.decls.padding).toBe('8px 8px');
    const posDense = limpo.indexOf('.table--dense th');
    expect(posDense).toBeGreaterThan(limpo.indexOf('.table th {'));
  });

  it('acoes de linha: gap 2, nowrap nos filhos; wrapper, nowrap, truncate e col-status movidos', () => {
    expect(de('.row-actions')).toEqual({ display: 'flex', gap: '2px', 'flex-wrap': 'wrap' });
    expect(de('.row-actions--nowrap')).toEqual({ 'flex-wrap': 'nowrap' });
    expect(de('.row-actions > button')).toEqual({ 'white-space': 'nowrap' });
    expect(de('.row-actions > a')).toEqual({ 'white-space': 'nowrap' });
    expect(de('.table-wrapper')).toEqual({ 'overflow-x': 'auto', position: 'relative' });
    expect(de('.table .badge')).toEqual({ 'white-space': 'nowrap' });
    expect(de('.table .cell-nowrap')).toEqual({ 'white-space': 'nowrap' });
    expect(de('.table .col-status')).toEqual({ 'text-align': 'center' });
    expect(de('.table .cell-truncate')).toMatchObject({ 'max-width': '220px', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
  });

  it('a F3b nao estiliza botoes: nenhum seletor da regiao cita .ghost-button, .primary-button, .danger-button ou .link-button', () => {
    expect(limpo).not.toMatch(/\.(ghost|primary|danger|link)-button/);
  });
});

describe('F3b: classes novas (usadas no TSX sem regra ate aqui)', () => {
  it('badge--success, alert--warning, alert--info e badge--dot existem na regiao', () => {
    const seletores = achatadas.map((a) => a.seletor);
    expect(seletores).toContain('.badge--success');
    expect(seletores).toContain('.alert--warning');
    expect(seletores).toContain('.alert--info');
    expect(seletores).toContain('.badge--dot::before');
  });
});
