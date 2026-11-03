/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  classesDoSeletor,
  foraDasRegioes,
  fixtureUniao,
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

// F11 (Suite COMEX, mock v68; boards Overview, Relatorios, Usuarios, Empresa, Auditoria, Templates, MinhaConta e ModaisAdmin): Overview, Relatorios,
// Usuarios, Perfil da empresa (+ Parceiros de credito), Auditoria, Templates de e-mail e Minha conta. CSS na regiao `tela F11` do globals.css.
// Esta guarda cobre: a regiao (posicao, prefixos donos, classes de contexto, at-rules, sem cor literal nem token), que nada dos donos sobrou fora
// dela, que o escopo "papel claro" (Jodit e previa da assinatura) segue intacto, as receitas dos boards, o contraste nos 2 temas, o movimento
// reduzido e que os TSX da fase nao tem estilo inline (fora a previa em papel), token, cor literal, glifo nem SVG local e que toda classe tem regra.

const NOME = 'tela F11';
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
// Prefixos DONOS: todo seletor da regiao (cada item da lista, sozinho) tem ao menos 1 classe com um destes prefixos. `manual-` e do Manual de uso
// (fase M): as regras ficam no bloco aberto por `/* ---- Manual de uso (fase M) ---- */` e, so as de largura, de toque e de movimento, no fim dos at-rules (telaM.test.ts).
const PREFIXOS_DONOS = [
  'overview-',
  'kpi',
  'relatorios-',
  'usuarios-',
  'usuario-',
  'empresa-',
  'cc-',
  'parceiros-credito',
  'parceiro-credito',
  'auditoria-',
  'templates-',
  'template-',
  'preview-popout',
  'minha-conta',
  'assinatura-',
  'manual-',
] as const;
const ehDono = (classe: string) => PREFIXOS_DONOS.some((p) => classe.startsWith(p));
// Donos das outras fases: nunca aparecem na regiao.
const DONOS_ALHEIOS = [
  'credit-support',
  'cmp-',
  'forwarder',
  'contact-',
  'sol-',
  'solicitac',
  'anexos-',
  'vincular-',
  'itens-',
  'fornecedor',
  'documentos-',
  'import-modal',
  'importacao-',
  'familia',
  'cotacao',
  'cotacoes-',
  'dispatch',
  'preview-frame',
  'resposta',
  'price-history',
  'supplier-notes',
  'info-chip',
  'info-popover',
] as const;
const ehAlheio = (classe: string) => DONOS_ALHEIOS.some((p) => classe.startsWith(p));
// Classes de CONTEXTO (15.3): so aparecem junto de um dono. `jodit-*` (barra e moldura do editor) e `paper-surface` so como contexto.
const CONTEXTO = new Set([
  'page-header',
  'page-header__actions',
  'card',
  'table',
  'table-wrapper',
  'row-actions',
  'col-status',
  'badge',
  'chip',
  'alert',
  'empty-state',
  'btn-spinner',
  'ghost-button',
  'primary-button',
  'danger-button',
  'link-button',
  'input',
  'textarea',
  'field-label',
  'checkbox-field',
  'modal-dialog',
  'sr-only',
  'paper-surface',
  'jodit-container',
  'jodit_inline',
  'jodit-wysiwyg',
  'jodit-toolbar-button_size_small',
  'jodit-toolbar-button__button',
  'jodit-status-bar-link',
]);

describe('F11: regiao `tela F11`', () => {
  it('existe uma vez, logo depois da regiao `tela F10` (so espaco entre as duas) e tem regras', () => {
    expect(rawLf.split(`/* >>> ${NOME} (Suite COMEX) >>> */`)).toHaveLength(2);
    expect(rawLf.split(`/* <<< ${NOME} <<< */`)).toHaveLength(2);
    const f10 = regs.find((r) => r.nome === 'tela F10');
    expect(f10).toBeDefined();
    expect(regiao).toBeDefined();
    expect(rawLf.slice(f10?.fim ?? 0, regiao?.inicio ?? 0).trim()).toBe('');
    expect(planas.length).toBeGreaterThan(300);
  });

  it('a regiao vem DEPOIS das regioes F3 e da compat (vence as regras de componente de mesma especificidade pela ordem)', () => {
    const compat = regs.find((r) => r.nome === 'compat Forecast F3');
    expect((compat?.fim ?? Infinity) <= (regiao?.inicio ?? 0)).toBe(true);
    expect(regs.findIndex((r) => r.nome === NOME)).toBe(regs.findIndex((r) => r.nome === 'tela F10') + 1);
  });

  it('nao declara token (--*), consome var(--rf-*), sem cor literal, !important nem @media print; usa os 2 tokens novos da F11', () => {
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    expect(regiao?.limpo).toContain('var(--rf-');
    expect(regiao?.limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(regiao?.limpo).not.toContain('!important');
    expect(regiao?.limpo).not.toContain('@media print');
    const usados = [...(regiao?.limpo ?? '').matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '');
    expect(usados.filter((t) => !t.startsWith('--rf-'))).toEqual([]);
    expect(usados).toContain('--rf-kpi-destaque-borda');
    expect(usados).toContain('--rf-cc-auto-borda');
  });

  it('at-rules permitidas: screen 1439, 1199 e 1023 (F12-B), 1199, 1023, 720, 640, 600, pointer: coarse e reduced-motion; sem @keyframes; sem aninhamento', () => {
    const atRules = topo.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    const permitidas = [
      '@media screen and (max-width: 1439px)',
      '@media screen and (max-width: 1199px)',
      '@media screen and (max-width: 1023px)',
      '@media (max-width: 1199px)',
      '@media (max-width: 1023px)',
      '@media (max-width: 720px)',
      '@media (max-width: 640px)',
      '@media (max-width: 600px)',
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

describe('F11: prefixos donos e classes de contexto', () => {
  const seletores = planas.flatMap((r) => listaDeSeletores(r.prelude));

  it('todo seletor tem dono; regras `manual-` fora de at-rule so depois do marcador do bloco da fase M', () => {
    expect(seletores.length).toBeGreaterThan(300);
    expect(seletores.filter((s) => !classesDoSeletor(s).some(ehDono))).toEqual([]);
    const marcador = regiao?.bruto.indexOf('/* ---- Manual de uso (fase M) ---- */') ?? -1;
    expect(marcador).toBeGreaterThan(0);
    const antes = parseRules(stripComments((regiao?.bruto ?? '').slice(0, marcador))).filter((r) => !r.prelude.startsWith('@'));
    const manualAntes = antes.flatMap((r) => listaDeSeletores(r.prelude)).filter((s) => classesDoSeletor(s).some((c) => c.startsWith('manual-')));
    expect(manualAntes).toEqual([]);
  });

  it('as demais classes de cada seletor sao de CONTEXTO; nenhum dono das fases F4-F10 aparece', () => {
    const alheias = [...new Set(seletores.flatMap(classesDoSeletor))].filter((c) => !ehDono(c) && !CONTEXTO.has(c));
    expect(alheias).toEqual([]);
    expect([...new Set(seletores.flatMap(classesDoSeletor))].filter(ehAlheio)).toEqual([]);
  });

  it('`.paper-surface` e `jodit-*` so como contexto depois de um dono (nunca sozinhos)', () => {
    const comContexto = seletores.filter((s) => classesDoSeletor(s).some((c) => c === 'paper-surface' || c.startsWith('jodit')));
    expect(comContexto.length).toBeGreaterThan(0);
    for (const s of comContexto) expect(classesDoSeletor(s).some(ehDono), s).toBe(true);
  });

  it('nenhum seletor e so da base da pagina nem usa h1-h3 como elemento', () => {
    for (const s of seletores) {
      expect(/(^|[\s>+~])h[1-3]\b/.test(s.replace(/\[[^\]]*\]|"[^"]*"/g, '')), s).toBe(false);
    }
    expect(seletores).not.toContain('.page');
    expect(seletores).not.toContain('.page-header');
  });

  it('o escopo "papel claro" nao e tocado: nenhuma regra da regiao declara color ou color-scheme num seletor do Jodit nem na .paper-surface', () => {
    for (const r of planas) {
      const doJodit = listaDeSeletores(r.prelude).filter((s) => /jodit|paper-surface/.test(s));
      if (doJodit.length === 0) continue;
      expect(r.body, r.prelude).not.toMatch(/(^|[;{\s])(color|color-scheme)\s*:/);
    }
  });
});

describe('F11: nada dos donos sobrou fora das regioes; o resto fica intacto', () => {
  const foraLimpo = stripComments(fora);
  const foraSeletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));
  const DONOS_FORA = /^(kpi|cc-|template-|templates-|page--templates|preview-popout|overview-|relatorios-|usuario|empresa-|parceiro|auditoria-|minha-conta|assinatura-)/;

  it('nenhuma regra .kpi*, .cc-*, .template-*, .templates-*, .page--templates*, .preview-popout*, .overview-*, .relatorios-*, .usuario*, .empresa-*, .parceiro*, .auditoria-*, .minha-conta* ou .assinatura-* fora da regiao', () => {
    expect(foraSeletores.filter((s) => classesDoSeletor(s).some((c) => DONOS_FORA.test(c)))).toEqual([]);
  });

  it('o CSS compartilhado segue fora das regioes: .page-header__actions, .form-grid, .text-sm, .sr-only', () => {
    for (const s of ['.page-header__actions', '.form-grid', '.text-sm', '.sr-only']) {
      expect(foraSeletores, s).toContain(s);
    }
  });

  it('o escopo "papel claro" (Jodit e .paper-surface no escuro) segue fora das regioes, intacto', () => {
    expect(rawLf).toContain(':root[data-theme="dark"] :is(.paper-surface, .jodit-container, .jodit-popup, .jodit-dialog) {');
    expect(foraSeletores.some((s) => /jodit-container/.test(s))).toBe(true);
  });
});

describe('F11: receitas dos boards (valores exatos)', () => {
  it('Overview: KPI 20/22 raio 18 com sombra de repouso, rotulo mono 11/600, icone em quadro de 32, valor mono 34/600', () => {
    expect(naRegiao('.overview-page .kpi-grid')).toEqual({ display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' });
    expect(naRegiao('.overview-page .kpi')).toEqual({
      display: 'flex',
      'flex-direction': 'column',
      gap: '10px',
      padding: '20px 22px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-card-lg)',
      background: 'var(--rf-surface)',
      'box-shadow': 'var(--rf-shadow-rest)',
      'container-type': 'inline-size',
    });
    expect(naRegiao('.overview-page .kpi__rotulo')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '11px', 'font-weight': '600', 'letter-spacing': '1.5px', color: 'var(--rf-primary-700)' });
    expect(naRegiao('.overview-page .kpi__icone')).toMatchObject({ width: '32px', height: '32px', 'border-radius': 'var(--rf-radius-control)', background: 'var(--rf-primary-50)', color: 'var(--rf-primary-700)' });
    expect(naRegiao('.overview-page .kpi__value')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': 'clamp(22px, 16cqw, 34px)', 'font-weight': '600', 'letter-spacing': '-0.02em', 'line-height': '1.1' });
    expect(naRegiao('.overview-page .overview-top')).toEqual({ padding: '0', overflow: 'hidden' });
    expect(naRegiao('.overview-top__cabecalho')).toMatchObject({ padding: '20px 24px 14px' });
  });

  it('Relatorios: caixa de KPI 14/16 raio 14 sobre --rf-surface-alt; destaque em --rf-tone-success-bg com --rf-kpi-destaque-borda; valor mono 28/600', () => {
    expect(naRegiao('.relatorios-page .kpi')).toMatchObject({ padding: '14px 16px', 'border-radius': 'var(--rf-radius-alert)', background: 'var(--rf-surface-alt)', border: '1px solid var(--rf-divider)' });
    expect(naRegiao('.relatorios-page .kpi--destaque')).toEqual({ 'border-color': 'var(--rf-kpi-destaque-borda)', background: 'var(--rf-tone-success-bg)' });
    expect(naRegiao('.relatorios-page .kpi__value')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '28px', 'font-weight': '600', 'line-height': '1.2' });
    expect(naRegiao('.relatorios-page .kpi--destaque .kpi__rotulo')).toEqual({ color: 'var(--rf-tone-success-fg)' });
    expect(naRegiao('.relatorios-page .kpi--destaque .kpi__value')).toEqual({ color: 'var(--rf-tone-success-fg)' });
    expect(naRegiao('.relatorios-page .relatorios-tabela')).toEqual({ border: '1px solid var(--rf-divider)', 'border-radius': 'var(--rf-radius-alert)' });
    expect(naRegiao('.relatorios-linha')).toEqual({ display: 'grid', 'grid-template-columns': 'minmax(0, 1fr) minmax(0, 2fr)', gap: '20px' });
    expect(declaracoes(mediaDe('@media (max-width: 1199px)'), '.relatorios-linha')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    // sem corte: o valor do KPI quebra/encolhe em vez de ser cortado, a grade da economia so tem 3 colunas com >= 240 e a tabela do Lead-time deixa o cabecalho quebrar
    expect(naRegiao('.relatorios-page .kpi__value')).toMatchObject({ 'min-width': '0', 'overflow-wrap': 'anywhere' });
    expect(naRegiao('.relatorios-page .kpi-grid--economia')).toEqual({ 'grid-template-columns': 'repeat(auto-fit, minmax(240px, 1fr))' });
    expect(naRegiao('.relatorios-page .relatorios-tabela__tabela--lead > thead > tr > th')).toEqual({ 'padding-right': '8px', 'padding-left': '8px', 'white-space': 'normal' });
    expect(naRegiao('.overview-page .kpi')).toMatchObject({ 'container-type': 'inline-size' });
    // F12-B (B2): codigo e valores seguem nowrap; so em tela e ate 1439 (notebook; acima disso e no papel nada muda) o cabecalho das tabelas da economia e da compacta quebra, Produto / Fornecedor vencedor
    // quebram em qualquer ponto e o recuo lateral diminui (economia 12, compacta 10) para a tabela nao rolar
    expect(naRegiao('.relatorios-page .relatorios-tabela__tabela > tbody > tr > td.relatorios-codigo')).toMatchObject({ 'white-space': 'nowrap' });
    expect(naRegiao('.relatorios-page .relatorios-tabela__tabela > tbody > tr > td.relatorios-valor')).toEqual({ 'white-space': 'nowrap' });
    expect(naRegiao('.relatorios-page .relatorios-tabela__tabela--economia > thead > tr > th')).not.toHaveProperty('white-space');
    expect(naRegiao('.relatorios-page .relatorios-tabela__tabela--compacta > thead > tr > th')).not.toHaveProperty('white-space');
    const m1439 = mediaDe('@media screen and (max-width: 1439px)');
    expect(declaracoes(m1439, '.relatorios-page .relatorios-tabela__tabela--economia > thead > tr > th')).toMatchObject({ 'white-space': 'normal' });
    expect(declaracoes(m1439, '.relatorios-page .relatorios-tabela__tabela--compacta > thead > tr > th')).toMatchObject({ 'white-space': 'normal' });
    expect(declaracoes(m1439, '.relatorios-page .relatorios-tabela__tabela--economia > tbody > tr > td:nth-child(2)')).toEqual({ 'overflow-wrap': 'anywhere' });
    expect(declaracoes(m1439, '.relatorios-page .relatorios-tabela__tabela--economia > tbody > tr > td:nth-child(3)')).toEqual({ 'overflow-wrap': 'anywhere' });
    expect(declaracoes(m1439, '.relatorios-page .relatorios-tabela__tabela--economia > thead > tr > th')).toMatchObject({ 'padding-right': '12px', 'padding-left': '12px' });
    expect(declaracoes(m1439, '.relatorios-page .relatorios-tabela__tabela--economia > tbody > tr > td')).toEqual({ 'padding-right': '12px', 'padding-left': '12px' });
    expect(declaracoes(m1439, '.relatorios-page .relatorios-tabela__tabela--compacta > thead > tr > th')).toMatchObject({ 'padding-right': '10px', 'padding-left': '10px' });
    expect(declaracoes(m1439, '.relatorios-page .relatorios-tabela__tabela--compacta > tbody > tr > td')).toEqual({ 'padding-right': '10px', 'padding-left': '10px' });
    // papel: sticky so dentro de @media screen (nenhuma regra de P-ACOES vale na impressao). Excecao da fase M: o indice do Manual (.manual-indice) fica fixo em
    // qualquer largura acima de 1199 (nao ha at-rule so de tela sem teto; as de tela daqui sao max-width) e some no papel (tela F12, M6)
    expect(semMedia.filter((r) => /position:\s*sticky/.test(r.body) && !listaDeSeletores(r.prelude).every((s) => s === '.manual-indice'))).toEqual([]);
    expect(topo.filter((r) => r.prelude.startsWith('@media') && /position:\s*sticky/.test(r.body)).map((r) => r.prelude).filter((p) => !p.startsWith('@media screen'))).toEqual([]);
  });

  it('Usuarios: busca 260 x 44 com icone, filtro 180, modal de 420, e-mail travado com cadeado e estilo por :disabled', () => {
    expect(naRegiao('.usuarios-busca')).toMatchObject({ width: '260px', height: '44px', padding: '0 12px', 'border-radius': 'var(--rf-radius-control)' });
    expect(naRegiao('.usuarios-page .usuarios-filtro')).toEqual({ width: '180px', 'padding-left': '12px' });
    expect(naRegiao('.usuarios-page dialog.modal-dialog')).toEqual({ 'max-width': '420px' });
    expect(naRegiao('.usuario-campo__controle .input:disabled')).toEqual({ 'padding-right': '40px', 'border-color': 'var(--rf-border)' });
    expect(naRegiao('.usuario-campo__cadeado')).toEqual({ position: 'absolute', top: '14px', right: '14px', color: 'var(--rf-disabled-fg)' });
    expect(naRegiao('.usuario-form')).toMatchObject({ gap: '14px' });
    // F12-B (B1, P-ACOES): ate 1199 o e-mail quebra e a coluna de acoes fica fixa a direita; ate 1023 os botoes empilham
    const m1199 = mediaDe('@media screen and (max-width: 1199px)');
    expect(declaracoes(m1199, '.usuarios-page .usuarios-tabela > tbody > tr > td.usuarios-email')).toEqual({ 'min-width': '128px', 'overflow-wrap': 'anywhere' });
    expect(declaracoes(m1199, '.usuarios-page .usuarios-tabela > tbody > tr > td')).toEqual({ 'padding-right': '8px', 'padding-left': '8px' });
    for (const s of ['.usuarios-page .usuarios-tabela > thead > tr > th.usuarios-acoes-cab', '.usuarios-page .usuarios-tabela > tbody > tr > td.usuarios-acoes']) {
      expect(declaracoes(m1199, s), s).toMatchObject({ position: 'sticky', right: '0', 'z-index': '1', 'box-shadow': 'inset 1px 0 0 var(--rf-divider)' });
    }
    expect(declaracoes(m1199, '.usuarios-page .usuarios-tabela > tbody > tr > td.usuarios-acoes')).toMatchObject({ background: 'var(--rf-surface)' });
    expect(declaracoes(m1199, '.usuarios-page .usuarios-tabela > tbody > tr:hover > td.usuarios-acoes')).toEqual({ background: 'var(--rf-surface-alt)' });
    expect(declaracoes(mediaDe('@media screen and (max-width: 1023px)'), '.usuarios-page .usuarios-tabela .row-actions')).toEqual({ 'flex-direction': 'column', 'align-items': 'flex-end' });
  });

  it('Auditoria: grade de filtros do board, cartao colado e painel do diff dentro da celula (details aberto: linha em --rf-surface-alt)', () => {
    expect(naRegiao('.auditoria-filtros')).toMatchObject({
      'grid-template-columns': 'repeat(2, minmax(160px, 1.3fr)) minmax(140px, 1fr) minmax(120px, 0.8fr) minmax(100px, 0.6fr) auto',
      padding: '16px 18px',
      'border-radius': 'var(--rf-radius-card-lg)',
    });
    expect(naRegiao('.auditoria-page .auditoria-eventos')).toEqual({ padding: '0', overflow: 'hidden' });
    expect(naRegiao('.auditoria-page .auditoria-tabela > tbody > tr.auditoria-linha--aberta > td')).toEqual({ 'border-bottom': '0', background: 'var(--rf-surface-alt)' });
    expect(naRegiao('.auditoria-page .auditoria-tabela > tbody > tr.auditoria-diff-linha > td')).toEqual({ padding: '0 20px 16px', 'border-bottom': '1px solid var(--rf-divider)', background: 'var(--rf-surface-alt)' });
    expect(naRegiao('.auditoria-diff__grade')).toEqual({ display: 'grid', 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', gap: '12px' });
    expect(declaracoes(mediaDe('@media (max-width: 640px)'), '.auditoria-diff__grade')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(naRegiao('.auditoria-diff__json')).toMatchObject({ background: 'var(--rf-surface)', border: '1px solid var(--rf-border)', 'font-size': '12px', 'line-height': '1.55', 'max-height': '240px' });
    // F12-B (B3): ate 1199 o identificador e o e-mail do ator quebram em qualquer ponto
    const m1199 = mediaDe('@media screen and (max-width: 1199px)');
    expect(declaracoes(m1199, '.auditoria-id')).toEqual({ 'overflow-wrap': 'anywhere', 'min-width': '0' });
    expect(declaracoes(m1199, '.auditoria-email')).toEqual({ 'overflow-wrap': 'anywhere' });
    expect(declaracoes(m1199, '.auditoria-page .auditoria-tabela > tbody > tr > td')).toEqual({ 'padding-right': '12px', 'padding-left': '12px' });
  });

  it('Empresa: grade de 4 colunas (2 em 1199, 1 em 600), caixa do CC automatico menta com borda --rf-cc-auto-borda, resumo e rodape', () => {
    expect(naRegiao('.empresa-grade')).toEqual({ display: 'grid', 'grid-template-columns': 'repeat(4, minmax(0, 1fr))', gap: '16px' });
    expect(declaracoes(mediaDe('@media (max-width: 1199px)'), '.empresa-grade')).toEqual({ 'grid-template-columns': 'repeat(2, minmax(0, 1fr))' });
    expect(declaracoes(mediaDe('@media (max-width: 600px)'), '.empresa-grade')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(naRegiao('.cc-mode-toggle')).toMatchObject({
      padding: '14px 16px',
      border: '1px solid var(--rf-cc-auto-borda)',
      'border-radius': 'var(--rf-radius-alert)',
      background: 'var(--rf-tone-success-bg)',
    });
    expect(naRegiao('.cc-resumo')).toMatchObject({ padding: '10px 14px', background: 'var(--rf-surface-alt)', 'font-size': '12px' });
    expect(naRegiao('.empresa-page .empresa-formulario')).toMatchObject({ padding: '24px', gap: '0' });
    expect(naRegiao('.empresa-page .empresa-secao')).toMatchObject({ padding: '24px 0', 'border-top': '1px solid var(--rf-divider)' });
  });

  it('Parceiros: cartao com tabela de 10/14, modal de 560, contatos em fieldset de raio 14', () => {
    expect(naRegiao('.parceiros-credito')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '14px' });
    expect(naRegiao('.parceiros-credito dialog.modal-dialog')).toEqual({ 'max-width': '560px' });
    expect(naRegiao('.parceiros-credito .parceiros-credito__grade > tbody > tr > td')).toEqual({ padding: '10px 14px' });
    expect(naRegiao('.parceiro-credito-contato')).toMatchObject({ padding: '6px 14px 12px', border: '1px solid var(--rf-border)', 'border-radius': 'var(--rf-radius-alert)' });
    expect(naRegiao('.parceiro-credito-grade')).toMatchObject({ 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', gap: '12px' });
    // F12-B (B4, P-ACOES): ate 1199 a coluna de acoes fica fixa a direita; ate 1023 os botoes empilham
    const m1199 = mediaDe('@media screen and (max-width: 1199px)');
    for (const s of [
      '.parceiros-credito .parceiros-credito__grade > thead > tr > th.parceiros-credito__acoes-cab',
      '.parceiros-credito .parceiros-credito__grade > tbody > tr > td.parceiro-credito__acoes',
    ]) {
      expect(declaracoes(m1199, s), s).toMatchObject({ position: 'sticky', right: '0', 'z-index': '1', 'box-shadow': 'inset 1px 0 0 var(--rf-divider)' });
    }
    expect(declaracoes(m1199, '.parceiros-credito .parceiros-credito__grade > tbody > tr:hover > td.parceiro-credito__acoes')).toEqual({ background: 'var(--rf-surface-alt)' });
    expect(declaracoes(m1199, '.parceiros-credito .parceiros-credito__grade > tbody > tr > td.parceiro-credito__contato')).toEqual({ 'max-width': '240px' });
    expect(declaracoes(mediaDe('@media screen and (max-width: 1023px)'), '.parceiros-credito .parceiros-credito__grade .row-actions')).toEqual({ 'flex-direction': 'column', 'align-items': 'flex-end' });
  });

  it('Templates: cartoes em 4 colunas (7o em 2), ativo com anel --rf-action, barra, variaveis em 210 + 1fr, conteudo 1,25fr x previa 1fr e moldura do Jodit', () => {
    expect(naRegiao('.template-cards')).toMatchObject({ 'grid-template-columns': 'repeat(4, minmax(0, 1fr))', gap: '12px' });
    expect(naRegiao('.template-cards > .template-card:nth-child(7):last-child')).toEqual({ 'grid-column': 'span 2' });
    expect(naRegiao('.template-card')).toMatchObject({ padding: '14px', border: '1px solid var(--rf-border)', 'border-radius': 'var(--rf-radius-card)' });
    expect(naRegiao('.template-card--active')).toEqual({ border: '0', background: 'var(--rf-action-hover-bg)', 'box-shadow': 'inset 0 0 0 1.5px var(--rf-action)' });
    expect(naRegiao('.template-card--active .template-card__icone')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
    expect(naRegiao('.templates-barra')).toMatchObject({ padding: '12px 16px', 'border-radius': 'var(--rf-radius-card-lg)' });
    expect(naRegiao('.templates-variaveis')).toMatchObject({ 'grid-template-columns': '210px minmax(0, 1fr)', padding: '16px 18px' });
    expect(naRegiao('.templates-grade')).toMatchObject({ 'grid-template-columns': 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: '18px' });
    expect(naRegiao('.templates-editor .jodit-container:not(.jodit_inline)')).toEqual({
      border: '1.5px solid var(--rf-input-border)',
      'border-radius': 'var(--rf-radius-button)',
      overflow: 'hidden',
    });
    expect(naRegiao('.templates-previa__quadro')).toMatchObject({ height: '576px', 'border-radius': 'var(--rf-radius-alert)' });
    expect(naRegiao('.templates-previa__quadro iframe')).toMatchObject({ 'color-scheme': 'light' });
    expect(naRegiao('.preview-popout__body iframe')).toMatchObject({ 'color-scheme': 'light' });
  });

  it('Minha conta: 2 colunas, cartoes com gap 12, previa so ganha a sombra de repouso (o resto e papel claro), campo de arquivo tracejado', () => {
    expect(naRegiao('.minha-conta-grade')).toMatchObject({ 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', gap: '20px' });
    expect(naRegiao('.minha-conta-page .assinatura-cartao')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '12px' });
    expect(naRegiao('.assinatura-cartao .paper-surface')).toEqual({ 'box-shadow': 'var(--rf-shadow-rest)' });
    expect(naRegiao('.assinatura-arquivo')).toMatchObject({ border: '1.5px dashed var(--rf-input-border)', 'min-height': '44px', padding: '4px' });
    expect(naRegiao('.assinatura-arquivo__input')).toMatchObject({ position: 'absolute', width: '1px', height: '1px', clip: 'rect(0 0 0 0)' });
    expect(declaracoes(mediaDe('@media (max-width: 1023px)'), '.minha-conta-grade')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
  });

  it('pointer: coarse leva os alvos de 32/36/40 a 44 (cartoes, chips, ver diff, remover, enviar imagem, adicionar contato, tentar novamente)', () => {
    const coarse = mediaDe('@media (pointer: coarse)');
    const alvos44 = coarse.filter((r) => /min-height:\s*44px/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    for (const s of [
      '.template-card',
      '.templates-variaveis .chip',
      '.auditoria-diff__resumo',
      '.cc-list .link-button.cc-list__remover',
      '.assinatura-arquivo .assinatura-arquivo__botao',
      '.parceiro-credito-form .parceiro-credito-adicionar',
      '.overview-estado .empty-state .ghost-button',
      '.templates-page .template-editor-label .ghost-button',
      '.preview-popout .ghost-button',
    ]) {
      expect(alvos44, s).toContain(s);
    }
    // F12-B (B6): caixas de selecao de 18 ganham area de toque de 44 pelo ::after (-13 em cada lado) e o editor Jodit leva barra, rodape e links a 44
    for (const s of [
      '.cc-mode-toggle > input',
      '.cc-users__item > input',
      '.parceiro-credito-form > .checkbox-field > input',
      '.parceiro-credito-contato__rodape .checkbox-field > input',
      '.templates-conteudo .checkbox-field > input',
    ]) {
      expect(declaracoes(coarse, s), s).toEqual({ position: 'relative' });
      expect(declaracoes(coarse, `${s}::after`), s).toEqual({ content: '""', position: 'absolute', top: '-13px', right: '-13px', bottom: '-13px', left: '-13px' });
    }
    expect(declaracoes(coarse, '.templates-editor .jodit-toolbar-button_size_small')).toEqual({ 'min-width': '44px', height: '44px' });
    expect(declaracoes(coarse, '.templates-editor .jodit-toolbar-button__button')).toEqual({ 'min-width': '44px', height: '44px' });
    expect(declaracoes(coarse, '.templates-editor .jodit-status-bar-link')).toMatchObject({ 'min-height': '44px' });
    expect(declaracoes(coarse, '.templates-editor .jodit-wysiwyg a::after')).toEqual({ content: '""', position: 'absolute', top: '-14px', right: '0', bottom: '-14px', left: '0' });
  });

  it('toda transicao e animacao da regiao tem contrapartida no bloco reduced-motion da MESMA regiao; sem transform', () => {
    const comTransicao = planas.filter((r) => /(^|[;{\s])transition\s*:/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    const comAnimacao = planas.filter((r) => /(^|[;{\s])animation\s*:/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    const reduzido = mediaDe('@media (prefers-reduced-motion: reduce)');
    const semTransicao = reduzido.filter((r) => /transition:\s*none/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    const semAnimacao = reduzido.filter((r) => /animation:\s*none/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    expect(comTransicao.length).toBeGreaterThan(0);
    expect(comTransicao.filter((s) => !semTransicao.includes(s))).toEqual([]);
    expect(comAnimacao.filter((s) => !semAnimacao.includes(s))).toEqual([]);
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])transform\s*:/);
  });
});

describe('F11: fixture de tokens', () => {
  it('os 2 pares da F11 (suiteComexTokens.f11.json) existem nos 2 temas e todo token que a regiao usa esta declarado', () => {
    const f11 = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f11.json');
    expect(f11.map((t) => t.token).sort()).toEqual(['--rf-cc-auto-borda', '--rf-kpi-destaque-borda']);
    const usados = [...new Set([...(regiao?.limpo ?? '').matchAll(/var\((--rf-[\w-]+)/g)].map((m) => m[1] ?? ''))];
    expect(usados.length).toBeGreaterThan(30);
    const css = stripComments(rawLf);
    const declarado = (t: string) => new RegExp(`(^|[;{\\s])${t}\\s*:`).test(css);
    expect(usados.filter((t) => !declarado(t))).toEqual([]);
  });
});

// ---------- contraste (15.7-C) ----------
const TEXT = 4.5;
const rf = (n: string) => `--rf-${n}`;
type Par = readonly [fg: string, bg: string, min: number];
const PARES: ReadonlyArray<Par> = [
  [rf('ink-soft'), rf('surface'), TEXT], // legendas dos KPIs, dicas, resumo
  [rf('ink-soft'), rf('surface-alt'), TEXT], // dicas e resumo do CC, caixa de KPI do Relatorios
  [rf('ink-soft'), rf('tone-success-bg'), TEXT], // legenda do KPI em destaque e do CC automatico
  [rf('ink-soft'), rf('action-hover-bg'), TEXT], // descricao do cartao de template ativo
  [rf('ink'), rf('surface'), TEXT],
  [rf('ink'), rf('surface-alt'), TEXT], // pre do diff sobre a linha aberta e resumo do CC
  [rf('ink'), rf('action-hover-bg'), TEXT], // titulo do cartao de template ativo
  [rf('on-action'), rf('action'), TEXT], // icone do cartao ativo
  [rf('action'), rf('surface'), TEXT],
  [rf('primary-700'), rf('surface'), TEXT], // rotulo do KPI, ganho, Ver diff
  [rf('primary-700'), rf('primary-50'), TEXT], // icone do KPI
  [rf('primary-700'), rf('surface-alt'), TEXT], // ganho com a linha em hover
  [rf('tone-success-fg'), rf('tone-success-bg'), TEXT], // KPI em destaque, selo de origem, selos
  [rf('tone-neutral-fg'), rf('tone-neutral-bg'), TEXT], // selos de perfil e de entidade, chips estaticos
  [rf('tone-neutral-fg'), rf('surface-alt'), TEXT], // chip estatico no escuro (superficie elevada)
  [rf('tone-warning-fg'), rf('tone-warning-bg'), TEXT], // aviso de nao admin
  [rf('tone-warning-fg'), rf('tone-success-bg'), TEXT], // "· alteracoes nao salvas" no selo de origem
  [rf('tone-warning-fg'), rf('tone-neutral-bg'), TEXT], // idem sobre o selo "Padrao do sistema"
  [rf('tone-danger-fg'), rf('surface'), TEXT], // erros e "Remover"
  [rf('tone-danger-fg'), rf('tone-danger-bg'), TEXT],
  [rf('tone-danger-fg'), rf('surface-alt'), TEXT], // "Remover" na linha da lista de CC
  [rf('tone-info-fg'), rf('tone-info-bg'), TEXT], // "Padrao" e acao da auditoria
];
// Decorativas (< 3:1 nos 2 temas, registradas por teste, precedente F3d): contornos de 1 px sobre --rf-tone-success-bg.
const DECORATIVAS = [rf('kpi-destaque-borda'), rf('cc-auto-borda')] as const;

describe('F11: contraste nos 2 temas (alpha composto sobre --rf-surface)', () => {
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

  it('as bordas decorativas (KPI em destaque e caixa do CC) ficam abaixo de 3:1 contra --rf-surface nos 2 temas', () => {
    for (const theme of ['claro', 'escuro'] as const) {
      for (const token of DECORATIVAS) {
        const ratio = ratioOf(opaque(theme, token), opaque(theme, rf('surface')));
        expect(ratio, `${theme}: ${token}`).toBeLessThan(3);
      }
    }
  });
});

// ---------- TSX da fase ----------
const ARQUIVOS = [
  'pages/Home.tsx',
  'pages/Relatorios.tsx',
  'pages/Usuarios.tsx',
  'pages/Empresa.tsx',
  'components/CreditPartnersSection.tsx',
  'pages/Auditoria.tsx',
  'pages/Templates.tsx',
  'pages/MinhaConta.tsx',
] as const;
const fonte = (arquivo: string) => readSource(`../${arquivo}`);
const cssInteiro = stripComments(rawLf);
const temRegra = (classe: string) => new RegExp(`\\.${classe.replace(/[-_]/g, (m) => `\\${m}`)}(?![A-Za-z0-9_-])`).test(cssInteiro);
const contar = (texto: string, re: RegExp) => (texto.match(re) ?? []).length;

describe('F11: TSX da fase sem estilo inline, token, cor literal, glifo nem SVG local', () => {
  it.each(ARQUIVOS.filter((a) => a !== 'pages/MinhaConta.tsx'))('%s: nenhum style={', (arquivo) => {
    expect(contar(fonte(arquivo), /style=\{/g)).toBe(0);
  });

  it('MinhaConta.tsx: exatamente os 7 style={ da previa em papel (D-F11-05) e o div.paper-surface com data-testid colado (regex do themeTokens)', () => {
    const src = fonte('pages/MinhaConta.tsx');
    expect(contar(src, /style=\{/g)).toBe(7);
    expect(src).toMatch(/className="paper-surface"\s+data-testid="signature-preview"/);
    const previa = src.slice(src.indexOf('className="paper-surface"'));
    expect(contar(previa, /style=\{/g)).toBe(7);
  });

  it.each(ARQUIVOS)('%s: sem var(--rf-, <svg local, glifo, emoji, "+ " de rotulo nem eyebrow "Administracao"', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/var\(--rf-|<svg|[✉✓✕⏰−▸▾]|📦|&times;|>\s*\+ |eyebrow">Administra/);
  });

  it.each(ARQUIVOS.filter((a) => a !== 'pages/MinhaConta.tsx' && a !== 'pages/Templates.tsx'))('%s: sem cor literal', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it('Templates e MinhaConta: so as cores literais da allowlist do themeTokens (srcDoc "#888" e a previa em papel)', () => {
    for (const arquivo of ['pages/Templates.tsx', 'pages/MinhaConta.tsx']) {
      const linhas = fonte(arquivo).split(/\r?\n/).filter((l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l));
      const permitido = arquivo === 'pages/Templates.tsx' ? ['color:#888'] : ["'#fff'", "'#1F2933'", "'#4A5560'"];
      expect(linhas.filter((l) => !permitido.some((p) => l.includes(p))), arquivo).toEqual([]);
    }
  });

  it('os icones vem do Icon e sao sempre aria-hidden (o Icon ja fixa o atributo)', () => {
    for (const arquivo of ARQUIVOS) {
      const src = fonte(arquivo);
      expect(src, arquivo).not.toMatch(/<Icon[^>]*aria-hidden=\{?false/);
    }
  });

  it('Templates: o campo icon dos cartoes e IconName; os 2 iframe seguem com sandbox="" e o srcDoc mantem color:#888', () => {
    const src = fonte('pages/Templates.tsx');
    expect(src).toMatch(/icon: IconName;/);
    expect(contar(src, /<iframe\s+sandbox=""/g)).toBe(2);
    expect(contar(src, /color:#888/g)).toBe(2);
  });
});

describe('F11: toda classe que os TSX da fase usam tem regra', () => {
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

  it('toda classe com prefixo dono citada nos TSX (inclusive em ternarios e templates) tem regra na regiao ou em regra de contexto', () => {
    const faltando: string[] = [];
    for (const arquivo of ARQUIVOS) {
      for (const [token] of fonte(arquivo).matchAll(
        /(?<![\w-])(overview-|kpi|relatorios-|usuarios-|usuario-|empresa-|cc-|parceiros-credito|parceiro-credito|auditoria-|templates-|template-|preview-popout|minha-conta|assinatura-)[\w-]*/g,
      )) {
        if (token.endsWith('-')) continue; // prefixo solto
        if (!temRegra(token)) faltando.push(`${arquivo}: .${token}`);
      }
    }
    expect([...new Set(faltando)]).toEqual([]);
  });
});
