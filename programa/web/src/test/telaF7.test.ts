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

// F7 (Suite COMEX, mock v68; boards CotacaoRespostas, ModalNovaResposta, ModalResponder, ModalItensResposta, ModalHistoricoPrecos,
// ModalCreditSupport e RespostasObservacoes): aba Respostas, Credit Support (painel e modal), Historico de precos e observacoes do fornecedor
// (#153). CSS na regiao `tela F7` do globals.css, a ultima das regioes. Esta guarda cobre: a regiao (posicao, prefixos donos, classes de
// contexto, at-rules, sem cor literal), que nada dos donos sobrou fora dela, as receitas dos boards (valores exatos), o contraste nos 2 temas e
// que os 5 TSX da fase nao tem estilo inline, token, cor literal nem glifo e que toda classe que eles usam tem regra.
// Nao exige que a F7 seja a ultima regiao: as proximas ondas (F8..F11) entram depois dela.

const NOME = 'tela F7';
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

// ---------- listas da fase ----------
// Prefixos DONOS: todo seletor da regiao (cada item da lista, sozinho) tem ao menos 1 classe com um destes prefixos.
const PREFIXOS_DONOS = ['respostas-tab', 'resposta-', 'credit-support', 'price-history', 'supplier-notes'] as const;
const ehDono = (classe: string) => PREFIXOS_DONOS.some((p) => classe.startsWith(p));
// Classes de CONTEXTO (13.7): so aparecem junto de um dono.
const CONTEXTO = new Set([
  'page-header',
  'card',
  'table',
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
  'dispatch-event',
  'muted',
  'text-sm',
  'text-xs',
  'sr-only',
]);

describe('F7: regiao `tela F7`', () => {
  it('existe uma vez, logo depois da regiao `tela F6` (so espaco entre as duas) e tem regras', () => {
    expect(rawLf.split(`/* >>> ${NOME} (Suite COMEX) >>> */`)).toHaveLength(2);
    expect(rawLf.split(`/* <<< ${NOME} <<< */`)).toHaveLength(2);
    const f6 = regs.find((r) => r.nome === 'tela F6');
    expect(f6).toBeDefined();
    expect(regiao).toBeDefined();
    expect(rawLf.slice(f6?.fim ?? 0, regiao?.inicio ?? 0).trim()).toBe('');
    expect(planas.length).toBeGreaterThan(150);
  });

  it('a regiao vem DEPOIS das regioes F3 e da compat, logo depois da tela F6 (vence as regras de componente de mesma especificidade pela ordem)', () => {
    const compat = regs.find((r) => r.nome === 'compat Forecast F3');
    expect((compat?.fim ?? Infinity) <= (regiao?.inicio ?? 0)).toBe(true);
    expect(regs.findIndex((r) => r.nome === NOME)).toBe(regs.findIndex((r) => r.nome === 'tela F6') + 1);
  });

  it('a regiao nao declara token (--*), consome var(--rf-* (e var(--paper) na previa), sem cor literal, !important nem opacity', () => {
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    expect(regiao?.limpo).toContain('var(--rf-');
    expect(regiao?.limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(regiao?.limpo).not.toContain('!important');
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])opacity\s*:/);
    const usados = [...(regiao?.limpo ?? '').matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '');
    expect(usados.filter((t) => !t.startsWith('--rf-') && t !== '--paper')).toEqual([]);
  });

  it('at-rules permitidas: so 640, pointer: coarse e reduced-motion; sem @keyframes e sem @media print; sem aninhamento', () => {
    const atRules = topo.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    const permitidas = ['@media (max-width: 1199px)', '@media (max-width: 720px)', '@media (max-width: 640px)', '@media (pointer: coarse)', '@media (prefers-reduced-motion: reduce)'];
    expect(atRules.filter((a) => !permitidas.includes(a))).toEqual([]);
    expect(new Set(atRules).size).toBe(atRules.length);
    expect(atRules).toContain('@media (max-width: 640px)');
    expect(atRules).toContain('@media (pointer: coarse)');
    expect(regiao?.limpo).not.toContain('@media print');
    expect(regiao?.limpo).not.toContain('@keyframes');
    for (const m of topo.filter((r) => r.prelude.startsWith('@media'))) {
      for (const inner of parseRules(m.body)) expect(inner.prelude.startsWith('@'), inner.prelude).toBe(false);
    }
  });
});

describe('F7: prefixos donos e classes de contexto', () => {
  const seletores = planas.flatMap((r) => listaDeSeletores(r.prelude));

  it('todo seletor tem ao menos 1 classe com prefixo dono (respostas-tab, resposta-, credit-support, price-history, supplier-notes)', () => {
    expect(seletores.length).toBeGreaterThan(150);
    expect(seletores.filter((s) => !classesDoSeletor(s).some(ehDono))).toEqual([]);
  });

  it('as demais classes de cada seletor sao de CONTEXTO (lista fixa de 13.7); classes de outras fases (F6, F8) nunca aparecem', () => {
    const alheias = [...new Set(seletores.flatMap(classesDoSeletor))].filter((c) => !ehDono(c) && !CONTEXTO.has(c));
    expect(alheias).toEqual([]);
    for (const s of seletores) {
      expect(s, s).not.toMatch(/cotacao-detalhe|cotacao-envio|cotacao-links|cotacao-item-form|itens-tab|sol-dev-painel|cmp-|\.po-|\.folder|\.fcount/);
    }
  });

  it('nenhum seletor e so da base da pagina nem usa h1-h3 como elemento (o titulo vem das classes da fase)', () => {
    for (const s of seletores) {
      expect(/(^|[\s>+~])h[1-3]\b/.test(s.replace(/\[[^\]]*\]|"[^"]*"/g, '')), s).toBe(false);
    }
    expect(seletores).not.toContain('.page');
    expect(seletores).not.toContain('.page-header');
  });

  it('as classes compartilhadas (.preview-frame, .badge, .table, .modal-actions) so entram com um dono ao lado', () => {
    for (const s of seletores) {
      const classes = classesDoSeletor(s);
      expect(classes.some(ehDono), s).toBe(true);
    }
  });
});

describe('F7: nada dos donos sobrou fora das regioes', () => {
  const foraLimpo = stripComments(fora);
  const foraSeletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));

  it('nenhuma regra .respostas-tab*, .resposta-*, .credit-support*, .price-history* ou .supplier-notes* fora da regiao', () => {
    expect(foraSeletores.filter((s) => classesDoSeletor(s).some(ehDono))).toEqual([]);
  });

  it('a F7 nao apaga regra antiga: as compartilhadas que ela usa seguem fora das regioes (.preview-frame, .muted, .form-grid, .dispatch-event)', () => {
    for (const s of ['.preview-frame', '.muted', '.form-grid', '.dispatch-event']) expect(foraSeletores, s).toContain(s);
  });
});

describe('F7: receitas dos boards (valores exatos)', () => {
  it('aba: coluna de gap 20; cabecalho com h2 e "Nova resposta" (wrap, centralizado, 12); alertas sem margem; tabela com contorno 1 px e raio 16 (D-F6-08)', () => {
    expect(naRegiao('.respostas-tab')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '20px' });
    expect(naRegiao('.respostas-tab__cabecalho')).toEqual({
      display: 'flex',
      'flex-wrap': 'wrap',
      'align-items': 'center',
      'justify-content': 'space-between',
      gap: '12px',
    });
    expect(naRegiao('.respostas-tab__titulo')).toEqual({ margin: '0' });
    expect(naRegiao('.respostas-tab .alert')).toEqual({ margin: '0' });
    expect(naRegiao('.respostas-tab .textarea')).toEqual({ padding: '12px 14px' });
    expect(naRegiao('.respostas-tab__tabela')).toEqual({ border: '1px solid var(--rf-divider)', 'border-radius': 'var(--rf-radius-card)' });
  });

  it('tabela das respostas: fornecedor 422 (390 + padding), "Condicoes de pagamento" 96 em 2 linhas, numeros a direita em mono, acao com td de 8/12 e botoes 0 8 (board)', () => {
    expect(naRegiao('.respostas-tab__tabela .respostas-tab__fornecedor')).toEqual({ width: '422px', 'min-width': '422px' });
    expect(naRegiao('.respostas-tab__tabela .respostas-tab__th-pagamento')).toEqual({ width: '96px', 'line-height': '1.35', 'white-space': 'normal' });
    expect(naRegiao('.respostas-tab__tabela .respostas-tab__num')).toEqual({ 'text-align': 'right', 'white-space': 'nowrap' });
    expect(naRegiao('.respostas-tab__mono')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-variant-numeric': 'tabular-nums' });
    expect(naRegiao('.respostas-tab__tabela .respostas-tab__acoes')).toEqual({ padding: '8px 12px' });
    expect(naRegiao('.respostas-tab__tabela .row-actions')).toEqual({ 'justify-content': 'flex-end' });
    expect(naRegiao('.respostas-tab__tabela .row-actions .ghost-button')).toEqual({ padding: '0 8px' });
    expect(naRegiao('.respostas-tab__tabela .row-actions .ghost-button:disabled')).toEqual({ background: 'var(--rf-disabled-bg)' });
  });

  it('celula do fornecedor: nome 14/700 sublinhado (3), pais e origem 12 em linha, selos de 22 (11 px) e via portal de 20, tags em linha com gap 6', () => {
    expect(naRegiao('.resposta-fornecedor')).toMatchObject({ padding: '0', color: 'var(--rf-action)', 'font-size': '14px', 'text-decoration': 'underline', 'text-underline-offset': '3px' });
    expect(naRegiao('.resposta-linha')).toEqual({ display: 'flex', 'align-items': 'center', gap: '8px', 'min-width': '0' });
    expect(naRegiao('.resposta-meta')).toMatchObject({ display: 'flex', gap: '8px', 'margin-top': '3px', 'font-size': '12px', color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.respostas-tab__tabela .badge')).toEqual({ 'min-height': '22px', padding: '0 8px', 'font-size': '11px' });
    expect(naRegiao('.respostas-tab__tabela .resposta-portal')).toEqual({ 'min-height': '20px' });
    expect(naRegiao('.respostas-tab__tabela .resposta-vencedora')).toEqual({ flex: 'none', gap: '5px' });
    expect(naRegiao('.resposta-tags')).toEqual({ display: 'flex', 'flex-wrap': 'wrap', gap: '6px', 'margin-top': '8px' });
  });

  it('observacoes (#153): 12/1,5 em --rf-ink-soft, margem 4; o texto preserva quebras (pre-wrap) e quebra em qualquer ponto; "ver mais" 12/600 sublinhado em --rf-primary-700', () => {
    expect(naRegiao('.supplier-notes')).toEqual({ 'margin-top': '4px', color: 'var(--rf-ink-soft)', 'font-size': '12px', 'line-height': '1.5' });
    expect(naRegiao('.supplier-notes__texto')).toEqual({ 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' });
    expect(naRegiao('.supplier-notes__mais')).toEqual({
      'margin-left': '4px',
      padding: '0',
      color: 'var(--rf-primary-700)',
      'font-size': '12px',
      'font-weight': '600',
      'text-decoration': 'underline',
    });
    expect(naRegiao('.supplier-notes__mais:hover:not(:disabled)')).toEqual({ color: 'var(--rf-primary-700-hover)' });
  });

  it('Nova resposta: grade de 3 colunas (gap 14/16) e grupos Custos (3) e Impostos (4) em 3fr/4fr sobre --rf-surface-alt, legenda mono 11 em caixa alta', () => {
    expect(naRegiao('.resposta-form')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '16px' });
    expect(naRegiao('.resposta-form__grade')).toEqual({ display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: '14px 16px' });
    expect(naRegiao('.resposta-form__grupos')).toEqual({ display: 'grid', 'grid-template-columns': 'minmax(0, 3fr) minmax(0, 4fr)', gap: '16px' });
    expect(naRegiao('.resposta-form__grupo')).toMatchObject({
      padding: '14px 16px 16px',
      border: '1px solid var(--rf-divider)',
      'border-radius': 'var(--rf-radius-card)',
      background: 'var(--rf-surface-alt)',
    });
    expect(naRegiao('.resposta-form__grupo > legend')).toMatchObject({
      color: 'var(--rf-primary-700)',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '11px',
      'letter-spacing': '1.5px',
      'text-transform': 'uppercase',
    });
    expect(naRegiao('.resposta-form__grade--custos')).toEqual({ 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: '12px' });
    expect(naRegiao('.resposta-form__grade--impostos')).toEqual({ 'grid-template-columns': 'repeat(4, minmax(0, 1fr))', gap: '12px' });
  });

  it('Responder: 2 colunas (gap 20); mensagem 104; historico em --rf-surface-alt (raio 12); alvos 1fr + 132; previa em papel com 406 (372 + padding e borda do board) e raio 14', () => {
    expect(naRegiao('.resposta-responder__colunas')).toEqual({ display: 'grid', 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', gap: '20px', 'align-items': 'start' });
    expect(naRegiao('.resposta-responder__coluna .textarea')).toEqual({ height: '104px', resize: 'none' });
    expect(naRegiao('.resposta-historico')).toMatchObject({ padding: '12px 14px', 'border-radius': 'var(--rf-radius-button)', background: 'var(--rf-surface-alt)' });
    expect(naRegiao('.resposta-responder__alvos-grade')).toMatchObject({ 'grid-template-columns': 'minmax(0, 1fr) 132px', gap: '8px 12px' });
    expect(naRegiao('.resposta-responder__alvo')).toMatchObject({ 'min-height': '40px', 'text-align': 'right', 'font-family': 'var(--rf-font-mono)' });
    expect(naRegiao('.resposta-responder__atualizar')).toEqual({ 'min-height': '36px', gap: '6px', padding: '0 12px', 'border-radius': 'var(--rf-radius-control)', 'font-size': '13px' });
    expect(naRegiao('.resposta-previa.preview-frame')).toMatchObject({
      height: '406px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-alert)',
      background: 'var(--paper)',
      'box-shadow': 'none',
    });
  });

  it('Itens da resposta: contorno 1 px raio 16, 13 px, th 11/12 e td 13/12, numeros em mono, linha indisponivel em --rf-surface-alt/--rf-ink-soft, Obs. de 200', () => {
    expect(naRegiao('.resposta-itens__tabela')).toEqual({ border: '1px solid var(--rf-divider)', 'border-radius': 'var(--rf-radius-card)' });
    expect(naRegiao('.resposta-itens__tabela .table')).toEqual({ 'font-size': '13px' });
    expect(naRegiao('.resposta-itens__tabela .table th')).toEqual({ padding: '11px 12px' });
    expect(naRegiao('.resposta-itens__tabela .table td')).toEqual({ padding: '13px 12px' });
    expect(naRegiao('.resposta-itens__tabela .resposta-itens__valor')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'white-space': 'nowrap' });
    expect(naRegiao('.resposta-itens__tabela .resposta-itens__linha--indisponivel td')).toEqual({ background: 'var(--rf-surface-alt)', color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.resposta-itens__tabela .resposta-itens__obs')).toEqual({ 'max-width': '200px', 'white-space': 'normal' });
  });

  it('Credit Support (painel): grupo --rf-surface-alt raio 18 (18/20), titulo sem margem, cartao branco raio 14 (16/18), badges de 24 (os do F3b), numeros em mono', () => {
    expect(naRegiao('.credit-support__grupo')).toMatchObject({
      padding: '18px 20px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-card-lg)',
      background: 'var(--rf-surface-alt)',
    });
    expect(naRegiao('.credit-support__titulo-grupo')).toEqual({ margin: '0' });
    expect(naRegiao('.credit-support__cartao')).toMatchObject({
      padding: '16px 18px',
      border: '1px solid var(--rf-divider)',
      'border-radius': 'var(--rf-radius-alert)',
      background: 'var(--rf-surface)',
    });
    expect(naRegiao('.credit-support__mono')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-variant-numeric': 'tabular-nums' });
    expect(naRegiao('.credit-support__reenviar')).toEqual({ 'min-height': '36px', gap: '6px', padding: '0 12px', 'border-radius': 'var(--rf-radius-control)', 'font-size': '13px' });
    expect(naRegiao('.credit-support__novo-link')).toMatchObject({ 'grid-template-columns': 'minmax(0, 1fr) minmax(0, 1.3fr)', gap: '16px', padding: '14px', background: 'var(--rf-surface-alt)' });
  });

  it('Credit Support (tabela): contorno raio 12, 13 px, th/td 10/12, numeros a direita em mono, totais 12 em --rf-surface-alt, detalhes em 2 colunas (gap 4/24)', () => {
    expect(naRegiao('.credit-support__tabela')).toEqual({ border: '1px solid var(--rf-divider)', 'border-radius': 'var(--rf-radius-button)' });
    expect(naRegiao('.credit-support__tabela .table th')).toEqual({ padding: '10px 12px' });
    expect(naRegiao('.credit-support__tabela .table td')).toEqual({ padding: '10px 12px', 'vertical-align': 'top' });
    expect(naRegiao('.credit-support__tabela .credit-support__num')).toEqual({ 'text-align': 'right', 'white-space': 'nowrap' });
    expect(naRegiao('.credit-support__tabela .credit-support__valor')).toMatchObject({ color: 'var(--rf-ink)', 'font-family': 'var(--rf-font-mono)' });
    expect(naRegiao('.credit-support__tabela .credit-support__totais td')).toEqual({ padding: '12px', background: 'var(--rf-surface-alt)' });
    expect(naRegiao('.credit-support__detalhes')).toMatchObject({ display: 'grid', 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', gap: '4px 24px', 'font-size': '13px' });
    expect(naRegiao('.credit-support__detalhes-cheio')).toEqual({ 'grid-column': '1 / -1', order: '1' });
  });

  it('Credit Support (modal): parceiro 1fr/1,25fr (gap 20), assunto + validade de 160, contato marcado em --rf-primary-50, previa em papel, "Pre-visualizar e-mail" com contorno', () => {
    expect(naRegiao('.credit-support-modal__parceiro')).toMatchObject({ 'grid-template-columns': 'minmax(0, 1fr) minmax(0, 1.25fr)', gap: '20px' });
    expect(naRegiao('.credit-support-modal__assunto')).toMatchObject({ 'grid-template-columns': 'minmax(0, 1fr) 160px', gap: '16px' });
    expect(naRegiao('.credit-support-modal__contato')).toMatchObject({ 'min-height': '40px', padding: '0 12px', 'border-radius': 'var(--rf-radius-button)', background: 'var(--rf-surface)' });
    expect(naRegiao('.credit-support-modal__contato:has(input:checked)')).toMatchObject({ background: 'var(--rf-primary-50)' });
    expect(naRegiao('.credit-support-modal__previa.preview-frame')).toMatchObject({ border: '1px solid var(--rf-border)', 'border-radius': 'var(--rf-radius-alert)', background: 'var(--paper)' });
    expect(naRegiao('.modal-actions .credit-support-modal__previsualizar')).toMatchObject({ border: '1.5px solid var(--rf-action)', background: 'var(--rf-surface)' });
  });

  it('Historico de precos: contorno raio 16, 13 px sem quebra, 1a coluna fixa (sticky) com divisor, celula alterada com a tinta menta (--rf-primary-50) em 700, incoterm alterado navy', () => {
    expect(naRegiao('.price-history__tabela')).toEqual({ border: '1px solid var(--rf-divider)', 'border-radius': 'var(--rf-radius-card)' });
    expect(naRegiao('.price-history__tabela .table')).toMatchObject({ 'border-collapse': 'separate', 'border-spacing': '0', 'font-size': '13px', 'white-space': 'nowrap' });
    expect(naRegiao('.price-history__tabela .table th')).toEqual({ padding: '11px 14px' });
    expect(naRegiao('.price-history__tabela .table td')).toEqual({ padding: '12px 14px', 'vertical-align': 'top' });
    expect(naRegiao('.price-history__tabela .price-history__fixa')).toMatchObject({ position: 'sticky', left: '0', 'border-right': '1px solid var(--rf-divider)', background: 'var(--rf-surface)' });
    expect(naRegiao('.price-history__tabela .price-history__celula--alterada')).toEqual({ background: 'var(--rf-primary-50)', color: 'var(--rf-ink)', 'font-weight': '700' });
    expect(naRegiao('.price-history__tabela .chip--static.price-history__incoterm--alterado')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
    expect(naRegiao(':root[data-theme="dark"] .price-history__tabela .price-history__incoterm--alterado')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
  });

  it('celular: tudo em 1 coluna ate 640 (grupos Custos/Impostos em 2) e a coluna do fornecedor encolhe para 292; pointer: coarse leva os alvos a 44', () => {
    const m = mediaDe('@media (max-width: 640px)');
    expect(declaracoes(m, '.resposta-form__grade--custos')).toEqual({ 'grid-template-columns': 'repeat(2, minmax(0, 1fr))' });
    expect(declaracoes(m, '.respostas-tab__tabela .respostas-tab__fornecedor')).toEqual({ width: '292px', 'min-width': '292px' });
    const colunas = m.filter((r) => /grid-template-columns:\s*minmax\(0, 1fr\)/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    for (const s of ['.resposta-form__grade', '.resposta-responder__colunas', '.credit-support-modal__parceiro', '.credit-support__novo-link', '.credit-support__detalhes']) {
      expect(colunas, s).toContain(s);
    }
    const coarse = mediaDe('@media (pointer: coarse)');
    const alvos44 = coarse.filter((r) => /min-height:\s*44px/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    for (const s of ['.resposta-responder__atualizar', '.resposta-responder__alvo', '.credit-support__reenviar', '.credit-support-modal__contato']) {
      expect(alvos44, s).toContain(s);
    }
    // "ver mais" inline: sem min-height de 44 (nao infla a linha da nota); o alvo de toque vem do ::after de 44 de altura
    expect(declaracoes(coarse, '.supplier-notes__mais')).toEqual({ position: 'relative', 'min-height': '0' });
    expect(declaracoes(coarse, '.supplier-notes__mais::after')).toEqual({ content: '""', position: 'absolute', top: '-14px', right: '-6px', bottom: '-14px', left: '-6px' });
    expect(alvos44).not.toContain('.supplier-notes__mais');
  });

  it('a regiao nao anima nem transiciona (so herda as transicoes de cor da F3)', () => {
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])animation\s*:/);
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])transition\s*:/);
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])transform\s*:/);
  });
});

describe('F7: fixture de tokens', () => {
  it('a fixture .f7 (se existir) so tem pares claro/escuro, nenhuma constante, e todos estao no CSS', () => {
    const f7 = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f7.json');
    expect(f7.filter((t) => t.constante)).toEqual([]);
    expect(f7.length).toBeLessThanOrEqual(4);
    for (const t of f7) {
      expect(lightTokens[t.token], t.token).toBe(t.claro);
      expect(darkTokens[t.token], t.token).toBe(t.escuro);
    }
  });

  it('a F7 nao precisou de token novo: a tinta menta do historico e o --rf-primary-50 existente', () => {
    expect(fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f7.json')).toEqual([]);
    expect(lightTokens['--rf-primary-50']).toBeDefined();
    expect(darkTokens['--rf-primary-50']).toBeDefined();
  });
});

// ---------- contraste ----------
const TEXT = 4.5;
const UI = 3;
const rf = (n: string) => `--rf-${n}`;
type Par = readonly [fg: string, bg: string, min: number];
const PARES: ReadonlyArray<Par> = [
  [rf('ink'), rf('surface'), TEXT], // nome, valores, titulos
  [rf('ink'), rf('surface-alt'), TEXT], // totais, historico, grupo
  [rf('ink-soft'), rf('surface'), TEXT], // notas, pais, origem, meta do Credit Support
  [rf('ink-soft'), rf('surface-alt'), TEXT], // meta no grupo, faixa Para/CC, cabecalho de coluna, linha indisponivel
  [rf('primary-700'), rf('surface'), TEXT], // "ver mais"
  [rf('primary-700'), rf('surface-alt'), TEXT], // "ver mais" e legendas Custos/Impostos sobre o grupo
  [rf('ink'), rf('primary-50'), TEXT], // celula alterada do historico, contato marcado
  [rf('action'), rf('surface'), TEXT], // nome do fornecedor, secundarios
  [rf('on-action'), rf('action'), TEXT], // incoterm alterado
  [rf('tone-success-fg'), rf('tone-success-bg'), TEXT], // Respondido, Vencedora (o trofeu exige 3)
  [rf('tone-warning-fg'), rf('tone-warning-bg'), TEXT], // outra origem, indisponivel, proposta mudou
  [rf('tone-danger-fg'), rf('tone-danger-bg'), TEXT], // DG, Revogado, Apagar
  [rf('tone-info-fg'), rf('tone-info-bg'), TEXT], // via portal, Enviado, PO enviada
  [rf('tone-neutral-fg'), rf('tone-neutral-bg'), TEXT], // difere da geral, Principal, Expirado
  [rf('tone-success-fg'), rf('tone-success-bg'), UI], // trofeu
  [rf('input-border'), rf('surface'), UI], // borda dos campos (D3)
];

describe('F7: contraste nos 2 temas (alpha composto sobre --rf-surface)', () => {
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
});

// ---------- TSX da fase ----------
const ARQUIVOS = [
  'pages/CotacaoTabs/RespostasTab.tsx',
  'pages/CotacaoTabs/CreditSupportPanel.tsx',
  'pages/CotacaoTabs/CreditSupportModal.tsx',
  'pages/CotacaoTabs/PriceHistoryModal.tsx',
  'components/SupplierNotes.tsx',
] as const;
const TESTIDS = new Set(['credit-support-removed', 'credit-support-result']);
const fonte = (arquivo: string) => readSource(`../${arquivo}`);
const cssInteiro = stripComments(rawLf);
const temRegra = (classe: string) => new RegExp(`\\.${classe.replace(/[-_]/g, (m) => `\\${m}`)}(?![A-Za-z0-9_-])`).test(cssInteiro);

describe('F7: TSX da fase sem estilo inline, token, cor literal nem glifo', () => {
  it.each(ARQUIVOS)('%s', (arquivo) => {
    // O "→" de "moeda: USD → EUR" (texto exigido pelo teste do modal) entra pelo escape unicode, nao pelo glifo no fonte.
    expect(fonte(arquivo)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--rf-|style=\{\{|[▸▾→]|&times;/);
  });

  it.each(ARQUIVOS)('%s: sem o "+" de texto no botao "Nova resposta" (vira icone, D-F7-01)', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/>\s*\+\s+Nova resposta|'\+ Nova resposta'/);
  });

  it('o texto do vazio que cita o botao ("+ Nova resposta") FICA (D-F7-01)', () => {
    expect(fonte('pages/CotacaoTabs/RespostasTab.tsx')).toContain('Use o botão "+ Nova resposta" para cadastrar uma proposta.');
  });
});

describe('F7: toda classe que os TSX da fase usam tem regra', () => {
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

  it('toda classe com prefixo dono citada nos TSX (inclusive em ternarios e templates) tem regra na regiao', () => {
    const naRegiaoClasses = new Set(planas.flatMap((r) => listaDeSeletores(r.prelude)).flatMap(classesDoSeletor));
    const faltando: string[] = [];
    for (const arquivo of ARQUIVOS) {
      for (const [token] of fonte(arquivo).matchAll(/(?<![\w-])(respostas-tab|resposta-|credit-support|price-history|supplier-notes)[\w-]*/g)) {
        if (token.endsWith('-')) continue; // prefixo solto
        if (TESTIDS.has(token)) continue; // data-testid, nao classe
        if (!naRegiaoClasses.has(token)) faltando.push(`${arquivo}: .${token}`);
      }
    }
    expect([...new Set(faltando)]).toEqual([]);
  });
});
