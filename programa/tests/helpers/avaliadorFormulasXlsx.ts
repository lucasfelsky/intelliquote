// Avaliador de formulas de TESTE para o XLSX da aba FORECAST (MACRO). Cobre EXATAMENTE o subconjunto que o gerador
// escreve (SUM, SUMIF, SUMIFS, COUNTIF, VLOOKUP exato, IF, IFERROR, DATE, SUBSTITUTE, aritmetica e comparacoes) e o
// escape `~` de curinga nos criterios; qualquer outra coisa LANCA erro, para o teste falhar alto em vez de imitar o Excel pela metade. O resultado gravado em cache nas
// celulas e IGNORADO: o que vale e a formula. Nao e codigo de producao (nao entra no build).
import type exceljs from 'exceljs';

export type ResultadoAvaliador = number | string | null | { erro: string };

class ErroXl {
  constructor(readonly erro: string) {}
}

type Escalar = number | string | boolean | null | ErroXl;

interface Intervalo {
  intervalo: true;
  aba: string;
  c1: number;
  r1: number;
  c2: number;
  r2: number; // Infinity = coluna inteira
}

type Valor = Escalar | Intervalo;

type No =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; aba: string | null; c: number; r: number }
  | { t: 'rng'; aba: string | null; c1: number; r1: number; c2: number; r2: number }
  | { t: 'fn'; nome: string; args: No[] }
  | { t: 'bin'; op: string; a: No; b: No }
  | { t: 'neg'; a: No };

// ---- Tokens ----
type Token = { k: 'num' | 'str' | 'ref' | 'fn' | 'op'; v: string };

const PREFIXO = "(?:(?:'(?:[^']|'')+'|[A-Za-z0-9_]+)!)?";
const CELULA = '\\$?[A-Z]{1,3}\\$?\\d+';
const COLUNA = '\\$?[A-Z]{1,3}';
const RE_REF = new RegExp(`^(${PREFIXO})(${CELULA}(?::${CELULA})?|${COLUNA}:${COLUNA})`);
const RE_FUNC = /^([A-Za-z][A-Za-z0-9.]*)\(/;
const RE_STR = /^"((?:[^"]|"")*)"/;
const RE_NUM = /^\d+(?:\.\d+)?/;
const RE_OP = /^(<=|>=|<>|[+\-*/=<>(),])/;

function tokenizar(formula: string): Token[] {
  const tokens: Token[] = [];
  let resto = formula;
  while (resto.length > 0) {
    const espaco = /^\s+/.exec(resto);
    if (espaco) {
      resto = resto.slice(espaco[0].length);
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = RE_STR.exec(resto))) {
      tokens.push({ k: 'str', v: m[1].replace(/""/g, '"') });
    } else if ((m = RE_FUNC.exec(resto))) {
      tokens.push({ k: 'fn', v: m[1].toUpperCase() });
      resto = resto.slice(m[1].length); // mantem o '(' para o proximo token
      continue;
    } else if ((m = RE_REF.exec(resto))) {
      tokens.push({ k: 'ref', v: m[0] });
    } else if ((m = RE_NUM.exec(resto))) {
      tokens.push({ k: 'num', v: m[0] });
    } else if ((m = RE_OP.exec(resto))) {
      tokens.push({ k: 'op', v: m[0] });
    } else {
      throw new Error(`Token nao suportado em "${formula}" perto de "${resto.slice(0, 20)}"`);
    }
    resto = resto.slice(m[0].length);
  }
  return tokens;
}

function numeroDaColuna(letras: string): number {
  let n = 0;
  for (const ch of letras.replace('$', '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseRef(texto: string): No {
  const bang = texto.lastIndexOf('!');
  let aba: string | null = null;
  let corpo = texto;
  if (bang >= 0) {
    aba = texto.slice(0, bang);
    corpo = texto.slice(bang + 1);
    if (aba.startsWith("'")) aba = aba.slice(1, -1).replace(/''/g, "'");
  }
  const partes = corpo.replace(/\$/g, '').split(':');
  const celula = (p: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(p);
    return m ? { c: numeroDaColuna(m[1]), r: Number(m[2]) } : null;
  };
  if (partes.length === 1) {
    const a = celula(partes[0]);
    if (!a) throw new Error(`Referencia invalida: ${texto}`);
    return { t: 'ref', aba, c: a.c, r: a.r };
  }
  const a = celula(partes[0]);
  const b = celula(partes[1]);
  if (a && b) return { t: 'rng', aba, c1: a.c, r1: a.r, c2: b.c, r2: b.r };
  if (/^[A-Z]+$/.test(partes[0]) && /^[A-Z]+$/.test(partes[1])) {
    return { t: 'rng', aba, c1: numeroDaColuna(partes[0]), r1: 1, c2: numeroDaColuna(partes[1]), r2: Infinity };
  }
  throw new Error(`Referencia invalida: ${texto}`);
}

// ---- Parser (comparacao < + - < * / < unario -) ----
function parse(formula: string): No {
  const tokens = tokenizar(formula);
  let i = 0;
  const olhar = () => tokens[i];
  const consumir = (v?: string): Token => {
    const t = tokens[i++];
    if (!t || (v !== undefined && t.v !== v)) throw new Error(`Formula invalida: "${formula}" (esperado ${v ?? 'token'})`);
    return t;
  };

  function comparacao(): No {
    const a = soma();
    const t = olhar();
    if (t && t.k === 'op' && ['=', '<', '>', '<=', '>=', '<>'].includes(t.v)) {
      i++;
      return { t: 'bin', op: t.v, a, b: soma() };
    }
    return a;
  }
  function soma(): No {
    let a = produto();
    for (let t = olhar(); t && t.k === 'op' && (t.v === '+' || t.v === '-'); t = olhar()) {
      i++;
      a = { t: 'bin', op: t.v, a, b: produto() };
    }
    return a;
  }
  function produto(): No {
    let a = unario();
    for (let t = olhar(); t && t.k === 'op' && (t.v === '*' || t.v === '/'); t = olhar()) {
      i++;
      a = { t: 'bin', op: t.v, a, b: unario() };
    }
    return a;
  }
  function unario(): No {
    const t = olhar();
    if (t && t.k === 'op' && t.v === '-') {
      i++;
      return { t: 'neg', a: unario() };
    }
    return primario();
  }
  function primario(): No {
    const t = consumir();
    switch (t.k) {
      case 'num': return { t: 'num', v: Number(t.v) };
      case 'str': return { t: 'str', v: t.v };
      case 'ref': return parseRef(t.v);
      case 'fn': {
        consumir('(');
        const args: No[] = [];
        if (olhar()?.v !== ')') {
          args.push(comparacao());
          while (olhar()?.v === ',') {
            i++;
            args.push(comparacao());
          }
        }
        consumir(')');
        return { t: 'fn', nome: t.v, args };
      }
      default:
        if (t.v === '(') {
          const dentro = comparacao();
          consumir(')');
          return dentro;
        }
        throw new Error(`Formula invalida: "${formula}" (token ${t.v})`);
    }
  }

  const no = comparacao();
  if (i !== tokens.length) throw new Error(`Formula invalida: "${formula}" (sobra de tokens)`);
  return no;
}

// ---- Avaliador ----
const SERIE_BASE = Date.UTC(1899, 11, 30);
const RE_NUMERICO = /^-?\d+(\.\d+)?$/;

const eIntervalo = (v: Valor): v is Intervalo => typeof v === 'object' && v !== null && 'intervalo' in v;

function aritmetico(v: Valor): number | ErroXl {
  if (eIntervalo(v)) throw new Error('Intervalo usado como valor escalar');
  if (v instanceof ErroXl) return v;
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return new ErroXl('#VALUE!');
}

export function criarAvaliador(wb: exceljs.Workbook): {
  valor(aba: string, ref: string): ResultadoAvaliador;
} {
  const memo = new Map<string, Escalar>();
  const emAvaliacao = new Set<string>();
  const colunas = new Map<string, Escalar[]>();
  const indices = new Map<string, Map<string, number[]>>();

  const planilha = (aba: string) => {
    const ws = wb.getWorksheet(aba);
    if (!ws) throw new Error(`Aba inexistente: ${aba}`);
    return ws;
  };

  function celula(aba: string, c: number, r: number): Escalar {
    const chave = `${aba}!${c}:${r}`;
    if (memo.has(chave)) return memo.get(chave) as Escalar;
    const ws = planilha(aba);
    const cru = ws.findRow(r)?.findCell(c)?.value as unknown;
    let resultado: Escalar;
    if (cru === null || cru === undefined) {
      resultado = null;
    } else if (typeof cru === 'number' || typeof cru === 'string' || typeof cru === 'boolean') {
      resultado = cru;
    } else if (cru instanceof Date) {
      resultado = (cru.getTime() - SERIE_BASE) / 86400000;
    } else if (typeof cru === 'object') {
      const o = cru as Record<string, unknown>;
      if ('sharedFormula' in o) throw new Error(`Formula compartilhada nao suportada em ${aba}!${c}:${r}`);
      if (typeof o.formula === 'string') {
        if (emAvaliacao.has(chave)) throw new Error(`Referencia circular em ${aba}!${c}:${r}`);
        emAvaliacao.add(chave);
        const v = avaliar(parse(o.formula), aba);
        emAvaliacao.delete(chave);
        if (eIntervalo(v)) throw new Error(`Formula devolve intervalo em ${aba}!${c}:${r}`);
        resultado = v;
      } else if ('richText' in o) {
        resultado = (o.richText as Array<{ text: string }>).map((t) => t.text).join('');
      } else if (typeof o.error === 'string') {
        resultado = new ErroXl(o.error);
      } else {
        throw new Error(`Valor de celula nao suportado em ${aba}!${c}:${r}`);
      }
    } else {
      throw new Error(`Valor de celula nao suportado em ${aba}!${c}:${r}`);
    }
    memo.set(chave, resultado);
    return resultado;
  }

  const limiteLinha = (iv: Intervalo) => Math.min(iv.r2, planilha(iv.aba).rowCount);

  function colunaDoIntervalo(iv: Intervalo, c: number): Escalar[] {
    const chave = `${iv.aba}|${c}|${iv.r1}|${limiteLinha(iv)}`;
    let col = colunas.get(chave);
    if (!col) {
      col = [];
      for (let r = iv.r1; r <= limiteLinha(iv); r++) col.push(celula(iv.aba, c, r));
      colunas.set(chave, col);
    }
    return col;
  }

  function indiceDaColuna(iv: Intervalo): Map<string, number[]> {
    const chave = `${iv.aba}|${iv.c1}|${iv.r1}|${limiteLinha(iv)}`;
    let idx = indices.get(chave);
    if (!idx) {
      idx = new Map();
      const add = (k: string, i: number) => {
        const lista = idx!.get(k);
        if (lista) lista.push(i);
        else idx!.set(k, [i]);
      };
      colunaDoIntervalo(iv, iv.c1).forEach((v, i) => {
        if (typeof v === 'number') {
          add(`n:${v}`, i);
          add(`v:${v}`, i); // so numero de verdade (criterio vazio)
        }
        else if (typeof v === 'string') {
          add(`t:${v.toLowerCase()}`, i);
          if (RE_NUMERICO.test(v)) add(`n:${Number(v)}`, i);
        }
      });
      indices.set(chave, idx);
    }
    return idx;
  }

  function umaColuna(v: Valor, nome: string): Intervalo {
    if (!eIntervalo(v)) throw new Error(`${nome}: esperava intervalo`);
    if (v.c1 !== v.c2) throw new Error(`${nome}: esperava intervalo de uma coluna`);
    return v;
  }

  // Texto literal de um criterio com escape: ~* ~? ~~ viram o caractere; null = curinga de verdade (* ou ? sem escape).
  function literalDoCriterio(s: string): string | null {
    let saida = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '~') {
        const prox = s[i + 1];
        if (prox !== '*' && prox !== '?' && prox !== '~') throw new Error(`Criterio com til sem curinga nao suportado: "${s}"`);
        saida += prox;
        i++;
      } else if (c === '*' || c === '?') {
        return null;
      } else {
        saida += c;
      }
    }
    return saida;
  }

  // Posicoes (dentro do intervalo) cujas celulas casam com o criterio; ErroXl se o criterio for erro.
  function casam(iv: Intervalo, criterio: Valor): number[] | ErroXl {
    if (eIntervalo(criterio)) throw new Error('Criterio como intervalo nao suportado');
    if (criterio instanceof ErroXl) return criterio;
    const idx = indiceDaColuna(iv);
    if (criterio === null) return idx.get('v:0') ?? [];
    if (typeof criterio === 'boolean') throw new Error('Criterio booleano nao suportado');
    if (typeof criterio === 'number') return idx.get(`n:${criterio}`) ?? [];
    if (criterio === '' || /^[<>=]/.test(criterio)) {
      throw new Error(`Criterio nao suportado (operador/vazio): "${criterio}"`);
    }
    const literal = literalDoCriterio(criterio);
    if (literal === null) throw new Error(`Criterio nao suportado (curinga sem escape): "${criterio}"`);
    const achados = new Set(idx.get(`t:${literal.toLowerCase()}`) ?? []);
    if (RE_NUMERICO.test(literal)) for (const i of idx.get(`n:${Number(literal)}`) ?? []) achados.add(i);
    return [...achados];
  }

  function somarCelulas(valores: Escalar[]): number | ErroXl {
    let total = 0;
    for (const v of valores) {
      if (v instanceof ErroXl) return v;
      if (typeof v === 'number') total += v;
    }
    return total;
  }

  function funcao(nome: string, args: No[], aba: string): Valor {
    const arg = (n: number): Valor => {
      if (!args[n]) throw new Error(`${nome}: argumento ${n + 1} ausente`);
      return avaliar(args[n], aba);
    };
    switch (nome) {
      case 'SUM': {
        let total = 0;
        for (const a of args) {
          const v = avaliar(a, aba);
          if (eIntervalo(v)) {
            const partes: Escalar[] = [];
            for (let c = v.c1; c <= v.c2; c++) partes.push(...colunaDoIntervalo(v, c));
            const s = somarCelulas(partes);
            if (s instanceof ErroXl) return s;
            total += s;
          } else if (v instanceof ErroXl) {
            return v;
          } else if (v === null) {
            continue;
          } else if (typeof v === 'number') {
            total += v;
          } else if (typeof v === 'boolean') {
            total += v ? 1 : 0;
          } else {
            throw new Error('SUM: texto escalar nao suportado');
          }
        }
        return total;
      }
      case 'SUMIF': {
        if (args.length !== 3) throw new Error('SUMIF: esperava 3 argumentos');
        const criterios = umaColuna(arg(0), 'SUMIF');
        const soma = umaColuna(arg(2), 'SUMIF');
        const achados = casam(criterios, arg(1));
        if (achados instanceof ErroXl) return achados;
        const valores = colunaDoIntervalo(soma, soma.c1);
        return somarCelulas(achados.map((i) => valores[i] ?? null));
      }
      case 'SUMIFS': {
        if (args.length < 3 || args.length % 2 === 0) throw new Error('SUMIFS: argumentos invalidos');
        const soma = umaColuna(arg(0), 'SUMIFS');
        let comum: Set<number> | null = null;
        for (let a = 1; a < args.length; a += 2) {
          const iv = umaColuna(arg(a), 'SUMIFS');
          const achados = casam(iv, arg(a + 1));
          if (achados instanceof ErroXl) return achados;
          comum = comum ? new Set(achados.filter((i) => comum!.has(i))) : new Set(achados);
        }
        const valores = colunaDoIntervalo(soma, soma.c1);
        return somarCelulas([...(comum ?? [])].map((i) => valores[i] ?? null));
      }
      case 'COUNTIF': {
        if (args.length !== 2) throw new Error('COUNTIF: esperava 2 argumentos');
        const achados = casam(umaColuna(arg(0), 'COUNTIF'), arg(1));
        return achados instanceof ErroXl ? achados : achados.length;
      }
      case 'VLOOKUP': {
        if (args.length !== 4) throw new Error('VLOOKUP: esperava 4 argumentos');
        const procurado = arg(0);
        const tabela = arg(1);
        const col = arg(2);
        const modo = arg(3);
        if (!eIntervalo(tabela)) throw new Error('VLOOKUP: tabela deve ser intervalo');
        if (typeof col !== 'number' || (modo !== 0 && modo !== false)) {
          throw new Error('VLOOKUP: so busca exata com coluna numerica');
        }
        if (eIntervalo(procurado)) throw new Error('VLOOKUP: valor procurado como intervalo');
        if (procurado instanceof ErroXl) return procurado;
        if (procurado === null || procurado === '') return new ErroXl('#N/A');
        if (typeof procurado === 'boolean') throw new Error('VLOOKUP: valor booleano nao suportado');
        let literal: string | null = null;
        if (typeof procurado === 'string') {
          literal = literalDoCriterio(procurado);
          if (literal === null) throw new Error(`VLOOKUP: curinga nao suportado: "${procurado}"`);
        }
        const idx = indiceDaColuna({ ...tabela, c2: tabela.c1 });
        const chave = typeof procurado === 'number' ? `n:${procurado}` : `t:${(literal ?? '').toLowerCase()}`;
        const primeira = idx.get(chave)?.[0];
        if (primeira === undefined) return new ErroXl('#N/A');
        const v = celula(tabela.aba, tabela.c1 + col - 1, tabela.r1 + primeira);
        return v === null ? 0 : v;
      }
      case 'SUBSTITUTE': {
        if (args.length !== 3) throw new Error('SUBSTITUTE: esperava 3 argumentos');
        const bruto = arg(0);
        if (eIntervalo(bruto)) throw new Error('SUBSTITUTE: texto como intervalo');
        if (bruto instanceof ErroXl) return bruto;
        if (typeof bruto === 'boolean') throw new Error('SUBSTITUTE: booleano nao suportado');
        const texto = bruto === null ? '' : String(bruto);
        const velho = arg(1);
        const novo = arg(2);
        if (typeof velho !== 'string' || typeof novo !== 'string') throw new Error('SUBSTITUTE: old/new devem ser texto');
        if (velho === '') throw new Error('SUBSTITUTE: old vazio nao suportado');
        return texto.split(velho).join(novo);
      }
      case 'IF': {
        const cond = arg(0);
        if (eIntervalo(cond)) throw new Error('IF: condicao como intervalo');
        if (cond instanceof ErroXl) return cond;
        if (typeof cond === 'string') throw new Error('IF: condicao de texto nao suportada');
        const verdadeiro = cond === null ? false : cond === true || (typeof cond === 'number' && cond !== 0);
        if (verdadeiro) return arg(1);
        return args.length > 2 ? arg(2) : false;
      }
      case 'IFERROR': {
        const v = arg(0);
        return v instanceof ErroXl ? arg(1) : v;
      }
      case 'DATE': {
        const [a, m, d] = [0, 1, 2].map((n) => aritmetico(arg(n)));
        for (const x of [a, m, d]) if (x instanceof ErroXl) return x;
        return (Date.UTC(a as number, (m as number) - 1, d as number) - SERIE_BASE) / 86400000;
      }
      default:
        throw new Error(`Funcao nao suportada: ${nome}`);
    }
  }

  function avaliar(no: No, aba: string): Valor {
    switch (no.t) {
      case 'num': return no.v;
      case 'str': return no.v;
      case 'ref': return celula(no.aba ?? aba, no.c, no.r);
      case 'rng': return { intervalo: true, aba: no.aba ?? aba, c1: no.c1, r1: no.r1, c2: no.c2, r2: no.r2 };
      case 'fn': return funcao(no.nome, no.args, aba);
      case 'neg': {
        const v = aritmetico(avaliar(no.a, aba));
        return v instanceof ErroXl ? v : -v;
      }
      case 'bin': {
        const a = avaliar(no.a, aba);
        const b = avaliar(no.b, aba);
        if (['=', '<', '>', '<=', '>=', '<>'].includes(no.op)) return comparar(no.op, a, b);
        const x = aritmetico(a);
        if (x instanceof ErroXl) return x;
        const y = aritmetico(b);
        if (y instanceof ErroXl) return y;
        switch (no.op) {
          case '+': return x + y;
          case '-': return x - y;
          case '*': return x * y;
          default: return y === 0 ? new ErroXl('#DIV/0!') : x / y;
        }
      }
    }
  }

  function comparar(op: string, a: Valor, b: Valor): Escalar {
    if (eIntervalo(a) || eIntervalo(b)) throw new Error('Comparacao com intervalo');
    if (a instanceof ErroXl) return a;
    if (b instanceof ErroXl) return b;
    if (typeof a === 'string' && typeof b === 'string') {
      const [x, y] = [a.toLowerCase(), b.toLowerCase()];
      return resolverComparacao(op, x < y ? -1 : x > y ? 1 : 0);
    }
    if (typeof a === 'string' || typeof b === 'string') throw new Error('Comparacao de texto com numero nao suportada');
    const x = a === null ? 0 : Number(a);
    const y = b === null ? 0 : Number(b);
    return resolverComparacao(op, x < y ? -1 : x > y ? 1 : 0);
  }

  function resolverComparacao(op: string, cmp: number): boolean {
    switch (op) {
      case '=': return cmp === 0;
      case '<': return cmp < 0;
      case '>': return cmp > 0;
      case '<=': return cmp <= 0;
      case '>=': return cmp >= 0;
      default: return cmp !== 0;
    }
  }

  return {
    valor(aba: string, ref: string): ResultadoAvaliador {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m) throw new Error(`Referencia invalida: ${ref}`);
      const v = celula(aba, numeroDaColuna(m[1]), Number(m[2]));
      if (v instanceof ErroXl) return { erro: v.erro };
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v;
    },
  };
}
