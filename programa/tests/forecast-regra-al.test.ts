import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// conferenciaDaQuinzena vive em um service que importa o Prisma; aqui so a funcao pura e usada.
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

import { conferenciaDaQuinzena } from '../src/services/ForecastSnapshotService';
import { calcular } from '../src/utils/forecastEngine';
import {
  montarRelatorioCompras,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
} from '../src/utils/forecastRelatorioCompras';
import type { Produto, Quinzena } from '../src/utils/forecastTypes';

// Regra AL (Comex, 2026-10-22): a projecao do 5o mes soma a chegada desse mes; a planilha nao soma.
// Dados 100% sinteticos / fixture anonimizada (repo publico).
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
  historico: [100, 100, 100, 100, 100],
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

const sintetica: Quinzena = {
  id: '10-2',
  arquivo: 'sintetica',
  dataBase: BASE,
  mesesConsumo: ['05', '06', '07', '08', '09', '10', '11'],
  mesesChegada: ['10', '11', '12', '01', '02'],
  mesesProgramacao: ['10', '11', '12', '01'],
  produtos: [produto],
  entradas: {
    estoque: [{ codigo: 'C0001', qtd: 420 }],
    vendasMes: [{ codigo: 'C0001', qtd: 100 }],
    vendasAtual: [{ codigo: 'C0001', qtd: 50 }],
    vendasAnual: [],
    programacoes: [],
    chegadas: [{ codigo: 'C0001', qtd: 90, mes: '02' }],
    leadtime: [{ fonte: 'FONTE 001', total: 150 }],
    margem: [],
    clientesAtivos: [],
  },
  esperado: {},
};

function relatorio(q: Quinzena, somarChegada5oMes: boolean) {
  const calculadas = calcular(q, { hoje: HOJE, quinzena: 2, somarChegada5oMes });
  const porLinha = new Map(q.produtos.map((p) => [p.linha, p]));
  const linhas: LinhaParaRelatorio[] = calculadas.map((c) => {
    const p = porLinha.get(c.linha)!;
    return {
      ...c,
      n: p.n,
      item: p.item,
      codigos: p.codigos.filter((x) => x !== ''),
      fonte: p.fonte,
      status: p.status,
      naoFraciona: p.naoFraciona.trim().toUpperCase() === 'X',
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

describe('regra AL: projecao do 5o mes soma a chegada desse mes', () => {
  it('motor: so AL e AM mudam; AN e a demanda ficam iguais', () => {
    const [planilha] = calcular(sintetica, { hoje: HOJE, somarChegada5oMes: false });
    const [corrigida] = calcular(sintetica, { hoje: HOJE });
    expect(planilha.projecao).toEqual([320, 220, 120, 20, -80, -180]);
    expect(corrigida.projecao).toEqual([320, 220, 120, 20, 10, -90]);
    expect(planilha.Q).toBe(100);
    expect(corrigida.Q).toBe(100);
    expect(planilha.AG).toBe(100);
    expect(corrigida.AG).toBe(100);
    expect(planilha.AN).toBe(-90);
    expect(corrigida.AN).toBe(-90);
  });

  it('relatorio: a ruptura e a data-limite andam um mes; demanda e quantidade nao mudam', () => {
    const planilha = relatorio(sintetica, false);
    const corrigida = relatorio(sintetica, true);
    expect(planilha.totais.itens).toBe(1);
    expect(corrigida.totais.itens).toBe(1);
    const a = planilha.grupos[0].itens[0];
    const b = corrigida.grupos[0].itens[0];
    expect(a.ruptura).toEqual({ indiceMes: 4, anoMes: '2027-02', data: '2027-02-06', jaNaDataBase: false });
    expect(a.dataLimite).toBe('2026-09-09');
    expect(b.ruptura).toEqual({ indiceMes: 5, anoMes: '2027-03', data: '2027-03-04', jaNaDataBase: false });
    expect(b.dataLimite).toBe('2026-10-05');
    expect(a.vencida).toBe(true);
    expect(b.vencida).toBe(true);
    expect(b.demanda).toBe(a.demanda);
    expect(b.quantidadeSugerida).toBe(a.quantidadeSugerida);
    expect(b.quantidadeSugerida).toBe(90);
  });

  it('fixture anonimizada: o relatorio com a regra corrigida e identico ao da planilha', () => {
    const planilha = relatorio(fixture, false);
    const corrigida = relatorio(fixture, true);
    expect(corrigida.totais).toEqual(planilha.totais);
    expect(corrigida.grupos).toEqual(planilha.grupos);
    expect(corrigida).toEqual(planilha);
  });

  it('conferencia ignora a regra corrigida: 9.464 de 9.464 na fixture', () => {
    const c = conferenciaDaQuinzena(fixture, HOJE);
    expect(c.celulas).toBe(9464);
    expect(c.batem).toBe(9464);
  });
});
