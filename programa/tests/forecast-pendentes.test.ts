import { describe, expect, it } from 'vitest';
import { FORECAST_PENDENTES_MAX_ITENS } from '../src/constants/forecast';
import { codigosPendentes, type CadastroDeCodigos, type PendentesEntradas } from '../src/utils/forecastPendentes';

// Dados SINTETICOS (repo publico): codigos TSTnnnn.
const entradas = (parcial: Partial<PendentesEntradas> = {}): PendentesEntradas => ({
  estoque: [],
  vendasMes: [],
  vendasAtual: [],
  vendasAnual: [],
  programacoes: [],
  chegadas: [],
  ...parcial,
});

const cadastro = (ativos: string[] = [], inativos: Array<[string, number, string]> = []): CadastroDeCodigos => ({
  ativos: new Set(ativos),
  inativos: new Map(inativos.map(([codigo, productId, nome]) => [codigo, { productId, nome }])),
});

describe('codigosPendentes', () => {
  it('codigo de produto ativo nunca e pendente', () => {
    const r = codigosPendentes(
      entradas({ vendasMes: [{ codigo: 'TST0001', qtd: 100 }], estoque: [{ codigo: 'TST0001', qtd: 5 }] }),
      cadastro(['TST0001']),
    );
    expect(r).toEqual({ itens: [], totalItens: 0, omitidos: 0, soSaldo: { codigos: 0, kg: 0 } });
  });

  it.each([
    ['vendasMes', { vendasMes: [{ codigo: 'TST0002', qtd: 1 }] }],
    ['vendasAtual', { vendasAtual: [{ codigo: 'TST0002', qtd: 1 }] }],
    ['vendasAnual', { vendasAnual: [{ codigo: 'TST0002', qtd: 1 }] }],
    ['programacao', { programacoes: [{ codigo: 'TST0002', qtd: 1, mes: '10' }] }],
    ['chegadas', { chegadas: [{ codigo: 'TST0002', qtd: 1, mes: '10' }] }],
  ] as Array<[string, Partial<PendentesEntradas>]>)('entra na lista com %s > 0', (campo, parcial) => {
    const r = codigosPendentes(entradas(parcial), cadastro());
    expect(r.totalItens).toBe(1);
    expect(r.itens[0]).toMatchObject({ codigo: 'TST0002', situacao: 'sem_cadastro', produtoInativo: null });
    expect((r.itens[0] as unknown as Record<string, number>)[campo]).toBe(1);
  });

  it('so saldo nao e listado: conta em soSaldo (saldo zero nao conta)', () => {
    const r = codigosPendentes(
      entradas({
        estoque: [
          { codigo: 'TST0003', qtd: 10 },
          { codigo: 'TST0003', qtd: 2.5 },
          { codigo: 'TST0004', qtd: 0 },
          { codigo: 'TST0005', qtd: -1.5 },
        ],
        vendasMes: [{ codigo: 'TST0006', qtd: 0 }], // movimento zero: tambem nao lista
      }),
      cadastro(),
    );
    expect(r.itens).toEqual([]);
    expect(r.totalItens).toBe(0);
    expect(r.soSaldo).toEqual({ codigos: 2, kg: 11 });
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
        vendasAtual: [{ codigo: '', qtd: 99 }], // codigo vazio e ignorado
      }),
      cadastro(),
    );
    expect(r.itens).toEqual([
      {
        codigo: 'TST0007',
        situacao: 'sem_cadastro',
        produtoInativo: null,
        vendasMes: 15,
        vendasAtual: 0,
        vendasAnual: 120,
        programacao: 30,
        chegadas: 70,
        saldo: 40,
      },
    ]);
  });

  it('codigo de produto INATIVO vem como produto_inativo com id e nome do produto', () => {
    const r = codigosPendentes(
      entradas({ vendasAnual: [{ codigo: 'TST0008', qtd: 50 }] }),
      cadastro([], [['TST0008', 77, 'PRODUTO 077']]),
    );
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({
      codigo: 'TST0008',
      situacao: 'produto_inativo',
      produtoInativo: { id: 77, nome: 'PRODUTO 077' },
    });
  });

  it('ordena por vendasAnual desc, vendasMes desc e codigo asc', () => {
    const r = codigosPendentes(
      entradas({
        vendasAnual: [
          { codigo: 'TST0012', qtd: 10 },
          { codigo: 'TST0011', qtd: 10 },
          { codigo: 'TST0010', qtd: 10 },
          { codigo: 'TST0013', qtd: 500 },
        ],
        vendasMes: [
          { codigo: 'TST0011', qtd: 3 },
          { codigo: 'TST0010', qtd: 1 },
          { codigo: 'TST0012', qtd: 1 },
          { codigo: 'TST0014', qtd: 4 }, // sem venda anual: depois de quem tem
        ],
      }),
      cadastro(),
    );
    expect(r.itens.map((i) => i.codigo)).toEqual(['TST0013', 'TST0011', 'TST0010', 'TST0012', 'TST0014']);
  });

  it(`corta em ${FORECAST_PENDENTES_MAX_ITENS} itens e informa o total e os omitidos`, () => {
    const total = FORECAST_PENDENTES_MAX_ITENS + 7;
    const vendasMes = Array.from({ length: total }, (_, i) => ({
      codigo: `TST${String(i).padStart(4, '0')}`,
      qtd: 1,
    }));
    const r = codigosPendentes(entradas({ vendasMes }), cadastro());
    expect(r.itens).toHaveLength(FORECAST_PENDENTES_MAX_ITENS);
    expect(r.totalItens).toBe(total);
    expect(r.omitidos).toBe(7);
    // empate em tudo: por codigo asc, entao os omitidos sao os de maior codigo
    expect(r.itens[0].codigo).toBe('TST0000');
    expect(r.itens[FORECAST_PENDENTES_MAX_ITENS - 1].codigo).toBe(`TST${String(FORECAST_PENDENTES_MAX_ITENS - 1).padStart(4, '0')}`);
  });

  it('nao muta as entradas', () => {
    const e = entradas({ vendasMes: [{ codigo: ' tst0001', qtd: 2 }] });
    const copia = JSON.parse(JSON.stringify(e));
    codigosPendentes(e, cadastro());
    expect(e).toEqual(copia);
  });
});
