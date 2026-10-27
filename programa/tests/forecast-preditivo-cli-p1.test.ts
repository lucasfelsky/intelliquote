import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rodarBacktest } from '../src/utils/forecastPreditivoBacktest';
import { executarCli } from '../src/utils/forecastPreditivoCli';
import type { DependenciasCli } from '../src/utils/forecastPreditivoCli';
import { executarCliP1, interpretarArgumentosP1 } from '../src/utils/forecastPreditivoCliP1';
import { hashConfigP1 } from '../src/utils/forecastPreditivoConfigP1';
import { normalizarSeries } from '../src/utils/forecastPreditivoSerie';
import { METODO_IDS, METODO_TODOS_IDS } from '../src/utils/forecastPreditivoTipos';
import { gerarCsvSinteticas, seriesSinteticas } from './helpers/forecastPreditivoSinteticas';

const CSV = gerarCsvSinteticas();
const CAB = 'serie;anoMes;quantidade';
const FIX = 'C:\\wt\\fc-pred\\programa\\tests\\fixtures\\forecast\\preditivo-sinteticas.csv';
const FORA = 'C:\\dados\\series.csv';

// Dependencias falsas: sistema de arquivos em memoria, sem tocar o disco.
function deps(arquivos: Record<string, string>, extra: Partial<DependenciasCli> = {}): DependenciasCli {
  const git = new Set(['C:\\wt\\fc-pred\\.git', 'C:\\proj\\main\\.git']);
  return {
    cwd: 'C:\\wt\\fc-pred\\programa',
    raizRepo: 'C:\\wt\\fc-pred',
    caminhos: nodePath.win32,
    existe: (c) => c in arquivos || git.has(c),
    tamanhoBytes: (c) => arquivos[c].length,
    caminhoReal: (c) => c,
    lerTexto: (c) => arquivos[c],
    ...extra,
  };
}
const dFix = () => deps({ [FIX]: CSV });
const ascii = (t: string) => {
  for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) >= 128) return false;
  return true;
};

describe('interpretarArgumentosP1: validos', () => {
  it('padroes: relatorio p1, teto 0,10, todos os metodos, demais flags da fase 0', () => {
    const r = interpretarArgumentosP1(['--entrada', 'a.csv']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.opcoes).toMatchObject({ relatorio: 'p1', entrada: 'a.csv', formato: 'texto', detalhe: false });
    expect(r.opcoes.backtest).toEqual({ horizonte: 6, minTreino: 6, metodos: [...METODO_TODOS_IDS], leadTimePadraoDias: 90, razaoFaltaExcesso: 3, usarMascara: true, tetoVies: 0.1 });
  });
  it.each([['0', 0], ['1', 1], ['1,0', 1], ['1.0', 1], ['0.15', 0.15], ['0,15', 0.15], ['sem', null]])('--teto-vies %s', (valor, esperado) => {
    const r = interpretarArgumentosP1(['--entrada', 'a.csv', '--teto-vies', valor]);
    expect(r.ok && r.opcoes.backtest.tetoVies).toBe(esperado);
  });
  it('--metodos aceita os novos ids; --relatorio p1 explicito; flags da fase 0 passam', () => {
    const r = interpretarArgumentosP1(['--relatorio', 'p1', '--quinzena', 'q.json', '--metodos', 'ses, preditivo-p1', '--horizonte', '3', '--min-treino', '4', '--sem-mascara', '--formato', 'json', '--detalhe']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.opcoes).toMatchObject({ relatorio: 'p1', quinzena: 'q.json', formato: 'json', detalhe: true });
    expect(r.opcoes.backtest).toMatchObject({ metodos: ['ses', 'preditivo-p1'], horizonte: 3, minTreino: 4, usarMascara: false });
  });
  it('p0: argv sem o par --relatorio, com --metodos preservado', () => {
    const r = interpretarArgumentosP1(['--entrada', 'a.csv', '--relatorio', 'p0', '--metodos', 'ses']);
    expect(r.ok && r.opcoes.relatorio).toBe('p0');
    expect(r.ok && r.opcoes.argvP0).toEqual(['--entrada', 'a.csv', '--metodos', 'ses']);
  });
});

describe('interpretarArgumentosP1: invalidos', () => {
  it.each([
    [['--entrada', 'a.csv', '--relatorio', 'p2']],
    [['--entrada', 'a.csv', '--relatorio']],
    [['--entrada', 'a.csv', '--relatorio', '--detalhe']],
    [['--entrada', 'a.csv', '--relatorio', 'p1', '--relatorio', 'p1']],
    [['--entrada', 'a.csv', '--teto-vies', '1.01']],
    [['--entrada', 'a.csv', '--teto-vies', '-0.1']],
    [['--entrada', 'a.csv', '--teto-vies', '']],
    [['--entrada', 'a.csv', '--teto-vies', 'abc']],
    [['--entrada', 'a.csv', '--teto-vies', '2']],
    [['--entrada', 'a.csv', '--teto-vies', '00.1']],
    [['--entrada', 'a.csv', '--teto-vies']],
    [['--entrada', 'a.csv', '--teto-vies', '0.1', '--teto-vies', '0.2']],
    [['--entrada', 'a.csv', '--metodos', 'ses,tsb']],
    [['--entrada', 'a.csv', '--metodos', 'ses,,sba']],
    [['--entrada', 'a.csv', '--metodos', 'ses', '--metodos', 'sba']],
    [['--entrada', 'a.csv', '--relatorio', 'p0', '--teto-vies', '0.2']],
    [['--entrada', 'a.csv', '--entrada', 'b.csv']],
    [['--entrada', 'a.csv', '--horizonte', '13']],
    [['--entrada', 'a.csv', '--xyz']],
    [['--entrada', 'a.csv', '--quinzena', 'q.json']],
  ])('p1: %j', (argv) => {
    expect(interpretarArgumentosP1(argv).ok).toBe(false);
  });
  it('mensagens: teto so vale com p1; valor do teto', () => {
    expect(interpretarArgumentosP1(['--entrada', 'a.csv', '--relatorio', 'p0', '--teto-vies', '0.2'])).toEqual({ ok: false, erro: '--teto-vies so vale com --relatorio p1' });
    expect(interpretarArgumentosP1(['--entrada', 'a.csv', '--teto-vies', '1.01'])).toMatchObject({ ok: false });
  });
  it('--relatorio p0 --metodos preditivo-p1 passa no parser, mas a fase 0 recusa com codigo 2', () => {
    const r = executarCliP1(['--entrada', FIX, '--relatorio', 'p0', '--metodos', 'preditivo-p1'], dFix());
    expect(r.codigo).toBe(2);
    expect(r.saida).toBe('');
    expect(r).toEqual(executarCli(['--entrada', FIX, '--metodos', 'preditivo-p1'], dFix()));
  });
});

describe('modo p0 == executarCli da fase 0 (objeto inteiro)', () => {
  const casos: [string, string[], () => DependenciasCli][] = [
    ['json', ['--entrada', FIX, '--formato', 'json'], dFix],
    ['texto com opcoes', ['--entrada', FIX, '--min-treino', '12', '--horizonte', '3', '--metodos', 'planilha-q,ses'], dFix],
    ['detalhe sem mascara', ['--entrada', FIX, '--detalhe', '--sem-mascara'], dFix],
    ['caminho no repo', ['--entrada', 'src\\utils\\forecastEngine.ts'], () => deps({ 'C:\\wt\\fc-pred\\programa\\src\\utils\\forecastEngine.ts': 'x' })],
    ['horizonte 13', ['--entrada', FORA, '--horizonte', '13'], () => deps({ [FORA]: CAB })],
    ['sem argumentos de entrada', ['--formato', 'json'], dFix],
  ];
  it.each(casos)('%s', (_nome, argv, mk) => {
    const esperado = executarCli(argv, mk());
    expect(executarCliP1([...argv, '--relatorio', 'p0'], mk())).toEqual(esperado);
    expect(executarCliP1(['--relatorio', 'p0', ...argv], mk())).toEqual(esperado);
  });
  it('o hashConfig do p0 e o da fase 0; o do p1 e outro (hashConfigP1)', () => {
    const p0 = JSON.parse(executarCliP1(['--entrada', FIX, '--formato', 'json', '--relatorio', 'p0'], dFix()).saida);
    const fase0 = rodarBacktest(normalizarSeries(seriesSinteticas()).series, { horizonte: 6, minTreino: 6, metodos: [...METODO_IDS], leadTimePadraoDias: 90, razaoFaltaExcesso: 3, usarMascara: true });
    expect(p0.hashConfig).toBe(fase0.hashConfig);
    expect(p0.versao).toBe('p1.0.0');
    const p1 = JSON.parse(executarCliP1(['--entrada', FIX, '--formato', 'json'], dFix()).saida);
    expect(p1.hashConfig).toBe(hashConfigP1());
    expect(p1.hashConfig).not.toBe(p0.hashConfig);
    expect(p1.hashEntrada).toBe(p0.hashEntrada);
  });
});

describe('relatorio P1 (texto)', () => {
  const t = executarCliP1(['--entrada', FIX], dFix());
  it('codigo 0, 1a linha, cenarios, rotulos e eixos', () => {
    expect(t.codigo).toBe(0);
    expect(t.erro).toBe('');
    expect(t.saida.split('\n')[0]).toMatch(/^Forecast preditivo - backtest P1   versao p1\.0\.0   config [0-9a-f]{8}   entrada [0-9a-f]{8}$/);
    expect(t.saida).toContain('Cenario principal: min-treino 12');
    expect(t.saida).toContain('Cenario: min-treino 6');
    expect(t.saida).toContain('sem venda >=6 meses');
    expect(t.saida).toContain('XYZ');
    expect(t.saida).toContain('teto de vies 10,0%');
    expect(t.saida).toContain('Metades das origens: meses');
    expect(t.saida).toContain('Resumo (TOTAL e candidatos):');
    expect(t.saida).toContain('Falhos teto 10,0%');
    expect(t.saida).toContain('Falhos sem teto');
    expect(t.saida).toContain('Criterios: 1 amostra');
    expect(t.saida).toContain('lead-time-truncado');
  });
  it('sem ids de serie nem nomes de fonte fora do --detalhe', () => {
    for (const id of seriesSinteticas().map((s) => s.id)) expect(t.saida).not.toContain(id);
    for (const f of ['F01', 'F02', 'F03']) expect(t.saida).not.toContain(f);
    expect(t.saida).not.toContain('ATENCAO');
  });
  it('com --detalhe: aviso, ids, fontes e tabela por serie', () => {
    const d = executarCliP1(['--entrada', FIX, '--detalhe'], dFix());
    expect(d.saida.split('\n')[1]).toBe('ATENCAO: ids como vieram na entrada - nao colar em lugar publico');
    expect(d.saida).toContain('CONST');
    expect(d.saida).toContain('Fontes (rotulo -> fonte):');
    expect(d.saida).toContain('fonte-01 -> F');
    expect(d.saida).toContain('Por serie (WAPE LT por metodo):');
  });
  it('teto sem e --min-treino 12 (um unico cenario)', () => {
    const r = executarCliP1(['--entrada', FIX, '--teto-vies', 'sem', '--min-treino', '12'], dFix());
    expect(r.saida).toContain('teto de vies sem');
    expect(r.saida).toContain('Cenario principal: min-treino 12');
    expect(r.saida).not.toContain('Cenario: min-treino');
  });
  it('so ASCII (console do PowerShell 5.1), tambem com detalhe', () => {
    expect(ascii(t.saida)).toBe(true);
    expect(ascii(executarCliP1(['--entrada', FIX, '--detalhe'], dFix()).saida)).toBe(true);
  });
  it('cenario sem pares (12 meses de treino numa serie curta): sem excecao', () => {
    const curto = `${CAB}\n` + Array.from({ length: 6 }, (_, i) => `S1;2025-0${i + 1};${10 + i}`).join('\n') + '\n';
    const r = executarCliP1(['--entrada', FORA], deps({ [FORA]: curto }));
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain('Sem pares');
  });
  it('linhas rejeitadas contadas no cabecalho', () => {
    const r = executarCliP1(['--entrada', FORA], deps({ [FORA]: `${CAB}\nS1;2025-01;10\nS1;2025-13;5\nS1;2025-02;11\n` }));
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain('linhas rejeitadas 1');
  });
});

describe('relatorio P1 (JSON)', () => {
  const run = (...extra: string[]) => executarCliP1(['--entrada', FIX, '--formato', 'json', ...extra], dFix());
  const j = JSON.parse(run().saida);
  it('chaves exatas: topo, opcoes, cenario e linha', () => {
    expect(Object.keys(j)).toEqual(['versao', 'hashConfig', 'hashEntrada', 'opcoes', 'cenariosMinTreino', 'linhasRejeitadas', 'cenarios']);
    expect(Object.keys(j.opcoes)).toEqual(['horizonte', 'minTreino', 'metodos', 'leadTimePadraoDias', 'razaoFaltaExcesso', 'usarMascara', 'tetoVies']);
    expect(Object.keys(j.cenarios[0])).toEqual(['minTreino', 'principal', 'origens', 'origensComObservacao', 'metades', 'contagem', 'contagemSegmentos', 'avisos', 'avisosP1', 'amostra', 'linhas']);
    expect(Object.keys(j.cenarios[1].linhas[0])).toEqual([
      'segmento', 'metodo', 'n', 'origens', 'nFallback', 'wapeH1', 'wapeH3', 'wapeLT', 'wapeRef', 'wapeRel', 'viesLT', 'viesRef', 'maeLT', 'custoLT', 'custoRel', 'faltaLT', 'excessoLT',
      'vitoria', 'cobertura', 'nIntervalo', 'nPoolTotal', 'pinball10', 'pinball90', 'metade1', 'metade2', 'criteriosFalhos', 'promovivel', 'criteriosFalhosSemTeto', 'promovivelSemTeto', 'nItensAPiores',
    ]);
    expect(Object.keys(j.cenarios[1].linhas[0].metade1)).toEqual(['n', 'origens', 'wapeLT', 'wapeRef', 'viesLT', 'viesRef', 'custoRel', 'vitoria', 'criteriosFalhos', 'criteriosFalhosSemTeto']);
    expect(Object.keys(j.cenarios[1].contagemSegmentos)).toEqual(['abc', 'sbc', 'xyz', 'lt', 'fonte', 'regra']);
    expect(Object.keys(j.cenarios[1].metades)).toEqual(['meses1', 'meses2', 'ultimoMes1']);
  });
  it('valores: versao, cenarios [12, 6], principal, teto 0,1; round6', () => {
    expect(j.versao).toBe('p1.0.0');
    expect(j.cenarios.map((c: { minTreino: number; principal: boolean }) => [c.minTreino, c.principal])).toEqual([[12, true], [6, false]]);
    expect(j.cenariosMinTreino).toEqual([12, 6]);
    expect(j.opcoes.tetoVies).toBe(0.1);
    const q = j.cenarios[1].linhas.find((l: { segmento: string; metodo: string }) => l.segmento === 'TOTAL' && l.metodo === 'planilha-q');
    expect(Math.round(q.wapeLT * 1e6) / 1e6).toBe(q.wapeLT);
  });
  it('--teto-vies sem -> null; --teto-vies 0,15 -> 0.15; --min-treino 12 -> 1 cenario', () => {
    expect(JSON.parse(run('--teto-vies', 'sem', '--min-treino', '12').saida).opcoes.tetoVies).toBeNull();
    expect(JSON.parse(run('--teto-vies', 'sem', '--min-treino', '12').saida).cenarios).toHaveLength(1);
    expect(JSON.parse(run('--teto-vies', '0,15').saida).opcoes.tetoVies).toBe(0.15);
  });
  it('--metodos limita as linhas aos pedidos', () => {
    const m = JSON.parse(run('--metodos', 'preditivo-p1,ses').saida);
    expect(m.opcoes.metodos).toEqual(['ses', 'preditivo-p1']);
    expect([...new Set(m.cenarios[1].linhas.map((l: { metodo: string }) => l.metodo))]).toEqual(['ses', 'preditivo-p1']);
  });
  it('sem detalhe: nenhum id, nenhuma fonte, nenhum porSerie; com detalhe: aviso, fontes, porSerie e itensAPiores', () => {
    const txt = run().saida;
    for (const id of seriesSinteticas().map((s) => s.id)) expect(txt).not.toContain(`"${id}"`);
    for (const f of ['F01', 'F02', 'F03']) expect(txt).not.toContain(f);
    expect(j.cenarios[1].porSerie).toBeUndefined();
    const d = JSON.parse(run('--detalhe').saida);
    expect(Object.keys(d).slice(-2)).toEqual(['aviso', 'fontes']);
    expect(d.aviso).toContain('nao colar');
    expect(d.fontes.length).toBe(3);
    expect(d.cenarios[1].porSerie).toHaveLength(11);
    expect(Object.keys(d.cenarios[1])).toEqual([...Object.keys(j.cenarios[1]), 'porSerie']);
    expect(Object.keys(d.cenarios[1].linhas[0]).slice(-2)).toEqual(['nItensAPiores', 'itensAPiores']);
  });
  it('so ASCII, determinismo byte a byte e entrada embaralhada', () => {
    const a = run().saida;
    expect(ascii(a)).toBe(true);
    expect(ascii(run('--detalhe').saida)).toBe(true);
    expect(run().saida).toBe(a);
    const linhas = CSV.trim().split('\n');
    const [cab, ...corpo] = linhas;
    const embaralhado = [cab, ...[...corpo].reverse()].join('\n') + '\n';
    expect(executarCliP1(['--entrada', FIX, '--formato', 'json'], deps({ [FIX]: embaralhado })).saida).toBe(a);
  });
});

describe('executarCliP1: codigos 1 e 2 e recusa de caminho', () => {
  it('2: caminho dentro do repo (relativo, absoluto ou ..), mensagem em stderr', () => {
    const d = deps({ 'C:\\wt\\fc-pred\\programa\\src\\utils\\forecastEngine.ts': 'x' });
    for (const a of ['src\\utils\\forecastEngine.ts', 'C:\\wt\\fc-pred\\programa\\src\\utils\\forecastEngine.ts', '..\\programa\\src\\utils\\forecastEngine.ts']) {
      const r = executarCliP1(['--entrada', a], d);
      expect(r.codigo).toBe(2);
      expect(r.saida).toBe('');
      expect(r.erro).toContain('dentro de um repositorio');
    }
  });
  it('2: outro repositorio git (checkout principal) tambem e recusado', () => {
    const r = executarCliP1(['--entrada', 'C:\\proj\\main\\programa\\tests\\fixtures\\x.csv'], deps({ 'C:\\proj\\main\\programa\\tests\\fixtures\\x.csv': CAB }));
    expect(r.codigo).toBe(2);
    expect(r.erro).toContain('dentro de um repositorio');
  });
  it('2: junction para dentro de um repo recusa mesmo com o caminho aparente liberado', () => {
    const real = 'C:\\proj\\main\\programa\\dados.csv';
    const r = executarCliP1(['--entrada', FIX], deps({ [FIX]: CAB, [real]: CAB }, { caminhoReal: () => real }));
    expect(r.codigo).toBe(2);
    expect(r.erro).toContain('dentro de um repositorio');
  });
  it('2: inexistente, grande demais, extensao errada, sem series, opcao invalida', () => {
    expect(executarCliP1(['--entrada', 'C:\\dados\\nao-existe.csv'], deps({})).erro).toContain('nao encontrado');
    expect(executarCliP1(['--entrada', FORA], deps({ [FORA]: CAB }, { tamanhoBytes: () => 20 * 1024 * 1024 + 1 })).erro).toContain('20 MB');
    expect(executarCliP1(['--entrada', 'C:\\dados\\a.txt'], deps({ 'C:\\dados\\a.txt': CAB })).erro).toContain('.csv ou .json');
    expect(executarCliP1(['--entrada', FORA], deps({ [FORA]: `${CAB}\n` })).erro).toContain('nenhuma serie');
    expect(executarCliP1(['--quinzena', 'C:\\dados\\q.json'], deps({ 'C:\\dados\\q.json': '{"x":1}' })).erro).toContain('quinzena invalida');
    for (const extra of [['--teto-vies', '1.5'], ['--relatorio', 'p3'], ['--metodos', 'ses,tsb']]) {
      const r = executarCliP1(['--entrada', FORA, ...extra], deps({ [FORA]: CAB }));
      expect(r.codigo).toBe(2);
      expect(r.saida).toBe('');
    }
  });
  it('1: excecao inesperada vira codigo 1 com mensagem curta, sem vazar o conteudo', () => {
    const r = executarCliP1(['--entrada', FORA], deps({ [FORA]: CAB }, { lerTexto: () => { throw new Error('conteudo secreto'); } }));
    expect(r.codigo).toBe(1);
    expect(r.erro).toBe('erro inesperado (Error)\n');
    expect(r.erro).not.toContain('secreto');
  });
  it('nunca escreve em disco: os modulos novos nao importam fs nem usam escrita', () => {
    for (const arq of ['forecastPreditivoCliP1', 'forecastPreditivoRelatorioP1', 'forecastPreditivoBacktestP1', 'forecastPreditivoIntervalos']) {
      const fonte = readFileSync(resolve(__dirname, '..', 'src', 'utils', arq + '.ts'), 'utf8');
      expect(fonte).not.toMatch(/node:fs|from 'fs'|writeFile|appendFile|createWriteStream|process.stdout/);
    }
  });
});
