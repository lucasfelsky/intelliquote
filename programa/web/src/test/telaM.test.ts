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
    for (const r of regs.filter((x) => x.nome !== NOME)) expect(r.limpo, r.nome).not.toContain('manual-');
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

  it('as regras de at-rule vem DEPOIS das regras base do Manual (vencem pela ordem de cascata)', () => {
    const bruto = regiao?.bruto ?? '';
    const baseFim = bruto.lastIndexOf('.manual-vazio');
    for (const a of ['@media screen and (max-width: 1199px)', '@media screen and (max-width: 1023px)', '@media (pointer: coarse)', '@media (prefers-reduced-motion: reduce)']) {
      expect(bruto.indexOf(a), a).toBeGreaterThan(baseFim);
    }
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

  it('pointer: coarse leva o link do indice, o campo de busca e o seletor de capitulo a 44', () => {
    const coarse = manual.filter((r) => r.atRule === '@media (pointer: coarse)');
    const alvos44 = coarse.filter((r) => /min-height:\s*44px/.test(r.corpo)).flatMap((r) => r.seletores);
    for (const s of ['.manual-indice__link', '.manual-busca__input', '.manual-indice-select__campo']) expect(alvos44, s).toContain(s);
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
    for (const [arquivo, fonte] of arquivos) {
      for (const [, valor] of fonte.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
        for (const [classe] of (valor ?? '').matchAll(/(?<![\w-])manual-[\w-]*[a-z0-9]/g)) {
          if (!comRegra(classe)) faltando.push(`${arquivo}: .${classe}`);
        }
      }
    }
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
