/// <reference types="node" />
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classesDoSeletor,
  fixtureUniao,
  foraDasRegioes,
  opaque as opaqueOf,
  over,
  parseColor,
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

// F6 (Suite COMEX, mock v68; boards CotacaoResumo, CotacaoItens, CotacaoDesenvolvimento, EnvioFornecedores, EnvioFornecedoresScroll,
// EnvioPreview, EnvioResultado, LinksPortal, ModalNovoItem e ModaisCotacao): cabecalho, abas, Resumo, painel de desenvolvimento, aba Itens
// (+ Mover), Enviar cotacao em 3 passos, Links do portal e os modais Novo/Editar item e Editar cotacao. CSS na regiao `tela F6` do
// globals.css. Esta guarda cobre: a regiao (posicao logo depois da F5, prefixos donos, classes de contexto, at-rules, sem cor literal),
// a disjuncao com a F7 (anti-vazamento de seletor: os modais da F7 renderizam DENTRO da pagina da F6), que nada dos donos sobrou fora
// da regiao, as receitas dos boards, o contraste nos 2 temas e que os 5 TSX da fase nao tem estilo inline, token, cor literal nem glifo.

const NOME = 'tela F6';
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

// ---------- listas da fase ----------
// Prefixos DONOS (PLAN 13.7): todo seletor da regiao (cada item da lista, sozinho) tem ao menos 1 classe com um destes prefixos.
const PREFIXOS_DONOS = [
  'cotacao-detalhe__',
  'cotacao-resumo',
  'cotacao-envio',
  'cotacao-links',
  'cotacao-item-form',
  'sol-dev-painel',
  'itens-tab',
  'po-',
  'item-action',
  'item-grip',
  'item-row',
  'text-button',
  'move-item-modal',
  'folder',
  'fcount',
  'recipient-summary',
  'dispatcher-',
] as const;
const ehDono = (classe: string) => PREFIXOS_DONOS.some((p) => classe.startsWith(p));
// Classes de CONTEXTO: so aparecem junto de um dono (lista do PLAN 13.7 + as que a regiao usa: eyebrow do Resumo, stepper do envio,
// preview-frame e dispatch-event da faixa de resultado, sol-items-list do painel, num e cell-truncate da tabela de PO).
const CONTEXTO = new Set([
  'card',
  'table',
  'table-wrapper',
  'row-actions',
  'cell-nowrap',
  'cell-truncate',
  'num',
  'badge',
  'chip',
  'chip--active',
  'chip--static',
  'chip-row',
  'alert',
  'empty-state',
  'ghost-button',
  'primary-button',
  'danger-button',
  'icon-button',
  'icon-button--danger',
  'input',
  'select',
  'textarea',
  'field-label',
  'modal-actions',
  'stepper',
  'stepper__lista',
  'stepper__passo',
  'stepper__marca',
  'stepper__ligacao',
  'preview-frame',
  'dispatch-event',
  'dispatch-event__header',
  'dispatch-event__subject',
  'sol-items-list',
  'eyebrow',
]);
// Classes de pagina/base que a F6 NAO estiliza (a TROCA-1 e dona).
const BASE_DA_PAGINA = new Set(['page', 'page-header', 'page-header__actions']);
// Donos da F7 (a F6 nunca os cita: os modais da F7 renderizam dentro da pagina da F6).
const DONOS_F7 = ['respostas-tab', 'resposta-', 'credit-support', 'price-history', 'supplier-notes'];

const ARQUIVOS = [
  'pages/CotacaoDetalhe.tsx',
  'pages/CotacaoTabs/ItensTab.tsx',
  'pages/CotacaoTabs/MoveItemModal.tsx',
  'pages/CotacaoTabs/SolicitacaoDesenvolvimentoPanel.tsx',
] as const;

describe('F6: regiao `tela F6`', () => {
  it('existe uma vez, logo depois da regiao `tela F5` (so espaco entre as duas), antes da F7, e tem regras', () => {
    expect(rawLf.split(`/* >>> ${NOME} (Suite COMEX) >>> */`)).toHaveLength(2);
    expect(rawLf.split(`/* <<< ${NOME} <<< */`)).toHaveLength(2);
    const f5 = regs.find((r) => r.nome === 'tela F5');
    expect(f5).toBeDefined();
    expect(regiao).toBeDefined();
    expect(rawLf.slice(f5?.fim ?? 0, regiao?.inicio ?? 0).trim()).toBe('');
    expect(regs.findIndex((r) => r.nome === NOME)).toBe(regs.findIndex((r) => r.nome === 'tela F5') + 1);
    expect(planas.length).toBeGreaterThan(150);
  });

  it('a regiao vem DEPOIS das regioes F3 e da compat (vence as regras de componente de mesma especificidade pela ordem)', () => {
    const compat = regs.find((r) => r.nome === 'compat Forecast F3');
    expect((compat?.fim ?? Infinity) <= (regiao?.inicio ?? 0)).toBe(true);
  });

  it('a regiao nao declara token (--*), consome so var(--rf-*) (e --paper* na previa em papel) e nao tem cor literal, !important nem @media print', () => {
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    expect(regiao?.limpo).toContain('var(--rf-');
    expect(regiao?.limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(regiao?.limpo).not.toContain('!important');
    expect(regiao?.limpo).not.toContain('@media print');
    expect(regiao?.limpo).not.toContain('@keyframes');
    const usados = [...(regiao?.limpo ?? '').matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '');
    const estranhos = [...new Set(usados)].filter((v) => !v.startsWith('--rf-') && !['--paper', '--paper-ink', '--paper-ink-soft'].includes(v));
    expect(estranhos).toEqual([]);
    for (const v of new Set(usados)) {
      if (v.startsWith('--rf-')) expect(lightTokens[v], v).toBeDefined();
    }
  });

  it('at-rules permitidas: 1199, 720, 640, pointer: coarse e reduced-motion (so regras planas dentro delas)', () => {
    const permitidas = new Set([
      '@media (max-width: 1199px)',
      '@media (max-width: 720px)',
      '@media (max-width: 640px)',
      '@media (pointer: coarse)',
      '@media (prefers-reduced-motion: reduce)',
    ]);
    const atRules = topo.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    expect(atRules.filter((a) => !permitidas.has(a))).toEqual([]);
    expect(new Set(atRules).size).toBe(atRules.length);
    for (const obrigatoria of ['@media (max-width: 720px)', '@media (max-width: 640px)', '@media (pointer: coarse)', '@media (prefers-reduced-motion: reduce)']) {
      expect(atRules, obrigatoria).toContain(obrigatoria);
    }
    for (const m of topo.filter((r) => r.prelude.startsWith('@media'))) {
      for (const inner of parseRules(m.body)) expect(inner.prelude.startsWith('@'), inner.prelude).toBe(false);
    }
  });
});

describe('F6: prefixos donos, classes de contexto e anti-vazamento (disjuncao com a F7)', () => {
  const seletores = planas.flatMap((r) => listaDeSeletores(r.prelude));

  it('todo seletor tem ao menos 1 classe com prefixo dono', () => {
    expect(seletores.length).toBeGreaterThan(150);
    expect(seletores.filter((s) => !classesDoSeletor(s).some(ehDono))).toEqual([]);
  });

  it('as demais classes de cada seletor sao de CONTEXTO (lista fixa)', () => {
    const alheias = [...new Set(seletores.flatMap(classesDoSeletor))].filter((c) => !ehDono(c) && !CONTEXTO.has(c));
    expect(alheias).toEqual([]);
  });

  it('a F6 nao estiliza a base da pagina (.page, .page-header, .page-header__actions, h1-h3 soltos) nem a pagina inteira (.cotacao-detalhe-page)', () => {
    for (const s of seletores) {
      expect(classesDoSeletor(s).some((c) => BASE_DA_PAGINA.has(c)), s).toBe(false);
      expect(s, s).not.toMatch(/cotacao-detalhe-page/);
    }
    expect(seletores.some((s) => /^h[1-4]\b/.test(s))).toBe(false);
  });

  it('o cartao da aba (.cotacao-detalhe__painel) nunca e ancestral: nada de ".cotacao-detalhe__painel .badge", ".table", ".modal-*" (casariam a F7 e a F8)', () => {
    for (const s of seletores) expect(s, s).not.toMatch(/cotacao-detalhe__painel[^,]*\s[.\w[]/);
    expect(seletores.filter((s) => /\.modal-/.test(s))).toEqual([]);
  });

  it('nenhum seletor cita um dono da F7 (respostas-tab, resposta-, credit-support, price-history, supplier-notes)', () => {
    const f7 = seletores.filter((s) => classesDoSeletor(s).some((c) => DONOS_F7.some((p) => c.startsWith(p))));
    expect(f7).toEqual([]);
  });

  it('as classes de contexto so entram DEPOIS de um dono: o 1o composto de cada seletor tem dono (ou e dono ele proprio)', () => {
    for (const s of seletores) {
      const primeiro = s.split(/\s*[>+~]\s*|\s+/)[0] ?? '';
      expect(classesDoSeletor(primeiro).some(ehDono), `${s}: o 1o composto "${primeiro}" precisa de dono`).toBe(true);
    }
  });

  it('os .dispatcher-* so recebem visual da regiao dentro de .cotacao-envio (os antigos ficam, D-F6-10)', () => {
    for (const s of seletores.filter((x) => /\.dispatcher-/.test(x))) expect(s, s).toMatch(/^\.cotacao-envio /);
  });
});

describe('F6: nada dos donos sobrou fora das regioes; o que e compartilhado segue no lugar', () => {
  const foraLimpo = stripComments(fora);
  const foraSeletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));
  const donosApagados = /^(cotacao-detalhe__|cotacao-resumo|cotacao-envio|cotacao-links|cotacao-item-form|sol-dev-painel|itens-tab|po-|item-action|item-grip|item-row|text-button|move-item-modal|folder|fcount|recipient-summary|dispatch-status)/;

  it('nenhuma regra .cotacao-detalhe*, .cotacao-resumo*, .cotacao-envio*, .cotacao-links*, .cotacao-item-form*, .sol-dev-painel*, .itens-tab*, .po-*, .item-action*, .item-grip, .text-button, .move-item-modal*, .folder*, .fcount, .recipient-summary* ou .dispatch-status* fora da regiao', () => {
    expect(foraSeletores.filter((s) => classesDoSeletor(s).some((c) => donosApagados.test(c)))).toEqual([]);
  });

  it('as regras compartilhadas ficam: .dispatcher-* (afirmadas pelo EnvioPastas.test), .dispatch-event*, .dispatch-token, .preview-frame, .item-form__error, .form-grid, .muted, .text-sm, .sol-items-list, .sr-only', () => {
    for (const s of [
      '.dispatcher-master-detail',
      '.dispatcher-folders',
      '.dispatcher-folders__label',
      '.dispatcher-folders > *',
      '.dispatcher-list',
      '.dispatcher-row',
      '.dispatch-event',
      '.dispatch-event__header',
      '.dispatch-token',
      '.preview-frame',
      '.item-form__error',
      '.form-grid',
      '.muted',
      '.text-sm',
      '.text-xs',
      '.sol-items-list',
      '.sr-only',
    ]) {
      expect(foraSeletores, s).toContain(s);
    }
  });

  it('as regras antigas do bloco do ItensTab (.itens-tab__header ate o @media de 600) foram apagadas, mas o .sr-only (compartilhado) ficou', () => {
    expect(foraLimpo).not.toContain('.itens-tab__header');
    expect(foraLimpo).not.toContain('.po-group-head');
    expect(foraLimpo).not.toContain('.item-action');
    expect(foraLimpo).toContain('.sr-only {');
  });
});

describe('F6: receitas dos boards (valores exatos)', () => {
  it('cartao das abas: raio 22 (--rf-radius-panel), 22/24, borda 1 px --rf-border (D-F6-09)', () => {
    expect(naRegiao('.cotacao-detalhe__painel')).toEqual({
      padding: '22px 24px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-panel)',
      background: 'var(--rf-surface)',
    });
  });

  it('Resumo: grade de 3 colunas sem gap, celulas 14/16 com divisorias de 1 px --rf-divider, rotulo em eyebrow sem margem, gap interno 18', () => {
    expect(naRegiao('.cotacao-resumo')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '18px' });
    expect(naRegiao('.cotacao-resumo__grade')).toEqual({ display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: '0', margin: '0' });
    expect(naRegiao('.cotacao-resumo__item')).toMatchObject({
      display: 'flex',
      'flex-direction': 'column',
      gap: '6px',
      padding: '14px 16px',
      'border-bottom': '1px solid var(--rf-divider)',
      'border-left': '1px solid var(--rf-divider)',
    });
    expect(naRegiao('.cotacao-resumo__item--inicio')).toEqual({ 'padding-left': '0', 'border-left': '0' });
    expect(naRegiao('.cotacao-resumo__item--cheia')).toEqual({ 'grid-column': '1 / -1', padding: '14px 0', 'border-left': '0' });
    expect(naRegiao('.cotacao-resumo__item--fim')).toEqual({ 'padding-bottom': '4px', 'border-bottom': '0' });
    expect(naRegiao('.cotacao-resumo__item .eyebrow')).toEqual({ margin: '0' });
    expect(naRegiao('.cotacao-resumo__item dd')).toMatchObject({ margin: '0', 'font-size': '15px', 'font-weight': '600' });
    expect(naRegiao('.cotacao-resumo__item .cotacao-resumo__mono')).toEqual({ 'font-family': 'var(--rf-font-mono)', 'font-variant-numeric': 'tabular-nums' });
    expect(naRegiao('.cotacao-resumo__item .cotacao-resumo__texto')).toEqual({ 'max-width': '820px', 'font-weight': '400', 'line-height': '1.6' });
    expect(declaracoes(mediaDe('@media (max-width: 720px)'), '.cotacao-resumo__grade')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
  });

  it('painel de desenvolvimento: cartao de 22 em coluna (gap 14), selo "Interno" e lista sem marcador', () => {
    expect(naRegiao('.sol-dev-painel')).toMatchObject({ display: 'flex', 'flex-direction': 'column', gap: '14px', padding: '22px', 'border-radius': 'var(--rf-radius-panel)' });
    expect(naRegiao('.sol-dev-painel__topo')).toMatchObject({ 'justify-content': 'space-between', gap: '12px' });
    expect(naRegiao('.sol-dev-painel .sol-items-list')).toMatchObject({ display: 'flex', 'flex-direction': 'column', gap: '6px', padding: '0', 'list-style': 'none' });
  });

  it('aba Itens: gap 12, aviso em flex com o icone no topo, tabela com contorno 1 px --rf-divider e raio 16 (D-F6-08)', () => {
    expect(naRegiao('.itens-tab')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '12px' });
    expect(naRegiao('.itens-tab__acoes')).toEqual({ display: 'flex', 'flex-wrap': 'wrap', gap: '8px' });
    expect(naRegiao('.itens-tab__notice')).toMatchObject({ display: 'flex', 'align-items': 'flex-start', gap: '10px' });
    expect(naRegiao('.po-table-wrapper')).toEqual({
      'container-type': 'inline-size',
      border: '1px solid var(--rf-divider)',
      'border-radius': 'var(--rf-radius-card)',
    });
    expect(naRegiao('.po-table td')).toEqual({ padding: '10px 16px' });
    expect(naRegiao('.po-table td:last-child')).toMatchObject({ padding: '6px 12px' });
    expect(naRegiao('.po-table td.num')).toEqual({ 'font-family': 'var(--rf-font-mono)', 'font-variant-numeric': 'tabular-nums' });
    expect(naRegiao('.po-table .cell-truncate')).toEqual({ 'max-width': '150px' });
    expect(naRegiao('.po-table tbody:last-child > tr:last-child > td')).toEqual({ 'border-bottom': '0' });
  });

  it('cabecalho do grupo de PO: faixa --rf-surface-alt 10/16, titulo em mono 14/600, botoes de icone de 32 e barra fixa pela largura do contentor', () => {
    expect(naRegiao('.po-group-head > th')).toMatchObject({ padding: '10px 16px', background: 'var(--rf-surface-alt)', 'border-bottom': '1px solid var(--rf-divider)' });
    expect(naRegiao('.po-group-head__title h3')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '14px', 'font-weight': '600' });
    expect(naRegiao('.po-group--none .po-group-head__title h3')).toEqual({ 'font-family': 'var(--rf-font-sans)', 'font-weight': '700' });
    expect(naRegiao('.po-group-head .icon-button')).toEqual({ width: '32px', height: '32px', background: 'transparent', color: 'var(--rf-action)' });
    expect(naRegiao('.po-group-head__bar')).toMatchObject({ position: 'sticky', width: 'calc(100cqi - 32px)' });
    expect(naRegiao('.po-rename-input')).toMatchObject({ width: '220px', 'min-height': '36px', 'font-family': 'var(--rf-font-mono)' });
  });

  it('rodape do grupo e zona de soltar: rodape 4/10/8 com borda --rf-border; zona tracejada de 58 com a borda (48 so leitura, 60 no alvo); alvo com 2 px --rf-primary-700 em tom success', () => {
    expect(naRegiao('.po-table .po-group-foot > td')).toEqual({
      padding: '4px 10px 8px',
      'border-bottom': '1px solid var(--rf-border)',
    });
    expect(naRegiao('.po-table .po-drop-row > td')).toEqual({ padding: '10px 16px', 'border-bottom': '0' });
    expect(naRegiao('.po-drop-empty')).toMatchObject({
      'min-height': '58px',
      border: '1px dashed var(--rf-empty-border)',
      'border-radius': 'var(--rf-radius-button)',
      background: 'var(--rf-surface-alt)',
      width: 'calc(100cqi - 32px)',
    });
    expect(naRegiao('.po-drop-empty--readonly')).toEqual({ 'min-height': '48px', border: '0' });
    expect(naRegiao('.po-group--drop-target > tr > td')).toEqual({ background: 'var(--rf-tone-success-bg)' });
    expect(naRegiao('.po-group--drop-target .po-drop-empty')).toMatchObject({
      'min-height': '60px',
      padding: '0',
      border: '2px dashed var(--rf-primary-700)',
      background: 'var(--rf-surface)',
      color: 'var(--rf-tone-success-fg)',
      'font-weight': '700',
    });
  });

  it('acoes de texto (Editar, Mover, Remover, Adicionar item): 8/6, raio 8, 13/700 em --rf-action; Remover em tom danger', () => {
    for (const s of ['.text-button', '.item-action']) {
      expect(naRegiao(s)).toBeDefined();
    }
    const comum = declaracoes(semMedia, '.item-action');
    expect(comum).toMatchObject({ padding: '8px 6px', 'border-radius': 'var(--rf-radius-xs)', color: 'var(--rf-action)', 'font-size': '13px', 'font-weight': '700' });
    expect(naRegiao('.item-action--danger')).toEqual({ color: 'var(--rf-tone-danger-fg)' });
    expect(naRegiao('.item-action:hover:not(:disabled)')).toEqual({ background: 'var(--rf-bg)' });
  });

  it('Mover: destinos de 44 com anel de 1 px; escolhido em --rf-action-hover-bg com anel de 1,5 px --rf-action; atual desabilitado', () => {
    expect(naRegiao('.move-item-modal__option')).toMatchObject({ 'min-height': '44px', 'border-radius': 'var(--rf-radius-button)', 'box-shadow': 'inset 0 0 0 1px var(--rf-divider)' });
    expect(naRegiao('.move-item-modal__option:has(input:checked)')).toMatchObject({
      background: 'var(--rf-action-hover-bg)',
      'box-shadow': 'inset 0 0 0 1.5px var(--rf-action)',
      'font-weight': '700',
    });
    expect(naRegiao('.move-item-modal__option:has(input:disabled)')).toMatchObject({ background: 'var(--rf-surface-alt)', color: 'var(--rf-disabled-fg)' });
    expect(naRegiao('.move-item-modal__po')).toEqual({ 'font-family': 'var(--rf-font-mono)' });
  });

  it('Novo item: fieldset "Incoterm e destino" com 1 px --rf-border, raio 14, padding 12/14/14 e gap 12; opcoes com caixa de 18', () => {
    expect(naRegiao('.cotacao-item-form__escopo')).toMatchObject({
      padding: '12px 14px 14px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-alert)',
      gap: '12px',
    });
    expect(naRegiao('.cotacao-item-form__opcao input')).toMatchObject({ width: '18px', height: '18px', 'accent-color': 'var(--rf-action)' });
    expect(naRegiao('.cotacao-item-form__incoterms')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '13px', 'font-weight': '600' });
  });

  it('Editar cotacao: grade de 2 colunas gap 12 (1 coluna ate 640); chips de incoterm 34, mono 12, ativo com borda --rf-action; moeda em mono', () => {
    expect(naRegiao('.cotacao-detalhe__edicao')).toEqual({ display: 'grid', 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', gap: '12px' });
    expect(declaracoes(mediaDe('@media (max-width: 640px)'), '.cotacao-detalhe__edicao')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(naRegiao('.cotacao-detalhe__edicao .chip')).toEqual({
      'min-height': '34px',
      padding: '0 12px',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '12px',
    });
    expect(naRegiao('.cotacao-detalhe__edicao .chip--active')).toEqual({ border: '1px solid var(--rf-action)', 'font-weight': '600' });
    expect(naRegiao('.cotacao-detalhe__moeda')).toEqual({ 'font-family': 'var(--rf-font-mono)', 'font-weight': '600' });
  });

  it('Envio: Stepper sem cartao (24 px, ligacao de 32); pastas 40 de altura, selecionada em --rf-action/--rf-on-action com o contador em pilula; fornecedores 22/1fr/auto com anel de 1,5 px', () => {
    expect(naRegiao('.cotacao-envio .stepper')).toEqual({ padding: '0 0 4px', border: '0', 'border-radius': '0', background: 'transparent' });
    expect(naRegiao('.cotacao-envio .stepper__marca')).toEqual({ width: '24px', height: '24px', 'font-size': '12px' });
    expect(naRegiao('.cotacao-envio .stepper__ligacao')).toEqual({ flex: '0 0 32px' });
    expect(naRegiao('.cotacao-envio .dispatcher-master-detail')).toMatchObject({ 'grid-template-columns': '250px minmax(0, 1fr)', 'border-radius': 'var(--rf-radius-card)' });
    expect(naRegiao('.folder')).toMatchObject({ 'min-height': '40px', padding: '0 10px', 'border-radius': 'var(--rf-radius-control)', 'font-size': '13px', 'font-weight': '600' });
    expect(naRegiao('.folder--on')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)', 'font-weight': '700' });
    expect(naRegiao('.fcount')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '11px', 'font-weight': '600' });
    expect(naRegiao('.folder--on .fcount')).toEqual({ padding: '1px 8px', 'border-radius': 'var(--rf-radius-pill)', background: 'var(--rf-on-action-tinta)', color: 'var(--rf-on-action)' });
    expect(naRegiao('.cotacao-envio .dispatcher-row')).toMatchObject({
      'grid-template-columns': '22px minmax(0, 1fr) auto',
      'border-radius': 'var(--rf-radius-button)',
      'box-shadow': 'inset 0 0 0 1px var(--rf-divider)',
    });
    expect(naRegiao('.cotacao-envio .dispatcher-row--selected')).toEqual({ background: 'var(--rf-primary-50)', 'box-shadow': 'inset 0 0 0 1.5px var(--rf-selecao-anel)' });
    expect(naRegiao('.cotacao-envio__busca')).toMatchObject({ height: '44px', padding: '0 12px', border: '1.5px solid var(--rf-input-border)', 'border-radius': 'var(--rf-radius-control)' });
  });

  it('Envio: pilulas de 30 (Para em --rf-action-hover-bg, total em --rf-action, CC em tom neutro); previa de 560 com contorno; resultado com tom por status', () => {
    expect(naRegiao('.recipient-summary__pill')).toMatchObject({ 'min-height': '30px', padding: '0 12px', background: 'var(--rf-action-hover-bg)', color: 'var(--rf-action)', 'font-size': '12px', 'font-weight': '700' });
    expect(naRegiao('.recipient-summary__pill--total')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
    expect(naRegiao('.recipient-summary__pill--cc')).toEqual({ background: 'var(--rf-tone-neutral-bg)', color: 'var(--rf-tone-neutral-fg)' });
    expect(naRegiao('.cotacao-envio .preview-frame')).toMatchObject({ height: '562px', border: '1px solid var(--rf-border)', 'border-radius': 'var(--rf-radius-alert)', 'box-shadow': 'none' });
    expect(naRegiao('.cotacao-envio .cotacao-envio__resultado--partial')).toEqual({ 'border-color': 'var(--rf-aviso-borda)', background: 'var(--rf-tone-warning-bg)' });
    expect(naRegiao('.cotacao-envio .cotacao-envio__resultado--completed')).toEqual({ 'border-color': 'var(--rf-selecao-anel)', background: 'var(--rf-tone-success-bg)' });
    expect(naRegiao('.cotacao-envio .cotacao-envio__resultado--failed')).toEqual({ background: 'var(--rf-tone-danger-bg)' });
    expect(naRegiao('.cotacao-envio__resultado .badge')).toEqual({ background: 'var(--rf-surface)' });
    expect(naRegiao('.cotacao-envio__tabela')).toEqual({ border: '1px solid var(--rf-divider)', 'border-radius': 'var(--rf-radius-card)' });
    expect(naRegiao('.cotacao-envio__linha-falha td')).toEqual({ background: 'var(--rf-falha-linha)' });
    expect(naRegiao('.cotacao-envio__detalhe--falha')).toEqual({ color: 'var(--rf-tone-danger-fg)', 'font-family': 'var(--rf-font-mono)' });
  });

  it('Links do portal: rolagem de 420 com contorno 1 px e raio 16; contato em 2 linhas; acoes a direita; "Gerar novo link" com contorno 1,5 px --rf-action; copiado em tom success', () => {
    expect(naRegiao('.cotacao-links__tabela')).toEqual({
      'max-height': '420px',
      overflow: 'auto',
      border: '1px solid var(--rf-divider)',
      'border-radius': 'var(--rf-radius-card)',
    });
    expect(naRegiao('.cotacao-links__tabela td')).toEqual({ padding: '10px 16px' });
    expect(naRegiao('.cotacao-links__tabela td:last-child')).toEqual({ padding: '8px 12px' });
    expect(naRegiao('.cotacao-links__contato')).toMatchObject({ display: 'flex', 'flex-direction': 'column', gap: '2px' });
    expect(naRegiao('.cotacao-links__expira')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '12px', 'white-space': 'nowrap' });
    expect(naRegiao('.cotacao-links__acoes')).toMatchObject({ 'justify-content': 'flex-end', gap: '4px' });
    expect(naRegiao('.cotacao-links__acoes .ghost-button:not(.danger-button)')).toEqual({ border: '1.5px solid var(--rf-action)', background: 'var(--rf-surface)' });
    expect(naRegiao('.cotacao-links__acoes .ghost-button.cotacao-links__copiado')).toEqual({
      'border-color': 'var(--rf-selecao-anel)',
      background: 'var(--rf-tone-success-bg)',
      color: 'var(--rf-tone-success-fg)',
    });
    expect(naRegiao('.cotacao-links__ok')).toMatchObject({ color: 'var(--rf-tone-success-fg)', 'font-size': '13px', 'font-weight': '600' });
  });

  it('alvos de toque de 44 em pointer: coarse; ponto de pega oculto; chips do Editar cotacao em 44', () => {
    const alvos = coarse.flatMap((r) => listaDeSeletores(r.prelude));
    for (const s of ['.item-action', '.text-button', '.folder', '.cotacao-item-form__opcao', '.cotacao-envio__check', '.cotacao-links__acoes .ghost-button', '.po-group-head .icon-button', '.cotacao-detalhe__edicao .chip']) {
      expect(alvos, s).toContain(s);
    }
    expect(declaracoes(coarse, '.po-group-head .icon-button')).toEqual({ width: '44px', height: '44px' });
    expect(declaracoes(coarse, '.item-grip')).toEqual({ display: 'none' });
  });

  it('reduced-motion: toda regra com transicao a desliga; o giro da previa so desacelera (indicador essencial); nada anima fora do giro', () => {
    const comTransicao = semMedia.filter((r) => /(^|[;{\s])transition\s*:/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    expect(comTransicao.length).toBeGreaterThan(0);
    for (const s of comTransicao) expect(declaracoes(reduzido, s).transition, s).toBe('none');
    expect(declaracoes(reduzido, '.cotacao-envio__giro')).toEqual({ 'animation-duration': '2.4s' });
    expect(declaracoes(reduzido, '.cotacao-links__giro')).toEqual({ 'animation-duration': '2.4s' });
    const animados = semMedia.filter((r) => /(^|[;{\s])animation\s*:/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    expect(animados).toEqual(['.cotacao-envio__giro', '.cotacao-links__giro']);
    expect(regiao?.limpo).not.toMatch(/transition\s*:[^;]*\btransform\b/);
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])transform\s*:/);
  });
});

describe('F6: fixture de tokens', () => {
  it('a fixture .f6 so tem pares claro/escuro (no maximo 4), nenhuma constante, e todos estao no CSS com o valor da fixture', () => {
    const f6 = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f6.json');
    expect(f6.length).toBeGreaterThan(0);
    expect(f6.filter((t) => t.constante)).toEqual([]);
    expect(f6.length).toBeLessThanOrEqual(4);
    for (const t of f6) {
      expect(lightTokens[t.token], t.token).toBe(t.claro);
      expect(darkTokens[t.token], t.token).toBe(t.escuro);
    }
  });

  it('os tokens novos da F6 so existem depois da ancora `tokens F6` (a F7 tem a sua) e todos os que a regiao usa estao nas fixtures', () => {
    const ancoras = [...rawLf.matchAll(/\/\* tokens F6 \(cotacao detalhe\) \*\/([\s\S]*?)(?=\/\* tokens F7 \(respostas\) \*\/)/g)];
    expect(ancoras).toHaveLength(2);
    for (const a of ancoras) {
      const nomes = [...(a[1] ?? '').matchAll(/--rf-[a-z0-9-]+(?=\s*:)/g)].map((m) => m[0]);
      expect(nomes.length).toBeGreaterThan(0);
      expect(nomes.length).toBeLessThanOrEqual(4);
    }
    const uniao = new Set(fixtureUniao().map((t) => t.token));
    const usados = [...(regiao?.limpo ?? '').matchAll(/var\((--rf-[a-z0-9-]+)/g)].map((m) => m[1] ?? '');
    expect([...new Set(usados)].filter((v) => !uniao.has(v))).toEqual([]);
  });
});

// ---------- contraste ----------
const TEXT = 4.5;
const UI = 3;
const rf = (n: string) => `--rf-${n}`;
type Par = readonly [fg: string, bg: string, min: number];
const PARES: ReadonlyArray<Par> = [
  [rf('on-action'), rf('action'), TEXT], // pasta selecionada, pilula do total, passo atual
  [rf('action'), rf('action-hover-bg'), TEXT], // pilulas Para
  [rf('ink-soft'), rf('action-hover-bg'), TEXT], // "+1 em CC" dentro da pilula
  [rf('tone-neutral-fg'), rf('tone-neutral-bg'), TEXT], // pilulas CC
  [rf('ink-soft'), rf('surface'), TEXT], // textos de apoio, contato, validade
  [rf('ink-soft'), rf('surface-alt'), TEXT], // meta das linhas, grupos de pastas, "PO vazia", cabecalho de coluna
  [rf('ink'), rf('surface-alt'), TEXT], // titulo da PO na faixa do grupo
  [rf('primary-700'), rf('surface-alt'), TEXT], // grupo "Familias desta cotacao"
  [rf('primary-700'), rf('surface'), TEXT], // eyebrow do Resumo
  [rf('ink'), rf('primary-50'), TEXT], // fornecedor selecionado
  [rf('ink-soft'), rf('primary-50'), TEXT], // contatos do fornecedor selecionado
  [rf('tone-warning-fg'), rf('surface-alt'), TEXT], // "Sem contatos cadastrados"
  [rf('tone-success-fg'), rf('tone-success-bg'), TEXT], // zona de soltar (alvo), "Link novo copiado!", faixa de sucesso
  [rf('tone-success-fg'), rf('surface'), TEXT], // aviso "N link(s) novo(s) gerado(s)", selo na faixa
  [rf('tone-warning-fg'), rf('surface'), TEXT], // selo "Parcial" na faixa
  [rf('tone-danger-fg'), rf('surface'), TEXT], // selo "Falhou" na faixa
  [rf('ink'), rf('tone-warning-bg'), TEXT], // titulo da faixa parcial
  [rf('ink-soft'), rf('tone-warning-bg'), TEXT], // contagem "n enviado(s)" na faixa parcial
  [rf('ink-soft'), rf('tone-success-bg'), TEXT], // contagem na faixa de sucesso
  [rf('ink-soft'), rf('tone-danger-bg'), TEXT], // contagem na faixa de falha
  [rf('tone-danger-fg'), rf('falha-linha'), TEXT], // erro SMTP na linha que falhou
  [rf('ink'), rf('falha-linha'), TEXT], // contato na linha que falhou
  [rf('tone-danger-fg'), rf('tone-danger-bg'), TEXT], // Remover (hover)
  [rf('tone-danger-fg'), rf('surface'), TEXT], // Remover e Remover PO em repouso
  [rf('action'), rf('surface'), TEXT], // acoes de texto e botoes de icone
  [rf('ink'), rf('action-hover-bg'), TEXT], // destino escolhido no Mover
  [rf('primary-700'), rf('surface'), UI], // contorno do alvo de soltar
  [rf('input-border'), rf('input-bg'), UI], // borda da busca de fornecedor
  [rf('selecao-anel'), rf('primary-50'), 1], // anel do fornecedor selecionado e do Link copiado (decorativo, ver EXCECOES)
];
const EXCECOES: ReadonlyArray<{ id: string; fg: string; bg: string; tema: ThemeName; esperado: number }> = [
  { id: 'tracejado da zona de soltar ociosa (--rf-empty-border sobre --rf-surface-alt; vazio do D-F3-09)', fg: rf('empty-border'), bg: rf('surface-alt'), tema: 'claro', esperado: 1.5 },
  { id: 'traco --rf-divider do .table-wrapper e das divisorias do Resumo (decorativo; o texto e o cabecalho da tabela fazem a estrutura)', fg: rf('divider'), bg: rf('surface'), tema: 'claro', esperado: 1.25 },
];

describe('F6: contraste nos 2 temas (alpha composto sobre --rf-surface)', () => {
  const opaque = (theme: ThemeName, name: string): Rgb => opaqueOf(THEMES[theme], name);
  const rows = (['claro', 'escuro'] as const).flatMap((theme) =>
    PARES.map(([fg, bg, min]) => {
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

  it('o contador sobre a pasta selecionada (--rf-on-action sobre --rf-on-action-tinta composto sobre --rf-action) passa nos 2 temas', () => {
    for (const theme of ['claro', 'escuro'] as const) {
      const acao = opaqueOf(THEMES[theme], rf('action'));
      const pilula = over(parseColor(THEMES[theme][rf('on-action-tinta')] ?? ''), acao);
      expect(ratioOf(opaqueOf(THEMES[theme], rf('on-action')), pilula), theme).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it('excecoes decorativas (nenhuma e texto): tracejado da zona ociosa e traco do contorno seguem abaixo de 3:1 (claro)', () => {
    for (const e of EXCECOES) {
      const ratio = ratioOf(opaque(e.tema, e.fg), opaque(e.tema, e.bg));
      expect(ratio, e.id).toBeGreaterThan(e.esperado - 0.15);
      expect(ratio, e.id).toBeLessThan(e.esperado + 0.15);
      expect(ratio, `${e.id} segue abaixo de 3:1 (excecao registrada)`).toBeLessThan(UI);
    }
  });
});

// ---------- TSX da fase ----------
const fonte = (arquivo: string) => readSource(`../${arquivo}`);
const cssInteiro = stripComments(rawLf);
const temRegra = (classe: string) => new RegExp(`\\.${classe.replace(/[-_]/g, (m) => `\\${m}`)}(?![A-Za-z0-9_-])`).test(cssInteiro);

describe('F6: TSX da fase sem estilo inline, token, cor literal nem glifo', () => {
  it.each(ARQUIVOS)('%s', (arquivo) => {
    // O "→" do painel de desenvolvimento e TEXTO ("Nome digitado → item do catalogo": SolicitacaoDesenvolvimentoPanel.test.tsx o afirma);
    // o board desenha um icone la, mas o teste existente (fora da lista de arquivos da F6) exige o texto: decisao D-F6-14.
    const glifos = arquivo.endsWith('SolicitacaoDesenvolvimentoPanel.tsx') ? /[▸▾]|&times;/ : /[▸▾→]|&times;/;
    expect(fonte(arquivo)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--rf-|style=\{\{/);
    expect(fonte(arquivo)).not.toMatch(glifos);
  });

  it.each(ARQUIVOS)('%s: sem o "+" de texto nos botoes (vira icone, D-F6-01)', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/>\s*\+\s+(Adicionar|Nova)|'\+ (Adicionar|Nova)/);
  });

  it('o unico "→" que sobra nos TSX da fase e o separador de texto do painel de desenvolvimento', () => {
    const achados = ARQUIVOS.filter((a) => fonte(a).includes('→'));
    expect(achados).toEqual(['pages/CotacaoTabs/SolicitacaoDesenvolvimentoPanel.tsx']);
    expect(fonte('pages/CotacaoTabs/SolicitacaoDesenvolvimentoPanel.tsx').match(/→/g)).toHaveLength(1);
  });

  it('"Enviar cotação" (com acento) em todo o app: nenhum "Enviar cotacao" sobrou nos TSX da fase', () => {
    for (const a of ARQUIVOS) expect(fonte(a), a).not.toContain('Enviar cotacao');
    expect(fonte('pages/CotacaoDetalhe.tsx')).toContain('Enviar cotação');
  });

  it('ItensTabIcons.tsx foi apagado (D-F6-05) e nenhum arquivo o importa', () => {
    expect(existsSync(new URL('../pages/CotacaoTabs/ItensTabIcons.tsx', import.meta.url))).toBe(false);
    for (const a of ARQUIVOS) expect(fonte(a), a).not.toContain('ItensTabIcons');
  });

  it('os 4 cartoes das abas, a raiz das 4 saidas e o Stepper do envio (3 passos, "Etapas do envio") estao no CotacaoDetalhe.tsx', () => {
    const src = fonte('pages/CotacaoDetalhe.tsx');
    expect(src.match(/className="card cotacao-detalhe__painel"/g)).toHaveLength(4);
    expect(src.match(/className="page cotacao-detalhe-page"/g)).toHaveLength(4);
    expect(src).toContain('ariaLabel="Etapas do envio"');
    expect(src).toContain("steps={['Fornecedores', 'Mensagem e preview', 'Resultado']}");
    expect(src).toContain('<Icon name="templates"');
  });
});

describe('F6: toda classe que os TSX da fase usam tem regra', () => {
  it('classes literais de className="..." tem regra (marcadores da pagina e .page-header ficam de fora)', () => {
    const faltando: string[] = [];
    for (const arquivo of ARQUIVOS) {
      for (const [, valor] of fonte(arquivo).matchAll(/className="([^"]+)"/g)) {
        for (const classe of (valor ?? '').split(/\s+/).filter(Boolean)) {
          if (classe === 'page-header' || classe === 'cotacao-detalhe-page') continue;
          if (!temRegra(classe)) faltando.push(`${arquivo}: .${classe}`);
        }
      }
    }
    expect([...new Set(faltando)]).toEqual([]);
  });

  it('toda classe com prefixo dono citada nos TSX (inclusive em ternarios e templates) tem regra na regiao', () => {
    const naRegiaoClasses = new Set(planas.flatMap((r) => listaDeSeletores(r.prelude)).flatMap(classesDoSeletor));
    const faltando: string[] = [];
    for (const arquivo of ARQUIVOS) {
      for (const [token] of fonte(arquivo).matchAll(/(?<![\w-])(cotacao-detalhe__|cotacao-resumo|cotacao-envio|cotacao-links|cotacao-item-form|sol-dev-painel|itens-tab|po-|item-row|move-item-modal)[\w-]*/g)) {
        if (token.endsWith('-')) continue; // prefixo de template (cotacao-envio__resultado--${status}): as variantes sao conferidas abaixo
        if (token === 'po-group') continue; // classe-base do tbody: os modificadores --none e --drop-target tem regra (e o data-testid e o gancho dos testes)
        if (!naRegiaoClasses.has(token)) faltando.push(`${arquivo}: .${token}`);
      }
    }
    expect([...new Set(faltando)]).toEqual([]);
    for (const v of ['completed', 'partial', 'failed', 'in_progress']) expect(naRegiaoClasses.has(`cotacao-envio__resultado--${v}`), v).toBe(true);
  });
});
