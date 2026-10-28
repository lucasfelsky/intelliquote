import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { executarCli, interpretarArgumentos } from '../src/utils/forecastPreditivoCli';
import type { DependenciasCli } from '../src/utils/forecastPreditivoCli';
import { ancestralComGit, entradaDentroDoRepo, lerEntrada } from '../src/utils/forecastPreditivoEntrada';
import { fmt, relatorioJson, relatorioTexto } from '../src/utils/forecastPreditivoRelatorio';
import { rodarBacktest } from '../src/utils/forecastPreditivoBacktest';
import { normalizarSeries } from '../src/utils/forecastPreditivoSerie';
import { METODO_IDS } from '../src/utils/forecastPreditivoTipos';
import { gerarCsvSinteticas, mulberry32, seriesSinteticas } from './helpers/forecastPreditivoSinteticas';

const CSV_VERSIONADO = readFileSync(nodePath.resolve(__dirname, 'fixtures', 'forecast', 'preditivo-sinteticas.csv'), 'utf8');
const CAB = 'serie;anoMes;quantidade';

describe('lerEntrada: CSV', () => {
  it('ponto e virgula com decimal em virgula ou ponto, BOM e CRLF', () => {
    const r = lerEntrada(`\uFEFF${CAB};atipico;ruptura;fonte;familia;leadTimeDias\r\nS1;2025-01;120,5;1;0;F01;FAM1;90\r\nS1;2025-02;7.25;;;;;\r\n`, 'csv');
    expect(r.erros).toEqual([]);
    expect(r.series).toEqual([
      {
        id: 'S1',
        fonte: 'F01',
        familia: 'FAM1',
        leadTimeDias: 90,
        pontos: [
          { anoMes: '2025-01', qtd: 120.5, atipico: true, ruptura: false },
          { anoMes: '2025-02', qtd: 7.25, atipico: false, ruptura: false },
        ],
      },
    ]);
  });
  it('separador virgula (so ponto decimal) e nomes de coluna sem diferenca de maiusculas', () => {
    const r = lerEntrada('SERIE,ANOMES,Quantidade\nS1,2025-01,10.5\nS1,2025-02,3\n', 'csv');
    expect(r.erros).toEqual([]);
    expect(r.series[0].pontos.map((p) => p.qtd)).toEqual([10.5, 3]);
  });
  it('linha invalida e rejeitada com o numero da linha, sem o valor', () => {
    const r = lerEntrada(`${CAB}\nS1;2025-01;10\nS1;2025-13;99999\nS1;2025-02;1.234,5\nS1;2025-03;abc\n;2025-04;5\nS1;2025-05\nS1;2025-06;4;;;;;;\n`, 'csv');
    expect(r.series[0].pontos).toHaveLength(1);
    expect(r.erros).toEqual([
      'linha 3: anoMes invalido',
      'linha 4: quantidade invalida',
      'linha 5: quantidade invalida',
      'linha 6: serie vazia',
      'linha 7: numero de colunas diferente do cabecalho',
      'linha 8: numero de colunas diferente do cabecalho',
    ]);
    expect(r.erros.join(' ')).not.toMatch(/99999|abc|1\.234/);
  });
  it('flags e lead time invalidos', () => {
    const r = lerEntrada(`${CAB};atipico;ruptura;leadTimeDias\nS1;2025-01;1;2;0;\nS1;2025-02;1;0;x;\nS1;2025-03;1;0;0;5000\nS1;2025-04;1;0;0;30\n`, 'csv');
    expect(r.erros).toEqual(['linha 2: atipico invalido', 'linha 3: ruptura invalido', 'linha 4: leadTimeDias invalido']);
    expect(r.series[0].leadTimeDias).toBe(30);
  });
  it('cabecalho sem coluna obrigatoria, arquivo vazio e sem series', () => {
    expect(lerEntrada('a;b;c\n1;2;3\n', 'csv').erros[0]).toMatch(/^cabecalho invalido/);
    expect(lerEntrada('', 'csv').erros).toEqual(['nenhuma serie']);
    expect(lerEntrada(`${CAB}\n`, 'csv').erros).toEqual(['nenhuma serie']);
    expect(lerEntrada(`${CAB}\nS1;xx;1\n`, 'csv').erros).toEqual(['linha 2: anoMes invalido', 'nenhuma serie']);
  });
  it('limites: 240 pontos por serie e 5.000 series', () => {
    const muitos = Array.from({ length: 241 }, (_, i) => `S1;${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')};1`).join('\n');
    const a = lerEntrada(`${CAB}\n${muitos}\n`, 'csv');
    expect(a.series[0].pontos).toHaveLength(240);
    expect(a.erros).toEqual(['limite de 240 pontos por serie excedido']);
    const series = Array.from({ length: 5001 }, (_, i) => `S${i};2025-01;1`).join('\n');
    const b = lerEntrada(`${CAB}\n${series}\n`, 'csv');
    expect(b.series).toHaveLength(5000);
    expect(b.erros).toEqual(['limite de 5000 series excedido']);
  });
});

describe('lerEntrada: JSON', () => {
  const doc = { series: [{ id: 'A', fonte: 'F1', leadTimeDias: 60, pontos: [{ anoMes: '2025-01', qtd: 5, atipico: true }, { anoMes: '2025-02', qtd: 6 }] }] };
  it('formato valido', () => {
    const r = lerEntrada(JSON.stringify(doc), 'json');
    expect(r.erros).toEqual([]);
    expect(r.series[0]).toMatchObject({ id: 'A', fonte: 'F1', leadTimeDias: 60 });
    expect(r.series[0].pontos).toEqual([
      { anoMes: '2025-01', qtd: 5, atipico: true, ruptura: false },
      { anoMes: '2025-02', qtd: 6, atipico: false, ruptura: false },
    ]);
  });
  it('erros de validacao manual, sem valores', () => {
    expect(lerEntrada('{nao e json', 'json').erros).toEqual(['json invalido', 'nenhuma serie']);
    expect(lerEntrada('[]', 'json').erros[0]).toMatch(/^json invalido/);
    const r = lerEntrada(
      JSON.stringify({ series: [{ id: '', pontos: [] }, { id: 'B', leadTimeDias: -1, pontos: [{ anoMes: '2025-01', qtd: 'x' }, { anoMes: '2025-02', qtd: 1, atipico: 'sim' }, { anoMes: '2025-03', qtd: 2 }] }] }),
      'json',
    );
    expect(r.erros).toEqual(['serie 1: formato invalido', 'serie 2: leadTimeDias invalido', 'serie 2: ponto 1 invalido', 'serie 2: ponto 2 invalido']);
    expect(r.series).toHaveLength(1);
    expect(r.series[0].pontos).toHaveLength(1);
  });
});

describe('caminho: entradaDentroDoRepo e ancestralComGit (win32 e posix, independente do SO)', () => {
  const W = nodePath.win32;
  const P = nodePath.posix;
  it('win32: dentro do repo, fixtures liberada, irmao com prefixo parecido e outro drive', () => {
    const raiz = 'C:\\wt\\fc-pred';
    expect(entradaDentroDoRepo('C:\\wt\\fc-pred\\programa\\src\\a.ts', raiz, W)).toBe(true);
    expect(entradaDentroDoRepo('c:\\WT\\FC-PRED\\programa\\src\\a.ts', raiz, W)).toBe(true); // insensivel a maiusculas
    expect(entradaDentroDoRepo('C:\\wt\\fc-pred\\programa\\tests\\fixtures\\forecast\\x.csv', raiz, W)).toBe(false);
    expect(entradaDentroDoRepo('C:\\wt\\fc-pred\\programa\\tests\\outro.csv', raiz, W)).toBe(true);
    expect(entradaDentroDoRepo('C:\\wt\\fc-pred2\\x.csv', raiz, W)).toBe(false);
    expect(entradaDentroDoRepo('D:\\wt\\fc-pred\\x.csv', raiz, W)).toBe(false);
    expect(entradaDentroDoRepo('C:\\dados\\series.csv', raiz, W)).toBe(false);
  });
  it('posix: mesmas regras', () => {
    const raiz = '/wt/fc-pred';
    expect(entradaDentroDoRepo('/wt/fc-pred/programa/src/a.ts', raiz, P)).toBe(true);
    expect(entradaDentroDoRepo('/wt/fc-pred/programa/tests/fixtures/forecast/x.csv', raiz, P)).toBe(false);
    expect(entradaDentroDoRepo('/wt/fc-pred2/x.csv', raiz, P)).toBe(false);
    expect(entradaDentroDoRepo('/wt/fc-pred/../fc-pred2/x.csv', raiz, P)).toBe(false);
    expect(entradaDentroDoRepo('/wt/fc-pred', raiz, P)).toBe(true);
  });
  it('ancestralComGit acha .git arquivo ou pasta no primeiro ancestral; null sem repositorio', () => {
    const git = new Set(['C:\\wt\\fc-pred\\.git']);
    const existe = (c: string) => git.has(c);
    expect(ancestralComGit('C:\\wt\\fc-pred\\programa\\src\\a.ts', existe, W)).toBe('C:\\wt\\fc-pred');
    expect(ancestralComGit('C:\\wt\\outro\\a.csv', existe, W)).toBeNull();
    expect(ancestralComGit('/a/b/c.csv', (c) => c === '/a/.git', P)).toBe('/a');
    expect(ancestralComGit('/x.csv', () => false, P)).toBeNull();
  });
});

describe('interpretarArgumentos', () => {
  it('padroes', () => {
    const r = interpretarArgumentos(['--entrada', 'a.csv']);
    if (!r.ok) throw new Error(r.erro);
    expect(r.opcoes).toEqual({
      entrada: 'a.csv',
      quinzena: undefined,
      formato: 'texto',
      detalhe: false,
      backtest: { horizonte: 6, minTreino: 6, metodos: [...METODO_IDS], leadTimePadraoDias: 90, razaoFaltaExcesso: 3, usarMascara: true },
    });
  });
  it('todas as opcoes', () => {
    const r = interpretarArgumentos(['--quinzena', 'q.json', '--horizonte', '3', '--min-treino', '4', '--metodos', 'ses,sba', '--lead-time-padrao', '45', '--razao-falta-excesso', '2,5', '--sem-mascara', '--formato', 'json', '--detalhe']);
    if (!r.ok) throw new Error(r.erro);
    expect(r.opcoes).toMatchObject({ quinzena: 'q.json', formato: 'json', detalhe: true });
    expect(r.opcoes.backtest).toEqual({ horizonte: 3, minTreino: 4, metodos: ['ses', 'sba'], leadTimePadraoDias: 45, razaoFaltaExcesso: 2.5, usarMascara: false });
  });
  it.each([
    [[]],
    [['--entrada', 'a.csv', '--quinzena', 'q.json']],
    [['--entrada']],
    [['--entrada', '--detalhe']],
    [['--entrada', 'a.csv', '--entrada', 'b.csv']],
    [['--entrada', 'a.csv', '--detalhe', '--detalhe']],
    [['--entrada', 'a.csv', '--xyz']],
    [['--entrada', 'a.csv', '--horizonte', '13']],
    [['--entrada', 'a.csv', '--horizonte', '2.5']],
    [['--entrada', 'a.csv', '--min-treino', '0']],
    [['--entrada', 'a.csv', '--metodos', 'ses,tsb']],
    [['--entrada', 'a.csv', '--formato', 'xml']],
    [['--entrada', 'a.csv', '--razao-falta-excesso', '0']],
    [['--entrada', 'a.csv', '--lead-time-padrao', '4000']],
  ])('invalido: %j', (argv) => {
    expect(interpretarArgumentos(argv).ok).toBe(false);
  });
});

describe('relatorio', () => {
  const r = rodarBacktest(normalizarSeries(seriesSinteticas()).series, { horizonte: 6, minTreino: 6, metodos: [...METODO_IDS], leadTimePadraoDias: 90, razaoFaltaExcesso: 3, usarMascara: true });
  it('fmt: virgula decimal, n/a, arredondamento e sinal', () => {
    expect(fmt(0.425, 3)).toBe('0,425');
    expect(fmt(1234.5, 1)).toBe('1234,5');
    expect(fmt(null, 3)).toBe('n/a');
    expect(fmt(NaN, 3)).toBe('n/a');
    expect(fmt(-0.075, 3)).toBe('-0,075');
    expect(fmt(-0.0001, 3)).toBe('0,000');
    expect(fmt(2, 0)).toBe('2');
    expect(fmt(0.005, 2)).toBe('0,01');
  });
  it('texto: 1a linha com versao e hashes; sem ids de serie fora do detalhe', () => {
    const t = relatorioTexto(r, { detalhe: false, linhasRejeitadas: 3 });
    const linhas = t.split('\n');
    expect(linhas[0]).toBe(`Forecast preditivo - backtest   versao p1.1.0   config ${r.hashConfig.slice(0, 8)}   entrada ${r.hashEntrada.slice(0, 8)}`);
    expect(linhas[1]).toContain('Series: 11 (com previsao 10, sem venda 1, historico curto 1)');
    expect(linhas[1]).toContain('linhas rejeitadas 3');
    expect(t).toContain('referencia');
    expect(t).toContain('n/a');
    expect(t).not.toContain('CONST');
    expect(t).not.toContain('ATENCAO');
  });
  it('texto com detalhe: aviso no topo e tabela por serie com os ids', () => {
    const t = relatorioTexto(r, { detalhe: true });
    expect(t.split('\n')[1]).toBe('ATENCAO: ids como vieram na entrada - nao colar em lugar publico');
    expect(t).toContain('Por serie');
    expect(t).toContain('CONST');
  });
  it('json: chaves em ordem fixa, valores com round6, porSerie so com detalhe', () => {
    const j = JSON.parse(relatorioJson(r, { detalhe: false }));
    expect(Object.keys(j)).toEqual(['versao', 'hashConfig', 'hashEntrada', 'opcoes', 'linhasRejeitadas', 'origens', 'contagem', 'avisos', 'linhas']);
    expect(j.versao).toBe('p1.1.0');
    expect(JSON.stringify(j)).not.toContain('CONST');
    const comDetalhe = JSON.parse(relatorioJson(r, { detalhe: true }));
    expect(comDetalhe.porSerie).toHaveLength(11);
    expect(comDetalhe.aviso).toContain('nao colar');
    const q = j.linhas.find((l: { segmento: string; metodo: string }) => l.segmento === 'TOTAL' && l.metodo === 'planilha-q');
    expect(Math.round(q.wapeLT * 1e6) / 1e6).toBe(q.wapeLT);
    expect(relatorioJson(r, { detalhe: false }).endsWith('}\n')).toBe(true);
  });
});

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

describe('executarCli (codigos 0, 1 e 2)', () => {
  const FIX = 'C:\\wt\\fc-pred\\programa\\tests\\fixtures\\forecast\\preditivo-sinteticas.csv';
  const FORA = 'C:\\dados\\series.csv';

  it('0: fixture sintetica sob tests/fixtures (texto e json)', () => {
    const d = deps({ [FIX]: CSV_VERSIONADO });
    const t = executarCli(['--entrada', 'tests\\fixtures\\forecast\\preditivo-sinteticas.csv'], d);
    expect(t.codigo).toBe(0);
    expect(t.erro).toBe('');
    expect(t.saida.split('\n')[0]).toContain('versao p1.1.0');
    const j = executarCli(['--entrada', FIX, '--formato', 'json'], d);
    expect(JSON.parse(j.saida).versao).toBe('p1.1.0');
  });
  it('0: arquivo fora de qualquer repositorio; linhas rejeitadas contadas no cabecalho', () => {
    const r = executarCli(['--entrada', FORA], deps({ [FORA]: `${CAB}\nS1;2025-01;10\nS1;2025-13;5\nS1;2025-02;11\n` }));
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain('linhas rejeitadas 1');
  });
  it('0: --quinzena com formato Quinzena minimo', () => {
    const q = { dataBase: '2026-10-15', produtos: [{ linha: 3, codigos: ['C1'], historico: [1, 2, 3, 4, 5], fonte: '' }], entradas: { vendasMes: [{ codigo: 'C1', qtd: 6 }], leadtime: [] } };
    const r = executarCli(['--quinzena', 'C:\\wt\\fc-pred\\programa\\tests\\fixtures\\forecast\\q.json', '--min-treino', '3'], deps({ 'C:\\wt\\fc-pred\\programa\\tests\\fixtures\\forecast\\q.json': JSON.stringify(q) }));
    expect(r.codigo).toBe(0);
    expect(r.saida.split('\n')[0]).toContain('versao p1.1.0');
  });
  it('2: caminho dentro do repo (relativo, absoluto ou ..), mensagem em stderr', () => {
    const d = deps({ 'C:\\wt\\fc-pred\\programa\\src\\utils\\forecastEngine.ts': 'x' });
    for (const a of ['src\\utils\\forecastEngine.ts', 'C:\\wt\\fc-pred\\programa\\src\\utils\\forecastEngine.ts', '..\\programa\\src\\utils\\forecastEngine.ts']) {
      const r = executarCli(['--entrada', a], d);
      expect(r.codigo).toBe(2);
      expect(r.saida).toBe('');
      expect(r.erro).toContain('dentro de um repositorio');
    }
  });
  it('2: outro repositorio git (checkout principal) tambem e recusado', () => {
    const r = executarCli(['--entrada', 'C:\\proj\\main\\programa\\tests\\fixtures\\x.csv'], deps({ 'C:\\proj\\main\\programa\\tests\\fixtures\\x.csv': CAB }));
    expect(r.codigo).toBe(2);
    expect(r.erro).toContain('dentro de um repositorio');
  });
  it('2: caminho real (junction) fora das fixtures e dentro de um repo recusa mesmo com caminho aparente liberado', () => {
    const real = 'C:\\proj\\main\\programa\\dados.csv';
    const r = executarCli(['--entrada', FIX], deps({ [FIX]: CAB, [real]: CAB }, { caminhoReal: () => real }));
    expect(r.codigo).toBe(2);
    expect(r.erro).toContain('dentro de um repositorio');
  });
  it('2: inexistente, grande demais, extensao errada, sem series, cabecalho ruim, opcao invalida', () => {
    expect(executarCli(['--entrada', 'C:\\dados\\nao-existe.csv'], deps({})).erro).toContain('nao encontrado');
    expect(executarCli(['--entrada', FORA], deps({ [FORA]: CAB }, { tamanhoBytes: () => 20 * 1024 * 1024 + 1 })).erro).toContain('20 MB');
    expect(executarCli(['--entrada', 'C:\\dados\\a.txt'], deps({ 'C:\\dados\\a.txt': CAB })).erro).toContain('.csv ou .json');
    expect(executarCli(['--entrada', FORA], deps({ [FORA]: `${CAB}\n` })).erro).toContain('nenhuma serie');
    expect(executarCli(['--entrada', FORA], deps({ [FORA]: 'a;b\n1;2\n' })).codigo).toBe(2);
    expect(executarCli(['--quinzena', 'C:\\dados\\q.json'], deps({ 'C:\\dados\\q.json': '{"x":1}' })).erro).toContain('quinzena invalida');
    const r = executarCli(['--entrada', FORA, '--horizonte', '13'], deps({ [FORA]: CAB }));
    expect(r.codigo).toBe(2);
    expect(r.saida).toBe('');
  });
  it('1: excecao inesperada vira codigo 1 com mensagem curta', () => {
    const r = executarCli(['--entrada', FORA], deps({ [FORA]: CAB }, { lerTexto: () => { throw new Error('conteudo secreto'); } }));
    expect(r.codigo).toBe(1);
    expect(r.erro).toBe('erro inesperado (Error)\n');
    expect(r.erro).not.toContain('secreto');
  });
});

describe('determinismo e fixture versionada', () => {
  const d = deps({ 'C:\\wt\\fc-pred\\programa\\tests\\fixtures\\forecast\\preditivo-sinteticas.csv': CSV_VERSIONADO });
  const rodar = (arquivo: string, formato: string) => executarCli(['--entrada', 'C:\\wt\\fc-pred\\programa\\tests\\fixtures\\forecast\\preditivo-sinteticas.csv', '--formato', formato], deps({ 'C:\\wt\\fc-pred\\programa\\tests\\fixtures\\forecast\\preditivo-sinteticas.csv': arquivo })).saida;

  it('o CSV versionado e exatamente a saida do gerador (CRLF do autocrlf normalizado)', () => {
    expect(CSV_VERSIONADO.replace(/\r\n/g, '\n')).toBe(gerarCsvSinteticas());
    expect(CSV_VERSIONADO.charCodeAt(0)).not.toBe(0xfeff);
  });
  it('duas rodadas do CLI dao saida identica, byte a byte', () => {
    const a = executarCli(['--entrada', 'C:\\wt\\fc-pred\\programa\\tests\\fixtures\\forecast\\preditivo-sinteticas.csv', '--formato', 'json'], d).saida;
    expect(rodar(CSV_VERSIONADO, 'json')).toBe(a);
    expect(a.length).toBeGreaterThan(1000);
  });
  it('embaralhar a ordem das linhas do CSV nao muda o resultado', () => {
    const linhas = CSV_VERSIONADO.replace(/\r\n/g, '\n').trim().split('\n');
    const [cab, ...corpo] = linhas;
    const rng = mulberry32(7);
    for (let i = corpo.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [corpo[i], corpo[j]] = [corpo[j], corpo[i]];
    }
    expect(corpo.join('\n')).not.toBe(linhas.slice(1).join('\n'));
    const embaralhado = [cab, ...corpo].join('\n') + '\n';
    expect(rodar(embaralhado, 'json')).toBe(rodar(CSV_VERSIONADO, 'json'));
    expect(rodar(embaralhado, 'texto')).toBe(rodar(CSV_VERSIONADO, 'texto'));
  });
  it('so dados sinteticos: 11 series, cabecalho exato, linhas no formato esperado', () => {
    const linhas = CSV_VERSIONADO.replace(/\r\n/g, '\n').trim().split('\n');
    expect(linhas[0]).toBe('serie;anoMes;quantidade;atipico;ruptura;fonte;familia;leadTimeDias');
    const re = /^(CONST|TEND|SAZ|INTERM|LUMPY|RUIDO|NOVA|ZERO|ATIP|RUPT|DEGRAU);20(24|25|26)-(0[1-9]|1[0-2]);\d+;[01];[01];F0[1-3];FAM[12];(30|90|120)$/;
    expect(linhas.slice(1).filter((l) => !re.test(l))).toEqual([]);
    expect(new Set(linhas.slice(1).map((l) => l.split(';')[0])).size).toBe(11);
  });
});
