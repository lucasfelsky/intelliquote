// Argumentos e guardas do CLI da conferencia da FUP Indent (sem banco; fixture sintetica).
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LINHAS_SINTETICAS, montarFupSintetica } from './helpers/indentFupFixture';
import { caminhoReal, dentroDoRepoReal, hojeEmBrasilia, lerArgumentos, lerCadastrosSomenteLeitura } from '../src/utils/indentFupCli';

const RAIZ = path.resolve(os.tmpdir(), 'indent-fup-cli-repo-sintetico');
const FORA = path.resolve(os.tmpdir(), 'indent-fup-cli-fora-sintetico');
const URL_BANCO = 'postgresql://usuario:segredo@db.exemplo.test:5432/indent';
const BANCO = 'db.exemplo.test:5432/indent';
const AGORA = new Date('2026-11-13T15:00:00Z');
const ctx = { raizRepo: RAIZ, databaseUrl: URL_BANCO, agora: AGORA };
const fup = path.join(FORA, 'fup.xlsx');
const base = ['--planilha', fup, '--saida', path.join(FORA, 'saida.xlsx')];

describe('modos e guarda do repositorio', () => {
  it('conferencia valida: padroes de janela (24 meses) e data de referencia (hoje em Brasilia)', () => {
    expect(lerArgumentos(['--conferencia', '--sem-banco', ...base], ctx)).toEqual({
      ok: true,
      modo: 'conferencia',
      planilha: fup,
      saida: path.join(FORA, 'saida.xlsx'),
      semBanco: true,
      dataReferencia: '2026-11-13',
      janelaVinculosMeses: 24,
    });
  });

  it('--saida dentro do repo e recusada (codigo 2), assim como --de-para', () => {
    const dentro = path.join(RAIZ, 'programa', 'relatorio.xlsx');
    expect(lerArgumentos(['--conferencia', '--planilha', fup, '--saida', dentro], ctx)).toMatchObject({ ok: false, codigo: 2 });
    const r = lerArgumentos(['--aplicar', '--planilha', fup, '--saida', path.join(FORA, 'd.xlsx'), '--de-para', path.join(RAIZ, 'x.xlsx')], ctx);
    expect(r).toMatchObject({ ok: false, codigo: 2 });
    expect(lerArgumentos(['--aplicar', '--planilha', fup, '--saida', path.join(FORA, 'd.xlsx'), '--de-para', path.join(FORA, 'x.xlsx')], ctx)).toMatchObject({
      ok: true,
      modo: 'aplicar',
      gravar: false,
      deParaArquivo: path.join(FORA, 'x.xlsx'),
    });
  });

  it('--conferencia recusa --gravar (e demais flags de escrita)', () => {
    for (const extra of [['--gravar'], ['--confirmo-banco', BANCO], ['--operador', 'fulano'], ['--de-para', path.join(FORA, 'x.xlsx')]]) {
      expect(lerArgumentos(['--conferencia', ...base, ...extra], ctx)).toMatchObject({ ok: false, codigo: 2 });
    }
  });

  it('--gravar exige --confirmo-banco igual ao host:porta/banco da DATABASE_URL e --operador', () => {
    const aplicar = ['--aplicar', ...base];
    expect(lerArgumentos([...aplicar, '--gravar'], ctx)).toMatchObject({ ok: false, codigo: 2 });
    expect(lerArgumentos([...aplicar, '--gravar', '--confirmo-banco', 'outro:5432/x', '--operador', 'f'], ctx)).toMatchObject({ ok: false, codigo: 2 });
    expect(lerArgumentos([...aplicar, '--gravar', '--confirmo-banco', BANCO], ctx)).toMatchObject({ ok: false, codigo: 2 });
    expect(lerArgumentos([...aplicar, '--gravar', '--confirmo-banco', BANCO, '--operador', 'f', '--sem-banco'], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos([...aplicar, '--gravar', '--confirmo-banco', BANCO, '--operador', 'f'], { ...ctx, databaseUrl: 'invalida' })).toMatchObject({ ok: false });
    expect(lerArgumentos([...aplicar, '--gravar', '--confirmo-banco', BANCO, '--operador', 'f'], ctx)).toMatchObject({
      ok: true,
      modo: 'aplicar',
      gravar: true,
      confirmoBanco: BANCO,
      operador: 'f',
    });
  });

  it('o erro nunca vaza a senha da DATABASE_URL', () => {
    const r = lerArgumentos(['--aplicar', ...base, '--gravar', '--confirmo-banco', 'outro:5432/x', '--operador', 'f'], ctx);
    expect(JSON.stringify(r)).not.toContain('segredo');
  });

  it('--confirmo-banco/--operador sem --gravar e --fonte fora de --reconciliar sao recusados', () => {
    expect(lerArgumentos(['--aplicar', ...base, '--confirmo-banco', BANCO], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--aplicar', ...base, '--operador', 'f'], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--aplicar', ...base, '--fonte', 'planilha'], ctx)).toMatchObject({ ok: false });
  });

  it('reconciliar: --fonte obrigatoria; sem janela, sem banco, sem gravar', () => {
    expect(lerArgumentos(['--reconciliar', ...base], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--reconciliar', '--fonte', 'xml', ...base], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--reconciliar', '--fonte', 'planilha', ...base], ctx)).toEqual({
      ok: true,
      modo: 'reconciliar',
      fonte: 'planilha',
      planilha: fup,
      saida: path.join(FORA, 'saida.xlsx'),
    });
    expect(lerArgumentos(['--reconciliar', '--fonte', 'banco', ...base], ctx)).toMatchObject({ ok: true, fonte: 'banco' });
    for (const extra of [['--sem-banco'], ['--gravar'], ['--janela-vinculos-meses', '12'], ['--data-referencia', '2026-11-13']]) {
      expect(lerArgumentos(['--reconciliar', '--fonte', 'planilha', ...base, ...extra], ctx)).toMatchObject({ ok: false });
    }
  });

  it('modo obrigatorio e unico; argumentos desconhecidos, repetidos ou sem valor; extensoes', () => {
    expect(lerArgumentos([...base], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--conferencia', '--aplicar', ...base], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--conferencia', ...base, '--xyz'], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--conferencia', '--conferencia', ...base], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--conferencia', '--planilha'], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--conferencia', '--planilha', fup], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--conferencia', '--planilha', path.join(FORA, 'a.csv'), '--saida', path.join(FORA, 'b.xlsx')], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--conferencia', '--planilha', fup, '--saida', path.join(FORA, 'b.csv')], ctx)).toMatchObject({ ok: false });
  });
});

describe('guarda de caminho real (junction, 8.3, prefixo longo, ..x) e saida != entrada', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'indent-fup-guarda-'));
  const repo = path.join(pasta, 'repo');
  const fora = path.join(pasta, 'fora');
  const planilhaFora = path.join(fora, 'f.xlsx');
  const deParaFora = path.join(fora, 'dp.xlsx');
  const links: string[] = [];
  const PREFIXO_LONGO = '\\\\?\\'; // \\?\
  fs.mkdirSync(path.join(repo, 'programa'), { recursive: true });
  fs.mkdirSync(fora, { recursive: true });
  fs.writeFileSync(planilhaFora, 'x');
  fs.writeFileSync(deParaFora, 'y');
  const c = { raizRepo: repo, databaseUrl: URL_BANCO, agora: AGORA };
  const saidaEm = (s: string) => lerArgumentos(['--conferencia', '--planilha', planilhaFora, '--saida', s], c);
  const deParaEm = (d: string) =>
    lerArgumentos(['--aplicar', '--planilha', planilhaFora, '--saida', path.join(fora, 'dry.xlsx'), '--de-para', d], c);

  function juncao(alvo: string, nome: string): string {
    const caminho = path.join(fora, nome);
    fs.symlinkSync(alvo, caminho, 'junction');
    links.push(caminho);
    return caminho;
  }
  afterAll(() => {
    // Remove a juncao/link SEM tocar no alvo, e so depois a pasta temporaria.
    for (const l of links) {
      try {
        fs.rmdirSync(l);
      } catch {
        try {
          fs.unlinkSync(l);
        } catch {
          /* ignora */
        }
      }
    }
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  it('dentro do repo e recusado; fora e aceito; subpasta ..x dentro e recusada, fora (..x) e aceita', () => {
    expect(saidaEm(path.join(repo, 'programa', 'r.xlsx'))).toMatchObject({ ok: false, codigo: 2 });
    expect(saidaEm(path.join(repo, 'r.xlsx'))).toMatchObject({ ok: false, codigo: 2 });
    expect(saidaEm(path.join(repo, '..dados', 'r.xlsx'))).toMatchObject({ ok: false, codigo: 2 });
    expect(saidaEm(path.join(repo, 'a', '..', '..dados', 'r.xlsx'))).toMatchObject({ ok: false, codigo: 2 });
    expect(saidaEm(path.join(fora, 'r.xlsx'))).toMatchObject({ ok: true });
    expect(saidaEm(path.join(pasta, '..externo', 'r.xlsx'))).toMatchObject({ ok: true });
    expect(deParaEm(path.join(repo, '..dados', 'dp.xlsx'))).toMatchObject({ ok: false, codigo: 2 });
  });

  it('junction FORA do repo apontando para DENTRO dele e recusada (--saida e --de-para)', () => {
    const jct = juncao(repo, 'jct');
    expect(saidaEm(path.join(jct, 'programa', 'r.xlsx'))).toMatchObject({ ok: false, codigo: 2 });
    expect(saidaEm(path.join(jct, 'programa', 'novo', 'r.xlsx'))).toMatchObject({ ok: false, codigo: 2 });
    expect(deParaEm(path.join(jct, 'programa', 'dp.xlsx'))).toMatchObject({ ok: false, codigo: 2 });
    expect(dentroDoRepoReal(path.join(jct, 'programa', 'r.xlsx'), repo)).toBe(true);
    // A juncao para uma pasta de FORA nao atrapalha.
    const jctFora = juncao(fora, 'jct-fora');
    expect(saidaEm(path.join(jctFora, 'r.xlsx'))).toMatchObject({ ok: true });
  });

  it.runIf(process.platform === 'win32')('Windows: caixa trocada, barras, prefixo de caminho longo e nome curto 8.3 sao recusados', () => {
    const dentro = path.join(repo, 'programa', 'r.xlsx');
    expect(saidaEm(dentro.toUpperCase())).toMatchObject({ ok: false, codigo: 2 });
    expect(saidaEm(dentro.toLowerCase())).toMatchObject({ ok: false, codigo: 2 });
    expect(saidaEm(dentro.split('\\').join('/'))).toMatchObject({ ok: false, codigo: 2 });
    expect(saidaEm(PREFIXO_LONGO + dentro)).toMatchObject({ ok: false, codigo: 2 });
    expect(deParaEm(PREFIXO_LONGO + path.join(repo, 'dp.xlsx'))).toMatchObject({ ok: false, codigo: 2 });
    const pastaProgramas = path.join(repo, 'programa');
    const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${pastaProgramas}") do @echo %~sI"`], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
    });
    const curto = r.status === 0 ? r.stdout.trim() : '';
    if (curto !== '' && curto.toLowerCase() !== pastaProgramas.toLowerCase()) {
      expect(saidaEm(path.join(curto, 'r.xlsx'))).toMatchObject({ ok: false, codigo: 2 });
    }
  });

  it('--saida igual a --planilha ou a --de-para e recusada (inclusive por caixa e por juncao)', () => {
    expect(lerArgumentos(['--conferencia', '--planilha', planilhaFora, '--saida', planilhaFora], c)).toMatchObject({ ok: false, codigo: 2 });
    expect(lerArgumentos(['--conferencia', '--planilha', planilhaFora, '--saida', path.join(fora, '.', 'f.xlsx')], c)).toMatchObject({ ok: false });
    if (process.platform === 'win32') {
      expect(lerArgumentos(['--conferencia', '--planilha', planilhaFora, '--saida', planilhaFora.toUpperCase()], c)).toMatchObject({ ok: false });
    }
    const alias = juncao(fora, 'jct-mesma');
    expect(lerArgumentos(['--conferencia', '--planilha', planilhaFora, '--saida', path.join(alias, 'f.xlsx')], c)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--reconciliar', '--fonte', 'planilha', '--planilha', planilhaFora, '--saida', planilhaFora], c)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--aplicar', '--planilha', planilhaFora, '--de-para', deParaFora, '--saida', deParaFora], c)).toMatchObject({ ok: false, codigo: 2 });
    expect(lerArgumentos(['--aplicar', '--planilha', planilhaFora, '--de-para', path.join(alias, 'dp.xlsx'), '--saida', deParaFora], c)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--aplicar', '--planilha', planilhaFora, '--de-para', deParaFora, '--saida', path.join(fora, 'dry.xlsx')], c)).toMatchObject({ ok: true });
  });

  it('caminhoReal: arquivo inexistente resolve pelo ancestral existente', () => {
    const real = caminhoReal(path.join(fora, 'nao', 'existe', 'x.xlsx'));
    expect(real).not.toBeNull();
    expect(path.basename(real as string)).toBe('x.xlsx');
  });
});

describe('janela de vinculos e data de referencia', () => {
  it('--janela-vinculos-meses: inteiro entre 1 e 240', () => {
    const c = (v: string) => lerArgumentos(['--conferencia', ...base, '--janela-vinculos-meses', v], ctx);
    expect(c('12')).toMatchObject({ ok: true, janelaVinculosMeses: 12 });
    expect(c('1')).toMatchObject({ ok: true, janelaVinculosMeses: 1 });
    expect(c('240')).toMatchObject({ ok: true, janelaVinculosMeses: 240 });
    for (const ruim of ['0', '241', '-1', '1.5', 'abc', '']) expect(c(ruim), ruim).toMatchObject({ ok: false, codigo: 2 });
  });

  it('--data-referencia: data real AAAA-MM-DD; invalida sai 2', () => {
    const c = (v: string) => lerArgumentos(['--aplicar', ...base, '--data-referencia', v], ctx);
    expect(c('2026-11-13')).toMatchObject({ ok: true, dataReferencia: '2026-11-13' });
    for (const ruim of ['2026-02-30', '13/11/2026', '2026-13-01', 'hoje']) expect(c(ruim), ruim).toMatchObject({ ok: false, codigo: 2 });
  });

  it('padrao de data: hoje em Brasilia (UTC-3), nao em UTC', () => {
    expect(hojeEmBrasilia(new Date('2026-11-14T01:30:00Z'))).toBe('2026-11-13');
    expect(hojeEmBrasilia(new Date('2026-11-13T02:59:00Z'))).toBe('2026-11-12');
    expect(hojeEmBrasilia(new Date('2026-11-13T03:00:00Z'))).toBe('2026-11-13');
    const r = lerArgumentos(['--conferencia', ...base], { ...ctx, agora: new Date('2026-11-14T01:30:00Z') });
    expect(r).toMatchObject({ ok: true, dataReferencia: '2026-11-13' });
  });
});

describe('leitura dos cadastros: transacao somente leitura', () => {
  it('SET TRANSACTION READ ONLY e a 1a instrucao e so ha leituras', async () => {
    const chamadas: string[] = [];
    const leitura = (nome: string, linhas: unknown[]) => ({
      findMany: vi.fn(async () => {
        chamadas.push(nome);
        return linhas;
      }),
    });
    const tx = {
      $executeRaw: vi.fn(async (partes: TemplateStringsArray) => {
        chamadas.push(partes.join(''));
        return 0;
      }),
      indentSupplier: leitura('fornecedor', [{ id: 1, name: 'F', nameKey: 'f' }]),
      indentClient: leitura('cliente', [{ id: 2, name: 'C', supplierRuleMode: 'LIVRE' }]),
      indentProduct: leitura('produto', [{ id: 3, name: 'P', nameKey: 'p' }]),
      indentSupplierProduct: leitura('vinculo', [{ supplierId: 1, productId: 3 }]),
      indentClientSupplierRule: leitura('regra', [{ clientId: 2, supplierId: 1 }]),
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
    const r = await lerCadastrosSomenteLeitura(prisma as never);
    expect(chamadas[0]).toBe('SET TRANSACTION READ ONLY');
    expect(chamadas).toHaveLength(6);
    expect(r).toEqual({
      fornecedores: [{ id: 1, name: 'F', nameKey: 'f' }],
      clientes: [{ id: 2, name: 'C', supplierRuleMode: 'LIVRE' }],
      produtos: [{ id: 3, name: 'P', nameKey: 'p' }],
      vinculos: [{ supplierId: 1, productId: 3 }],
      regras: [{ clientId: 2, supplierId: 1 }],
    });
  });
});

describe('script de ponta a ponta (planilha sintetica em pasta temporaria, sem banco)', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'indent-fup-e2e-'));
  const planilha = path.join(pasta, 'fup-sintetica.xlsx');
  afterAll(() => fs.rmSync(pasta, { recursive: true, force: true }));

  function rodar(args: string[], env: Record<string, string> = {}) {
    return spawnSync(
      process.execPath,
      ['node_modules/ts-node/dist/bin.js', '--transpile-only', 'scripts/indent-fup-carga.ts', ...args],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATABASE_URL: URL_BANCO, ...env }, timeout: 120_000 },
    );
  }

  it('conferencia e reconciliacao gravam o XLSX fora do repo; stdout so com contagens', async () => {
    await (await montarFupSintetica()).xlsx.writeFile(planilha);
    const saida = path.join(pasta, 'relatorio.xlsx');
    const r = rodar(['--conferencia', '--sem-banco', '--data-referencia', '2026-11-13', '--planilha', planilha, '--saida', saida]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`Linhas lidas: ${LINHAS_SINTETICAS.length}`);
    expect(r.stdout).toMatch(/Vínculos fornecedor-produto: entram \d+; já existem 0; fora da janela \d+/);
    expect(r.stdout).toContain('Janela de vínculos: 24 meses, de 2024-11-13 a 2026-11-13');
    expect(r.stdout.trimEnd().endsWith('OK')).toBe(true);
    expect(fs.existsSync(saida)).toBe(true);
    // Nada do conteudo (nomes sinteticos, valores) nem da URL aparece no stdout/stderr.
    for (const proibido of ['FORN', 'CLIENTE', 'PRODUTO', 'segredo', 'db.exemplo.test']) {
      expect(r.stdout + r.stderr).not.toContain(proibido);
    }
    const rec = rodar(['--reconciliar', '--fonte', 'planilha', '--planilha', planilha, '--saida', path.join(pasta, 'rec.xlsx')]);
    expect(rec.status, rec.stderr).toBe(0);
    expect(rec.stdout).toContain('Meses comparados: 24; divergentes (tolerância 0.01): 0');
  }, 180_000);

  it('saida dentro do repo, gravar e fonte banco sao recusados com saida 2 sem tocar em nada', () => {
    const dentro = rodar(['--conferencia', '--sem-banco', '--planilha', planilha, '--saida', path.join(process.cwd(), 'relatorio-nao-deve-existir.xlsx')]);
    expect(dentro.status).toBe(2);
    expect(fs.existsSync(path.join(process.cwd(), 'relatorio-nao-deve-existir.xlsx'))).toBe(false);
    const relativo = rodar(['--conferencia', '--sem-banco', '--planilha', planilha, '--saida', 'relatorio-relativo-nao-deve-existir.xlsx']);
    expect(relativo.status).toBe(2);
    expect(fs.existsSync(path.join(process.cwd(), 'relatorio-relativo-nao-deve-existir.xlsx'))).toBe(false);
    const mesma = rodar(['--conferencia', '--sem-banco', '--planilha', planilha, '--saida', planilha]);
    expect(mesma.status).toBe(2);
    const gravar = rodar(['--aplicar', '--planilha', planilha, '--saida', path.join(pasta, 'd.xlsx'), '--gravar', '--confirmo-banco', BANCO, '--operador', 'teste']);
    expect(gravar.status).toBe(2);
    expect(fs.existsSync(path.join(pasta, 'd.xlsx'))).toBe(false);
    const banco = rodar(['--reconciliar', '--fonte', 'banco', '--planilha', planilha, '--saida', path.join(pasta, 'r.xlsx')]);
    expect(banco.status).toBe(2);
    const semConfirmo = rodar(['--aplicar', '--planilha', planilha, '--saida', path.join(pasta, 'd.xlsx'), '--gravar', '--operador', 'teste']);
    expect(semConfirmo.status).toBe(2);
  }, 180_000);
});
