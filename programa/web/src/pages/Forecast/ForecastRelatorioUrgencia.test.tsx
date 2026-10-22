import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
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

// Dados 100% sinteticos.
function item(over: Record<string, unknown> = {}) {
  return {
    linha: 3,
    n: 1,
    item: 'PRODUTO 001',
    codigos: ['C0001', 'C0002'],
    status: 'nao',
    demanda: -40,
    quantidadeSugerida: 40,
    embalagem: { usada: null, cadastradas: [], multiplas: false },
    quantidadeEmbalagens: null,
    quantidadeFinal: 40,
    naoFraciona: false,
    ruptura: { indiceMes: 1, anoMes: '2026-11', data: '2026-11-21', jaNaDataBase: false },
    dataLimite: '2026-10-22',
    vencida: false,
    leadTimeDias: 30,
    emAndamento: { chegadas: [], programacoes: [] },
    ...over,
  };
}

const POR_URGENCIA = { 'sem-estoque': 1, critico: 1, atrasado: 1, 'no-prazo': 1 };

// 4 itens, um por faixa, em 2 fontes; vencida = true em 3 deles (a urgencia manda na cor, nao a data-limite).
const SEM_ESTOQUE = item({
  linha: 3,
  item: 'PRODUTO 001',
  urgencia: 'sem-estoque',
  diasAteRuptura: -5,
  posicaoUrgencia: 0,
  ruptura: { indiceMes: 0, anoMes: '2026-10', data: '2026-10-15', jaNaDataBase: true },
  dataLimite: '2026-09-15',
  vencida: true,
});
const CRITICO = item({
  linha: 4,
  item: 'PRODUTO 002',
  urgencia: 'critico',
  diasAteRuptura: 3,
  posicaoUrgencia: 1,
  ruptura: { indiceMes: 0, anoMes: '2026-10', data: '2026-10-23', jaNaDataBase: false },
  dataLimite: '2026-09-23',
  vencida: true,
});
const ATRASADO = item({
  linha: 5,
  item: 'PRODUTO 003',
  urgencia: 'atrasado',
  diasAteRuptura: 32,
  posicaoUrgencia: 2,
  dataLimite: '2026-10-10',
  vencida: true,
});
const NO_PRAZO = item({
  linha: 6,
  item: 'PRODUTO 004',
  urgencia: 'no-prazo',
  diasAteRuptura: null,
  posicaoUrgencia: 3,
  ruptura: null,
  dataLimite: null,
});

const SEM_CONSUMO = [
  {
    linha: 20,
    n: 20,
    productId: null,
    item: 'PRODUTO 101',
    codigos: ['C0101'],
    fonte: 'FONTE 001',
    status: 'nao',
    motivos: ['programacao', 'estoque'],
    estoque: 20,
    programado: 300,
    programacoes: [{ anoMes: '2026-11', quantidade: 300 }],
    chegadas: [],
    semLeadTime: false,
  },
  {
    linha: 21,
    n: 21,
    productId: null,
    item: 'PRODUTO 102',
    codigos: ['C0102'],
    fonte: 'FONTE 003',
    status: 'nao',
    motivos: ['estoque'],
    estoque: 10,
    programado: 0,
    programacoes: [],
    chegadas: [{ anoMes: '2026-12', quantidade: 100 }],
    semLeadTime: true,
  },
];

function relatorio(over: Record<string, unknown> = {}) {
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: 4, fontes: 2, vencidas: 3, semEmbalagem: 4, multiplasEmbalagens: 0, porUrgencia: POR_URGENCIA },
    fora: { semLeadTime: 0, semConsumoSemFalta: 3, semConsumoSemMovimento: 46 },
    urgencia: { diasCritico: 15 },
    semConsumo: { itens: SEM_CONSUMO },
    grupos: [
      {
        fonte: 'FONTE 001',
        leadTimeDias: 30,
        dataLimiteMaisUrgente: '2026-09-15',
        vencidas: 2,
        urgenciaMaisAlta: 'sem-estoque',
        porUrgencia: { 'sem-estoque': 1, critico: 0, atrasado: 1, 'no-prazo': 0 },
        itens: [SEM_ESTOQUE, ATRASADO],
      },
      {
        fonte: 'FONTE 002',
        leadTimeDias: 30,
        dataLimiteMaisUrgente: '2026-09-23',
        vencidas: 1,
        urgenciaMaisAlta: 'critico',
        porUrgencia: { 'sem-estoque': 0, critico: 1, atrasado: 0, 'no-prazo': 1 },
        itens: [CRITICO, NO_PRAZO],
      },
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

const nomesNaTabela = (tabela: HTMLElement) =>
  within(tabela)
    .getAllByRole('rowheader')
    .map((h) => h.querySelector('.fcr-item__nome')?.textContent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForecastRelatorioCompras - urgencia (PR 2D)', () => {
  it('visao padrao "Por urgencia": uma secao por faixa na ordem, com a coluna Fonte', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    const visao = within(screen.getByRole('group', { name: 'Organizar relatório' }));
    expect(visao.getByRole('button', { name: 'Por urgência' }).getAttribute('aria-pressed')).toBe('true');
    expect(visao.getByRole('button', { name: 'Por fonte' }).getAttribute('aria-pressed')).toBe('false');

    const tabelas = screen.getAllByRole('table');
    expect(tabelas).toHaveLength(5); // 4 faixas + sem consumo
    const legendas = tabelas.map((t) => t.querySelector('caption')?.textContent);
    expect(legendas).toEqual([
      'Sem estoque agora · 1 item',
      'Ruptura em até 15 dias · 1 item',
      'Atrasado · 1 item',
      'No prazo · 1 item',
      'Atenção: sem consumo · 2 itens',
    ]);
    const primeira = tabelas[0] as HTMLElement;
    expect(within(primeira).getAllByRole('columnheader').map((h) => h.textContent).slice(0, 3)).toEqual([
      'Item',
      'Urgência',
      'Fonte',
    ]);
    expect(within(primeira).getByText('FONTE 001 · 30 dias')).toBeTruthy();
    expect(within(tabelas[1] as HTMLElement).getByText('FONTE 002 · 30 dias')).toBeTruthy();
    expect(nomesNaTabela(tabelas[2] as HTMLElement)).toEqual(['PRODUTO 003']);
  });

  it('cor so nas 2 faixas criticas, sem a classe vencida; selo de texto por linha e dias ate a ruptura', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    expect(document.querySelectorAll('.fcr-linha--sem-estoque')).toHaveLength(1);
    expect(document.querySelectorAll('.fcr-linha--critico')).toHaveLength(1);
    expect(document.querySelectorAll('.fcr-linha--atrasado')).toHaveLength(1);
    expect(document.querySelectorAll('.fcr-linha--no-prazo')).toHaveLength(1);
    expect(document.querySelectorAll('.fcr-linha--vencida')).toHaveLength(0);

    const selos = [...document.querySelectorAll('.fcr-urgencia')].map((el) => [
      el.querySelector('.badge')?.textContent,
      el.querySelector('.badge')?.className,
      el.querySelector('.fcr-urgencia__dias')?.textContent,
    ]);
    expect(selos).toEqual([
      ['Sem estoque agora', 'badge badge--danger', 'ruptura há 5 dias'],
      ['Ruptura em até 15 dias', 'badge badge--danger', 'ruptura em 3 dias'],
      ['Atrasado', 'badge badge--muted', 'ruptura em 32 dias'],
      ['No prazo', 'badge badge--muted', '—'],
    ]);
    // o selo "Vencida" continua so na celula da data-limite
    expect(document.querySelectorAll('.fcr-urgencia .badge--warning, .fcr-urgencia .badge--info')).toHaveLength(0);
    expect(screen.getAllByText('Vencida').every((el) => !el.closest('.fcr-urgencia'))).toBe(true);
  });

  it('resumo de urgencia, regra e resumo de sem consumo com os textos exatos', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    expect(
      screen.getByText('Urgência: 1 sem estoque agora · 1 com ruptura em até 15 dias · 1 atrasado · 1 no prazo'),
    ).toBeTruthy();
    expect(screen.getByText('3 com data-limite vencida')).toBeTruthy();
    expect(
      screen.getByText(
        'Sem consumo: 2 em atenção (com estoque ou programação, fora da lista de compra) · 46 sem estoque nem programação',
      ),
    ).toBeTruthy();
    const regra = within(document.querySelector('.fcr-regra') as HTMLElement);
    expect(regra.getByText(/^Urgência: "Sem estoque agora" = a ruptura cai na data-base/)).toBeTruthy();
    expect(regra.getByText(/^Atenção: sem consumo = média trimestral zero/)).toBeTruthy();
  });

  it('filtrar por faixa: 1 linha, linha "Mostrando", e a secao sem consumo continua', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    expect(screen.getByText('Mostrando 4 de 4 itens · todas as faixas · por urgência')).toBeTruthy();
    const filtros = within(screen.getByRole('group', { name: 'Filtrar por urgência' }));
    expect(filtros.getByRole('button', { name: 'Todas 4' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(filtros.getByRole('button', { name: 'Atrasado 1' }));
    expect(filtros.getByRole('button', { name: 'Atrasado 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Mostrando 1 de 4 itens · Atrasado · por urgência')).toBeTruthy();
    const tabelas = screen.getAllByRole('table');
    expect(tabelas).toHaveLength(2);
    expect(nomesNaTabela(tabelas[0] as HTMLElement)).toEqual(['PRODUTO 003']);
    expect(screen.getByRole('region', { name: 'Itens sem consumo' })).toBeTruthy();
  });

  it('faixa sem itens continua clicavel e mostra o aviso', async () => {
    const r = relatorio({
      totais: { itens: 3, fontes: 2, vencidas: 3, semEmbalagem: 3, multiplasEmbalagens: 0, porUrgencia: { ...POR_URGENCIA, 'no-prazo': 0 } },
      grupos: [
        { ...relatorio().grupos[0] },
        { ...relatorio().grupos[1], itens: [CRITICO] },
      ],
    });
    get.mockResolvedValue({ data: r });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    fireEvent.click(screen.getByRole('button', { name: 'No prazo 0' }));
    expect(screen.getByText('Nenhum item nesta faixa.')).toBeTruthy();
    expect(screen.getByText('Mostrando 0 de 3 itens · No prazo · por urgência')).toBeTruthy();
  });

  it('"Por fonte": tabelas por fonte, coluna Urgencia e no maximo 1 selo de contagem critica na legenda', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    fireEvent.click(screen.getByRole('button', { name: 'Por fonte' }));
    const tabelas = screen.getAllByRole('table');
    expect(tabelas).toHaveLength(3); // 2 fontes + sem consumo
    const [a, b] = [tabelas[0], tabelas[1]] as HTMLElement[];
    expect(within(a).getAllByRole('columnheader').map((h) => h.textContent).slice(0, 2)).toEqual(['Item', 'Urgência']);
    expect(within(a).queryByRole('columnheader', { name: 'Fonte' })).toBeNull();
    const criticos = (t: HTMLElement) =>
      [...(t.querySelector('caption') as HTMLElement).querySelectorAll('.badge--danger')]
        .map((e) => e.textContent)
        .filter((x) => /sem estoque agora|com ruptura em até/.test(x ?? ''));
    expect(criticos(a)).toEqual(['1 sem estoque agora']);
    expect(criticos(b)).toEqual(['1 com ruptura em até 15 dias']);
    expect(within(a).getByText('2 vencidas')).toBeTruthy();
    expect(screen.getByText('Mostrando 4 de 4 itens · todas as faixas · por fonte')).toBeTruthy();

    // filtro na visao por fonte: o grupo que fica vazio some e as contagens do grupo acompanham
    fireEvent.click(screen.getByRole('button', { name: 'Atrasado 1' }));
    const filtradas = screen.getAllByRole('table');
    expect(filtradas).toHaveLength(2);
    expect(nomesNaTabela(filtradas[0] as HTMLElement)).toEqual(['PRODUTO 003']);
    expect(criticos(filtradas[0] as HTMLElement)).toEqual([]);
  });

  it('diasCritico 0: a faixa "Ruptura em ate N dias" some dos filtros e do resumo', async () => {
    get.mockResolvedValue({
      data: relatorio({
        urgencia: { diasCritico: 0 },
        totais: { itens: 4, fontes: 2, vencidas: 3, semEmbalagem: 4, multiplasEmbalagens: 0, porUrgencia: { ...POR_URGENCIA, critico: 0 } },
      }),
    });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    expect(screen.queryByRole('button', { name: /Ruptura em até 0 dias/ })).toBeNull();
    expect(screen.getByText('Urgência: 1 sem estoque agora · 1 atrasado · 1 no prazo')).toBeTruthy();
  });

  it('secao "Atencao: sem consumo": motivos, estoque, programacoes e chegadas, sem botao nem cor', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    const secao = screen.getByRole('region', { name: 'Itens sem consumo' });
    const tabela = within(secao).getByRole('table');
    expect(within(tabela).getByText('Atenção: sem consumo · 2 itens')).toBeTruthy();
    expect(within(tabela).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Item',
      'Fonte',
      'Status',
      'Motivo',
      'Estoque',
      'Programações',
      'Chegadas',
    ]);
    expect(within(tabela).getByText('tem programação · tem estoque')).toBeTruthy();
    expect(within(tabela).getByText('tem estoque')).toBeTruthy();
    expect(within(tabela).getByText('Programação nov/2026: 300')).toBeTruthy();
    expect(within(tabela).getByText('Chegada dez/2026: 100')).toBeTruthy();
    expect(within(tabela).getByText('FONTE 003 (sem lead time)')).toBeTruthy();
    expect(within(tabela).queryAllByRole('button')).toHaveLength(0);
    expect(tabela.querySelector('.badge')).toBeNull();
    expect(
      screen.getByText('Não entram na lista de compra: sem consumo nos últimos 3 meses, mas com estoque ou programação.'),
    ).toBeTruthy();
    expect(tabela.className).toContain('fcr-tabela--compacta');
  });

  it('sem itens em sem consumo: a secao nao aparece (o resumo continua)', async () => {
    get.mockResolvedValue({ data: relatorio({ semConsumo: { itens: [] } }) });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    expect(screen.queryByRole('region', { name: 'Itens sem consumo' })).toBeNull();
    expect(screen.queryByText(/^Atenção: sem consumo ·/)).toBeNull();
    expect(screen.getByText(/^Sem consumo: 0 em atenção/)).toBeTruthy();
  });

  it('payload sem os campos novos (backend antigo): sem controles, sem secao, tela de sempre', async () => {
    const legado = item({ linha: 9, item: 'PRODUTO 009', vencida: true });
    get.mockResolvedValue({
      data: {
        quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
        totais: { itens: 1, fontes: 1, vencidas: 1, semEmbalagem: 1, multiplasEmbalagens: 0 },
        fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
        grupos: [{ fonte: 'FONTE 001', leadTimeDias: 30, dataLimiteMaisUrgente: '2026-10-22', vencidas: 1, itens: [legado] }],
      },
    });
    renderRelatorio();
    await screen.findByText('1 item em 1 fonte');
    expect(screen.queryByRole('group', { name: 'Organizar relatório' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filtrar por urgência' })).toBeNull();
    expect(screen.queryByText(/^Mostrando/)).toBeNull();
    expect(screen.queryByText(/^Urgência:/)).toBeNull();
    expect(screen.queryByText(/^Sem consumo:/)).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Urgência' })).toBeNull();
    expect(document.querySelectorAll('.fcr-linha--vencida')).toHaveLength(1);
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });
});
