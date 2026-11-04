/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// FZ3 (pos-release do Forecast): rodape (faixa Cancelar/Confirmar/Fechar) dos modais de apoio Importar, Excluir quinzena, Grupos, Eventos e Fontes. O jsdom nao faz layout, entao o que a prova em
// Chromium mediu fica travado aqui no CSS:
//  - a faixa gruda no FUNDO do scroller (`bottom: 0`): com `bottom: 20px` o corpo aparecia numa faixa de 20 px ABAIXO da barra;
//  - a barra e compacta (`padding: 12px 24px` COMPLETO -> 12 + 44 + 12 + 1 = 69 px) e o botao segue com 44 px de alvo de toque;
//  - o scroll-padding-bottom do scroller reserva a altura REAL da barra + o anel de foco (outline 2 + offset 2): 73 .. 77 (76);
//  - o scroller (`.modal-content`) e o bloco de contencao dos filhos absolutos (`position: relative`): os <caption class="sr-only"> das tabelas sem .table-wrapper escapavam dele;
//  - NENHUM scroller novo: nem a faixa nem o `.modal-content:has(...)` declaram overflow, e a faixa segue `position: sticky; z-index: 1`.
// Embalagens (faixa propria da FZ1, 77 px) fica de fora. Mutantes por modal: tirar o seletor do modal da regra da faixa ou do scroller derruba um teste cada.

const css = readFileSync(resolve(import.meta.dirname, '../../styles/globals.css'), 'utf8').replace(/\r\n/g, '\n');
const ABRE = '/* -- FZ3 >>> -- */';
const FECHA = '/* -- <<< FZ3 -- */';
const bloco = css.slice(css.indexOf(ABRE) + ABRE.length, css.indexOf(FECHA));
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');

const BOTAO_ALVO_PX = 44;
const BORDA_PX = 1; // border-top da faixa (`1px solid var(--rf-divider)`)
const ANEL_PX = 4; // outline 2 + offset 2 (anel de foco)
const ALTURA_PX = 12 + BOTAO_ALVO_PX + 12 + BORDA_PX; // 69
const RESERVA_GRUPOS_FORM_PX = 120; // unica excecao ao 73..77 (ver o teste dos scrollers)

// Faixa de cada modal (mesma lista da faixa compartilhada `position: sticky`).
const RODAPES: Record<string, string> = {
  importar: '.fc-pagina .fci-modal > .modal-actions:last-child',
  excluir: '.fc-pagina .fcx-excluir > form > .modal-actions:last-child',
  'grupos-div': '.fc-pagina div.fcg-form > .modal-actions:last-child',
  'grupos-form': '.fc-pagina .fcg-form:not(.fcg-confirmar) > .modal-actions:last-child',
  'grupos-lista': '.fc-pagina .fcg-dialogo .modal-body > .modal-actions:last-child',
  'eventos-fontes': '.fc-pagina .fco-abas > .modal-actions:last-child',
  'eventos-form': '.fc-pagina .fco-form > .modal-actions:last-child',
};
const SCROLLERS: Record<string, string> = {
  importar: '.fc-pagina .modal-content:has(.fci-modal)',
  excluir: '.fc-pagina .modal-content:has(.fcx-excluir)',
  grupos: '.fc-pagina .modal-content:has(.fcg-form)',
  'grupos-lista': '.fc-pagina .modal-content:has(.fcg-lista-corpo)',
  'eventos-fontes': '.fc-pagina .modal-content:has(.fco-abas)',
};

interface Regra {
  seletores: string[];
  decl: Record<string, string>;
}

/** Regras (lista de seletores + declaracoes) de um trecho de CSS; um `@media` externo e desembrulhado. */
function regras(texto: string): Regra[] {
  const limpo = semComentarios(texto);
  const out: Regra[] = [];
  for (const m of limpo.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl: Record<string, string> = {};
    for (const d of (m[2] ?? '').split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim().replace(/\s+/g, ' ');
    }
    // o prelude pode vir colado ao `@media ... {` desembrulhado: fica so o que vem depois da ultima "{"/";"/"}"
    const prelude = (m[1] ?? '').replace(/^[\s\S]*@media[^{]*$/, '').trim();
    out.push({ seletores: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decl });
  }
  return out;
}

const regrasFz3 = regras(bloco.replace(/@media screen\s*\{/, '')).filter((r) => r.seletores.some((s) => s !== ''));
const regraDe = (seletor: string): Regra | undefined => regrasFz3.find((r) => r.seletores.includes(seletor));

/** Padding shorthand (1 a 4 valores) -> [topo, direita, baixo, esquerda] em px. */
function paddingDe(valor: string | undefined): [number, number, number, number] {
  const v = (valor ?? '').trim().split(/\s+/).map((x) => Number(/^(-?\d+(?:\.\d+)?)(?:px)?$/.exec(x)?.[1] ?? NaN));
  const [a = NaN, b = NaN, c = NaN, d = NaN] = v;
  if (v.length === 1) return [a, a, a, a];
  if (v.length === 2) return [a, b, a, b];
  if (v.length === 3) return [a, b, c, b];
  return [a, b, c, d];
}
const px = (v: string | undefined) => Number(/^(-?\d+(?:\.\d+)?)(?:px)?$/.exec((v ?? '').trim())?.[1] ?? NaN);

/** Altura REAL da barra a partir do padding declarado (topo + baixo), botao de 44 e borda de 1. */
function alturaDaBarra(seletor: string): number {
  const [topo, , baixo] = paddingDe(regraDe(seletor)?.decl['padding']);
  return topo + baixo + BOTAO_ALVO_PX + BORDA_PX;
}

describe('FZ3: a faixa dos modais de apoio nao deixa o corpo aparecer abaixo da barra', () => {
  it('o par de sentinelas FZ3 existe 1 vez, DENTRO do par F13-E, depois da faixa compartilhada e das regras proprias de cada faixa (ganha a cascata)', () => {
    expect(css.split(ABRE)).toHaveLength(2);
    expect(css.split(FECHA)).toHaveLength(2);
    const [e0, e1] = [css.indexOf('/* -- F13-E >>> -- */'), css.indexOf('/* -- <<< F13-E -- */')];
    expect(css.indexOf(ABRE)).toBeGreaterThan(e0);
    expect(css.indexOf(FECHA)).toBeLessThan(e1);
    expect(css.indexOf(ABRE)).toBeLessThan(css.indexOf(FECHA));
    const compartilhada = css.indexOf('.fc-pagina .fci-modal > .modal-actions:last-child,');
    expect(compartilhada).toBeGreaterThan(e0);
    expect(css.indexOf(ABRE)).toBeGreaterThan(compartilhada);
    expect(css.indexOf(ABRE)).toBeGreaterThan(css.indexOf('.fc-pagina .modal-content:has(.fci-modal),'));
    // as regras proprias de cada faixa (margem/padding de 16) vem ANTES do bloco FZ3, que as sobrescreve
    for (const [chave, sel] of Object.entries(RODAPES)) expect(css.lastIndexOf(sel, css.indexOf(ABRE)), chave).toBeGreaterThan(-1);
    expect(css.lastIndexOf('.fc-pagina .fci-modal > .modal-actions:last-child {', css.indexOf(ABRE))).toBeLessThan(css.indexOf(ABRE));
  });

  it.each(Object.entries(RODAPES))('faixa %s: `bottom: 0` (sem a faixa de 20 px abaixo da barra) e `padding: 12px 24px` COMPLETO, so essas 2 propriedades', (_chave, seletor) => {
    const r = regraDe(seletor);
    expect(r, seletor).toBeDefined();
    expect(r?.decl['bottom']).toMatch(/^0(px)?$/);
    expect(r?.decl['padding']).toBe('12px 24px');
    expect(Object.keys(r?.decl ?? {}).sort()).toEqual(['bottom', 'padding']);
  });

  it('todas as faixas partilham UMA regra do FZ3 (a mesma lista de seletores da faixa compartilhada `position: sticky; bottom: 20px; z-index: 1`, que segue intacta)', () => {
    const lista = Object.values(RODAPES);
    const r = regrasFz3.find((x) => x.seletores.includes(lista[0] ?? ''));
    expect([...(r?.seletores ?? [])].sort()).toEqual([...lista].sort());
    const compartilhada = regras(css).filter((x) => lista.every((s) => x.seletores.includes(s)) && x.decl['position'] === 'sticky');
    expect(compartilhada).toHaveLength(1);
    expect(compartilhada[0]?.decl['z-index']).toBe('1');
    expect(compartilhada[0]?.decl['bottom']).toBe('20px'); // premissa: e este valor que o FZ3 sobrescreve
  });

  it('a barra e compacta de verdade: altura calculada com padding-top + padding-bottom REAIS = 69 px, respiro lateral de 24 e o botao mantem o alvo de toque de 44 px', () => {
    for (const [chave, sel] of Object.entries(RODAPES)) {
      expect(alturaDaBarra(sel), chave).toBe(ALTURA_PX);
      const [, direita, , esquerda] = paddingDe(regraDe(sel)?.decl['padding']);
      expect([direita, esquerda], `${chave}: respiro lateral`).toEqual([24, 24]);
    }
    // o botao de 44 vem do .primary-button/.ghost-button globais e nenhuma regra do FZ3 o reduz
    expect(css).toMatch(/\.primary-button,\s*\.ghost-button,\s*\.danger-button \{[^{}]*min-height: 44px;/);
    expect(semComentarios(bloco)).not.toMatch(/min-height|height\s*:/);
  });

  it.each(Object.entries(SCROLLERS))('scroller %s: reserva a altura REAL da barra + o anel de foco (scroll-padding-bottom entre 73 e 77, hoje 76; so o formulario de Grupos usa 120) e contem o .sr-only (`position: relative`)', (_chave, seletor) => {
    const r = regraDe(seletor);
    expect(r, seletor).toBeDefined();
    const reserva = px(r?.decl['scroll-padding-bottom']);
    expect(Number.isFinite(reserva)).toBe(true);
    if (_chave === 'grupos') {
      // formulario de Grupos: o textarea do motivo (60 px) so tem o cursor revelado pelo Chromium; 76 deixava a base do campo sob a barra (-7,5 a -22,5 px): 120 so aqui
      expect(reserva).toBe(RESERVA_GRUPOS_FORM_PX);
    } else {
      expect(reserva).toBeGreaterThanOrEqual(ALTURA_PX + ANEL_PX);
      expect(reserva).toBeLessThanOrEqual(ALTURA_PX + ANEL_PX + 4);
    }
    expect(r?.decl['position']).toBe('relative');
    expect(Object.keys(r?.decl ?? {}).sort()).toEqual(['position', 'scroll-padding-bottom']);
  });

  it('sem scroller novo: nenhuma regra de faixa ou de `.modal-content:has(...)` do Forecast declara overflow, `z-index` so 1, e o scroller de sempre (.modal-content, overflow-y: auto) e a premissa', () => {
    const faixas = Object.values(RODAPES);
    const scrollers = Object.values(SCROLLERS);
    let vistas = 0;
    for (const r of regras(css)) {
      if (!r.seletores.some((s) => faixas.includes(s) || scrollers.includes(s))) continue;
      vistas++;
      for (const prop of Object.keys(r.decl)) expect(prop, r.seletores.join(' | ')).not.toMatch(/^overflow/);
      if (r.decl['z-index'] !== undefined) expect(r.decl['z-index'], r.seletores.join(' | ')).toBe('1');
    }
    expect(vistas).toBeGreaterThanOrEqual(4);
    expect(css).toMatch(/^\.modal-content \{[^{}]*overflow-y: auto;/m);
    expect(css).toMatch(/^\.sr-only \{\s*position: absolute;/m);
  });

  it('nada depois do bloco FZ3 sobrescreve bottom/padding/position/scroll-padding das faixas e dos scrollers do molde (mutantes N1/N2: override tardio)', () => {
    const faixas = Object.values(RODAPES);
    const scrollers = Object.values(SCROLLERS);
    const depois = css.slice(css.indexOf(FECHA) + FECHA.length);
    let vistas = 0;
    for (const r of regras(depois)) {
      if (!r.seletores.some((x) => faixas.includes(x) || scrollers.includes(x))) continue;
      vistas++;
      for (const prop of Object.keys(r.decl)) expect(prop, r.seletores.join(' | ')).not.toMatch(/^(bottom|padding(-.*)?|position|scroll-padding(-.*)?)$/);
    }
    expect(vistas).toBeGreaterThanOrEqual(0);
  });

  it('o bloco e so de tela, sem !important nem cor literal', () => {
    expect(semComentarios(bloco).trim().startsWith('@media screen {')).toBe(true);
    expect(semComentarios(bloco)).not.toContain('!important');
    expect(semComentarios(bloco)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});
