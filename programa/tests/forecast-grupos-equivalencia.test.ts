import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcular } from '../src/utils/forecastEngine';
import {
  agruparLinhas,
  linhasParaDemandaComercial,
  type GrupoDeEquivalencia,
} from '../src/utils/forecastGruposEquivalencia';
import type { DemandaComercialAberta } from '../src/utils/forecastDemandaComercial';
import {
  montarRelatorioCompras,
  type EmbalagemCadastrada,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
} from '../src/utils/forecastRelatorioCompras';
import type { Produto, Quinzena } from '../src/utils/forecastTypes';

// Grupos de equivalencia (PR 6b): estoque do grupo SOMADO sobre o motor por produto. Dados 100% sinteticos (repo publico).
// Caso B do plano: PRODUTO 001 (FONTE 001), PRODUTO 002 (FONTE 002) e PRODUTO 003 (FONTE 003, sem lead time) sao o mesmo
// material. Base 2026-10-15, hoje 2026-10-20 (2a quinzena).
const BASE = '2026-10-15';
const HOJE = '2026-10-20';

interface Spec {
  linha: number;
  productId: number;
  item: string;
  fonte: string;
  codigo: string;
  Q: number;
  U: number;
  /** Chegada no mes base (10). */
  chegada?: number;
  /** Programacao no mes 11. */
  programacao?: number;
  obs?: string;
  status?: string;
  /** Historico J..N do produto (default: Q em todos). */
  historico?: number[];
}

const LEAD_TIMES = { 'FONTE 001': 60, 'FONTE 002': 60 } as Record<string, number>;

function quinzenaMotor(specs: Spec[], leadTimes: Record<string, number> = LEAD_TIMES): Quinzena {
  const produtos: Produto[] = specs.map((s) => ({
    linha: s.linha,
    n: s.linha,
    item: s.item,
    codigos: [s.codigo, '', '', '', '', '', ''],
    historico: s.historico ?? [s.Q, s.Q, s.Q, s.Q, s.Q],
    analiseForecast: null,
    obs: s.obs ?? '',
    fonte: s.fonte,
    precoFechado: '',
    embalagem: '',
    naoFraciona: '',
    qtdAmostra: '',
    solicitarAmostra: '',
    status: (s.status ?? 'nao') as Produto['status'],
  }));
  return {
    id: '10-2',
    arquivo: 'sintetica',
    dataBase: BASE,
    mesesConsumo: ['04', '05', '06', '07', '08', '09', '10'],
    mesesChegada: ['10', '11', '12', '01', '02'],
    mesesProgramacao: ['10', '11', '12', '01'],
    produtos,
    entradas: {
      estoque: specs.map((s) => ({ codigo: s.codigo, qtd: s.U })),
      vendasMes: specs.map((s) => ({ codigo: s.codigo, qtd: s.Q })),
      vendasAtual: specs.map((s) => ({ codigo: s.codigo, qtd: 0 })),
      vendasAnual: specs.map((s) => ({ codigo: s.codigo, qtd: s.Q * 11 })),
      programacoes: specs.flatMap((s) => (s.programacao ? [{ codigo: s.codigo, qtd: s.programacao, mes: '11' }] : [])),
      chegadas: specs.flatMap((s) => (s.chegada ? [{ codigo: s.codigo, qtd: s.chegada, mes: '10' }] : [])),
      leadtime: Object.entries(leadTimes).map(([fonte, total]) => ({ fonte, total })),
      margem: [],
      clientesAtivos: [],
    },
    esperado: {},
  };
}

function linhasDe(specs: Spec[], leadTimes?: Record<string, number>): LinhaParaRelatorio[] {
  const q = quinzenaMotor(specs, leadTimes);
  return calcular(q, { hoje: HOJE, quinzena: 2 }).map((c) => {
    const spec = specs.find((s) => s.linha === c.linha)!;
    return {
      ...c,
      n: spec.linha,
      productId: spec.productId,
      item: spec.item,
      codigos: [spec.codigo],
      fonte: spec.fonte,
      status: spec.status ?? 'nao',
      obs: spec.obs ?? '',
    };
  });
}

function quinzenaDe(linhas: LinhaParaRelatorio[]): QuinzenaParaRelatorio {
  return { id: 1, label: '10-2', baseDate: BASE, half: 2, origin: 'planilha', hoje: HOJE, linhas };
}

const P001: Spec = { linha: 1, productId: 1, item: 'PRODUTO 001', fonte: 'FONTE 001', codigo: 'C0001', Q: 100, U: 0 };
const P002: Spec = { linha: 2, productId: 2, item: 'PRODUTO 002', fonte: 'FONTE 002', codigo: 'C0002', Q: 50, U: 1000 };
const P003: Spec = { linha: 3, productId: 3, item: 'PRODUTO 003', fonte: 'FONTE 003', codigo: 'C0003', Q: 0, U: 200 };

const GRUPO: GrupoDeEquivalencia = { id: 10, nome: 'GRUPO SINTETICO', principalProductId: 1, productIds: [1, 2, 3] };

const casoB = (extra: Partial<Spec> = {}) => linhasDe([P001, { ...P002, ...extra }, P003]);
const relatorio = (linhas: LinhaParaRelatorio[], grupos: GrupoDeEquivalencia[] = [GRUPO], opcoes = {}, emb: EmbalagemCadastrada[] = []) =>
  montarRelatorioCompras(quinzenaDe(linhas), emb, { grupos, ...opcoes });
const itensDaLista = (r: ReturnType<typeof montarRelatorioCompras>) => r.grupos.flatMap((g) => g.itens);

describe('premissas do caso B (motor por produto)', () => {
  it('cada produto sozinho: P001 compra 300; P002 tem folga; P003 sem lead time (AN nulo)', () => {
    const [a, b, c] = casoB();
    expect(a.AN).toBeCloseTo(-300, 9);
    expect(b.AN).toBeCloseTo(850, 9);
    expect(c.AN).toBeNull();
    const r = relatorio(casoB(), []);
    expect(itensDaLista(r).map((i) => [i.item, i.quantidadeSugerida])).toEqual([['PRODUTO 001', 300]]);
    expect(r.fora.semLeadTime).toBe(1);
    expect(r.cobertosPorGrupo.itens).toEqual([]);
    expect(r.gruposDeEquivalencia).toEqual([]);
  });
});

describe('grupo coberto (caso B)', () => {
  const r = relatorio(casoB());

  it('AN_g = 1.200 - 300 - 150 = +750: PRODUTO 001 sai da lista para "cobertos pelo grupo"', () => {
    expect(itensDaLista(r)).toEqual([]);
    expect(r.totais.itens).toBe(0);
    expect(r.cobertosPorGrupo.itens).toHaveLength(1);
    expect(r.cobertosPorGrupo.itens[0]).toMatchObject({
      item: 'PRODUTO 001',
      productId: 1,
      fonte: 'FONTE 001',
      demanda: -300,
      quantidadeSugerida: 300,
      grupoId: 10,
      grupoNome: 'GRUPO SINTETICO',
      principalItem: 'PRODUTO 001',
      estoqueDoGrupo: 1200,
      cobertura: 8,
    });
    expect(r.fora.cobertosPorGrupo).toBe(1);
  });

  it('o membro sem lead time NAO perde o estoque: entra na soma e nao conta como "sem lead time"', () => {
    expect(r.fora.semLeadTime).toBe(0);
    const g = r.gruposDeEquivalencia[0];
    expect(g).toMatchObject({
      id: 10,
      nome: 'GRUPO SINTETICO',
      situacao: 'coberto',
      principalItem: 'PRODUTO 001',
      estoque: 1200,
      mediaTrimestral: 150,
      demanda: 750,
      cobertura: 8,
    });
    expect(g.seguranca).toBeCloseTo(300, 9);
    expect(g.membros.map((m) => [m.item, m.principal, m.semLeadTime, m.demandaIndividual === null ? null : Math.round(m.demandaIndividual)])).toEqual([
      ['PRODUTO 001', true, false, -300],
      ['PRODUTO 002', false, false, 850],
      ['PRODUTO 003', false, true, null],
    ]);
  });

  it('membros que nao entrariam sozinhos nao aparecem em "cobertos" (nada a esconder)', () => {
    expect(r.cobertosPorGrupo.itens.map((i) => i.item)).toEqual(['PRODUTO 001']);
    expect(r.semConsumo.itens).toEqual([]);
  });
});

describe('grupo que precisa comprar (variante do caso B: PRODUTO 002 com estoque 100)', () => {
  const linhas = casoB({ U: 100 });
  const r = relatorio(linhas);

  it('AN_g = 300 - 300 - 150 = -150: UMA linha de grupo com 150 kg na FONTE 001 e nenhum membro avulso', () => {
    const itens = itensDaLista(r);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({
      item: 'GRUPO SINTETICO',
      linha: 1,
      productId: 1,
      demanda: -150,
      quantidadeSugerida: 150,
      quantidadeFinal: 150,
      leadTimeDias: 60,
      codigos: ['C0001'],
    });
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].fonte).toBe('FONTE 001');
    expect(r.cobertosPorGrupo.itens).toEqual([]);
    expect(r.fora.cobertosPorGrupo).toBe(0);
    expect(r.totais).toMatchObject({ itens: 1, fontes: 1 });
  });

  it('a linha traz os membros (sublinhas) e a situacao "na-lista"', () => {
    const item = itensDaLista(r)[0];
    expect(item.grupo?.membros.map((m) => m.item)).toEqual(['PRODUTO 001', 'PRODUTO 002', 'PRODUTO 003']);
    expect(item.grupo?.cobertura).toBeCloseTo(300 / 150, 9);
    expect(r.gruposDeEquivalencia.map((g) => g.situacao)).toEqual(['na-lista']);
  });

  it('a ruptura vem da projecao SOMADA e a data-limite do lead time do principal', () => {
    const item = itensDaLista(r)[0];
    const somaProjecao = linhas.slice(0, 3).map((l) => l.projecao);
    const esperada = somaProjecao[0].map((_, i) => somaProjecao.reduce((t, p) => t + p[i], 0));
    // Estoque somado 300, consumo 150 por mes: sobra 150 em out, 0 em nov e falta 150 em dez (nenhum membro sozinho mostra isso).
    expect(esperada.slice(0, 3).map(Math.round)).toEqual([150, 0, -150]);
    expect(item.ruptura).toMatchObject({ anoMes: '2026-12', data: '2026-12-01', jaNaDataBase: false });
    expect(item.dataLimite).toBe('2026-10-02'); // ruptura 2026-12-01 - 60 dias (lead time do principal)
    expect(item.vencida).toBe(true);
    expect(item.urgencia).toBe('atrasado');
  });
});

describe('invariantes da formula', () => {
  it('com lead time em todos os membros, AN_g = soma das AN dos membros (linearidade)', () => {
    const specs: Spec[] = [
      { ...P001, U: 50, chegada: 30, programacao: 20 },
      { ...P002, U: 400, programacao: 90 },
      { linha: 4, productId: 4, item: 'PRODUTO 004', fonte: 'FONTE 001', codigo: 'C0004', Q: 33, U: 5, chegada: 11 },
    ];
    const linhas = linhasDe(specs);
    const { grupos } = agruparLinhas(linhas, [{ id: 1, nome: 'GRUPO SINTETICO', principalProductId: null, productIds: [1, 2, 4] }]);
    const somaAN = linhas.reduce((t, l) => t + (l.AN as number), 0);
    expect(grupos[0].dados.demanda).toBeCloseTo(somaAN, 9);
    expect(grupos[0].linha.AN).toBeCloseTo(somaAN, 9);
  });

  it('sem grupos (ou grupo sem 2 membros na quinzena) o relatorio e IDENTICO ao de antes', () => {
    const linhas = casoB({ U: 100 });
    const base = relatorio(linhas, []);
    const semOpcao = montarRelatorioCompras(quinzenaDe(linhas), []);
    expect(semOpcao).toEqual(base);
    const ignorado = relatorio(linhas, [
      { id: 1, nome: 'UM SO', principalProductId: 1, productIds: [1] },
      { id: 2, nome: 'AUSENTES', principalProductId: 99, productIds: [1, 98, 99] },
    ]);
    expect(ignorado).toEqual(base);
  });

  it('agruparLinhas: mesma ordem, o grupo ocupa o lugar do principal e os outros membros saem', () => {
    const linhas = casoB();
    const r = agruparLinhas(linhas, [GRUPO]);
    expect(r.linhas.map((l) => l.linha)).toEqual([1]);
    expect(r.avulsas).toEqual([]);
    expect(r.grupos).toHaveLength(1);
    const outros = agruparLinhas(linhas, []);
    expect(outros.linhas).toEqual(linhas);
    expect(outros.avulsas).toEqual(linhas);
  });

  it('produto em dois grupos: o primeiro vence (o cadastro ja garante 1 grupo por produto)', () => {
    const linhas = casoB();
    const r = agruparLinhas(linhas, [
      { id: 1, nome: 'A', principalProductId: null, productIds: [1, 2] },
      { id: 2, nome: 'B', principalProductId: null, productIds: [2, 3] },
    ]);
    expect(r.grupos.map((g) => g.dados.id)).toEqual([1]);
    expect(r.avulsas.map((l) => l.linha)).toEqual([3]);
  });

  it('o util nao importa Prisma nem exceljs (gateway futuro)', () => {
    for (const arquivo of ['forecastGruposEquivalencia.ts', 'forecastRelatorioCompras.ts', 'forecastEngine.ts']) {
      const texto = readFileSync(resolve(__dirname, '..', 'src', 'utils', arquivo), 'utf8');
      const imports = texto.split('\n').filter((l) => /^\s*(import|export)\b.*from\s/.test(l));
      expect(imports.join(' ')).not.toMatch(/exceljs|prisma/i);
    }
  });
});

describe('principal do grupo', () => {
  it('sem principal cadastrado: o membro de maior media; empate: menor linha', () => {
    const linhas = casoB({ U: 100 });
    const sem = agruparLinhas(linhas, [{ ...GRUPO, principalProductId: null }]);
    expect(sem.grupos[0].dados.principalItem).toBe('PRODUTO 001'); // Q 100 > 50 > 0
    const empate = agruparLinhas(casoB({ U: 100, Q: 100 }), [{ ...GRUPO, principalProductId: null }]);
    expect(empate.grupos[0].dados.principalItem).toBe('PRODUTO 001'); // empate de Q: menor linha
  });

  it('principal cadastrado que nao tem linha na quinzena: cai no de maior media', () => {
    const r = agruparLinhas(casoB({ U: 100 }), [{ ...GRUPO, principalProductId: 99 }]);
    expect(r.grupos[0].dados.principalItem).toBe('PRODUTO 001');
  });

  it('principal = PRODUTO 002: fonte, lead time, codigos e linha vem dele; o nome do grupo e o item', () => {
    const r = relatorio(casoB({ U: 100 }), [{ ...GRUPO, principalProductId: 2 }]);
    const item = itensDaLista(r)[0];
    expect(item).toMatchObject({ item: 'GRUPO SINTETICO', linha: 2, productId: 2, codigos: ['C0002'] });
    expect(r.grupos[0].fonte).toBe('FONTE 002');
    expect(item.grupo?.principalItem).toBe('PRODUTO 002');
    expect(item.grupo?.membros.filter((m) => m.principal).map((m) => m.item)).toEqual(['PRODUTO 002']);
  });

  it('principal sem lead time: o lead time da linha do grupo e o maior entre os membros que tem', () => {
    const r = agruparLinhas(casoB({ U: 100 }), [{ ...GRUPO, principalProductId: 3 }]);
    expect(r.grupos[0].linha.AQ).toBe(60);
    expect(r.grupos[0].linha.AN).toBeCloseTo(-150, 9);
  });
});

describe('grupo sem lead time em nenhum membro, e sem consumo', () => {
  it('nenhum membro com lead time: AN nulo, conta UMA vez em "sem lead time" e o grupo fica fora', () => {
    const linhas = linhasDe([P001, P002], {});
    expect(linhas.every((l) => l.AN === null)).toBe(true);
    const r = relatorio(linhas, [{ ...GRUPO, productIds: [1, 2] }]);
    expect(r.fora.semLeadTime).toBe(1);
    expect(itensDaLista(r)).toEqual([]);
    expect(r.gruposDeEquivalencia[0]).toMatchObject({ situacao: 'sem-lead-time', demanda: null });
  });

  it('grupo sem consumo mas com estoque vai para "sem consumo" com o nome do grupo', () => {
    const linhas = linhasDe([
      { ...P001, Q: 0, U: 40 },
      { ...P002, Q: 0, U: 10 },
    ]);
    const r = relatorio(linhas, [{ ...GRUPO, productIds: [1, 2] }]);
    expect(r.semConsumo.itens.map((i) => [i.item, i.estoque, i.grupo?.id])).toEqual([['GRUPO SINTETICO', 50, 10]]);
    expect(itensDaLista(r)).toEqual([]);
  });
});

describe('precedencia com as regras anteriores', () => {
  it('6a sob demanda: a marca de um MEMBRO e ignorada (o estoque e a media dele entram na soma)', () => {
    const r = relatorio(casoB({ U: 100 }), [GRUPO], { sobDemanda: new Map([[2, { motivo: 'MOTIVO SINTETICO' }]]) });
    expect(itensDaLista(r).map((i) => [i.item, i.quantidadeSugerida])).toEqual([['GRUPO SINTETICO', 150]]);
    expect(r.sobDemanda.itens).toEqual([]);
  });

  it('6a sob demanda: se o PRINCIPAL e sob demanda, a linha do grupo vai para a secao "Sob demanda"', () => {
    const r = relatorio(casoB({ U: 100 }), [GRUPO], { sobDemanda: new Map([[1, { motivo: 'MOTIVO SINTETICO' }]]) });
    expect(itensDaLista(r)).toEqual([]);
    expect(r.sobDemanda.itens).toHaveLength(1);
    expect(r.sobDemanda.itens[0]).toMatchObject({ item: 'GRUPO SINTETICO', motivo: 'MOTIVO SINTETICO', quantidadeSugerida: 150 });
    expect(r.sobDemanda.itens[0].grupo?.membros).toHaveLength(3);
    expect(r.fora.sobDemanda).toBe(1);
    expect(r.gruposDeEquivalencia[0].situacao).toBe('sob-demanda');
  });

  it('6a sob demanda: grupo coberto continua coberto (a marca do principal nao muda isso)', () => {
    const r = relatorio(casoB(), [GRUPO], { sobDemanda: new Map([[1, { motivo: null }]]) });
    expect(r.cobertosPorGrupo.itens.map((i) => i.item)).toEqual(['PRODUTO 001']);
    expect(r.sobDemanda.itens).toEqual([]);
  });

  it('6c meses atipicos: cada membro usa a sua media ajustada; o grupo mostra a uniao das marcas', () => {
    const linhas = casoB({ U: 100 });
    // PRODUTO 001 com o mes de ago/2026 (indice 3 = M) fora da media: media da planilha 100 -> usada 100 (so avisa se mudar).
    linhas[0] = {
      ...linhas[0],
      mesesForaDaMedia: [{ anoMes: '2026-08', indice: 3 }],
      mediaAjustada: { Q: 120, AG: 120 },
    };
    linhas[1] = {
      ...linhas[1],
      mesesForaDaMedia: [{ anoMes: '2026-08', indice: 3 }, { anoMes: '2026-09', indice: 4 }],
      mediaAjustada: { Q: 50, AG: 50 },
    };
    const r = relatorio(linhas);
    const item = itensDaLista(r)[0];
    expect(item.mesesForaDaMedia).toEqual(['2026-08', '2026-09']);
    expect(item.quantidadeSugerida).toBeCloseTo(150, 9); // a soma natural das Q ja ajustadas dos membros
  });

  it('6c meses atipicos: marca que nao muda a compra de nenhum membro nao avisa no grupo', () => {
    const linhas = casoB({ U: 100 });
    linhas[0] = { ...linhas[0], mesesForaDaMedia: [{ anoMes: '2026-08', indice: 3 }], mediaAjustada: { Q: 100, AG: 100 } };
    expect(itensDaLista(relatorio(linhas))[0].mesesForaDaMedia).toEqual([]);
  });

  it('6d demanda do comercial: o pedido de um membro usa o saldo SOMADO do grupo e o selo vai para a linha do grupo', () => {
    const linhas = casoB({ U: 100 });
    const demanda = (id: number, productId: number, kg: number, necessidade: string): DemandaComercialAberta => ({
      id,
      productId,
      produto: `PRODUTO 00${productId}`,
      fonte: null,
      kg,
      necessidade,
      motivo: 'MOTIVO SINTETICO',
      cliente: null,
      solicitacaoId: null,
    });
    const r = relatorio(linhas, [GRUPO], { demandasComerciais: [demanda(1, 2, 1000, '2027-03-10')] });
    const [pedido] = r.demandaComercial.itens;
    expect(pedido).toMatchObject({ linha: 1, productId: 2, item: 'PRODUTO 002', situacao: 'alem-do-horizonte', noRelatorio: true });
    expect(pedido.saldoLivre).toBe(0); // grupo em falta: nao ha saldo a descontar
    expect(pedido.sugerido).toBe(1000);
    expect(itensDaLista(r)[0].demandaComercialKg).toBe(1000);
  });

  it('6d demanda do comercial: dois pedidos de membros diferentes consomem o MESMO saldo do grupo', () => {
    const linhas = casoB({ U: 5000 });
    const demanda = (id: number, productId: number): DemandaComercialAberta => ({
      id,
      productId,
      produto: `PRODUTO 00${productId}`,
      fonte: null,
      kg: 3000,
      necessidade: '2027-03-10',
      motivo: 'MOTIVO SINTETICO',
      cliente: null,
      solicitacaoId: null,
    });
    const agrupado = agruparLinhas(linhas, [GRUPO]);
    const paraDemanda = linhasParaDemandaComercial(linhas, agrupado.grupos);
    expect(paraDemanda.map((l) => [l.linha, l.productId, l.item])).toEqual([
      [1, 1, 'PRODUTO 001'],
      [1, 2, 'PRODUTO 002'],
      [1, 3, 'PRODUTO 003'],
    ]);
    const r = relatorio(linhas, [GRUPO], { demandasComerciais: [demanda(1, 1), demanda(2, 2)] });
    const [a, b] = r.demandaComercial.itens;
    // Saldo do grupo em mar/2027 (k = 5) = projecao[5] somada; o 1o pedido consome o saldo, o 2o soma o que faltar.
    expect(a.saldoLivre).toBeGreaterThan(0);
    expect(a.sugerido + b.sugerido).toBeCloseTo(6000 - a.saldoLivre!, 6);
    expect(b.saldoLivre).toBe(Math.max(0, a.saldoLivre! - 3000));
  });

  it('5B/6e embalagem e pallet: do produto principal (codigos do principal, nao dos outros membros)', () => {
    const embalagens: EmbalagemCadastrada[] = [
      { codigo: 'C0001', quantidade: 200, palletKg: 600 },
      { codigo: 'C0002', quantidade: 25 },
    ];
    const item = itensDaLista(relatorio(casoB({ U: 100 }), [GRUPO], {}, embalagens))[0];
    expect(item.embalagem.usada).toMatchObject({ codigo: 'C0001', quantidade: 200 });
    expect(item.quantidadeEmbalagens).toBe(1);
    expect(item.quantidadeFinal).toBe(200);
    expect(item.porEmbalagem).toHaveLength(1);
    expect(item.porEmbalagem[0].pallet).toMatchObject({ kgPorPallet: 600, abaixo: { pallets: 0 }, acima: { pallets: 1, kg: 600 } });
  });

  it('observacao do principal e status do principal passam para a linha do grupo', () => {
    const linhas = linhasDe([{ ...P001, obs: 'OBS SINTETICA 001', status: 'cotando' }, { ...P002, U: 100 }]);
    const item = itensDaLista(relatorio(linhas, [{ ...GRUPO, productIds: [1, 2] }]))[0];
    expect(item.obs).toBe('OBS SINTETICA 001');
    expect(item.status).toBe('cotando');
  });
});

describe('varios grupos e ordem', () => {
  it('2 grupos independentes: cada um com os seus membros; "gruposDeEquivalencia" em ordem alfabetica', () => {
    const specs: Spec[] = [
      P001,
      { ...P002, U: 100 },
      { linha: 4, productId: 4, item: 'PRODUTO 004', fonte: 'FONTE 001', codigo: 'C0004', Q: 10, U: 0 },
      { linha: 5, productId: 5, item: 'PRODUTO 005', fonte: 'FONTE 001', codigo: 'C0005', Q: 10, U: 5000 },
    ];
    const r = relatorio(linhasDe(specs), [
      { id: 2, nome: 'ZETA SINTETICO', principalProductId: 4, productIds: [4, 5] },
      { id: 1, nome: 'ALFA SINTETICO', principalProductId: 1, productIds: [1, 2] },
    ]);
    expect(r.gruposDeEquivalencia.map((g) => [g.nome, g.situacao])).toEqual([
      ['ALFA SINTETICO', 'na-lista'],
      ['ZETA SINTETICO', 'coberto'],
    ]);
    expect(itensDaLista(r).map((i) => i.item)).toEqual(['ALFA SINTETICO']);
    expect(r.cobertosPorGrupo.itens.map((i) => [i.grupoNome, i.item])).toEqual([['ZETA SINTETICO', 'PRODUTO 004']]);
  });
});
