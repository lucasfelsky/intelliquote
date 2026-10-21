// Porte de Forecast-prototipo/src/motor/calcular.ts. Mudancas em relacao ao prototipo:
//  - `hoje` e um date key (YYYY-MM-DD) e AP usa aritmetica UTC (sem conversao ISO de data local);
//  - `quinzena` (1 | 2): na 1a quinzena o consumo do mes (AG) e a media trimestral (Q);
//  - `somarChegada5oMes` / PROJECAO_5O_MES_SOMA_CHEGADA: ponto em aberto com o Comex sobre a coluna AL.
import type {
  ColunaConferida,
  Lancamento,
  LancamentoMensal,
  LinhaCalculada,
  Produto,
  Quinzena,
} from './forecastTypes';
import { COLUNAS_CONFERIDAS } from './forecastTypes';
import { somarDias } from './forecastMonths';
import { isValidDateKey } from './supplierDocumentDates';

// PONTO EM ABERTO COM O COMEX: a planilha calcula a projecao do 5o mes (coluna AL; fevereiro na
// quinzena 10-2) como AK - Q, SEM somar a chegada daquele mes (coluna Z). false replica a planilha;
// true faz AL = AK + chegadas[4] - Q. Nao mudar sem resposta do Comex.
export const PROJECAO_5O_MES_SOMA_CHEGADA = false;

// SOMASE / CONT.SE do Excel comparam texto sem diferenciar maiúsculas.
const chave = (codigo: string) => codigo.toUpperCase();

function somaPorCodigo(lancamentos: Lancamento[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const { codigo, qtd } of lancamentos) {
    if (!codigo) continue;
    const k = chave(codigo);
    mapa.set(k, (mapa.get(k) ?? 0) + qtd);
  }
  return mapa;
}

function somaPorCodigoEMes(lancamentos: LancamentoMensal[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const { codigo, qtd, mes } of lancamentos) {
    if (!codigo || !mes) continue;
    const k = chave(codigo) + '|' + mes.toUpperCase();
    mapa.set(k, (mapa.get(k) ?? 0) + qtd);
  }
  return mapa;
}

// Código vazio na linha do produto (EMB.6/EMB.7 sem uso) não soma nada.
const somarCodigos = (codigos: string[], f: (k: string) => number) =>
  codigos.reduce((total, c) => (c ? total + f(chave(c)) : total), 0);

const somar = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export interface OpcoesCalculo {
  hoje: string; // YYYY-MM-DD: base da coluna CHEG. (HOJE() + lead time)
  quinzena?: 1 | 2; // default 2
  somarChegada5oMes?: boolean; // default PROJECAO_5O_MES_SOMA_CHEGADA
}

export function calcular(q: Quinzena, opcoes: OpcoesCalculo): LinhaCalculada[] {
  if (!isValidDateKey(opcoes.hoje)) {
    throw new Error(`Data invalida: ${String(opcoes.hoje)}`);
  }
  const hoje = opcoes.hoje;
  const quinzena = opcoes.quinzena ?? 2;
  const somarChegada5oMes = opcoes.somarChegada5oMes ?? PROJECAO_5O_MES_SOMA_CHEGADA;
  const e = q.entradas;
  const estoque = somaPorCodigo(e.estoque);
  const vendasMes = somaPorCodigo(e.vendasMes);
  const vendasAtual = somaPorCodigo(e.vendasAtual);
  const vendasAnual = somaPorCodigo(e.vendasAnual);
  const chegadas = somaPorCodigoEMes(e.chegadas);
  const programacoes = somaPorCodigoEMes(e.programacoes);

  const leadtime = new Map<string, number | null>();
  for (const l of e.leadtime) {
    const k = l.fonte.toUpperCase();
    if (l.fonte && !leadtime.has(k)) leadtime.set(k, l.total ?? 0); // PROCV: primeira ocorrência
  }
  const margem = new Map<string, number>();
  for (const m of e.margem) {
    const k = chave(m.codigo);
    if (m.codigo && !margem.has(k)) margem.set(k, m.margem ?? 0); // PROCX: primeira ocorrência
  }
  const clientes = new Map<string, number>();
  for (const c of e.clientesAtivos) {
    if (!c) continue;
    const k = chave(c);
    clientes.set(k, (clientes.get(k) ?? 0) + 1);
  }

  return q.produtos.map((p) => calcularLinha(p));

  function calcularLinha(p: Produto): LinhaCalculada {
    const cods = p.codigos;
    const [J, K, L, M, N] = p.historico;
    const O = somarCodigos(cods, (k) => vendasMes.get(k) ?? 0);
    const P = somarCodigos(cods, (k) => vendasAtual.get(k) ?? 0);
    const Q = (M + N + O) / 3;
    const R = (J + K + L + M + N + O) / 6;
    const S = somarCodigos(cods, (k) => vendasAnual.get(k) ?? 0) / 11; // dezembro entra só na soma (resposta do Comex)
    const AQ = p.fonte ? leadtime.get(p.fonte.toUpperCase()) ?? null : null;
    const T = AQ === null ? null : (Q / 30) * AQ;
    const U = somarCodigos(cods, (k) => estoque.get(k) ?? 0);
    const cheg = q.mesesChegada.map((mes) =>
      somarCodigos(cods, (k) => chegadas.get(k + '|' + mes.toUpperCase()) ?? 0),
    );
    const prog = q.mesesProgramacao.map((mes) =>
      somarCodigos(cods, (k) => programacoes.get(k + '|' + mes.toUpperCase()) ?? 0),
    );
    const AA = Q === 0 ? '0' : (U + somar(cheg)) / Q;
    // 1a quinzena: o consumo do mes e a media (regra do Comex). 2a: maior entre Q e P (planilha).
    const AG = quinzena === 1 ? Q : Q < P ? P : Q;

    // Projeção do estoque no fim de cada mês. A falta acumula para o mês seguinte.
    const AH = U + cheg[0] - prog[0] - AG;
    const AI = AH + cheg[1] - Q - prog[1];
    const AJ = AI + cheg[2] - Q - prog[2];
    const AK = AJ + cheg[3] - Q - prog[3];
    // Por padrao a planilha nao soma a chegada do 5o mes (coluna Z) aqui; ver PROJECAO_5O_MES_SOMA_CHEGADA.
    const AL = (somarChegada5oMes ? AK + cheg[4] : AK) - Q;
    const AM = AL - Q;

    const AN = T === null ? null : U + somar(cheg) - T - Q - somar(prog);

    const AP = AQ === null ? null : somarDias(hoje, AQ);

    let AR: number | string = '';
    for (const c of cods) {
      if (c && margem.has(chave(c))) {
        AR = margem.get(chave(c))!;
        break;
      }
    }

    const AS = somarCodigos(cods, (k) => clientes.get(k) ?? 0);

    return {
      linha: p.linha, O, P, Q, R, S, T, U, chegadas: cheg, AA,
      programacoes: prog, AG, projecao: [AH, AI, AJ, AK, AL, AM], AN, AQ, AP, AR, AS,
    };
  }
}

// Valor calculado para uma coluna da planilha.
export function valorDaColuna(l: LinhaCalculada, col: ColunaConferida): number | string | null {
  switch (col) {
    case 'V': case 'W': case 'X': case 'Y': case 'Z':
      return l.chegadas['VWXYZ'.indexOf(col)];
    case 'AC': return l.programacoes[0];
    case 'AD': return l.programacoes[1];
    case 'AE': return l.programacoes[2];
    case 'AF': return l.programacoes[3];
    case 'AH': case 'AI': case 'AJ': case 'AK': case 'AL': case 'AM':
      return l.projecao[['AH', 'AI', 'AJ', 'AK', 'AL', 'AM'].indexOf(col)];
    default:
      return (l as unknown as Record<string, number | string | null>)[col];
  }
}

export interface Divergencia {
  linha: number;
  item: string;
  coluna: ColunaConferida;
  esperado: number | string | null;
  calculado: number | string | null;
}

export interface ResultadoConferencia {
  celulas: number;
  batem: number;
  porColuna: Record<string, { celulas: number; batem: number }>;
  divergencias: Divergencia[];
}

function iguais(a: number | string | null, b: number | string | null, col: ColunaConferida): boolean {
  // Na margem (AR), o arquivo grava 0 e "" do mesmo jeito para o leitor de .xlsx:
  // sem margem cadastrada e margem 0 ficam indistinguíveis na leitura.
  const vazio = (x: number | string | null) => x === null || x === '' || (col === 'AR' && x === 0);
  const na = vazio(a) ? null : a;
  const nb = vazio(b) ? null : b;
  if (typeof na === 'number' && typeof nb === 'number') {
    return Math.abs(na - nb) <= 1e-6 * Math.max(1, Math.abs(na), Math.abs(nb));
  }
  return String(na) === String(nb);
}

export function conferir(q: Quinzena, linhas: LinhaCalculada[]): ResultadoConferencia {
  const res: ResultadoConferencia = { celulas: 0, batem: 0, porColuna: {}, divergencias: [] };
  const porLinha = new Map(q.produtos.map((p) => [p.linha, p]));
  for (const l of linhas) {
    const esperado = q.esperado[String(l.linha)];
    if (!esperado) continue;
    for (const col of COLUNAS_CONFERIDAS) {
      if (!(col in esperado)) continue;
      const calc = valorDaColuna(l, col);
      const exp = esperado[col];
      const ok = iguais(calc, exp, col);
      const pc = (res.porColuna[col] ??= { celulas: 0, batem: 0 });
      pc.celulas++;
      res.celulas++;
      if (ok) {
        pc.batem++;
        res.batem++;
      } else {
        res.divergencias.push({ linha: l.linha, item: porLinha.get(l.linha)?.item ?? '', coluna: col, esperado: exp, calculado: calc });
      }
    }
  }
  return res;
}
