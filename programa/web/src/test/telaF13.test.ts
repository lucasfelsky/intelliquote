/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { classesDoSeletor, fixtureUniao, foraDasRegioes, parseRules, readSource, regioes, stripComments, tokensDosTemas, type CssRule } from './rfCss';

// F13 (Forecast na identidade nova; mock v68): regiao `tela F13` do globals.css, preparada na F13-0 SEM mudanca visual. Esta guarda cobre: a regiao (unica, a ultima,
// contigua a `tela F12`), os 4 sub-blocos sentinela (B pagina do item, C cabecalho/Mais/painel/estados, D relatorio e modais de operacao, E modais de apoio) na ordem,
// separados por 1 linha em branco e com tudo da regiao DENTRO de algum par, as 2 raizes permitidas (`.fc-pagina`, em Forecast.tsx, e `.fc-portal`, classe EXTRA no <dialog> dos
// modais do Forecast que vao para document.body por createPortal: ficam fora de `.fc-pagina`) como unico prefixo dos seletores, so token `--rf-*` (e
// `--val`, a unica propriedade local aceita pelo themeTokens), sem !important, cor literal (hex, rgb(a), hsl(a) ou NOMEADA), @media print nem declaracao de token, at-rules de tela
// (screen, screen e max-width, com pointer: coarse e prefers-reduced-motion aninhados) e a ancora de tokens F13 nos 2 blocos. A regiao fica antes do CSS legado do Forecast
// (que vem depois no arquivo): por isso as raizes (especificidade maior). Cada frente edita SO o seu par; as demais conferencias ficam nas guardas das etapas.

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

// Os 3 componentes do Forecast cujo <Modal> e a raiz de um createPortal(document.body) (ForecastRelatorioCompras.tsx e ForecastRelatorioDemandaComercial.tsx): so eles usam `fc-portal`.
const ARQUIVOS_PORTAL = ['/pages/Forecast/ForecastDemandaComercialModal.tsx', '/pages/Forecast/ForecastEmbalagensModal.tsx', '/pages/Forecast/ForecastRelatorioDemandaComercial.tsx'];

// Cores NOMEADAS do CSS (as palavras-chave de cor; `transparent` e `currentcolor` ficam de fora: nao sao cor literal).
const CORES_NOMEADAS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
    'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
    'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow ' +
    'grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey ' +
    'lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid ' +
    'mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange ' +
    'orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

// Corpos das regras folha (as chaves dos at-rules sao abertas); um trecho sem chaves (declaracoes soltas) e o proprio corpo.
function corposFolha(css: string): string[] {
  const limpo = stripComments(css);
  if (!limpo.includes('{')) return [limpo];
  return parseRules(limpo).flatMap((r) => (r.body.includes('{') ? corposFolha(r.body) : [r.body]));
}

// Valores das declaracoes de um trecho de CSS (comentarios fora; so DECLARACOES, nunca seletores): sem var(...), sem strings, sem url(...); as palavras que sobram sao comparadas com as cores nomeadas.
function coresNomeadasEm(css: string): string[] {
  const out: string[] = [];
  for (const corpo of corposFolha(css)) {
    for (const [, prop, valor] of corpo.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)) {
      if (prop === undefined || valor === undefined || prop.startsWith('--')) continue;
      const limpo = valor.replace(/var\([^)]*\)/g, ' ').replace(/url\([^)]*\)/g, ' ').replace(/"[^"]*"|'[^']*'/g, ' ');
      for (const palavra of limpo.toLowerCase().match(/[a-z][a-z-]*/g) ?? []) if (CORES_NOMEADAS.has(palavra)) out.push(`${prop}: ${palavra}`);
    }
  }
  return out;
}

// Cor literal de qualquer forma (hex, rgb/rgba, hsl/hsla ou nomeada) num trecho de CSS sem comentarios.
const temCorLiteral = (css: string) => /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(stripComments(css)) || coresNomeadasEm(css).length > 0;

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

// Fim do bloco que contem `desde` (indice da "}" que o fecha), ignorando comentarios: uma "}" solta dentro de um comentario nao encerra o bloco.
function fimDoBloco(css: string, desde: number): number {
  let profundidade = 1;
  for (let i = desde; i < css.length; i++) {
    if (css.startsWith('/*', i)) {
      const fimComentario = css.indexOf('*/', i + 2);
      if (fimComentario < 0) break;
      i = fimComentario + 1;
    } else if (css[i] === '{') profundidade++;
    else if (css[i] === '}' && --profundidade === 0) return i;
  }
  return css.length;
}

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

  it('F13-H: o item da grade e um <a class="fc-item">; `.fc-pagina .fc-item` (par C) zera o sublinhado, senao o `a:hover` global sublinha nome e fonte', () => {
    const bruto = regiao?.bruto ?? '';
    const parC = stripComments(bruto.slice(bruto.indexOf(abre('C')), bruto.indexOf(fecha('C'))));
    const corpos = [...parC.matchAll(/(?:^|[\s}{])\.fc-pagina \.fc-item\s*\{([^}]*)\}/g)].map((x) => x[1] ?? '');
    expect(corpos).toHaveLength(1);
    expect(corpos[0]).toMatch(/(?:^|;|\s)text-decoration\s*:\s*none\s*(?:;|$)/);
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

  it('todo seletor (cada item da lista) comeca por uma das 2 raizes (`.fc-pagina` ou `.fc-portal`), com ou sem `:root[data-theme="dark"] ` na frente', () => {
    for (const s of seletores) {
      expect(/^(:root\[data-theme="dark"\] )?\.(fc-pagina|fc-portal)( |$|[.:[>+~])/.test(s), s).toBe(true);
      expect(classesDoSeletor(s).some((c) => c === 'fc-pagina' || c === 'fc-portal'), s).toBe(true);
    }
  });

  it('so var(--rf-*) e var(--val); sem !important, cor literal (hex, rgb(a), hsl(a) ou nomeada) nem declaracao de token (alem de --val)', () => {
    const limpo = regiao?.limpo ?? '';
    for (const [, nome] of limpo.matchAll(/var\(\s*(--[\w-]+)/g)) expect(nome === '--val' || (nome ?? '').startsWith('--rf-'), nome).toBe(true);
    expect(limpo).not.toContain('!important');
    expect(limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(coresNomeadasEm(limpo), 'cor nomeada').toEqual([]);
    const declarados = [...limpo.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(declarados.filter((n) => n !== '--val')).toEqual([]);
  });

  it('a raiz `.fc-pagina` vem so do Forecast.tsx (1 vez, no wrapper da pagina) e `fc-portal` so dos 3 componentes de modal que vao para document.body por createPortal (allowlist explicita)', () => {
    expect(forecastTsx.split('className="page fc-pagina"')).toHaveLength(2);
    expect(forecastTsx.split('fc-pagina')).toHaveLength(2);
    const usosPagina = Object.entries(fontes).filter(([caminho, src]) => src.includes('fc-pagina') && !caminho.endsWith('/pages/Forecast.tsx'));
    expect(usosPagina.map(([c]) => c)).toEqual([]);
    const usosPortal = Object.entries(fontes).filter(([, src]) => src.includes('fc-portal')).map(([c]) => c.replace(/^\.\.\//, '/'));
    expect(usosPortal.sort()).toEqual([...ARQUIVOS_PORTAL].sort());
    for (const caminho of ARQUIVOS_PORTAL) {
      const src = Object.entries(fontes).find(([c]) => c.endsWith(caminho))?.[1] ?? '';
      expect(src.split('className="fc-portal"').length - 1, caminho).toBe(1);
    }
  });

  it('todo createPortal de src/pages/Forecast* esta nos 2 arquivos de relatorio e so renderiza modais cuja raiz carrega `fc-portal` (<Modal className="fc-portal">)', () => {
    const portais = Object.entries(fontes).filter(([c, src]) => /\/pages\/Forecast(\.tsx|\/)/.test(c) && src.includes('createPortal(')).map(([c]) => c.replace(/^\.\.\//, '/'));
    expect(portais.sort()).toEqual(['/pages/Forecast/ForecastRelatorioCompras.tsx', '/pages/Forecast/ForecastRelatorioDemandaComercial.tsx']);
    // os 3 modais que esses portais montam: Embalagens e Demanda comercial (componentes proprios) e o <Modal> de fechamento escrito no proprio arquivo
    const demanda = Object.entries(fontes).find(([c]) => c.endsWith('/pages/Forecast/ForecastRelatorioDemandaComercial.tsx'))?.[1] ?? '';
    expect(demanda).toContain('<Modal isOpen onClose={fecharDialogo} title={ROTULO_FECHAMENTO[dialogo.status].titulo} className="fc-portal">');
    for (const arquivo of ['ForecastEmbalagensModal', 'ForecastDemandaComercialModal']) {
      const src = Object.entries(fontes).find(([c]) => c.endsWith(`/pages/Forecast/${arquivo}.tsx`))?.[1] ?? '';
      expect(src, arquivo).toMatch(/<Modal\b[^>]*className="fc-portal"/);
    }
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

  it('os tokens das fixtures `suiteComexTokens.f13b|c|d|e.json` (se houver) existem nos 2 temas e so sao usados DENTRO da regiao `tela F13`', () => {
    const f13 = fixtureUniao().filter((t) => /^suiteComexTokens\.f13[bcde]\.json$/.test(t.arquivo));
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

// ---------- F13-0b: sentinelas de tokens por frente ----------
// Cada frente (B, C, D, E) declara os tokens do SEU par, nos 2 blocos (:root claro e :root[data-theme="dark"]), logo depois da ancora
// "tokens F13 (forecast)"; nenhum par tem token hoje. F13-0c: UMA fixture por frente (evita conflito add/add no merge): a frente X que criar o 1o token do seu par cria
// tambem src/test/fixtures/suiteComexTokens.f13x.json (x = b, c, d ou e minusculo; fonte: "mock", ref = nome do board; o suiteComexTokens.test.ts aceita esses 4 nomes e
// recusa `.f13.json` solto) — sem ela a paridade CSS x fixtures da suiteComexTokens falha. Os tokens da fixture f13x sao EXATAMENTE os do par X (nos 2 blocos); token de um par
// em fixture de outra frente = falha. Ate la nao ha fixture (esta guarda nao a exige com 0 tokens no par). Todo token declarado num par e --rf-fc-* (prefixo unico do Forecast)
// e nenhum --rf-* e declarado fora de um par, na faixa da ancora.
describe('F13-0b: sentinelas de tokens por frente na ancora (nos 2 blocos)', () => {
  const ANCORA = '/* tokens F13 (forecast) */';
  const tAbre = (s: string) => `/* -- tokens F13-${s} >>> -- */`;
  const tFecha = (s: string) => `/* -- <<< tokens F13-${s} -- */`;
  const posicoes = [...rawLf.matchAll(/\/\* tokens F13 \(forecast\) \*\//g)].map((m) => m.index ?? 0);
  // faixa da ancora: da ancora ate o fim do bloco de token (a "}" que fecha o :root; comentarios com "}" nao contam)
  const faixas = posicoes.map((p) => rawLf.slice(p, fimDoBloco(rawLf, p)));
  const nomesBloco = ['claro', 'escuro'];
  const arquivoDe = (s: string) => `suiteComexTokens.f13${s.toLowerCase()}.json`;

  function pares(faixa: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const s of SENTINELAS) out[s] = faixa.slice(faixa.indexOf(tAbre(s)) + tAbre(s).length, faixa.indexOf(tFecha(s)));
    return out;
  }
  const declaracoesDe = (texto: string) => [...stripComments(texto).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? '', (m[2] ?? '').replace(/\s+/g, ' ').trim()] as const);

  it('a ancora tem 1 faixa por bloco (claro e escuro) com os 4 pares B, C, D, E na ordem, cada marcador 1 vez, separados por exatamente 1 linha em branco', () => {
    expect(rawLf.split(ANCORA)).toHaveLength(3);
    expect(faixas).toHaveLength(2);
    faixas.forEach((faixa, i) => {
      const bloco = nomesBloco[i];
      for (const s of SENTINELAS) {
        expect(faixa.split(tAbre(s)), `${bloco}: ${tAbre(s)}`).toHaveLength(2);
        expect(faixa.split(tFecha(s)), `${bloco}: ${tFecha(s)}`).toHaveLength(2);
        expect(faixa.indexOf(tAbre(s)), `${bloco}: ${s}`).toBeLessThan(faixa.indexOf(tFecha(s)));
      }
      const ordem = SENTINELAS.flatMap((s) => [faixa.indexOf(tAbre(s)), faixa.indexOf(tFecha(s))]);
      expect([...ordem].sort((a, b) => a - b), bloco).toEqual(ordem);
      SENTINELAS.slice(1).forEach((s, k) => {
        const anterior = SENTINELAS[k] ?? 'B';
        expect(faixa.slice(faixa.indexOf(tFecha(anterior)) + tFecha(anterior).length, faixa.indexOf(tAbre(s))), `${bloco}: ${anterior} -> ${s}`).toBe('\n\n  ');
      });
    });
  });

  it('os marcadores de token nao se confundem com os da regiao `tela F13` (prefixo "tokens ") e a regiao segue com 4 pares proprios', () => {
    expect((rawLf.match(/\/\* -- tokens F13-[BCDE] >>> -- \*\//g) ?? []).length).toBe(8);
    expect((rawLf.match(/\/\* -- <<< tokens F13-[BCDE] -- \*\//g) ?? []).length).toBe(8);
    expect((rawLf.match(/\/\* -- F13-[BCDE] >>> -- \*\//g) ?? []).length).toBe(4);
    expect((regiao?.bruto ?? '').includes('tokens F13-')).toBe(false);
  });

  it('todo token declarado num par e --rf-fc-*; nenhum --rf-* e declarado na faixa da ancora fora dos pares; so declaracoes (nada de regra) dentro dos pares', () => {
    faixas.forEach((faixa, i) => {
      const bloco = nomesBloco[i];
      const p = pares(faixa);
      for (const s of SENTINELAS) {
        const corpo = stripComments(p[s] ?? '').trim();
        expect(corpo.replace(/--[\w-]+\s*:\s*[^;{}]+;/g, '').trim(), `${bloco} ${s}: so declaracoes de token`).toBe('');
        for (const [nome] of declaracoesDe(p[s] ?? '')) expect(nome, `${bloco} ${s}`).toMatch(/^--rf-fc-[a-z0-9-]+$/);
      }
      let resto = faixa;
      for (const s of SENTINELAS) resto = resto.slice(0, resto.indexOf(tAbre(s))) + resto.slice(resto.indexOf(tFecha(s)) + tFecha(s).length);
      expect(declaracoesDe(resto).filter(([nome]) => nome.startsWith('--rf-')), `${bloco}: --rf-* fora de um par`).toEqual([]);
    });
  });

  it('1 fixture por frente: os tokens do par X (claro) sao exatamente os da fixture f13x, o que so existe no claro e constante, token do escuro tem par no claro do MESMO par; fixture de outra frente nao pode ter token do par X; `.f13.json` solto nao existe', () => {
    const uniao = fixtureUniao();
    // pelos NOMES dos arquivos (uma fixture vazia `[]` tambem conta)
    const arquivosF13 = Object.keys(import.meta.glob('./fixtures/suiteComexTokens*.json')).map((c) => c.replace('./fixtures/', '')).filter((a) => /^suiteComexTokens\.f13/.test(a));
    expect(arquivosF13.filter((a) => !SENTINELAS.some((s) => a === arquivoDe(s))), 'fixture f13 fora de f13b|c|d|e').toEqual([]);
    const [paresClaro, paresEscuro] = faixas.map((faixa) => pares(faixa));
    for (const s of SENTINELAS) {
      const nomesClaro = declaracoesDe(paresClaro?.[s] ?? '').map(([n]) => n);
      const nomesEscuro = declaracoesDe(paresEscuro?.[s] ?? '').map(([n]) => n);
      expect(new Set(nomesClaro).size, `par ${s}: sem repeticao no claro`).toBe(nomesClaro.length);
      expect(new Set(nomesEscuro).size, `par ${s}: sem repeticao no escuro`).toBe(nomesEscuro.length);
      for (const n of nomesEscuro) expect(nomesClaro, `par ${s}: ${n} no escuro sem par no claro`).toContain(n);
      const propria = uniao.filter((t) => t.arquivo === arquivoDe(s));
      if (nomesClaro.length > 0) {
        expect(propria.map((t) => t.token).sort(), `par ${s}: fixture ${arquivoDe(s)} = tokens do par`).toEqual([...nomesClaro].sort());
        for (const t of propria) expect(t.constante, `${s}: ${t.token}`).toBe(!nomesEscuro.includes(t.token));
      } else {
        expect(propria, `par ${s} vazio: sem fixture ${arquivoDe(s)}`).toEqual([]);
      }
      const alheias = uniao.filter((t) => t.arquivo !== arquivoDe(s) && /^suiteComexTokens\.f13[bcde]\.json$/.test(t.arquivo)).map((t) => t.token);
      for (const n of nomesClaro) expect(alheias, `par ${s}: ${n} em fixture de outra frente`).not.toContain(n);
    }
  });

  it('nenhuma cor literal (hex, rgb(a), hsl(a) ou nomeada) na faixa da ancora fora de uma declaracao de token (so os valores dos tokens dos pares podem ter cor)', () => {
    faixas.forEach((faixa, i) => {
      const resto = stripComments(faixa).replace(/--[\w-]+\s*:\s*[^;]+;/g, '');
      expect(temCorLiteral(resto), nomesBloco[i]).toBe(false);
    });
  });

  it('um `}` solto dentro de comentario nao encerra o bloco da ancora nem confunde as guardas (a faixa vai ate a `}` real do :root)', () => {
    const base = ':root {\n  /* tokens F13 (forecast) */\n  /* um } solto no comentario */\n  --a: 1;\n}\n:root[data-theme="dark"] {\n  --b: 2;\n}\n';
    const p = base.indexOf('/* tokens F13');
    expect(base.slice(p, fimDoBloco(base, p)).includes('--a: 1;')).toBe(true);
    expect(base.slice(p, fimDoBloco(base, p)).includes('data-theme')).toBe(false);
  });

  it('cor nomeada: o detector pega `color: red`, `background: white`, `border: 1px solid Tan` e ignora var(), strings, transparent e currentColor', () => {
    expect(coresNomeadasEm('.fc-pagina .a { color: red; }')).toEqual(['color: red']);
    expect(coresNomeadasEm('.fc-pagina .a { background: WHITE; border: 1px solid Tan; }')).toEqual(['background: white', 'border: tan']);
    expect(coresNomeadasEm('.fc-pagina .a { color: var(--rf-ink); outline: 2px solid transparent; border-color: currentColor; content: "red"; white-space: nowrap; }')).toEqual([]);
    expect(temCorLiteral('.fc-pagina .a { color: var(--rf-ink); }')).toBe(false);
    expect(temCorLiteral('.fc-pagina .a { color: #fff; }')).toBe(true);
  });
});
