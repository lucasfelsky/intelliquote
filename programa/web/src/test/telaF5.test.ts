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

// F5 (Suite COMEX, mock v68; boards Cotacoes, CotacoesEscuro, CotacoesEstados, CotacaoNova, CotacaoNovaItens, CotacaoNovaForecast,
// CotacaoDesenvolvimento, ModalItemCatalogo, ModalNovoItem e AcessoEstados D): lista de Cotacoes, Nova cotacao, Stepper e o seletor de item
// do catalogo. CSS na regiao `tela F5` do globals.css. Esta guarda cobre: a regiao (posicao, prefixos donos, classes de contexto,
// at-rules, sem cor literal, movimento), que nada dos donos sobrou fora dela, o contraste nos 2 temas (com as excecoes do mock) e que os
// 4 TSX da tela nao tem estilo inline, token, cor literal nem glifo, e que toda classe nova que eles usam tem regra.

const NOME = 'tela F5';
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
// Prefixos DONOS: todo seletor da regiao (cada item da lista, sozinho) tem ao menos 1 classe com um destes prefixos.
const PREFIXOS_DONOS = ['cotacoes-', 'cotacao-nova', 'stepper', 'item-picker'] as const;
const ehDono = (classe: string) => PREFIXOS_DONOS.some((p) => classe.startsWith(p));
// Classes de CONTEXTO: so aparecem junto de um dono. A base da pagina (.page, .page-header, h1, .eyebrow) NAO entra: espera a TROCA.
const CONTEXTO = new Set([
  'page-header',
  'page-header__actions',
  'card',
  'table',
  'table-wrapper',
  'row-actions',
  'row-actions--nowrap',
  'cell-nowrap',
  'col-status',
  'badge',
  'chip',
  'chip--active',
  'chip--static',
  'chip-row',
  'alert',
  'alert--success',
  'alert--warning',
  'alert--error',
  'alert--info',
  'banner',
  'banner--ok',
  'banner--warning',
  'banner--error',
  'empty-state',
  'empty-state__icon',
  'empty-state__title',
  'empty-state__text',
  'empty-state--erro',
  'skeleton',
  'spinner',
  'btn-spinner',
  'ghost-button',
  'primary-button',
  'danger-button',
  'input',
  'select',
  'textarea',
  'field-label',
  'field-hint',
  'form-grid',
  'form-grid__full',
  'modal-actions',
  'pagination',
  'fgc-aviso',
  'sr-only',
]);
const BASE_DA_PAGINA = new Set(['page', 'page-header', 'eyebrow']);

describe('F5: regiao `tela F5`', () => {
  it('existe uma vez, logo depois da regiao `tela F4` (so espaco entre as duas) e tem regras', () => {
    expect(rawLf.split(`/* >>> ${NOME} (Suite COMEX) >>> */`)).toHaveLength(2);
    expect(rawLf.split(`/* <<< ${NOME} <<< */`)).toHaveLength(2);
    const f4 = regs.find((r) => r.nome === 'tela F4');
    expect(f4).toBeDefined();
    expect(regiao).toBeDefined();
    expect(rawLf.slice(f4?.fim ?? 0, regiao?.inicio ?? 0).trim()).toBe('');
    expect(planas.length).toBeGreaterThan(60);
  });

  it('a regiao vem DEPOIS das regioes F3 e da compat, logo depois da tela F4 (vence as regras de componente de mesma especificidade pela ordem)', () => {
    const compat = regs.find((r) => r.nome === 'compat Forecast F3');
    expect((compat?.fim ?? Infinity) <= (regiao?.inicio ?? 0)).toBe(true);
    expect(regs.findIndex((r) => r.nome === NOME)).toBe(regs.findIndex((r) => r.nome === 'tela F4') + 1);
  });

  it('a regiao nao declara token (--*), consome var(--rf-* e nao tem cor literal, !important nem opacity', () => {
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    expect(regiao?.limpo).toContain('var(--rf-');
    expect(regiao?.limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(regiao?.limpo).not.toContain('!important');
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])opacity\s*:/);
  });

  it('at-rules permitidas: 1199, 640, pointer: coarse e reduced-motion; sem @keyframes e sem @media print', () => {
    const atRules = topo.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    expect([...atRules].sort()).toEqual(
      ['@media (max-width: 1199px)', '@media (max-width: 640px)', '@media (pointer: coarse)', '@media (prefers-reduced-motion: reduce)'].sort(),
    );
    expect(regiao?.limpo).not.toContain('@media print');
    expect(regiao?.limpo).not.toContain('@keyframes');
    for (const m of topo.filter((r) => r.prelude.startsWith('@media'))) {
      for (const inner of parseRules(m.body)) expect(inner.prelude.startsWith('@'), inner.prelude).toBe(false);
    }
  });
});

describe('F5: prefixos donos e classes de contexto', () => {
  const seletores = planas.flatMap((r) => listaDeSeletores(r.prelude));

  it('todo seletor tem ao menos 1 classe com prefixo dono (cotacoes-, cotacao-nova, stepper, item-picker)', () => {
    expect(seletores.length).toBeGreaterThan(60);
    expect(seletores.filter((s) => !classesDoSeletor(s).some(ehDono))).toEqual([]);
  });

  it('as demais classes de cada seletor sao de CONTEXTO (lista fixa)', () => {
    const alheias = [...new Set(seletores.flatMap(classesDoSeletor))].filter((c) => !ehDono(c) && !CONTEXTO.has(c));
    expect(alheias).toEqual([]);
  });

  it('nenhum seletor e so da base da pagina (.page, .page-header, .eyebrow, h1): a TROCA e que mexe nela', () => {
    for (const s of seletores) {
      const classes = classesDoSeletor(s);
      expect(classes.every((c) => BASE_DA_PAGINA.has(c)), s).toBe(false);
    }
    expect(seletores).not.toContain('.page');
    expect(seletores).not.toContain('.page-header');
    expect(seletores.some((s) => /(^|[\s>])h[1-3]\b/.test(s.replace(/\[[^\]]*\]|"[^"]*"/g, '')))).toBe(false);
  });
});

describe('F5: nada dos donos sobrou fora das regioes', () => {
  const foraLimpo = stripComments(fora);
  const foraSeletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));

  it('nenhuma regra .item-picker*, .stepper*, .cotacoes-* ou .cotacao-nova* fora da regiao (o grupo antigo do seletor foi apagado)', () => {
    expect(foraSeletores.filter((s) => classesDoSeletor(s).some(ehDono))).toEqual([]);
  });

  it('as regras que ficam fora e sao usadas pelo Detalhe (F6) seguem no lugar: .item-form__error e .form-grid (.item-form__scope e __check, sem uso, sairam na TROCA-2)', () => {
    expect(foraSeletores).not.toContain('.item-form__scope');
    expect(foraSeletores).not.toContain('.item-form__check');
    expect(foraSeletores).toContain('.item-form__error');
    expect(foraSeletores).toContain('.form-grid');
  });
});

describe('F5: receitas dos boards (valores exatos)', () => {
  it('Stepper: cartao 18 (--rf-radius-card-lg) 16/24; passo atual em --rf-action/--rf-on-action, feito em tom success, pendente em tom neutro; ligacao 48 x 2', () => {
    expect(naRegiao('.stepper')).toEqual({
      padding: '16px 24px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-card-lg)',
      background: 'var(--rf-surface)',
    });
    expect(naRegiao('.stepper__marca')).toMatchObject({
      width: '28px',
      height: '28px',
      'border-radius': 'var(--rf-radius-pill)',
      background: 'var(--rf-tone-neutral-bg)',
      color: 'var(--rf-tone-neutral-fg)',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '13px',
      'font-weight': '700',
    });
    expect(naRegiao('.stepper__passo--atual .stepper__marca')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
    expect(naRegiao('.stepper__passo--feito .stepper__marca')).toEqual({ background: 'var(--rf-tone-success-bg)', color: 'var(--rf-tone-success-fg)' });
    expect(naRegiao('.stepper__ligacao')).toMatchObject({ flex: '0 0 48px', height: '2px', 'border-radius': '2px', background: 'var(--rf-border)' });
    expect(naRegiao('.stepper__ligacao--feita')).toEqual({ background: 'var(--rf-primary)' });
  });

  it('filtros: grade minmax(240px, 2fr) + 4 x minmax(150px, 1fr), gap 12, padding 16, raio 18; rotulo 12/700; 2 colunas ate 1199 e 1 coluna ate 640 (D-F5-15)', () => {
    expect(naRegiao('.cotacoes-filtros')).toMatchObject({
      display: 'grid',
      'grid-template-columns': 'minmax(240px, 2fr) repeat(4, minmax(150px, 1fr))',
      gap: '12px',
      padding: '16px',
      'border-radius': 'var(--rf-radius-card-lg)',
    });
    expect(naRegiao('.cotacoes-filtro__rotulo')).toMatchObject({ 'font-size': '12px', 'font-weight': '700' });
    expect(declaracoes(mediaDe('@media (max-width: 1199px)'), '.cotacoes-filtros')).toEqual({ 'grid-template-columns': 'repeat(2, minmax(0, 1fr))' });
    expect(declaracoes(mediaDe('@media (max-width: 1199px)'), '.cotacoes-filtro--busca')).toEqual({ 'grid-column': '1 / -1' });
    expect(declaracoes(mediaDe('@media (max-width: 640px)'), '.cotacoes-filtros')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
  });

  it('busca com icone: 44, 0 12, borda 1,5 --rf-input-border, raio 10; foco no contentor com --rf-action e halo', () => {
    for (const s of ['.cotacoes-busca', '.item-picker__busca']) {
      expect(naRegiao(s), s).toMatchObject({
        height: '44px',
        padding: '0 12px',
        border: '1.5px solid var(--rf-input-border)',
        'border-radius': 'var(--rf-radius-control)',
        gap: '8px',
      });
      expect(naRegiao(`${s}:focus-within`), s).toEqual({
        'border-color': 'var(--rf-action)',
        'box-shadow': '0 0 0 4px var(--rf-focus-halo)',
      });
    }
  });

  it('tabela das Cotacoes: cartao colado (sem padding), 20 nas bordas, acoes com td de 10 (linha 57), numeros e codigo em mono, status a esquerda', () => {
    expect(naRegiao('.cotacoes-tabela-card')).toEqual({ padding: '0', overflow: 'hidden' });
    expect(naRegiao('.cotacoes-tabela td:last-child')).toEqual({ padding: '10px 20px 10px 16px' });
    expect(naRegiao('.cotacoes-tabela th:first-child')).toEqual({ 'padding-left': '20px' });
    expect(naRegiao('.cotacoes-tabela td:first-child')).toEqual({ 'padding-left': '20px' });
    expect(naRegiao('.cotacoes-tabela th:last-child')).toEqual({ 'padding-right': '20px' });
    expect(naRegiao('.cotacoes-codigo')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '14px', 'font-weight': '600' });
    expect(naRegiao('.cotacoes-tabela td.cotacoes-id')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-size': '13px', color: 'var(--rf-ink-soft)' });
    expect(naRegiao('.cotacoes-tabela td.cotacoes-num')).toMatchObject({ 'font-family': 'var(--rf-font-mono)' });
    expect(naRegiao('.cotacoes-tabela .col-status')).toEqual({ 'text-align': 'left' });
    expect(naRegiao('.cotacoes-tabela .row-actions')).toEqual({ 'justify-content': 'flex-end', gap: '4px' });
  });

  it('"Tentar novamente": secundario pequeno do mock (36, 0 14, raio 10, 13 px) e 44 em pointer: coarse', () => {
    expect(naRegiao('.cotacoes-estado .empty-state .ghost-button')).toEqual({
      'min-height': '36px',
      'margin-top': '8px',
      padding: '0 14px',
      'border-radius': 'var(--rf-radius-control)',
      'font-size': '13px',
    });
    expect(naRegiao('.cotacoes-estado .empty-state')).toEqual({ padding: '32px 24px' });
    const alvos = coarse.flatMap((r) => listaDeSeletores(r.prelude));
    for (const s of ['.cotacao-nova__incoterms .chip', '.item-picker__familia', '.item-picker__item', '.cotacoes-estado .empty-state .ghost-button']) {
      expect(alvos, s).toContain(s);
    }
    expect(coarse.every((r) => /min-height:\s*44px/.test(r.body))).toBe(true);
  });

  it('skeleton com a forma da tabela: grade 22px 1fr 64px 40px 62px, gap 14, cabecalho 41 e linhas 55 (40/54 + 1 px de borda no board); 7 larguras do board', () => {
    for (const s of ['.cotacoes-skeleton__cab', '.cotacoes-skeleton__linha']) {
      expect(naRegiao(s), s).toMatchObject({
        display: 'grid',
        'grid-template-columns': '22px 1fr 64px 40px 62px',
        gap: '14px',
        padding: '0 18px',
      });
    }
    expect(naRegiao('.cotacoes-skeleton__cab')).toMatchObject({ height: '41px', background: 'var(--rf-surface-alt)' });
    expect(naRegiao('.cotacoes-skeleton__linha')).toMatchObject({ height: '55px' });
    const larguras = [1, 2, 3, 4, 5, 6, 7].map((n) => naRegiao(`.cotacoes-skeleton__linha:nth-child(${n}) .cotacoes-skeleton__texto`).width);
    expect(larguras).toEqual(['78%', '64%', '72%', '58%', '70%', '62%', '76%']);
    expect(naRegiao('.cotacoes-carregando .btn-spinner')).toEqual({ 'border-color': 'var(--rf-border)', 'border-top-color': 'var(--rf-action)' });
  });

  it('chips de incoterm: 34 (44 em coarse), 0 12, mono 12; ativo = navy do F3b com borda 1 --rf-action e 600; foco com anel duplo', () => {
    expect(naRegiao('.cotacao-nova__incoterms .chip')).toEqual({
      'min-height': '34px',
      padding: '0 12px',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '12px',
    });
    expect(naRegiao('.cotacao-nova__incoterms .chip--active')).toEqual({ border: '1px solid var(--rf-action)', 'font-weight': '600' });
    expect(naRegiao('.cotacao-nova__incoterms .chip:focus-visible')).toMatchObject({
      outline: '2px solid transparent',
      'box-shadow': '0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-action)',
    });
    expect(naRegiao('.cotacao-nova__incoterms .chip-row')).toEqual({ gap: '8px' });
  });

  it('Nova cotacao: cartao do passo 1 (24, gap 20; grade 18/20), campos em mono, vinculo em flex com icone, tabela com contorno 1 px e raio 16 (D-F5-05)', () => {
    expect(naRegiao('.cotacao-nova__form')).toEqual({ display: 'flex', 'flex-direction': 'column', gap: '20px', padding: '24px' });
    expect(naRegiao('.cotacao-nova__form .form-grid')).toEqual({ gap: '18px 20px' });
    expect(naRegiao('.cotacao-nova__codigo')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-weight': '500' });
    expect(naRegiao('.cotacao-nova__moeda')).toMatchObject({ 'font-family': 'var(--rf-font-mono)', 'font-weight': '600' });
    expect(naRegiao('.cotacao-nova__vinculo')).toEqual({ display: 'flex', 'align-items': 'center', gap: '10px' });
    expect(naRegiao('.cotacao-nova__tabela')).toEqual({ border: '1px solid var(--rf-divider)', 'border-radius': 'var(--rf-radius-card)' });
    expect(naRegiao('.cotacao-nova__tabela td')).toEqual({ padding: '12px 16px' });
    expect(naRegiao('.cotacao-nova__tabela td:last-child')).toEqual({ padding: '8px 16px' });
    expect(naRegiao('.cotacao-nova__tabela tbody tr:last-child td')).toEqual({ 'border-bottom': '0' });
    expect(naRegiao('.cotacao-nova__titulo')).toMatchObject({ color: 'var(--rf-ink)', 'font-family': 'var(--rf-font-display)', 'font-size': '20px', 'font-weight': '700' });
  });

  it('avisos do Forecast (D-F5-09): o arquivo do Forecast nao muda; so o espacamento por CSS escopado', () => {
    expect(naRegiao('.cotacao-nova-page .fgc-aviso')).toEqual({ margin: '0' });
    expect(naRegiao('.cotacao-nova-page :is(.alert, .banner)')).toEqual({ margin: '0' });
  });

  it('seletor de item: colunas 1fr 1fr gap 20; pastas 11 mono caixa alta em --rf-primary-700; item 13/500 (selecionado 700 com anel 1,5 --rf-action); busca 8, pastas 6', () => {
    expect(naRegiao('.item-picker')).toMatchObject({ display: 'grid', 'grid-template-columns': 'minmax(0, 1fr) minmax(0, 1fr)', gap: '20px' });
    expect(naRegiao('.item-picker__main')).toMatchObject({ gap: '14px' });
    expect(naRegiao('.item-picker__browser')).toMatchObject({
      gap: '6px',
      'max-height': '420px',
      padding: '8px',
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-card)',
      background: 'var(--rf-surface-alt)',
    });
    expect(naRegiao('.item-picker__browser--busca')).toEqual({ gap: '8px' });
    expect(naRegiao('.item-picker__familia')).toMatchObject({
      'min-height': '32px',
      padding: '0 8px',
      color: 'var(--rf-primary-700)',
      'font-family': 'var(--rf-font-mono)',
      'font-size': '11px',
      'font-weight': '600',
      'letter-spacing': '1px',
      'text-transform': 'uppercase',
    });
    expect(naRegiao('.item-picker__item')).toMatchObject({ padding: '9px 10px', 'border-radius': 'var(--rf-radius-control)', 'font-size': '13px', 'font-weight': '500' });
    expect(naRegiao('.item-picker__browser--busca .item-picker__item')).toEqual({ padding: '10px' });
    expect(naRegiao('.item-picker__item[aria-pressed="true"]')).toEqual({
      background: 'var(--rf-action-hover-bg)',
      'box-shadow': 'inset 0 0 0 1.5px var(--rf-action)',
      'font-weight': '700',
    });
    expect(naRegiao('.item-picker__selecionado')).toMatchObject({
      padding: '10px 12px',
      gap: '12px',
      background: 'var(--rf-primary-50)',
      'border-radius': 'var(--rf-radius-button)',
    });
    expect(naRegiao('.item-picker__spinner')).toMatchObject({ width: '12px', height: '12px' });
  });

  it('seletor de item: uma coluna ate 640 e a lista rola ate 280', () => {
    const m = mediaDe('@media (max-width: 640px)');
    expect(declaracoes(m, '.item-picker')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(declaracoes(m, '.item-picker__browser')).toEqual({ 'max-height': '280px' });
  });

  it('reduced-motion: a regiao nao anima (o skeleton e o spinner vem da F3); transicoes de cor desligadas', () => {
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])animation\s*:/);
    expect(regiao?.limpo).not.toMatch(/transition\s*:[^;]*\btransform\b/);
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])transform\s*:/);
    const comTransicao = semMedia.filter((r) => /(^|[;{\s])transition\s*:/.test(r.body)).flatMap((r) => listaDeSeletores(r.prelude));
    for (const s of comTransicao) expect(declaracoes(reduzido, s).transition, s).toBe('none');
  });
});

describe('F5: fixture de tokens', () => {
  it('a fixture .f5 (se existir) so tem pares claro/escuro, nenhuma constante, e todos estao no CSS', () => {
    const f5 = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f5.json');
    expect(f5.filter((t) => t.constante)).toEqual([]);
    expect(f5.length).toBeLessThanOrEqual(3);
    for (const t of f5) {
      expect(lightTokens[t.token], t.token).toBe(t.claro);
      expect(darkTokens[t.token], t.token).toBe(t.escuro);
    }
  });
});

// ---------- contraste ----------
const TEXT = 4.5;
const UI = 3;
const rf = (n: string) => `--rf-${n}`;
type Par = readonly [fg: string, bg: string, min: number];
const PARES: ReadonlyArray<Par> = [
  [rf('on-action'), rf('action'), TEXT], // numero do passo atual e chip ativo
  [rf('tone-success-fg'), rf('tone-success-bg'), TEXT], // passo feito e alerta de vinculo
  [rf('tone-neutral-fg'), rf('tone-neutral-bg'), TEXT], // passo pendente
  [rf('ink'), rf('surface'), TEXT], // rotulos, titulos, codigo
  [rf('ink-soft'), rf('surface'), TEXT], // textos de apoio, passo inativo, dica, cabecalho de coluna
  [rf('ink'), rf('surface-alt'), TEXT], // item do seletor
  [rf('ink-soft'), rf('surface-alt'), TEXT], // contagem e estados da pasta
  [rf('primary-700'), rf('surface-alt'), TEXT], // cabecalho da familia (sobre a coluna --rf-surface-alt do board)
  [rf('primary-700'), rf('surface'), TEXT], // cabecalho da familia sobre superficie
  [rf('ink'), rf('action-hover-bg'), TEXT], // item selecionado
  [rf('ink'), rf('primary-50'), TEXT], // resumo do item escolhido
  [rf('ink-soft'), rf('primary-50'), TEXT], // "Familia: ..." do resumo
  [rf('action'), rf('surface'), TEXT], // "Tentar novamente"
  [rf('danger'), rf('tone-danger-bg'), UI], // icone do erro
  [rf('primary-700'), rf('surface'), UI], // icone do vazio e do cadeado
  [rf('input-border'), rf('surface'), UI], // borda dos campos (D3)
  [rf('input-border'), rf('input-bg'), UI], // borda da busca com icone
];
const EXCECOES: ReadonlyArray<{ id: string; fg: string; bg: string; tema: ThemeName; esperado: number }> = [
  { id: 'contorno do chip desligado (--rf-border sobre --rf-surface; o estado vem do preenchimento e do aria-pressed)', fg: rf('border'), bg: rf('surface'), tema: 'claro', esperado: 1.33 },
  { id: 'tracejado do vazio (--rf-empty-border sobre --rf-surface; D-F3-09)', fg: rf('empty-border'), bg: rf('surface'), tema: 'claro', esperado: 1.69 },
];

describe('F5: contraste nos 2 temas (alpha composto sobre --rf-surface)', () => {
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

  it('excecoes do mock (nenhuma e texto): chip desligado 1,33:1 e tracejado do vazio 1,69:1 (claro) / 1,97:1 (escuro)', () => {
    for (const e of EXCECOES) {
      const ratio = ratioOf(opaque(e.tema, e.fg), opaque(e.tema, e.bg));
      expect(ratio, e.id).toBeGreaterThan(e.esperado - 0.05);
      expect(ratio, e.id).toBeLessThan(e.esperado + 0.05);
      expect(ratio, `${e.id} segue abaixo de 3:1 (excecao registrada)`).toBeLessThan(UI);
    }
    const escuro = ratioOf(opaque('escuro', rf('empty-border')), opaque('escuro', rf('surface')));
    expect(escuro).toBeGreaterThan(1.92);
    expect(escuro).toBeLessThan(2.02);
  });
});

// ---------- TSX da fase ----------
const ARQUIVOS = ['pages/Cotacoes.tsx', 'pages/CotacaoNova.tsx', 'components/CatalogItemPicker.tsx', 'components/Stepper.tsx'] as const;
const fonte = (arquivo: string) => readSource(`../${arquivo}`);
const cssInteiro = stripComments(rawLf);
const temRegra = (classe: string) => new RegExp(`\\.${classe.replace(/[-_]/g, (m) => `\\${m}`)}(?![A-Za-z0-9_-])`).test(cssInteiro);

describe('F5: TSX da fase sem estilo inline, token, cor literal nem glifo', () => {
  it.each(ARQUIVOS)('%s', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--rf-|style=\{\{|[▸▾→]|&times;/);
  });

  it.each(ARQUIVOS)('%s: sem o "+" de texto nos botoes (vira icone, D-F5-02)', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/>\s*\+\s+(Nova cotação|Adicionar item)|'\+ (Nova cotação|Adicionar item)'/);
  });
});

describe('F5: toda classe que os TSX da fase usam tem regra', () => {
  it('classes literais de className="..." tem regra (a base da pagina, .page-header, espera a TROCA)', () => {
    const faltando: string[] = [];
    for (const arquivo of ARQUIVOS) {
      for (const [, valor] of fonte(arquivo).matchAll(/className="([^"]+)"/g)) {
        for (const classe of (valor ?? '').split(/\s+/).filter(Boolean)) {
          if (classe === 'page-header') continue;
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
      for (const [token] of fonte(arquivo).matchAll(/(?<![\w-])(cotacoes-|cotacao-nova|stepper|item-picker)[\w-]*/g)) {
        if (token.endsWith('-')) continue; // prefixo de template (stepper__passo--${estado}): as variantes sao conferidas abaixo
        if (!naRegiaoClasses.has(token)) faltando.push(`${arquivo}: .${token}`);
      }
    }
    expect([...new Set(faltando)]).toEqual([]);
    for (const v of ['atual', 'feito']) expect(naRegiaoClasses.has(`stepper__passo--${v}`), v).toBe(true);
  });
});
