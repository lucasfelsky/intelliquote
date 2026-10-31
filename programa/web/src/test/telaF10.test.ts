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

// F10 (Suite COMEX, mock v68; boards Itens, ImportarItens, Familias, Fornecedores, ModalFornecedor, ModaisFornecedor, ImportarFornecedores, Forwarders e
// ModaisCadastro): Fornecedores (lista, TAG, linha expandida, contatos, Documentos e modais), importacoes, Itens, Familias e Forwarders. CSS na regiao
// `tela F10` do globals.css. Esta guarda cobre: a regiao (posicao, prefixos donos, classes de contexto, at-rules, sem cor literal nem token), que nada dos
// donos sobrou fora dela, as receitas dos boards (valores exatos), o contraste nos 2 temas e que os 6 TSX da fase nao tem estilo inline (fora os 8 dos
// Documentos, D-F10-03), token, cor literal, glifo nem SVG local e que toda classe que eles usam tem regra.

const NOME = 'tela F10';
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
// Prefixos DONOS: todo seletor da regiao (cada item da lista, sozinho) tem ao menos 1 classe com um destes prefixos. Nunca `itens-tab` (F6) nem `itens-` generico.
const PREFIXOS_DONOS = [
  'fornecedores-',
  'fornecedor-',
  'contact-',
  'documentos-',
  'import-modal',
  'importacao-',
  'itens-page',
  'itens-card',
  'itens-filters',
  'itens-form',
  'itens-grid',
  'itens-empty',
  'familias-',
  'familia-',
  'forwarders-',
  'forwarder-',
] as const;
const ehDono = (classe: string) => PREFIXOS_DONOS.some((p) => classe.startsWith(p));
// Classes de CONTEXTO (15.3): so aparecem junto de um dono.
const CONTEXTO = new Set([
  'card',
  'table',
  'table-wrapper',
  'row-actions',
  'cell-truncate',
  'col-status',
  'badge',
  'badge--warning',
  'badge--danger',
  'chip',
  'chip--active',
  'alert',
  'empty-state',
  'empty-state__icon',
  'empty-state__title',
  'empty-state__text',
  'btn-spinner',
  'ghost-button',
  'primary-button',
  'danger-button',
  'input',
  'textarea',
  'field',
  'field-label',
  'checkbox-field',
  'modal-actions',
  'page-header',
  'page-subtitle',
  'pagination',
]);
// Donos de F4-F9 e da F11: a F10 nunca os cita.
const ALHEIOS =
  /\.itens-tab(?![\w-])|login-|cotacoes-|cotacao-|\.cmp-|info-chip|info-popover|respostas-tab|\.resposta-|credit-support|price-history|supplier-notes|\.po-|solicitacoes-|solicitacao-|\.sol-|anexos-|vincular-catalogo|overview-|\.kpi|relatorios-|usuarios-|usuario-|empresa-|\.cc-|parceiros-credito|parceiro-credito|auditoria-|templates-|\.template-|preview-popout|minha-conta|assinatura-|\.manual-|paper-surface|jodit-/;

describe('F10: regiao `tela F10`', () => {
  it('existe uma vez, logo depois da regiao `tela F9` (so espaco entre as duas) e tem regras', () => {
    expect(rawLf.split(`/* >>> ${NOME} (Suite COMEX) >>> */`)).toHaveLength(2);
    expect(rawLf.split(`/* <<< ${NOME} <<< */`)).toHaveLength(2);
    const f9 = regs.find((r) => r.nome === 'tela F9');
    expect(f9).toBeDefined();
    expect(regiao).toBeDefined();
    expect(rawLf.slice(f9?.fim ?? 0, regiao?.inicio ?? 0).trim()).toBe('');
    expect(planas.length).toBeGreaterThan(200);
  });

  it('a regiao vem DEPOIS das regioes F3 e da compat, logo depois da tela F9 (vence as regras de componente de mesma especificidade pela ordem)', () => {
    const compat = regs.find((r) => r.nome === 'compat Forecast F3');
    expect((compat?.fim ?? Infinity) <= (regiao?.inicio ?? 0)).toBe(true);
    expect(regs.findIndex((r) => r.nome === NOME)).toBe(regs.findIndex((r) => r.nome === 'tela F9') + 1);
  });

  it('a regiao nao declara token (--*), consome var(--rf-*), sem cor literal, !important nem @media print', () => {
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    expect(regiao?.limpo).toContain('var(--rf-');
    expect(regiao?.limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(regiao?.limpo).not.toContain('!important');
    expect(regiao?.limpo).not.toContain('@media print');
    const usados = [...(regiao?.limpo ?? '').matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '');
    expect(usados.filter((t) => !t.startsWith('--rf-'))).toEqual([]);
  });

  it('at-rules permitidas: 1080, 1023, 719, 640, 540, pointer: coarse e reduced-motion; sem @keyframes; sem aninhamento', () => {
    const atRules = topo.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    const permitidas = [
      '@media (max-width: 1080px)',
      '@media (max-width: 1023px)',
      '@media (max-width: 719px)',
      '@media (max-width: 640px)',
      '@media (max-width: 540px)',
      '@media (pointer: coarse)',
      '@media (prefers-reduced-motion: reduce)',
    ];
    expect(atRules.filter((a) => !permitidas.includes(a))).toEqual([]);
    expect(new Set(atRules).size).toBe(atRules.length);
    for (const a of permitidas) expect(atRules, a).toContain(a);
    expect(regiao?.limpo).not.toContain('@keyframes');
    for (const m of topo.filter((r) => r.prelude.startsWith('@media'))) {
      for (const inner of parseRules(m.body)) expect(inner.prelude.startsWith('@'), inner.prelude).toBe(false);
    }
  });
});

describe('F10: prefixos donos e classes de contexto', () => {
  const seletores = planas.flatMap((r) => listaDeSeletores(r.prelude));

  it('todo seletor tem ao menos 1 classe com prefixo dono (fornecedores-, fornecedor-, contact-, documentos-, import-modal, importacao-, itens-page/card/filters/form/grid/empty, familias-, familia-, forwarders-, forwarder-)', () => {
    expect(seletores.length).toBeGreaterThan(200);
    expect(seletores.filter((s) => !classesDoSeletor(s).some(ehDono))).toEqual([]);
  });

  it('as demais classes de cada seletor sao de CONTEXTO (lista fixa de 15.3); donos de F4-F9 e da F11 nunca aparecem (nem itens-tab)', () => {
    const alheias = [...new Set(seletores.flatMap(classesDoSeletor))].filter((c) => !ehDono(c) && !CONTEXTO.has(c));
    expect(alheias).toEqual([]);
    for (const s of seletores) expect(s, s).not.toMatch(ALHEIOS);
  });

  it('nenhum seletor e so da base da pagina (.page, .page-header) nem de contexto sozinho', () => {
    expect(seletores).not.toContain('.page');
    expect(seletores).not.toContain('.page-header');
    for (const s of seletores) {
      expect(s, s).not.toMatch(/^\.(card|table|badge|chip|alert|empty-state|input|textarea|field|ghost-button|primary-button|modal-actions|pagination)(?![\w-])/);
    }
  });

  it('a unica excecao de :has() da regiao e a linha expandida (lado a lado so sem contatos nem documentos) e o foco do campo de arquivo/filtro', () => {
    const comHas = seletores.filter((s) => s.includes(':has('));
    expect(comHas.length).toBeGreaterThan(0);
    for (const s of comHas) {
      expect(s, s).toMatch(/fornecedores-expandida__grade|documentos-arquivo|importacao-arquivo|itens-filters__toggle/);
    }
  });
});

describe('F10: nada dos donos sobrou fora das regioes', () => {
  const cssInteiro = stripComments(rawLf);
  const foraLimpo = stripComments(fora);
  const foraSeletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));
  const DONO_ANTIGO =
    /^(contact-|itens-(page|card|filters|form|grid|empty|summary)|import-modal|fornecedor|documentos-|familia|forwarder)/;

  it('nenhuma regra .contact-*, .itens-page*, .itens-card*, .itens-filters*, .itens-form*, .itens-grid, .itens-empty, .itens-summary*, .import-modal*, .fornecedor*, .documentos-*, .familia* ou .forwarder* fora da regiao', () => {
    expect(foraSeletores.filter((s) => classesDoSeletor(s).some((c) => DONO_ANTIGO.test(c)))).toEqual([]);
  });

  it('a F10 nao apaga regra compartilhada nem de outro dono: .itens-tab* (F6), .text-sm, .text-xs, .sr-only e .form-grid seguem fora das regioes', () => {
    expect(cssInteiro).toMatch(/\.itens-tab(?![\w-])/);
    for (const s of ['.text-sm', '.text-xs', '.sr-only', '.form-grid']) expect(foraSeletores, s).toContain(s);
  });
});

describe('F10: receitas dos boards (valores exatos)', () => {
  it('TAG da linha (D-F10-01): span de 20 px, padding 0 8, raio pilula, 11/600 em --rf-tone-neutral-fg sobre --rf-surface-alt, borda --rf-border; sem cursor nem hover', () => {
    expect(naRegiao('.fornecedores-tag')).toEqual({
      display: 'inline-flex',
      'align-items': 'center',
      'box-sizing': 'border-box',
      height: '20px',
      padding: '0 8px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-pill)',
      background: 'var(--rf-surface-alt)',
      color: 'var(--rf-tone-neutral-fg)',
      'font-size': '11px',
      'font-weight': '600',
    });
    expect(naRegiao('.fornecedores-tags')).toEqual({ display: 'flex', 'flex-wrap': 'wrap', gap: '4px', 'margin-top': '5px' });
    expect(regiao?.limpo).not.toMatch(/\.fornecedores-tag(?![\w-])[^{]*:hover/);
    expect(naRegiao('.fornecedores-tag')).not.toHaveProperty('cursor');
  });

  it('expandir: 32 x 32, raio 10 (--rf-radius-control), fundo --rf-surface-alt; aberto em --rf-action / --rf-on-action; foco com anel; 44 em pointer: coarse', () => {
    expect(naRegiao('.fornecedores-expandir__botao')).toMatchObject({
      width: '32px',
      height: '32px',
      padding: '0',
      border: '0',
      'border-radius': 'var(--rf-radius-control)',
      background: 'var(--rf-surface-alt)',
      color: 'var(--rf-action)',
    });
    expect(naRegiao('.fornecedores-expandir__botao[aria-expanded="true"]')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
    expect(naRegiao('.fornecedores-expandir__botao:focus-visible')).toMatchObject({ 'box-shadow': '0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-action)' });
    expect(declaracoes(mediaDe('@media (pointer: coarse)'), '.fornecedores-expandir__botao')).toEqual({ width: '44px', height: '44px' });
  });

  it('cartao da lista: raio 22 do .card, padding 0 e overflow oculto; busca 280 x 44 com recuo 12; filtro de etiquetas com padding 16/20/14 e gap 8', () => {
    expect(naRegiao('.fornecedores-page .fornecedores-lista')).toEqual({ padding: '0', overflow: 'hidden' });
    expect(naRegiao('.fornecedores-busca')).toMatchObject({
      width: '280px',
      height: '44px',
      padding: '0 12px',
      border: '1.5px solid var(--rf-input-border)',
      'border-radius': 'var(--rf-radius-control)',
      gap: '8px',
    });
    expect(naRegiao('.fornecedores-busca:focus-within')).toEqual({ 'border-color': 'var(--rf-action)', 'box-shadow': '0 0 0 4px var(--rf-focus-halo)' });
    expect(naRegiao('.fornecedores-filtro')).toEqual({ display: 'flex', 'flex-wrap': 'wrap', gap: '8px', padding: '16px 20px 14px' });
  });

  it('tabela densa: cabecalho 10/12 com borda de cima, 1a coluna 68 (40 + padding) com recuo 20, linhas 10/12, status a esquerda, acoes de 36 a direita', () => {
    expect(naRegiao('.fornecedores-page .fornecedores-tabela > thead > tr > th')).toEqual({ padding: '10px 12px', 'border-top': '1px solid var(--rf-divider)' });
    expect(naRegiao('.fornecedores-page .fornecedores-tabela > thead > tr > th:first-child')).toEqual({ width: '68px', padding: '10px 8px 10px 20px' });
    expect(naRegiao('.fornecedores-page .fornecedores-tabela > thead > tr > th:last-child')).toEqual({ padding: '10px 20px 10px 12px' });
    expect(naRegiao('.fornecedores-page .fornecedores-tabela > tbody > tr.fornecedores-linha > td')).toEqual({
      padding: '10px 12px',
      'vertical-align': 'middle',
      'white-space': 'nowrap',
    });
    expect(naRegiao('.fornecedores-page .fornecedores-tabela > tbody > tr > td.fornecedores-expandir')).toEqual({ padding: '10px 8px 10px 20px' });
    expect(naRegiao('.fornecedores-page .fornecedores-tabela > tbody > tr.fornecedores-linha > td:last-child')).toEqual({ padding: '8px 20px 8px 12px' });
    expect(naRegiao('.fornecedores-page .fornecedores-tabela > tbody > tr.fornecedores-linha > td.cell-truncate')).toEqual({ 'max-width': '160px' });
    expect(naRegiao('.fornecedores-page .fornecedores-tabela > tbody > tr.fornecedores-linha .row-actions')).toEqual({ 'justify-content': 'flex-end', gap: '4px' });
    expect(naRegiao('.fornecedores-page .fornecedores-tabela > tbody > tr.fornecedores-linha > td.fornecedores-incoterms')).toEqual({
      'font-family': 'var(--rf-font-mono)',
      'font-size': '12px',
      'font-weight': '600',
    });
    expect(naRegiao('.fornecedores-page .fornecedores-tabela > tbody > tr.fornecedores-linha--aberta > td')).toEqual({ 'border-bottom': '0' });
  });

  it('selo de documento 22 (11/700, gap 5, padding 0 8) e avaliacao com "(n)" 12 em --rf-ink-soft', () => {
    expect(naRegiao('.fornecedores-page .fornecedores-doc')).toEqual({ gap: '5px', 'min-height': '22px', padding: '0 8px', 'font-size': '11px' });
    expect(naRegiao('.fornecedores-avaliacao')).toEqual({ display: 'inline-flex', 'align-items': 'center', gap: '2px' });
    expect(naRegiao('.fornecedores-avaliacao__n')).toEqual({ 'margin-left': '2px', color: 'var(--rf-ink-soft)', 'font-size': '12px' });
  });

  it('linha expandida: padding 16/20/20, fundo --rf-surface-alt, faixa interna de 3 px em --rf-primary, contornos --rf-divider; grade empilhada ou 2 colunas (so sem contatos e documentos)', () => {
    expect(naRegiao('.fornecedores-page .fornecedores-tabela > tbody > tr.fornecedores-linha-detalhe > td.fornecedores-expandida')).toMatchObject({
      padding: '16px 20px 20px',
      'border-top': '1px solid var(--rf-divider)',
      'border-bottom': '1px solid var(--rf-divider)',
      background: 'var(--rf-surface-alt)',
      'box-shadow': 'inset 3px 0 0 var(--rf-primary)',
    });
    expect(naRegiao('.fornecedores-expandida__grade')).toEqual({ display: 'grid', 'grid-template-columns': 'minmax(0, 1fr)', 'row-gap': '20px' });
    const vazia = '.fornecedores-expandida__grade:not(:has(.contact-list, .documentos-tabela, .documentos-cartoes))';
    expect(naRegiao(vazia)).toEqual({ 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', gap: '16px', 'align-items': 'start' });
    expect(declaracoes(mediaDe('@media (max-width: 1023px)'), vazia)).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(naRegiao('.fornecedores-secao')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '10px', 'min-width': '0' });
    expect(naRegiao(`${vazia} .fornecedores-secao`)).toEqual({ gap: '8px' });
    expect(naRegiao('.fornecedores-secao__vazio')).toEqual({ margin: '0', color: 'var(--rf-ink-soft)', 'font-size': '13px', 'line-height': '1.5' });
  });

  it('"Adicionar contato" e "Novo documento": secundario de 36 (raio 10, borda 1,5 --rf-action) mesmo dentro da tabela', () => {
    expect(naRegiao('.fornecedores-page .fornecedores-secao__cabecalho .ghost-button')).toEqual({
      'min-height': '36px',
      padding: '0 12px',
      gap: '6px',
      border: '1.5px solid var(--rf-action)',
      'border-radius': 'var(--rf-radius-control)',
      background: 'var(--rf-surface)',
      color: 'var(--rf-action)',
      'font-size': '13px',
    });
    expect(naRegiao('.documentos-cabecalho')).toMatchObject({ display: 'flex', 'justify-content': 'space-between', gap: '12px', 'margin-bottom': '10px' });
  });

  it('contatos: linha em grade 22 / 1fr / auto / auto (gap 14, 10/14, raio 12), nome 14/700, meta 12 em --rf-ink-soft, data mono 12, acoes de 32', () => {
    expect(naRegiao('.contact-list')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '6px' });
    expect(naRegiao('.contact-row')).toEqual({
      display: 'grid',
      'grid-template-columns': '22px minmax(0, 1fr) auto auto',
      'align-items': 'center',
      gap: '14px',
      padding: '10px 14px',
      border: '1px solid var(--rf-divider)',
      'border-radius': 'var(--rf-radius-button)',
      background: 'var(--rf-surface)',
    });
    expect(naRegiao('.contact-row > input[type="checkbox"]')).toEqual({ width: '18px', height: '18px', margin: '0', 'accent-color': 'var(--rf-action)' });
    expect(naRegiao('.contact-row__name')).toEqual({ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '14px', 'font-weight': '700', color: 'var(--rf-ink)' });
    expect(naRegiao('.contact-row .contact-row__principal')).toEqual({ 'min-height': '20px', padding: '0 8px', 'font-size': '10px' });
    expect(naRegiao('.contact-row__meta')).toMatchObject({ color: 'var(--rf-ink-soft)', 'font-size': '12px', 'white-space': 'nowrap' });
    expect(naRegiao('.contact-row__data')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '12px', 'font-weight': '500' });
    expect(naRegiao('.contact-row .contact-row__actions .ghost-button')).toEqual({ 'min-height': '32px', padding: '0 10px' });
  });

  it('Documentos: cartao raio 14 com layout fixo no TSX, th 9/12 (1a 9/12/9/14), td 8/12, vencimento mono 12, situacao com ponto, acoes de 32', () => {
    expect(naRegiao('.documentos-tabela')).toEqual({
      overflow: 'hidden',
      border: '1px solid var(--rf-divider)',
      'border-radius': 'var(--rf-radius-alert)',
      background: 'var(--rf-surface)',
    });
    expect(naRegiao('.documentos-tabela .table')).toEqual({ 'font-size': '13px' });
    expect(naRegiao('.documentos-tabela .table th')).toEqual({ 'box-sizing': 'content-box', padding: '9px 12px', 'border-top': '0' });
    expect(naRegiao('.documentos-tabela .table th:first-child')).toEqual({ padding: '9px 12px 9px 14px' });
    expect(naRegiao('.documentos-tabela .table tbody > tr > td')).toEqual({ padding: '8px 12px', background: 'transparent' });
    expect(naRegiao('.documentos-tabela .table tbody > tr > td.documentos-acoes-celula')).toEqual({ padding: '6px 14px 6px 12px' });
    expect(naRegiao('.documentos-tabela .table tbody > tr > td.documentos-vencimento')).toMatchObject({
      'font-family': 'var(--rf-font-mono)',
      'font-size': '12px',
      'white-space': 'nowrap',
    });
    expect(naRegiao('.documentos-situacao::before')).toEqual({
      content: '""',
      flex: 'none',
      width: '6px',
      height: '6px',
      'border-radius': 'var(--rf-radius-pill)',
      background: 'var(--rf-tone-success-solid)',
    });
    expect(naRegiao('.documentos-situacao.badge--warning::before')).toEqual({ background: 'var(--rf-tone-warning-solid)' });
    expect(naRegiao('.documentos-situacao.badge--danger::before')).toEqual({ background: 'var(--rf-tone-danger-solid)' });
    expect(naRegiao('.documentos-tabela .documentos-acoes .ghost-button')).toEqual({ 'min-height': '32px', padding: '0 8px' });
    expect(naRegiao('.documentos-acoes')).toEqual({ 'justify-content': 'flex-end', gap: '2px' });
  });

  it('modais do documento: grade 150 / 1fr (gap 14/12), campo de arquivo em caixa de 44 com botao de 32 e nome em --rf-ink (vazio em --rf-ink-soft)', () => {
    expect(naRegiao('.documentos-form__grade')).toEqual({ display: 'grid', 'grid-template-columns': '150px minmax(0, 1fr)', 'align-items': 'start', gap: '14px 12px' });
    expect(declaracoes(mediaDe('@media (max-width: 719px)'), '.documentos-form__grade')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(naRegiao('.documentos-arquivo')).toMatchObject({
      height: '44px',
      padding: '0 8px 0 6px',
      border: '1.5px solid var(--rf-input-border)',
      'border-radius': 'var(--rf-radius-control)',
    });
    expect(naRegiao('.documentos-arquivo__input')).toMatchObject({ position: 'absolute', width: '1px', height: '1px', opacity: '0' });
    expect(naRegiao('.documentos-arquivo__botao')).toMatchObject({
      height: '32px',
      padding: '0 10px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-xs)',
      background: 'var(--rf-surface-alt)',
      color: 'var(--rf-action)',
      'font-size': '12px',
      'font-weight': '700',
    });
    expect(naRegiao('.documentos-arquivo__nome--vazio')).toEqual({ color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.documentos-campo .documentos-form__data')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '13px' });
    expect(naRegiao('.documentos-form .documentos-atual')).toMatchObject({ padding: '12px 14px', background: 'var(--rf-surface-alt)', 'border-radius': 'var(--rf-radius-button)' });
  });

  it('modais do fornecedor: coluna de gap 14, campos de gap 6, chips de 34 (Incoterms em mono 12; marcado com borda --rf-action) e etiqueta de 30 com x', () => {
    expect(naRegiao('.fornecedor-form')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '14px' });
    expect(naRegiao('.fornecedores-page .fornecedor-form > .modal-actions:last-child')).toEqual({ 'margin-top': '6px' });
    expect(naRegiao('.fornecedor-campo')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '6px', 'min-width': '0' });
    expect(naRegiao('.fornecedor-form__duplo')).toEqual({ display: 'grid', 'grid-template-columns': '1fr 1fr', 'align-items': 'start', gap: '12px' });
    expect(naRegiao('.fornecedor-grupo')).toEqual({ gap: '8px' });
    expect(naRegiao('.fornecedor-grupo--familias')).toEqual({ gap: '6px' });
    expect(naRegiao('.fornecedor-chips .chip')).toEqual({ gap: '5px', 'min-height': '34px', padding: '0 12px' });
    expect(naRegiao('.fornecedor-chips .chip.chip--active')).toEqual({ border: '1px solid var(--rf-action)', 'font-weight': '600' });
    expect(naRegiao('.fornecedor-chips--mono .chip')).toEqual({ 'font-family': 'var(--rf-font-mono)', 'font-size': '12px' });
    expect(naRegiao('.fornecedor-chips .chip.fornecedor-etiqueta')).toEqual({ gap: '6px', 'min-height': '30px', padding: '0 8px 0 12px', border: '0' });
    expect(naRegiao('.fornecedor-form .fornecedor-dica')).toMatchObject({ margin: '0', 'font-size': '12px', color: 'var(--rf-ink-soft)' });
    expect(declaracoes(mediaDe('@media (max-width: 540px)'), '.fornecedor-form__duplo')).toEqual({ 'grid-template-columns': '1fr' });
  });

  it('importacoes: passo em coluna de gap 14, rodape em faixa (D-F3-11), colunas numeradas em 2 colunas, campo de arquivo pontilhado de raio 14, alertas de raio 14', () => {
    expect(naRegiao('.importacao-passo')).toEqual({ display: 'flex', flex: '1 1 auto', 'flex-direction': 'column', gap: '14px' });
    expect(naRegiao('.importacao-passo > .modal-actions:last-child')).toEqual({
      margin: 'auto -24px -20px',
      padding: '16px 24px',
      'border-top': '1px solid var(--rf-divider)',
      background: 'var(--rf-surface-alt)',
    });
    expect(naRegiao('.importacao-colunas')).toMatchObject({ padding: '12px 14px 12px 34px', 'border-radius': 'var(--rf-radius-alert)', background: 'var(--rf-surface-alt)', 'font-size': '13px' });
    expect(naRegiao('.importacao-colunas.importacao-colunas--grade')).toMatchObject({
      display: 'grid',
      'grid-auto-flow': 'column',
      'grid-template-columns': '1fr 1fr',
      'grid-template-rows': 'repeat(6, auto)',
      gap: '6px 12px',
      'list-style': 'none',
    });
    expect(naRegiao('.importacao-colunas--grade > li::before')).toMatchObject({ width: '18px', 'font-family': 'var(--rf-font-mono)', 'font-size': '11px', color: 'var(--rf-primary-700)' });
    expect(naRegiao('.importacao-arquivo')).toMatchObject({
      display: 'flex',
      gap: '12px',
      padding: '14px',
      border: '1.5px dashed var(--rf-input-border)',
      'border-radius': 'var(--rf-radius-alert)',
    });
    expect(naRegiao('.importacao-arquivo__icone')).toMatchObject({ width: '40px', height: '40px', 'border-radius': 'var(--rf-radius-control)', background: 'var(--rf-tone-success-bg)' });
    expect(naRegiao('.importacao-arquivo__botao')).toMatchObject({ height: '38px', padding: '0 12px', border: '1.5px solid var(--rf-action)', 'border-radius': 'var(--rf-radius-control)' });
    expect(naRegiao('.importacao-alerta')).toMatchObject({ display: 'flex', gap: '10px', padding: '12px 16px', 'border-radius': 'var(--rf-radius-alert)', 'font-size': '14px', 'font-weight': '600' });
    expect(naRegiao('.importacao-alerta__lista')).toEqual({ margin: '0', 'padding-left': '18px', 'font-size': '13px', 'font-weight': '500', 'line-height': '1.55' });
    expect(naRegiao('.importacao-alerta > svg')).toEqual({ flex: 'none', 'margin-top': '1px' });
    expect(naRegiao('.importacao-itens .importacao-alerta')).toEqual({ 'max-height': '150px', 'overflow-y': 'auto' });
  });

  it('Itens: gap da pagina 18 (D-F10-05), filtros em cartao de raio 18 com sombra de repouso, split 1,45fr/1fr de gap 18 (1 coluna ate 1080), grade minmax(260px, 1fr) de gap 12', () => {
    expect(naRegiao('.itens-page')).toEqual({ gap: '18px' });
    expect(naRegiao('.itens-filters')).toEqual({
      display: 'flex',
      'flex-wrap': 'wrap',
      'align-items': 'center',
      gap: '12px',
      padding: '12px 16px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-card-lg)',
      background: 'var(--rf-surface)',
      'box-shadow': 'var(--rf-shadow-rest)',
    });
    expect(naRegiao('.itens-filters__search')).toMatchObject({ flex: '1 1 320px', height: '44px', padding: '0 12px', border: '1.5px solid var(--rf-input-border)', gap: '8px' });
    expect(naRegiao('.itens-filters__toggle')).toMatchObject({ height: '40px', padding: '0 14px', 'border-radius': 'var(--rf-radius-control)', gap: '8px' });
    expect(naRegiao('.itens-filters__toggle.itens-filters__toggle--active')).toEqual({
      'border-color': 'var(--rf-primary-700)',
      background: 'var(--rf-tone-success-bg)',
      color: 'var(--rf-tone-success-fg)',
    });
    expect(naRegiao('.itens-page__split')).toEqual({
      display: 'grid',
      'grid-template-columns': 'minmax(0, 1.45fr) minmax(0, 1fr)',
      'align-items': 'start',
      gap: '18px',
    });
    expect(declaracoes(mediaDe('@media (max-width: 1080px)'), '.itens-page__split')).toEqual({ 'grid-template-columns': '1fr' });
    expect(naRegiao('.itens-page .itens-page__catalogo')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '14px', padding: '20px 22px 8px' });
    expect(naRegiao('.itens-grid')).toEqual({ display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' });
  });

  it('cartao do item: raio 16, padding 14, gap 8, sombra de repouso; editando em --rf-action-hover-bg com anel de 1,5; inativo em --rf-surface-alt com 0,78; acoes de 28', () => {
    expect(naRegiao('.itens-card')).toMatchObject({
      display: 'flex',
      'flex-direction': 'column',
      gap: '8px',
      padding: '14px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-card)',
      background: 'var(--rf-surface)',
      'box-shadow': 'var(--rf-shadow-rest)',
      'text-align': 'left',
    });
    expect(naRegiao('.itens-card.itens-card--editando')).toEqual({
      'border-color': 'var(--rf-action)',
      background: 'var(--rf-action-hover-bg)',
      'box-shadow': 'inset 0 0 0 1.5px var(--rf-action)',
    });
    expect(naRegiao('.itens-card.itens-card--inactive')).toEqual({ background: 'var(--rf-surface-alt)', opacity: '0.78' });
    expect(naRegiao('.itens-card__name')).toEqual({ 'font-size': '15px', 'font-weight': '700', 'line-height': '1.3' });
    expect(naRegiao('.itens-card__badges')).toMatchObject({ gap: '4px', 'max-width': '120px', 'justify-content': 'flex-end' });
    expect(naRegiao('.itens-card .itens-card__badge')).toEqual({ 'min-height': '22px', padding: '0 8px', 'font-size': '11px' });
    expect(naRegiao('.itens-card__notes')).toMatchObject({ 'padding-top': '8px', 'border-top': '1px dashed var(--rf-border)', 'font-size': '12px', 'line-height': '1.45' });
    expect(naRegiao('.itens-card__meta strong')).toEqual({ color: 'var(--rf-ink)', 'font-family': 'var(--rf-font-mono)', 'font-weight': '600' });
    expect(naRegiao('.itens-card .itens-card__action')).toMatchObject({
      'min-height': '28px',
      padding: '0 10px',
      'border-radius': 'var(--rf-radius-xs)',
      background: 'var(--rf-surface-alt)',
      color: 'var(--rf-action)',
      'font-size': '12px',
    });
    expect(naRegiao('.itens-card .itens-card__action--danger')).toEqual({ color: 'var(--rf-tone-danger-fg)' });
    expect(naRegiao('.itens-card--inactive .itens-card__action--reativar')).toEqual({ background: 'var(--rf-surface)' });
  });

  it('formulario lateral: sticky top 16, padding 20/22/22, gap 12, sombra --rf-shadow-hover; NCM e Codigo DBCorp em mono (1fr 1fr; 1 coluna ate 540); botoes de 44', () => {
    expect(naRegiao('.itens-page .itens-form-card')).toEqual({
      position: 'sticky',
      top: '16px',
      display: 'flex',
      'flex-direction': 'column',
      gap: '12px',
      padding: '20px 22px 22px',
      'box-shadow': 'var(--rf-shadow-hover)',
    });
    expect(declaracoes(mediaDe('@media (max-width: 1080px)'), '.itens-page .itens-form-card')).toEqual({ position: 'static' });
    expect(naRegiao('.itens-form__cabecalho > span')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '11px', 'letter-spacing': '1.5px', 'text-transform': 'uppercase' });
    expect(naRegiao('.itens-form')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '12px', margin: '0' });
    expect(naRegiao('.itens-form__row')).toEqual({ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '12px' });
    expect(naRegiao('.itens-form__row .input')).toEqual({ 'min-width': '0', 'font-family': 'var(--rf-font-mono)' });
    expect(declaracoes(mediaDe('@media (max-width: 540px)'), '.itens-form__row')).toEqual({ 'grid-template-columns': '1fr' });
    expect(naRegiao('.itens-form__actions')).toEqual({ display: 'flex', 'justify-content': 'flex-end', gap: '8px', 'margin-top': '2px' });
    expect(naRegiao('.itens-form__actions .primary-button')).toEqual({ padding: '0 18px' });
  });

  it('Familias: cartao colado, th 12/16 (ID 116 = 80 + padding), ID mono 13 em --rf-ink-soft, nome 700, acoes com gap 4 e icone; modal em coluna de gap 14', () => {
    expect(naRegiao('.familias-page .familias-lista')).toEqual({ padding: '0', overflow: 'hidden' });
    expect(naRegiao('.familias-lista__aviso')).toEqual({ padding: '16px 20px 4px' });
    expect(naRegiao('.familias-lista__aviso + .table-wrapper')).toEqual({ 'margin-top': '12px' });
    expect(naRegiao('.familias-page .familias-tabela > thead > tr > th:first-child')).toEqual({ width: '116px', padding: '12px 16px 12px 20px' });
    expect(naRegiao('.familias-page .familias-tabela > tbody > tr > td.familias-id')).toMatchObject({
      padding: '10px 16px 10px 20px',
      color: 'var(--rf-ink-soft)',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '13px',
    });
    expect(naRegiao('.familias-tabela .row-actions .ghost-button')).toEqual({ gap: '6px' });
    expect(naRegiao('.familias-form')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '14px' });
    expect(naRegiao('.familias-page .familias-form > .modal-actions:last-child')).toEqual({ 'margin-top': '6px' });
    expect(naRegiao('.familias-estado .empty-state')).toEqual({ padding: '22px' });
    expect(naRegiao('.forwarders-estado .empty-state')).toEqual({ padding: '22px' });
  });

  it('Forwarders: aviso "Apenas consulta" em faixa (13 em --rf-ink-soft), th 12 sem borda de cima, selo Padrao em --rf-action-hover-bg, vazio de 22, modal em 2 colunas por coluna', () => {
    expect(naRegiao('.forwarders-lista .forwarders-aviso')).toMatchObject({
      display: 'flex',
      gap: '8px',
      padding: '10px 14px',
      background: 'var(--rf-surface-alt)',
      color: 'var(--rf-ink-soft)',
      'font-size': '13px',
    });
    expect(naRegiao('.forwarders-page .forwarders-tabela > thead > tr > th')).toEqual({ padding: '12px' });
    expect(naRegiao('.forwarders-page .forwarders-tabela > tbody > tr > td')).toEqual({ padding: '12px', 'white-space': 'nowrap' });
    expect(naRegiao('.forwarders-empresa .forwarders-padrao')).toEqual({
      gap: '5px',
      'min-height': '22px',
      padding: '0 9px',
      background: 'var(--rf-action-hover-bg)',
      color: 'var(--rf-action)',
      'font-size': '11px',
    });
    expect(naRegiao('.forwarders-page .forwarders-tabela > tbody > tr > td.forwarders-endereco')).toEqual({ 'max-width': '320px' });
    expect(naRegiao('.forwarder-form__grade')).toEqual({
      display: 'grid',
      'grid-auto-flow': 'column',
      'grid-template-columns': '1fr 1fr',
      'grid-template-rows': 'auto auto',
      'align-items': 'start',
      gap: '14px 16px',
    });
    expect(declaracoes(mediaDe('@media (max-width: 640px)'), '.forwarder-form__grade')).toEqual({
      'grid-auto-flow': 'row',
      'grid-template-columns': 'minmax(0, 1fr)',
      'grid-template-rows': 'none',
    });
    expect(naRegiao('.forwarder-campo .textarea')).toEqual({ height: '72px', padding: '12px 14px', 'line-height': '1.5', resize: 'none' });
    expect(naRegiao('.forwarder-contato')).toEqual({ 'min-width': '0', margin: '0', padding: '10px 16px 14px', border: '1px solid var(--rf-border)', 'border-radius': 'var(--rf-radius-alert)' });
    expect(naRegiao('.forwarder-contato__legenda')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '11px', 'letter-spacing': '1px', color: 'var(--rf-primary-700)' });
    expect(naRegiao('.forwarder-contato__grade')).toEqual({ display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: '12px' });
    expect(declaracoes(mediaDe('@media (max-width: 640px)'), '.forwarder-contato__grade')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(naRegiao('.forwarder-form__opcoes')).toEqual({ display: 'flex', 'flex-wrap': 'wrap', gap: '10px 28px' });
    expect(naRegiao('.forwarder-contato .forwarder-contato__acoes .ghost-button')).toMatchObject({ 'min-height': '36px', padding: '0 12px', gap: '6px' });
  });

  it('pointer: coarse leva os alvos de 28 a 36 a 44 (expandir, acoes, chips, botoes de contato e de arquivo, cartoes e acoes do Itens)', () => {
    const coarse = mediaDe('@media (pointer: coarse)');
    const alvos44 = coarse.filter((r) => /min-height:\s*44px|height:\s*44px/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    for (const s of [
      '.fornecedores-expandir__botao',
      '.fornecedores-page .fornecedores-secao__cabecalho .ghost-button',
      '.fornecedores-page .documentos-cabecalho .ghost-button',
      '.contact-row .contact-row__actions .ghost-button',
      '.documentos-tabela .documentos-acoes .ghost-button',
      '.documentos-cartao .documentos-acoes .ghost-button',
      '.importacao-passo > .importacao-modelo',
      '.forwarder-contato .forwarder-contato__acoes .ghost-button',
      '.forwarder-form__campos > .forwarder-form__adicionar',
      '.fornecedor-chips .chip',
      '.fornecedor-chips .chip.fornecedor-etiqueta',
      '.fornecedores-filtro .chip',
      '.documentos-arquivo',
      '.documentos-arquivo__botao',
      '.importacao-arquivo__botao',
      '.itens-filters__toggle',
      '.itens-card .itens-card__action',
    ]) {
      expect(alvos44, s).toContain(s);
    }
    // a busca (borda de 1,5 + campo interno de 100%) vai a 48 para o campo medir >= 44
    expect(declaracoes(coarse, '.fornecedores-busca')).toEqual({ height: '48px' });
    expect(declaracoes(coarse, '.itens-filters__search')).toEqual({ height: '48px' });
  });

  it('toda transicao da regiao tem contrapartida no bloco reduced-motion da MESMA regiao; o unico deslocamento e o hover do cartao do item (zerado em reduced-motion); sem animation', () => {
    const comTransicao = planas.filter((r) => /(^|[;{\s])transition\s*:/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    const reduzido = mediaDe('@media (prefers-reduced-motion: reduce)')
      .filter((r) => /transition:\s*none/.test(r.body))
      .flatMap((r) => listaDeSeletores(r.prelude));
    expect(comTransicao.length).toBeGreaterThan(0);
    expect(comTransicao.filter((s) => !reduzido.includes(s))).toEqual([]);
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])animation\s*:/);
    const comTransform = planas.filter((r) => /(^|[;{\s])transform\s*:/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    expect(comTransform.filter((s) => !(mediaDe('@media (prefers-reduced-motion: reduce)').some((r) => /transform:\s*none/.test(r.body) && listaDeSeletores(r.prelude).includes(s))) && s !== '.itens-card:hover')).toEqual([]);
    expect(declaracoes(mediaDe('@media (prefers-reduced-motion: reduce)'), '.itens-card:hover')).toEqual({ transform: 'none' });
  });
});

describe('F10: fixture de tokens', () => {
  it('a F10 nao precisou de token novo: nenhuma fixture .f10 e todo var(--rf-*) usado existe na uniao das fixtures e esta declarado nos 2 temas', () => {
    expect(fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f10.json')).toEqual([]);
    const nomes = new Set(fixtureUniao().map((t) => t.token));
    const usados = [...new Set([...(regiao?.limpo ?? '').matchAll(/var\((--rf-[\w-]+)/g)].map((m) => m[1] ?? ''))];
    expect(usados.length).toBeGreaterThan(30);
    expect(usados.filter((t) => !nomes.has(t))).toEqual([]);
    const css = stripComments(rawLf);
    const declarado = (t: string) => new RegExp(`(^|[;{\\s])${t}\\s*:`).test(css);
    expect(usados.filter((t) => !declarado(t))).toEqual([]);
  });
});

// ---------- contraste (15.6-C) ----------
const TEXT = 4.5;
const UI = 3;
const rf = (n: string) => `--rf-${n}`;
type Par = readonly [fg: string, bg: string, min: number];
const PARES: ReadonlyArray<Par> = [
  [rf('ink-soft'), rf('surface'), TEXT], // metas, dicas, contadores, ID mono, "(n)" da avaliacao
  [rf('ink-soft'), rf('surface-alt'), TEXT], // cabecalho da tabela, linha expandida, dicas, aviso "Apenas consulta", nome do arquivo vazio
  [rf('ink'), rf('surface'), TEXT],
  [rf('ink'), rf('surface-alt'), TEXT],
  [rf('tone-neutral-fg'), rf('surface-alt'), TEXT], // TAG da linha
  [rf('tone-success-fg'), rf('tone-success-bg'), TEXT], // Em dia, Ativo, Principal, alertas de sucesso, filtro "Mostrar inativos"
  [rf('tone-warning-fg'), rf('tone-warning-bg'), TEXT], // Vence em N dias, Doc. vence, aviso do preview
  [rf('tone-danger-fg'), rf('tone-danger-bg'), TEXT], // Vence hoje, Vencido, Doc. vencido, Bloqueado, alertas de erro
  [rf('tone-neutral-fg'), rf('tone-neutral-bg'), TEXT], // Inativo
  [rf('on-action'), rf('action'), TEXT], // expandir aberto
  [rf('action'), rf('surface'), TEXT], // acoes, Adicionar contato, botao de arquivo
  [rf('action'), rf('surface-alt'), TEXT], // acoes do cartao do item, botao de arquivo
  [rf('action'), rf('action-hover-bg'), TEXT], // cartao em edicao, selo Padrao
  [rf('tone-danger-fg'), rf('surface'), TEXT], // Remover e Excluir sobre a superficie
  [rf('tone-danger-fg'), rf('surface-alt'), TEXT], // Inativar no cartao
  [rf('primary-700'), rf('surface'), TEXT], // eyebrow, legenda de contato, numeros das colunas
  [rf('primary-700'), rf('tone-success-bg'), TEXT], // icone do campo de arquivo
  [rf('input-border'), rf('surface'), UI], // borda dos campos (D3)
];
// Decorativas (< 3:1, registradas nos 2 temas): borda da TAG e dos cartoes, divisorias, faixa de 3 px da linha expandida e contornos de 1 px.
const DECORATIVAS: ReadonlyArray<Par> = [
  [rf('border'), rf('surface'), UI],
  [rf('border'), rf('surface-alt'), UI],
  [rf('divider'), rf('surface'), UI],
  [rf('divider'), rf('surface-alt'), UI],
];

describe('F10: contraste nos 2 temas (alpha composto sobre --rf-surface)', () => {
  const opaque = (theme: ThemeName, name: string): Rgb => opaqueOf(THEMES[theme], name);
  const medir = (lista: ReadonlyArray<Par | readonly [string, string]>) =>
    (['claro', 'escuro'] as const).flatMap((theme) =>
      lista.map((par) => {
        const [fg, bg] = par;
        const min = par[2] ?? TEXT;
        const ratio = ratioOf(opaque(theme, fg), opaque(theme, bg));
        return { id: `${theme}: ${fg} / ${bg}`, min, ratio: Number(ratio.toFixed(2)), ok: ratio >= min };
      }),
    );
  const rows = medir(PARES);

  it('mede os pares nos 2 temas', () => {
    console.table(rows.map((r) => ({ par: r.id, min: r.min, ratio: r.ratio, ok: r.ok })));
    expect(rows).toHaveLength(PARES.length * 2);
  });

  it('todos os pares passam', () => {
    expect(rows.filter((r) => !r.ok).map((r) => `${r.id}: ${r.ratio} < ${r.min}`)).toEqual([]);
  });

  it('as decorativas (borda e divisoria) ficam abaixo de 3:1 nos 2 temas (registradas; o texto nunca depende delas)', () => {
    const dec = medir(DECORATIVAS);
    console.table(dec.map((r) => ({ par: r.id, ratio: r.ratio, abaixoDeTres: !r.ok })));
    expect(dec.filter((r) => r.ok).map((r) => `${r.id}: ${r.ratio}`)).toEqual([]);
  });
});

// ---------- TSX da fase ----------
const ARQUIVOS = [
  'pages/Fornecedores.tsx',
  'components/SupplierDocumentsSection.tsx',
  'components/SupplierImportModal.tsx',
  'pages/Itens.tsx',
  'pages/Familias.tsx',
  'pages/Forwarders.tsx',
] as const;
const fonte = (arquivo: string) => readSource(`../${arquivo}`);
const cssInteiro = stripComments(rawLf);
const temRegra = (classe: string) => new RegExp(`\\.${classe.replace(/[-_]/g, (m) => `\\${m}`)}(?![A-Za-z0-9_-])`).test(cssInteiro);

describe('F10: TSX da fase sem estilo inline (fora os 8 dos Documentos), token, cor literal, glifo nem SVG local', () => {
  it.each(ARQUIVOS)('%s', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--rf-|<svg|[−✕✓🔎]|&times;|>\s*\+ |\{tag\} /);
  });

  it('nenhum style={ nos 5 TSX; os Documentos tem exatamente 8 (rootStyle, table e os 6 th: contrato do SupplierDocumentsSection.test, D-F10-03)', () => {
    for (const arquivo of ARQUIVOS) {
      const n = (fonte(arquivo).match(/style=\{/g) ?? []).length;
      expect(n, arquivo).toBe(arquivo === 'components/SupplierDocumentsSection.tsx' ? 8 : 0);
    }
    const docs = fonte('components/SupplierDocumentsSection.tsx');
    expect(docs).toContain('style={rootStyle}');
    expect(docs).toContain("style={{ tableLayout: 'fixed', width: '100%' }}");
    expect(['23%', '11%', '15%', '14%', '14%', '23%'].map((p) => docs.includes(`<th style={{ width: '${p}' }}>`))).toEqual([true, true, true, true, true, true]);
  });

  it.each(ARQUIVOS)('%s: sem o "+" de texto nos rotulos (vira icone, D-1011-04)', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/>\s*\+\s|\+ Novo|\+ Nova|\+ Adicionar|\{tag\} ✕/);
  });

  it.each(ARQUIVOS)('%s: os icones vem do Icon e sao sempre aria-hidden (o Icon ja fixa o atributo)', (arquivo) => {
    const src = fonte(arquivo);
    for (const [, nome] of src.matchAll(/<Icon name=\{?['"]?([\w-]+)/g)) {
      expect(nome, arquivo).toBeTruthy();
    }
    expect(src).not.toMatch(/<Icon[^>]*aria-hidden=\{?false/);
  });

  it('os 10 icones da F10/F11-0 usados pela F10 (minus, file-plus, ship) e os reusos (file, file-text, upload, download, eye, edit, trash, x, check, info, search, alert-triangle) existem', () => {
    const src = ARQUIVOS.map(fonte).join('\n');
    // nome literal (name="plus") ou os ramos literais de um ternario (name={ok ? 'check' : 'alert-triangle'})
    const nomesLiterais = [...src.matchAll(/<Icon\s+name=(\{[^}]*\}|"[^"]*")/g)].flatMap((m) => {
      const expr = m[1] ?? '';
      return expr.startsWith('"') ? [expr.slice(1, -1)] : [...expr.matchAll(/[?:]\s*'([\w-]+)'/g)].map((x) => x[1] ?? '');
    });
    const usados = [...new Set(nomesLiterais)];
    const icons = readSource('../components/icons.tsx');
    for (const nome of usados) {
      expect(icons, nome).toMatch(new RegExp(`(^|\\n)\\s*'?${nome}'?:`));
    }
    expect(usados).toEqual(expect.arrayContaining(['minus', 'file-plus', 'ship', 'plus', 'search', 'upload', 'download', 'eye', 'trash', 'x', 'check']));
  });
});

describe('F10: toda classe que os TSX da fase usam tem regra', () => {
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
      for (const [token] of fonte(arquivo).matchAll(
        /(?<![\w-])(fornecedores-|fornecedor-|contact-|documentos-|import-modal|importacao-|itens-page|itens-card|itens-filters|itens-form|itens-grid|itens-empty|familias-|familia-|forwarders-|forwarder-)[\w-]*/g,
      )) {
        if (token.endsWith('-')) continue; // prefixo solto
        if (/^(fornecedores-page|itens-page|familias-page|forwarders-page)$/.test(token) && !naRegiaoClasses.has(token)) continue;
        if (!naRegiaoClasses.has(token)) faltando.push(`${arquivo}: .${token}`);
      }
    }
    expect([...new Set(faltando)]).toEqual([]);
  });

  it('as raizes de pagina da F10 usam o seu proprio dono (familias-page sem itens-page, D-F10-07)', () => {
    expect(fonte('pages/Fornecedores.tsx')).toContain('className="page fornecedores-page"');
    expect(fonte('pages/Itens.tsx')).toContain('className="page itens-page"');
    expect(fonte('pages/Familias.tsx')).toContain('className="page familias-page"');
    expect(fonte('pages/Familias.tsx')).not.toContain('itens-page');
    expect(fonte('pages/Forwarders.tsx')).toContain('className="page forwarders-page"');
  });

  it('o .alert da base nao ganha icone filho nos TSX da F10: o aviso usa a classe propria + alert--* (guarda componentesF3b), com role em linha separada', () => {
    for (const arquivo of ARQUIVOS) {
      const linhas = fonte(arquivo).split(/\r?\n/);
      linhas.forEach((linha, i) => {
        if (!/className=/.test(linha)) return;
        if (!/(^|[\s"'`{])(alert|banner)([\s"'`}]|$)/.test(linha.slice(linha.indexOf('className=')))) return;
        expect(/<svg|<\w*Icon\b/.test(linhas.slice(i, i + 3).join(' ')), `${arquivo}:${i + 1}`).toBe(false);
      });
    }
  });
});
