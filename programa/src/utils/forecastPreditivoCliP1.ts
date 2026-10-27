// Forecast preditivo (P1a): CLI local P1, PURO (mesmo contrato do CLI da fase 0: dependencias injetadas, nunca escreve em
// disco, devolve { codigo, saida, erro }). Codigos: 0 ok | 1 erro inesperado | 2 entrada/opcao invalida ou caminho recusado.
// Flags novas: --relatorio p0|p1 (padrao p1) e --teto-vies <0..1>|sem (padrao sem: criterio 3
// relativo puro; um numero soma o teto absoluto |vies| <= teto). O modo p0 delega ao executarCli da fase 0
// (saida byte a byte; so a versao muda).
import { rodarBacktestP1, validarOpcoesBacktestP1 } from './forecastPreditivoBacktestP1';
import type { OpcoesBacktestP1 } from './forecastPreditivoBacktestP1';
import { carregarSeries, executarCli, interpretarArgumentos } from './forecastPreditivoCli';
import type { DependenciasCli } from './forecastPreditivoCli';
import { PREDITIVO_CONFIG_P1 } from './forecastPreditivoConfigP1';
import { relatorioJsonP1, relatorioTextoP1 } from './forecastPreditivoRelatorioP1';
import { METODO_TODOS_IDS } from './forecastPreditivoTipos';
import type { MetodoTodosId } from './forecastPreditivoTipos';

export interface OpcoesCliP1 {
  relatorio: 'p0' | 'p1';
  argvP0: string[]; // p0: argv sem o par --relatorio (vai inteiro para o executarCli da fase 0)
  entrada?: string;
  quinzena?: string;
  formato: 'texto' | 'json';
  detalhe: boolean;
  backtest: OpcoesBacktestP1;
}

const PROPRIAS = ['--relatorio', '--teto-vies', '--metodos'];
const RE_TETO = /^(0|1)([.,]\d+)?$/;

type Interpretacao = { ok: true; opcoes: OpcoesCliP1 } | { ok: false; erro: string };

export function interpretarArgumentosP1(argv: string[]): Interpretacao {
  const proprias = new Map<string, string>();
  const resto: string[] = []; // modo p1: vai ao parser da fase 0, sem as tres flags proprias
  const p0: string[] = []; // modo p0: argv original sem --relatorio/--teto-vies (--metodos fica: o parser da fase 0 o valida)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!PROPRIAS.includes(a)) {
      resto.push(a);
      p0.push(a);
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { ok: false, erro: `faltou o valor de ${a}` };
    if (proprias.has(a)) return { ok: false, erro: `argumento repetido: ${a}` };
    proprias.set(a, v);
    if (a === '--metodos') p0.push(a, v);
    i++;
  }
  const relatorio = proprias.get('--relatorio') ?? 'p1';
  if (relatorio !== 'p0' && relatorio !== 'p1') return { ok: false, erro: '--relatorio deve ser p0 ou p1' };
  const tetoTexto = proprias.get('--teto-vies');
  let tetoVies: number | null = PREDITIVO_CONFIG_P1.criterios.tetoViesPadrao;
  if (tetoTexto !== undefined) {
    if (relatorio === 'p0') return { ok: false, erro: '--teto-vies so vale com --relatorio p1' };
    const valor = Number(tetoTexto.replace(',', '.'));
    if (tetoTexto === 'sem') tetoVies = null;
    else if (RE_TETO.test(tetoTexto) && valor <= 1) tetoVies = valor;
    else return { ok: false, erro: '--teto-vies deve ser um numero de 0 a 1 (ex.: 0,10) ou sem (padrao: sem)' };
  }
  const base = interpretarArgumentos(relatorio === 'p0' ? p0 : resto);
  if (relatorio === 'p0') {
    // validado pelo proprio executarCli da fase 0 (mensagens e codigos identicos); aqui os campos sao so informativos
    const o = base.ok ? base.opcoes : undefined;
    const padrao = { horizonte: 6, minTreino: 6, leadTimePadraoDias: 90, razaoFaltaExcesso: 3, usarMascara: true };
    const backtest: OpcoesBacktestP1 = { ...(o?.backtest ?? padrao), metodos: [...METODO_TODOS_IDS], tetoVies };
    return { ok: true, opcoes: { relatorio, argvP0: p0, entrada: o?.entrada, quinzena: o?.quinzena, formato: o?.formato ?? 'texto', detalhe: o?.detalhe ?? false, backtest } };
  }
  if (!base.ok) return base;
  const texto = proprias.get('--metodos');
  const metodos = (texto === undefined ? [...METODO_TODOS_IDS] : texto.split(',').map((m) => m.trim())) as MetodoTodosId[];
  const backtest: OpcoesBacktestP1 = { ...base.opcoes.backtest, metodos, tetoVies };
  const erros = validarOpcoesBacktestP1(backtest);
  if (erros.length > 0) return { ok: false, erro: 'opcoes invalidas: ' + erros.join('; ') };
  const { entrada, quinzena, formato, detalhe } = base.opcoes;
  return { ok: true, opcoes: { relatorio, argvP0: p0, entrada, quinzena, formato, detalhe, backtest } };
}

const resposta = (codigo: 0 | 1 | 2, saida: string, erro: string) => ({ codigo, saida, erro: erro === '' ? '' : erro + '\n' });

export function executarCliP1(argv: string[], deps: DependenciasCli): { codigo: 0 | 1 | 2; saida: string; erro: string } {
  try {
    const args = interpretarArgumentosP1(argv);
    if (!args.ok) return resposta(2, '', args.erro);
    const { opcoes } = args;
    if (opcoes.relatorio === 'p0') return executarCli(opcoes.argvP0, deps);
    const carga = carregarSeries(opcoes, deps);
    if (!carga.ok) return resposta(2, '', carga.erro);
    const resultado = rodarBacktestP1(carga.series, opcoes.backtest);
    const o = { detalhe: opcoes.detalhe, linhasRejeitadas: carga.rejeitadas };
    return resposta(0, opcoes.formato === 'json' ? relatorioJsonP1(resultado, o) : relatorioTextoP1(resultado, o), '');
  } catch (e) {
    return resposta(1, '', `erro inesperado (${e instanceof Error ? e.name : 'desconhecido'})`);
  }
}
