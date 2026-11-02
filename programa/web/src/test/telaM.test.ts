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
  stripComments,
  temasDeTokens,
  tokensDosTemas,
  type CssRule,
  type Rgb,
  type ThemeName,
} from './rfCss';
import { CAPITULOS } from '../pages/Manual/capitulos';
import { calcularWaterfall } from '../pages/Manual/waterfall';

// Fase M (Suite COMEX; Manual de uso, previa aprovada manual-previa.html): CSS na regiao `tela F11` (D-M-01), prefixo `manual-`. Esta guarda cobre: toda regra
// do Manual dentro da regiao (nenhuma fora), seletores so com classes `manual-*`, so token `--rf-*` (sem cor literal, !important, transform, token
// declarado nem @media print), at-rules permitidas, movimento reduzido, alvos de toque de 44, que toda classe `manual-*` usada nos TSX tem regra, o
// contraste nos 2 temas, e que os TSX do Manual nao tem estilo inline, token, cor literal, glifo, iframe, `.alert` nem SVG fora de `figuras/`.

const NOME = 'tela F11';
const MARCADOR = '/* ---- Manual de uso (fase M) ---- */';
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

interface RegraDoManual {
  seletores: string[];
  corpo: string;
  // '' = fora de at-rule; senao o texto do at-rule (@media ...)
  atRule: string;
}

const ehManual = (seletor: string) => classesDoSeletor(seletor).some((c) => c.startsWith('manual-'));

function regrasDoManual(rules: CssRule[], atRule = ''): RegraDoManual[] {
  const out: RegraDoManual[] = [];
  for (const r of rules) {
    if (/^@(media|supports)\b/.test(r.prelude)) out.push(...regrasDoManual(parseRules(r.body), r.prelude));
    else if (!r.prelude.startsWith('@')) {
      const seletores = listaDeSeletores(r.prelude);
      if (seletores.some(ehManual)) out.push({ seletores, corpo: r.body, atRule });
    }
  }
  return out;
}

const topo = regiao?.regras ?? [];
const manual = regrasDoManual(topo);
const declaracoes = (seletor: string, atRule = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const r of manual) {
    if (r.atRule !== atRule || !r.seletores.includes(seletor)) continue;
    for (const [, prop, valor] of r.corpo.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) {
      if (prop !== undefined && valor !== undefined) out[prop] = valor.replace(/\s+/g, ' ').trim();
    }
  }
  return out;
};
const textoDoManual = manual.map((r) => `${r.seletores.join(', ')} { ${r.corpo} }`).join('\n');

// ---------- fontes TSX ----------
const fontes = import.meta.glob(['../pages/Manual.tsx', '../pages/Manual/**/*.ts', '../pages/Manual/**/*.tsx', '!../pages/Manual/**/*.test.ts', '!../pages/Manual/**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const arquivos = Object.entries(fontes);
const App = readSource('../App.tsx');

describe('M: CSS do Manual na regiao `tela F11`', () => {
  it('o bloco do Manual existe uma vez dentro da regiao `tela F11`, depois das regras de F11 e antes dos at-rules de largura', () => {
    expect(regiao).toBeDefined();
    expect(regiao?.bruto.split(MARCADOR)).toHaveLength(2);
    const marcador = regiao?.bruto.indexOf(MARCADOR) ?? -1;
    const primeiroMedia = regiao?.bruto.indexOf('@media screen and (max-width: 1439px)') ?? -1;
    expect(marcador).toBeGreaterThan(0);
    expect(marcador).toBeLessThan(primeiroMedia);
    expect(manual.length).toBeGreaterThan(20);
  });

  it('nenhuma regra `manual-` fora da regiao `tela F11` (nem em outra regiao, nem solta no CSS)', () => {
    const seletoresFora = parseRules(stripComments(fora)).flatMap((r) =>
      r.prelude.startsWith('@') ? parseRules(r.body).flatMap((i) => listaDeSeletores(i.prelude)) : listaDeSeletores(r.prelude),
    );
    expect(seletoresFora.filter(ehManual)).toEqual([]);
    // M6: a impressao do Manual mora na regiao `tela F12` (so @media print, sob o escopo das 8 raizes; telaF12.test confere); nas demais regioes nada de manual-
    for (const r of regs.filter((x) => x.nome !== NOME && x.nome !== 'tela F12')) expect(r.limpo, r.nome).not.toContain('manual-');
    expect(Object.keys(THEMES.claro).filter((t) => t.includes('manual'))).toEqual([]);
  });

  it('todo seletor de regra do Manual usa SO classes `manual-*` (nenhuma classe de contexto) e nenhum h1-h3 como elemento', () => {
    for (const r of manual) {
      for (const s of r.seletores) {
        expect(ehManual(s), s).toBe(true);
        expect(classesDoSeletor(s).filter((c) => !c.startsWith('manual-')), s).toEqual([]);
        expect(/(^|[\s>+~])h[1-3]\b/.test(s.replace(/\[[^\]]*\]|"[^"]*"/g, '')), s).toBe(false);
      }
    }
  });

  it('so var(--rf-*): sem cor literal, !important, transform, custom property declarada nem @media print', () => {
    expect(textoDoManual).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(textoDoManual).not.toContain('!important');
    expect(textoDoManual).not.toMatch(/(^|[;{\s])transform\s*:/);
    expect(textoDoManual).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    expect(manual.filter((r) => r.atRule.includes('print'))).toEqual([]);
    const usados = [...textoDoManual.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '');
    expect(usados.length).toBeGreaterThan(10);
    expect(usados.filter((t) => !t.startsWith('--rf-'))).toEqual([]);
    const css = stripComments(rawLf);
    const declarado = (t: string) => new RegExp(`(^|[;{\\s])${t}\\s*:`).test(css);
    expect([...new Set(usados)].filter((t) => !declarado(t))).toEqual([]);
  });

  it('at-rules das regras do Manual: so screen 1199, screen 1023, pointer: coarse e reduced-motion', () => {
    const permitidas = ['', '@media screen and (max-width: 1199px)', '@media screen and (max-width: 1023px)', '@media (pointer: coarse)', '@media (prefers-reduced-motion: reduce)'];
    expect([...new Set(manual.map((r) => r.atRule))].filter((a) => !permitidas.includes(a))).toEqual([]);
  });

  it('as regras de at-rule vem DEPOIS de todas as regras base do Manual (vencem pela ordem de cascata)', () => {
    const ordem = topo.map((r) => (r.prelude.startsWith('@') ? (regrasDoManual([r]).length > 0 ? 'at-manual' : 'at') : regrasDoManual([r]).length > 0 ? 'base-manual' : 'outra'));
    const ultimaBase = ordem.lastIndexOf('base-manual');
    const primeiraAt = ordem.indexOf('at-manual');
    expect(ultimaBase).toBeGreaterThan(0);
    expect(primeiraAt).toBeGreaterThan(ultimaBase);
  });

  it('1199: uma coluna, o indice lateral some e entra o seletor de capitulo; 1023: capitulo com padding 20/16', () => {
    const m1199 = '@media screen and (max-width: 1199px)';
    expect(declaracoes('.manual-layout', m1199)).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(declaracoes('.manual-indice', m1199)).toEqual({ display: 'none' });
    expect(declaracoes('.manual-indice-select', m1199)).toEqual({ display: 'block' });
    expect(declaracoes('.manual-indice-select')).toEqual({ display: 'none' });
    expect(declaracoes('.manual-capitulo', '@media screen and (max-width: 1023px)')).toEqual({ padding: '20px 16px 22px' });
  });

  it('layout de 2 colunas (indice 228 + artigo), indice fixo com rolagem propria e capitulo com scroll-margin-top 16', () => {
    expect(declaracoes('.manual-layout')).toMatchObject({ display: 'grid', 'grid-template-columns': '228px minmax(0, 1fr)', gap: '28px', 'align-items': 'start' });
    expect(declaracoes('.manual-indice')).toMatchObject({ position: 'sticky', top: '16px', 'max-height': 'calc(100vh - 32px)', 'overflow-y': 'auto' });
    expect(declaracoes('.manual-capitulo')).toMatchObject({
      border: '1px solid var(--rf-border)',
      'border-radius': 'var(--rf-radius-alert)',
      background: 'var(--rf-surface)',
      'box-shadow': 'var(--rf-shadow-rest)',
      'scroll-margin-top': '16px',
    });
    expect(declaracoes('.manual-capitulo[hidden]')).toEqual({ display: 'none' });
  });

  it('componentes do texto (M2): rotulo de botao, passos pelo contador, aviso por tipo, figura, selo de exemplo e tabela da previa', () => {
    expect(declaracoes('.manual-ui')).toMatchObject({ 'border-bottom-width': '2px', 'border-radius': '6px', 'white-space': 'nowrap', background: 'var(--rf-surface-alt)', color: 'var(--rf-ink)' });
    expect(declaracoes('.manual-ui--primario')).toEqual({ 'border-color': 'var(--rf-primary-700)', background: 'var(--rf-primary)', color: 'var(--rf-on-primary)' });
    expect(declaracoes('.manual-passos')).toMatchObject({ 'list-style': 'none', 'counter-reset': 'manual-passo' });
    expect(declaracoes('.manual-passos__item')).toMatchObject({ 'grid-template-columns': '28px minmax(0, 1fr)', 'counter-increment': 'manual-passo' });
    expect(declaracoes('.manual-passos__item::before')).toMatchObject({ content: 'counter(manual-passo)', width: '28px', height: '28px', background: 'var(--rf-primary-50)', color: 'var(--rf-primary-700)' });
    expect(declaracoes('.manual-aviso--dica .manual-aviso__icone')).toEqual({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
    expect(declaracoes('.manual-aviso--atencao')).toEqual({ 'border-color': 'var(--rf-aviso-borda-suave)', background: 'var(--rf-tone-warning-bg)' });
    expect(declaracoes('.manual-aviso--atencao .manual-aviso__icone')).toEqual({ background: 'var(--rf-tone-warning-fg)', color: 'var(--rf-surface)' });
    expect(declaracoes('.manual-aviso--info .manual-aviso__icone')).toEqual({ background: 'var(--rf-tone-info-fg)', color: 'var(--rf-surface)' });
    expect(declaracoes('.manual-figura__caixa')).toMatchObject({ padding: '18px', background: 'var(--rf-surface-alt)', 'border-radius': 'var(--rf-radius-xs)' });
    expect(declaracoes('.manual-exemplo')).toMatchObject({ background: 'var(--rf-tone-warning-bg)', color: 'var(--rf-tone-warning-fg)', 'text-transform': 'uppercase' });
    expect(declaracoes('.manual-tabela__tabela th')).toMatchObject({ 'text-transform': 'uppercase', color: 'var(--rf-ink-soft)' });
    expect(declaracoes('.manual-tabela__tabela td')).toMatchObject({ padding: '9px 12px', color: 'var(--rf-ink-soft)' });
    expect(declaracoes('.manual-svg--fluxo')).toEqual({ 'min-width': '760px' });
  });

  it('regiao que rola na horizontal (.manual-rolagem): overflow-x e anel de foco da Suite; a regua usa uma classe de posicao por marca, sem transform', () => {
    expect(declaracoes('.manual-rolagem')).toEqual({ 'overflow-x': 'auto' });
    expect(declaracoes('.manual-rolagem:focus-visible')).toMatchObject({ outline: '2px solid transparent', 'box-shadow': '0 0 0 3px var(--rf-surface), 0 0 0 5px var(--rf-action)' });
    expect(declaracoes('.manual-regua__marca')).toMatchObject({ position: 'absolute', width: '0', 'align-items': 'center' });
    const esquerda = (m: string) => declaracoes(`.manual-regua__marca--${m}`).left;
    expect(['d30', 'd15', 'd7', 'd0', 'vencido'].map(esquerda)).toEqual(['0%', '42.9%', '65.7%', '85.7%', '100%']);
  });

  it('capitulos 8 a 10 (M3): PO agrupada em 3 colunas, e-mail em grade 54 + 1fr, semana de 7 dias, tela do portal na cor de acao e ciclo em SVG', () => {
    expect(declaracoes('.manual-po-colunas')).toMatchObject({ display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))' });
    expect(declaracoes('.manual-po--sem')).toEqual({ 'border-style': 'dashed', background: 'var(--rf-surface-alt)' });
    expect(declaracoes('.manual-email__linha')).toMatchObject({ display: 'grid', 'grid-template-columns': '54px minmax(0, 1fr)' });
    expect(declaracoes('.manual-email__endereco--principal')).toEqual({ 'border-color': 'var(--rf-vencedora-borda)', background: 'var(--rf-primary-50)', color: 'var(--rf-primary-700)' });
    expect(declaracoes('.manual-email__endereco--primeiro')).toEqual({ 'border-color': 'var(--rf-aviso-borda-suave)', background: 'var(--rf-tone-warning-bg)', color: 'var(--rf-tone-warning-fg)' });
    expect(declaracoes('.manual-semana')).toMatchObject({ display: 'grid', 'grid-template-columns': 'repeat(7, minmax(0, 1fr))', gap: '6px' });
    expect(declaracoes('.manual-dia__ponto')).toMatchObject({ background: 'var(--rf-primary)' });
    expect(declaracoes('.manual-dia--folga .manual-dia__ponto')).toEqual({ border: '1.5px dashed var(--rf-empty-border)', background: 'transparent' });
    expect(declaracoes('.manual-portal__barra')).toMatchObject({ background: 'var(--rf-action)', color: 'var(--rf-on-action)' });
    expect(declaracoes('.manual-portal__campos')).toMatchObject({ 'grid-template-columns': 'repeat(auto-fit, minmax(130px, 1fr))' });
    expect(declaracoes('.manual-svg--ciclo')).toEqual({ 'min-width': '520px' });
    const m1023 = '@media screen and (max-width: 1023px)';
    expect(declaracoes('.manual-po-colunas', m1023)).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(declaracoes('.manual-semana', m1023)).toEqual({ gap: '4px' });
    expect(declaracoes('.manual-dia', m1023)).toEqual({ padding: '8px 2px' });
  });

  it('1023 (tela): grades de 2 e 3 colunas viram 1; indicadores de 4 viram 2', () => {
    const m1023 = '@media screen and (max-width: 1023px)';
    expect(declaracoes('.manual-grade--2', m1023)).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(declaracoes('.manual-grade--3', m1023)).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(declaracoes('.manual-kpis')).toMatchObject({ 'grid-template-columns': 'repeat(4, minmax(0, 1fr))' });
    expect(declaracoes('.manual-kpis', m1023)).toEqual({ 'grid-template-columns': 'repeat(2, minmax(0, 1fr))' });
  });

  it('o indice fica sticky so na regra `.manual-indice` e a rolagem do html e suave, com `auto` no movimento reduzido', () => {
    const sticky = manual.filter((r) => /position:\s*sticky/.test(r.corpo));
    expect(sticky.map((r) => r.seletores)).toEqual([['.manual-indice']]);
    expect(declaracoes('html:has(.manual-page)')).toEqual({ 'scroll-behavior': 'smooth' });
    expect(declaracoes('html:has(.manual-page)', '@media (prefers-reduced-motion: reduce)')).toEqual({ 'scroll-behavior': 'auto' });
  });

  it('toda transicao e animacao do Manual tem contrapartida no bloco reduced-motion', () => {
    const reduzido = manual.filter((r) => r.atRule === '@media (prefers-reduced-motion: reduce)');
    const semTransicao = reduzido.filter((r) => /transition:\s*none/.test(r.corpo)).flatMap((r) => r.seletores);
    const semAnimacao = reduzido.filter((r) => /animation:\s*none/.test(r.corpo)).flatMap((r) => r.seletores);
    const comTransicao = manual.filter((r) => r.atRule === '' && /(^|[;{\s])transition\s*:/.test(r.corpo)).flatMap((r) => r.seletores);
    const comAnimacao = manual.filter((r) => r.atRule === '' && /(^|[;{\s])animation\s*:/.test(r.corpo)).flatMap((r) => r.seletores);
    expect(comTransicao.filter((s) => !semTransicao.includes(s))).toEqual([]);
    expect(comAnimacao.filter((s) => !semAnimacao.includes(s))).toEqual([]);
  });

  it('pointer: coarse leva o link do indice, o campo de busca, o seletor de capitulo, os chips do simulador e o resumo do FAQ a 44', () => {
    const coarse = manual.filter((r) => r.atRule === '@media (pointer: coarse)');
    const alvos44 = coarse.filter((r) => /min-height:\s*44px/.test(r.corpo)).flatMap((r) => r.seletores);
    for (const s of ['.manual-indice__link', '.manual-busca__input', '.manual-indice-select__campo', '.manual-sim__chip', '.manual-faq__resumo']) expect(alvos44, s).toContain(s);
  });

  it('capitulos 11 a 13 (M4): chips do simulador com estado ligado na cor de acao, foco da Suite e series por token; Qualidade usa --rf-score-outros (sem token novo)', () => {
    expect(declaracoes('.manual-sim__chip[aria-pressed="true"]')).toMatchObject({ background: 'var(--rf-action)', color: 'var(--rf-on-action)', 'font-weight': '700' });
    expect(declaracoes('.manual-sim__chip')).toMatchObject({ background: 'var(--rf-surface-alt)', color: 'var(--rf-ink-soft)' });
    const foco = declaracoes('.manual-sim__chip:focus-visible');
    expect(foco.outline).toBe('2px solid transparent');
    expect(foco['box-shadow']).toMatch(/var\(--rf-action\)/);
    expect(declaracoes('.manual-sim__seg--preco')).toEqual({ fill: 'var(--rf-primary)' });
    expect(declaracoes('.manual-sim__seg--pagamento')).toEqual({ fill: 'var(--rf-tone-info-solid)' });
    expect(declaracoes('.manual-sim__seg--incoterm')).toEqual({ fill: 'var(--rf-tone-warning-solid)' });
    expect(declaracoes('.manual-sim__seg--qualidade')).toEqual({ fill: 'var(--rf-score-outros)' });
    expect(declaracoes('.manual-sim__amostra--qualidade')).toEqual({ background: 'var(--rf-score-outros)' });
    expect(Object.keys(THEMES.claro).filter((t) => /manual|serie/.test(t))).toEqual([]);
    expect(declaracoes('.manual-sim > .manual-sim__msg')).toMatchObject({ color: 'var(--rf-tone-warning-fg)', 'min-height': '16px' });
    expect(declaracoes('.manual-sim__ranking > .manual-sim__linha')).toMatchObject({ display: 'grid', 'grid-template-columns': '26px minmax(110px, 190px) minmax(0, 1fr) 52px' });
    expect(declaracoes('.manual-sim__trilho')).toMatchObject({ height: '18px', background: 'var(--rf-surface-alt)', border: '1px solid var(--rf-border)' });
    expect(declaracoes('.manual-wf__linha')).toMatchObject({ display: 'grid', 'grid-template-columns': 'minmax(120px, 170px) minmax(0, 1fr) 104px' });
    expect(declaracoes('.manual-wf__barra')).toMatchObject({ fill: 'var(--rf-tone-info-solid)' });
    expect(declaracoes('.manual-wf__barra--total')).toMatchObject({ fill: 'var(--rf-action)' });
    expect(declaracoes('.manual-wf__marca-gatilho')).toMatchObject({ stroke: 'var(--rf-danger)', 'stroke-dasharray': '4 3' });
  });

  it('o rotulo do gatilho do waterfall acaba na linha tracejada: right em CSS = 100% menos a posicao calculada em waterfall.ts', () => {
    const { gatilhoPct } = calcularWaterfall();
    expect(declaracoes('.manual-wf__gatilho').right).toBe(`${(100 - gatilhoPct).toFixed(1)}%`);
    expect(declaracoes('.manual-wf__gatilho')).toMatchObject({ position: 'absolute', color: 'var(--rf-danger)' });
  });

  it('1023 (tela): linhas do simulador e do waterfall levam o trilho para a 2a linha, o eixo some e o rotulo do gatilho desce para nao cobrir o valor', () => {
    const m1023 = '@media screen and (max-width: 1023px)';
    expect(declaracoes('.manual-sim__eixo', m1023)).toMatchObject({ 'grid-template-columns': '20px minmax(0, 1fr) 46px', display: 'none' });
    expect(declaracoes('.manual-sim__linha > .manual-sim__trilho', m1023)).toEqual({ 'grid-column': '2 / 4', 'grid-row': '2' });
    expect(declaracoes('.manual-wf__linha', m1023)).toEqual({ 'grid-template-columns': 'minmax(0, 1fr) 96px' });
    expect(declaracoes('.manual-wf__linha > .manual-wf__trilho', m1023)).toEqual({ 'grid-column': '1 / 3', 'grid-row': '2' });
    expect(declaracoes('.manual-wf__gatilho', m1023)).toEqual({ top: '26px' });
  });

  it('movimento reduzido: chips e barras do simulador sem transicao', () => {
    const reduzido = manual.filter((r) => r.atRule === '@media (prefers-reduced-motion: reduce)' && /transition:\s*none/.test(r.corpo)).flatMap((r) => r.seletores);
    expect(reduzido).toEqual(expect.arrayContaining(['.manual-sim__chip', '.manual-sim__seg']));
    expect(declaracoes('.manual-sim__seg')).toHaveProperty('transition');
  });

  it('revisao r2: legenda da figura e texto corrido (selo na mesma linha), regua com largura minima (sem sobrepor rotulos no estreito) e corpo em 14px como a previa', () => {
    const legenda = declaracoes('.manual-figura__legenda');
    expect(legenda.display).toBeUndefined();
    expect(legenda['flex-wrap']).toBeUndefined();
    expect(declaracoes('.manual-regua')).toMatchObject({ 'min-width': '480px', position: 'relative' });
    expect(declaracoes('.manual-artigo')).toMatchObject({ 'font-size': '14px' });
    expect(declaracoes('.manual-capitulo__lead')).toMatchObject({ 'font-size': '15px' });
  });

  it('revisao r2: o campo de busca e o seletor de capitulo herdam transicao da Suite e a perdem no movimento reduzido', () => {
    const reduzido = manual.filter((r) => r.atRule === '@media (prefers-reduced-motion: reduce)' && /transition:\s*none/.test(r.corpo)).flatMap((r) => r.seletores);
    expect(reduzido).toEqual(expect.arrayContaining(['.manual-busca__input', '.manual-indice-select__campo']));
  });

  it('capitulos 14 a 17 (M5): FAQ em details com divisoria, icone plus/minus por [open], foco da Suite e glossario em grade de 2 colunas (1 no estreito)', () => {
    expect(declaracoes('.manual-faq')).toEqual({ padding: '4px 0', 'border-top': '1px solid var(--rf-divider)' });
    expect(declaracoes('.manual-faq__resumo')).toMatchObject({ display: 'flex', 'justify-content': 'space-between', 'list-style': 'none', cursor: 'pointer', color: 'var(--rf-ink)' });
    expect(declaracoes('.manual-faq__resumo::-webkit-details-marker')).toEqual({ display: 'none' });
    expect(declaracoes('.manual-faq[open] .manual-faq__mais')).toEqual({ display: 'none' });
    expect(declaracoes('.manual-faq:not([open]) .manual-faq__menos')).toEqual({ display: 'none' });
    const foco = declaracoes('.manual-faq__resumo:focus-visible');
    expect(foco.outline).toBe('2px solid transparent');
    expect(foco['box-shadow']).toMatch(/var\(--rf-action\)/);
    expect(declaracoes('.manual-faq__icone')).toMatchObject({ color: 'var(--rf-primary-700)' });
    expect(declaracoes('.manual-faq > .manual-faq__resposta')).toEqual({ 'max-width': '72ch', padding: '0 0 12px' });
    expect(declaracoes('.manual-glossario')).toMatchObject({ display: 'grid', 'grid-template-columns': 'minmax(120px, 170px) minmax(0, 1fr)', border: '1px solid var(--rf-border)', 'border-radius': 'var(--rf-radius-xs)' });
    expect(declaracoes('.manual-glossario__termo')).toMatchObject({ background: 'var(--rf-surface-alt)', color: 'var(--rf-ink)', 'font-weight': '800' });
    expect(declaracoes('.manual-glossario__def')).toMatchObject({ color: 'var(--rf-ink-soft)' });
    expect(declaracoes('.manual-glossario', '@media screen and (max-width: 1023px)')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(declaracoes('.manual-glossario__termo', '@media screen and (max-width: 1023px)')).toEqual({ 'padding-bottom': '2px', 'border-bottom': '0' });
    expect(declaracoes('.manual-rodape')).toMatchObject({ 'text-align': 'center', color: 'var(--rf-ink-soft)' });
    expect(declaracoes('.manual-variaveis')).toMatchObject({ display: 'flex', 'flex-wrap': 'wrap', gap: '8px' });
  });

  it('foco: link do indice e titulo do capitulo mostram o anel da Suite (outline transparente para forced-colors + sombra dupla)', () => {
    for (const s of ['.manual-indice__link:focus-visible', '.manual-capitulo__titulo:focus-visible']) {
      const d = declaracoes(s);
      expect(d.outline, s).toBe('2px solid transparent');
      expect(d['box-shadow'], s).toMatch(/var\(--rf-action\)/);
    }
  });

  it('toda classe `manual-*` usada nos TSX do Manual (className) tem regra no CSS', () => {
    const comRegra = (classe: string) => manual.some((r) => r.seletores.some((s) => classesDoSeletor(s).includes(classe)));
    const faltando: string[] = [];
    let achadas = 0;
    for (const [arquivo, fonte] of arquivos) {
      // className="..." / className={...} e os mapas de classe dos componentes e dos dados (`classe: '...'`)
      for (const m of fonte.matchAll(/(?:className=|classe:\s*)(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g)) {
        const valor = m[1] ?? m[2] ?? m[3] ?? '';
        for (const [classe] of valor.matchAll(/(?<![\w-])manual-[\w-]*[a-z0-9]/g)) {
          achadas++;
          if (!comRegra(classe)) faltando.push(`${arquivo}: .${classe}`);
        }
      }
    }
    expect(achadas).toBeGreaterThan(30);
    expect([...new Set(faltando)]).toEqual([]);
    expect(arquivos.some(([arquivo]) => arquivo.endsWith('Manual.tsx'))).toBe(true);
  });
});

// ---------- contraste (nos 2 temas; alfa composto sobre --rf-surface) ----------
const TEXT = 4.5;
const GLIFO = 3;
const rf = (n: string) => `--rf-${n}`;
type Par = readonly [fg: string, bg: string, min: number];
const par = (fg: string, bg: string, min: number = TEXT): Par => [fg, bg, min];
const PARES: ReadonlyArray<Par> = [
  par(rf('ink-soft'), rf('surface')), // corpo do capitulo, legendas, numeros do indice
  par(rf('ink-soft'), rf('surface-alt')), // pilula de botao, codigo, caixas de figura, cabecalho de tabela
  par(rf('ink-soft'), rf('bg')), // grupos do indice e status da busca sobre o fundo da pagina
  par(rf('ink-soft'), rf('tone-success-bg')),
  par(rf('ink-soft'), rf('tone-warning-bg')),
  par(rf('ink-soft'), rf('tone-info-bg')), // texto dos avisos
  par(rf('ink'), rf('surface')),
  par(rf('ink'), rf('surface-alt')), // termo do glossario
  par(rf('ink'), rf('tone-warning-bg')), // marca da busca
  par(rf('primary-700'), rf('primary-50')), // kicker, indice ativo, numero dos passos
  par(rf('primary-700'), rf('surface')), // links, kicker
  par(rf('tone-warning-fg'), rf('tone-warning-bg')), // "Exemplo ficticio", "ver"/"parcial", aviso de atencao
  par(rf('tone-warning-fg'), rf('surface')), // mensagem do simulador
  par(rf('on-action'), rf('action')), // chip ligado, selo Vencedora, total do waterfall
  par(rf('on-primary'), rf('primary')), // pilula primaria
  par(rf('danger'), rf('surface')), // linha do gatilho, regua vermelha
  par(rf('surface'), rf('tone-info-fg'), GLIFO), // glifo do icone do aviso info
  par(rf('surface'), rf('tone-warning-fg'), GLIFO), // glifo do icone do aviso de atencao
];

describe('M: contraste nos 2 temas', () => {
  const opaque = (theme: ThemeName, name: string): Rgb => opaqueOf(THEMES[theme], name);
  const rows = (['claro', 'escuro'] as const).flatMap((theme) =>
    PARES.map(([fg, bg, min]) => {
      const ratio = ratioOf(opaque(theme, fg), opaque(theme, bg));
      return { id: `${theme}: ${fg} / ${bg}`, min, ratio: Number(ratio.toFixed(2)), ok: ratio >= min };
    }),
  );

  it('mede os pares nos 2 temas', () => {
    expect(rows).toHaveLength(PARES.length * 2);
  });

  it('todos os pares passam (texto >= 4,5; glifo de icone >= 3)', () => {
    expect(rows.filter((r) => !r.ok).map((r) => `${r.id}: ${r.ratio} < ${r.min}`)).toEqual([]);
  });
});

// ---------- TSX do Manual ----------
describe('M: TSX do Manual sem estilo inline, token, cor literal, glifo, iframe, `.alert` nem SVG fora de `figuras/`', () => {
  it('ha fontes (Manual.tsx, capitulos.ts, componentes, capitulos)', () => {
    const nomes = arquivos.map(([a]) => a.replace('../pages/', ''));
    for (const esperado of ['Manual.tsx', 'Manual/capitulos.ts', 'Manual/busca.ts', 'Manual/componentes/Capitulo.tsx', 'Manual/capitulos/Envio.tsx']) expect(nomes, esperado).toContain(esperado);
  });

  it('nenhum style={, var(--rf-, cor literal, <iframe, className com alert nem glifo decorativo', () => {
    const ruins: string[] = [];
    for (const [arquivo, fonte] of arquivos) {
      fonte.split(/\r?\n/).forEach((linha, i) => {
        if (/style=\{|var\(--rf-|#[0-9a-fA-F]{3,8}\b|rgba?\(|<iframe|className="[^"]*\balert\b|[✓✕−★→☀☾◐]/.test(linha)) ruins.push(`${arquivo}:${i + 1}`);
      });
    }
    expect(ruins).toEqual([]);
  });

  it('<svg so em figuras/, sempre com role="img" + <title> ou aria-hidden', () => {
    for (const [arquivo, fonte] of arquivos) {
      const tags = [...fonte.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]);
      if (tags.length === 0) continue;
      expect(arquivo, 'svg fora de figuras/').toMatch(/\/pages\/Manual\/figuras\//);
      for (const tag of tags) {
        const decorativo = /aria-hidden/.test(tag);
        const rotulado = /role="img"/.test(tag) && /aria-labelledby=/.test(tag) && /<title\b/.test(fonte);
        expect(decorativo || rotulado, `${arquivo}: ${tag}`).toBe(true);
      }
    }
  });

  it('o Manual so usa icones do Icon (nenhum aria-hidden={false})', () => {
    for (const [arquivo, fonte] of arquivos) expect(fonte, arquivo).not.toMatch(/<Icon[^>]*aria-hidden=\{?false/);
  });

  it('ids de capitulo unicos e iguais aos da previa (as ancoras /manual#id)', () => {
    const ids = CAPITULOS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'comece-aqui',
      'perfis',
      'overview',
      'solicitacoes',
      'itens',
      'fornecedores',
      'forwarders',
      'criar-cotacao',
      'envio',
      'portal',
      'respostas',
      'comparacao',
      'ordem-de-compra',
      'relatorios',
      'administracao',
      'perguntas',
      'glossario',
    ]);
    expect([...new Set(CAPITULOS.map((c) => c.grupo))]).toEqual(['Comece aqui', 'Cadastros e pedidos', 'O ciclo da cotação', 'Acompanhamento', 'Administração', 'Referência']);
    expect(CAPITULOS.filter((c) => c.etapa).map((c) => [c.id, c.etapa])).toEqual([
      ['criar-cotacao', 1],
      ['envio', 2],
      ['portal', 3],
      ['respostas', 4],
      ['comparacao', 5],
      ['ordem-de-compra', 6],
    ]);
  });

  it('App.tsx: rota /manual e /ajuda redirecionando para /manual (as 2 rotas)', () => {
    expect(App.match(/path="\/manual" element=\{<Manual \/>\}/g)).toHaveLength(1);
    expect(App.match(/path="\/ajuda" element=\{<Navigate to="\/manual" replace \/>\}/g)).toHaveLength(1);
    expect(App).not.toContain("pages/Ajuda'");
  });
});
