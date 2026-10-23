import { describe, expect, it } from 'vitest';
import { FORECAST_PENDENTES_MAX_ITENS } from '../src/constants/forecast';
import {
  codigosPendentes,
  type CadastroDeCodigos,
  type PendentesEntradas,
  type VendasRecentes,
} from '../src/utils/forecastPendentes';

// Dados SINTETICOS (repo publico): codigos TSTnnnn.
const entradas = (parcial: Partial<PendentesEntradas> = {}): PendentesEntradas => ({
  estoque: [],
  vendasMes: [],
  vendasAtual: [],
  vendasAnual: [],
  programacoes: [],
  chegadas: [],
  comprasEmAberto: [],
  ...parcial,
});

const cadastro = (ativos: string[] = [], inativos: Array<[string, number, string]> = []): CadastroDeCodigos => ({
  ativos: new Set(ativos),
  inativos: new Map(inativos.map(([codigo, productId, nome]) => [codigo, { productId, nome }])),
});

// `anteriores` = soma base-3 + base-2 por codigo (historico mensal gravado).
const vendas = (anteriores: Array<[string, number]> = [], ausentes: string[] = []): VendasRecentes => ({
  meses: ['2026-07', '2026-08', '2026-09'],
  anteriores: new Map(anteriores),
  ausentes,
});

const SEM_VENDAS = vendas();

describe('codigosPendentes - regra do COMEX (venda em 3 meses, programacao ou compra em aberto)', () => {
  it('codigo de produto ativo nunca e pendente (nem pelo historico mensal)', () => {
    const r = codigosPendentes(
      entradas({
        vendasMes: [{ codigo: 'TST0001', qtd: 100 }],
        estoque: [{ codigo: 'TST0001', qtd: 5 }],
        comprasEmAberto: [{ codigo: 'TST0001', qtd: 9 }],
      }),
      cadastro(['TST0001']),
      vendas([['TST0001', 70]]),
    );
    expect(r).toMatchObject({
      itens: [],
      totalItens: 0,
      omitidos: 0,
      soSaldo: { codigos: 0, kg: 0 },
      semVendaRecente: { codigos: 0, vendasAnual: 0 },
    });
  });

  it.each([
    ['venda do mes anterior (base-1)', { vendasMes: [{ codigo: 'TST0002', qtd: 1 }] }, SEM_VENDAS],
    ['venda em base-3/base-2 (historico mensal), nada no relatorio', {}, vendas([['TST0002', 1]])],
    ['programacao', { programacoes: [{ codigo: 'TST0002', qtd: 1, mes: '10' }] }, SEM_VENDAS],
    ['compra em aberto do FUP', { comprasEmAberto: [{ codigo: 'TST0002', qtd: 1 }] }, SEM_VENDAS],
  ] as Array<[string, Partial<PendentesEntradas>, VendasRecentes]>)('entra na lista com %s', (_nome, parcial, v) => {
    const r = codigosPendentes(entradas(parcial), cadastro(), v);
    expect(r.totalItens).toBe(1);
    expect(r.itens[0]).toMatchObject({ codigo: 'TST0002', situacao: 'sem_cadastro', produtoInativo: null });
    expect(r.semVendaRecente).toEqual({ codigos: 0, vendasAnual: 0 });
  });

  it.each([
    ['so venda no acumulado anual', { vendasAnual: [{ codigo: 'TST0002', qtd: 900 }] }, 900],
    ['so venda do mes atual (ate o dia 15)', { vendasAtual: [{ codigo: 'TST0002', qtd: 30 }] }, 0],
    [
      'venda anual e do mes atual',
      { vendasAnual: [{ codigo: 'TST0002', qtd: 500 }], vendasAtual: [{ codigo: 'TST0002', qtd: 5 }] },
      500,
    ],
  ] as Array<[string, Partial<PendentesEntradas>, number]>)('%s: fora da lista, contado em semVendaRecente', (_nome, parcial, anual) => {
    const r = codigosPendentes(entradas(parcial), cadastro(), SEM_VENDAS);
    expect(r.itens).toEqual([]);
    expect(r.totalItens).toBe(0);
    expect(r.semVendaRecente).toEqual({ codigos: 1, vendasAnual: anual });
    expect(r.soSaldo).toEqual({ codigos: 0, kg: 0 });
  });

  it('a venda do mes atual nao qualifica sozinha, mas nao tira quem ja qualifica por outro criterio', () => {
    const r = codigosPendentes(
      entradas({
        vendasAtual: [
          { codigo: 'TST0003', qtd: 30 },
          { codigo: 'TST0004', qtd: 30 },
        ],
        programacoes: [{ codigo: 'TST0004', qtd: 10, mes: '11' }],
      }),
      cadastro(),
      SEM_VENDAS,
    );
    expect(r.itens.map((i) => i.codigo)).toEqual(['TST0004']);
    expect(r.itens[0]).toMatchObject({ vendasAtual: 30, vendas3Meses: 0 });
    expect(r.semVendaRecente.codigos).toBe(1);
  });

  it('vendas3Meses = base-3 + base-2 (historico) + base-1 (relatorio), arredondado', () => {
    const r = codigosPendentes(
      entradas({ vendasMes: [{ codigo: 'TST0005', qtd: 0.1 }] }),
      cadastro(),
      vendas([['TST0005', 0.2]]),
    );
    expect(r.itens[0]).toMatchObject({ vendasMes: 0.1, vendasAnteriores: 0.2, vendas3Meses: 0.3 });
  });

  it('so saldo nao e listado: conta em soSaldo (saldo zero nao conta; zeros em venda/programacao/compra tambem nao listam)', () => {
    const r = codigosPendentes(
      entradas({
        estoque: [
          { codigo: 'TST0003', qtd: 10 },
          { codigo: 'TST0003', qtd: 2.5 },
          { codigo: 'TST0004', qtd: 0 },
          { codigo: 'TST0005', qtd: -1.5 },
        ],
        vendasMes: [{ codigo: 'TST0006', qtd: 0 }],
        comprasEmAberto: [{ codigo: 'TST0007', qtd: 0 }],
      }),
      cadastro(),
      vendas([['TST0008', 0]]),
    );
    expect(r.itens).toEqual([]);
    expect(r.totalItens).toBe(0);
    expect(r.soSaldo).toEqual({ codigos: 2, kg: 11 });
    expect(r.semVendaRecente).toEqual({ codigos: 0, vendasAnual: 0 });
  });

  it('codigo com saldo e venda so anual conta como semVendaRecente, nao como soSaldo', () => {
    const r = codigosPendentes(
      entradas({ estoque: [{ codigo: 'TST0009', qtd: 40 }], vendasAnual: [{ codigo: 'TST0009', qtd: 70 }] }),
      cadastro(),
      SEM_VENDAS,
    );
    expect(r.semVendaRecente).toEqual({ codigos: 1, vendasAnual: 70 });
    expect(r.soSaldo).toEqual({ codigos: 0, kg: 0 });
  });

  it('soma por codigo normalizado (caixa e espacos) e junta todas as fontes', () => {
    const r = codigosPendentes(
      entradas({
        estoque: [{ codigo: ' tst0007 ', qtd: 40 }],
        vendasMes: [
          { codigo: 'tst0007', qtd: 10 },
          { codigo: 'TST0007 ', qtd: 5 },
        ],
        vendasAnual: [{ codigo: 'TST0007', qtd: 120 }],
        programacoes: [{ codigo: 'Tst0007', qtd: 30, mes: '10' }],
        chegadas: [{ codigo: 'TST0007', qtd: 70, mes: '11' }],
        comprasEmAberto: [
          { codigo: 'TST0007', qtd: 70 },
          { codigo: 'tst0007', qtd: 25 },
        ],
        vendasAtual: [{ codigo: '', qtd: 99 }], // codigo vazio e ignorado
      }),
      cadastro(),
      vendas([[' tst0007', 12]]),
    );
    expect(r.itens).toEqual([
      {
        codigo: 'TST0007',
        situacao: 'sem_cadastro',
        produtoInativo: null,
        vendasMes: 15,
        vendasAtual: 0,
        vendasAnual: 120,
        vendas3Meses: 27,
        vendasAnteriores: 12,
        programacao: 30,
        chegadas: 70,
        comprasEmAberto: 95,
        saldo: 40,
      },
    ]);
  });

  it('codigo de produto INATIVO vem como produto_inativo com id e nome do produto', () => {
    const r = codigosPendentes(
      entradas({ vendasMes: [{ codigo: 'TST0008', qtd: 50 }] }),
      cadastro([], [['TST0008', 77, 'PRODUTO 077']]),
      SEM_VENDAS,
    );
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({
      codigo: 'TST0008',
      situacao: 'produto_inativo',
      produtoInativo: { id: 77, nome: 'PRODUTO 077' },
    });
  });

  it('ordena por vendas3Meses desc, programacao desc, comprasEmAberto desc e codigo asc', () => {
    const r = codigosPendentes(
      entradas({
        vendasMes: [
          { codigo: 'TST0010', qtd: 5 },
          { codigo: 'TST0011', qtd: 5 },
          { codigo: 'TST0012', qtd: 1 },
        ],
        programacoes: [
          { codigo: 'TST0010', qtd: 1, mes: '10' },
          { codigo: 'TST0011', qtd: 9, mes: '10' },
          { codigo: 'TST0014', qtd: 100, mes: '10' },
          { codigo: 'TST0015', qtd: 100, mes: '10' },
        ],
        comprasEmAberto: [
          { codigo: 'TST0014', qtd: 1 },
          { codigo: 'TST0015', qtd: 8 },
          { codigo: 'TST0016', qtd: 50 },
          { codigo: 'TST0017', qtd: 50 },
        ],
        vendasAnual: [{ codigo: 'TST0099', qtd: 99999 }], // a venda anual nao pesa na ordem (e nem lista)
      }),
      cadastro(),
      vendas([
        ['TST0012', 10], // 11 no total: o primeiro
        ['TST0013', 5], // 5, sem programacao nem compra: depois de 0010/0011 (programacao menor)
      ]),
    );
    expect(r.itens.map((i) => i.codigo)).toEqual([
      'TST0012', // 11
      'TST0011', // 5, programacao 9
      'TST0010', // 5, programacao 1
      'TST0013', // 5, sem programacao
      'TST0015', // 0 venda, programacao 100, compras 8
      'TST0014', // 0 venda, programacao 100, compras 1
      'TST0016', // 0 venda, 0 programacao, compras 50 (empate com 0017 -> codigo asc)
      'TST0017',
    ]);
  });

  it(`corta em ${FORECAST_PENDENTES_MAX_ITENS} itens e informa o total e os omitidos`, () => {
    const total = FORECAST_PENDENTES_MAX_ITENS + 7;
    const vendasMes = Array.from({ length: total }, (_, i) => ({
      codigo: `TST${String(i).padStart(4, '0')}`,
      qtd: 1,
    }));
    const r = codigosPendentes(entradas({ vendasMes }), cadastro(), SEM_VENDAS);
    expect(r.itens).toHaveLength(FORECAST_PENDENTES_MAX_ITENS);
    expect(r.totalItens).toBe(total);
    expect(r.omitidos).toBe(7);
    // empate em tudo: por codigo asc, entao os omitidos sao os de maior codigo
    expect(r.itens[0].codigo).toBe('TST0000');
    expect(r.itens[FORECAST_PENDENTES_MAX_ITENS - 1].codigo).toBe(`TST${String(FORECAST_PENDENTES_MAX_ITENS - 1).padStart(4, '0')}`);
  });

  it('nao muta as entradas nem as vendas', () => {
    const e = entradas({ vendasMes: [{ codigo: ' tst0001', qtd: 2 }], comprasEmAberto: [{ codigo: 'TST0002', qtd: 3 }] });
    const v = vendas([['TST0003', 4]], ['2026-07']);
    const copia = JSON.parse(JSON.stringify(e));
    codigosPendentes(e, cadastro(), v);
    expect(e).toEqual(copia);
    expect([...v.anteriores]).toEqual([['TST0003', 4]]);
    expect(v.ausentes).toEqual(['2026-07']);
  });
});

describe('codigosPendentes - compra em aberto (FUP) e quinzena gravada antes do 5C', () => {
  it('com `comprasEmAberto` na quinzena: a compra do FUP manda e as chegadas aceitas pela F3 nao qualificam sozinhas', () => {
    const r = codigosPendentes(
      entradas({
        chegadas: [{ codigo: 'TST0020', qtd: 80, mes: '11' }],
        comprasEmAberto: [{ codigo: 'TST0021', qtd: 40 }], // sem data/atracada: nao esta nas chegadas
      }),
      cadastro(),
      SEM_VENDAS,
    );
    expect(r.itens.map((i) => i.codigo)).toEqual(['TST0021']);
    expect(r.itens[0]).toMatchObject({ comprasEmAberto: 40, chegadas: 0 });
    expect(r.regra.compras).toBe('fup_em_aberto');
  });

  it('chave ausente (quinzena antiga): cai nas chegadas e declara em regra.compras', () => {
    const antiga: PendentesEntradas = {
      estoque: [],
      vendasMes: [],
      vendasAtual: [],
      vendasAnual: [],
      programacoes: [],
      chegadas: [
        { codigo: 'TST0020', qtd: 80, mes: '11' },
        { codigo: 'tst0020', qtd: 20, mes: '12' },
      ],
    };
    const r = codigosPendentes(antiga, cadastro(), SEM_VENDAS);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({ codigo: 'TST0020', chegadas: 100, comprasEmAberto: 100 });
    expect(r.regra.compras).toBe('chegadas');
  });

  it('lista vazia `comprasEmAberto: []` e uma quinzena nova sem compra (nao cai nas chegadas)', () => {
    const r = codigosPendentes(
      entradas({ chegadas: [{ codigo: 'TST0020', qtd: 80, mes: '11' }], comprasEmAberto: [] }),
      cadastro(),
      SEM_VENDAS,
    );
    expect(r.itens).toEqual([]);
    expect(r.regra.compras).toBe('fup_em_aberto');
  });

  it('regra repassa os meses da venda e o historico ausente (copias)', () => {
    const v = vendas([], ['2026-07']);
    const r = codigosPendentes(entradas(), cadastro(), v);
    expect(r.regra).toEqual({
      mesesVenda: ['2026-07', '2026-08', '2026-09'],
      historicoAusente: ['2026-07'],
      compras: 'fup_em_aberto',
    });
    expect(r.regra.mesesVenda).not.toBe(v.meses);
    expect(r.regra.historicoAusente).not.toBe(v.ausentes);
  });
});
