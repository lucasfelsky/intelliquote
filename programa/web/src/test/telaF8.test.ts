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
  type Rgb,
  type ThemeName,
} from './rfCss';

// F8 (Suite COMEX, mock v68; boards CotacaoComparacao, CotacaoComparacaoEscuro, ComparacaoEstados, ModaisDecisao, ModalOrdemCompra e
// ModalOrdemCompraDestinatarios): aba Comparacoes (cartao, criterios, ranking, "Qtd divergente" com popover, Fora do ranking, by-pass e demais
// estados), os 3 modais da aba (Responder, Definir vencedora, Avaliar e concluir) e o modal Enviar Ordem de Compra. CSS na regiao `tela F8` do
// globals.css (depois da `tela F7`). Esta guarda cobre: a regiao (posicao, prefixos donos, a unica excecao `:has`, classes de contexto, at-rules,
// sem cor literal), que nada dos donos sobrou fora dela, as receitas dos boards (valores exatos), o movimento, os tokens, o contraste nos
// 2 temas e que os 3 TSX da fase nao tem estilo inline (fora os 2 dinamicos), token, cor literal, glifo nem SVG local e que toda classe que
// eles usam tem regra.

const NOME = 'tela F8';
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

const ehAninhavel = (prelude: string) => /^@(media|supports|container)\b/.test(prelude);

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
const atRule = (nome: string) => parseRules(topo.find((r) => r.prelude === nome)?.body ?? '');

// ---------- listas da fase ----------
// Prefixos DONOS: todo seletor da regiao (cada item da lista, sozinho) tem ao menos 1 classe com um destes prefixos.
const PREFIXOS_DONOS = ['cmp-', 'info-chip', 'info-popover'] as const;
const ehDono = (classe: string) => PREFIXOS_DONOS.some((p) => classe.startsWith(p));
// Excecao unica (D-F8-01): o cartao das abas (F6) fica transparente SO na aba Comparacoes.
const EXCECAO_HAS = '.cotacao-detalhe__painel:has(> .cmp-tab)';
const EXCECAO_PROPS = ['background', 'border', 'box-shadow', 'padding'];
// Classes de CONTEXTO (14.3): so aparecem junto de um dono.
const CONTEXTO = new Set([
  'page-header',
  'card',
  'table',
  'table--dense',
  'table-wrapper',
  'row-actions',
  'row-actions--nowrap',
  'cell-nowrap',
  'badge',
  'badge--success',
  'badge--muted',
  'badge--warning',
  'badge--danger',
  'badge--info',
  'badge--dot',
  'chip',
  'chip--static',
  'chip--active',
  'alert',
  'alert--success',
  'alert--warning',
  'alert--error',
  'alert--info',
  'empty-state',
  'empty-state__icon',
  'empty-state__title',
  'empty-state__text',
  'empty-state--erro',
  'skeleton',
  'spinner',
  'btn-spinner',
  'ghost-button',
  'ghost-button--sm',
  'primary-button',
  'danger-button',
  'link-button',
  'icon-button',
  'input',
  'select',
  'textarea',
  'field-label',
  'field-hint',
  'checkbox-field',
  'form-grid',
  'modal-actions',
  'preview-frame',
  'text-sm',
  'sr-only',
  'pagination',
  'star-rating',
]);

describe('F8: regiao `tela F8`', () => {
  it('existe uma vez, logo depois da regiao `tela F7` (so espaco entre as duas), antes da `tela F9`, e tem regras', () => {
    expect(rawLf.split(`/* >>> ${NOME} (Suite COMEX) >>> */`)).toHaveLength(2);
    expect(rawLf.split(`/* <<< ${NOME} <<< */`)).toHaveLength(2);
    const f7 = regs.find((r) => r.nome === 'tela F7');
    expect(f7).toBeDefined();
    expect(regiao).toBeDefined();
    expect(rawLf.slice(f7?.fim ?? 0, regiao?.inicio ?? 0).trim()).toBe('');
    expect(regs.findIndex((r) => r.nome === NOME)).toBe(regs.findIndex((r) => r.nome === 'tela F7') + 1);
    expect(planas.length).toBeGreaterThan(150);
  });

  it('a regiao vem DEPOIS das regioes F3 e da compat (vence as regras de componente de mesma especificidade pela ordem)', () => {
    const compat = regs.find((r) => r.nome === 'compat Forecast F3');
    expect((compat?.fim ?? Infinity) <= (regiao?.inicio ?? 0)).toBe(true);
  });

  it('a regiao nao declara token (--*), consome var(--rf-* (e var(--paper) na previa), sem cor literal, !important nem opacity de estado', () => {
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    expect(regiao?.limpo).toContain('var(--rf-');
    expect(regiao?.limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(regiao?.limpo).not.toContain('!important');
    const usados = [...(regiao?.limpo ?? '').matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '');
    expect(usados.filter((t) => !t.startsWith('--rf-') && t !== '--paper')).toEqual([]);
  });

  it('at-rules permitidas: os 2 @container cmp, 640, pointer: coarse, reduced-motion e os 3 @keyframes rf-cmp-*; sem @media print; sem aninhamento', () => {
    const atRules = topo.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    const permitidas = [
      '@container cmp (max-width: 999px)',
      '@container cmp (max-width: 720px)',
      '@media (max-width: 640px)',
      '@media (pointer: coarse)',
      '@media (prefers-reduced-motion: reduce)',
      '@keyframes rf-cmp-pulso',
      '@keyframes rf-cmp-vencedora',
      '@keyframes rf-cmp-pop',
    ];
    expect(atRules.filter((a) => !permitidas.includes(a))).toEqual([]);
    expect(new Set(atRules).size).toBe(atRules.length);
    for (const a of permitidas) expect(atRules, a).toContain(a);
    expect(regiao?.limpo).not.toContain('@media print');
    for (const m of topo.filter((r) => r.prelude.startsWith('@media') || r.prelude.startsWith('@container'))) {
      for (const inner of parseRules(m.body)) expect(inner.prelude.startsWith('@'), inner.prelude).toBe(false);
    }
  });

  it('os keyframes usam so tokens (nao ha cor literal): o fim transparente e `transparent`', () => {
    for (const nome of ['rf-cmp-pulso', 'rf-cmp-vencedora']) {
      const corpo = topo.find((r) => r.prelude === `@keyframes ${nome}`)?.body ?? '';
      expect(corpo, nome).toContain('var(--rf-');
      expect(corpo, nome).toContain('transparent');
    }
    expect(topo.find((r) => r.prelude === '@keyframes rf-cmp-pop')?.body).toContain('translateY(-4px)');
  });
});

describe('F8: prefixos donos, excecao `:has` e classes de contexto', () => {
  const seletores = planas.flatMap((r) => listaDeSeletores(r.prelude));
  const semExcecao = seletores.filter((s) => s !== EXCECAO_HAS);

  it('todo seletor tem ao menos 1 classe com prefixo dono (cmp-, info-chip, info-popover); a unica citacao de dono alheio e o `:has` do cartao das abas', () => {
    expect(seletores.length).toBeGreaterThan(150);
    expect(semExcecao.filter((s) => !classesDoSeletor(s).some(ehDono))).toEqual([]);
    expect(seletores.filter((s) => s.includes('cotacao-detalhe'))).toEqual([EXCECAO_HAS]);
  });

  it('a excecao `:has` (D-F8-01) e literal e so tem padding, border, background e box-shadow', () => {
    const regras = planas.filter((r) => listaDeSeletores(r.prelude).includes(EXCECAO_HAS));
    expect(regras).toHaveLength(1);
    expect(listaDeSeletores(regras[0]?.prelude ?? '')).toEqual([EXCECAO_HAS]);
    expect(Object.keys(naRegiao(EXCECAO_HAS)).sort()).toEqual(EXCECAO_PROPS);
    expect(naRegiao(EXCECAO_HAS)).toEqual({ padding: '0', border: '0', background: 'transparent', 'box-shadow': 'none' });
  });

  it('as demais classes de cada seletor sao de CONTEXTO (lista fixa de 14.3); donos da F6, F7 e F9 nunca aparecem', () => {
    const alheias = [...new Set(semExcecao.flatMap(classesDoSeletor))].filter((c) => !ehDono(c) && !CONTEXTO.has(c));
    expect(alheias).toEqual([]);
    for (const s of seletores) {
      expect(s, s).not.toMatch(/respostas-tab|resposta-|credit-support|price-history|supplier-notes|sol-|solicitac|anexos-|vincular-catalogo|itens-tab|cotacao-envio|cotacao-links|cotacao-resumo|cotacao-item-form/);
    }
  });

  it('nenhum seletor e so da base da pagina nem usa h1-h3 como elemento; `.cmp-tab .supplier-notes`, `.cmp-tab .table` e `.badge` sem dono ficam proibidos', () => {
    for (const s of seletores) {
      expect(/(^|[\s>+~])h[1-3]\b/.test(s.replace(/\[[^\]]*\]|"[^"]*"/g, '')), s).toBe(false);
      expect(s, s).not.toMatch(/\.cmp-tab \.(table|supplier-notes)/);
    }
    expect(seletores).not.toContain('.page');
    expect(seletores).not.toContain('.page-header');
    expect(seletores).not.toContain('.badge');
    expect(seletores).not.toContain('.alert');
  });

  it('as classes compartilhadas (.badge, .alert, .chip--static, .input, .textarea, .preview-frame...) so entram com um dono no mesmo seletor', () => {
    for (const s of semExcecao) {
      const classes = classesDoSeletor(s);
      expect(classes.some(ehDono), s).toBe(true);
    }
  });
});

describe('F8: nada dos donos sobrou fora das regioes', () => {
  const foraLimpo = stripComments(fora);
  const foraSeletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));

  it('nenhuma regra .cmp-*, .info-chip* ou .info-popover* fora da regiao (o CSS antigo foi apagado)', () => {
    expect(foraSeletores.filter((s) => classesDoSeletor(s).some(ehDono))).toEqual([]);
    expect(foraLimpo).not.toContain('cmp-winner-pulse');
    expect(foraLimpo).not.toContain('.info-popover__list');
  });

  it('a F8 nao apaga regra compartilhada: seguem fora das regioes .preview-frame, .form-grid, .text-sm e .sol-items-list (.muted e .weight-grid, sem uso, sairam na TROCA-2)', () => {
    for (const s of ['.preview-frame', '.form-grid', '.text-sm', '.sol-items-list']) {
      expect(foraSeletores, s).toContain(s);
    }
  });

  it('os 7 tokens antigos --winner-* e --cmp-criteria-bg nao existem mais nos 2 blocos (sairam na TROCA-2, D-F8-12)', () => {
    for (const t of ['--winner-bg', '--winner-border', '--winner-track', '--winner-glow', '--winner-glow-soft', '--winner-glow-none', '--cmp-criteria-bg']) {
      expect(lightTokens[t], t).toBeUndefined();
      expect(darkTokens[t], t).toBeUndefined();
    }
    expect(regiao?.limpo).not.toMatch(/--winner-|--cmp-criteria-bg|--scorebar-fill/);
  });
});

describe('F8: receitas dos boards (valores exatos)', () => {
  it('cartao: 22 de raio, 1 px --rf-border, sombra de repouso (sem sombra no escuro); cabecalho 22/24/18 com divisoria; eyebrow mono 11/600 a 1,5 px em caixa alta; titulo Sora 20/700', () => {
    expect(naRegiao('.cmp-card')).toMatchObject({
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-panel)',
      background: 'var(--rf-surface)',
      'box-shadow': 'var(--rf-shadow-rest)',
    });
    expect(naRegiao(':root[data-theme="dark"] .cmp-card')).toEqual({ 'box-shadow': 'none' });
    expect(naRegiao('.cmp-head')).toMatchObject({
      display: 'flex',
      'flex-wrap': 'wrap',
      'justify-content': 'space-between',
      'align-items': 'flex-start',
      gap: '20px',
      padding: '22px 24px 18px',
      'border-bottom': '1px solid var(--rf-divider)',
    });
    expect(naRegiao('.cmp-head__info')).toMatchObject({ gap: '6px', 'flex-direction': 'column' });
    expect(naRegiao('.cmp-eyebrow')).toMatchObject({
      color: 'var(--rf-primary-700)',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '11px',
      'font-weight': '600',
      'letter-spacing': '1.5px',
      'text-transform': 'uppercase',
    });
    expect(naRegiao('.cmp-title')).toMatchObject({
      'font-family': 'var(--rf-font-display)',
      'font-size': '20px',
      'font-weight': '700',
      'letter-spacing': '-0.01em',
      'line-height': '1.25',
    });
  });

  it('selo "ao vivo": 32 de altura, pilula em tom de sucesso, 12/700; ponto de 8 px menta que pulsa em 1,8 s; numero em mono', () => {
    expect(naRegiao('.cmp-live')).toMatchObject({
      height: '32px',
      padding: '0 14px',
      'border-radius': 'var(--rf-radius-pill)',
      background: 'var(--rf-tone-success-bg)',
      color: 'var(--rf-tone-success-fg)',
      'font-size': '12px',
      'font-weight': '700',
    });
    expect(naRegiao('.cmp-live__dot')).toMatchObject({ width: '8px', height: '8px', background: 'var(--rf-primary)', animation: 'rf-cmp-pulso 1.8s var(--rf-ease-out) infinite' });
    expect(naRegiao('.cmp-live__num')).toEqual({ 'font-family': 'var(--rf-font-mono)' });
    expect(naRegiao('.cmp-live__texto')).toEqual({ display: 'inline-flex', gap: '8px' });
    expect(declaracoes(semMedia, ':root[data-theme="dark"] .cmp-head')).toEqual({ 'border-bottom-color': 'var(--rf-border)' });
    expect(declaracoes(semMedia, ':root[data-theme="dark"] .cmp-criteria')).toEqual({ 'border-bottom-color': 'var(--rf-border)' });
  });

  it('criterios: faixa em --rf-cmp-criterio-faixa 18/24 com divisoria; chave em pilula de 36 (0 16, 1 px --rf-cmp-criterio-borda); ligada em --rf-action; foco com o anel duplo; transicao de 0,2 s', () => {
    expect(naRegiao('.cmp-criteria')).toMatchObject({ padding: '18px 24px', gap: '12px', background: 'var(--rf-cmp-criterio-faixa)', 'border-bottom': '1px solid var(--rf-divider)' });
    expect(naRegiao('.cmp-criteria__label')).toMatchObject({ 'font-size': '14px', 'font-weight': '700' });
    expect(naRegiao('.cmp-criteria__hint')).toMatchObject({ 'font-size': '13px', color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.cmp-criteria__toggles')).toMatchObject({ gap: '8px', 'flex-wrap': 'wrap' });
    expect(naRegiao('.cmp-criteria__note')).toMatchObject({ 'font-size': '12px', 'line-height': '1.5', color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.cmp-toggle')).toMatchObject({
      height: '36px',
      padding: '0 16px',
      border: '1px solid var(--rf-cmp-criterio-borda)',
      'border-radius': 'var(--rf-radius-pill)',
      background: 'var(--rf-surface)',
      color: 'var(--rf-ink)',
      'font-size': '13px',
      'font-weight': '700',
      gap: '7px',
    });
    expect(naRegiao('.cmp-toggle').transition).toContain('var(--rf-dur-base)');
    expect(naRegiao('.cmp-toggle--active')).toEqual({ 'border-color': 'var(--rf-action)', background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
    expect(naRegiao('.cmp-toggle:focus-visible')['box-shadow']).toBe('0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-action)');
    expect(naRegiao(':root[data-theme="dark"] .cmp-toggle:not(.cmp-toggle--active)')).toEqual({ background: 'transparent' });
  });

  it('corpo: coluna de gap 14 e padding 20/24/24; contêiner `cmp` para os layouts B e C; alerta de alcada com o icone ao lado do texto', () => {
    expect(naRegiao('.cmp-body')).toMatchObject({ gap: '14px', padding: '20px 24px 24px', container: 'cmp / inline-size' });
    expect(naRegiao('.cmp-alcada')).toMatchObject({ display: 'flex', 'align-items': 'flex-start', gap: '10px', padding: '12px 16px', 'border-radius': 'var(--rf-radius-alert)', background: 'var(--rf-tone-warning-bg)', color: 'var(--rf-tone-warning-fg)', 'line-height': '1.5' });
  });

  it('grade do layout A: 8 colunas `32px minmax(0, 1fr) 108px 60px 68px 68px 100px 212px` com gap 10; cabecalho 12/700 com padding 0 21,5 (20 + 1,5 da borda) e o total a direita', () => {
    const colunasA = '32px minmax(0, 1fr) 108px 60px 68px 68px 100px 212px';
    expect(naRegiao('.cmp-rankgrid')).toMatchObject({ display: 'grid', 'grid-template-columns': colunasA, gap: '10px', 'align-items': 'center' });
    expect(colunasA.split(' ').filter((c) => /px$/.test(c) || c.startsWith('minmax'))).toHaveLength(8);
    expect(naRegiao('.cmp-rankgrid--head')).toMatchObject({ padding: '0 21.5px', 'font-size': '12px', 'font-weight': '700', color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.cmp-rankgrid--head > :nth-child(3)')).toEqual({ 'text-align': 'right' });
  });

  it('linha: padding 12/20, raio 14 e borda de 1,5 px; vencedora em --rf-tone-success-bg com --rf-vencedora-borda e o pulso rf-cmp-vencedora de 0,6 s; transicao de cor de 0,32 s (o FLIP e do JS)', () => {
    expect(naRegiao('.cmp-row')).toMatchObject({ padding: '12px 20px', border: '1.5px solid var(--rf-border)', 'border-radius': 'var(--rf-radius-alert)', background: 'var(--rf-surface)' });
    expect(naRegiao('.cmp-row').transition).toBe('background-color var(--rf-dur-fill) var(--rf-ease-out), border-color var(--rf-dur-fill) var(--rf-ease-out)');
    expect(naRegiao('.cmp-row--winner')).toEqual({
      'border-color': 'var(--rf-vencedora-borda)',
      background: 'var(--rf-tone-success-bg)',
      animation: 'rf-cmp-vencedora 0.6s var(--rf-ease-out)',
    });
    expect(naRegiao(':root[data-theme="dark"] .cmp-row:not(.cmp-row--winner)')).toEqual({ background: 'var(--rf-surface-alt)' });
    expect(naRegiao('.cmp-rows')).toMatchObject({ gap: '10px', 'flex-direction': 'column' });
  });

  it('posicao: 32 px mono 13/700 (vencedora em --rf-action; as demais em --rf-tone-neutral-bg); selos, nome 15/700 e numeros do board', () => {
    expect(naRegiao('.cmp-rank')).toMatchObject({
      width: '32px',
      height: '32px',
      'border-radius': 'var(--rf-radius-pill)',
      background: 'var(--rf-tone-neutral-bg)',
      color: 'var(--rf-ink)',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '13px',
      'font-weight': '700',
    });
    expect(naRegiao('.cmp-rank--winner')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
    expect(naRegiao('.cmp-row__name')).toMatchObject({ 'font-size': '15px', 'font-weight': '700', 'overflow-wrap': 'anywhere' });
    expect(naRegiao('.cmp-row__badges')).toMatchObject({ gap: '6px', 'flex-wrap': 'wrap' });
    expect(naRegiao('.cmp-row__badges:empty')).toEqual({ display: 'none' });
    expect(naRegiao('.cmp-winner-badge')).toEqual({ 'box-shadow': 'inset 0 0 0 1px var(--rf-vencedora-selo-anel)' });
    expect(naRegiao('.cmp-row__contact')).toMatchObject({ 'font-size': '12px', color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.cmp-row__contact-name')).toEqual({ 'white-space': 'nowrap' });
    expect(naRegiao('.cmp-row__email')).toEqual({ 'overflow-wrap': 'anywhere' });
    expect(naRegiao('.cmp-dg')).toMatchObject({ 'min-height': '22px', padding: '0 8px', 'font-family': 'var(--rf-font-mono)', 'font-size': '11px', 'align-self': 'flex-start' });
    expect(naRegiao('.cmp-row__price')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '14px', 'font-weight': '600', 'text-align': 'right', 'white-space': 'nowrap', 'font-variant-numeric': 'tabular-nums' });
    expect(naRegiao('.cmp-row__payment')).toMatchObject({ 'font-size': '13px' });
    expect(naRegiao('.cmp-row__leadtime')).toMatchObject({ 'font-size': '14px', 'font-weight': '700' });
  });

  it('score: rotulo 12 + valor mono 13/700; trilho de 6 px (--rf-score-trilho), preenchimento --rf-score-outros (vencedora --rf-primary) com transicao de largura de 320 ms', () => {
    expect(naRegiao('.cmp-scorebar__row')).toMatchObject({ 'font-size': '12px', color: 'var(--rf-ink-soft)', 'justify-content': 'space-between' });
    expect(naRegiao('.cmp-scorebar__row strong')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '13px', 'font-weight': '700', color: 'var(--rf-ink)' });
    expect(naRegiao('.cmp-scorebar__track')).toMatchObject({ height: '6px', 'border-radius': 'var(--rf-radius-pill)', background: 'var(--rf-score-trilho)' });
    expect(naRegiao('.cmp-scorebar__fill')).toMatchObject({ background: 'var(--rf-score-outros)' });
    expect(naRegiao('.cmp-scorebar__fill').transition).toContain('width var(--rf-dur-fill)');
    expect(naRegiao('.cmp-row--winner .cmp-scorebar__fill')).toEqual({ background: 'var(--rf-primary)' });
  });

  it('acoes: coluna de gap 8; botoes pequenos de 36 (raio 10, 13 px); "Enviar Ordem de Compra" discreto 12/500 sublinhado; sem e-mail 12 em --rf-ink-soft', () => {
    expect(naRegiao('.cmp-row__actions')).toMatchObject({ 'flex-direction': 'column', gap: '8px', 'justify-content': 'center' });
    expect(naRegiao('.cmp-row__secondary-actions')).toMatchObject({ 'flex-direction': 'column', 'align-items': 'flex-end' });
    expect(naRegiao('.cmp-btn--sm')).toMatchObject({ 'min-height': '36px', padding: '0 12px', 'border-radius': 'var(--rf-radius-control)', 'font-size': '13px' });
    expect(naRegiao('.cmp-btn--subtle')).toMatchObject({ padding: '4px 6px', color: 'var(--rf-ink-soft)', 'font-size': '12px', 'font-weight': '500', 'text-decoration': 'underline', 'text-underline-offset': '2px' });
    expect(naRegiao('.cmp-row__no-email')).toMatchObject({ 'font-size': '12px', color: 'var(--rf-ink-soft)' });
  });

  it('chip "Qtd divergente": 24 de altura, 0 10, pilula em tom de atencao com o anel --rf-divergente-anel, 12/700; popover de 300 (no maximo a viewport menos 16), 12/14, raio 12, --rf-popover-aviso-borda e rf-cmp-pop de 0,2 s', () => {
    expect(naRegiao('.info-chip')).toMatchObject({ 'min-height': '24px', padding: '0 10px', 'border-radius': 'var(--rf-radius-pill)', 'font-size': '12px', 'font-weight': '700', gap: '6px' });
    expect(naRegiao('.info-chip--warning')).toEqual({
      background: 'var(--rf-tone-warning-bg)',
      color: 'var(--rf-tone-warning-fg)',
      'box-shadow': 'inset 0 0 0 1px var(--rf-divergente-anel)',
    });
    expect(naRegiao('.info-chip:focus-visible')['box-shadow']).toBe('0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-action)');
    expect(naRegiao('.info-popover')).toMatchObject({
      position: 'fixed',
      width: '300px',
      'max-width': 'calc(100vw - 16px)',
      padding: '12px 14px',
      'border-radius': 'var(--rf-radius-button)',
      border: '1px solid var(--rf-popover-aviso-borda)',
      background: 'var(--rf-surface)',
      'box-shadow': 'var(--rf-shadow-modal)',
      animation: 'rf-cmp-pop var(--rf-dur-base) var(--rf-ease-out) both',
    });
    expect(naRegiao('.cmp-popover__titulo')).toMatchObject({ color: 'var(--rf-tone-warning-fg)', gap: '6px' });
    expect(naRegiao('.cmp-popover__nota')).toMatchObject({ 'font-size': '12px', color: 'var(--rf-ink-soft)' });
  });

  it('Fora do ranking: itens em --rf-surface-alt (raio 12, 10/14, 13 px), nome em --rf-ink, acoes em linha; a regra de quebra de "mesmo assim" fica', () => {
    expect(naRegiao('.cmp-excluded__titulo')).toMatchObject({ 'font-size': '14px', 'font-weight': '700', margin: '0' });
    expect(naRegiao('.cmp-excluded__item')).toMatchObject({
      padding: '10px 14px',
      border: '1px solid var(--rf-divider)',
      'border-radius': 'var(--rf-radius-button)',
      background: 'var(--rf-surface-alt)',
      'font-size': '13px',
      'justify-content': 'space-between',
      gap: '4px 12px',
    });
    expect(naRegiao('.cmp-excluded__nome')).toEqual({ color: 'var(--rf-ink)' });
    expect(naRegiao('.cmp-excluded .cmp-btn--link')).toMatchObject({ padding: '6px', 'white-space': 'normal', 'text-align': 'left' });
  });

  it('estados (12c): by-pass com borda --rf-aviso-borda-suave (raio 14, 16/20, gap 16) e icone 40x40 em --rf-aviso-icone-bg; vazio 44/28/48 com icone 64; carregando e erro de 76 (raio 18)', () => {
    expect(naRegiao('.cmp-bypass-alert')).toMatchObject({
      gap: '16px',
      padding: '16px 20px',
      border: '1px solid var(--rf-aviso-borda-suave)',
      'border-radius': 'var(--rf-radius-alert)',
      background: 'var(--rf-tone-warning-bg)',
    });
    expect(naRegiao('.cmp-bypass-alert__icon')).toMatchObject({ width: '40px', height: '40px', 'border-radius': 'var(--rf-radius-button)', background: 'var(--rf-aviso-icone-bg)', color: 'var(--rf-tone-warning-fg)' });
    expect(naRegiao('.cmp-bypass-alert__text strong')).toMatchObject({ 'font-size': '15px' });
    expect(naRegiao('.cmp-bypass-supplier')).toMatchObject({ gap: '20px', padding: '16px 20px', border: '1px solid var(--rf-border)', 'border-radius': 'var(--rf-radius-alert)' });
    expect(naRegiao('.cmp-bypass-supplier__avatar')).toMatchObject({ width: '44px', height: '44px', 'border-radius': 'var(--rf-radius-button)', background: 'var(--rf-action)', color: 'var(--rf-on-action)', 'font-size': '16px' });
    expect(naRegiao('.cmp-bypass-supplier__stats')).toMatchObject({ gap: '28px' });
    expect(naRegiao('.cmp-bypass-supplier__stat strong')).toMatchObject({ 'font-size': '18px', 'font-weight': '700' });
    expect(naRegiao('.cmp-bypass-supplier__valor')).toMatchObject({ 'font-family': 'var(--rf-font-mono)' });
    expect(naRegiao('.cmp-empty')).toMatchObject({ padding: '44px 28px 48px', gap: '14px', 'text-align': 'center' });
    expect(naRegiao('.cmp-empty__icon')).toMatchObject({ width: '64px', height: '64px', 'border-radius': 'var(--rf-radius-card-lg)', background: 'var(--rf-surface-alt)', color: 'var(--rf-primary-700)' });
    expect(naRegiao('.cmp-carregando')).toMatchObject({ 'min-height': '76px', padding: '16px 24px', 'border-radius': 'var(--rf-radius-card-lg)', 'font-size': '14px', 'font-weight': '600' });
    expect(naRegiao('.cmp-carregando__spinner')).toMatchObject({ width: '14px', height: '14px' });
    expect(naRegiao('.cmp-erro')).toMatchObject({ 'min-height': '76px', padding: '14px 16px 14px 24px', 'border-radius': 'var(--rf-radius-card-lg)' });
    expect(naRegiao('.cmp-erro__corpo > svg')).toEqual({ flex: 'none', color: 'var(--rf-danger)' });
  });

  it('modais (12e): codigo em mono 600; campos em coluna de gap 6; Responder gap 14; previa em papel de 406 (raio 14); Avaliar com o grupo em --rf-surface-alt (14/16, raio 14) e grade 96 + 1fr', () => {
    expect(naRegiao('.cmp-codigo')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-weight': '600', color: 'var(--rf-ink)' });
    expect(naRegiao('.cmp-campo')).toMatchObject({ 'flex-direction': 'column', gap: '6px' });
    expect(naRegiao('.cmp-campo .field-label')).toEqual({ margin: '0' });
    expect(naRegiao('.cmp-resposta')).toMatchObject({ gap: '14px', 'flex-direction': 'column' });
    expect(naRegiao('.cmp-resposta__previa-titulo')).toMatchObject({ 'font-size': '15px', 'font-weight': '700' });
    expect(naRegiao('.cmp-resposta__linha')).toMatchObject({ 'font-size': '13px', color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.cmp-resposta__previa.preview-frame')).toMatchObject({
      height: '406px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-alert)',
      background: 'var(--paper)',
      'box-shadow': 'none',
    });
    expect(naRegiao('.cmp-vencedora')).toMatchObject({ gap: '16px' });
    expect(naRegiao('.cmp-avaliar')).toMatchObject({ gap: '14px' });
    expect(naRegiao('.cmp-review')).toMatchObject({ padding: '14px 16px', gap: '10px', 'border-radius': 'var(--rf-radius-alert)', background: 'var(--rf-surface-alt)' });
    expect(naRegiao('.cmp-review__grid')).toMatchObject({ display: 'grid', 'grid-template-columns': '96px minmax(0, 1fr)', gap: '8px 12px' });
    expect(naRegiao('.cmp-review .cmp-review__comment')).toMatchObject({ padding: '10px 14px', 'font-size': '13px', 'line-height': '1.5' });
    expect(naRegiao('.cmp-review__warn')).toMatchObject({ 'font-size': '12px', 'font-weight': '600', color: 'var(--rf-tone-danger-fg)' });
    expect(naRegiao('.cmp-review__notify')).toMatchObject({ gap: '10px', 'font-size': '14px', 'font-weight': '600' });
    expect(naRegiao('.cmp-review__notify input')).toMatchObject({ width: '18px', height: '18px', 'accent-color': 'var(--rf-action)' });
  });

  it('Ordem de Compra (12d e 12f): aviso 10/14 raio 12 (nao vencedora com borda --rf-aviso-borda-suave); destinatarios em --rf-surface-alt 14/16 raio 16 com borda de 1 px (12f); arquivo em bloco de 12/14 tracejado (selecionado 14/16 em sucesso); contador mono 12', () => {
    expect(naRegiao('.cmp-po')).toMatchObject({ gap: '16px', 'flex-direction': 'column' });
    expect(naRegiao('.cmp-po-aviso')).toMatchObject({ padding: '10px 14px', 'border-radius': 'var(--rf-radius-button)', 'font-size': '13px', gap: '10px' });
    expect(naRegiao('.cmp-po-aviso--atencao')).toEqual({ background: 'var(--rf-tone-warning-bg)', color: 'var(--rf-tone-warning-fg)' });
    expect(naRegiao('.cmp-po-aviso--info')).toEqual({ background: 'var(--rf-tone-info-bg)', color: 'var(--rf-tone-info-fg)' });
    expect(naRegiao('.cmp-po-aviso--erro')).toEqual({ background: 'var(--rf-tone-danger-bg)', color: 'var(--rf-tone-danger-fg)' });
    expect(naRegiao('.cmp-po-nonwinner-notice')).toEqual({ border: '1px solid var(--rf-aviso-borda-suave)' });
    expect(naRegiao('.cmp-po__destinatarios:empty')).toEqual({ display: 'none' });
    expect(naRegiao('.cmp-po__destinatarios-caixa')).toMatchObject({ gap: '6px', padding: '14px 16px', border: '1px solid var(--rf-divider)', 'border-radius': 'var(--rf-radius-card)', background: 'var(--rf-surface-alt)', 'font-size': '13px', 'line-height': '1.5' });
    expect(naRegiao('.cmp-po__linha--suave')).toEqual({ color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.cmp-po__arquivo')).toMatchObject({ gap: '12px', padding: '12px 14px', border: '1.5px dashed var(--rf-input-border)', 'border-radius': 'var(--rf-radius-button)', background: 'var(--rf-surface-alt)' });
    expect(naRegiao('.cmp-po__arquivo--ok')).toMatchObject({ gap: '14px', padding: '14px 16px', border: '1.5px solid var(--rf-vencedora-selo-anel)', background: 'var(--rf-tone-success-bg)' });
    expect(naRegiao('.cmp-po__arquivo-botao')).toMatchObject({ height: '36px', padding: '0 12px', border: '1.5px solid var(--rf-ghost-escuro-borda)', 'border-radius': 'var(--rf-radius-control)', 'font-size': '13px' });
    expect(naRegiao('.cmp-po__arquivo-input')).toMatchObject({ position: 'absolute', width: '1px', height: '1px', opacity: '0' });
    expect(naRegiao('.cmp-po__contador')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '12px', 'align-self': 'flex-end' });
    expect(naRegiao('.cmp-po__contador--excedido')).toEqual({ color: 'var(--rf-tone-danger-fg)' });
    expect(naRegiao('.cmp-po__dica')).toMatchObject({ 'font-size': '12px', color: 'var(--rf-ink-soft)' });
  });

  it('escuro (board 12b): posicao e incoterm das demais usam o tom neutro, linha das demais em --rf-surface-alt, chave desligada transparente', () => {
    expect(naRegiao(':root[data-theme="dark"] .cmp-rank:not(.cmp-rank--winner)')).toEqual({ color: 'var(--rf-tone-neutral-fg)' });
    expect(naRegiao(':root[data-theme="dark"] .cmp-row .chip--static')).toEqual({ background: 'var(--rf-tone-neutral-bg)', color: 'var(--rf-tone-neutral-fg)' });
  });

  it('layouts B (<= 999) e C (<= 720) do @container cmp: 7 colunas com as acoes na 2a linha; 1 coluna com o cartao empilhado', () => {
    const b = atRule('@container cmp (max-width: 999px)');
    expect(declaracoes(b, '.cmp-rankgrid')).toEqual({ 'grid-template-columns': '32px minmax(0, 1fr) 108px 60px 68px 68px 100px' });
    expect(declaracoes(b, '.cmp-rankgrid--head > :last-child')).toEqual({ display: 'none' });
    expect(declaracoes(b, '.cmp-row__actions')).toMatchObject({ 'grid-column': '2 / -1', 'flex-direction': 'row', 'justify-content': 'flex-end' });
    const c = atRule('@container cmp (max-width: 720px)');
    expect(declaracoes(c, '.cmp-rankgrid')).toEqual({ 'grid-template-columns': '1fr', gap: '8px' });
    expect(declaracoes(c, '.cmp-rankgrid--head')).toEqual({ display: 'none' });
    expect(declaracoes(c, '.cmp-row')).toMatchObject({ display: 'flex', 'flex-direction': 'column' });
    expect(declaracoes(c, '.cmp-row__price')).toEqual({ 'text-align': 'left' });
  });

  it('celular: cartao com 16 de respiro ate 640; pointer: coarse leva chaves, acoes e "Definir como vencedora" a 44 e da ao chip de 24 uma area de 44', () => {
    const m = atRule('@media (max-width: 640px)');
    expect(declaracoes(m, '.cmp-body')).toEqual({ padding: '16px' });
    const coarse = atRule('@media (pointer: coarse)');
    const alvos44 = coarse.filter((r) => /min-height:\s*44px/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    for (const s of ['.cmp-toggle', '.cmp-btn--sm', '.cmp-btn--link', '.cmp-review__notify']) expect(alvos44, s).toContain(s);
    expect(declaracoes(coarse, '.info-chip::after')).toEqual({ content: '""', position: 'absolute', top: '-10px', right: '-6px', bottom: '-10px', left: '-6px' });
    expect(naRegiao('.info-chip').position).toBe('relative');
  });
});

describe('F8: movimento (D-F8-05)', () => {
  const reduzido = atRule('@media (prefers-reduced-motion: reduce)');
  const seletoresReduzidos = new Set(reduzido.flatMap((r) => listaDeSeletores(r.prelude)));

  it('toda animation/transition da regiao tem contrapartida no bloco reduced-motion da MESMA regiao', () => {
    const comMovimento = semMedia.filter((r) => /(^|[;{\s])(animation|transition)\s*:/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    expect(comMovimento.length).toBeGreaterThanOrEqual(8);
    expect(comMovimento.filter((s) => !seletoresReduzidos.has(s))).toEqual([]);
  });

  it('sob reduced-motion: transicoes e animacoes saem (none), o spinner so desacelera; nenhum !important (o FLIP ja se desliga no JS)', () => {
    for (const s of ['.cmp-row', '.cmp-row--winner']) expect(declaracoes(reduzido, s)).toEqual({ transition: 'none', animation: 'none' });
    for (const s of ['.cmp-toggle', '.cmp-rank', '.cmp-scorebar__fill']) expect(declaracoes(reduzido, s)).toEqual({ transition: 'none' });
    for (const s of ['.cmp-live__dot', '.info-popover']) expect(declaracoes(reduzido, s)).toEqual({ animation: 'none' });
    expect(declaracoes(reduzido, '.cmp-carregando__spinner')).toEqual({ 'animation-duration': '2.4s' });
    expect(regiao?.limpo).not.toContain('!important');
  });
});

describe('F8: fixture de tokens', () => {
  const f8 = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f8.json');

  it('a fixture .f8 so tem pares claro/escuro, nenhuma constante, e todos estao no CSS com os mesmos valores', () => {
    expect(f8).toHaveLength(13);
    expect(f8.filter((t) => t.constante)).toEqual([]);
    for (const t of f8) {
      expect(lightTokens[t.token], t.token).toBe(t.claro);
      expect(darkTokens[t.token], t.token).toBe(t.escuro);
    }
  });

  it('todo var(--rf-*) que a regiao usa existe na uniao das fixtures (a F8 nao declara token: so o commit serial)', () => {
    const nomes = new Set(fixtureUniao().map((t) => t.token));
    const usados = [...new Set([...(regiao?.limpo ?? '').matchAll(/var\((--rf-[\w-]+)/g)].map((m) => m[1] ?? ''))];
    expect(usados.length).toBeGreaterThan(30);
    expect(usados.filter((t) => !nomes.has(t))).toEqual([]);
  });

  it('os 13 tokens da fase estao em uso na regiao (nenhum sobrou sem consumidor)', () => {
    const usados = new Set([...(regiao?.limpo ?? '').matchAll(/var\((--rf-[\w-]+)/g)].map((m) => m[1] ?? ''));
    expect(f8.map((t) => t.token).filter((t) => !usados.has(t))).toEqual([]);
  });
});

// ---------- contraste ----------
const TEXT = 4.5;
const UI = 3;
const rf = (n: string) => `--rf-${n}`;
type Par = readonly [fg: string, bg: string, min?: number];
const PARES = [
  [rf('ink'), rf('surface'), TEXT], // nome, valores, titulos, rotulos
  [rf('ink'), rf('surface-alt'), TEXT], // linha das demais no escuro, grupo da avaliacao, caixa dos destinatarios
  [rf('ink'), rf('tone-success-bg'), TEXT], // texto da linha vencedora
  [rf('ink-soft'), rf('surface')], // contato, origem, dicas, nota dos criterios
  [rf('ink-soft'), rf('surface-alt')], // itens de Fora do ranking, dicas no grupo, destinatarios
  [rf('ink-soft'), rf('cmp-criterio-faixa')], // dica e nota dos criterios sobre a faixa
  [rf('ink-soft'), rf('tone-success-bg')], // contato e origem na linha vencedora
  [rf('tone-success-fg'), rf('tone-success-bg')], // selo ao vivo e "Vencedora"
  [rf('on-action'), rf('action')], // chave ligada, posicao da vencedora, avatar do by-pass
  [rf('tone-warning-fg'), rf('tone-warning-bg')], // "Qtd divergente", by-pass, aviso de alcada
  [rf('tone-warning-fg'), rf('aviso-icone-bg')], // icone do by-pass
  [rf('tone-warning-fg'), rf('surface')], // titulo do popover
  [rf('primary-700'), rf('surface')], // eyebrow
  [rf('primary-700'), rf('surface-alt')], // icone do vazio
  [rf('tone-danger-fg'), rf('surface-alt')], // "Dê nota nas tres dimensoes" no grupo da avaliacao
  [rf('tone-danger-fg'), rf('tone-danger-bg')], // erro da OC e dos destinatarios
  [rf('tone-info-fg'), rf('tone-info-bg')], // "via parceiro", aviso do parceiro
  [rf('tone-neutral-fg'), rf('tone-neutral-bg')], // posicao e incoterm das demais no escuro
  [rf('ink'), rf('tone-neutral-bg')], // posicao e incoterm das demais no claro
  [rf('action'), rf('surface')], // botao "Escolher arquivo", secundarios
  [rf('primary-700'), rf('tone-success-bg')], // icone do arquivo selecionado
  [rf('tone-success-fg'), rf('tone-success-bg'), UI], // trofeu (icone)
  [rf('input-border'), rf('surface'), UI], // borda dos campos e do bloco de arquivo (D3)
] as const satisfies ReadonlyArray<Par>;

describe('F8: contraste nos 2 temas (alpha composto sobre --rf-surface)', () => {
  const opaque = (theme: ThemeName, name: string): Rgb => opaqueOf(THEMES[theme], name);
  const rows = (['claro', 'escuro'] as const).flatMap((theme) =>
    PARES.map(([fg, bg, ...resto]) => {
      const min: number = resto[0] ?? TEXT;
      const ratio = ratioOf(opaque(theme, fg), opaque(theme, bg));
      return { id: `${theme}: ${fg} / ${bg}`, min, ratio: Number(ratio.toFixed(2)), ok: ratio >= min };
    }),
  );

  it('mede os pares nos 2 temas', () => {
    console.table(rows.map((r) => ({ par: r.id, min: r.min, ratio: r.ratio, ok: r.ok })));
    expect(rows).toHaveLength(PARES.length * 2);
  });

  it('todos os pares passam', () => {
    expect(rows.filter((r) => !r.ok).map((r) => `${r.id}: ${r.ratio} < ${r.min}`)).toEqual([]);
  });
});

// Excecoes DECORATIVAS (nenhuma e texto; o estado tambem vem do texto, do icone ou do rotulo): ficam abaixo de 3:1, como no board, registradas
// nos 2 temas (precedente da F3d). A borda da vencedora no escuro (mentol sobre o fundo escuro) passa de 3 e por isso so conta no claro.
const DECORATIVAS: ReadonlyArray<{ token: string; sobre: string; temas: ThemeName[] }> = [
  { token: rf('score-trilho'), sobre: rf('surface'), temas: ['claro', 'escuro'] },
  { token: rf('score-outros'), sobre: rf('score-trilho'), temas: ['claro', 'escuro'] },
  { token: rf('vencedora-borda'), sobre: rf('tone-success-bg'), temas: ['claro'] },
  { token: rf('popover-aviso-borda'), sobre: rf('surface'), temas: ['claro', 'escuro'] },
  { token: rf('aviso-borda-suave'), sobre: rf('tone-warning-bg'), temas: ['claro', 'escuro'] },
  { token: rf('divergente-anel'), sobre: rf('tone-warning-bg'), temas: ['claro', 'escuro'] },
  { token: rf('vencedora-selo-anel'), sobre: rf('tone-success-bg'), temas: ['claro', 'escuro'] },
];

describe('F8: excecoes decorativas (< 3:1) registradas nos 2 temas', () => {
  it.each(DECORATIVAS.flatMap((d) => d.temas.map((tema) => ({ ...d, tema }))))('$token sobre $sobre ($tema) segue abaixo de 3:1', ({ token, sobre, tema }) => {
    const tokens = THEMES[tema];
    const ratio = ratioOf(opaqueOf(tokens, token), opaqueOf(tokens, sobre));
    expect(ratio, `${token} / ${sobre} (${tema})`).toBeLessThan(UI);
  });

  it('as 7 decorativas do plano (14.6-C) estao todas registradas', () => {
    expect(new Set(DECORATIVAS.map((d) => d.token))).toEqual(
      new Set(['score-trilho', 'score-outros', 'vencedora-borda', 'popover-aviso-borda', 'aviso-borda-suave', 'divergente-anel', 'vencedora-selo-anel'].map(rf)),
    );
  });
});

// ---------- TSX da fase ----------
const ARQUIVOS = [
  'pages/CotacaoTabs/ComparacaoTab.tsx',
  'pages/CotacaoTabs/PurchaseOrderModal.tsx',
  'components/InfoPopover.tsx',
] as const;
const fonte = (arquivo: string) => readSource(`../${arquivo}`);
const cssInteiro = stripComments(rawLf);
const temRegra = (classe: string) => new RegExp(`\\.${classe.replace(/[-_]/g, (m) => `\\${m}`)}(?![A-Za-z0-9_-])`).test(cssInteiro);

describe('F8: TSX da fase sem estilo inline (fora os 2 dinamicos), token, cor literal, glifo nem SVG local', () => {
  it.each(ARQUIVOS)('%s: sem var(--rf-, cor literal, glifo, &times; nem <svg local', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--rf-|<svg|[▸▾→✓]|&times;/);
  });

  it('`style={` so aparece 2 vezes: a largura da barra de score (ComparacaoTab) e a posicao do popover (InfoPopover) (D-F8-04)', () => {
    const contagem = (arquivo: string) => (fonte(arquivo).match(/style=\{/g) ?? []).length;
    expect(contagem('pages/CotacaoTabs/ComparacaoTab.tsx')).toBe(1);
    expect(contagem('pages/CotacaoTabs/PurchaseOrderModal.tsx')).toBe(0);
    expect(contagem('components/InfoPopover.tsx')).toBe(1);
    expect(fonte('pages/CotacaoTabs/ComparacaoTab.tsx')).toContain('style={{ width: `${percent}%` }}');
    expect(fonte('components/InfoPopover.tsx')).toContain("position: 'fixed'");
  });

  it('o tamanho do PDF usa virgula decimal (sem toFixed(2)) e os 7 SVG locais foram para o Icon', () => {
    expect(fonte('pages/CotacaoTabs/PurchaseOrderModal.tsx')).not.toContain('toFixed(2)');
    for (const nome of ['CheckIcon', 'TrophyIcon', 'WarningIcon', 'DocIcon', 'EnvelopeIcon', 'AlertIcon', 'ChartIcon']) {
      expect(fonte('pages/CotacaoTabs/ComparacaoTab.tsx'), nome).not.toContain(nome);
    }
  });
});

describe('F8: toda classe que os TSX da fase usam tem regra', () => {
  it('classes literais de className="..." tem regra', () => {
    const faltando: string[] = [];
    for (const arquivo of ARQUIVOS) {
      for (const [, valor] of fonte(arquivo).matchAll(/className="([^"]+)"/g)) {
        for (const classe of (valor ?? '').split(/\s+/).filter(Boolean)) {
          if (!temRegra(classe)) faltando.push(`${arquivo}: .${classe}`);
        }
      }
    }
    expect([...new Set(faltando)]).toEqual([]);
  });

  it("classes de ternarios e do InfoPopover (info-chip--, info-popover--) tem regra: os tons 'warning' e 'info' existem", () => {
    for (const classe of ['cmp-rank--winner', 'cmp-row--winner', 'cmp-toggle--active', 'cmp-row__actions--stacked', 'cmp-po__arquivo--ok', 'cmp-po__contador--excedido', 'info-chip--warning', 'info-chip--info', 'info-popover--info']) {
      expect(temRegra(classe), classe).toBe(true);
    }
  });

  it('toda classe com prefixo dono citada nos TSX (inclusive em ternarios e templates) tem regra na regiao', () => {
    const naRegiaoClasses = new Set(planas.flatMap((r) => listaDeSeletores(r.prelude)).flatMap(classesDoSeletor));
    const faltando: string[] = [];
    for (const arquivo of ARQUIVOS) {
      for (const [token] of fonte(arquivo).matchAll(/(?<![\w-])(cmp-|info-chip|info-popover)[\w-]*/g)) {
        if (token.endsWith('-')) continue; // prefixo solto (templates do InfoPopover)
        if (token === 'cmp-notes' || token === 'cmp-title' || token === 'cmp-excluded-title') continue; // data-testid e ids, nao classes
        if (!naRegiaoClasses.has(token)) faltando.push(`${arquivo}: .${token}`);
      }
    }
    expect([...new Set(faltando)]).toEqual([]);
  });
});
