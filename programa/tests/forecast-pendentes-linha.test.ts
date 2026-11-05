import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceljs from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORECAST_MARCA_SEM_CADASTRO, FORECAST_PENDENTES_MAX_ITENS, FORECAST_SHEETS } from '../src/constants/forecast';

vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import { ForecastDbcorpService } from '../src/services/ForecastDbcorpService';
import { ForecastDemandaComercialService } from '../src/services/ForecastDemandaComercialService';
import { ForecastGrupoEquivalenciaService } from '../src/services/ForecastGrupoEquivalenciaService';
import { ForecastMesesAtipicosService } from '../src/services/ForecastMesesAtipicosService';
import { ForecastOcasioesService } from '../src/services/ForecastOcasioesService';
import { ForecastProductService } from '../src/services/ForecastProductService';
import { ForecastSnapshotService } from '../src/services/ForecastSnapshotService';
import { ForecastSobDemandaService } from '../src/services/ForecastSobDemandaService';
import { calcular } from '../src/utils/forecastEngine';
import { gerarXlsxForecastMacro } from '../src/utils/forecastMacroXlsx';
import {
  codigosPendentes,
  codigosPendentesCompletos,
  estadoDoPendente,
  limitarPendentes,
  linhaDePendente,
  type CadastroDeCodigos,
  type PendentesEntradas,
  type VendasRecentes,
} from '../src/utils/forecastPendentes';
import { montarRelatorioCompras, type LinhaParaRelatorio } from '../src/utils/forecastRelatorioCompras';
import type { Quinzena } from '../src/utils/forecastTypes';
import { parseForecastWorkbook } from '../src/utils/forecastWorkbook';

// FZ4: o pendente de cadastro do DBCorp entra na quinzena como LINHA (sem produto e sem fonte). Dados SINTETICOS (repo
// publico): codigos TSTnnnn. Nenhum teste aqui precisa de banco: o builder roda sobre um `db` falso em memoria.

const BASE_DATE = '2034-06-15';
const HOJE = '2034-06-20';
const HIST = ['2033-12', '2034-01', '2034-02', '2034-03', '2034-04']; // base-6..base-2
const ATIVO = 'TST0001';
const PEND_VENDA = 'TST0002'; // fora do cadastro, com venda
const PEND_INATIVO = 'TST0003'; // codigo de produto INATIVO, com programacao
const SO_SALDO = 'TST0004'; // so saldo: nao qualifica
const AMOSTRA = 'AM0001'; // codigo de amostra (prefixo AM + digito) sem cadastro: nao vira pendente nem linha

const cadastroAtual = (ativos: string[], inativos: Array<[string, number, string]> = []): CadastroDeCodigos => ({
  ativos: new Set(ativos),
  inativos: new Map(inativos.map(([codigo, productId, nome]) => [codigo, { productId, nome }])),
});

const vendasVazias = (): VendasRecentes => ({
  meses: ['2034-03', '2034-04', '2034-05'],
  anteriores: new Map(),
  ausentes: [],
});

// ---- Util puro ----------------------------------------------------------------------------------------------------
describe('codigosPendentesCompletos / limitarPendentes', () => {
  const muitos = (n: number): PendentesEntradas => ({
    estoque: [],
    vendasMes: Array.from({ length: n }, (_, i) => ({ codigo: `TSTX${String(i).padStart(4, '0')}`, qtd: 10 + (i % 7) })),
    vendasAtual: [],
    vendasAnual: [],
    programacoes: [],
    chegadas: [],
    comprasEmAberto: [],
  });

  it('a lista completa nao corta em 200; a da tela corta e informa os omitidos; mesma ordem e mesma regra', () => {
    const total = FORECAST_PENDENTES_MAX_ITENS + 25;
    const completo = codigosPendentesCompletos(muitos(total), cadastroAtual([]), vendasVazias());
    const tela = codigosPendentes(muitos(total), cadastroAtual([]), vendasVazias());

    expect(completo.itens).toHaveLength(total);
    expect(completo.omitidos).toBe(0);
    expect(completo.totalItens).toBe(total);
    expect(tela.itens).toHaveLength(FORECAST_PENDENTES_MAX_ITENS);
    expect(tela.omitidos).toBe(25);
    expect(tela.totalItens).toBe(total);
    expect(tela.itens).toEqual(completo.itens.slice(0, FORECAST_PENDENTES_MAX_ITENS));
    expect(limitarPendentes(completo)).toEqual(tela);
  });

  it('limitarPendentes preserva amostrasIgnoradas; a lista completa e a da tela contam o mesmo numero', () => {
    const entradas: PendentesEntradas = {
      ...muitos(3),
      programacoes: [{ codigo: AMOSTRA, qtd: 400, mes: '07' }],
    };
    const completo = codigosPendentesCompletos(entradas, cadastroAtual([]), vendasVazias());
    const tela = codigosPendentes(entradas, cadastroAtual([]), vendasVazias());
    const cortado = limitarPendentes(completo, 2);

    expect(completo.amostrasIgnoradas).toEqual({ codigos: 1, prefixos: ['AM'] });
    expect(tela.amostrasIgnoradas).toEqual(completo.amostrasIgnoradas);
    expect(cortado.itens).toHaveLength(2);
    expect(cortado.omitidos).toBe(1);
    expect(cortado.totalItens).toBe(3);
    expect(cortado.amostrasIgnoradas).toEqual({ codigos: 1, prefixos: ['AM'] });
  });
});

describe('linhaDePendente', () => {
  it('linha sem produto e sem fonte, codigo na 1a das 7 posicoes, marca da situacao', () => {
    const linha = linhaDePendente({ codigo: PEND_VENDA, situacao: 'sem_cadastro' }, 9, [1, 2, 3, 4, 5], 7);
    expect(linha).toEqual({
      linha: 9,
      n: null,
      item: PEND_VENDA,
      codigos: [PEND_VENDA, '', '', '', '', '', ''],
      historico: [1, 2, 3, 4, 5],
      analiseForecast: null,
      obs: '',
      fonte: '',
      precoFechado: '',
      embalagem: '',
      naoFraciona: '',
      qtdAmostra: '',
      solicitarAmostra: '',
      status: 'nao',
      productId: null,
      pendenteCadastro: 'sem_cadastro',
    });
  });
});

describe('estadoDoPendente (derivado do cadastro ATUAL, na leitura)', () => {
  const linha = (pendenteCadastro: unknown) => ({ codigos: [PEND_VENDA, '', ''], pendenteCadastro });

  it('sem marca (quinzena antiga ou produto normal): sem estado', () => {
    expect(estadoDoPendente({ codigos: [ATIVO] }, cadastroAtual([ATIVO]))).toEqual({
      pendenteCadastro: null,
      cadastradoDepois: false,
      produtoInativoAtual: null,
    });
  });

  it('marca desconhecida no JSON congelado e ignorada (leitura tolerante)', () => {
    for (const lixo of ['x', 1, true, {}, '']) {
      expect(estadoDoPendente(linha(lixo), cadastroAtual([PEND_VENDA])).pendenteCadastro).toBeNull();
    }
  });

  it('sem_cadastro e ainda fora do cadastro: pendente; ja cadastrado: cadastradoDepois', () => {
    expect(estadoDoPendente(linha('sem_cadastro'), cadastroAtual([]))).toEqual({
      pendenteCadastro: 'sem_cadastro',
      cadastradoDepois: false,
      produtoInativoAtual: null,
    });
    expect(estadoDoPendente(linha('sem_cadastro'), cadastroAtual([PEND_VENDA]))).toMatchObject({
      pendenteCadastro: 'sem_cadastro',
      cadastradoDepois: true,
    });
  });

  it('produto inativo: distingue falta de cadastro de inativo e traz o produto para o "Reativar"', () => {
    const inativo = estadoDoPendente(linha('produto_inativo'), cadastroAtual([], [[PEND_VENDA, 7, 'PRODUTO TESTE']]));
    expect(inativo).toEqual({
      pendenteCadastro: 'produto_inativo',
      cadastradoDepois: false,
      produtoInativoAtual: { id: 7, nome: 'PRODUTO TESTE' },
    });
    // Foi reativado depois: cadastradoDepois e nao mostra mais o botao de reativar.
    const reativado = estadoDoPendente(linha('produto_inativo'), cadastroAtual([PEND_VENDA]));
    expect(reativado).toMatchObject({ cadastradoDepois: true, produtoInativoAtual: null });
  });
});

// ---- Builder do import DBCorp (db falso em memoria) ---------------------------------------------------------------
// Variacao opcional do cenario: `amostra` = codigo de amostra (so programacao) a mais; `soAmostra` = tira PEND_VENDA e
// PEND_INATIVO (venda, historico e programacao), restando a amostra como unico candidato a pendente.
interface Variacao {
  amostra?: string;
  soAmostra?: boolean;
}

function dbFalso(variacao: Variacao = {}) {
  const vendasRows = [
    ...HIST.map((yearMonth) => ({ code: ATIVO, yearMonth, quantity: 10 })),
    ...(variacao.soAmostra
      ? []
      : [
          { code: PEND_VENDA, yearMonth: '2034-03', quantity: 30 },
          { code: PEND_VENDA, yearMonth: '2034-04', quantity: 40 },
        ]),
  ];
  return {
    forecastProduct: {
      findMany: async () => [
        {
          id: 1,
          name: 'PRODUTO TESTE 1',
          sheetOrder: 1,
          notes: null,
          fixedPriceFlag: false,
          packaging: null,
          noFractioning: false,
          sampleQty: null,
          sampleRequestNote: null,
          sourceId: 10,
          source: { name: 'FONTE TESTE' },
          codes: [{ position: 1, code: ATIVO }],
        },
      ],
    },
    forecastMonthlySale: {
      groupBy: async () => HIST.map((yearMonth) => ({ yearMonth, _count: { _all: 3 } })),
      findMany: async ({ where }: { where: { yearMonth: { in: string[] }; code?: { in: string[] } } }) =>
        vendasRows.filter(
          (r) => where.yearMonth.in.includes(r.yearMonth) && (!where.code || where.code.in.includes(r.code)),
        ),
    },
    forecastSource: {
      findMany: async () => [
        {
          id: 10,
          name: 'FONTE TESTE',
          leadTimeDays: 30,
          isActive: true,
          arrivalFromReadinessDays: null,
          arrivalFromEtdDays: null,
        },
      ],
    },
    forecastProductCode: {
      findMany: async () => [
        { code: ATIVO, product: { id: 1, name: 'PRODUTO TESTE 1', isActive: true } },
        { code: PEND_INATIVO, product: { id: 2, name: 'PRODUTO TESTE INATIVO', isActive: false } },
      ],
    },
  };
}

function parsedSintetico(variacao: Variacao = {}) {
  const resumo = (linhas: unknown[]) => ({ usadas: 0, ignoradas: {}, linhas });
  const programacoes = [
    ...(variacao.soAmostra ? [] : [{ codigo: PEND_INATIVO, qtd: 50, mes: '07' }]),
    ...(variacao.amostra ? [{ codigo: variacao.amostra, qtd: 400, mes: '07' }] : []),
  ];
  return {
    erros: [] as string[],
    saldo: {
      ...resumo([
        { codigo: ATIVO, qtd: 5 },
        { codigo: PEND_VENDA, qtd: 20 },
        { codigo: SO_SALDO, qtd: 99 },
      ]),
    },
    vendasMes: resumo([
      { codigo: ATIVO, qtd: 100 },
      ...(variacao.soAmostra ? [] : [{ codigo: PEND_VENDA, qtd: 100 }]),
    ]),
    vendasAtual: null,
    vendasAnual: resumo([]),
    programacao: resumo(programacoes),
    fup: { ...resumo([]), fupLinhas: [], comprasEmAberto: [], avisosColuna: [], avisos: [] },
    clientesAtivos: null,
    margem: null,
    files: [],
    avisosPorSlot: {},
    avisosGerais: [],
  };
}

async function montarQuinzena(variacao: Variacao = {}) {
  const statics = ForecastDbcorpService as unknown as {
    buildQuinzena: (db: unknown, parsed: unknown, input: unknown) => Promise<{
      quinzena: Quinzena | null;
      erros: string[];
      avisos: string[];
      pendentes: { totalItens: number; amostrasIgnoradas: { codigos: number; prefixos: string[] } } | null;
      pendentesNaQuinzena: { total: number; semCadastro: number; produtoInativo: number };
    }>;
  };
  const built = await statics.buildQuinzena(dbFalso(variacao), parsedSintetico(variacao), {
    label: '06-2',
    baseDate: BASE_DATE,
    files: { saldo: { fileName: 'saldo.xlsx', contentBase64: '' } },
  });
  return built;
}

describe('ForecastDbcorpService.buildQuinzena - pendentes viram linhas', () => {
  it('anexa 1 linha por pendente depois dos produtos ativos; so quem qualifica entra; contagem por situacao', async () => {
    const built = await montarQuinzena();
    expect(built.erros).toEqual([]);
    const produtos = built.quinzena!.produtos as Array<Quinzena['produtos'][number] & { productId?: number | null; pendenteCadastro?: string }>;

    expect(produtos.map((p) => [p.linha, p.item, p.productId ?? null, p.pendenteCadastro ?? null])).toEqual([
      [3, 'PRODUTO TESTE 1', 1, null],
      [4, PEND_VENDA, null, 'sem_cadastro'], // 100 + 70 de venda nos 3 meses: primeiro na ordem
      [5, PEND_INATIVO, null, 'produto_inativo'], // so programacao
    ]);
    expect(produtos.some((p) => p.item === SO_SALDO)).toBe(false);
    expect(built.pendentesNaQuinzena).toEqual({ total: 2, semCadastro: 1, produtoInativo: 1 });
    expect(built.pendentes?.totalItens).toBe(2);

    // Sem fonte e com 7 posicoes de codigo; historico J..N vem do historico mensal do codigo (3 e 4 meses atras).
    const pend = produtos[1];
    expect(pend.fonte).toBe('');
    expect(pend.codigos).toHaveLength(7);
    expect(pend.codigos[0]).toBe(PEND_VENDA);
    expect(pend.historico).toEqual([0, 0, 0, 30, 40]);
    expect(built.avisos.join(' ')).toContain('sem lead time e sem sugestão de compra');
  });

  it('codigo de amostra nao ganha linha FZ4, nao entra em pendentesNaQuinzena nem no aviso; so e contado', async () => {
    const built = await montarQuinzena({ amostra: AMOSTRA });
    const produtos = built.quinzena!.produtos;

    expect(produtos.some((p) => p.item === AMOSTRA)).toBe(false);
    expect(produtos.map((p) => p.item)).toEqual(['PRODUTO TESTE 1', PEND_VENDA, PEND_INATIVO]);
    expect(built.pendentesNaQuinzena).toEqual({ total: 2, semCadastro: 1, produtoInativo: 1 });
    expect(built.pendentes?.totalItens).toBe(2);
    expect(built.pendentes?.amostrasIgnoradas).toEqual({ codigos: 1, prefixos: ['AM'] });
    const avisos = built.avisos.join(' ');
    expect(avisos).toContain('2 códigos');
    expect(avisos).not.toContain('3 códigos');
  });

  it('so amostra: sem linha, sem aviso de pendentes e pendentesNaQuinzena zerado', async () => {
    const built = await montarQuinzena({ amostra: AMOSTRA, soAmostra: true });

    expect(built.erros).toEqual([]);
    expect(built.quinzena!.produtos.map((p) => p.item)).toEqual(['PRODUTO TESTE 1']);
    expect(built.pendentesNaQuinzena).toEqual({ total: 0, semCadastro: 0, produtoInativo: 0 });
    expect(built.pendentes?.totalItens).toBe(0);
    expect(built.pendentes?.amostrasIgnoradas.codigos).toBe(1);
    expect(built.avisos.join(' ')).not.toContain('sem lead time e sem sugestão de compra');
  });

  it('(a) a linha pendente tem consumo/estoque do codigo, mas SEM lead time: AN, AP e AQ nulos', async () => {
    const q = (await montarQuinzena()).quinzena!;
    const linhas = calcular(q, { hoje: HOJE, quinzena: 2 });
    const ativo = linhas[0];
    const pend = linhas[1];

    expect(pend.O).toBe(100); // vendas do mes anterior do codigo
    expect(pend.U).toBe(20); // saldo do codigo
    expect(pend.Q).toBeGreaterThan(0);
    expect(pend.AQ).toBeNull();
    expect(pend.AN).toBeNull();
    expect(pend.AP).toBeNull();
    expect(pend.T).toBeNull();
    // O produto ativo com fonte continua calculando normalmente (lead time 30).
    expect(ativo.AQ).toBe(30);
    expect(ativo.AN).not.toBeNull();
    expect(ativo.AN!).toBeLessThan(0);
  });
});

// ---- Leitura (service com mocks) e relatorio ----------------------------------------------------------------------
type Calc = Awaited<ReturnType<typeof ForecastSnapshotService.getCalculated>>;

async function prepararLeitura(
  quinzena: Quinzena,
  cadastro: CadastroDeCodigos,
): Promise<{ cadastroSpy: ReturnType<typeof vi.spyOn> }> {
  const statics = ForecastSnapshotService as unknown as { carregarQuinzena: (id: number) => Promise<unknown> };
  vi.spyOn(statics, 'carregarQuinzena').mockResolvedValue({
    snapshot: { id: 1, label: quinzena.id, half: 2, origin: 'dbcorp', createdAt: new Date(0), expected: null },
    months: { consumo: quinzena.mesesConsumo, chegada: quinzena.mesesChegada, programacao: quinzena.mesesProgramacao },
    produtos: quinzena.produtos,
    files: [],
    quinzena,
    half: 2,
  });
  vi.spyOn(ForecastSobDemandaService, 'regrasDosProdutos').mockResolvedValue(new Map());
  vi.spyOn(ForecastGrupoEquivalenciaService, 'gruposDosProdutos').mockResolvedValue(new Map());
  vi.spyOn(ForecastMesesAtipicosService, 'doProdutos').mockResolvedValue(new Map());
  vi.spyOn(ForecastOcasioesService, 'contextoDoCalculo').mockResolvedValue(null);
  vi.spyOn(ForecastDemandaComercialService, 'abertas').mockResolvedValue([]);
  vi.spyOn(ForecastProductService, 'embalagensDosCodigos').mockResolvedValue([]);
  const cadastroSpy = vi.spyOn(ForecastProductService, 'cadastroDeCodigos').mockResolvedValue(cadastro);
  return { cadastroSpy };
}

const sugestaoTotal = (r: Awaited<ReturnType<typeof ForecastSnapshotService.getRelatorioCompras>>) =>
  r.grupos.flatMap((g) => g.itens).reduce((soma, i) => soma + i.quantidadeSugerida, 0);

describe('leitura da quinzena com linhas pendentes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('(a)(b) relatorio: pendentes contam em semCadastro (fora de semLeadTime) e nao entram na lista nem na soma de sugestoes', async () => {
    const q = (await montarQuinzena()).quinzena!;
    await prepararLeitura(q, cadastroAtual([ATIVO], [[PEND_INATIVO, 2, 'PRODUTO TESTE INATIVO']]));

    const r = await ForecastSnapshotService.getRelatorioCompras(1, HOJE);
    expect(r.fora.semCadastro).toBe(2);
    expect(r.fora.semLeadTime).toBe(0);
    const itens = r.grupos.flatMap((g) => g.itens);
    expect(itens.map((i) => i.item)).toEqual(['PRODUTO TESTE 1']);
    expect(itens.some((i) => i.item === PEND_VENDA || i.item === PEND_INATIVO)).toBe(false);

    // A soma de sugestoes e so a do produto cadastrado: Q = (10 + 10 + 100) / 3, T = Q/30 * 30, AN = 5 - T - Q.
    const calc = await ForecastSnapshotService.getCalculated(1, HOJE);
    const ativo = calc.linhas.find((l) => l.productId === 1)!;
    expect(sugestaoTotal(r)).toBeCloseTo(Math.abs(ativo.AN as number), 6);
    // A linha pendente tem AN nulo: nenhuma quantidade existe para somar.
    expect(calc.linhas.filter((l) => l.productId === null).every((l) => l.AN === null)).toBe(true);
  });

  it('(b) mesmo que o motor devolvesse AN/AQ para a linha pendente, o relatorio NAO sugere compra e conta em semCadastro', () => {
    const base: LinhaParaRelatorio = {
      linha: 3,
      item: 'PRODUTO TESTE 1',
      codigos: [ATIVO],
      fonte: 'FONTE TESTE',
      status: 'nao',
      Q: 40,
      AG: 40,
      U: 5,
      AN: -75,
      AQ: 30,
      projecao: [-35, -75, -115, -155, -195, -235],
      chegadas: [0, 0, 0, 0, 0],
      programacoes: [0, 0, 0, 0],
      productId: 1,
    };
    const pendenteComAn: LinhaParaRelatorio = {
      ...base,
      linha: 4,
      item: PEND_VENDA,
      codigos: [PEND_VENDA],
      fonte: '',
      productId: null,
      pendenteCadastro: 'sem_cadastro',
    };
    const r = montarRelatorioCompras(
      { id: 1, label: '06-2', baseDate: BASE_DATE, half: 2, origin: 'dbcorp', hoje: HOJE, linhas: [base, pendenteComAn] },
      [],
    );
    expect(r.fora.semCadastro).toBe(1);
    expect(r.grupos.flatMap((g) => g.itens).map((i) => i.item)).toEqual(['PRODUTO TESTE 1']);
    expect(sugestaoTotal(r)).toBe(75);
  });

  it('linha pendente sem consumo mas com estoque aparece em "sem consumo" e continua contada em semCadastro (nao em semLeadTime)', () => {
    const r = montarRelatorioCompras(
      {
        id: 1,
        label: '06-2',
        baseDate: BASE_DATE,
        half: 2,
        origin: 'dbcorp',
        hoje: HOJE,
        linhas: [
          {
            linha: 3,
            item: PEND_VENDA,
            codigos: [PEND_VENDA],
            fonte: '',
            status: 'nao',
            Q: 0,
            AG: 0,
            U: 30,
            AN: null,
            AQ: null,
            projecao: [30, 30, 30, 30, 30, 30],
            chegadas: [0, 0, 0, 0, 0],
            programacoes: [0, 0, 0, 0],
            productId: null,
            pendenteCadastro: 'sem_cadastro',
          },
        ],
      },
      [],
    );
    expect(r.fora).toMatchObject({ semCadastro: 1, semLeadTime: 0 });
    expect(r.grupos).toEqual([]);
    // Aparece na secao "sem consumo" (com estoque), marcada sem lead time e sem quantidade sugerida.
    expect(r.semConsumo.itens).toHaveLength(1);
    expect(r.semConsumo.itens[0]).toMatchObject({ item: PEND_VENDA, motivos: ['estoque'], semLeadTime: true, estoque: 30 });
    expect(r.fora.semConsumoSemMovimento).toBe(0);
  });

  it('linha pendente sem consumo, sem estoque e sem programacao: nao entra na secao, so conta em semConsumoSemMovimento e semCadastro', () => {
    const r = montarRelatorioCompras(
      {
        id: 1,
        label: '06-2',
        baseDate: BASE_DATE,
        half: 2,
        origin: 'dbcorp',
        hoje: HOJE,
        linhas: [
          {
            linha: 3,
            item: PEND_VENDA,
            codigos: [PEND_VENDA],
            fonte: '',
            status: 'nao',
            Q: 0,
            AG: 0,
            U: 0,
            AN: null,
            AQ: null,
            projecao: [0, 0, 0, 0, 0, 0],
            chegadas: [0, 0, 0, 0, 0],
            programacoes: [0, 0, 0, 0],
            productId: null,
            pendenteCadastro: 'sem_cadastro',
          },
        ],
      },
      [],
    );
    expect(r.fora).toMatchObject({ semCadastro: 1, semLeadTime: 0, semConsumoSemMovimento: 1 });
    expect(r.semConsumo.itens).toEqual([]);
  });

  it('(c) cadastrar o produto depois NAO muda a quinzena: so o estado derivado vira cadastradoDepois', async () => {
    const q = (await montarQuinzena()).quinzena!;
    const congelada = JSON.stringify(q);

    await prepararLeitura(q, cadastroAtual([ATIVO]));
    const antes = await ForecastSnapshotService.getCalculated(1, HOJE);
    const relatorioAntes = await ForecastSnapshotService.getRelatorioCompras(1, HOJE);
    vi.restoreAllMocks();

    // Agora o codigo pendente virou produto ATIVO no cadastro.
    await prepararLeitura(q, cadastroAtual([ATIVO, PEND_VENDA]));
    const depois = await ForecastSnapshotService.getCalculated(1, HOJE);
    const relatorioDepois = await ForecastSnapshotService.getRelatorioCompras(1, HOJE);

    const semEstado = (c: Calc) =>
      c.linhas.map((l) => {
        const { cadastradoDepois, produtoInativoAtual, ...resto } = l as typeof l & {
          cadastradoDepois?: boolean;
          produtoInativoAtual?: unknown;
        };
        void cadastradoDepois;
        void produtoInativoAtual;
        return resto;
      });
    expect(semEstado(depois)).toEqual(semEstado(antes)); // numeros, productId, fonte: tudo igual
    expect(JSON.stringify(q)).toBe(congelada); // a quinzena congelada nao foi tocada
    expect(relatorioDepois).toEqual(relatorioAntes); // sem sugestao nova, mesma contagem

    const pendAntes = antes.linhas.find((l) => l.item === PEND_VENDA) as unknown as Record<string, unknown>;
    const pendDepois = depois.linhas.find((l) => l.item === PEND_VENDA) as unknown as Record<string, unknown>;
    expect(pendAntes).toMatchObject({ pendenteCadastro: 'sem_cadastro', cadastradoDepois: false, productId: null });
    expect(pendDepois).toMatchObject({ pendenteCadastro: 'sem_cadastro', cadastradoDepois: true, productId: null });
    expect(pendDepois.fonte).toBe('');
    expect(pendDepois.AN).toBeNull();
  });

  it('inativo: leitura distingue sem_cadastro de produto_inativo e informa o produto a reativar', async () => {
    const q = (await montarQuinzena()).quinzena!;
    await prepararLeitura(q, cadastroAtual([ATIVO], [[PEND_INATIVO, 2, 'PRODUTO TESTE INATIVO']]));
    const calc = await ForecastSnapshotService.getCalculated(1, HOJE);
    const vendas = calc.linhas.find((l) => l.item === PEND_VENDA) as unknown as Record<string, unknown>;
    const inativo = calc.linhas.find((l) => l.item === PEND_INATIVO) as unknown as Record<string, unknown>;
    // Quinzena mista: a linha NORMAL nao ganha nenhuma das chaves de pendente (nem null/false).
    const normal = calc.linhas.find((l) => l.productId === 1)!;
    expect(normal).not.toHaveProperty('pendenteCadastro');
    expect(normal).not.toHaveProperty('cadastradoDepois');
    expect(normal).not.toHaveProperty('produtoInativoAtual');
    expect(vendas).toMatchObject({ pendenteCadastro: 'sem_cadastro', produtoInativoAtual: null });
    expect(inativo).toMatchObject({
      pendenteCadastro: 'produto_inativo',
      cadastradoDepois: false,
      produtoInativoAtual: { id: 2, nome: 'PRODUTO TESTE INATIVO' },
    });
  });

  it('(d) quinzena antiga (sem a marca) le normalmente: sem consulta de cadastro, sem chaves novas, semCadastro 0', async () => {
    const q = (await montarQuinzena()).quinzena!;
    // Snapshot gravado antes da FZ4: so os produtos ativos, sem nenhuma chave `pendenteCadastro`.
    const antiga: Quinzena = { ...q, produtos: q.produtos.slice(0, 1) };
    expect('pendenteCadastro' in antiga.produtos[0]).toBe(false);
    const { cadastroSpy } = await prepararLeitura(antiga, cadastroAtual([ATIVO]));

    const calc = await ForecastSnapshotService.getCalculated(1, HOJE);
    expect(calc.linhas).toHaveLength(1);
    expect(calc.linhas[0]).not.toHaveProperty('pendenteCadastro');
    expect(calc.linhas[0]).not.toHaveProperty('cadastradoDepois');
    expect(calc.linhas[0]).not.toHaveProperty('produtoInativoAtual');
    expect(cadastroSpy).not.toHaveBeenCalled();

    const r = await ForecastSnapshotService.getRelatorioCompras(1, HOJE);
    expect(r.fora.semCadastro).toBe(0);
    expect(r.grupos.flatMap((g) => g.itens)).toHaveLength(1);
  });

  it('(d) linha sem produto e sem marca (quinzena antiga com codigo solto) segue como "sem lead time", nunca como semCadastro', async () => {
    const q = (await montarQuinzena()).quinzena!;
    const semMarca = q.produtos.map((p) => {
      const { pendenteCadastro, ...resto } = p as typeof p & { pendenteCadastro?: string };
      void pendenteCadastro;
      return resto;
    });
    await prepararLeitura({ ...q, produtos: semMarca }, cadastroAtual([ATIVO]));
    const r = await ForecastSnapshotService.getRelatorioCompras(1, HOJE);
    expect(r.fora.semCadastro).toBe(0);
    expect(r.fora.semLeadTime).toBe(2);
  });
});

// ---- MACRO: marca + trava de reimportacao --------------------------------------------------------------------------
describe('XLSX MACRO com linha pendente de cadastro', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
  ) as Quinzena;
  const CODIGO = 'TSTM001';
  const comPendente = (): Quinzena => ({
    ...fixture,
    produtos: [
      ...fixture.produtos.slice(0, 3),
      linhaDePendente({ codigo: CODIGO, situacao: 'sem_cadastro' }, 6, [0, 0, 0, 0, 0], 7),
    ],
    entradas: { ...fixture.entradas, estoque: [...fixture.entradas.estoque, { codigo: CODIGO, qtd: 12 }] },
  });

  it('a observacao (AT) da linha leva SEM CADASTRO, com 7 posicoes de codigo e sem fonte', async () => {
    const buffer = await gerarXlsxForecastMacro({ quinzena: comPendente(), hoje: '2026-10-20', half: 2, origin: 'dbcorp' });
    const wb = new exceljs.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.getWorksheet(FORECAST_SHEETS.macro)!;
    const r = 3 + 3; // 4o produto
    expect(ws.getCell(`I${r}`).value).toBe(CODIGO);
    expect(ws.getCell(`B${r}`).value).toBe(CODIGO);
    expect(ws.getCell(`AT${r}`).value).toBe(FORECAST_MARCA_SEM_CADASTRO);
    expect(ws.getCell(`AU${r}`).value ?? null).toBeNull();
    // As demais linhas ficam como antes (sem a marca).
    expect(String(ws.getCell('AT3').value ?? '')).not.toContain(FORECAST_MARCA_SEM_CADASTRO);
  });

  it('o arquivo NAO e um import valido: o leitor da planilha recusa a linha marcada', async () => {
    const buffer = await gerarXlsxForecastMacro({ quinzena: comPendente(), hoje: '2026-10-20', half: 2, origin: 'dbcorp' });
    const lido = await parseForecastWorkbook(buffer, { label: '10-2', baseDate: '2026-10-15' });
    expect(lido.erros.some((e) => e.includes(FORECAST_MARCA_SEM_CADASTRO) && e.includes(CODIGO))).toBe(true);

    // Controle: o mesmo arquivo sem a linha pendente reimporta sem erro desse tipo.
    const limpo = await gerarXlsxForecastMacro({
      quinzena: { ...comPendente(), produtos: fixture.produtos.slice(0, 3) },
      hoje: '2026-10-20',
      half: 2,
      origin: 'dbcorp',
    });
    const lidoLimpo = await parseForecastWorkbook(limpo, { label: '10-2', baseDate: '2026-10-15' });
    expect(lidoLimpo.erros.some((e) => e.includes(FORECAST_MARCA_SEM_CADASTRO))).toBe(false);
  });

  it('a marca barra tambem quando a observacao original existia (vem depois do prefixo "SEM CADASTRO - ")', async () => {
    const q = comPendente();
    (q.produtos[3] as { obs: string }).obs = 'nota do comex';
    const buffer = await gerarXlsxForecastMacro({ quinzena: q, hoje: '2026-10-20', half: 2, origin: 'dbcorp' });
    const wb = new exceljs.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    expect(String(wb.getWorksheet(FORECAST_SHEETS.macro)!.getCell('AT6').value)).toBe(
      `${FORECAST_MARCA_SEM_CADASTRO} - nota do comex`,
    );
    const lido = await parseForecastWorkbook(buffer, { label: '10-2', baseDate: '2026-10-15' });
    expect(lido.erros.some((e) => e.includes(FORECAST_MARCA_SEM_CADASTRO))).toBe(true);
  });

  it.each(['Sem cadastro na ANVISA ate marco', 'sem cadastro no SISCOMEX', 'SEM CADASTROS antigos', 'SEM CADASTRO na ANVISA', 'sem cadastro', 'Sem cadastro - ANVISA'])(
    'observacao legitima de produto real (%s) NAO e recusada: so a marca exata do export barra',
    async (obs) => {
      const q: Quinzena = { ...fixture, produtos: fixture.produtos.slice(0, 3).map((p, i) => (i === 1 ? { ...p, obs } : p)) };
      const buffer = await gerarXlsxForecastMacro({ quinzena: q, hoje: '2026-10-20', half: 2, origin: 'planilha' });
      const lido = await parseForecastWorkbook(buffer, { label: '10-2', baseDate: '2026-10-15' });
      expect(lido.erros.some((e) => e.includes(FORECAST_MARCA_SEM_CADASTRO))).toBe(false);
      expect(lido.quinzena.produtos[1].obs).toBe(obs);
    },
  );
});

// ---- XLSX do relatorio: a linha "sem cadastro" bate com a tela ------------------------------------------------------
describe('XLSX do relatorio de compras - resumo', () => {
  const relatorio = (pendente: boolean) =>
    montarRelatorioCompras(
      {
        id: 1,
        label: '06-2',
        baseDate: BASE_DATE,
        half: 2,
        origin: 'dbcorp',
        hoje: HOJE,
        linhas: [
          {
            linha: 3,
            item: PEND_VENDA,
            codigos: [PEND_VENDA],
            fonte: '',
            status: 'nao',
            Q: 40,
            AG: 40,
            U: 5,
            AN: null,
            AQ: null,
            projecao: [-35, -75, -115, -155, -195, -235],
            chegadas: [0, 0, 0, 0, 0],
            programacoes: [0, 0, 0, 0],
            productId: null,
            ...(pendente ? { pendenteCadastro: 'sem_cadastro' as const } : {}),
          },
        ],
      },
      [],
    );

  it('com linha pendente o resumo traz a contagem "sem cadastro"; sem ela o resumo e o de antes', async () => {
    const { linhasDoResumo } = await import('../src/utils/forecastRelatorioComprasXlsx');
    const com = linhasDoResumo(relatorio(true));
    expect(com.some((l) => l.startsWith('1 sem cadastro'))).toBe(true);
    expect(com.find((l) => l.startsWith('Fora do relatório'))).toContain('0 sem lead time');

    const sem = linhasDoResumo(relatorio(false));
    expect(sem.some((l) => l.includes('sem cadastro'))).toBe(false);
    expect(sem.find((l) => l.startsWith('Fora do relatório'))).toContain('1 sem lead time');
  });
});
