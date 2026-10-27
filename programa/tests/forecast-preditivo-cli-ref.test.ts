import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARAMETROS_CORRECAO_PADRAO, hashConfigRef } from '../src/utils/forecastPreditivoConfigRef';
import { lerTabelaCalibracao } from '../src/utils/forecastPreditivoCalibracao';
import type { DependenciasCli } from '../src/utils/forecastPreditivoCli';
import { executarCliP1 } from '../src/utils/forecastPreditivoCliP1';
import { hashConfigP1 } from '../src/utils/forecastPreditivoConfigP1';
import { executarCliRef, interpretarArgumentosRef } from '../src/utils/forecastPreditivoCliRef';
import { tabelaJson } from '../src/utils/forecastPreditivoRelatorioRef';
import { gerarCsvSinteticas } from './helpers/forecastPreditivoSinteticas';
import { gerarCsvDesempenho } from './helpers/forecastPreditivoSinteticasP1';

const CSV = gerarCsvSinteticas();
const FIX = 'C:\\wt\\fc-pred\\programa\\tests\\fixtures\\forecast\\preditivo-sinteticas.csv';
const FIXQ = 'C:\\wt\\fc-pred\\programa\\tests\\fixtures\\forecast\\quinzena-10-2.anon.json';
const QUINZENA = readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8');

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
const dFix = () => deps({ [FIX]: CSV, [FIXQ]: QUINZENA });
const ascii = (t: string) => [...t].every((c) => c.charCodeAt(0) < 128);
const ARQ = ['--entrada', 'tests/fixtures/forecast/preditivo-sinteticas.csv'];
const p1b = (...extra: string[]) => executarCliRef([...ARQ, '--relatorio', 'p1b', ...extra], dFix());
const json = (...extra: string[]) => JSON.parse(p1b('--formato', 'json', ...extra).saida);
const ok = (argv: string[]) => interpretarArgumentosRef(argv);

describe('interpretarArgumentosRef', () => {
  it('padroes do p1b', () => {
    const r = ok(['--entrada', 'a.csv', '--relatorio', 'p1b']);
    expect(r).toEqual({
      ok: true,
      modo: 'p1b',
      opcoes: {
        entrada: 'a.csv', quinzena: undefined, formato: 'texto', detalhe: false, gerarCalibracao: false, correcaoNivel: false,
        backtest: { horizonte: 6, minTreino: 6, leadTimePadraoDias: 90, razaoFaltaExcesso: 3, usarMascara: true, tetoVies: null, historicoMaximo: null, parametrosCorrecao: PARAMETROS_CORRECAO_PADRAO },
      },
    });
  });
  it('flags da P1a passam ao backtest (horizonte, min-treino, lead time, razao, mascara, teto, formato, detalhe, quinzena)', () => {
    const r = ok(['--relatorio', 'p1b', '--quinzena', 'q.json', '--horizonte', '3', '--min-treino', '4', '--lead-time-padrao', '30', '--razao-falta-excesso', '2,5', '--sem-mascara', '--teto-vies', '0,10', '--formato', 'json', '--detalhe']);
    expect(r.ok && r.modo === 'p1b' && r.opcoes).toMatchObject({ quinzena: 'q.json', formato: 'json', detalhe: true });
    expect(r.ok && r.modo === 'p1b' && r.opcoes.backtest).toMatchObject({ horizonte: 3, minTreino: 4, leadTimePadraoDias: 30, razaoFaltaExcesso: 2.5, usarMascara: false, tetoVies: 0.1 });
  });
  it.each([['1', 1], ['240', 240], ['tudo', null], ['007', 7]])('--historico-max %s valido', (v, esperado) => {
    const r = ok(['--entrada', 'a.csv', '--relatorio', 'p1b', '--historico-max', v]);
    expect(r.ok && r.modo === 'p1b' && r.opcoes.backtest.historicoMaximo).toBe(esperado);
  });
  it.each([['0'], ['241'], ['2,5'], ['2.5'], ['abc'], [''], ['-1'], ['TUDO']])('--historico-max %j invalido', (v) => {
    expect(ok(['--entrada', 'a.csv', '--relatorio', 'p1b', '--historico-max', v]).ok).toBe(false);
  });
  it('--correcao-nivel sim|nao so com --gerar-calibracao; outro valor ou sem a flag -> erro', () => {
    const modo = (v: string) => ok(['--entrada', 'a.csv', '--relatorio', 'p1b', '--gerar-calibracao', '--correcao-nivel', v]);
    const sim = modo('sim');
    expect(sim.ok && sim.modo === 'p1b' && sim.opcoes).toMatchObject({ gerarCalibracao: true, correcaoNivel: true });
    const nao = modo('nao');
    expect(nao.ok && nao.modo === 'p1b' && nao.opcoes.correcaoNivel).toBe(false);
    expect(modo('talvez')).toEqual({ ok: false, erro: '--correcao-nivel deve ser sim ou nao' });
    expect(ok(['--entrada', 'a.csv', '--relatorio', 'p1b', '--correcao-nivel', 'sim'])).toEqual({ ok: false, erro: '--correcao-nivel so vale com --gerar-calibracao' });
  });
  it.each([
    [['--entrada', 'a.csv', '--relatorio', 'p1b', '--gerar-calibracao', '--detalhe'], '--gerar-calibracao nao vale com --detalhe'],
    [['--entrada', 'a.csv', '--relatorio', 'p1b', '--metodos', 'ses'], '--metodos nao vale com --relatorio p1b'],
    [['--entrada', 'a.csv', '--relatorio', 'p9'], '--relatorio deve ser p0, p1 ou p1b'],
    [['--entrada', 'a.csv', '--historico-max', '7'], '--historico-max so vale com --relatorio p1b'],
    [['--entrada', 'a.csv', '--relatorio', 'p1', '--gerar-calibracao'], '--gerar-calibracao so vale com --relatorio p1b'],
    [['--entrada', 'a.csv', '--relatorio', 'p0', '--correcao-nivel', 'sim'], '--correcao-nivel so vale com --relatorio p1b'],
    [['--entrada', 'a.csv', '--relatorio', 'p1b', '--historico-max'], 'faltou o valor de --historico-max'],
    [['--entrada', 'a.csv', '--relatorio', 'p1b', '--historico-max', '7', '--historico-max', '8'], 'argumento repetido: --historico-max'],
    [['--entrada', 'a.csv', '--relatorio', 'p1b', '--gerar-calibracao', '--gerar-calibracao'], 'argumento repetido: --gerar-calibracao'],
    [['--entrada', 'a.csv', '--relatorio', 'p1b', '--relatorio', 'p1b'], 'argumento repetido: --relatorio'],
    [['--entrada', 'a.csv', '--relatorio'], 'faltou o valor de --relatorio'],
    [['--entrada', 'a.csv', '--relatorio', 'p1b', '--teto-vies', '2'], '--teto-vies deve ser um numero de 0 a 1 (ex.: 0,10) ou sem (padrao: sem)'],
    [['--relatorio', 'p1b'], 'informe exatamente um entre --entrada e --quinzena'],
    [['--entrada', 'a.csv', '--relatorio', 'p1b', '--horizonte', '13'], 'opcoes invalidas: horizonte deve ser inteiro de 1 a 12'],
  ])('%j -> %s', (argv, erro) => {
    expect(ok(argv)).toEqual({ ok: false, erro });
  });
  it('p0/p1 sem flag propria -> delegar (argv intacto)', () => {
    for (const argv of [['--entrada', 'a.csv'], ['--entrada', 'a.csv', '--relatorio', 'p0'], ['--entrada', 'a.csv', '--relatorio', 'p1', '--teto-vies', '0,1']]) expect(ok(argv)).toEqual({ ok: true, modo: 'delegar' });
  });
});

describe('executarCliRef: delegacao p0/p1 byte a byte com executarCliP1', () => {
  it.each([
    [['--entrada', ARQ[1], '--relatorio', 'p0']],
    [['--entrada', ARQ[1]]],
    [['--entrada', ARQ[1], '--formato', 'json', '--detalhe']],
    [['--entrada', ARQ[1], '--teto-vies', '0,10']],
    [['--entrada', 'C:\\proj\\main\\dados.csv']],
    [['--entrada', ARQ[1], '--horizonte', '13']],
  ])('%j', (argv) => {
    expect(executarCliRef(argv, dFix())).toEqual(executarCliP1(argv, dFix()));
  });
  it('hashConfig do p1 inalterado (hashConfigP1) e o do p1b e o da referencia', () => {
    const p1 = JSON.parse(executarCliRef([...ARQ, '--formato', 'json'], dFix()).saida);
    expect(p1.hashConfig).toBe(hashConfigP1());
    expect(p1.versao).toBe('p1.1.0');
    expect(json().hashConfig).toBe(hashConfigRef());
    expect(hashConfigRef()).not.toBe(hashConfigP1());
  });
});

describe('relatorio p1b', () => {
  it('texto: codigo 0, 1a linha, secoes, so ASCII, sem id nem fonte sem --detalhe', () => {
    const r = p1b();
    expect(r.codigo).toBe(0);
    expect(r.erro).toBe('');
    expect(r.saida.split('\n')[0]).toMatch(/^Forecast preditivo - referencia P1b {3}versao p1\.1\.0 {3}config [0-9a-f]{8} {3}entrada [0-9a-f]{8}$/);
    for (const t of ['referencia-corrigida', 'Criterio 7 (TOTAL', 'Rupt sim', 'Por horizonte (TOTAL)', 'historico maximo tudo', 'Marcas: recebidas 1 | aplicadas 1', 'ruptura ignorada 2 pontos', 'atipico da entrada ignorado 1', 'Correcao de nivel', 'desligada', 'Fator aplicado', 'Amostra: pares']) expect(r.saida).toContain(t);
    expect(ascii(r.saida)).toBe(true);
    for (const id of ['CONST', 'RUPT', 'F01', 'FAM1', 'ATENCAO']) expect(r.saida).not.toContain(id);
  });
  it('texto com --detalhe: aviso, por serie e fontes; mesma coisa em JSON', () => {
    const r = p1b('--detalhe');
    expect(r.saida).toContain('ATENCAO:');
    for (const id of ['CONST', 'RUPT', 'Por serie', 'Fontes (rotulo -> fonte)', 'fonte-01 -> F']) expect(r.saida).toContain(id);
    expect(ascii(r.saida)).toBe(true);
    const j = json('--detalhe');
    expect(j.aviso).toContain('nao colar');
    expect(j.fontes.length).toBeGreaterThan(0);
    expect(j.cenarios[0].porSerie.some((s: { id: string }) => s.id === 'CONST')).toBe(true);
  });
  it('JSON: so ASCII, sem id sem --detalhe, chaves exatas (topo, opcoes, cenario, linha) e ordem', () => {
    const t = p1b('--formato', 'json').saida;
    expect(ascii(t)).toBe(true);
    expect(t).not.toMatch(/CONST|"F01"|FAM/);
    const j = JSON.parse(t);
    expect(Object.keys(j)).toEqual(['versao', 'hashConfig', 'hashEntrada', 'opcoes', 'cenariosMinTreino', 'linhasRejeitadas', 'marcas', 'cenarios']);
    expect(Object.keys(j.opcoes)).toEqual(['horizonte', 'minTreino', 'leadTimePadraoDias', 'razaoFaltaExcesso', 'usarMascara', 'tetoVies', 'historicoMaximo', 'parametrosCorrecao']);
    expect(Object.keys(j.marcas)).toEqual(['recebidas', 'aplicadas', 'invalidas', 'semSerie', 'foraDaSerie', 'duplicadas', 'rupturaIgnorada', 'atipicoDaEntradaIgnorado']);
    expect(Object.keys(j.cenarios[0])).toEqual(['minTreino', 'principal', 'origens', 'origensComObservacao', 'metades', 'contagem', 'contagemSegmentos', 'amostra', 'correcao', 'criterio7', 'linhas']);
    expect(Object.keys(j.cenarios[0].linhas[0])).toEqual([
      'segmento', 'variante', 'n', 'origens', 'nFallback', 'wapeH1', 'wapeH3', 'wapeLT', 'wapeRef', 'wapeRel', 'viesLT', 'viesRef', 'maeLT', 'custoLT', 'custoRel', 'faltaLT', 'excessoLT', 'vitoria', 'cobertura',
      'nIntervalo', 'nPoolTotal', 'pinball10', 'pinball90', 'metade1', 'metade2', 'criteriosFalhos', 'promovivel', 'wapeH', 'custoH', 'custoRelH', 'faltaH', 'excessoH', 'coberturaH', 'nIntervaloH', 'rupturaSimulada', 'criterio7', 'nItensAPiores',
    ]);
    expect(j.cenarios[0].linhas[0].variante).toBe('planilha-q');
    expect('tabelas' in j.cenarios[0]).toBe(false);
  });
  it('determinismo: duas execucoes iguais; quinzena 10-2 com min-treino 3 sai 0 (cenario 12 sem pares)', () => {
    expect(p1b('--formato', 'json').saida).toBe(p1b('--formato', 'json').saida);
    const q = executarCliRef(['--quinzena', 'tests/fixtures/forecast/quinzena-10-2.anon.json', '--relatorio', 'p1b', '--min-treino', '3'], dFix());
    expect(q.codigo).toBe(0);
    expect(q.saida).toContain('Sem pares');
  });
});

describe('integracao flag -> funcao', () => {
  it('--historico-max 7 chega a opcoes.historicoMaximo, muda o resultado e a tabela; tudo = null', () => {
    const tudo = json();
    const sete = json('--historico-max', '7');
    expect(tudo.opcoes.historicoMaximo).toBeNull();
    expect(sete.opcoes.historicoMaximo).toBe(7);
    expect(sete.cenarios.map((c: { linhas: unknown }) => c.linhas)).not.toEqual(tudo.cenarios.map((c: { linhas: unknown }) => c.linhas));
    expect(p1b('--historico-max', '7').saida).toContain('historico maximo 7');
    const tab = (...x: string[]) => JSON.parse(p1b('--gerar-calibracao', '--historico-max', ...x).saida).parametros.historicoMaximo;
    expect(tab('7')).toBe(7);
  });
  it('--razao-falta-excesso 5 muda custoH (e chega a opcoes)', () => {
    const a = json();
    const b = json('--razao-falta-excesso', '5');
    expect(b.opcoes.razaoFaltaExcesso).toBe(5);
    const custo = (j: typeof a) => j.cenarios[0].linhas.find((l: { segmento: string; variante: string }) => l.segmento === 'TOTAL' && l.variante === 'referencia').custoH[0];
    expect(custo(b)).toBeGreaterThan(custo(a));
  });
  it('--teto-vies 0,10 muda criteriosFalhos de algum caso (serie construida: vies acima de 10% que passa o relativo)', () => {
    // 30 series crescentes (6% ao mes), 24 meses, lead time 60 dias: todos os metodos subestimam; o relativo aceita, o teto absoluto reprova
    const linhas = ['serie;anoMes;quantidade;atipico;ruptura;fonte;familia;leadTimeDias'];
    for (let i = 0; i < 30; i++) for (let t = 0; t < 24; t++) linhas.push(['C' + i, `${2025 + Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`, String(Math.round((50 + 5 * i) * Math.pow(1.06, t))), '0', '0', 'F01', 'FAM1', '60'].join(';'));
    const d = deps({ [FIX]: linhas.join('\n') + '\n' });
    const rodar = (...x: string[]) => JSON.parse(executarCliRef([...ARQ, '--relatorio', 'p1b', '--formato', 'json', '--min-treino', '12', ...x], d).saida);
    const falhos = (j: ReturnType<typeof rodar>) => j.cenarios[0].linhas.filter((l: { variante: string }) => l.variante !== 'planilha-q').map((l: { criteriosFalhos: number[] }) => l.criteriosFalhos);
    const sem = rodar();
    const com = rodar('--teto-vies', '0,10');
    expect(com.opcoes.tetoVies).toBe(0.1);
    expect(sem.opcoes.tetoVies).toBeNull();
    expect(falhos(com)).not.toEqual(falhos(sem));
    expect(falhos(com).some((f: number[]) => f.includes(3))).toBe(true);
  });
  it('--sem-mascara mantem amostra.pares (elegibilidade por meses de calendario)', () => {
    const a = json();
    const b = json('--sem-mascara');
    expect(b.opcoes.usarMascara).toBe(false);
    expect(b.cenarios.map((c: { amostra: { pares: number } }) => c.amostra.pares)).toEqual(a.cenarios.map((c: { amostra: { pares: number } }) => c.amostra.pares));
    expect(b.marcas.aplicadas).toBe(0);
    expect(a.marcas.aplicadas).toBe(1);
  });
  it('coluna ruptura=1 do CSV conta em "ruptura ignorada" e nao mascara nada', () => {
    const base = ['serie;anoMes;quantidade;atipico;ruptura', ...Array.from({ length: 12 }, (_, t) => `X;2025-${String(t + 1).padStart(2, '0')};100;0;${t < 3 ? 1 : 0}`)];
    const r = executarCliRef(['--entrada', 'tests/fixtures/forecast/preditivo-sinteticas.csv', '--relatorio', 'p1b', '--formato', 'json'], deps({ [FIX]: base.join('\n') + '\n' }));
    const j = JSON.parse(r.saida);
    expect(j.marcas.rupturaIgnorada).toBe(3);
    expect(j.marcas.recebidas).toBe(0);
  });
  it('--gerar-calibracao: sai 0, saida lida por lerTabelaCalibracao com correcaoNivel igual ao pedido; ignora --formato; so agregados', () => {
    const padrao = p1b('--gerar-calibracao');
    expect(padrao.codigo).toBe(0);
    const lida = lerTabelaCalibracao(padrao.saida);
    expect(lida.ok && lida.tabela.correcaoNivel).toBe(false);
    expect(lida.ok && lida.tabela.mensal.length).toBeGreaterThan(0);
    expect(lida.ok && tabelaJson(lida.tabela)).toBe(padrao.saida);
    const sim = lerTabelaCalibracao(p1b('--gerar-calibracao', '--correcao-nivel', 'sim').saida);
    expect(sim.ok && sim.tabela.correcaoNivel).toBe(true);
    expect(p1b('--gerar-calibracao', '--formato', 'json').saida).toBe(padrao.saida);
    expect(p1b('--gerar-calibracao', '--formato', 'texto').saida).toBe(padrao.saida);
    expect(ascii(padrao.saida) && padrao.saida.endsWith('}\n')).toBe(true);
    expect(padrao.saida).not.toMatch(/CONST|F01|FAM|\.csv/);
    expect(Object.keys(JSON.parse(padrao.saida))).toEqual(['formato', 'versao', 'hashConfig', 'correcaoNivel', 'parametros', 'ultimoMes', 'mensal', 'leadTime', 'nivel']);
  });
});

describe('erros do p1b', () => {
  it('caminho recusado, arquivo ausente e excecao em lerTexto (sem vazar a mensagem)', () => {
    expect(executarCliRef(['--entrada', 'C:\\proj\\main\\dados.csv', '--relatorio', 'p1b'], dFix()).codigo).toBe(2);
    expect(executarCliRef(['--entrada', 'C:\\dados\\nao-existe.csv', '--relatorio', 'p1b'], dFix())).toEqual({ codigo: 2, saida: '', erro: 'arquivo de entrada nao encontrado\n' });
    const ruim = executarCliRef([...ARQ, '--relatorio', 'p1b'], deps({ [FIX]: CSV }, { lerTexto: () => { throw new Error('SEGREDO-123'); } }));
    expect(ruim).toEqual({ codigo: 1, saida: '', erro: 'erro inesperado (Error)\n' });
  });
  it('desempenho: 160 series de 36 meses em segundos', () => {
    const t0 = Date.now();
    const r = executarCliRef([...ARQ, '--relatorio', 'p1b', '--formato', 'json'], deps({ [FIX]: gerarCsvDesempenho(160) }));
    expect(r.codigo).toBe(0);
    // Medido ~9-12 s sozinho; 60 s e so a rede de seguranca contra regressao quadratica quando a maquina esta carregada (suite
    // inteira, outros processos). O gate de desempenho do plano (CLI real < 20 s e razao T320/T160 <= 2,5) continua no passo manual.
    expect(Date.now() - t0).toBeLessThan(60000);
  });
});
