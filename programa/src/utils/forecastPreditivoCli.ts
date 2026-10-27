// Forecast preditivo (fase 0): CLI local, PURO. `executarCli` recebe as dependencias de arquivo (injetadas) e devolve
// { codigo, saida, erro }: quem escreve em stdout/stderr e o script. Nunca escreve em disco.
// Codigos: 0 ok | 1 erro inesperado | 2 entrada/opcao invalida ou caminho recusado.
import * as nodePath from 'node:path';
import { rodarBacktest, validarOpcoesBacktest } from './forecastPreditivoBacktest';
import type { OpcoesBacktest } from './forecastPreditivoBacktest';
import { ancestralComGit, caminhoSob, entradaDentroDoRepo, lerEntrada, pastaFixtures } from './forecastPreditivoEntrada';
import { relatorioJson, relatorioTexto } from './forecastPreditivoRelatorio';
import { normalizarSeries, serieDaQuinzena } from './forecastPreditivoSerie';
import { METODO_IDS, PREDITIVO_CONFIG as C } from './forecastPreditivoTipos';
import type { MetodoId, SerieEntrada } from './forecastPreditivoTipos';
import type { Quinzena } from './forecastTypes';

export const LIMITE_BYTES = 20 * 1024 * 1024;

export interface OpcoesCli {
  entrada?: string;
  quinzena?: string;
  formato: 'texto' | 'json';
  detalhe: boolean;
  backtest: OpcoesBacktest;
}

export interface DependenciasCli {
  cwd: string;
  raizRepo: string;
  existe: (caminho: string) => boolean;
  tamanhoBytes: (caminho: string) => number;
  caminhoReal: (caminho: string) => string;
  lerTexto: (caminho: string) => string;
  caminhos?: typeof nodePath.win32 | typeof nodePath.posix;
}

const COM_VALOR = ['--entrada', '--quinzena', '--horizonte', '--min-treino', '--metodos', '--lead-time-padrao', '--razao-falta-excesso', '--formato'];
const SEM_VALOR = ['--sem-mascara', '--detalhe'];

export function interpretarArgumentos(argv: string[]): { ok: true; opcoes: OpcoesCli } | { ok: false; erro: string } {
  const valores = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (SEM_VALOR.includes(a)) {
      if (flags.has(a)) return { ok: false, erro: `argumento repetido: ${a}` };
      flags.add(a);
    } else if (COM_VALOR.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { ok: false, erro: `faltou o valor de ${a}` };
      if (valores.has(a)) return { ok: false, erro: `argumento repetido: ${a}` };
      valores.set(a, v);
      i++;
    } else {
      return { ok: false, erro: `argumento desconhecido: ${a}` };
    }
  }
  if (valores.has('--entrada') === valores.has('--quinzena')) return { ok: false, erro: 'informe exatamente um entre --entrada e --quinzena' };
  const inteiro = (nome: string, padrao: number): number => (valores.has(nome) ? (/^\d+$/.test(valores.get(nome)!) ? Number(valores.get(nome)) : NaN) : padrao);
  const razaoTexto = valores.get('--razao-falta-excesso');
  const razao = razaoTexto === undefined ? C.razaoFaltaExcesso : /^\d+([.,]\d+)?$/.test(razaoTexto) ? Number(razaoTexto.replace(',', '.')) : NaN;
  const formato = valores.get('--formato') ?? 'texto';
  if (formato !== 'texto' && formato !== 'json') return { ok: false, erro: '--formato deve ser texto ou json' };
  const metodos = valores.has('--metodos') ? valores.get('--metodos')!.split(',').map((m) => m.trim()) : [...METODO_IDS];
  const backtest: OpcoesBacktest = {
    horizonte: inteiro('--horizonte', C.horizontePadrao),
    minTreino: inteiro('--min-treino', C.minTreinoPadrao),
    metodos: metodos as MetodoId[],
    leadTimePadraoDias: inteiro('--lead-time-padrao', C.leadTimePadraoDias),
    razaoFaltaExcesso: razao,
    usarMascara: !flags.has('--sem-mascara'),
  };
  const erros = validarOpcoesBacktest(backtest);
  if (erros.length > 0) return { ok: false, erro: 'opcoes invalidas: ' + erros.join('; ') };
  return {
    ok: true,
    opcoes: { entrada: valores.get('--entrada'), quinzena: valores.get('--quinzena'), formato, detalhe: flags.has('--detalhe'), backtest },
  };
}

const resposta = (codigo: 0 | 1 | 2, saida: string, erro: string) => ({ codigo, saida, erro: erro === '' ? '' : erro + '\n' });

function lerQuinzena(texto: string): SerieEntrada[] | null {
  try {
    const q = JSON.parse(texto) as Partial<Quinzena>;
    if (!q || typeof q.dataBase !== 'string' || !Array.isArray(q.produtos) || !q.entradas) return null;
    return serieDaQuinzena(q as Quinzena);
  } catch {
    return null;
  }
}

export function executarCli(argv: string[], deps: DependenciasCli): { codigo: 0 | 1 | 2; saida: string; erro: string } {
  try {
    const args = interpretarArgumentos(argv);
    if (!args.ok) return resposta(2, '', args.erro);
    const { opcoes } = args;
    const caminhos = deps.caminhos ?? nodePath;
    const arquivo = (opcoes.entrada ?? opcoes.quinzena)!;
    const resolvido = caminhos.resolve(deps.cwd, arquivo);
    const existe = deps.existe(resolvido);
    const candidatos = [resolvido];
    if (existe) {
      const real = deps.caminhoReal(resolvido);
      if (real !== resolvido) candidatos.push(real);
    }
    // junction/symlink: vale o caminho resolvido E o real. Sob fixtures (nas duas) e liberado; sob repo git, recusado.
    const sobFixtures = (c: string) => caminhoSob(pastaFixtures(deps.raizRepo, caminhos), c, caminhos);
    const liberado = candidatos.every(sobFixtures);
    if (!liberado && candidatos.some((c) => entradaDentroDoRepo(c, deps.raizRepo, caminhos) || ancestralComGit(c, deps.existe, caminhos) !== null)) {
      return resposta(2, '', 'entrada recusada: caminho dentro de um repositorio git (so programa/tests/fixtures/ e aceito); use um arquivo fora do repositorio');
    }
    if (!existe) return resposta(2, '', 'arquivo de entrada nao encontrado');
    if (deps.tamanhoBytes(resolvido) > LIMITE_BYTES) return resposta(2, '', 'arquivo de entrada maior que 20 MB');
    const extensao = caminhos.extname(resolvido).toLowerCase();
    if (opcoes.entrada !== undefined && extensao !== '.csv' && extensao !== '.json') return resposta(2, '', 'extensao da entrada deve ser .csv ou .json');
    if (opcoes.quinzena !== undefined && extensao !== '.json') return resposta(2, '', 'extensao da quinzena deve ser .json');

    const texto = deps.lerTexto(resolvido);
    let entrada: SerieEntrada[];
    let errosLeitura: string[] = [];
    if (opcoes.quinzena !== undefined) {
      const series = lerQuinzena(texto);
      if (series === null) return resposta(2, '', 'quinzena invalida');
      entrada = series;
    } else {
      const lida = lerEntrada(texto, extensao === '.json' ? 'json' : 'csv');
      entrada = lida.series;
      errosLeitura = lida.erros;
    }
    const fatal = errosLeitura.find((e) => e === 'nenhuma serie' || e.startsWith('limite') || e.startsWith('cabecalho') || e.startsWith('json invalido'));
    if (fatal !== undefined || entrada.length === 0) return resposta(2, '', fatal ?? 'nenhuma serie');

    const { series, erros: errosSerie } = normalizarSeries(entrada);
    const rejeitadas = errosLeitura.length + errosSerie.length;
    const resultado = rodarBacktest(series, opcoes.backtest);
    const o = { detalhe: opcoes.detalhe, linhasRejeitadas: rejeitadas };
    return resposta(0, opcoes.formato === 'json' ? relatorioJson(resultado, o) : relatorioTexto(resultado, o), '');
  } catch (e) {
    return resposta(1, '', `erro inesperado (${e instanceof Error ? e.name : 'desconhecido'})`);
  }
}
