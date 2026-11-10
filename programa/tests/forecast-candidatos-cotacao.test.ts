import { describe, expect, it } from 'vitest';
import {
  agruparPorFonte,
  candidatoDoProduto,
  demandaDoHorizonte,
  montarCandidatosCotacao,
} from '../src/utils/forecastCandidatosCotacao';
import {
  montarRelatorioCompras,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
} from '../src/utils/forecastRelatorioCompras';
import type { GrupoDeEquivalencia } from '../src/utils/forecastGruposEquivalencia';

// Tudo SINTETICO (repo publico). Quinzena 10-2: base 2026-10-15, hoje 2026-10-20 (janela de projecao: 2026-10..2027-03).
const BASE = '2026-10-15';
const HOJE = '2026-10-20';

const linha = (
  parcial: Partial<LinhaParaRelatorio> & Pick<LinhaParaRelatorio, 'linha' | 'item' | 'fonte'>,
): LinhaParaRelatorio => ({
  codigos: [`C${String(parcial.linha).padStart(4, '0')}`],
  status: 'nao',
  Q: 60,
  AG: 60,
  U: 0,
  AN: -100,
  AQ: 30,
  projecao: [40, -20, -80, -140, -200, -260],
  chegadas: [0, 0, 0, 0, 0],
  programacoes: [0, 0, 0, 0],
  ...parcial,
});

const quinzena = (linhas: LinhaParaRelatorio[]): QuinzenaParaRelatorio => ({
  id: 1,
  label: '10-2',
  baseDate: BASE,
  half: 2,
  origin: 'planilha',
  hoje: HOJE,
  linhas,
});

const POSITIVA = [500, 440, 380, 320, 260, 200];

// FONTE A: lista, sem falta, sob demanda, sem consumo com programacao, sem consumo so com estoque, sem cadastro, sem
// vinculo no catalogo, grupo coberto (membro + principal); FONTE B: sem lead time; sem fonte.
const linhas: LinhaParaRelatorio[] = [
  linha({ linha: 3, productId: 1, item: 'NA LISTA', fonte: 'FONTE A' }),
  linha({ linha: 4, productId: 2, item: 'SEM FALTA', fonte: 'FONTE A', AN: 500, projecao: POSITIVA }),
  linha({ linha: 5, productId: 3, item: 'SOB DEMANDA', fonte: 'FONTE A', AN: -50, Q: 40, AG: 40 }),
  linha({
    linha: 6,
    productId: 4,
    item: 'SEM CONSUMO COM PROGRAMACAO',
    fonte: 'FONTE A',
    Q: 0,
    AG: 0,
    U: 100,
    AN: 70,
    projecao: [70, 70, 70, 70, 70, 70],
    programacoes: [30, 0, 0, 0],
  }),
  linha({
    linha: 7,
    productId: 5,
    item: 'SEM CONSUMO SO ESTOQUE',
    fonte: 'FONTE A',
    Q: 0,
    AG: 0,
    U: 100,
    AN: 100,
    projecao: [100, 100, 100, 100, 100, 100],
  }),
  linha({ linha: 8, item: 'FORA DO CADASTRO', fonte: 'FONTE A', AN: 500, projecao: POSITIVA }),
  linha({ linha: 9, productId: 9, item: 'SEM VINCULO', fonte: 'FONTE A', AN: 500, projecao: POSITIVA }),
  linha({ linha: 10, productId: 10, item: 'PRINCIPAL DO GRUPO', fonte: 'FONTE A', Q: 10, AG: 10, U: 500, AN: 400, projecao: POSITIVA }),
  linha({ linha: 11, productId: 11, item: 'MEMBRO COBERTO', fonte: 'FONTE A', Q: 50, AG: 50, U: 0, AN: -30, projecao: [-10, -20, -30, -40, -50, -60] }),
  linha({ linha: 12, productId: 12, item: 'SEM LEAD TIME', fonte: 'FONTE B', AN: null, AQ: null, projecao: POSITIVA }),
  linha({ linha: 13, productId: 13, item: 'SEM FONTE', fonte: '', AN: null, AQ: null, projecao: POSITIVA }),
  linha({ linha: 14, productId: 14, item: 'NA LISTA B', fonte: 'FONTE B' }),
  linha({ linha: 15, productId: 15, item: 'SEM FALTA B', fonte: 'fonte b', AN: 10, Q: 5, AG: 5, projecao: POSITIVA }),
];

const grupos: GrupoDeEquivalencia[] = [{ id: 1, nome: 'GRUPO COBERTO', principalProductId: 10, productIds: [10, 11] }];
const sobDemanda = new Map([[3, { motivo: 'so com programacao' }]]);
const comCatalogo = new Set([1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15]);

const q = quinzena(linhas);
const relatorio = montarRelatorioCompras(q, [], { sobDemanda, grupos });
const resultado = montarCandidatosCotacao(q, relatorio, { grupos, produtosComVinculoCatalogo: comCatalogo });
const doProduto = (id: number) => candidatoDoProduto(resultado, id);

describe('demandaDoHorizonte', () => {
  it('AG + 5 x Q + programacoes (mesmas parcelas de saida da projecao)', () => {
    expect(demandaDoHorizonte({ AG: 60, Q: 60, programacoes: [0, 0, 0, 0] })).toBe(360);
    expect(demandaDoHorizonte({ AG: 80, Q: 60, programacoes: [10, 5, 0, 0] })).toBe(395);
    expect(demandaDoHorizonte({ AG: 0, Q: 0, programacoes: [30, 0, 0, 0] })).toBe(30);
  });

  it('sem consumo nem programacao = 0 (nunca -0)', () => {
    expect(Object.is(demandaDoHorizonte({ AG: 0, Q: 0, programacoes: [0, 0, 0, 0] }), 0)).toBe(true);
  });

  it('bate com a projecao do motor: projecao[5] = U + chegadas - demanda (sem a chegada do 5o mes)', () => {
    const l = { AG: 70, Q: 60, programacoes: [10, 20, 0, 5] };
    const U = 1000;
    const projecao5 = U - 70 - 5 * 60 - 35;
    expect(U - demandaDoHorizonte(l)).toBe(projecao5);
  });
});

describe('montarCandidatosCotacao', () => {
  it('item da lista de compra nao e candidato', () => {
    expect(doProduto(1)).toBeNull();
    expect(doProduto(14)).toBeNull();
  });

  it('sem falta: tem consumo e lead time, o calculo nao aponta compra', () => {
    expect(doProduto(2)).toEqual({
      productId: 2,
      item: 'SEM FALTA',
      codigos: ['C0004'],
      fonte: 'FONTE A',
      fonteChave: 'FONTE A',
      demandaKg: 360,
      quantidadeSugeridaKg: null,
      motivoForaDaLista: 'sem-falta',
      coberturaAteMes: '2027-03',
      coberturaAteOFimDaJanela: true,
      urgencia: null,
      grupoNome: null,
      anMotorKg: 500,
    });
  });

  it('sob demanda: traz a quantidade que a lista sugeriria e a urgencia da ruptura', () => {
    expect(doProduto(3)).toMatchObject({
      motivoForaDaLista: 'sob-demanda',
      demandaKg: 240,
      quantidadeSugeridaKg: 50,
      anMotorKg: -50,
      coberturaAteMes: '2026-10',
      coberturaAteOFimDaJanela: false,
      // Ruptura estimada em 2026-11-16 (Q=40), data-limite 2026-10-17 (lead time 30) < hoje: faixa 'atrasado'.
      urgencia: 'atrasado',
    });
  });

  it('sem consumo com movimento: so entra com programacao; estoque parado nao e demanda', () => {
    expect(doProduto(4)).toMatchObject({
      motivoForaDaLista: 'sem-consumo-com-movimento',
      demandaKg: 30,
      quantidadeSugeridaKg: null,
    });
    expect(doProduto(5)).toBeNull();
  });

  it('coberto por grupo: demanda propria do membro, cobertura pela linha do grupo', () => {
    expect(doProduto(11)).toMatchObject({
      productId: 11,
      item: 'MEMBRO COBERTO',
      motivoForaDaLista: 'coberto-por-grupo',
      demandaKg: 300,
      quantidadeSugeridaKg: 30,
      grupoNome: 'GRUPO COBERTO',
      coberturaAteOFimDaJanela: true,
      urgencia: null,
    });
  });

  it('principal do grupo que nao entraria sozinho aparece como a linha do grupo (sem falta)', () => {
    expect(doProduto(10)).toMatchObject({
      item: 'GRUPO COBERTO',
      motivoForaDaLista: 'sem-falta',
      grupoNome: 'GRUPO COBERTO',
      demandaKg: 360,
    });
  });

  it('um productId aparece uma vez; o membro coberto vence a linha do grupo do mesmo principal', () => {
    const duplo = montarCandidatosCotacao(
      q,
      relatorio,
      { grupos: [{ ...grupos[0], principalProductId: 11 }], produtosComVinculoCatalogo: comCatalogo },
    );
    const ids = duplo.candidatos.map((c) => c.productId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(candidatoDoProduto(duplo, 11)?.motivoForaDaLista).toBe('coberto-por-grupo');
  });

  it('exclui e conta: sem cadastro, sem fonte, sem vinculo no catalogo e sem lead time', () => {
    for (const id of [9, 12, 13]) expect(doProduto(id)).toBeNull();
    expect(resultado.excluidos).toEqual(
      expect.arrayContaining([
        { motivo: 'sem-cadastro', fonte: 'FONTE A' },
        { motivo: 'sem-fonte', fonte: '' },
        { motivo: 'sem-vinculo-catalogo', fonte: 'FONTE A' },
        { motivo: 'sem-lead-time', fonte: 'FONTE B' },
      ]),
    );
    expect(resultado.excluidos).toHaveLength(4);
  });

  it('nao toca o relatorio: a mesma entrada gera o mesmo relatorio', () => {
    expect(montarRelatorioCompras(q, [], { sobDemanda, grupos })).toEqual(relatorio);
  });
});

describe('agruparPorFonte', () => {
  it('sem fonte: agrupado por fonte (ordem alfabetica) e sem campos internos', () => {
    const r = agruparPorFonte(resultado, null);
    expect(r.fonte).toBeNull();
    expect(r.fontes.map((f) => f.fonte)).toEqual(['FONTE A', 'fonte b']);
    const a = r.fontes[0].itens;
    expect(a.map((i) => i.productId)).toEqual([10, 2, 11, 3, 4]);
    expect(a[0]).not.toHaveProperty('anMotorKg');
    expect(a[0]).not.toHaveProperty('fonteChave');
    expect(r.excluidos).toEqual([
      { motivo: 'sem-cadastro', quantidade: 1 },
      { motivo: 'sem-fonte', quantidade: 1 },
      { motivo: 'sem-vinculo-catalogo', quantidade: 1 },
      { motivo: 'sem-lead-time', quantidade: 1 },
    ]);
  });

  it('com fonte: so os itens e os excluidos dela, sem diferenciar maiusculas', () => {
    const r = agruparPorFonte(resultado, 'FONTE B');
    expect(r.fontes).toHaveLength(1);
    expect(r.fontes[0].itens.map((i) => i.productId)).toEqual([15]);
    expect(r.excluidos).toEqual([{ motivo: 'sem-lead-time', quantidade: 1 }]);
  });

  it('fonte sem candidatos aparece com a lista vazia', () => {
    const r = agruparPorFonte({ candidatos: [], excluidos: [] }, 'FONTE Z');
    expect(r).toEqual({ fonte: 'FONTE Z', fontes: [{ fonte: 'FONTE Z', itens: [] }], excluidos: [] });
  });
});
