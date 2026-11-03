/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { parseColor, over, parseRules, ratioOf, readSource, stripComments, tokensDosTemas, type Rgb } from './rfCss';

// F13-A (plano F13, 6.1): contraste AA do Forecast no claro e no escuro, status PO legivel e linhas criticas visiveis no escuro.
// So CSS, dentro do bloco do Forecast (do marcador `/* ---- Forecast (PR 1D-1) ---- */` ao fim do arquivo):
//  a1  escuro, celulas fixas da linha selecionada: tom --primary-50 (translucido) UMA vez, opaco (antes: 2x por `background: inherit`);
//  a2  `--ink-muted` (4,19:1) deixa de ser cor de texto no bloco: `.fc-cell--vazio`, `.fcr-fraco`, `.fcx-dica` -> `--ink-soft`;
//  a4  status PO em `--primary-700` (o `--primary` claro dava 1,76:1): `i.fc-status--po`, `td.fc-status--po`, `.fcad-decidida--po::before`;
//  a5  escuro: linhas criticas/vencidas (th) e Seguranca com o tom cheio, nao o soft que as apagava.
// A guarda le o proprio CSS (nada de valor copiado do harness) e calcula o contraste WCAG 2.x dos tokens.

const MARCADOR = '/* ---- Forecast (PR 1D-1) ---- */';
const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const iBloco = css.indexOf(MARCADOR);
const bloco = stripComments(css.slice(iBloco));
const regras = parseRules(bloco);
const { claro, escuro } = tokensDosTemas(css);
const temas = { claro, escuro: { ...claro, ...escuro } } as const;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
// Seletores de topo de uma lista (virgula so fora de parenteses/colchetes: `:is(a, b)` e um seletor so).
function seletoresDe(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let atual = '';
  for (const ch of prelude) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(norm(atual));
      atual = '';
    } else atual += ch;
  }
  out.push(norm(atual));
  return out;
}
const declaracoes = (selector: string) =>
  regras.filter((r) => seletoresDe(r.prelude).includes(selector)).map((r) => norm(r.body));
const valor = (selector: string, propriedade: string): string[] =>
  declaracoes(selector).flatMap((corpo) => {
    const m = new RegExp(`(?:^|;)\\s*${propriedade}\\s*:\\s*([^;]+)`).exec(corpo);
    return m?.[1] ? [norm(m[1])] : [];
  });

// Cor opaca do token: alfa composto sobre o --surface do tema.
function rgb(tokens: Record<string, string>, nome: string): Rgb {
  const surface = tokens['--surface'];
  const v = tokens[nome];
  if (surface === undefined || v === undefined) throw new Error(`token indefinido: ${nome}`);
  const [sr, sg, sb] = parseColor(surface);
  return over(parseColor(v), [sr, sg, sb]);
}
const razao = (tokens: Record<string, string>, fg: string, bg: string) => ratioOf(rgb(tokens, fg), rgb(tokens, bg));

describe('F13-A: regras do bloco do Forecast', () => {
  it('o bloco comeca no marcador e as regras existem', () => {
    expect(iBloco).toBeGreaterThan(0);
    expect(css.split(MARCADOR)).toHaveLength(2);
    expect(regras.length).toBeGreaterThan(100);
  });

  it('a1: escuro, celula fixa da linha selecionada com o tom UMA vez e opaco; as demais seguem em `inherit`', () => {
    expect(valor(':root[data-theme="dark"] .fc-grid .fc-row--selecionada .fc-fixa', 'background')).toEqual([
      'linear-gradient(var(--primary-50), var(--primary-50)), var(--surface)',
    ]);
    expect(valor('.fc-grid .fc-fixa', 'background')).toEqual(['inherit']);
    expect(valor('.fc-grid .fc-row.fc-row--selecionada', 'background')).toEqual(['var(--primary-50)']);
  });

  it('a2: `.fc-cell--vazio`, `.fcr-fraco` e `.fcx-dica` em --ink-soft; --ink-muted nao e cor de texto em nenhuma regra do bloco', () => {
    expect(valor('.fc-grid .fc-cell--vazio', 'color')).toEqual(['var(--ink-soft)']);
    expect(valor('.fcr-fraco', 'color')).toEqual(['var(--ink-soft)']);
    expect(valor('.fcx-dica', 'color')).toEqual(['var(--ink-soft)']);
    expect(bloco).not.toMatch(/(^|[;{\s])color\s*:\s*var\(--ink-muted\)/);
    expect(bloco).not.toContain('--ink-muted');
  });

  it('a4: status PO em --primary-700 (bolinha, faixa de 4 px e bolinha da Qtd. decidida)', () => {
    expect(valor('i.fc-status--po', 'background')).toEqual(['var(--primary-700)']);
    expect(valor('.fc-grid td.fc-status--po', 'box-shadow')).toEqual(['inset 4px 0 0 var(--primary-700)']);
    expect(valor('.fcad-decidida--po::before', 'background')).toEqual(['var(--primary-700)']);
    expect(bloco).not.toMatch(/fc-status--po[^{]*\{[^}]*var\(--primary\)/);
    expect(bloco).not.toMatch(/fcad-decidida--po[^{]*\{[^}]*var\(--primary\)/);
  });

  it('a6: so em tela, o scroller da grade e o bloco de contencao do .sr-only das celulas (a pagina nao rola na horizontal)', () => {
    const emTela = regras.filter((r) => norm(r.prelude) === '@media screen').flatMap((r) => parseRules(r.body));
    expect(emTela.filter((r) => seletoresDe(r.prelude).includes('.fc-scroll')).map((r) => norm(r.body))).toEqual(['position: relative;']);
    // so em tela: o papel (A4) nao muda
    expect(valor('.fc-scroll', 'position')).toEqual([]);
  });

  it('a5: so no escuro, linhas criticas/vencidas (th) e Seguranca com o tom cheio; o claro nao muda', () => {
    expect(valor(':root[data-theme="dark"] :is(.fcr-linha--vencida, .fcr-linha--critico) th', 'background')).toEqual([
      'var(--tone-danger-bg)',
    ]);
    expect(valor(':root[data-theme="dark"] .fc-grid .fc-cell--seg:not(.fc-cell--diverge)', 'background')).toEqual([
      'var(--tone-warning-bg)',
    ]);
    // claro (e base do escuro) intactos
    expect(valor('.fc-grid .fc-cell--seg', 'background')).toEqual(['var(--tone-warning-bg-soft)']);
    expect(valor('.fcr-linha--critico th', 'background')).toEqual(['var(--tone-danger-bg-soft)']);
    expect(valor('.fcr-linha--vencida th', 'background')).toEqual(['var(--tone-danger-bg-soft)']);
    // a divergencia da Seguranca nao perde o proprio tom
    expect(valor('.fc-grid .fc-cell--diverge', 'background')).toEqual(['var(--tone-danger-bg-soft)']);
  });

  it('o bloco nao usa var(--rf-*), nem !important fora do @media print herdado, nem cor literal (so tokens legados)', () => {
    expect(bloco).not.toContain('var(--rf-');
    // !important so existe em `@media print` (esconder controles no papel), herdado; nenhuma regra de tela o usa.
    const deTela = regras.filter((r) => !r.prelude.startsWith('@media print'));
    expect(deTela.filter((r) => r.body.includes('!important')).map((r) => norm(r.prelude))).toEqual([]);
    expect(bloco).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});

describe('F13-A: contraste WCAG 2.x calculado a partir dos tokens do proprio CSS', () => {
  for (const [nome, tokens] of Object.entries(temas)) {
    it(`${nome}: --ink-soft >= 4,5 sobre --surface, --surface-alt, --primary-50 (1x), tons de aviso e de perigo (cheio e soft)`, () => {
      const fundos = [
        '--surface',
        '--surface-alt',
        '--primary-50',
        '--tone-warning-bg',
        '--tone-warning-bg-soft',
        '--tone-danger-bg',
        '--tone-danger-bg-soft',
      ];
      const baixos = fundos
        .map((bg) => [bg, razao(tokens, '--ink-soft', bg)] as const)
        .filter(([, r]) => r < 4.5)
        .map(([bg, r]) => `--ink-soft sobre ${bg} = ${r.toFixed(2)}`);
      expect(baixos).toEqual([]);
    });

    it(`${nome}: --ink e --danger >= 4,5 sobre --tone-danger-bg (linha critica)`, () => {
      expect(razao(tokens, '--ink', '--tone-danger-bg')).toBeGreaterThanOrEqual(4.5);
      expect(razao(tokens, '--danger', '--tone-danger-bg')).toBeGreaterThanOrEqual(4.5);
    });

    it(`${nome}: --primary-700 (status PO) >= 3 sobre --surface (componente grafico) e = --rf-fc-status-po`, () => {
      expect(razao(tokens, '--primary-700', '--surface')).toBeGreaterThanOrEqual(3);
      expect(tokens['--primary-700']).toBe(tokens['--rf-fc-status-po']);
    });
  }

  it('escuro: o tom cheio e visivelmente mais forte que o soft sobre --surface (a linha critica nao some)', () => {
    const t = temas.escuro;
    const cheio = razao(t, '--tone-danger-bg', '--surface');
    const soft = razao(t, '--tone-danger-bg-soft', '--surface');
    expect(cheio).toBeGreaterThan(soft);
    const avisoCheio = razao(t, '--tone-warning-bg', '--surface');
    const avisoSoft = razao(t, '--tone-warning-bg-soft', '--surface');
    expect(avisoCheio).toBeGreaterThan(avisoSoft);
  });
});
