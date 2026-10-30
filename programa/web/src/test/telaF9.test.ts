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

// F9 (Suite COMEX, mock v68; boards SolicitacoesComex/-Dev, SolicitacoesComercial/-Dev, ModalSolicitarCotacao, ModalNovaSolicitacao, ModaisSolicitacao,
// ModalVincularCatalogo e ModaisAnexos): as duas visoes das Solicitacoes (COMEX e Comercial), a linha expandida, os modais de acao, Vincular ao catalogo,
// Solicitar uma cotacao e os anexos tecnicos. CSS na regiao `tela F9` do globals.css. Esta guarda cobre: a regiao (posicao, prefixos donos, classes de
// contexto, at-rules, sem cor literal nem token), que nada dos donos sobrou fora dela, as receitas dos boards (valores exatos), o card do celular, o
// contraste nos 2 temas e que os 5 TSX da fase nao tem estilo inline, token, cor literal, glifo nem SVG local e que toda classe que eles usam tem regra.

const NOME = 'tela F9';
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
const PREFIXOS_DONOS = ['solicitacoes-', 'solicitacao-', 'sol-table', 'sol-filter', 'sol-cell-', 'sol-added', 'sol-item-', 'anexos-', 'vincular-catalogo'] as const;
const ehDono = (classe: string) => PREFIXOS_DONOS.some((p) => classe.startsWith(p));
// Classes de CONTEXTO (14.3): so aparecem junto de um dono. `.sol-items-list` tambem existe no painel da F6: nunca sozinha.
const CONTEXTO = new Set([
  'card',
  'table',
  'table-wrapper',
  'row-actions',
  'badge',
  'alert',
  'btn-spinner',
  'empty-state',
  'ghost-button',
  'ghost-button--sm',
  'danger-button',
  'link-button',
  'input',
  'select',
  'textarea',
  'field-label',
  'form-grid',
  'modal-actions',
  'modal-body',
  'sr-only',
  'col-status',
  'sol-items-list',
]);

describe('F9: regiao `tela F9`', () => {
  it('existe uma vez, logo depois da regiao `tela F8` (so espaco entre as duas) e tem regras', () => {
    expect(rawLf.split(`/* >>> ${NOME} (Suite COMEX) >>> */`)).toHaveLength(2);
    expect(rawLf.split(`/* <<< ${NOME} <<< */`)).toHaveLength(2);
    const f8 = regs.find((r) => r.nome === 'tela F8');
    expect(f8).toBeDefined();
    expect(regiao).toBeDefined();
    expect(rawLf.slice(f8?.fim ?? 0, regiao?.inicio ?? 0).trim()).toBe('');
    expect(planas.length).toBeGreaterThan(150);
  });

  it('a regiao vem DEPOIS das regioes F3 e da compat, logo depois da tela F8 (vence as regras de componente de mesma especificidade pela ordem)', () => {
    const compat = regs.find((r) => r.nome === 'compat Forecast F3');
    expect((compat?.fim ?? Infinity) <= (regiao?.inicio ?? 0)).toBe(true);
    expect(regs.findIndex((r) => r.nome === NOME)).toBe(regs.findIndex((r) => r.nome === 'tela F8') + 1);
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

  it('at-rules permitidas: 1199, 720, 640, 540, pointer: coarse e reduced-motion; sem @keyframes; sem aninhamento', () => {
    const atRules = topo.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    const permitidas = [
      '@media (max-width: 1199px)',
      '@media (max-width: 720px)',
      '@media (max-width: 640px)',
      '@media (max-width: 540px)',
      '@media (pointer: coarse)',
      '@media (prefers-reduced-motion: reduce)',
    ];
    expect(atRules.filter((a) => !permitidas.includes(a))).toEqual([]);
    expect(new Set(atRules).size).toBe(atRules.length);
    for (const a of ['@media (max-width: 720px)', '@media (max-width: 540px)', '@media (pointer: coarse)', '@media (prefers-reduced-motion: reduce)']) {
      expect(atRules, a).toContain(a);
    }
    expect(regiao?.limpo).not.toContain('@keyframes');
    for (const m of topo.filter((r) => r.prelude.startsWith('@media'))) {
      for (const inner of parseRules(m.body)) expect(inner.prelude.startsWith('@'), inner.prelude).toBe(false);
    }
  });
});

describe('F9: prefixos donos e classes de contexto', () => {
  const seletores = planas.flatMap((r) => listaDeSeletores(r.prelude));

  it('todo seletor tem ao menos 1 classe com prefixo dono (solicitacoes-, solicitacao-, sol-table, sol-filter, sol-cell-, sol-added, sol-item-, anexos-, vincular-catalogo)', () => {
    expect(seletores.length).toBeGreaterThan(150);
    expect(seletores.filter((s) => !classesDoSeletor(s).some(ehDono))).toEqual([]);
  });

  it('as demais classes de cada seletor sao de CONTEXTO (lista fixa de 14.3); donos da F6, F7 e F8 nunca aparecem', () => {
    const alheias = [...new Set(seletores.flatMap(classesDoSeletor))].filter((c) => !ehDono(c) && !CONTEXTO.has(c));
    expect(alheias).toEqual([]);
    for (const s of seletores) {
      expect(s, s).not.toMatch(
        /sol-dev-painel|cotacao-detalhe|cotacao-envio|cotacao-links|cotacao-item-form|\.itens-tab(?![\w-])|cotacoes-|cotacao-nova|\.cmp-|info-chip|info-popover|respostas-tab|\.resposta-|credit-support|price-history|supplier-notes|\.po-|\.folder|\.fcount/,
      );
    }
  });

  it('`.sol-items-list` so aparece depois de um dono F9 (o painel do Detalhe tem a regra propria)', () => {
    const comLista = seletores.filter((s) => classesDoSeletor(s).includes('sol-items-list'));
    expect(comLista.length).toBeGreaterThan(0);
    for (const s of comLista) expect(classesDoSeletor(s).some(ehDono), s).toBe(true);
    expect(seletores).not.toContain('.sol-items-list');
  });

  it('nenhum seletor e so da base da pagina nem usa h1-h3 como elemento', () => {
    for (const s of seletores) {
      expect(/(^|[\s>+~])h[1-3]\b/.test(s.replace(/\[[^\]]*\]|"[^"]*"/g, '')), s).toBe(false);
    }
    expect(seletores).not.toContain('.page');
    expect(seletores).not.toContain('.page-header');
  });
});

describe('F9: nada dos donos sobrou fora das regioes', () => {
  const foraLimpo = stripComments(fora);
  const foraSeletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));

  it('nenhuma regra .sol-table, .sol-filter*, .sol-cell-*, .sol-added, .solicitacoes-*, .solicitacao-*, .anexos-* ou .vincular-catalogo* fora da regiao', () => {
    expect(foraSeletores.filter((s) => classesDoSeletor(s).some(ehDono))).toEqual([]);
  });

  it('a F9 nao apaga regra compartilhada: .sol-items-list segue fora das regioes (o telaF6 exige) e tambem .sr-only, .form-grid e .text-sm', () => {
    for (const s of ['.sol-items-list', '.sr-only', '.form-grid', '.text-sm']) expect(foraSeletores, s).toContain(s);
  });
});

describe('F9: receitas dos boards (valores exatos)', () => {
  it('filtros 220 x 44 (recuo 12) e cartao da lista colado: raio 22 do .card, sem padding, overflow oculto', () => {
    expect(naRegiao('.solicitacoes-page .sol-filter')).toEqual({ width: '220px', 'padding-left': '12px' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-lista')).toEqual({ padding: '0', overflow: 'hidden' });
    expect(naRegiao('.solicitacoes-estado .empty-state')).toEqual({ padding: '32px 24px' });
    expect(naRegiao('.solicitacoes-carregando .btn-spinner')).toEqual({ 'border-color': 'var(--rf-border)', 'border-top-color': 'var(--rf-action)' });
  });

  it('tabela: cabecalho 12 com 1a coluna em 20, linhas 10/12 (COMEX) e 14/14 no topo (Comercial), status a esquerda', () => {
    expect(naRegiao('.solicitacoes-page--comex .solicitacoes-tabela > thead > tr > th')).toEqual({ padding: '12px' });
    expect(naRegiao('.solicitacoes-page--comex .solicitacoes-tabela > thead > tr > th:first-child')).toEqual({ 'padding-left': '20px' });
    expect(naRegiao('.solicitacoes-page--comex .solicitacoes-tabela > tbody > tr > td')).toEqual({ padding: '10px 12px', 'vertical-align': 'middle' });
    expect(naRegiao('.solicitacoes-page--comex .solicitacoes-tabela > tbody > tr > td:first-child')).toEqual({ 'padding-left': '20px' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-tabela .col-status')).toEqual({ 'text-align': 'left' });
    expect(naRegiao('.solicitacoes-page--comercial .solicitacoes-tabela > tbody > tr > td')).toEqual({ padding: '14px', 'vertical-align': 'top' });
    expect(naRegiao('.solicitacoes-page--comercial .solicitacoes-tabela > thead > tr > th')).toEqual({ padding: '12px 14px' });
  });

  it('celulas: #id 13/600 mono, data 13 em --rf-ink-soft sem quebra, cliente 600 (vazio em --rf-ink-soft), codigo da cotacao mono 13/600', () => {
    expect(naRegiao('.solicitacoes-mono')).toEqual({ 'font-family': 'var(--rf-font-mono)', 'font-variant-numeric': 'tabular-nums' });
    expect(naRegiao('.solicitacoes-id')).toEqual({ 'font-size': '13px', 'font-weight': '600' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-tabela > tbody > tr > td.solicitacoes-data')).toEqual({
      color: 'var(--rf-ink-soft)',
      'font-size': '13px',
      'white-space': 'nowrap',
    });
    expect(naRegiao('.solicitacoes-cliente')).toEqual({ 'font-weight': '600' });
    expect(naRegiao('.solicitacoes-cliente--vazio')).toEqual({ color: 'var(--rf-ink-soft)', 'font-weight': '500' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-tabela > tbody > tr > td.solicitacoes-codigo')).toMatchObject({
      'font-family': 'var(--rf-font-mono)',
      'font-size': '13px',
      'font-weight': '600',
    });
    expect(naRegiao('.solicitacoes-page .solicitacoes-tabela > tbody > tr > td.solicitacoes-observacao')).toEqual({ 'max-width': '240px', 'font-size': '13px', 'line-height': '1.55' });
    expect(naRegiao('.solicitacoes-page .sol-items-list')).toEqual({ margin: '0', 'padding-left': '16px', 'font-size': '13px', 'line-height': '1.6' });
  });

  it('acoes da linha: fantasma 36 (padding 10), codigo da cotacao em contorno --rf-action, "Ver itens" em --rf-surface-alt e aberto em --rf-action', () => {
    expect(naRegiao('.solicitacoes-page .solicitacoes-tabela > tbody > tr > td.sol-cell-actions')).toEqual({ padding: '8px 12px' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-tabela .sol-cell-actions .row-actions .ghost-button')).toEqual({ padding: '0 10px' });
    expect(naRegiao('.solicitacoes-dica')).toEqual({ 'flex-basis': '100%', color: 'var(--rf-tone-warning-fg)', 'font-size': '12px', 'font-weight': '600' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-cotacao')).toMatchObject({
      border: '1.5px solid var(--rf-action)',
      'border-radius': 'var(--rf-radius-control)',
      background: 'var(--rf-surface)',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '12px',
      'font-weight': '600',
    });
    expect(naRegiao('.solicitacoes-page .solicitacoes-ver__botao')).toMatchObject({ gap: '6px', background: 'var(--rf-surface-alt)' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-ver__botao[aria-expanded="true"]')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
  });

  it('linha aberta e detalhe: fundo --rf-action-hover-bg e faixa de 3 px --rf-action; cartao interno raio 16 (16/18); tabela interna com contorno raio 12 e 9/14', () => {
    expect(naRegiao('.solicitacoes-page .solicitacoes-tabela > tbody > tr.solicitacoes-linha--aberta > td')).toEqual({ 'border-bottom': '0', background: 'var(--rf-action-hover-bg)' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-tabela > tbody > tr.solicitacoes-linha--aberta > td:first-child')).toEqual({ 'box-shadow': 'inset 3px 0 0 var(--rf-action)' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-tabela > tbody > tr.solicitacoes-linha-detalhe > td.sol-cell-detail')).toEqual({
      padding: '4px 20px 18px',
      background: 'var(--rf-action-hover-bg)',
      'box-shadow': 'inset 3px 0 0 var(--rf-action)',
      'text-align': 'left',
    });
    expect(naRegiao('.solicitacoes-detalhe')).toEqual({
      display: 'flex',
      'flex-direction': 'column',
      gap: '12px',
      padding: '16px 18px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-card)',
      background: 'var(--rf-surface)',
    });
    expect(naRegiao('.solicitacoes-nota')).toEqual({ margin: '0', color: 'var(--rf-ink)', 'font-size': '13px', 'line-height': '1.55' });
    expect(naRegiao('.solicitacoes-itens-tabela')).toEqual({ 'overflow-x': 'auto', border: '1px solid var(--rf-divider)', 'border-radius': 'var(--rf-radius-button)' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-itens th')).toEqual({ padding: '9px 14px' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-itens td')).toEqual({ padding: '9px 14px', 'vertical-align': 'middle' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-itens td.solicitacoes-valor')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'text-align': 'right', 'white-space': 'nowrap' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-itens td.solicitacoes-na-cotacao--sim')).toEqual({ color: 'var(--rf-tone-success-fg)' });
    expect(naRegiao('.solicitacoes-page .solicitacoes-vincular')).toMatchObject({ padding: '0 16px', border: '1.5px solid var(--rf-action)', 'border-radius': 'var(--rf-radius-button)' });
  });

  it('alertas e erros: .solicitacoes-alerta (flex, gap 10, 12/16, raio 14, 14/600) com o tom vindo de .alert--error / .alert--info; icone de 18 sem encolher', () => {
    expect(naRegiao('.solicitacoes-alerta')).toEqual({
      display: 'flex',
      'align-items': 'flex-start',
      gap: '10px',
      margin: '0',
      padding: '12px 16px',
      'border-radius': 'var(--rf-radius-alert)',
      'font-size': '14px',
      'font-weight': '600',
      'line-height': '1.5',
    });
    expect(naRegiao('.solicitacoes-alerta > svg')).toEqual({ flex: 'none', 'margin-top': '1px' });
  });

  it('anexos (lista): selo do tipo mono 11/700, nome 600, tamanho em --rf-ink-soft, botoes de 32, confirmacao de remocao de 36', () => {
    expect(naRegiao('.anexos-lista')).toMatchObject({ display: 'flex', 'flex-direction': 'column', gap: '6px', 'list-style': 'none' });
    expect(naRegiao('.anexos-lista__item')).toEqual({ display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: '8px', 'font-size': '13px' });
    expect(naRegiao('.anexos-lista .badge.anexos-lista__tipo')).toEqual({ 'font-family': 'var(--rf-font-mono)', 'font-size': '11px', 'font-weight': '700' });
    expect(naRegiao('.anexos-lista__nome')).toEqual({ 'font-weight': '600' });
    expect(naRegiao('.anexos-lista__tamanho')).toEqual({ color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.anexos-lista .ghost-button--sm')).toEqual({ 'min-height': '32px', padding: '0 8px' });
    expect(naRegiao('.anexos-lista .anexos-lista__confirmar-remocao')).toEqual({ 'min-height': '36px', padding: '0 18px' });
  });

  it('anexos (campo): card em --rf-surface-alt (14/16, raio 16), botao e o rotulo do input oculto, erros em --rf-tone-danger, item em 3 colunas (1fr / 120 / auto)', () => {
    expect(naRegiao('.anexos-campo')).toMatchObject({
      display: 'flex',
      'flex-direction': 'column',
      gap: '8px',
      padding: '14px 16px',
      border: '1px solid var(--rf-divider)',
      'border-radius': 'var(--rf-radius-card)',
      background: 'var(--rf-surface-alt)',
    });
    expect(naRegiao('.anexos-campo__input')).toMatchObject({ position: 'absolute', width: '1px', height: '1px', clip: 'rect(0 0 0 0)' });
    expect(naRegiao('.anexos-campo__input:focus-visible + .anexos-campo__botao')).toMatchObject({ 'box-shadow': '0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-action)' });
    expect(naRegiao('.anexos-campo__estado')).toEqual({ color: 'var(--rf-ink-soft)', 'font-size': '13px' });
    expect(naRegiao('.anexos-campo__dica')).toEqual({ margin: '0', color: 'var(--rf-ink-soft)', 'font-size': '12px' });
    expect(naRegiao('.anexos-campo__erros')).toMatchObject({
      padding: '10px 14px 10px 30px',
      'border-radius': 'var(--rf-radius-alert)',
      background: 'var(--rf-tone-danger-bg)',
      color: 'var(--rf-tone-danger-fg)',
    });
    expect(naRegiao('.anexos-campo__item')).toMatchObject({
      display: 'grid',
      'grid-template-columns': 'minmax(0, 1fr) 120px auto',
      padding: '8px 12px',
      'border-radius': 'var(--rf-radius-button)',
      background: 'var(--rf-surface)',
    });
    expect(naRegiao('.anexos-campo .select.anexos-campo__tipo')).toMatchObject({ 'min-height': '36px', 'font-size': '13px' });
  });

  it('modais de acao: .solicitacao-modal com text-align: left (D-F9-03), coluna de gap 14 (12 no vinculo), faixa de aviso do "Atender sem preco", cotacao selecionada com contorno de 1,5', () => {
    expect(naRegiao('.solicitacao-modal')).toEqual({ 'text-align': 'left' });
    expect(naRegiao('.modal-body > .solicitacao-modal')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '14px' });
    expect(naRegiao('.modal-body > .solicitacao-modal--vincular')).toEqual({ gap: '12px' });
    expect(naRegiao('.solicitacao-modal__atender-sem-preco')).toMatchObject({
      padding: '12px 14px',
      'border-radius': 'var(--rf-radius-button)',
      background: 'var(--rf-tone-warning-bg)',
      color: 'var(--rf-tone-warning-fg)',
      'font-weight': '700',
    });
    expect(naRegiao('.solicitacao-cotacao')).toMatchObject({ width: '100%', 'min-height': '44px', 'box-shadow': 'inset 0 0 0 1px var(--rf-border)', 'text-align': 'left' });
    expect(naRegiao('.solicitacao-cotacao[aria-pressed="true"]')).toEqual({ background: 'var(--rf-action-hover-bg)', 'box-shadow': 'inset 0 0 0 1.5px var(--rf-action)' });
    expect(naRegiao('.solicitacao-cotacao__codigo')).toEqual({ 'font-family': 'var(--rf-font-mono)', 'font-size': '13px', 'font-weight': '600' });
  });

  it('rodape em faixa dos modais (D-F3-11) nos wrappers do COMEX, dos anexos e do vinculo; spinner do Enviar em tinta --rf-ink', () => {
    const faixa = {
      margin: '6px -24px -20px',
      padding: '16px 24px',
      'border-top': '1px solid var(--rf-divider)',
      background: 'var(--rf-surface-alt)',
    };
    expect(
      naRegiao('.modal-body > .solicitacao-modal > .modal-actions:last-child'),
    ).toEqual(faixa);
    expect(naRegiao('.vincular-catalogo__painel > .modal-actions:last-child')).toEqual(faixa);
    expect(naRegiao('.anexos-reenvio > .modal-actions:last-child')).toEqual(faixa);
    expect(naRegiao('.solicitacao-form > .modal-actions:last-child')).toEqual({ 'margin-top': '6px' });
    expect(naRegiao('.solicitacao-form .modal-actions .btn-spinner')).toEqual({
      'border-color': 'color-mix(in srgb, var(--rf-ink) 25%, transparent)',
      'border-top-color': 'var(--rf-ink)',
    });
  });

  it('Vincular ao catalogo: segmentado em --rf-surface-alt (raio 12, 4 de recuo), aba ativa em --rf-action / --rf-on-action, campos em coluna de gap 14', () => {
    expect(naRegiao('.vincular-catalogo__modo')).toMatchObject({
      display: 'inline-flex',
      gap: '4px',
      padding: '4px',
      border: '1px solid var(--rf-divider)',
      'border-radius': 'var(--rf-radius-button)',
      background: 'var(--rf-surface-alt)',
    });
    expect(naRegiao('.vincular-catalogo__aba')).toMatchObject({ 'min-height': '36px', padding: '0 14px', 'border-radius': '9px', 'font-size': '13px', 'font-weight': '700' });
    expect(naRegiao('.vincular-catalogo__aba[aria-pressed="true"]')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
    expect(naRegiao('.vincular-catalogo__campos')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '14px' });
  });

  it('Solicitar uma cotacao: item em fieldset (raio 16, 10/16/16), grade 4 colunas + auto, titulo 16/700 (display), busca em card --rf-surface-alt, resultado de 40 e "Incluir" de 44', () => {
    expect(naRegiao('.solicitacao-item')).toEqual({
      'min-width': '0',
      margin: '0',
      padding: '10px 16px 16px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-card)',
    });
    expect(naRegiao('.solicitacao-item__legenda')).toEqual({ padding: '0 6px', 'font-size': '13px', 'font-weight': '700' });
    expect(naRegiao('.solicitacao-item__grade')).toEqual({
      display: 'grid',
      'grid-template-columns': 'repeat(4, minmax(0, 1fr)) auto',
      'align-items': 'end',
      gap: '12px',
    });
    expect(naRegiao('.solicitacao-form__titulo')).toEqual({ margin: '0', 'font-family': 'var(--rf-font-display)', 'font-size': '16px', 'font-weight': '700' });
    expect(naRegiao('.solicitacao-form__aviso')).toEqual({ background: 'var(--rf-tone-success-bg)', color: 'var(--rf-tone-success-fg)' });
    expect(naRegiao('.solicitacao-busca')).toMatchObject({
      padding: '14px 16px',
      border: '1px solid var(--rf-divider)',
      'border-radius': 'var(--rf-radius-card)',
      background: 'var(--rf-surface-alt)',
    });
    expect(naRegiao('.solicitacao-busca__campo')).toMatchObject({
      height: '44px',
      padding: '0 12px',
      border: '1.5px solid var(--rf-input-border)',
      'border-radius': 'var(--rf-radius-control)',
    });
    expect(naRegiao('.solicitacao-busca__campo:focus-within')).toEqual({ 'border-color': 'var(--rf-action)', 'box-shadow': '0 0 0 4px var(--rf-focus-halo)' });
    expect(naRegiao('.solicitacao-busca__resultado')).toMatchObject({ 'min-height': '40px', width: '100%', border: '1px solid var(--rf-border)', 'border-radius': 'var(--rf-radius-control)' });
    expect(naRegiao('.solicitacao-busca__incluir')).toMatchObject({ 'min-height': '44px', width: '100%' });
    expect(naRegiao('.solicitacao-busca__resultado:disabled')).toMatchObject({ background: 'var(--rf-tone-neutral-bg)', color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.sol-added')).toMatchObject({ 'margin-left': 'auto', color: 'var(--rf-tone-success-fg)', 'font-weight': '700' });
  });

  it('card do celular (<= 720): td::before com attr(data-label), thead oculto, status com order: -1, acoes e detalhe sem rotulo', () => {
    const m = mediaDe('@media (max-width: 720px)');
    const before = declaracoes(m, '.solicitacoes-page .table.sol-table > tbody > tr > td::before');
    expect(before.content).toBe('attr(data-label)');
    expect(before['text-transform']).toBe('uppercase');
    expect(declaracoes(m, '.solicitacoes-page .table.sol-table > thead')).toEqual({ display: 'none' });
    expect(declaracoes(m, '.solicitacoes-page .table.sol-table > tbody > tr > td.col-status')).toMatchObject({ order: '-1', background: 'var(--rf-surface-alt)' });
    expect(declaracoes(m, '.solicitacoes-page .table.sol-table > tbody > tr > td.sol-cell-actions::before')).toEqual({ display: 'none' });
    expect(declaracoes(m, '.solicitacoes-page .table.sol-table > tbody > tr > td.sol-cell-detail::before')).toEqual({ display: 'none' });
    expect(declaracoes(m, '.solicitacoes-page .table.sol-table > tbody > tr')).toMatchObject({
      display: 'flex',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-card)',
      background: 'var(--rf-surface)',
    });
  });

  it('filtros em largura total ate 540; grade do item em 2 colunas ate 640; pointer: coarse leva os alvos de 32/36/40 a 44', () => {
    const f = mediaDe('@media (max-width: 540px)');
    expect(declaracoes(f, '.solicitacoes-page .sol-filters')).toEqual({ width: '100%' });
    expect(declaracoes(f, '.solicitacoes-page .sol-filters .sol-filter')).toEqual({ width: '100%', 'max-width': 'none' });
    expect(declaracoes(mediaDe('@media (max-width: 640px)'), '.solicitacao-item__grade')).toEqual({ 'grid-template-columns': 'repeat(2, minmax(0, 1fr))' });
    const coarse = mediaDe('@media (pointer: coarse)');
    const alvos44 = coarse.filter((r) => /min-height:\s*44px/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    for (const s of [
      '.solicitacoes-page .solicitacoes-anexar',
      '.anexos-lista .ghost-button--sm',
      '.anexos-lista .anexos-lista__confirmar-remocao',
      '.anexos-campo .select.anexos-campo__tipo',
      '.vincular-catalogo__aba',
      '.solicitacao-busca__resultado',
      '.solicitacao-modal__atender-sem-preco',
    ]) {
      expect(alvos44, s).toContain(s);
    }
  });

  it('toda transicao da regiao tem contrapartida no bloco reduced-motion da MESMA regiao; a regiao nao anima nem transforma', () => {
    const comTransicao = planas.filter((r) => /(^|[;{\s])transition\s*:/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    const reduzido = mediaDe('@media (prefers-reduced-motion: reduce)')
      .filter((r) => /transition:\s*none/.test(r.body))
      .flatMap((r) => listaDeSeletores(r.prelude));
    expect(comTransicao.length).toBeGreaterThan(0);
    expect(comTransicao.filter((s) => !reduzido.includes(s))).toEqual([]);
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])animation\s*:/);
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])transform\s*:/);
  });
});

describe('F9: fixture de tokens', () => {
  it('a F9 nao precisou de token novo: nenhuma fixture .f9 e os tokens que ela usa existem nos 2 temas', () => {
    expect(fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f9.json')).toEqual([]);
    const usados = [...new Set([...(regiao?.limpo ?? '').matchAll(/var\((--rf-[\w-]+)/g)].map((m) => m[1] ?? ''))];
    expect(usados.length).toBeGreaterThan(20);
    const css = stripComments(rawLf);
    const declarado = (t: string) => new RegExp(`(^|[;{\\s])${t}\\s*:`).test(css);
    expect(usados.filter((t) => !declarado(t))).toEqual([]);
  });
});

// ---------- contraste (14.7-C) ----------
const TEXT = 4.5;
const UI = 3;
const rf = (n: string) => `--rf-${n}`;
type Par = readonly [fg: string, bg: string, min: number];
const PARES: ReadonlyArray<Par> = [
  [rf('ink-soft'), rf('surface'), TEXT], // datas, dicas, tamanho do anexo, "Cliente nao informado"
  [rf('ink-soft'), rf('surface-alt'), TEXT], // cabecalho, dicas no campo de anexos e na busca, "Ver itens"
  [rf('ink-soft'), rf('action-hover-bg'), TEXT], // texto suave na linha expandida
  [rf('ink'), rf('action-hover-bg'), TEXT], // linha expandida e cotacao selecionada
  [rf('ink'), rf('surface'), TEXT],
  [rf('ink'), rf('surface-alt'), TEXT],
  [rf('action'), rf('surface'), TEXT], // acoes, codigo da cotacao, Baixar
  [rf('action'), rf('action-hover-bg'), TEXT], // acao sobre a linha aberta / hover
  [rf('on-action'), rf('action'), TEXT], // "Ocultar itens" e aba ativa
  [rf('primary-700'), rf('surface'), TEXT], // links
  [rf('tone-success-fg'), rf('tone-success-bg'), TEXT], // Atendida, aviso de item novo
  [rf('tone-success-fg'), rf('surface'), TEXT], // "Adicionado", "Sim"
  [rf('tone-success-fg'), rf('tone-neutral-bg'), TEXT], // "Adicionado" no resultado desabilitado
  [rf('ink-soft'), rf('tone-neutral-bg'), TEXT], // resultado desabilitado
  [rf('tone-warning-fg'), rf('tone-warning-bg'), TEXT], // Pendente, "Atender sem preco"
  [rf('tone-warning-fg'), rf('surface'), TEXT], // dica dos itens novos
  [rf('tone-danger-fg'), rf('tone-danger-bg'), TEXT], // Recusada, erros
  [rf('tone-danger-fg'), rf('surface'), TEXT], // erros e "Remover" sobre a superficie
  [rf('tone-info-fg'), rf('tone-info-bg'), TEXT], // Em cotacao, Desenvolvimento, Item novo, TDS/MSDS
  [rf('tone-info-fg'), rf('surface'), TEXT], // icone de info
  [rf('input-border'), rf('surface'), UI], // borda dos campos (D3)
];

describe('F9: contraste nos 2 temas (alpha composto sobre --rf-surface)', () => {
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
  'pages/Solicitacoes/ComexView.tsx',
  'pages/Solicitacoes/ComercialView.tsx',
  'pages/Solicitacoes/ComexActions.tsx',
  'pages/Solicitacoes/VincularCatalogoModal.tsx',
  'pages/Solicitacoes/AnexosTecnicos.tsx',
] as const;
const fonte = (arquivo: string) => readSource(`../${arquivo}`);
const cssInteiro = stripComments(rawLf);
const temRegra = (classe: string) => new RegExp(`\\.${classe.replace(/[-_]/g, (m) => `\\${m}`)}(?![A-Za-z0-9_-])`).test(cssInteiro);

describe('F9: TSX da fase sem estilo inline, token, cor literal, glifo nem SVG local', () => {
  it.each(ARQUIVOS)('%s', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--rf-|style=\{|<svg|MODAL_TEXT_ALIGN|[▸▾→✓]|&times;/);
  });

  it.each(ARQUIVOS)('%s: sem o "+" de texto nos rotulos (vira icone, D-F9-02)', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/>\s*\+\s|\+ Incluir|\+ Adicionar|\+ \{/);
  });

  it.each(ARQUIVOS)('%s: os icones vem do Icon e sao sempre aria-hidden (o Icon ja fixa o atributo)', (arquivo) => {
    const src = fonte(arquivo);
    for (const [, nome] of src.matchAll(/<Icon name=\{?['"]?([\w-]+)/g)) {
      expect(nome, arquivo).toBeTruthy();
    }
    expect(src).not.toMatch(/<Icon[^>]*aria-hidden=\{?false/);
  });
});

describe('F9: toda classe que os TSX da fase usam tem regra', () => {
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
      for (const [token] of fonte(arquivo).matchAll(/(?<![\w-])(solicitacoes-|solicitacao-|sol-table|sol-filter|sol-cell-|sol-added|sol-item-|anexos-|vincular-catalogo)[\w-]*/g)) {
        if (token.endsWith('-')) continue; // prefixo solto
        if (!naRegiaoClasses.has(token)) faltando.push(`${arquivo}: .${token}`);
      }
    }
    expect([...new Set(faltando)]).toEqual([]);
  });
});
