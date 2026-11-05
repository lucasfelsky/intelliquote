import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bancoDaUrl,
  lerArgumentos,
  lerCsvAprovado,
  nomeBase,
  paraCsv,
  paraJson,
  sugerirVinculos,
  type OrfaoCatalogo,
  type ProdutoDoForecast,
} from '../src/utils/forecastCatalogoBackfill';

// Dados SINTETICOS (repo publico).
const orfao = (id: number, codigo: string, nomeComercial: string, over: Partial<OrfaoCatalogo> = {}): OrfaoCatalogo => ({
  catalogItemId: id,
  codigo,
  nomeComercial,
  familyId: 1,
  familia: 'Familia TST',
  ...over,
});

const produto = (id: number, nome: string, codigos: ProdutoDoForecast['codigos'], over: Partial<ProdutoDoForecast> = {}): ProdutoDoForecast => ({
  id,
  nome,
  ativo: true,
  origem: 'dbcorp',
  familyId: 1,
  codigos,
  ...over,
});

const codigoDoProduto = (code: string, nomeItem: string | null, catalogItemId: number | null = 900) => ({
  code,
  catalogItemId: nomeItem ? catalogItemId : null,
  nomeComercialDoItem: nomeItem,
});

describe('nomeBase', () => {
  it('tira acento, caixa, espacos e a parte depois do 1o " - "', () => {
    expect(nomeBase('  tst  Pib9000 - BLD 18kg ')).toBe('TST PIB9000');
    expect(nomeBase('Polímero  Ácido')).toBe('POLIMERO ACIDO');
    expect(nomeBase('A - B - C')).toBe('A');
    expect(nomeBase('SEM-HIFEN COLADO')).toBe('SEM-HIFEN COLADO');
  });
});

describe('sugerirVinculos', () => {
  it('alta: um item irmao (mesmo nome base) ja esta em produto ativo de familia compativel', () => {
    const linhas = sugerirVinculos(
      [orfao(1, 'tst9101', 'TST PIB9000 - BLD 18KG')],
      [produto(10, 'PRODUTO TST PIB9000', [codigoDoProduto('TST9100', 'TST PIB9000 - TBR 175KG')])],
    );
    expect(linhas[0]).toMatchObject({
      codigo: 'TST9101',
      produtoSugeridoId: 10,
      confianca: 'alta',
      criterio: 'irmao_catalogo',
      codigosNoProduto: 1,
      vagasAposSugestoes: 5,
      aprovado: '',
    });
  });

  it('alta tambem quando a familia de um dos lados e nula', () => {
    const linhas = sugerirVinculos(
      [orfao(1, 'TST9101', 'TST PIB9000 - BLD', { familyId: null })],
      [produto(10, 'P', [codigoDoProduto('TST9100', 'TST PIB9000 - TBR')], { familyId: 7 })],
    );
    expect(linhas[0].confianca).toBe('alta');
  });

  it('media: irmao em produto de OUTRA familia', () => {
    const linhas = sugerirVinculos(
      [orfao(1, 'TST9101', 'TST PIB9000 - BLD', { familyId: 1 })],
      [produto(10, 'P', [codigoDoProduto('TST9100', 'TST PIB9000 - TBR')], { familyId: 2 })],
    );
    expect(linhas[0]).toMatchObject({ confianca: 'media', criterio: 'irmao_familia_diferente', produtoSugeridoId: 10 });
  });

  it('media: sem irmao, 1 produto cujo nome comeca com o nome base do item', () => {
    const linhas = sugerirVinculos(
      [orfao(1, 'TST9101', 'TST PIB9000 - BLD')],
      [produto(10, 'TST PIB9000 BOMBONA', []), produto(11, 'OUTRO PRODUTO', [])],
    );
    expect(linhas[0]).toMatchObject({ confianca: 'media', criterio: 'nome_do_produto', produtoSugeridoId: 10 });
  });

  it('baixa: varios candidatos; sugere o de mais irmaos e lista os demais', () => {
    const linhas = sugerirVinculos(
      [orfao(1, 'TST9101', 'TST PIB9000 - BLD')],
      [
        produto(10, 'P10', [codigoDoProduto('TST9100', 'TST PIB9000 - TBR')]),
        produto(11, 'P11', [codigoDoProduto('TST9102', 'TST PIB9000 - A'), codigoDoProduto('TST9103', 'TST PIB9000 - B')]),
      ],
    );
    expect(linhas[0]).toMatchObject({ confianca: 'baixa', criterio: 'varios_candidatos', produtoSugeridoId: 11 });
    expect(linhas[0].alternativas).toEqual([{ produtoId: 10, nome: 'P10' }]);
  });

  it('sem_sugestao: nenhum produto parecido', () => {
    const linhas = sugerirVinculos([orfao(1, 'TST9101', 'TST ZZZ0001 - X')], [produto(10, 'P10', [])]);
    expect(linhas[0]).toMatchObject({ confianca: 'sem_sugestao', criterio: 'nenhum', produtoSugeridoId: null });
  });

  it('bloqueada: produto inativo', () => {
    const linhas = sugerirVinculos(
      [orfao(1, 'TST9101', 'TST PIB9000 - BLD')],
      [produto(10, 'P10', [codigoDoProduto('TST9100', 'TST PIB9000 - TBR')], { ativo: false })],
    );
    expect(linhas[0]).toMatchObject({ confianca: 'bloqueada', motivo: 'produto inativo', produtoSugeridoId: 10, produtoAtivo: false });
  });

  it('bloqueada: codigo em mais de um item do catalogo (os dois)', () => {
    const linhas = sugerirVinculos(
      [orfao(1, 'TST9101', 'TST PIB9000 - BLD'), orfao(2, ' tst9101 ', 'TST PIB9000 - TBR')],
      [produto(10, 'P10', [codigoDoProduto('TST9100', 'TST PIB9000 - X')])],
    );
    expect(linhas.map((l) => l.confianca)).toEqual(['bloqueada', 'bloqueada']);
    expect(linhas[0].motivo).toBe('codigo em mais de um item do catalogo');
  });

  it('bloqueada: vagas ACUMULADAS (2 orfaos para um produto com 6 codigos)', () => {
    const seis = ['A', 'B', 'C', 'D', 'E', 'F'].map((l, i) => codigoDoProduto(`TST910${i}`, `TST PIB9000 - ${l}`));
    const linhas = sugerirVinculos(
      [orfao(1, 'TST9201', 'TST PIB9000 - G'), orfao(2, 'TST9202', 'TST PIB9000 - H')],
      [produto(10, 'P10', seis)],
    );
    expect(linhas[0]).toMatchObject({ confianca: 'alta', vagasAposSugestoes: 0 });
    expect(linhas[1]).toMatchObject({ confianca: 'bloqueada', motivo: 'produto com 7 codigos', vagasAposSugestoes: 0 });
  });

  it('produto cheio (7 codigos) ja bloqueia a primeira sugestao', () => {
    const sete = [1, 2, 3, 4, 5, 6, 7].map((i) => codigoDoProduto(`TST930${i}`, `TST PIB9000 - ${i}`));
    const linhas = sugerirVinculos([orfao(1, 'TST9201', 'TST PIB9000 - G')], [produto(10, 'P10', sete)]);
    expect(linhas[0]).toMatchObject({ confianca: 'bloqueada', motivo: 'produto com 7 codigos' });
  });
});

describe('CSV / JSON', () => {
  const linhas = sugerirVinculos(
    [orfao(1, 'TST9101', 'TST "PIB"; 9000 - BLD')],
    [produto(10, 'PRODUTO; TST', [codigoDoProduto('TST9100', 'TST "PIB"; 9000 - TBR')])],
  );

  it('paraCsv: BOM, separador ";", aspas escapadas e aprovado vazio', () => {
    const csv = paraCsv(linhas);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [cabecalho, corpo] = csv.slice(1).split('\r\n');
    expect(cabecalho.split(';')).toContain('aprovado');
    expect(corpo).toContain('"TST ""PIB""; 9000 - BLD"');
    expect(corpo.endsWith(';')).toBe(true);
  });

  it('ida e volta: o humano marca sim e troca o produto; lerCsvAprovado devolve so as aprovadas', () => {
    const duas = sugerirVinculos(
      [orfao(1, 'TST9101', 'TST PIB9000 - BLD'), orfao(2, 'TST9102', 'TST PIB9000 - TBR'), orfao(3, 'TST9103', 'TST PIB9000 - XYZ')],
      [produto(10, 'P10', [codigoDoProduto('TST9100', 'TST PIB9000 - A')])],
    );
    const registros = paraCsv(duas).slice(1).split('\r\n');
    const colunas = registros[0].split(';');
    const iAprovado = colunas.indexOf('aprovado');
    const iProduto = colunas.indexOf('produtoSugeridoId');
    const editar = (registro: string, aprovado: string, produtoId?: string) => {
      const c = registro.split(';');
      c[iAprovado] = aprovado;
      if (produtoId) c[iProduto] = produtoId;
      return c.join(';');
    };
    const texto = [registros[0], editar(registros[1], 'SIM'), editar(registros[2], 'nao'), editar(registros[3], ' Sim ', '77')].join('\r\n');
    const lido = lerCsvAprovado(`\uFEFF${texto}\r\n`);
    expect(lido).toEqual({
      ok: true,
      linhas: [
        { linha: 2, catalogItemId: 1, codigo: 'TST9101', produtoId: 10 },
        { linha: 4, catalogItemId: 3, codigo: 'TST9103', produtoId: 77 },
      ],
    });
  });

  it('lerCsvAprovado ignora vazio/nao e acusa id invalido com o numero da linha', () => {
    const cab = 'aprovado;catalogItemId;codigo;produtoSugeridoId';
    expect(lerCsvAprovado([cab, ';1;TST1;5', 'nao;2;TST2;5'].join('\n'))).toEqual({ ok: true, linhas: [] });
    const ruim = lerCsvAprovado([cab, 'sim;1;TST1;5', 'sim;2;TST2;', 'sim;x;TST3;5'].join('\n'));
    expect(ruim).toEqual({
      ok: false,
      erros: ['Linha 3: produtoSugeridoId invalido ou vazio.', 'Linha 4: catalogItemId invalido.'],
    });
    expect(lerCsvAprovado('a;b\n1;2')).toMatchObject({ ok: false });
    expect(lerCsvAprovado('')).toMatchObject({ ok: false });
  });

  it('paraJson devolve as linhas', () => {
    expect(JSON.parse(paraJson(linhas))).toHaveLength(1);
  });
});

describe('lerArgumentos', () => {
  const raizRepo = path.resolve('C:/repo-tst');
  const fora = path.resolve('C:/fora-tst/proposta.csv');
  const ctx = { raizRepo, databaseUrl: 'postgresql://usuario:segredo@127.0.0.1:5433/banco_tst?schema=public' };

  it('banco da URL e host:porta/banco (nunca usuario nem senha)', () => {
    expect(bancoDaUrl(ctx.databaseUrl)).toBe('127.0.0.1:5433/banco_tst');
    expect(bancoDaUrl('lixo')).toBe('');
  });

  it('--proposta com --saida fora do repo', () => {
    expect(lerArgumentos(['--proposta', '--saida', fora], ctx)).toEqual({ ok: true, modo: 'proposta', saida: fora, formato: 'csv' });
    expect(lerArgumentos(['--proposta', '--saida', fora.replace('.csv', '.json')], ctx)).toMatchObject({ formato: 'json' });
  });

  it('sem --gravar e DRY-RUN', () => {
    expect(lerArgumentos(['--aplicar', '--entrada', fora], ctx)).toEqual({ ok: true, modo: 'aplicar', entrada: fora, gravar: false });
  });

  it('--gravar exige --confirmo-banco igual ao banco da DATABASE_URL', () => {
    const gravar = ['--aplicar', '--entrada', fora, '--gravar'];
    expect(lerArgumentos(gravar, ctx)).toMatchObject({ ok: false, codigo: 2 });
    expect(lerArgumentos([...gravar, '--confirmo-banco', 'outro:5432/banco_tst'], ctx)).toMatchObject({ ok: false, codigo: 2 });
    expect(lerArgumentos([...gravar, '--confirmo-banco', '127.0.0.1:5433/banco_tst'], { ...ctx, databaseUrl: '' })).toMatchObject({
      ok: false,
    });
    expect(lerArgumentos([...gravar, '--confirmo-banco', '127.0.0.1:5433/banco_tst'], ctx)).toEqual({
      ok: true,
      modo: 'aplicar',
      entrada: fora,
      gravar: true,
    });
    // --confirmo-banco sem --gravar tambem e recusado (nao deixa a pessoa achar que gravou).
    expect(lerArgumentos(['--aplicar', '--entrada', fora, '--confirmo-banco', '127.0.0.1:5433/banco_tst'], ctx)).toMatchObject({
      ok: false,
    });
  });

  it('arquivo DENTRO do repo e recusado (dado real nunca entra no repo publico)', () => {
    const dentro = path.join(raizRepo, 'programa', 'proposta.csv');
    expect(lerArgumentos(['--proposta', '--saida', dentro], ctx)).toMatchObject({ ok: false, codigo: 2 });
    expect(lerArgumentos(['--aplicar', '--entrada', dentro], ctx)).toMatchObject({ ok: false, codigo: 2 });
    expect(lerArgumentos(['--proposta', '--saida', path.join(raizRepo, '..', 'irmao', 'p.csv')], ctx)).toMatchObject({ ok: true });
  });

  it('modo ausente, modo duplo, extensao ruim, argumento desconhecido e --proposta com --gravar -> erro', () => {
    expect(lerArgumentos([], ctx)).toMatchObject({ ok: false, codigo: 2 });
    expect(lerArgumentos(['--proposta', '--aplicar', '--saida', fora], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--proposta', '--saida', fora.replace('.csv', '.txt')], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--aplicar', '--entrada', fora.replace('.csv', '.json')], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--proposta', '--saida', fora, '--x'], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--proposta', '--saida', fora, '--gravar'], ctx)).toMatchObject({ ok: false });
    expect(lerArgumentos(['--proposta', '--saida'], ctx)).toMatchObject({ ok: false });
  });
});
