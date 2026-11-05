import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dados SINTETICOS (repo publico). Prisma mockado: aqui se prova a ORDEM (lock antes de tudo), o isolamento por
// linha (1 transacao por linha), o rollback do dry-run e que o service so LE nos modos somente leitura.
vi.mock('../src/lib/prisma', () => {
  const prisma = {
    auditLog: { create: vi.fn() },
    catalogItem: { findMany: vi.fn() },
    forecastProductCode: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    forecastProduct: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    forecastSource: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    itemFamily: { findMany: vi.fn(), findUnique: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prisma };
});

import { prisma } from '../src/lib/prisma';
import {
  criarProdutosNovos,
  gerarModeloProdutosNovos,
  listarFontesParaPlanilha,
} from '../src/services/CatalogItemForecastLinkService';
import { CADASTRO_TX_OPTIONS } from '../src/services/ForecastProductCadastroService';
import { chaveDeNome, LoteInterrompido, type LinhaLida, type LinhaProdutoNovo } from '../src/utils/forecastProdutosNovos';
import { HttpError } from '../src/utils/http';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  auditLog: { create: Mock };
  catalogItem: { findMany: Mock };
  forecastProductCode: Record<'findUnique' | 'findMany' | 'create' | 'update', Mock>;
  forecastProduct: Record<'findUnique' | 'findMany' | 'create', Mock>;
  forecastSource: Record<'findMany' | 'findUnique' | 'updateMany', Mock>;
  itemFamily: Record<'findMany' | 'findUnique', Mock>;
  $executeRaw: Mock;
  $transaction: Mock;
};

interface ItemFalso {
  id: number;
  isActive: boolean;
  dbcorpCode: string;
  familyId: number | null;
}

let itens: ItemFalso[];
let familias: Array<{ id: number; name: string; isActive: boolean }>;
let leadTimeDaFonte: number | null;
let fonteAtiva: boolean;
let chamadasDeAtivos: number;
let promessasDasTransacoes: Array<Promise<unknown>>;
let contadorDeProdutos: number;

function itemFalso(id: number, dbcorpCode: string, familyId: number | null = 3): ItemFalso {
  return { id, isActive: true, dbcorpCode, familyId };
}

beforeEach(() => {
  vi.resetAllMocks();
  itens = [itemFalso(11, 'FIC-001'), itemFalso(12, 'FIC-002'), itemFalso(13, 'FIC-003'), itemFalso(14, 'FIC-004')];
  familias = [
    { id: 3, name: 'FIC Familia', isActive: true },
    { id: 4, name: 'FIC Outra Familia', isActive: true },
    { id: 8, name: 'FIC Familia Inativa', isActive: false },
  ];
  leadTimeDaFonte = 30;
  fonteAtiva = true;
  chamadasDeAtivos = 0;
  contadorDeProdutos = 0;
  promessasDasTransacoes = [];

  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const promessa = fn(prismaMock);
    promessasDasTransacoes.push(promessa);
    return promessa;
  });
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.auditLog.create.mockResolvedValue({});
  // 1a chamada "ativos" de cada transacao = passo 8b; as demais (catalogoPorCodigo do cadastro) sao controladas
  // pelo teste que precisar. Chamadas com `where.id` sao a leitura dos itens da linha.
  prismaMock.catalogItem.findMany.mockImplementation(async ({ where }: { where: { id?: { in: number[] } } }) => {
    if (where.id) return itens.filter((i) => where.id!.in.includes(i.id));
    chamadasDeAtivos += 1;
    return itens.filter((i) => i.isActive).map((i) => ({ id: i.id, dbcorpCode: i.dbcorpCode }));
  });
  prismaMock.forecastProduct.findUnique.mockResolvedValue(null);
  prismaMock.forecastProductCode.findUnique.mockResolvedValue(null);
  prismaMock.forecastProductCode.findMany.mockResolvedValue([]);
  prismaMock.forecastSource.findMany.mockImplementation(async () => [
    { id: 5, name: 'FIC Fonte', isActive: fonteAtiva, leadTimeDays: leadTimeDaFonte },
  ]);
  prismaMock.forecastSource.findUnique.mockImplementation(async () => ({
    id: 5,
    isActive: fonteAtiva,
    leadTimeDays: leadTimeDaFonte,
  }));
  prismaMock.forecastSource.updateMany.mockImplementation(async ({ data }: { data: { leadTimeDays: number } }) => {
    leadTimeDaFonte = data.leadTimeDays;
    return { count: 1 };
  });
  prismaMock.itemFamily.findMany.mockImplementation(async () => familias);
  prismaMock.itemFamily.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) =>
    familias.find((f) => f.id === where.id) ?? null,
  );
  prismaMock.forecastProduct.create.mockImplementation(async ({ data }: { data: { name: string } }) => {
    contadorDeProdutos += 1;
    return { id: 700 + contadorDeProdutos, name: data.name };
  });
  prismaMock.forecastProductCode.create.mockImplementation(
    async ({ data }: { data: { position: number; code: string } }) => ({ id: 900 + data.position, ...data }),
  );
});

function pronta(linha: number, extra: Partial<LinhaProdutoNovo> = {}): LinhaLida {
  const base: LinhaProdutoNovo = {
    linha,
    nome: linha === 2 ? 'FIC PROD A' : 'FIC PROD B',
    codigos: linha === 2 ? ['FIC-001', 'FIC-002'] : ['FIC-003', 'FIC-004'],
    catalogItemIds: linha === 2 ? [11, 12] : [13, 14],
    fonte: 'FIC Fonte',
    chaveFonte: chaveDeNome('FIC Fonte'),
    familia: '',
    leadTimeDias: null,
    leadTimeDaFonteNoArquivo: null,
  };
  return { linha, status: 'pronta', dados: { ...base, ...extra } };
}

const DUAS_LINHAS = (): LinhaLida[] => [pronta(2), pronta(3)];

// Ordens globais (invocationCallOrder) das chamadas de $executeRaw que sao a advisory lock do import.
function ordensDaLockDoImport(): number[] {
  return prismaMock.$executeRaw.mock.calls.flatMap((call, i) => {
    const [sql, ...valores] = call as [readonly string[], ...unknown[]];
    const ehAdvisoryLock = sql.join('').includes('pg_advisory_xact_lock(');
    return ehAdvisoryLock && valores.includes('forecast:import') ? [prismaMock.$executeRaw.mock.invocationCallOrder[i]] : [];
  });
}

function todosOsMocksDeBanco(): Mock[] {
  return [
    prismaMock.auditLog.create,
    prismaMock.catalogItem.findMany,
    prismaMock.forecastProductCode.findUnique,
    prismaMock.forecastProductCode.findMany,
    prismaMock.forecastProductCode.create,
    prismaMock.forecastProductCode.update,
    prismaMock.forecastProduct.findUnique,
    prismaMock.forecastProduct.create,
    prismaMock.forecastSource.findMany,
    prismaMock.forecastSource.findUnique,
    prismaMock.forecastSource.updateMany,
    prismaMock.itemFamily.findMany,
    prismaMock.itemFamily.findUnique,
  ];
}

// Chamadas (ordem global) dentro da janela [inicio, fim).
function naJanela(mock: Mock, inicio: number, fim: number): number[] {
  return mock.mock.invocationCallOrder.filter((ordem) => ordem > inicio && ordem < fim);
}

function janelasDasTransacoes(): Array<[number, number]> {
  const ordens = prismaMock.$transaction.mock.invocationCallOrder;
  return ordens.map((inicio, i): [number, number] => [inicio, ordens[i + 1] ?? Number.POSITIVE_INFINITY]);
}

// Mutante: chamar prisma.$transaction direto (sem executarComVinculo), ler antes da lock, ou usar uma transacao so
// para o lote inteiro. O cadastro grava em ForecastProduct/Code e precisa serializar com o import do Forecast.
describe.each([
  { gravar: false, modo: 'dry-run (rollback forcado)' },
  { gravar: true, modo: '--gravar' },
])('criarProdutosNovos - lock forecast:import e 1 transacao por linha, $modo', ({ gravar }) => {
  it('2 linhas = 2 transacoes com CADASTRO_TX_OPTIONS; a lock vem antes de qualquer leitura ou escrita de CADA uma', async () => {
    const relatorio = await criarProdutosNovos(DUAS_LINHAS(), { gravar });

    expect(relatorio.contagem.aplicado).toBe(2);
    expect(prismaMock.forecastProduct.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    for (const chamada of prismaMock.$transaction.mock.calls) {
      expect(chamada).toEqual([expect.any(Function), CADASTRO_TX_OPTIONS]);
    }

    const locks = ordensDaLockDoImport();
    expect(locks).toHaveLength(2);
    for (const [inicio, fim] of janelasDasTransacoes()) {
      const lockDaJanela = locks.filter((ordem) => ordem > inicio && ordem < fim);
      expect(lockDaJanela).toHaveLength(1);
      const primeiraLeituraOuEscrita = Math.min(...todosOsMocksDeBanco().flatMap((m) => naJanela(m, inicio, fim)));
      expect(Number.isFinite(primeiraLeituraOuEscrita)).toBe(true);
      expect(inicio).toBeLessThan(lockDaJanela[0]);
      expect(lockDaJanela[0]).toBeLessThan(primeiraLeituraOuEscrita);
      expect(lockDaJanela[0]).toBeLessThan(naJanela(prismaMock.catalogItem.findMany, inicio, fim)[0]);
      expect(lockDaJanela[0]).toBeLessThan(naJanela(prismaMock.forecastProduct.create, inicio, fim)[0]);
    }
  });

  it('lista so com linhas ignoradas/erro da leitura: nenhuma transacao e nenhuma escrita', async () => {
    const relatorio = await criarProdutosNovos(
      [
        { linha: 2, status: 'ignorado', motivo: 'nao_aprovado' },
        { linha: 3, status: 'erro', motivo: 'codigos_mais_de_7' },
      ],
      { gravar },
    );
    expect(relatorio.contagem).toEqual({ aplicado: 0, ja_aplicado: 0, conflito: 0, item_mudou: 0, erro: 1, ignorado: 1 });
    expect(relatorio.resultados).toEqual([
      { linha: 2, status: 'ignorado', motivo: 'nao_aprovado', produtoId: null },
      { linha: 3, status: 'erro', motivo: 'codigos_mais_de_7', produtoId: null },
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });
});

describe('criarProdutosNovos - dry-run x gravar', () => {
  it('dry-run: a escrita e simulada de verdade e a transacao de CADA linha rejeita (rollback, sem commit)', async () => {
    const relatorio = await criarProdutosNovos(DUAS_LINHAS(), { gravar: false });

    expect(relatorio).toMatchObject({ gravar: false, contagem: { aplicado: 2, erro: 0 } });
    expect(prismaMock.forecastProduct.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.forecastProductCode.create).toHaveBeenCalledTimes(4);
    const desfechos = await Promise.allSettled(promessasDasTransacoes);
    expect(desfechos.map((d) => d.status)).toEqual(['rejected', 'rejected']);
    // O produto simulado nao existe de verdade: o relatorio nao devolve o id dele.
    expect(relatorio.resultados.map((r) => r.produtoId)).toEqual([null, null]);
  });

  it('--gravar: as transacoes confirmam e o relatorio traz o id do produto criado', async () => {
    const relatorio = await criarProdutosNovos(DUAS_LINHAS(), { gravar: true });

    expect(relatorio).toMatchObject({ gravar: true, contagem: { aplicado: 2 } });
    const desfechos = await Promise.allSettled(promessasDasTransacoes);
    expect(desfechos.map((d) => d.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(relatorio.resultados.map((r) => r.produtoId)).toEqual([701, 702]);
  });

  it('dry-run tambem devolve conflito/erro das linhas (e a transacao nunca confirma)', async () => {
    leadTimeDaFonte = 30;
    const relatorio = await criarProdutosNovos([pronta(2, { leadTimeDias: 45 })], { gravar: false });
    expect(relatorio.resultados[0]).toMatchObject({ status: 'conflito', motivo: 'lead_time_divergente' });
    expect((await Promise.allSettled(promessasDasTransacoes))[0].status).toBe('rejected');
  });
});

describe('criarProdutosNovos - isolamento por linha', () => {
  it('falha do cadastro na linha 1: a transacao dela rejeita (rollback), vira erro e a linha 2 segue', async () => {
    prismaMock.forecastProduct.create.mockRejectedValueOnce(new HttpError(400, 'falha sintetica'));

    const relatorio = await criarProdutosNovos(DUAS_LINHAS(), { gravar: true });

    expect(relatorio.resultados.map((r) => [r.linha, r.status, r.motivo])).toEqual([
      [2, 'erro', 'rejeitado_pelo_cadastro'],
      [3, 'aplicado', null],
    ]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    const desfechos = await Promise.allSettled(promessasDasTransacoes);
    expect(desfechos.map((d) => d.status)).toEqual(['rejected', 'fulfilled']);
  });

  it('cadastro ocupado (P2028) vira erro cadastro_ocupado da linha; as demais seguem', async () => {
    prismaMock.$executeRaw.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('transacao expirou', { code: 'P2028', clientVersion: 'teste' }),
    );

    const relatorio = await criarProdutosNovos(DUAS_LINHAS(), { gravar: true });

    expect(relatorio.resultados.map((r) => [r.linha, r.status, r.motivo])).toEqual([
      [2, 'erro', 'cadastro_ocupado'],
      [3, 'aplicado', null],
    ]);
  });

  it('erro que nao e HttpError aborta o lote (a linha seguinte nem comeca)', async () => {
    prismaMock.forecastProduct.create.mockRejectedValueOnce(new Error('falha inesperada sintetica'));

    await expect(criarProdutosNovos(DUAS_LINHAS(), { gravar: true })).rejects.toThrow('falha inesperada sintetica');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  // Mutante: perder a contagem ao abortar (o script imprimiria 0 ou nada) ou contar a linha que falhou.
  it('erro inesperado na 2a linha: LoteInterrompido carrega so quantas linhas ja foram gravadas (a 1a); causa em cause', async () => {
    const causa = new Error('falha inesperada sintetica');
    prismaMock.forecastProduct.create
      .mockImplementationOnce(async () => ({ id: 701, name: 'FIC PROD A' }))
      .mockRejectedValueOnce(causa);

    const erro = await criarProdutosNovos(DUAS_LINHAS(), { gravar: true }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(LoteInterrompido);
    expect((erro as LoteInterrompido).linhasGravadas).toBe(1);
    expect((erro as LoteInterrompido).cause).toBe(causa);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('dry-run: erro inesperado na 2a linha informa 0 linhas gravadas (nada foi gravado)', async () => {
    prismaMock.forecastProduct.create
      .mockImplementationOnce(async () => ({ id: 701, name: 'FIC PROD A' }))
      .mockRejectedValueOnce(new Error('falha inesperada sintetica'));

    const erro = await criarProdutosNovos(DUAS_LINHAS(), { gravar: false }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(LoteInterrompido);
    expect((erro as LoteInterrompido).linhasGravadas).toBe(0);
  });

  it('erro de unicidade (P2002) no commit vira erro da linha, nao aborta o lote', async () => {
    prismaMock.forecastProductCode.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'teste', meta: { target: ['code'] } }),
    );

    const relatorio = await criarProdutosNovos(DUAS_LINHAS(), { gravar: true });

    expect(relatorio.resultados.map((r) => [r.linha, r.status, r.motivo])).toEqual([
      [2, 'erro', 'rejeitado_pelo_cadastro'],
      [3, 'aplicado', null],
    ]);
  });
});

describe('criarProdutosNovos - vinculo por posicao', () => {
  it('cada codigo recebe o catalogItemId da MESMA posicao, mesmo que o catalogo "por codigo" diga outra coisa', async () => {
    // Ordem trocada de proposito: o id da posicao 1 e MAIOR que o da posicao 2.
    itens = [itemFalso(21, 'FIC-002'), itemFalso(20, 'FIC-001')];
    prismaMock.catalogItem.findMany.mockImplementation(async ({ where }: { where: { id?: { in: number[] } } }) => {
      if (where.id) return itens.filter((i) => where.id!.in.includes(i.id));
      chamadasDeAtivos += 1;
      // 1a leitura de ativos (passo 8b): correta. A do cadastro (catalogoPorCodigo) aponta para ids ERRADOS.
      return chamadasDeAtivos === 1
        ? itens.map((i) => ({ id: i.id, dbcorpCode: i.dbcorpCode }))
        : [{ id: 901, dbcorpCode: 'FIC-001' }, { id: 902, dbcorpCode: 'FIC-002' }];
    });

    const relatorio = await criarProdutosNovos([pronta(2, { catalogItemIds: [20, 21] })], { gravar: true });

    expect(relatorio.contagem.aplicado).toBe(1);
    const criados = prismaMock.forecastProductCode.create.mock.calls.map(
      ([arg]) => (arg as { data: { position: number; code: string; catalogItemId: number } }).data,
    );
    expect(criados).toEqual([
      { productId: 701, position: 1, code: 'FIC-001', catalogItemId: 20 },
      { productId: 701, position: 2, code: 'FIC-002', catalogItemId: 21 },
    ]);
    const auditoria = prismaMock.auditLog.create.mock.calls.map(([arg]) => (arg as { data: Record<string, unknown> }).data);
    expect(auditoria).toContainEqual(
      expect.objectContaining({
        entityType: 'forecast_product',
        action: 'create',
        metadata: expect.objectContaining({ source: 'lote_produtos_novos', catalogItemIds: [20, 21] }),
      }),
    );
  });

  it('codigo em 2 itens ATIVOS do catalogo -> conflito; nada e criado', async () => {
    itens.push(itemFalso(99, 'FIC-001'));
    const relatorio = await criarProdutosNovos([pronta(2)], { gravar: true });
    expect(relatorio.resultados[0]).toMatchObject({ status: 'conflito', motivo: 'codigo_em_mais_de_um_item' });
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });

  it('item que mudou (inexistente, inativo ou com outro codigo) -> item_mudou; nada e criado', async () => {
    itens = itens.filter((i) => i.id !== 12);
    const [inexistente] = (await criarProdutosNovos([pronta(2)], { gravar: true })).resultados;
    expect(inexistente).toMatchObject({ status: 'item_mudou', motivo: 'item_inexistente' });

    itens = [itemFalso(11, 'FIC-001'), { ...itemFalso(12, 'FIC-002'), isActive: false }];
    const [inativo] = (await criarProdutosNovos([pronta(2)], { gravar: true })).resultados;
    expect(inativo).toMatchObject({ status: 'item_mudou', motivo: 'item_inativo' });

    itens = [itemFalso(11, 'FIC-001'), itemFalso(12, 'FIC-777')];
    const [trocado] = (await criarProdutosNovos([pronta(2)], { gravar: true })).resultados;
    expect(trocado).toMatchObject({ status: 'item_mudou', motivo: 'codigo_do_item_mudou' });

    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });
});

describe('criarProdutosNovos - lead time da fonte (nunca sobrescreve)', () => {
  it('fonte COM lead time (30) e linha com 45 -> conflito; nem o lead time nem o produto sao gravados', async () => {
    leadTimeDaFonte = 30;
    const relatorio = await criarProdutosNovos([pronta(2, { leadTimeDias: 45, leadTimeDaFonteNoArquivo: 45 })], {
      gravar: true,
    });
    expect(relatorio.resultados[0]).toMatchObject({ status: 'conflito', motivo: 'lead_time_divergente' });
    expect(prismaMock.forecastSource.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
    expect(leadTimeDaFonte).toBe(30);
  });

  it('fonte COM lead time (30) e celula vazia ou igual -> aplicado; updateMany nao e chamado', async () => {
    leadTimeDaFonte = 30;
    const relatorio = await criarProdutosNovos(
      [pronta(2, { leadTimeDias: null }), pronta(3, { leadTimeDias: 30, leadTimeDaFonteNoArquivo: 30 })],
      { gravar: true },
    );
    expect(relatorio.contagem.aplicado).toBe(2);
    expect(prismaMock.forecastSource.updateMany).not.toHaveBeenCalled();
    expect(leadTimeDaFonte).toBe(30);
  });

  it('fonte SEM lead time + arquivo informa -> grava (so se vazio) antes do produto e audita', async () => {
    leadTimeDaFonte = null;
    const relatorio = await criarProdutosNovos([pronta(2, { leadTimeDias: 45, leadTimeDaFonteNoArquivo: 45 })], {
      gravar: true,
    });
    expect(relatorio.contagem.aplicado).toBe(1);
    expect(prismaMock.forecastSource.updateMany).toHaveBeenCalledWith({
      where: { id: 5, leadTimeDays: null },
      data: { leadTimeDays: 45 },
    });
    expect(prismaMock.forecastSource.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.forecastProduct.create.mock.invocationCallOrder[0],
    );
    const auditoria = prismaMock.auditLog.create.mock.calls.map(([arg]) => (arg as { data: Record<string, unknown> }).data);
    expect(auditoria).toContainEqual(
      expect.objectContaining({
        entityType: 'forecast_source',
        entityId: '5',
        action: 'update',
        metadata: expect.objectContaining({ source: 'lote_produtos_novos' }),
      }),
    );
  });

  it('fonte SEM lead time e nenhuma linha informa -> erro lead_time_ausente; nada e gravado', async () => {
    leadTimeDaFonte = null;
    const relatorio = await criarProdutosNovos([pronta(2)], { gravar: true });
    expect(relatorio.resultados[0]).toMatchObject({ status: 'erro', motivo: 'lead_time_ausente' });
    expect(prismaMock.forecastSource.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });

  it('a linha cujo lead time veio de OUTRA linha da fonte (celula vazia) tambem usa o do arquivo', async () => {
    leadTimeDaFonte = null;
    const relatorio = await criarProdutosNovos([pronta(2, { leadTimeDias: null, leadTimeDaFonteNoArquivo: 60 })], {
      gravar: true,
    });
    expect(relatorio.contagem.aplicado).toBe(1);
    expect(leadTimeDaFonte).toBe(60);
  });
});

describe('criarProdutosNovos - fonte', () => {
  it('fonte inexistente, ambigua ou inativa -> erro; nada e criado', async () => {
    const [inexistente] = (
      await criarProdutosNovos([pronta(2, { fonte: 'FIC Outra', chaveFonte: chaveDeNome('FIC Outra') })], { gravar: true })
    ).resultados;
    expect(inexistente).toMatchObject({ status: 'erro', motivo: 'fonte_inexistente' });

    fonteAtiva = false;
    const [inativa] = (await criarProdutosNovos([pronta(2)], { gravar: true })).resultados;
    expect(inativa).toMatchObject({ status: 'erro', motivo: 'fonte_inativa' });

    fonteAtiva = true;
    prismaMock.forecastSource.findMany.mockResolvedValue([
      { id: 5, name: 'FIC Fonte', isActive: true, leadTimeDays: 30 },
      { id: 6, name: 'fic  fonte', isActive: true, leadTimeDays: 30 },
    ]);
    const [ambigua] = (await criarProdutosNovos([pronta(2)], { gravar: true })).resultados;
    expect(ambigua).toMatchObject({ status: 'erro', motivo: 'fonte_ambigua' });

    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });
});

describe('criarProdutosNovos - familia', () => {
  it('familia vazia com itens de familias diferentes -> erro familia_ausente', async () => {
    itens = [itemFalso(11, 'FIC-001', 3), itemFalso(12, 'FIC-002', 4)];
    const relatorio = await criarProdutosNovos([pronta(2)], { gravar: true });
    expect(relatorio.resultados[0]).toMatchObject({ status: 'erro', motivo: 'familia_ausente' });
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });

  it('familia vazia com itens sem familia, ou com familia inativa -> erro familia_ausente', async () => {
    itens = [itemFalso(11, 'FIC-001', null), itemFalso(12, 'FIC-002', null)];
    expect((await criarProdutosNovos([pronta(2)], { gravar: true })).resultados[0]).toMatchObject({
      status: 'erro',
      motivo: 'familia_ausente',
    });
    itens = [itemFalso(11, 'FIC-001', 8), itemFalso(12, 'FIC-002', 8)];
    expect((await criarProdutosNovos([pronta(2)], { gravar: true })).resultados[0]).toMatchObject({
      status: 'erro',
      motivo: 'familia_ausente',
    });
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });

  it('familia vazia com itens da mesma familia ativa -> herda essa familyId', async () => {
    itens = [itemFalso(11, 'FIC-001', 4), itemFalso(12, 'FIC-002', 4)];
    const relatorio = await criarProdutosNovos([pronta(2)], { gravar: true });
    expect(relatorio.contagem.aplicado).toBe(1);
    expect(prismaMock.forecastProduct.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ familyId: 4, sourceId: 5, origin: 'dbcorp', isActive: true }),
    });
  });

  it('familia preenchida resolve pelo nome (sem acento/caixa); a da planilha vale mais que a dos itens', async () => {
    familias = [{ id: 4, name: 'FIC Família Outra', isActive: true }];
    const relatorio = await criarProdutosNovos([pronta(2, { familia: 'fic familia  outra' })], { gravar: true });
    expect(relatorio.contagem.aplicado).toBe(1);
    expect(prismaMock.forecastProduct.create).toHaveBeenCalledWith({ data: expect.objectContaining({ familyId: 4 }) });
  });

  it('familia preenchida inexistente, ambigua ou inativa -> erro; nada e criado', async () => {
    const motivo = async (familia: string) =>
      (await criarProdutosNovos([pronta(2, { familia })], { gravar: true })).resultados[0].motivo;
    expect(await motivo('FIC Familia Que Nao Existe')).toBe('familia_inexistente');
    expect(await motivo('FIC Familia Inativa')).toBe('familia_inativa');
    familias = [...familias, { id: 9, name: 'fic FAMILIA', isActive: true }];
    expect(await motivo('FIC Familia')).toBe('familia_ambigua');
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });
});

describe('criarProdutosNovos - produto que ja existe', () => {
  const produtoExistente = { id: 50, isActive: true };
  const codigoNoProduto = (catalogItemId: number | null, produtoId = 50) => ({
    id: 600,
    catalogItemId,
    product: { id: produtoId, name: 'FIC PROD A', isActive: true, origin: 'dbcorp' },
  });

  it('mesmo nome, todos os codigos ja nele e ligados aos itens da posicao -> ja_aplicado; nada novo', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(produtoExistente);
    prismaMock.forecastProductCode.findUnique.mockImplementation(async ({ where }: { where: { code: string } }) =>
      codigoNoProduto(where.code === 'FIC-001' ? 11 : 12),
    );
    const relatorio = await criarProdutosNovos([pronta(2)], { gravar: true });
    expect(relatorio.resultados[0]).toEqual({ linha: 2, status: 'ja_aplicado', motivo: null, produtoId: 50 });
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
  });

  it('ja_aplicado com catalogItemId nulo: so preenche o vinculo (nunca sobrescreve)', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(produtoExistente);
    prismaMock.forecastProductCode.findUnique.mockImplementation(async ({ where }: { where: { code: string } }) =>
      codigoNoProduto(where.code === 'FIC-001' ? null : 12),
    );
    const relatorio = await criarProdutosNovos([pronta(2)], { gravar: true });
    expect(relatorio.resultados[0]).toMatchObject({ status: 'ja_aplicado' });
    expect(prismaMock.forecastProductCode.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.forecastProductCode.update).toHaveBeenCalledWith({ where: { id: 600 }, data: { catalogItemId: 11 } });
  });

  it('codigo do produto ligado a OUTRO item -> conflito codigo_ligado_a_outro_item', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(produtoExistente);
    prismaMock.forecastProductCode.findUnique.mockImplementation(async ({ where }: { where: { code: string } }) =>
      codigoNoProduto(where.code === 'FIC-001' ? 11 : 777),
    );
    const relatorio = await criarProdutosNovos([pronta(2)], { gravar: true });
    expect(relatorio.resultados[0]).toMatchObject({ status: 'conflito', motivo: 'codigo_ligado_a_outro_item' });
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
  });

  it('mesmo nome mas os codigos nao estao nele -> conflito produto_ja_existe (nao acrescenta codigo ao existente)', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(produtoExistente);
    const relatorio = await criarProdutosNovos([pronta(2)], { gravar: true });
    expect(relatorio.resultados[0]).toMatchObject({ status: 'conflito', motivo: 'produto_ja_existe' });
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
  });

  // Mutante: ignorar isActive (o produto INATIVO sairia ja_aplicado e ainda receberia o catalogItemId).
  it.each([true, false])('produto de mesmo nome INATIVO com todos os codigos -> conflito produto_inativo; nada e escrito (gravar=%s)', async (gravar) => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue({ id: 50, isActive: false });
    prismaMock.forecastProductCode.findUnique.mockImplementation(async ({ where }: { where: { code: string } }) =>
      codigoNoProduto(where.code === 'FIC-001' ? null : 12),
    );
    const relatorio = await criarProdutosNovos([pronta(2)], { gravar });
    expect(relatorio.resultados[0]).toMatchObject({ status: 'conflito', motivo: 'produto_inativo' });
    expect(relatorio.contagem).toMatchObject({ conflito: 1, ja_aplicado: 0, aplicado: 0 });
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('nome novo mas codigo ja em OUTRO produto -> conflito codigo_em_outro_produto', async () => {
    prismaMock.forecastProductCode.findUnique.mockImplementation(async ({ where }: { where: { code: string } }) =>
      where.code === 'FIC-002' ? codigoNoProduto(null, 51) : null,
    );
    const relatorio = await criarProdutosNovos([pronta(2)], { gravar: true });
    expect(relatorio.resultados[0]).toMatchObject({ status: 'conflito', motivo: 'codigo_em_outro_produto' });
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });
});

// Mutante: gerar o modelo/as fontes fora de emTransacaoSomenteLeitura (o Postgres deixaria de recusar a escrita).
describe('modos somente leitura', () => {
  function esperarSomenteLeitura(): void {
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const [primeiraSql] = prismaMock.$executeRaw.mock.calls[0] as [readonly string[]];
    expect(primeiraSql.join('')).toContain('SET TRANSACTION READ ONLY');
    expect(prismaMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      Math.min(...[prismaMock.forecastSource.findMany, prismaMock.catalogItem.findMany, prismaMock.forecastProduct.findMany].flatMap((m) => m.mock.invocationCallOrder)),
    );
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastSource.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  }

  it('listarFontesParaPlanilha: READ ONLY primeiro e nenhuma escrita', async () => {
    prismaMock.forecastSource.findMany.mockResolvedValue([
      { id: 1, name: 'FIC Fonte A', leadTimeDays: 30, isActive: true },
      { id: 2, name: 'FIC Fonte B', leadTimeDays: null, isActive: false },
    ]);
    const fontes = await listarFontesParaPlanilha();
    expect(fontes).toEqual([
      { id: 1, nome: 'FIC Fonte A', leadTimeDays: 30, ativa: true },
      { id: 2, nome: 'FIC Fonte B', leadTimeDays: null, ativa: false },
    ]);
    esperarSomenteLeitura();
  });

  it('gerarModeloProdutosNovos: READ ONLY primeiro, nenhuma escrita, agrupa os sem sugestao', async () => {
    prismaMock.catalogItem.findMany.mockResolvedValue([
      { id: 11, commercialName: 'FIC NOVO - BLD', marketName: 'M1', dbcorpCode: 'FIC-001', familyId: 3, family: { id: 3, name: 'FIC Familia' } },
      { id: 12, commercialName: 'FIC NOVO - TBR', marketName: 'M2', dbcorpCode: 'FIC-002', familyId: 3, family: { id: 3, name: 'FIC Familia' } },
    ]);
    prismaMock.forecastProductCode.findMany.mockResolvedValue([]);
    prismaMock.forecastProduct.findMany.mockResolvedValue([]);
    const modelo = await gerarModeloProdutosNovos();
    expect(modelo).toEqual([
      expect.objectContaining({ produtoNovo: 'FIC NOVO', codigos: ['FIC-001', 'FIC-002'], catalogItemIds: [11, 12], familia: 'FIC Familia' }),
    ]);
    esperarSomenteLeitura();
  });
});
