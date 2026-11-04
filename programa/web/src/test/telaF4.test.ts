/// <reference types="node" />
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
  temasDeTokens,
  tokensDosTemas,
  type CssRule,
  type Rgb,
  type ThemeName,
} from './rfCss';

// F4 (Suite COMEX, mock v68; boards Login, LoginEscuro e AcessoEstados A/B/C): login "Curvas de cambio" (D4) e carregando sessao.
// CSS na regiao `tela F4` do globals.css; TSX: LoginGate, LoginBackdrop (+ LoginPainel) e LoadingShell. Esta guarda cobre: a regiao (posicao,
// prefixos donos, at-rules, reduced-motion, sem cor literal), que nada do login sobrou fora dela, a fixture da etapa (12 pares), o contraste
// nos 2 temas (com as excecoes decorativas do mock) e os 3 TSX (sem estilo inline, token, cor literal ou glifo; toda classe tem regra).

const NOME = 'tela F4';
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
const mediaDe = (nome: string) => parseRules(topo.find((r) => r.prelude === nome)?.body ?? '');
const reduzido = mediaDe('@media (prefers-reduced-motion: reduce)');
const seletores = planas.flatMap((r) => listaDeSeletores(r.prelude));

// ---------- listas da etapa (PLAN 12.2) ----------
const DONOS = ['auth-gate', 'auth-card', 'login-', 'loading-shell'];
const ehDono = (c: string) => DONOS.some((d) => c.startsWith(d));
const CONTEXTO = new Set(['input', 'field-label', 'primary-button', 'ghost-button', 'alert', 'alert--error', 'btn-spinner', 'spinner', 'spinner--fullscreen', 'eyebrow']);
const ehContexto = (c: string) => CONTEXTO.has(c) || c.startsWith('brand-mark') || c.startsWith('sq-logo');

describe('F4: regiao `tela F4`', () => {
  it('existe uma unica vez, logo depois da compat Forecast F3 e antes da `tela F5`', () => {
    expect(regs.filter((r) => r.nome === NOME)).toHaveLength(1);
    const nomes = regs.map((r) => r.nome);
    const i = nomes.indexOf(NOME);
    expect(nomes[i - 1]).toBe('compat Forecast F3');
    expect(nomes[i + 1]).toBe('tela F5');
    const compat = regs[i - 1];
    expect(compat && rawLf.slice(compat.fim, compat.fim + 2)).toBe('\n\n');
    expect(regiao?.inicio).toBe((compat?.fim ?? 0) + 2);
    expect(planas.length).toBeGreaterThan(30);
  });

  it('todo seletor (cada item de lista) tem ao menos 1 classe dona; as demais classes sao dono ou contexto', () => {
    const semDono = seletores.filter((s) => !classesDoSeletor(s).some(ehDono));
    expect(semDono).toEqual([]);
    const estranhas = [...new Set(seletores.flatMap(classesDoSeletor))].filter((c) => !ehDono(c) && !ehContexto(c));
    expect(estranhas).toEqual([]);
  });

  it('at-rules: so max-width 640, reduced-motion e @keyframes rf-login-*; sem @media print, !important ou cor literal', () => {
    const atRules = topo.filter((r) => r.prelude.startsWith('@')).map((r) => r.prelude);
    for (const a of atRules) {
      expect(a === '@media (max-width: 640px)' || a === '@media (prefers-reduced-motion: reduce)' || /^@keyframes rf-login-[\w-]+$/.test(a), a).toBe(true);
    }
    expect(atRules).toContain('@media (max-width: 640px)');
    expect(atRules).toContain('@media (prefers-reduced-motion: reduce)');
    expect(atRules.filter((a) => a.startsWith('@keyframes')).sort()).toEqual([
      '@keyframes rf-login-onda-1',
      '@keyframes rf-login-onda-2',
      '@keyframes rf-login-onda-3',
      '@keyframes rf-login-onda-4',
      '@keyframes rf-login-ponto',
    ]);
    for (const m of topo.filter((r) => r.prelude.startsWith('@media'))) {
      for (const inner of parseRules(m.body)) expect(inner.prelude.startsWith('@'), inner.prelude).toBe(false);
    }
    expect(regiao?.limpo).not.toContain('@media print');
    expect(regiao?.limpo).not.toContain('!important');
    expect(regiao?.limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it('a regiao nao declara token (--*) e consome var(--rf-', () => {
    expect(regiao?.limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    expect(regiao?.limpo).toContain('var(--rf-');
  });

  it('movimento: toda animation tem contrapartida no reduced-motion da MESMA regiao (ondas paradas, ponto oculto)', () => {
    const comAnimacao = semMedia.filter((r) => /(^|[;{\s])animation\s*:/.test(r.body));
    expect(comAnimacao.map((r) => r.prelude).sort()).toEqual([
      '.login-backdrop__onda--1',
      '.login-backdrop__onda--2',
      '.login-backdrop__onda--3',
      '.login-backdrop__onda--4',
      '.login-backdrop__ponto',
    ]);
    for (const r of comAnimacao) {
      for (const s of listaDeSeletores(r.prelude)) expect(declaracoes(reduzido, s).animation, `sem contrapartida: ${s}`).toBe('none');
    }
    expect(declaracoes(reduzido, '.login-backdrop__ponto').visibility).toBe('hidden');
    // so transform e offset-distance se movem (nunca layout)
    const keyframes = topo.filter((r) => r.prelude.startsWith('@keyframes'));
    expect(keyframes).toHaveLength(5);
    for (const k of keyframes) {
      const props = [...k.body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
      expect(props.every((p) => p === 'transform' || p === 'offset-distance'), k.prelude).toBe(true);
    }
  });

  it('ponto movel: o offset-path e o mesmo caminho da curva principal do LoginBackdrop, em 22 s linear', () => {
    const decl = declaracoes(semMedia, '.login-backdrop__ponto');
    const d = /^path\("([^"]+)"\)$/.exec(decl['offset-path'] ?? '')?.[1];
    expect(d).toBeTruthy();
    expect(readSource('../components/LoginBackdrop.tsx')).toContain(`'${d}'`);
    expect(decl.animation).toBe('rf-login-ponto 22s linear infinite');
  });

  it('medidas do board: painel 600 (clamp), nome 52, cartao 440 / padding 36 / gap 18 / raio 22, campos e botoes 48, titulo 28', () => {
    expect(declaracoes(semMedia, '.auth-gate')['grid-template-columns']).toBe('clamp(280px, 41.667vw, 600px) minmax(0, 1fr)');
    expect(declaracoes(semMedia, '.login-backdrop').left).toBe('clamp(280px, 41.667vw, 600px)');
    expect(declaracoes(semMedia, '.login-painel').padding).toBe('80px clamp(28px, 3.889vw, 56px) 0');
    expect(declaracoes(semMedia, '.login-painel').gap).toBe('16px');
    expect(declaracoes(semMedia, '.login-painel__nome')).toMatchObject({
      'font-size': 'clamp(36px, 3.612vw, 52px)',
      'font-weight': '700',
      'letter-spacing': '-0.02em',
      'line-height': '1.05',
    });
    expect(declaracoes(semMedia, '.login-painel__assinatura').bottom).toBe('40px');
    expect(declaracoes(semMedia, '.auth-card')).toMatchObject({
      width: '440px',
      padding: '36px',
      gap: '18px',
      'border-radius': 'var(--rf-radius-panel)',
      'box-shadow': 'var(--rf-login-card-shadow)',
    });
    expect(declaracoes(semMedia, '.auth-card__cabecalho').gap).toBe('8px');
    expect(declaracoes(semMedia, '.auth-card .auth-card__eyebrow')).toMatchObject({
      'font-size': '11px',
      'font-weight': '600',
      'letter-spacing': '1.5px',
      color: 'var(--rf-login-accent)',
    });
    expect(declaracoes(semMedia, '.auth-card h1')).toMatchObject({ 'font-size': '28px', 'font-weight': '700', 'letter-spacing': '-0.02em', 'line-height': '1.15' });
    expect(declaracoes(semMedia, '.auth-card .auth-card__texto')).toMatchObject({ 'font-size': '15px', 'line-height': '1.6' });
    expect(declaracoes(semMedia, '.auth-card__campo .input')).toMatchObject({
      'min-height': '48px',
      'border-radius': 'var(--rf-radius-button)',
      'font-size': '15px',
      'font-weight': '500',
    });
    expect(declaracoes(semMedia, '.auth-card__submit')).toMatchObject({ 'min-height': '48px', 'font-size': '15px', gap: '10px' });
    expect(declaracoes(semMedia, '.auth-card__portal')).toMatchObject({ 'min-height': '48px', 'border-color': 'var(--rf-login-ghost-border)' });
    expect(declaracoes(semMedia, '.auth-card .auth-card__submit:disabled')).toMatchObject({ background: 'var(--rf-disabled-bg)', color: 'var(--rf-ink)' });
  });

  it('LoadingShell: gap 22, spinner 28 com borda 3', () => {
    expect(declaracoes(semMedia, '.loading-shell')).toMatchObject({ gap: '22px', 'align-content': 'center' });
    expect(declaracoes(semMedia, '.loading-shell__spinner')).toEqual({ width: '28px', height: '28px', 'border-width': '3px' });
  });

  it('escuro: borda direita do painel em --rf-border e Voltar com texto --rf-ink (board LoginEscuro)', () => {
    expect(declaracoes(semMedia, ':root[data-theme="dark"] .login-painel')['border-right']).toBe('1px solid var(--rf-border)');
    expect(declaracoes(semMedia, ':root[data-theme="dark"] .auth-card__portal').color).toBe('var(--rf-ink)');
    expect(declaracoes(semMedia, ':root[data-theme="dark"] .auth-card__portal:not(:hover, :active)').background).toBe('transparent');
  });
});

describe('F4: nada do login sobrou fora da regiao; login.css nao existe', () => {
  const foraLimpo = fora.replace(/\/\*[\s\S]*?\*\//g, '');
  const foraSeletores = regrasPlanas(parseRules(foraLimpo)).flatMap((r) => listaDeSeletores(r.prelude));

  it('0 seletores com classe .auth-*, .login-* ou .loading-shell* fora das regioes', () => {
    const violacoes = foraSeletores.filter((s) => classesDoSeletor(s).some((c) => ehDono(c)));
    expect(violacoes).toEqual([]);
  });

  it('`@keyframes spin` fica fora; `.spinner--fullscreen` segue na regiao F3d', () => {
    expect(fora).toContain('@keyframes spin');
    const f3d = regs.find((r) => r.nome === 'componentes F3d');
    expect(f3d?.limpo).toContain('.spinner--fullscreen');
  });
});

describe('F4: fixture e tokens', () => {
  const f4 = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f4.json');
  const ESPERADOS = [
    '--rf-login-panel-bg',
    '--rf-login-panel-dot',
    '--rf-login-dot',
    '--rf-login-grid',
    '--rf-login-curve',
    '--rf-login-curve-main',
    '--rf-login-node-ring',
    '--rf-login-area',
    '--rf-login-accent',
    '--rf-login-axis',
    '--rf-login-card-shadow',
    '--rf-login-ghost-border',
  ];

  it('a fixture da etapa tem 12 pares (nenhuma constante), sem repeticao na uniao', () => {
    expect(f4.map((t) => t.token)).toEqual(ESPERADOS);
    expect(f4.filter((t) => t.constante)).toEqual([]);
    const todos = fixtureUniao().map((t) => t.token);
    expect(new Set(todos).size).toBe(todos.length);
    const base = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.json').map((t) => t.token);
    for (const t of f4) expect(base).not.toContain(t.token);
  });

  it('os valores da fixture sao os do :root e do bloco escuro (copiados dos boards Login e LoginEscuro)', () => {
    for (const t of f4) {
      expect(lightTokens[t.token], t.token).toBe(t.claro);
      expect(darkTokens[t.token], t.token).toBe(t.escuro);
    }
    expect(lightTokens['--rf-login-panel-bg']).toBe('linear-gradient(180deg, #003241, #004153)');
    expect(darkTokens['--rf-login-panel-bg']).toBe('linear-gradient(180deg, #0a2a35, #0f3341)');
    expect(lightTokens['--rf-login-accent']).toBe('#007864');
    expect(darkTokens['--rf-login-accent']).toBe('#5ff0c8');
    expect(lightTokens['--rf-login-ghost-border']).toBe('#004153');
    expect(darkTokens['--rf-login-ghost-border']).toBe('#5a7880');
  });
});

// ---------- contraste (12.4-C) ----------
const TEXT = 4.5;
const UI = 3;
const rf = (n: string) => `--rf-${n}`;
const opaque = (theme: ThemeName, name: string): Rgb => opaqueOf(THEMES[theme], name);
// Paradas (hex) do gradiente do painel, por tema.
const paradas = (theme: ThemeName): Rgb[] => {
  const valor = THEMES[theme]['--rf-login-panel-bg'] ?? '';
  return [...valor.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => {
    const [r, g, b] = parseColor(m[0]);
    return [r, g, b] as Rgb;
  });
};
const fundoDoTema = (theme: ThemeName): Rgb => {
  const [r, g, b] = parseColor(THEMES[theme]['--rf-bg'] ?? '');
  return [r, g, b];
};

describe('F4: contraste nos 2 temas (alpha composto sobre --rf-surface)', () => {
  type Par = readonly [fg: string, bg: string, min: number];
  const PARES: ReadonlyArray<Par> = [
    [rf('login-accent'), rf('surface'), TEXT], // eyebrow do cartao (5,43 / 10,43)
    [rf('ink'), rf('surface'), TEXT],
    [rf('ink-soft'), rf('surface'), TEXT],
    [rf('ink'), rf('disabled-bg'), TEXT], // "Entrando…" sobre o botao desabilitado (estado B)
    [rf('login-ghost-border'), rf('surface'), UI], // contorno de "Voltar ao Portal COMEX" (11,16 / 3,13)
    [rf('action'), rf('bg'), UI], // spinner do carregando sessao
  ];
  const rows = (['claro', 'escuro'] as const).flatMap((theme) =>
    PARES.map(([fg, bg, min]) => {
      const ratio = ratioOf(opaque(theme, fg), opaque(theme, bg));
      return { id: `${theme}: ${fg} / ${bg}`, min, ratio: Number(ratio.toFixed(2)), ok: ratio >= min };
    }),
  );

  it('todos os pares de token passam (6 x 2 temas)', () => {
    console.table(rows.map((r) => ({ par: r.id, min: r.min, ratio: r.ratio, ok: r.ok })));
    expect(rows).toHaveLength(PARES.length * 2);
    expect(rows.filter((r) => !r.ok).map((r) => `${r.id}: ${r.ratio} < ${r.min}`)).toEqual([]);
  });

  it('painel: o nome (--rf-sidebar-ink) passa de 4,5 e a marca verde (--rf-primary) de 3 sobre as 2 paradas do gradiente, nos 2 temas', () => {
    for (const theme of ['claro', 'escuro'] as const) {
      const ps = paradas(theme);
      expect(ps, theme).toHaveLength(2);
      for (const p of ps) {
        expect(ratioOf(opaque(theme, rf('sidebar-ink')), p), `${theme} nome`).toBeGreaterThanOrEqual(TEXT);
        expect(ratioOf(opaque(theme, rf('primary')), p), `${theme} marca`).toBeGreaterThanOrEqual(UI);
      }
    }
  });

  it('excecoes do mock (decorativas, aria-hidden, fora de PAIRS): a curva USD/BRL (2,85:1 solida; menor com o alfa de 0,85) e o eixo SEG..SEX ficam abaixo de 3:1 sobre --rf-bg no claro', () => {
    const bg = fundoDoTema('claro');
    const [r, g, b] = parseColor(THEMES.claro['--rf-login-curve-main'] ?? '');
    const solida = ratioOf([r, g, b], bg);
    expect(solida).toBeGreaterThan(2.75);
    expect(solida).toBeLessThan(2.95);
    const composta = ratioOf(over(parseColor(THEMES.claro['--rf-login-curve-main'] ?? ''), bg), bg);
    expect(composta).toBeLessThan(solida);
    const eixo = ratioOf(over(parseColor(THEMES.claro['--rf-login-axis'] ?? ''), bg), bg);
    expect(eixo).toBeLessThan(UI);
  });
});

// ---------- TSX da etapa ----------
const ARQUIVOS = ['pages/LoginGate.tsx', 'components/LoginBackdrop.tsx', 'components/LoadingShell.tsx'] as const;

describe('F4: LoginGate, LoginBackdrop e LoadingShell', () => {
  it.each(ARQUIVOS)('%s: sem estilo inline, token --rf-, cor literal (so os stopColor da mascara) nem glifo', (arquivo) => {
    const linhas = readSource(`../${arquivo}`).split(/\r?\n/);
    const ofensas = linhas.filter(
      (l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--rf-|style=\{\{|[▸▾→]|&times;/.test(l) && !/stopColor="#(000|fff|444)"/.test(l),
    );
    expect(ofensas).toEqual([]);
  });

  it('toda classe usada nos 3 arquivos tem regra no CSS', () => {
    const cssLimpo = rawLf.replace(/\/\*[\s\S]*?\*\//g, '');
    const comRegra = new Set(regrasPlanas(parseRules(cssLimpo)).flatMap((r) => listaDeSeletores(r.prelude).flatMap(classesDoSeletor)));
    const usadas = new Set<string>();
    for (const arquivo of ARQUIVOS) {
      for (const [, lista] of readSource(`../${arquivo}`).matchAll(/className="([^"]+)"/g)) {
        for (const c of (lista ?? '').split(/\s+/)) if (c) usadas.add(c);
      }
    }
    expect(usadas.size).toBeGreaterThan(25);
    expect([...usadas].filter((c) => !comRegra.has(c))).toEqual([]);
  });

  it('o LoginBackdrop nao usa SMIL nem cor por atributo (so stopColor da mascara); o LoginGate nao importa mais o login.css', () => {
    const fundo = readSource('../components/LoginBackdrop.tsx');
    expect(fundo).not.toMatch(/<animate|<set\b|<mpath/);
    expect(fundo).not.toMatch(/\b(fill|stroke)="#/);
    expect(readSource('../pages/LoginGate.tsx')).not.toContain('login.css');
  });
});
