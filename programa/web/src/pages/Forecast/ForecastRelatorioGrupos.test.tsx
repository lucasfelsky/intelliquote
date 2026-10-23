import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ForecastDadosDoGrupo, ForecastItemCobertoPorGrupo } from '@/services/forecast';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';
import ForecastRelatorioGrupos, { SublinhasDoGrupo } from './ForecastRelatorioGrupos';
import {
  APOIO_COBERTOS_POR_GRUPO,
  paragrafoGruposDeEquivalencia,
  textoMotivoCobertoPorGrupo,
} from './forecastRelatorioTextos';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message?: string) {
      super(message ?? `HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));

import { api } from '@/api/client';

const get = vi.mocked(api.get);

// Dados 100% sinteticos. Caso B (variante): PRODUTO 001 (principal, lead 60, Q 100, U 0), PRODUTO 002 (U 100, Q 50) e
// PRODUTO 003 (sem lead time, U 200): grupo precisa de 150 kg.
const GRUPO: ForecastDadosDoGrupo = {
  id: 10,
  nome: 'GRUPO SINTETICO',
  principalProductId: 1,
  principalItem: 'PRODUTO 001',
  membros: [
    {
      linha: 1,
      productId: 1,
      item: 'PRODUTO 001',
      codigos: ['C0001'],
      fonte: 'FONTE 001',
      principal: true,
      estoque: 0,
      chegadas: 0,
      programado: 0,
      mediaTrimestral: 100,
      demandaIndividual: -300,
      semLeadTime: false,
      obs: '',
    },
    {
      linha: 2,
      productId: 2,
      item: 'PRODUTO 002',
      codigos: ['C0002'],
      fonte: 'FONTE 002',
      principal: false,
      estoque: 100,
      chegadas: 50,
      programado: 20,
      mediaTrimestral: 50,
      demandaIndividual: -70,
      semLeadTime: false,
      obs: '',
    },
    {
      linha: 3,
      productId: 3,
      item: 'PRODUTO 003',
      codigos: ['C0003'],
      fonte: '',
      principal: false,
      estoque: 200,
      chegadas: 0,
      programado: 0,
      mediaTrimestral: 0,
      demandaIndividual: null,
      semLeadTime: true,
      obs: '',
    },
  ],
  estoque: 300,
  chegadas: 50,
  programado: 20,
  mediaTrimestral: 150,
  seguranca: 300,
  demanda: -150,
  cobertura: 2,
};

function itemDoGrupo(over: Record<string, unknown> = {}) {
  return {
    linha: 1,
    n: 1,
    productId: 1,
    item: 'GRUPO SINTETICO',
    codigos: ['C0001'],
    status: 'nao',
    demanda: -150,
    quantidadeSugerida: 150,
    embalagem: { usada: null, cadastradas: [], multiplas: false },
    quantidadeEmbalagens: null,
    quantidadeFinal: 150,
    naoFraciona: false,
    ruptura: { indiceMes: 2, anoMes: '2026-12', data: '2026-12-01', jaNaDataBase: false },
    dataLimite: '2026-10-02',
    vencida: true,
    leadTimeDias: 60,
    emAndamento: { chegadas: [], programacoes: [] },
    grupo: GRUPO,
    ...over,
  };
}

const COBERTO: ForecastItemCobertoPorGrupo = {
  linha: 9,
  n: 9,
  productId: 9,
  item: 'PRODUTO 009',
  codigos: ['C0009'],
  fonte: 'FONTE 009',
  status: 'nao',
  demanda: -300,
  quantidadeSugerida: 300,
  grupoId: 11,
  grupoNome: 'OUTRO GRUPO SINTETICO',
  principalItem: 'PRODUTO 009',
  estoqueDoGrupo: 1200,
  cobertura: 8,
  obs: 'OBS SINTETICA',
  mesesForaDaMedia: [],
};

function relatorio(over: Record<string, unknown> = {}) {
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: 1, fontes: 1, vencidas: 1, semEmbalagem: 1, multiplasEmbalagens: 0 },
    fora: { semLeadTime: 0, semConsumoSemFalta: 0, cobertosPorGrupo: 1 },
    grupos: [
      {
        fonte: 'FONTE 001',
        leadTimeDias: 60,
        dataLimiteMaisUrgente: '2026-10-02',
        vencidas: 1,
        itens: [itemDoGrupo()],
      },
    ],
    cobertosPorGrupo: { itens: [COBERTO] },
    gruposDeEquivalencia: [
      { ...GRUPO, situacao: 'na-lista' },
      { ...GRUPO, id: 11, nome: 'OUTRO GRUPO SINTETICO', situacao: 'coberto' },
    ],
    ...over,
  };
}

function renderRelatorio() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastRelatorioCompras snapshotId={7} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SublinhasDoGrupo', () => {
  it('um membro por linha com os componentes da soma; principal em destaque; sem lead time explicado', () => {
    render(<SublinhasDoGrupo grupo={GRUPO} />);
    expect(screen.getByText('Estoque somado 300 kg · cobertura 2,0 meses · segurança somada 300 kg')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Membros do grupo GRUPO SINTETICO' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Item',
      'Fonte',
      'Estoque',
      'Chegadas',
      'Programação',
      'Média tri.',
      'Demanda individual',
    ]);
    const linhas = screen.getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(3);
    expect(within(linhas[0] as HTMLElement).getByText('Principal')).toBeTruthy();
    expect(within(linhas[0] as HTMLElement).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      'FONTE 001',
      '0',
      '0',
      '0',
      '100,0',
      '-300,0',
    ]);
    expect(within(linhas[1] as HTMLElement).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      'FONTE 002',
      '100',
      '50',
      '20',
      '50,0',
      '-70,0',
    ]);
    // Membro sem fonte e sem lead time: o estoque dele entra na soma e a celula explica a demanda nula.
    expect(within(linhas[2] as HTMLElement).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      'Sem fonte',
      '200',
      '0',
      '0',
      '0,0',
      'sem lead time',
    ]);
  });
});

describe('ForecastRelatorioCompras - grupos de equivalencia', () => {
  it('linha do grupo na lista: nome do grupo, selo, principal, e a linha dos membros ocupa todas as colunas', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    const principal = await screen.findByText('Compra pelo produto principal: PRODUTO 001');
    const linha = principal.closest('tr') as HTMLElement;
    expect(within(linha).getByText('GRUPO SINTETICO')).toBeTruthy();
    expect(within(linha).getByText('Grupo de equivalência')).toBeTruthy();
    expect(within(linha).getAllByText('150,0').length).toBeGreaterThan(0);
    // Sublinhas na linha seguinte (modo legado: Item + 9 colunas comuns = 10).
    const sublinha = linha.nextElementSibling as HTMLElement;
    expect(sublinha.className).toBe('fcr-linha-grupo');
    expect(sublinha.querySelector('td')?.getAttribute('colspan')).toBe('10');
    expect(within(sublinha).getByRole('table', { name: 'Membros do grupo GRUPO SINTETICO' })).toBeTruthy();
    expect(within(sublinha).getByText('PRODUTO 002')).toBeTruthy();
  });

  it('secao "Cobertos pelo grupo": titulo, motivo (igual ao do XLSX), observacao e nota de conferencia', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('1 item em 1 fonte');
    const secao = screen.getByRole('region', { name: 'Itens cobertos por grupo de equivalência' });
    expect(screen.getByText('Cobertos pelo grupo de equivalência · 1 item')).toBeTruthy();
    expect(within(secao).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Item',
      'Fonte',
      'Status',
      'Demanda individual',
      'Motivo',
    ]);
    const linha = within(secao).getAllByRole('row')[1] as HTMLElement;
    expect(within(linha).getByRole('rowheader').textContent).toContain('PRODUTO 009');
    expect(within(linha).getByText('Obs.: OBS SINTETICA')).toBeTruthy();
    expect(within(linha).getByText('Coberto pelo grupo OUTRO GRUPO SINTETICO: estoque somado 1.200 kg, cobertura 8,0 meses')).toBeTruthy();
    expect(textoMotivoCobertoPorGrupo(COBERTO)).toBe(
      'Coberto pelo grupo OUTRO GRUPO SINTETICO: estoque somado 1.200 kg, cobertura 8,0 meses',
    );
    expect(screen.getByText(APOIO_COBERTOS_POR_GRUPO)).toBeTruthy();
  });

  it('resumo conta os cobertos e o paragrafo das regras aparece so com grupo formado', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    expect(await screen.findByText('1 item coberto por grupo de equivalência')).toBeTruthy();
    expect(screen.getByText(paragrafoGruposDeEquivalencia())).toBeTruthy();
  });

  it('backend antigo (sem os campos de grupo) ou sem grupos: nada de grupo aparece e as tabelas sao as de antes', async () => {
    const semGrupos = relatorio({ cobertosPorGrupo: undefined, gruposDeEquivalencia: undefined });
    (semGrupos.grupos[0] as { itens: unknown[] }).itens = [itemDoGrupo({ item: 'PRODUTO 001', grupo: undefined })];
    get.mockResolvedValue({ data: semGrupos });
    renderRelatorio();
    await screen.findByText('1 item em 1 fonte');
    expect(screen.queryByText('Grupo de equivalência')).toBeNull();
    expect(screen.queryByText(/por grupo de equivalência/)).toBeNull();
    expect(screen.queryByText(paragrafoGruposDeEquivalencia())).toBeNull();
    expect(screen.queryByRole('region', { name: 'Itens cobertos por grupo de equivalência' })).toBeNull();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('grupo vazio de cobertos (lista vazia): a secao nao aparece mas o paragrafo continua (grupo formado)', async () => {
    get.mockResolvedValue({ data: relatorio({ cobertosPorGrupo: { itens: [] } }) });
    renderRelatorio();
    await screen.findByText('1 item em 1 fonte');
    expect(screen.queryByText(/Cobertos pelo grupo de equivalência/)).toBeNull();
    expect(screen.queryByText(/item coberto por grupo/)).toBeNull();
    expect(screen.getByText(paragrafoGruposDeEquivalencia())).toBeTruthy();
  });
});

describe('ForecastRelatorioGrupos - secao isolada', () => {
  it('varios cobertos: plural no titulo e uma linha por membro', () => {
    render(<ForecastRelatorioGrupos itens={[COBERTO, { ...COBERTO, linha: 10, productId: 10, item: 'PRODUTO 010' }]} />);
    expect(screen.getByText('Cobertos pelo grupo de equivalência · 2 itens')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('cobertura nula (grupo sem consumo): o motivo diz "sem consumo no grupo"', () => {
    render(<ForecastRelatorioGrupos itens={[{ ...COBERTO, cobertura: null }]} />);
    expect(screen.getByText('Coberto pelo grupo OUTRO GRUPO SINTETICO: estoque somado 1.200 kg, sem consumo no grupo')).toBeTruthy();
  });
});
