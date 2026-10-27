// Forecast preditivo (P1b-1): CLI local da referencia, PURO (mesmo contrato dos CLIs anteriores: dependencias injetadas, nunca
// escreve em disco, devolve { codigo, saida, erro }). Codigos: 0 ok | 1 erro inesperado | 2 entrada/opcao invalida ou caminho recusado.
// --relatorio p0|p1 delegam ao executarCliP1 com o argv ORIGINAL (saida byte a byte da P1a; so a versao muda). --relatorio p1b
// roda o backtest da referencia; --gerar-calibracao troca o relatorio pela tabela de calibracao (JSON, so agregados).
import { rodarBacktestRef, tabelaDoBacktest, validarOpcoesBacktestRef } from './forecastPreditivoBacktestRef';
import type { OpcoesBacktestRef } from './forecastPreditivoBacktestRef';
import { carregarSeries } from './forecastPreditivoCli';
import type { DependenciasCli } from './forecastPreditivoCli';
import { interpretarArgumentosP1, executarCliP1 } from './forecastPreditivoCliP1';
import { PARAMETROS_CORRECAO_PADRAO, PREDITIVO_CONFIG_REF } from './forecastPreditivoConfigRef';
import { marcasDaEntrada, prepararSeriesRef } from './forecastPreditivoMarcas';
import { relatorioJsonRef, relatorioTextoRef, tabelaJson } from './forecastPreditivoRelatorioRef';

export interface OpcoesCliRef {
  entrada?: string;
  quinzena?: string;
  formato: 'texto' | 'json';
  detalhe: boolean;
  gerarCalibracao: boolean;
  correcaoNivel: boolean;
  backtest: OpcoesBacktestRef;
}

export type InterpretacaoRef =
  | { ok: true; modo: 'delegar' } // p0/p1: argv INTACTO ao executarCliP1
  | { ok: true; modo: 'p1b'; opcoes: OpcoesCliRef }
  | { ok: false; erro: string };

const PROPRIAS_P1 = ['--relatorio', '--teto-vies', '--metodos']; // as 3 flags que o parser da P1a separa
const COM_VALOR_REF = ['--historico-max', '--correcao-nivel'];
const SEM_VALOR_REF = ['--gerar-calibracao'];
const RELATORIOS = ['p0', 'p1', 'p1b'];

export function interpretarArgumentosRef(argv: string[]): InterpretacaoRef {
  // 1. mesmo laco da P1a para as flags proprias dela (mesmas mensagens, na mesma ordem)
  const proprias = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!PROPRIAS_P1.includes(a)) continue;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { ok: false, erro: `faltou o valor de ${a}` };
    if (proprias.has(a)) return { ok: false, erro: `argumento repetido: ${a}` };
    proprias.set(a, v);
    i++;
  }
  const relatorio = proprias.get('--relatorio') ?? 'p1';
  if (!RELATORIOS.includes(relatorio)) return { ok: false, erro: '--relatorio deve ser p0, p1 ou p1b' };
  // 2. flags proprias da P1b com p0/p1
  if (relatorio !== 'p1b') {
    const intrusa = argv.find((a) => COM_VALOR_REF.includes(a) || SEM_VALOR_REF.includes(a));
    if (intrusa !== undefined) return { ok: false, erro: `${intrusa} so vale com --relatorio p1b` };
    return { ok: true, modo: 'delegar' };
  }
  if (proprias.has('--metodos')) return { ok: false, erro: '--metodos nao vale com --relatorio p1b' };

  // 3. p1b: tira `--relatorio p1b` e as flags proprias; o resto vai ao parser da P1a
  const valores = new Map<string, string>();
  let gerarCalibracao = false;
  const resto: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--relatorio') {
      i++;
    } else if (COM_VALOR_REF.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { ok: false, erro: `faltou o valor de ${a}` };
      if (valores.has(a)) return { ok: false, erro: `argumento repetido: ${a}` };
      valores.set(a, v);
      i++;
    } else if (SEM_VALOR_REF.includes(a)) {
      if (gerarCalibracao) return { ok: false, erro: `argumento repetido: ${a}` };
      gerarCalibracao = true;
    } else resto.push(a);
  }
  const texto = valores.get('--historico-max');
  let historicoMaximo: number | null = null;
  if (texto !== undefined && texto !== 'tudo') {
    const n = /^\d+$/.test(texto) ? Number(texto) : NaN;
    if (!(Number.isInteger(n) && n >= 1 && n <= PREDITIVO_CONFIG_REF.historicoMaximoLimite)) return { ok: false, erro: '--historico-max deve ser um inteiro de 1 a 240 ou tudo' };
    historicoMaximo = n;
  }
  const modo = valores.get('--correcao-nivel');
  if (modo !== undefined && modo !== 'sim' && modo !== 'nao') return { ok: false, erro: '--correcao-nivel deve ser sim ou nao' };
  if (modo !== undefined && !gerarCalibracao) return { ok: false, erro: '--correcao-nivel so vale com --gerar-calibracao' };
  if (gerarCalibracao && resto.includes('--detalhe')) return { ok: false, erro: '--gerar-calibracao nao vale com --detalhe' };

  const base = interpretarArgumentosP1(resto);
  if (!base.ok) return base;
  const { horizonte, minTreino, leadTimePadraoDias, razaoFaltaExcesso, usarMascara, tetoVies } = base.opcoes.backtest;
  const backtest: OpcoesBacktestRef = { horizonte, minTreino, leadTimePadraoDias, razaoFaltaExcesso, usarMascara, tetoVies, historicoMaximo, parametrosCorrecao: PARAMETROS_CORRECAO_PADRAO };
  const erros = validarOpcoesBacktestRef(backtest);
  if (erros.length > 0) return { ok: false, erro: 'opcoes invalidas: ' + erros.join('; ') };
  const { entrada, quinzena, formato, detalhe } = base.opcoes;
  const correcaoNivel = modo === undefined ? PREDITIVO_CONFIG_REF.correcaoNivel.ativaPorPadrao : modo === 'sim';
  return { ok: true, modo: 'p1b', opcoes: { entrada, quinzena, formato, detalhe, gerarCalibracao, correcaoNivel, backtest } };
}

const resposta = (codigo: 0 | 1 | 2, saida: string, erro: string) => ({ codigo, saida, erro: erro === '' ? '' : erro + '\n' });

export function executarCliRef(argv: string[], deps: DependenciasCli): { codigo: 0 | 1 | 2; saida: string; erro: string } {
  try {
    const args = interpretarArgumentosRef(argv);
    if (!args.ok) return resposta(2, '', args.erro);
    if (args.modo === 'delegar') return executarCliP1(argv, deps);
    const { opcoes } = args;
    const carga = carregarSeries(opcoes, deps);
    if (!carga.ok) return resposta(2, '', carga.erro);
    // a coluna `atipico` da entrada faz o papel de ForecastAtypicalMonth; `ruptura` e ignorada (volta com o D7)
    const prep = prepararSeriesRef(carga.entradas, marcasDaEntrada(carga.entradas), opcoes.backtest.usarMascara);
    const r = rodarBacktestRef(prep.series, opcoes.backtest, prep.marcas);
    if (opcoes.gerarCalibracao) return resposta(0, tabelaJson(tabelaDoBacktest(r, opcoes.correcaoNivel)), '');
    const o = { detalhe: opcoes.detalhe, linhasRejeitadas: carga.rejeitadas, rupturaIgnorada: prep.rupturaIgnorada, atipicoDaEntradaIgnorado: prep.atipicoDaEntradaIgnorado };
    return resposta(0, opcoes.formato === 'json' ? relatorioJsonRef(r, o) : relatorioTextoRef(r, o), '');
  } catch (e) {
    return resposta(1, '', `erro inesperado (${e instanceof Error ? e.name : 'desconhecido'})`);
  }
}
