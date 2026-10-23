import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcular } from '../src/utils/forecastEngine';
import {
  ULTIMO_MES_DE_PROGRAMACAO,
  avaliarDemandasComerciais,
  type DemandaComercialAberta,
} from '../src/utils/forecastDemandaComercial';
import {
  montarRelatorioCompras,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
} from '../src/utils/forecastRelatorioCompras';
import type { Produto, Quinzena } from '../src/utils/forecastTypes';

// Demanda do comercial (PR 6d): compra pedida por programacao futura de cliente FORA do horizonte do Forecast. Dados
// 100% sinteticos (repo publico). Caso E do plano: base 2026-10-15, hoje 2026-10-20.
const BASE = '2026-10-15';
const HOJE = '2026-10-20';
const PRODUCT_ID = 7;

const produto: Produto = {
  linha: 3,
  n: 1,
  item: 'PRODUTO 001',
  codigos: ['C0001', '', '', '', '', '', ''],
  historico: [300, 300, 300, 300, 300],
  analiseForecast: null,
  obs: '',
  fonte: 'FONTE 001',
  precoFechado: '',
  embalagem: '',
  naoFraciona: '',
  qtdAmostra: '',
  solicitarAmostra: '',
  status: 'nao',
};

// Q = 300 (M, N, O = 300), estoque 2.000, sem chegada nem programacao, lead time 60: T = 600, AN = +1.100 (fora da lista),
// projecao [1.700, 1.400, 1.100, 800, 500, 200]. Com `estoque: 0` o AN fica negativo (900 a comprar).
function casoE(extra: { estoque?: number; programacao?: number } = {}): Quinzena {
  const meses = ['10', '11', '12', '01'];
  return {
    id: '10-2',
    arquivo: 'sintetica',
    dataBase: BASE,
    mesesConsumo: ['04', '05', '06', '07', '08', '09', '10'],
    mesesChegada: ['10', '11', '12', '01', '02'],
    mesesProgramacao: meses,
    produtos: [{ ...produto }],
    entradas: {
      estoque: [{ codigo: 'C0001', qtd: extra.estoque ?? 2000 }],
      vendasMes: [{ codigo: 'C0001', qtd: 300 }],
      vendasAtual: [{ codigo: 'C0001', qtd: 100 }],
      vendasAnual: [{ codigo: 'C0001', qtd: 3300 }],
      programacoes: extra.programacao ? [{ codigo: 'C0001', qtd: extra.programacao, mes: '12' }] : [],
      chegadas: [],
      leadtime: [{ fonte: 'FONTE 001', total: 60 }],
      margem: [],
      clientesAtivos: [],
    },
    esperado: {},
  };
}

function linhasDe(q: Quinzena, productId: number | null = PRODUCT_ID): LinhaParaRelatorio[] {
  return calcular(q, { hoje: HOJE, quinzena: 2 }).map((c) => {
    const p = q.produtos.find((x) => x.linha === c.linha)!;
    return {
      ...c,
      n: p.n,
      productId,
      item: p.item,
      codigos: p.codigos.filter((x) => x !== ''),
      fonte: p.fonte,
      status: p.status,
    };
  });
}

const quinzenaDe = (linhas: LinhaParaRelatorio[]): QuinzenaParaRelatorio => ({
  id: 1,
  label: '10-2',
  baseDate: BASE,
  half: 2,
  origin: 'planilha',
  hoje: HOJE,
  linhas,
});

let proximoId = 100;
const demanda = (necessidade: string, kg: number, extra: Partial<DemandaComercialAberta> = {}): DemandaComercialAberta => ({
  id: proximoId++,
  productId: PRODUCT_ID,
  produto: 'PRODUTO 001',
  fonte: 'FONTE 001',
  kg,
  necessidade,
  motivo: 'MOTIVO SINTETICO',
  cliente: 'CLIENTE SINTETICO',
  solicitacaoId: null,
  ...extra,
});

describe('caso E: base do motor (premissas do plano)', () => {
  it('Q 300, T 600, AN +1.100 e projecao [1700, 1400, 1100, 800, 500, 200]', () => {
    const [l] = linhasDe(casoE());
    expect(l.Q).toBe(300);
    expect(l.AN).toBe(1100);
    expect(l.projecao).toEqual([1700, 1400, 1100, 800, 500, 200]);
  });

  it('o ultimo mes de programacao do DBCorp e o base + 3 (AC..AF)', () => {
    expect(ULTIMO_MES_DE_PROGRAMACAO).toBe(3);
  });
});

describe('avaliarDemandasComerciais', () => {
  it('alem do horizonte: pedido de 1.600 kg para 2027-02-10 -> saldo livre 500 e sugerido 1.100', () => {
    const r = avaliarDemandasComerciais(linhasDe(casoE()), [demanda('2027-02-10', 1600)], BASE);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({
      linha: 3,
      productId: PRODUCT_ID,
      item: 'PRODUTO 001',
      fonte: 'FONTE 001',
      kg: 1600,
      necessidade: '2027-02-10',
      anoMes: '2027-02',
      motivo: 'MOTIVO SINTETICO',
      cliente: 'CLIENTE SINTETICO',
      situacao: 'alem-do-horizonte',
      saldoLivre: 500,
      sugerido: 1100,
      noRelatorio: false,
      programacaoDoMes: null,
    });
    expect(r.totais).toEqual({ abertas: 1, sugeridoKg: 1100 });
  });

  it('dentro do horizonte (2026-12-01): nao soma, sugerido 0, e mostra a programacao do mes', () => {
    const r = avaliarDemandasComerciais(linhasDe(casoE({ programacao: 250 })), [demanda('2026-12-01', 1600)], BASE);
    expect(r.itens[0]).toMatchObject({
      situacao: 'no-horizonte',
      sugerido: 0,
      saldoLivre: null,
      programacaoDoMes: 250,
    });
    expect(r.totais).toEqual({ abertas: 1, sugeridoKg: 0 });
  });

  it('fronteira: 2027-01-31 (ultimo mes de programacao) ainda e do horizonte; 2027-02-01 ja e alem', () => {
    const linhas = linhasDe(casoE());
    const [dentro, alem] = avaliarDemandasComerciais(
      linhas,
      [demanda('2027-01-31', 1000, { id: 1 }), demanda('2027-02-01', 1000, { id: 2 })],
      BASE,
    ).itens;
    expect(dentro).toMatchObject({ id: 1, situacao: 'no-horizonte', sugerido: 0 });
    expect(alem).toMatchObject({ id: 2, situacao: 'alem-do-horizonte', saldoLivre: 500, sugerido: 500 });
  });

  it('necessidade anterior ao mes base tambem nao soma (sem programacao do mes)', () => {
    const r = avaliarDemandasComerciais(linhasDe(casoE()), [demanda('2026-08-01', 900)], BASE);
    expect(r.itens[0]).toMatchObject({ situacao: 'no-horizonte', sugerido: 0, programacaoDoMes: null });
  });

  it('pedido menor que o saldo livre: sugerido 0, continua listado como alem do horizonte', () => {
    const r = avaliarDemandasComerciais(linhasDe(casoE()), [demanda('2027-02-10', 300)], BASE);
    expect(r.itens[0]).toMatchObject({ situacao: 'alem-do-horizonte', saldoLivre: 500, sugerido: 0 });
    expect(r.totais).toEqual({ abertas: 1, sugeridoKg: 0 });
  });

  it('duas demandas do mesmo produto (2027-02 e 2027-03): o saldo e consumido em ordem de necessidade', () => {
    // A de marco vem primeiro na lista de entrada: a ordem de consumo nao depende dela.
    const r = avaliarDemandasComerciais(
      linhasDe(casoE()),
      [demanda('2027-03-05', 400, { id: 2 }), demanda('2027-02-10', 1600, { id: 1 })],
      BASE,
    );
    expect(r.itens.map((i) => i.id)).toEqual([1, 2]);
    // Fevereiro: projecao 500 -> sugerido 1.100 (500 saem do saldo).
    expect(r.itens[0]).toMatchObject({ saldoLivre: 500, sugerido: 1100 });
    // Marco: projecao 200 menos os 500 ja usados -> 0 de saldo -> pedido inteiro.
    expect(r.itens[1]).toMatchObject({ saldoLivre: 0, sugerido: 400 });
    expect(r.totais).toEqual({ abertas: 2, sugeridoKg: 1500 });
  });

  it('o saldo usado por uma demanda pequena reduz o saldo da seguinte, so pela parte coberta pelo saldo', () => {
    const r = avaliarDemandasComerciais(
      linhasDe(casoE()),
      [demanda('2027-02-10', 150, { id: 1 }), demanda('2027-03-05', 400, { id: 2 })],
      BASE,
    );
    // Fev cobre os 150 pelo saldo (sugerido 0); marco: 200 - 150 = 50 de saldo -> sugerido 350.
    expect(r.itens[0]).toMatchObject({ saldoLivre: 500, sugerido: 0 });
    expect(r.itens[1]).toMatchObject({ saldoLivre: 50, sugerido: 350 });
  });

  it('demanda dentro do horizonte nao consome o saldo das demandas alem dele', () => {
    const r = avaliarDemandasComerciais(
      linhasDe(casoE()),
      [demanda('2026-12-01', 5000, { id: 1 }), demanda('2027-02-10', 1600, { id: 2 })],
      BASE,
    );
    expect(r.itens.find((i) => i.id === 2)).toMatchObject({ saldoLivre: 500, sugerido: 1100 });
  });

  it('depois do 6o mes a projecao continua caindo pela media Q (projecao[5] - Q por mes)', () => {
    // Estoque 5.000: projecao [4.700, ..., 3.200] (6o mes = 2027-03). Abril/2027 = 3.200 - 300 = 2.900.
    const linhas = linhasDe(casoE({ estoque: 5000 }));
    expect(linhas[0].projecao[5]).toBe(3200);
    const r = avaliarDemandasComerciais(linhas, [demanda('2027-04-10', 4000)], BASE);
    expect(r.itens[0]).toMatchObject({ situacao: 'alem-do-horizonte', saldoLivre: 2900, sugerido: 1100 });
    // Muito longe: o saldo estimado fica negativo e vira 0 (o pedido inteiro soma).
    const longe = avaliarDemandasComerciais(linhasDe(casoE()), [demanda('2027-09-10', 700)], BASE);
    expect(longe.itens[0]).toMatchObject({ saldoLivre: 0, sugerido: 700 });
  });

  it('item ja na lista de compra: saldo 0, sugerido = pedido inteiro, noRelatorio e selo no item', () => {
    const linhas = linhasDe(casoE({ estoque: 0 }));
    expect(linhas[0].AN).toBe(-900);
    const demandas = [demanda('2027-02-10', 1600)];
    const r = avaliarDemandasComerciais(linhas, demandas, BASE, new Set([3]));
    expect(r.itens[0]).toMatchObject({ saldoLivre: 0, sugerido: 1600, noRelatorio: true });

    const rel = montarRelatorioCompras(quinzenaDe(linhas), [], { demandasComerciais: demandas });
    const item = rel.grupos[0].itens[0];
    expect(item.quantidadeSugerida).toBe(900); // a lista de compra nao muda: o pedido do comercial vem a parte
    expect(item.demandaComercialKg).toBe(1600);
    expect(rel.demandaComercial.totais).toEqual({ abertas: 1, sugeridoKg: 1600 });
  });

  it('produto sem linha nesta quinzena: listado sem calculo, com o nome do cadastro', () => {
    const r = avaliarDemandasComerciais(
      linhasDe(casoE()),
      [demanda('2027-02-10', 800, { productId: 999, produto: 'PRODUTO 002', fonte: 'FONTE 002' })],
      BASE,
    );
    expect(r.itens[0]).toMatchObject({
      linha: null,
      productId: 999,
      item: 'PRODUTO 002',
      fonte: 'FONTE 002',
      situacao: 'fora-da-quinzena',
      saldoLivre: null,
      sugerido: 0,
      noRelatorio: false,
    });
    expect(r.totais).toEqual({ abertas: 1, sugeridoKg: 0 });
  });

  it('ordena por data de necessidade, depois por nome e id; sem demandas devolve vazio', () => {
    const outro = { productId: 8, produto: 'PRODUTO 000' };
    const r = avaliarDemandasComerciais(
      linhasDe(casoE()),
      [
        demanda('2027-03-01', 100, { id: 3 }),
        demanda('2027-02-10', 100, { id: 2, ...outro }),
        demanda('2027-02-10', 100, { id: 1 }),
      ],
      BASE,
    );
    expect(r.itens.map((i) => i.id)).toEqual([2, 1, 3]);
    expect(avaliarDemandasComerciais(linhasDe(casoE()), [], BASE)).toEqual({
      itens: [],
      totais: { abertas: 0, sugeridoKg: 0 },
    });
  });
});

describe('relatorio de compras com demanda do comercial', () => {
  it('item que nao aponta falta (AN +1.100) entra na secao Demanda do comercial e fica fora da lista de compra', () => {
    const linhas = linhasDe(casoE());
    const rel = montarRelatorioCompras(quinzenaDe(linhas), [], { demandasComerciais: [demanda('2027-02-10', 1600)] });
    expect(rel.totais.itens).toBe(0);
    expect(rel.grupos).toEqual([]);
    expect(rel.demandaComercial.itens).toHaveLength(1);
    expect(rel.demandaComercial.itens[0]).toMatchObject({ situacao: 'alem-do-horizonte', saldoLivre: 500, sugerido: 1100 });
  });

  it('sem demandas: relatorio identico ao de antes (so ganha a secao vazia)', () => {
    const linhas = linhasDe(casoE({ estoque: 0 }));
    const antes = montarRelatorioCompras(quinzenaDe(linhas), []);
    const com = montarRelatorioCompras(quinzenaDe(linhas), [], { demandasComerciais: [] });
    expect(com).toStrictEqual(antes);
    expect(antes.demandaComercial).toEqual({ itens: [], totais: { abertas: 0, sugeridoKg: 0 } });
    expect(antes.grupos[0].itens[0]).not.toHaveProperty('demandaComercialKg');
  });

  it('demanda dentro do horizonte nao muda o item da lista (sem selo)', () => {
    const linhas = linhasDe(casoE({ estoque: 0 }));
    const rel = montarRelatorioCompras(quinzenaDe(linhas), [], { demandasComerciais: [demanda('2026-12-01', 1600)] });
    expect(rel.grupos[0].itens[0]).not.toHaveProperty('demandaComercialKg');
    expect(rel.demandaComercial.itens[0]).toMatchObject({ situacao: 'no-horizonte', noRelatorio: true, sugerido: 0 });
  });

  it('produto sob demanda (6a): a demanda do comercial e listada, mas nao vira selo na lista (o item nem esta nela)', () => {
    const linhas = linhasDe(casoE({ estoque: 0 }));
    const rel = montarRelatorioCompras(quinzenaDe(linhas), [], {
      sobDemanda: new Map([[PRODUCT_ID, { motivo: 'MOTIVO SINTETICO' }]]),
      demandasComerciais: [demanda('2027-02-10', 1600)],
    });
    expect(rel.totais.itens).toBe(0);
    expect(rel.sobDemanda.itens).toHaveLength(1);
    expect(rel.demandaComercial.itens[0]).toMatchObject({ noRelatorio: false, sugerido: 1600 });
  });
});

describe('gateway futuro: a regra e funcao pura', () => {
  it('forecastDemandaComercial.ts nao importa exceljs nem prisma', () => {
    const fonte = readFileSync(resolve(__dirname, '..', 'src', 'utils', 'forecastDemandaComercial.ts'), 'utf8');
    const imports = fonte.split(String.fromCharCode(10)).filter((linha) => linha.startsWith('import '));
    expect(imports.join(' ')).not.toMatch(/exceljs|prisma/i);
    expect(fonte).not.toContain('require(');
  });
});
