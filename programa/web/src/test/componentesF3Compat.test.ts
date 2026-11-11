/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import {
  classesDoSeletor,
  over,
  parseColor,
  parseRules,
  ratioOf,
  readSource,
  regioes,
  temasDeTokens,
  tokensDosTemas,
  ultimoComposto,
  type CssRule,
  type Rgb,
  type ThemeName,
} from './rfCss';

// F3-compat Forecast (Suite COMEX): CSS TEMPORARIO, so na regiao `compat Forecast F3` do globals.css. A F3a deixou os .ghost-button das
// tabelas do Forecast sem contorno, com 36 px de altura e rotulo centralizado, e o .badge--danger some sobre a linha tingida. Esta regiao
// restaura contorno, alinhamento e altura SO nas tabelas do Forecast que tem .ghost-button e da um anel ao selo vencido.
// A F13 (redesenho do Forecast) remove a regiao e este arquivo. Nenhum .tsx muda; nenhuma outra tela muda (prova estatica abaixo).

const NOME = 'compat Forecast F3';
const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regs = regioes(css);
const regiao = regs.find((r) => r.nome === NOME);
const regraF3a = regs.find((r) => r.nome === 'componentes F3a');
const regras: CssRule[] = regiao?.regras ?? [];
const limpo = regiao?.limpo ?? '';

// Conjunto S: classes de <table> do Forecast que contem .ghost-button (conferido nos .tsx por um teste abaixo).
const S_CLASSES = ['fcr-tabela', 'fcp-tabela', 'fco-tabela'] as const;
const S = `:is(${S_CLASSES.map((c) => `.${c}`).join(', ')})`;
// Tabelas do Forecast SEM .ghost-button (nada a restaurar; ficam como estao).
const SEM_BOTAO = ['fc-grid', 'fce-tabela', 'fca-tabela', 'fci-prazo__tabela', 'fco-tabela-ano'];

const PERMITIDAS_COMPAT = new Set([
  ...S_CLASSES,
  'ghost-button',
  'ghost-button--sm',
  'danger-button',
  'row-actions',
  'fcd-acoes',
  'fcr-linha--vencida',
  'fcr-linha--sem-estoque',
  'fcr-linha--critico',
  'badge--danger',
  'fcr-embalagem__editar',
  'fco-acoes',
  'fco-grupo-alvos',
]);

// ---------- leitura das regras ----------
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
    } else {
      atual += ch;
    }
  }
  if (atual.trim()) out.push(atual.replace(/\s+/g, ' ').trim());
  return out;
}

function declaracoes(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const parte of body.split(';')) {
    const i = parte.indexOf(':');
    if (i < 0) continue;
    const nome = parte.slice(0, i).trim();
    if (nome) out[nome] = parte.slice(i + 1).replace(/\s+/g, ' ').trim();
  }
  return out;
}

interface Achatada {
  seletor: string;
  decls: Record<string, string>;
  media: string | null;
}

function achatar(rules: CssRule[], media: string | null = null): Achatada[] {
  const out: Achatada[] = [];
  for (const r of rules) {
    if (r.prelude.startsWith('@media')) out.push(...achatar(parseRules(r.body), r.prelude));
    else if (!r.prelude.startsWith('@')) {
      for (const seletor of listaDeSeletores(r.prelude)) out.push({ seletor, decls: declaracoes(r.body), media });
    }
  }
  return out;
}

const achatadas = achatar(regras);
const achatadasF3a = achatar(regraF3a?.regras ?? []);

function de(seletor: string, media: string | null = null): Record<string, string> {
  const hit = achatadas.filter((a) => a.seletor === seletor && a.media === media);
  if (hit.length === 0) throw new Error(`seletor ausente na regiao compat: ${seletor}`);
  return Object.assign({}, ...hit.map((h) => h.decls)) as Record<string, string>;
}

// ---------- especificidade (a,b,c): :is()/:not() = argumento mais especifico; :where() = 0 ----------
type Spec = [number, number, number];
const maior = (x: Spec, y: Spec): Spec => (x[0] !== y[0] ? (x[0] > y[0] ? x : y) : x[1] !== y[1] ? (x[1] > y[1] ? x : y) : x[2] >= y[2] ? x : y);

function argumentos(texto: string, inicio: number): { args: string[]; fim: number } {
  let depth = 1;
  let i = inicio;
  let atual = '';
  const args: string[] = [];
  for (; i < texto.length && depth > 0; i++) {
    const ch = texto.charAt(i);
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0) break;
    if (ch === ',' && depth === 1) {
      args.push(atual.trim());
      atual = '';
    } else atual += ch;
  }
  if (atual.trim()) args.push(atual.trim());
  return { args, fim: i + 1 };
}

function especificidade(seletor: string): Spec {
  const s = seletor.replace(/"[^"]*"|'[^']*'/g, '""');
  const total: Spec = [0, 0, 0];
  let i = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    if (ch === '#') {
      total[0] += 1;
      i += 1 + /^[\w-]+/.exec(s.slice(i + 1))![0].length;
    } else if (ch === '.') {
      total[1] += 1;
      i += 1 + (/^[\w-]+/.exec(s.slice(i + 1))?.[0].length ?? 0);
    } else if (ch === '[') {
      total[1] += 1;
      i = s.indexOf(']', i) + 1;
    } else if (ch === ':') {
      if (s.charAt(i + 1) === ':') {
        total[2] += 1;
        i += 2 + (/^[\w-]+/.exec(s.slice(i + 2))?.[0].length ?? 0);
        continue;
      }
      const nome = /^:([\w-]+)/.exec(s.slice(i))![1]!;
      i += 1 + nome.length;
      if (s.charAt(i) === '(') {
        const { args, fim } = argumentos(s, i + 1);
        if (nome === 'is' || nome === 'not' || nome === 'has') {
          const m = args.map(especificidade).reduce(maior, [0, 0, 0] as Spec);
          total[0] += m[0];
          total[1] += m[1];
          total[2] += m[2];
        } else if (nome !== 'where') total[1] += 1;
        i = fim;
      } else total[1] += 1;
    } else if (/[A-Za-z]/.test(ch)) {
      total[2] += 1;
      i += /^[\w-]+/.exec(s.slice(i))![0].length;
    } else i += 1;
  }
  return total;
}

const cmp = (x: Spec, y: Spec) => (x[0] - y[0] !== 0 ? x[0] - y[0] : x[1] - y[1] !== 0 ? x[1] - y[1] : x[2] - y[2]);

describe('F3 compat: a funcao de especificidade (apoio do teste)', () => {
  it('conta ids, classes/pseudo-classes e elementos; :is() e :not() usam o argumento mais especifico', () => {
    expect(especificidade('.a')).toEqual([0, 1, 0]);
    expect(especificidade(':is(table, .row-actions) .ghost-button')).toEqual([0, 2, 0]);
    expect(especificidade(':is(.fcr-tabela, .fcp-tabela) .ghost-button:hover:not(:disabled)')).toEqual([0, 4, 0]);
    expect(especificidade('.ghost-button.danger-button')).toEqual([0, 2, 0]);
    expect(especificidade('#x .a::before')).toEqual([1, 1, 1]);
    expect(especificidade(':where(.a, #b) .c')).toEqual([0, 1, 0]);
  });
});

// ---------- tokens e contraste ----------
const { claro, escuro } = tokensDosTemas(css);
const TEMAS = temasDeTokens(claro, escuro);
const rgbDoToken = (tema: ThemeName, nome: string, sobre: Rgb): Rgb => over(parseColor(TEMAS[tema][nome] ?? ''), sobre);
const TEXT = 4.5;
const UI = 3;

describe('F3 compat: contraste nos 2 temas (tokens compostos sobre a linha tingida --tone-danger-bg-soft, token antigo)', () => {
  for (const tema of ['claro', 'escuro'] as const) {
    it(`${tema}: anel do selo, texto do selo, contorno e texto do botao`, () => {
      const t = TEMAS[tema];
      expect(t['--tone-danger-bg-soft'], 'a linha tingida do Forecast').toBeDefined();
      // TROCA-2 (R4): no escuro o --tone-danger-bg-soft e translucido; compoe sobre o --rf-surface do tema (no claro e o mesmo branco).
      const superficie = rgbDoToken(tema, '--rf-surface', [255, 255, 255]);
      const linha = rgbDoToken(tema, '--tone-danger-bg-soft', superficie);
      const fundoSelo = rgbDoToken(tema, '--rf-tone-danger-bg', linha);
      const medidos: Array<[nome: string, razao: number, minimo: number]> = [
        ['anel --rf-danger x linha', ratioOf(rgbDoToken(tema, '--rf-danger', linha), linha), UI],
        ['anel --rf-danger x fundo do selo', ratioOf(rgbDoToken(tema, '--rf-danger', fundoSelo), fundoSelo), UI],
        ['texto do selo x selo', ratioOf(rgbDoToken(tema, '--rf-tone-danger-fg', fundoSelo), fundoSelo), TEXT],
        ['texto e contorno --rf-action x linha', ratioOf(rgbDoToken(tema, '--rf-action', linha), linha), TEXT],
        ['--rf-action x --rf-surface', ratioOf(rgbDoToken(tema, '--rf-action', superficie), superficie), TEXT],
        ['hover: --rf-action x --rf-action-hover-bg', ratioOf(rgbDoToken(tema, '--rf-action', superficie), rgbDoToken(tema, '--rf-action-hover-bg', superficie)), TEXT],
        ['pressionado: --rf-action-pressed x --rf-action-pressed-bg', ratioOf(rgbDoToken(tema, '--rf-action-pressed', superficie), rgbDoToken(tema, '--rf-action-pressed-bg', superficie)), TEXT],
        ['destrutivo: --rf-tone-danger-fg x linha', ratioOf(rgbDoToken(tema, '--rf-tone-danger-fg', linha), linha), TEXT],
        ['destrutivo: contorno --rf-danger x linha', ratioOf(rgbDoToken(tema, '--rf-danger', linha), linha), UI],
        ['destrutivo hover: --rf-tone-danger-fg x --rf-tone-danger-bg', ratioOf(rgbDoToken(tema, '--rf-tone-danger-fg', superficie), rgbDoToken(tema, '--rf-tone-danger-bg', superficie)), TEXT],
      ];
      const baixos = medidos.filter(([, r, min]) => r < min).map(([n, r, min]) => `${n} = ${r.toFixed(2)} (< ${min})`);
      expect(baixos).toEqual([]);
    });
  }
});

// ---------- invariantes da regiao ----------
describe('F3 compat: regiao `compat Forecast F3`', () => {
  it('existe uma vez, depois da F3d e antes do bloco do Forecast, e nao declara --rf-*', () => {
    expect(css.split(`/* >>> ${NOME} (Suite COMEX) >>> */`)).toHaveLength(2);
    expect(css.split(`/* <<< ${NOME} <<< */`)).toHaveLength(2);
    expect(regiao).toBeDefined();
    const iF3d = css.indexOf('/* <<< componentes F3d <<< */');
    const iIni = css.indexOf(`/* >>> ${NOME} (Suite COMEX) >>> */`);
    const iFim = css.indexOf(`/* <<< ${NOME} <<< */`);
    const iForecast = css.indexOf('/* ---- Forecast (PR 1D-1) ---- */');
    expect(iF3d).toBeGreaterThan(-1);
    expect(iForecast).toBeGreaterThan(-1);
    expect(css.slice(iF3d + '/* <<< componentes F3d <<< */'.length, iIni).trim(), 'so espaco entre a F3d e a compat').toBe('');
    expect(iFim).toBeGreaterThan(iIni);
    expect(iFim).toBeLessThan(iForecast);
    expect(limpo).not.toMatch(/(^|[;{\s])--rf-[\w-]+\s*:/);
    expect(limpo).toContain('var(--rf-');
    expect(css.indexOf('/* <<< componentes F3a <<< */')).toBeLessThan(iIni);
  });

  it('todo seletor tem pelo menos uma classe do Forecast (prefixo fc) e so classes de PERMITIDAS_COMPAT (prova estatica: nenhuma outra tela muda)', () => {
    expect(achatadas.length).toBeGreaterThan(10);
    const semForecast = achatadas.filter((a) => !classesDoSeletor(a.seletor).some((c) => /^fc[a-z]*-/.test(c))).map((a) => a.seletor);
    expect(semForecast).toEqual([]);
    const fora = achatadas.flatMap((a) => classesDoSeletor(a.seletor)).filter((c) => !PERMITIDAS_COMPAT.has(c));
    expect([...new Set(fora)]).toEqual([]);
  });

  it('sem !important, sem print, sem animacao/transicao/transform e sem cor literal; at-rules: @media (pointer: coarse) e @media (max-width: 700px)', () => {
    expect(limpo).not.toContain('!important');
    expect(limpo).not.toContain('@media print');
    expect(limpo).not.toContain('@keyframes');
    expect(limpo).not.toMatch(/(^|[;{\s])(animation|transition|transform)\s*:/);
    expect(limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(regras.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude)).toEqual(['@media (pointer: coarse)', '@media (max-width: 700px)']);
    for (const cor of limpo.matchAll(/var\((--[\w-]+)/g)) expect(cor[1], 'so tokens --rf-*').toMatch(/^--rf-/);
    expect(limpo).not.toMatch(/(^|[;{\s])opacity\s*:/);
  });

  it('S e a lista travada de tabelas do Forecast com .ghost-button; as demais ficam de fora', () => {
    expect(S_CLASSES).toEqual(['fcr-tabela', 'fcp-tabela', 'fco-tabela']);
    for (const c of SEM_BOTAO) expect(S_CLASSES as readonly string[], c).not.toContain(c);
    const usadas = achatadas.flatMap((a) => classesDoSeletor(a.seletor)).filter((c) => /^fc[a-z]*-/.test(c) && /tabela|grid/.test(c));
    expect([...new Set(usadas)].sort()).toEqual([...S_CLASSES].sort());
  });
});

// ---------- S travado contra os .tsx do Forecast ----------
describe('F3 compat: S confere com as <table> do Forecast (so os .tsx; sem mudanca de TSX)', () => {
  const fontes = import.meta.glob('../pages/Forecast/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const tabelas: Array<{ arquivo: string; classes: string[]; direto: boolean; trecho: string }> = [];
  for (const [arquivo, texto] of Object.entries(fontes)) {
    if (/\.test\.tsx$/.test(arquivo)) continue;
    for (const m of texto.matchAll(/<table className="([^"]+)"/g)) {
      const ini = m.index ?? 0;
      const fim = texto.indexOf('</table>', ini);
      const trecho = texto.slice(ini, fim);
      tabelas.push({ arquivo: arquivo.replace('../pages/Forecast/', ''), classes: (m[1] ?? '').split(/\s+/), direto: trecho.includes('ghost-button'), trecho });
    }
  }

  it('achou as tabelas do Forecast (o glob funciona)', () => {
    expect(tabelas.length).toBeGreaterThan(15);
  });

  it('toda tabela com .ghost-button direto no JSX tem classe de S (unica excecao: a .table generica do modal Fontes, DC-6)', () => {
    const fora = tabelas
      .filter((t) => t.direto)
      .filter((t) => !t.classes.some((c) => (S_CLASSES as readonly string[]).includes(c)))
      .map((t) => `${t.arquivo}: ${t.classes.join('.')}`);
    expect(fora).toEqual(['ForecastFontesModal.tsx: table']);
  });

  it('as tabelas fora de S (SEM_BOTAO) nao tem .ghost-button direto', () => {
    const com = tabelas.filter((t) => t.direto && t.classes.some((c) => SEM_BOTAO.includes(c))).map((t) => `${t.arquivo}: ${t.classes.join('.')}`);
    expect(com).toEqual([]);
  });

  it('cada classe de S e usada por alguma <table> do Forecast', () => {
    for (const c of S_CLASSES) expect(tabelas.some((t) => t.classes.includes(c)), c).toBe(true);
  });

  // Varredura do bloco do Forecast: regra de especificidade MENOR que a da base da compat (0,2,0) que alveja botao e declara uma propriedade
  // que a compat tambem declara perde para a compat (o bloco do Forecast vem depois, mas 0,1,x < 0,2,0). Ou e reafirmada na compat ou
  // so alveja botao fora de S (conferido contra os .tsx). Regra nova no bloco do Forecast que caia aqui reprova ate ser classificada.
  describe('varredura: regras do bloco Forecast (classe unica) que alvejam botao e a compat anularia', () => {
    const iForecast = css.indexOf('/* ---- Forecast (PR 1D-1) ---- */');
    const blocoForecast = achatar(parseRules(css.slice(iForecast).replace(/\/\*[\s\S]*?\*\//g, '')));
    const BASE: Spec = [0, 2, 0];
    const PROPS_DA_COMPAT = ['justify-content', 'min-height', 'padding', 'border', 'border-radius', 'background', 'color', 'font-weight', 'font-size'];
    const alvejaBotao = (sel: string) => /(^button\b|ghost-button|__editar)/.test(ultimoComposto(sel));
    const colidem = blocoForecast
      .filter((a) => !(a.media ?? '').includes('print'))
      .filter((a) => alvejaBotao(a.seletor) && cmp(especificidade(a.seletor), BASE) < 0)
      .filter((a) => Object.keys(a.decls).some((p) => PROPS_DA_COMPAT.includes(p)))
      .map((a) => ({ ...a, chave: `${a.media ?? '-'} | ${a.seletor}` }));

    // seletor do Forecast -> [seletor e media da compat que o reafirma]
    const REAFIRMADAS: Record<string, [string, string | null]> = {
      '- | .fcr-embalagem__editar': [`${S} .fcr-embalagem__editar`, null],
      '@media (max-width: 700px), (pointer: coarse) | .fco-acoes button': [`${S} .fco-acoes .ghost-button`, '@media (max-width: 700px)'],
      '@media (max-width: 700px), (pointer: coarse) | .fco-grupo-alvos button': [`${S} .fco-grupo-alvos .ghost-button`, '@media (max-width: 700px)'],
    };
    // botoes que estao fora das tabelas S (modais e barras do Forecast): classe-raiz que NAO pode aparecer dentro de uma <table> de S
    const FORA_DE_S: Record<string, string> = {
      '@media (max-width: 700px) | .fcsl button': 'fcsl',
      '@media (max-width: 700px), (pointer: coarse) | .fco-barra button': 'fco-barra',
      '@media (max-width: 700px), (pointer: coarse) | .fco-pais__editar': 'fco-pais__editar',
      '@media (max-width: 700px), (pointer: coarse) | .fco-pais__form button': 'fco-pais__form',
      '@media (max-width: 700px), (pointer: coarse) | .fco-confirmar button': 'fco-confirmar',
      '@media (max-width: 700px), (pointer: coarse) | .fco-outro-pais button': 'fco-outro-pais',
    };

    it('o conjunto que colide e exatamente o classificado (reafirmado na compat ou fora de S)', () => {
      expect(colidem.length).toBeGreaterThan(5);
      expect(colidem.map((c) => c.chave).sort()).toEqual([...Object.keys(REAFIRMADAS), ...Object.keys(FORA_DE_S)].sort());
    });

    it('cada regra reafirmada tem na compat as mesmas declaracoes (copia do bloco Forecast)', () => {
      for (const [chave, [selCompat, mediaCompat]] of Object.entries(REAFIRMADAS)) {
        const orig = colidem.find((c) => c.chave === chave);
        expect(orig, chave).toBeDefined();
        const compat = de(selCompat, mediaCompat);
        for (const [prop, valor] of Object.entries(orig?.decls ?? {})) if (PROPS_DA_COMPAT.includes(prop)) expect(compat[prop], `${chave} -> ${prop}`).toBe(valor);
        expect(cmp(especificidade(selCompat), BASE), selCompat).toBeGreaterThanOrEqual(0);
      }
    });

    it('as classes dos botoes "fora de S" nao aparecem dentro de nenhuma <table> de S', () => {
      for (const [chave, raiz] of Object.entries(FORA_DE_S)) {
        const dentro = tabelas.filter((t) => t.classes.some((c) => (S_CLASSES as readonly string[]).includes(c)) && t.trecho.includes(raiz)).map((t) => t.arquivo);
        expect(dentro, chave).toEqual([]);
      }
    });
  });
});

// ---------- declaracoes exatas ----------
describe('F3 compat: declaracoes (valores de ec2c5c3, antes da F3a; contorno 1,5 px --rf-action)', () => {
  it('base: contorno 1,5 px, 8 px de raio, fundo transparente, rotulo a esquerda, altura so pelo padding, peso 500', () => {
    expect(de(`${S} .ghost-button`)).toEqual({
      'justify-content': 'flex-start',
      'min-height': '0',
      padding: '8px 14px',
      border: '1.5px solid var(--rf-action)',
      'border-radius': 'var(--rf-radius-xs)',
      background: 'transparent',
      color: 'var(--rf-action)',
      'font-weight': '500',
    });
  });

  it('nao declara font-size na base (fica o 13 px da F3a) nem height fixo', () => {
    for (const a of achatadas) expect(Object.keys(a.decls), a.seletor).not.toContain('height');
    expect(Object.keys(de(`${S} .ghost-button`))).not.toContain('font-size');
  });

  it('--sm: padding 2px 10px e 0.75rem (como antes)', () => {
    expect(de(`${S} .ghost-button--sm`)).toEqual({ padding: '2px 10px', 'font-size': '0.75rem' });
  });

  it('sobrescritas do proprio Forecast que a F3a empatou e a base da compat venceria: reafirmadas', () => {
    expect(de(`${S} .fcr-embalagem__editar`)).toEqual({ padding: '4px 10px', 'font-size': '12px' });
    expect(de(`${S} .row-actions .ghost-button`)).toEqual({ padding: '5px 10px', 'font-size': '13px' });
    // o valor tem de ser o do bloco do Forecast (copia)
    expect(css).toMatch(/\.fcr-embalagem__editar \{ padding: 4px 10px; font-size: 12px; \}/);
  });

  it('estados: hover e pressionado de acao; desabilitado por ultimo (vence tambem o destrutivo)', () => {
    expect(de(`${S} .ghost-button:hover:not(:disabled)`)).toEqual({ background: 'var(--rf-action-hover-bg)' });
    expect(de(`${S} .ghost-button:active:not(:disabled)`)).toEqual({
      'border-color': 'var(--rf-action-pressed)',
      background: 'var(--rf-action-pressed-bg)',
      color: 'var(--rf-action-pressed)',
    });
    expect(de(`${S} .ghost-button:disabled`)).toEqual({ 'border-color': 'var(--rf-border)', background: 'transparent', color: 'var(--rf-disabled-fg)' });
    const ordem = achatadas.map((a) => a.seletor);
    expect(ordem.indexOf(`${S} .ghost-button:disabled`)).toBeGreaterThan(ordem.indexOf(`${S} .ghost-button.danger-button`));
    // o scale(.97) do pressionado e o reduced-motion continuam vindo da F3a: a compat nao declara transform
    expect(limpo).not.toContain('scale(');
  });

  it('destrutivo em tabela: contorno e texto vermelhos; hover e pressionado do destrutivo', () => {
    expect(de(`${S} .ghost-button.danger-button`)).toEqual({ 'border-color': 'var(--rf-danger)', color: 'var(--rf-tone-danger-fg)' });
    expect(de(`${S} .ghost-button.danger-button:hover:not(:disabled)`)).toEqual({ background: 'var(--rf-tone-danger-bg)' });
    expect(de(`${S} .ghost-button.danger-button:active:not(:disabled)`)).toEqual({
      'border-color': 'var(--rf-danger)',
      background: 'var(--rf-tone-danger-bg)',
      color: 'var(--rf-tone-danger-fg)',
    });
  });

  it('toque: min-height 44 em @media (pointer: coarse)', () => {
    expect(de(`${S} .ghost-button`, '@media (pointer: coarse)')).toEqual({ 'min-height': '44px' });
  });

  it('toque em <= 700 px: reafirma as sobrescritas de classe unica do bloco Forecast (.fco-acoes button, .fco-grupo-alvos button)', () => {
    const m = '@media (max-width: 700px)';
    for (const sel of [`${S} .fco-acoes .ghost-button`, `${S} .fco-grupo-alvos .ghost-button`]) {
      expect(de(sel, m), sel).toEqual({ 'min-height': '44px' });
      expect(cmp(especificidade(sel), especificidade(`${S} .ghost-button`)), sel).toBeGreaterThanOrEqual(0);
    }
  });

  it('foco: a compat nao declara (anel da F3a e aneis proprios do Forecast continuam)', () => {
    expect(limpo).not.toContain(':focus');
    expect(limpo).not.toMatch(/(^|[;{\s])(outline|outline-offset)\s*:/);
  });

  it('selo vencido / sem estoque / critico: anel interno 1 px --rf-danger (nao muda altura nem largura)', () => {
    const sel = ':is(.fcr-linha--vencida, .fcr-linha--sem-estoque, .fcr-linha--critico) .badge--danger';
    expect(de(sel)).toEqual({ 'box-shadow': 'inset 0 0 0 1px var(--rf-danger)' });
    for (const prop of ['padding', 'border', 'width', 'height', 'min-height', 'margin', 'font-size']) expect(Object.keys(de(sel)), prop).not.toContain(prop);
  });
});

// ---------- especificidade e ordem frente a F3a ----------
describe('F3 compat: especificidade >= a da F3a (e a regiao vem depois dela: empate vence pela ordem)', () => {
  const PARES: Array<[compat: string, f3a: string]> = [
    [`${S} .ghost-button`, ':is(table, .row-actions) .ghost-button'],
    [`${S} .ghost-button:hover:not(:disabled)`, ':is(table, .row-actions) .ghost-button:hover:not(:disabled)'],
    [`${S} .ghost-button:active:not(:disabled)`, ':is(table, .row-actions) .ghost-button:active:not(:disabled)'],
    [`${S} .ghost-button:disabled`, ':is(table, .row-actions) .ghost-button:disabled'],
    [`${S} .ghost-button--sm`, '.ghost-button--sm'],
    [`${S} .ghost-button.danger-button`, '.ghost-button.danger-button'],
    [`${S} .ghost-button.danger-button:hover:not(:disabled)`, '.ghost-button.danger-button:hover:not(:disabled)'],
    [`${S} .ghost-button.danger-button:active:not(:disabled)`, '.ghost-button.danger-button:active:not(:disabled)'],
  ];

  for (const [compat, f3a] of PARES) {
    it(`${compat}  >=  ${f3a}`, () => {
      expect(achatadasF3a.some((a) => a.seletor === f3a), `a F3a nao tem ${f3a}`).toBe(true);
      expect(achatadas.some((a) => a.seletor === compat), `a compat nao tem ${compat}`).toBe(true);
      expect(cmp(especificidade(compat), especificidade(f3a))).toBeGreaterThanOrEqual(0);
    });
  }

  it('as sobrescritas reafirmadas (duas classes) vencem a base (duas classes) pela ordem dentro da regiao', () => {
    const ordem = achatadas.map((a) => a.seletor);
    const base = ordem.indexOf(`${S} .ghost-button`);
    for (const s of [`${S} .ghost-button--sm`, `${S} .fcr-embalagem__editar`, `${S} .row-actions .ghost-button`]) {
      expect(ordem.indexOf(s), s).toBeGreaterThan(base);
      expect(cmp(especificidade(s), especificidade(`${S} .ghost-button`)), s).toBeGreaterThanOrEqual(0);
    }
  });

  it('o bloco do Forecast (depois da regiao) segue vencendo as sobrescritas de duas classes: .fcd-acoes .ghost-button', () => {
    const iRegiao = css.indexOf(`/* <<< ${NOME} <<< */`);
    const iFcd = css.indexOf('.fcd-acoes .ghost-button {');
    expect(iFcd).toBeGreaterThan(iRegiao);
    expect(cmp(especificidade('.fcd-acoes .ghost-button'), especificidade(`${S} .ghost-button`))).toBeGreaterThanOrEqual(0);
  });
});
