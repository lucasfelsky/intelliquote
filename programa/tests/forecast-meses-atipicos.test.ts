import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// conferenciaDaQuinzena vive em um service que importa o Prisma; aqui so a funcao pura e usada.
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import { conferenciaDaQuinzena } from '../src/services/ForecastSnapshotService';
import { calcular, conferir } from '../src/utils/forecastEngine';
import {
  indicesForaDaMedia,
  mapaForaDaMedia,
  marcasNaJanela,
  mesesDaJanelaDeVendas,
} from '../src/utils/forecastMesesAtipicos';
import {
  montarRelatorioCompras,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
} from '../src/utils/forecastRelatorioCompras';
import type { Produto, Quinzena } from '../src/utils/forecastTypes';

// Meses atipicos (PR 6c): o mes marcado sai das medias Q e R (divide pelos meses restantes). Dados 100% sinteticos /
// fixture anonimizada (repo publico). Caso A do plano: base 2026-10-15, hoje 2026-10-20, 2a quinzena.
const BASE = '2026-10-15';
const HOJE = '2026-10-20';

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const produto: Produto = {
  linha: 3,
  n: 1,
  item: 'PRODUTO 001',
  codigos: ['C0001', '', '', '', '', '', ''],
  historico: [300, 300, 300, 300, 2100],
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

// J..N = [300, 300, 300, 300, 2100] (N = 2026-08 atipico), O = 300, P = 100, estoque 2.500, chegada 1.000 no mes base,
// programacoes 1.000 nos 4 meses, lead time 90 dias, anual 1.100 (S = 100).
function casoA(extra: { vendasAtual?: number; historico?: number[]; vendasMes?: number } = {}): Quinzena {
  return {
    id: '10-2',
    arquivo: 'sintetica',
    dataBase: BASE,
    mesesConsumo: ['04', '05', '06', '07', '08', '09', '10'],
    mesesChegada: ['10', '11', '12', '01', '02'],
    mesesProgramacao: ['10', '11', '12', '01'],
    produtos: [{ ...produto, historico: extra.historico ?? produto.historico }],
    entradas: {
      estoque: [{ codigo: 'C0001', qtd: 2500 }],
      vendasMes: [{ codigo: 'C0001', qtd: extra.vendasMes ?? 300 }],
      vendasAtual: [{ codigo: 'C0001', qtd: extra.vendasAtual ?? 100 }],
      vendasAnual: [{ codigo: 'C0001', qtd: 1100 }],
      programacoes: ['10', '11', '12', '01'].map((mes) => ({ codigo: 'C0001', qtd: 1000, mes })),
      chegadas: [{ codigo: 'C0001', qtd: 1000, mes: '10' }],
      leadtime: [{ fonte: 'FONTE 001', total: 90 }],
      margem: [],
      clientesAtivos: [],
    },
    esperado: {},
  };
}

const fora = (...indices: number[]) => new Map([[3, new Set(indices)]]);

describe('motor: opcao mesesForaDaMedia', () => {
  it('caso A: o mes atipico (N, 2026-08) sai da media e a compra cai de 4.100 para 1.700', () => {
    const q = casoA();
    const [planilha] = calcular(q, { hoje: HOJE });
    const [ajustada] = calcular(q, { hoje: HOJE, mesesForaDaMedia: fora(4) });

    expect(planilha).toMatchObject({ Q: 900, R: 600, S: 100, AG: 900, T: 2700, AN: -4100 });
    expect(ajustada).toMatchObject({ Q: 300, R: 300, S: 100, AG: 300, T: 900, AN: -1700 });
    expect(ajustada.mediaAjustada).toEqual({ meses: [4], Q: 900, R: 600, AG: 900, semMesValido: false });
    expect(planilha.mediaAjustada).toBeUndefined();
    // T, AG, projecao e AN usam a media ajustada (expressoes intactas): AH = 2500 + 1000 - 1000 - AG.
    expect(ajustada.projecao).toEqual([2200, 900, -400, -1700, -2000, -2300]);
    expect(planilha.projecao).toEqual([1600, -300, -2200, -4100, -5000, -5900]);
    // S (anual agregado do DBCorp, sem quebra mensal) e o resto nao mudam.
    expect(ajustada.S).toBe(planilha.S);
    expect(ajustada.O).toBe(planilha.O);
    expect(ajustada.P).toBe(planilha.P);
    expect(ajustada.U).toBe(planilha.U);
    expect(ajustada.chegadas).toEqual(planilha.chegadas);
  });

  it('mes atual marcado (P = 1.000): AG = Q tambem na 2a quinzena; na planilha AG seria o P', () => {
    const q = casoA({ vendasAtual: 1000 });
    const [planilha] = calcular(q, { hoje: HOJE });
    expect(planilha.AG).toBe(1000);
    const [soP] = calcular(q, { hoje: HOJE, mesesForaDaMedia: fora(6) });
    // So o P marcado: Q e R iguais aos da planilha, AG = Q (900), sinalizado em mediaAjustada.
    expect(soP.Q).toBe(900);
    expect(soP.R).toBe(600);
    expect(soP.AG).toBe(900);
    expect(soP.mediaAjustada).toEqual({ meses: [6], Q: 900, R: 600, AG: 1000, semMesValido: false });
    const [nEP] = calcular(q, { hoje: HOJE, mesesForaDaMedia: fora(4, 6) });
    expect(nEP).toMatchObject({ Q: 300, R: 300, AG: 300 });
    expect(nEP.mediaAjustada?.meses).toEqual([4, 6]);
  });

  it('1a quinzena: AG ja e Q; P marcado nao muda nada alem do aviso', () => {
    const q = casoA({ vendasAtual: 1000 });
    const [l] = calcular(q, { hoje: HOJE, quinzena: 1, mesesForaDaMedia: fora(4, 6) });
    expect(l.AG).toBe(l.Q);
    expect(l.Q).toBe(300);
  });

  it('os 3 meses do trimestre marcados: Q fica o da planilha (sem divisao por zero) e semMesValido avisa', () => {
    const q = casoA();
    const [l] = calcular(q, { hoje: HOJE, mesesForaDaMedia: fora(3, 4, 5) });
    expect(l.Q).toBe(900);
    expect(Number.isFinite(l.Q)).toBe(true);
    // J, K, L continuam validos para a semestral: (300 + 300 + 300) / 3.
    expect(l.R).toBe(300);
    expect(l.mediaAjustada).toEqual({ meses: [3, 4, 5], Q: 900, R: 600, AG: 900, semMesValido: true });
    expect(l.AN).toBe(-4100);
  });

  it('os 6 meses marcados: Q e R ficam os da planilha, finitos; com P marcado AG = Q', () => {
    const q = casoA({ vendasAtual: 1000 });
    const [l] = calcular(q, { hoje: HOJE, mesesForaDaMedia: fora(0, 1, 2, 3, 4, 5, 6) });
    expect(l).toMatchObject({ Q: 900, R: 600, AG: 900, T: 2700, AN: -4100 });
    expect(l.mediaAjustada?.semMesValido).toBe(true);
    expect(Number.isNaN(l.R)).toBe(false);
  });

  it('marca so em J/K/L: muda apenas a semestral (R); Q, AG e AN ficam', () => {
    const q = casoA();
    const [planilha] = calcular(q, { hoje: HOJE });
    const [l] = calcular(q, { hoje: HOJE, mesesForaDaMedia: fora(0) });
    expect(l.R).toBe((300 + 300 + 300 + 2100 + 300) / 5);
    expect(l.Q).toBe(planilha.Q);
    expect(l.AG).toBe(planilha.AG);
    expect(l.AN).toBe(planilha.AN);
    expect(l.mediaAjustada).toMatchObject({ meses: [0], semMesValido: false });
  });

  it('mes sem venda (valor 0) marcado: sai da media e a media sobe, sem erro', () => {
    const q = casoA({ historico: [300, 300, 300, 0, 600], vendasMes: 300 });
    const [planilha] = calcular(q, { hoje: HOJE });
    expect(planilha.Q).toBe(300);
    const [l] = calcular(q, { hoje: HOJE, mesesForaDaMedia: fora(3) });
    expect(l.Q).toBe(450);
  });

  it('indice fora de 0..6, opcao vazia e linha ausente do mapa: resultado identico ao da planilha', () => {
    const q = casoA();
    const base = calcular(q, { hoje: HOJE });
    expect(calcular(q, { hoje: HOJE, mesesForaDaMedia: fora(7, -1, 99) })).toStrictEqual(base);
    expect(calcular(q, { hoje: HOJE, mesesForaDaMedia: fora() })).toStrictEqual(base);
    expect(calcular(q, { hoje: HOJE, mesesForaDaMedia: new Map() })).toStrictEqual(base);
    expect(calcular(q, { hoje: HOJE, mesesForaDaMedia: new Map([[99, new Set([4])]]) })).toStrictEqual(base);
    expect(calcular(q, { hoje: HOJE, mesesForaDaMedia: undefined })).toStrictEqual(base);
  });

  it('fixture inteira SEM marcacao: resultado identico, sem a chave mediaAjustada, 9.464/9.464 com a planilha', () => {
    const sem = calcular(fixture, { hoje: HOJE, somarChegada5oMes: false });
    const comOpcaoVazia = calcular(fixture, {
      hoje: HOJE,
      somarChegada5oMes: false,
      mesesForaDaMedia: new Map(),
    });
    expect(comOpcaoVazia).toStrictEqual(sem);
    expect(sem.every((l) => !('mediaAjustada' in l))).toBe(true);
    const resultado = conferir(fixture, comOpcaoVazia);
    expect(resultado.celulas).toBe(9464);
    expect(resultado.batem).toBe(9464);
    // A conferencia que o painel usa (sem parametro de marcas) tambem fecha 9.464/9.464.
    const conferencia = conferenciaDaQuinzena(fixture, HOJE);
    expect(conferencia.celulas).toBe(9464);
    expect(conferencia.batem).toBe(9464);
  });

  it('fixture com meses marcados em varias linhas: so as linhas marcadas mudam', () => {
    const marcadas = new Map(fixture.produtos.slice(0, 10).map((p) => [p.linha, new Set([4])]));
    const sem = calcular(fixture, { hoje: HOJE });
    const com = calcular(fixture, { hoje: HOJE, mesesForaDaMedia: marcadas });
    com.forEach((l, i) => {
      if (marcadas.has(l.linha)) {
        expect(l.mediaAjustada?.meses).toEqual([4]);
        expect(l.mediaAjustada?.Q).toBe(sem[i].Q);
        expect(Number.isFinite(l.Q) && Number.isFinite(l.R)).toBe(true);
      } else {
        expect(l).toStrictEqual(sem[i]);
      }
    });
  });
});

describe('util: janela de vendas e mapa dos meses marcados', () => {
  it('a janela tem os 7 meses J..N, O e P (mes base) em ordem', () => {
    expect(mesesDaJanelaDeVendas(BASE)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    // Virada de ano.
    expect(mesesDaJanelaDeVendas('2027-02-05')).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('indicesForaDaMedia: mes da janela vira indice; mes fora da janela e ignorado', () => {
    expect([...indicesForaDaMedia(BASE, ['2026-08'])]).toEqual([4]);
    expect([...indicesForaDaMedia(BASE, ['2026-04', '2026-09', '2026-10'])].sort()).toEqual([0, 5, 6]);
    expect(indicesForaDaMedia(BASE, ['2026-03', '2026-11', '2025-08', 'lixo']).size).toBe(0);
  });

  it('quinzena nova herda a marca: o mesmo mes vira outro indice conforme a data base', () => {
    const marcados = ['2026-08'];
    expect([...indicesForaDaMedia('2026-10-15', marcados)]).toEqual([4]);
    expect([...indicesForaDaMedia('2026-11-05', marcados)]).toEqual([3]);
    expect([...indicesForaDaMedia('2026-12-05', marcados)]).toEqual([2]);
    expect([...indicesForaDaMedia('2027-02-05', marcados)]).toEqual([0]);
  });

  it('mes saindo da janela: a marca deixa de valer na quinzena seguinte e o calculo volta ao da planilha', () => {
    const q = casoA();
    const produtos = q.produtos.map((p) => ({ ...p, productId: 7 }));
    const noMes = mapaForaDaMedia(produtos, new Map([[7, ['2026-04']]]), BASE);
    expect(noMes.get(3)).toEqual(new Set([0]));
    // Um mes depois (base 2026-11-05) a janela comeca em 2026-05: 2026-04 saiu e nao entra no mapa.
    const depois = mapaForaDaMedia(produtos, new Map([[7, ['2026-04']]]), '2026-11-05');
    expect(depois.size).toBe(0);
    expect(calcular({ ...q, dataBase: '2026-11-05' }, { hoje: '2026-11-06', mesesForaDaMedia: depois })).toStrictEqual(
      calcular({ ...q, dataBase: '2026-11-05' }, { hoje: '2026-11-06' }),
    );
  });

  it('mapaForaDaMedia: produto sem productId ou sem marca fica fora do mapa; a chave e a linha', () => {
    const mapa = mapaForaDaMedia(
      [
        { linha: 3, productId: 7 },
        { linha: 4, productId: null },
        { linha: 5 },
        { linha: 6, productId: 8 },
      ],
      new Map([
        [7, ['2026-08', '2026-10']],
        [8, []],
        [9, ['2026-08']],
      ]),
      BASE,
    );
    expect([...mapa.keys()]).toEqual([3]);
    expect(mapa.get(3)).toEqual(new Set([4, 6]));
  });

  it('marcasNaJanela devolve so as marcas da janela, com o indice e em ordem cronologica', () => {
    const marcas = marcasNaJanela(BASE, [
      { anoMes: '2026-09', motivo: 'MOTIVO UM' },
      { anoMes: '2025-01', motivo: 'FORA DA JANELA' },
      { anoMes: '2026-08', motivo: 'MOTIVO DOIS' },
    ]);
    expect(marcas).toEqual([
      { anoMes: '2026-08', motivo: 'MOTIVO DOIS', indice: 4 },
      { anoMes: '2026-09', motivo: 'MOTIVO UM', indice: 5 },
    ]);
  });
});

describe('relatorio de compras com meses atipicos', () => {
  function relatorio(q: Quinzena, mesesMarcados: string[]) {
    const mapa = mapaForaDaMedia(
      q.produtos.map((p) => ({ ...p, productId: 7 })),
      new Map([[7, mesesMarcados]]),
      q.dataBase,
    );
    const calculadas = calcular(q, { hoje: HOJE, quinzena: 2, mesesForaDaMedia: mapa });
    const linhas: LinhaParaRelatorio[] = calculadas.map((c) => {
      const p = q.produtos.find((x) => x.linha === c.linha)!;
      return {
        ...c,
        n: p.n,
        productId: 7,
        item: p.item,
        codigos: p.codigos.filter((x) => x !== ''),
        fonte: p.fonte,
        status: p.status,
        mesesForaDaMedia: marcasNaJanela(
          q.dataBase,
          mesesMarcados.map((anoMes) => ({ anoMes, motivo: 'MOTIVO SINTETICO' })),
        ),
      };
    });
    const quinzena: QuinzenaParaRelatorio = {
      id: 1,
      label: q.id,
      baseDate: q.dataBase,
      half: 2,
      origin: 'planilha',
      hoje: HOJE,
      linhas,
    };
    return montarRelatorioCompras(quinzena, []);
  }

  it('o item sai com a demanda sem o mes atipico (1.700 contra 4.100) e lista o mes fora da media', () => {
    const planilha = relatorio(casoA(), []);
    const ajustada = relatorio(casoA(), ['2026-08']);
    const a = planilha.grupos[0].itens[0];
    const b = ajustada.grupos[0].itens[0];
    expect(a.quantidadeSugerida).toBe(4100);
    expect(b.quantidadeSugerida).toBe(1700);
    expect(a.mesesForaDaMedia).toEqual([]);
    expect(b.mesesForaDaMedia).toEqual(['2026-08']);
    expect(planilha.totais.itens).toBe(1);
    expect(ajustada.totais.itens).toBe(1);
  });

  it('so avisa "Media sem" quando a marca muda a compra: J/K/L mudam so R e ficam so na memoria de calculo', () => {
    const planilha = relatorio(casoA(), []).grupos[0].itens[0];
    // 2026-04 = J (indice 0): muda R, nao Q/T/AN -> a compra e a mesma e o relatorio nao avisa.
    const soJ = relatorio(casoA(), ['2026-04']).grupos[0].itens[0];
    expect(soJ.quantidadeSugerida).toBe(planilha.quantidadeSugerida);
    expect(soJ.mesesForaDaMedia).toEqual([]);
    const jKL = relatorio(casoA(), ['2026-04', '2026-05', '2026-06']).grupos[0].itens[0];
    expect(jKL.quantidadeSugerida).toBe(planilha.quantidadeSugerida);
    expect(jKL.mesesForaDaMedia).toEqual([]);
    // J + N (indice 4): so o N muda a compra, so ele aparece na linha do relatorio.
    const jN = relatorio(casoA(), ['2026-04', '2026-08']).grupos[0].itens[0];
    expect(jN.quantidadeSugerida).toBe(1700);
    expect(jN.mesesForaDaMedia).toEqual(['2026-08']);
  });

  it('M, N e O todos marcados (sem mes valido): Q e o da planilha, a compra nao muda e o relatorio nao avisa', () => {
    const planilha = relatorio(casoA(), []).grupos[0].itens[0];
    const semMesValido = relatorio(casoA(), ['2026-07', '2026-08', '2026-09']).grupos[0].itens[0];
    expect(semMesValido.quantidadeSugerida).toBe(planilha.quantidadeSugerida);
    expect(semMesValido.mesesForaDaMedia).toEqual([]);
  });

  it('mes atual (P) marcado so avisa quando a AG muda (venda ate o dia 15 acima da media)', () => {
    // P = 100 < Q = 900: AG = Q com ou sem a marca -> nada muda.
    expect(relatorio(casoA(), ['2026-10']).grupos[0].itens[0].mesesForaDaMedia).toEqual([]);
    // P = 5.000 > Q: a planilha usa AG = 5.000; com a marca AG = Q -> a projecao muda e o relatorio avisa.
    expect(relatorio(casoA({ vendasAtual: 5000 }), ['2026-10']).grupos[0].itens[0].mesesForaDaMedia).toEqual(['2026-10']);
  });

  it('mes marcado fora da janela da quinzena: relatorio identico ao sem marca', () => {
    expect(relatorio(casoA(), ['2025-01'])).toStrictEqual(relatorio(casoA(), []));
  });

  it('item sem consumo e item sob demanda tambem carregam os meses fora da media', () => {
    const q = casoA({ historico: [0, 0, 0, 0, 900], vendasMes: 0, vendasAtual: 0 });
    q.entradas.programacoes = [];
    q.entradas.chegadas = [];
    q.entradas.estoque = [{ codigo: 'C0001', qtd: 100 }];
    // Planilha: Q = (0 + 900 + 0) / 3 = 300, AN = 100 - 900 - 300 = -1.100: entra na lista de compra.
    expect(relatorio(q, []).grupos[0].itens[0].quantidadeSugerida).toBe(1100);
    // Com 2026-08 (N) fora so sobram M = 0 e O = 0: Q = 0, AN = 100 > 0 -> sai da lista e fica em "sem consumo".
    const r = relatorio(q, ['2026-08']);
    expect(r.grupos).toHaveLength(0);
    expect(r.semConsumo.itens).toHaveLength(1);
    expect(r.semConsumo.itens[0].mesesForaDaMedia).toEqual(['2026-08']);

    const mapa = mapaForaDaMedia(
      casoA().produtos.map((p) => ({ ...p, productId: 7 })),
      new Map([[7, ['2026-08']]]),
      BASE,
    );
    const [c] = calcular(casoA(), { hoje: HOJE, mesesForaDaMedia: mapa });
    const sob = montarRelatorioCompras(
      {
        id: 1,
        label: '10-2',
        baseDate: BASE,
        half: 2,
        origin: 'planilha',
        hoje: HOJE,
        linhas: [
          {
            ...c,
            productId: 7,
            item: 'PRODUTO 001',
            codigos: ['C0001'],
            fonte: 'FONTE 001',
            status: 'nao',
            mesesForaDaMedia: [{ anoMes: '2026-08' }],
          },
        ],
      },
      [],
      { sobDemanda: new Map([[7, { motivo: 'MOTIVO SINTETICO' }]]) },
    );
    expect(sob.sobDemanda.itens[0].mesesForaDaMedia).toEqual(['2026-08']);
    expect(sob.totais.itens).toBe(0);
  });
});
