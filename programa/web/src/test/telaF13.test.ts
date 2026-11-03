/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { classesDoSeletor, fixtureUniao, foraDasRegioes, parseRules, readSource, regioes, stripComments, tokensDosTemas, type CssRule } from './rfCss';

// F13 (Forecast na identidade nova; mock v68): regiao `tela F13` do globals.css, preparada na F13-0 SEM mudanca visual. Esta guarda cobre: a regiao (unica, a ultima,
// contigua a `tela F12`), os 4 sub-blocos sentinela (B pagina do item, C cabecalho/Mais/painel/estados, D relatorio e modais de operacao, E modais de apoio) na ordem,
// separados por 1 linha em branco e com tudo da regiao DENTRO de algum par, a raiz `.fc-pagina` (Forecast.tsx) como unico prefixo dos seletores, so token `--rf-*` (e
// `--val`, a unica propriedade local aceita pelo themeTokens), sem !important, cor literal, @media print nem declaracao de token, at-rules de tela (screen, screen e
// max-width, com pointer: coarse e prefers-reduced-motion aninhados) e a ancora de tokens F13 nos 2 blocos. A regiao fica antes do CSS legado do Forecast (que vem
// depois no arquivo): por isso a raiz `.fc-pagina` (especificidade maior). Cada frente edita SO o seu par; as demais conferencias ficam nas guardas das etapas.

const NOME = 'tela F13';
const rawLf = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regs = regioes(rawLf);
const regiao = regs.find((r) => r.nome === NOME);
const fora = foraDasRegioes(rawLf, regs);
const { claro: lightTokens, escuro: darkTokens } = tokensDosTemas(rawLf);

const forecastTsx = readSource('../pages/Forecast.tsx');
const fontes = import.meta.glob(['../**/*.tsx', '../**/*.ts', '!../test/**', '!../**/*.test.ts', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

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

const topo: CssRule[] = regiao?.regras ?? [];
const ehAtRule = (r: CssRule) => r.prelude.startsWith('@');
const planas = (rules: CssRule[]): CssRule[] => rules.flatMap((r) => (/^@(media|supports)\b/.test(r.prelude) ? planas(parseRules(r.body)) : ehAtRule(r) ? [] : [r]));
const regrasPlanas = planas(topo);
const seletores = regrasPlanas.flatMap((r) => listaDeSeletores(r.prelude));

const SENTINELAS = ['B', 'C', 'D', 'E'] as const;
const abre = (s: string) => `/* -- F13-${s} >>> -- */`;
const fecha = (s: string) => `/* -- <<< F13-${s} -- */`;

describe('F13: regiao `tela F13` (preparada vazia na F13-0)', () => {
  it('existe uma vez, logo depois da tela F12 (so espaco entre elas) e e a ultima das regioes', () => {
    expect(regiao).toBeDefined();
    const nomes = regs.map((r) => r.nome);
    expect(nomes.filter((n) => n === NOME)).toHaveLength(1);
    expect(nomes.at(-1)).toBe(NOME);
    expect(nomes.at(-2)).toBe('tela F12');
    const f12 = regs.find((r) => r.nome === 'tela F12');
    expect(rawLf.slice(f12?.fim ?? 0, regiao?.inicio ?? 0).trim()).toBe('');
    expect(rawLf.split(`/* >>> ${NOME} (Suite COMEX) >>> */`)).toHaveLength(2);
    expect(rawLf.split(`/* <<< ${NOME} <<< */`)).toHaveLength(2);
  });

  it('tem os 4 sub-blocos sentinela B, C, D, E na ordem, cada marcador 1 vez, separados por 1 linha em branco', () => {
    const bruto = regiao?.bruto ?? '';
    for (const s of SENTINELAS) {
      expect(bruto.split(abre(s)), abre(s)).toHaveLength(2);
      expect(bruto.split(fecha(s)), fecha(s)).toHaveLength(2);
      expect(bruto.indexOf(abre(s)), s).toBeLessThan(bruto.indexOf(fecha(s)));
    }
    const posicoes = SENTINELAS.flatMap((s) => [bruto.indexOf(abre(s)), bruto.indexOf(fecha(s))]);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    // entre o fim de um par e o inicio do proximo: exatamente 1 linha em branco (>= 3 linhas intactas entre os pares = merge sem conflito)
    SENTINELAS.slice(1).forEach((s, i) => {
      const anterior = SENTINELAS[i] ?? 'B';
      const entre = bruto.slice(bruto.indexOf(fecha(anterior)) + fecha(anterior).length, bruto.indexOf(abre(s)));
      expect(entre, `${anterior} -> ${s}`).toBe('\n\n');
    });
    // o texto de cada marcador e o que as frentes usam para provar "CSS identico fora do meu par"
    expect((bruto.match(/\/\* -- F13-[BCDE] >>> -- \*\//g) ?? []).length).toBe(4);
    expect((bruto.match(/\/\* -- <<< F13-[BCDE] -- \*\//g) ?? []).length).toBe(4);
  });

  it('toda regra da regiao esta DENTRO de um par de sentinelas (fora deles so o comentario de abertura)', () => {
    const bruto = regiao?.bruto ?? '';
    let resto = bruto;
    for (const s of SENTINELAS) {
      const i = resto.indexOf(abre(s));
      const j = resto.indexOf(fecha(s));
      resto = resto.slice(0, i) + resto.slice(j + fecha(s).length);
    }
    const semMarcadores = stripComments(resto).replace(`/* >>> ${NOME} (Suite COMEX) >>> */`, '').replace(`/* <<< ${NOME} <<< */`, '');
    expect(semMarcadores.trim()).toBe('');
  });

  it('o CSS efetivo da regiao so tem at-rules de tela: @media screen (ou screen and (max-width: N)) com pointer: coarse e prefers-reduced-motion aninhados; nenhuma regra solta', () => {
    for (const r of topo) {
      expect(r.prelude, r.prelude).toMatch(/^@media screen( and \(max-width: \d+px\))?$/);
      for (const interna of parseRules(r.body)) {
        if (interna.prelude.startsWith('@')) expect(interna.prelude, `${r.prelude} > ${interna.prelude}`).toMatch(/^@media \((pointer: coarse|prefers-reduced-motion: reduce)\)$/);
      }
    }
    expect(regiao?.limpo ?? '').not.toMatch(/@media\s+print|@keyframes|@font-face|@import/);
  });

  it('todo seletor (cada item da lista) comeca por `.fc-pagina` ou `:root[data-theme="dark"] .fc-pagina`', () => {
    for (const s of seletores) expect(/^(:root\[data-theme="dark"\] )?\.fc-pagina( |$|[.:[>+~])/.test(s), s).toBe(true);
    for (const s of seletores) expect(classesDoSeletor(s).includes('fc-pagina'), s).toBe(true);
  });

  it('so var(--rf-*) e var(--val); sem !important, cor literal nem declaracao de token (alem de --val)', () => {
    const limpo = regiao?.limpo ?? '';
    for (const [, nome] of limpo.matchAll(/var\(\s*(--[\w-]+)/g)) expect(nome === '--val' || (nome ?? '').startsWith('--rf-'), nome).toBe(true);
    expect(limpo).not.toContain('!important');
    expect(limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    const declarados = [...limpo.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(declarados.filter((n) => n !== '--val')).toEqual([]);
  });

  it('a regiao nao muda nada na F13-0: a raiz `.fc-pagina` vem so do Forecast.tsx (1 vez, no wrapper da pagina) e nenhum outro arquivo da aplicacao a usa', () => {
    expect(forecastTsx.split('className="page fc-pagina"')).toHaveLength(2);
    expect(forecastTsx.split('fc-pagina')).toHaveLength(2);
    const usos = Object.entries(fontes).filter(([caminho, src]) => src.includes('fc-pagina') && !caminho.endsWith('/pages/Forecast.tsx'));
    expect(usos.map(([c]) => c)).toEqual([]);
  });
});

describe('F13: tokens (ancora `tokens F13 (forecast)` nos 2 blocos e uso so dentro da regiao)', () => {
  const ancora = '/* tokens F13 (forecast) */';

  it('a ancora existe 1 vez em cada bloco (claro e escuro), depois da `tokens F12 (qa)`', () => {
    const posicoes = [...rawLf.matchAll(/\/\* tokens F13 \(forecast\) \*\//g)].map((m) => m.index ?? 0);
    const f12 = [...rawLf.matchAll(/\/\* tokens F12 \(qa\) \*\//g)].map((m) => m.index ?? 0);
    expect(rawLf.split(ancora)).toHaveLength(3);
    expect(f12).toHaveLength(2);
    posicoes.forEach((p, i) => expect(p, `bloco ${i}`).toBeGreaterThan(f12[i] ?? Infinity));
  });

  it('os tokens da fixture `suiteComexTokens.f13.json` (se houver) existem nos 2 temas e so sao usados DENTRO da regiao `tela F13`', () => {
    const f13 = fixtureUniao().filter((t) => t.arquivo === 'suiteComexTokens.f13.json');
    for (const t of f13) {
      expect(lightTokens[t.token], t.token).toBe(t.claro);
      if (!t.constante) expect(darkTokens[t.token], t.token).toBe(t.escuro);
      expect(t.fonte, t.token).toBe('mock');
      const uso = `var(${t.token})`;
      expect(fora, t.token).not.toContain(uso);
      for (const r of regs.filter((x) => x.nome !== NOME)) expect(r.limpo, `${r.nome}: ${t.token}`).not.toContain(uso);
    }
  });
});
