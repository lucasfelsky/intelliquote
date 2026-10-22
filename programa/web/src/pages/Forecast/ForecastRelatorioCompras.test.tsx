import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

import { api, ApiError } from '@/api/client';

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

function relatorio(over: Record<string, unknown> = {}) {
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: 3, fontes: 2, vencidas: 1, semEmbalagem: 2, multiplasEmbalagens: 1 },
    fora: { semLeadTime: 4, semConsumoSemFalta: 5 },
    grupos: [
      {
        fonte: 'FONTE 001',
        leadTimeDias: 90,
        dataLimiteMaisUrgente: '2026-08-23',
        vencidas: 1,
        itens: [
          item({
            linha: 5,
            item: 'PRODUTO 002',
            dataLimite: '2026-08-23',
            vencida: true,
            leadTimeDias: 90,
            quantidadeSugerida: 101,
            quantidadeFinal: 125,
            quantidadeEmbalagens: 5,
            embalagem: {
              usada: { codigo: 'C0005', quantidade: 25, rotulo: null },
              cadastradas: [
                { codigo: 'C0004', quantidade: 200, rotulo: null },
                { codigo: 'C0005', quantidade: 25, rotulo: null },
              ],
              multiplas: true,
            },
            emAndamento: {
              chegadas: [{ anoMes: '2026-11', quantidade: 300 }],
              programacoes: [{ anoMes: '2027-01', quantidade: 20 }],
            },
          }),
          item({ linha: 6, item: 'PRODUTO 003', naoFraciona: true, dataLimite: '2026-10-22' }),
        ],
      },
      {
        fonte: 'FONTE 002',
        leadTimeDias: 10,
        dataLimiteMaisUrgente: null,
        vencidas: 0,
        itens: [item({ linha: 7, item: 'PRODUTO 004', ruptura: null, dataLimite: null, leadTimeDias: 10 })],
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForecastRelatorioCompras', () => {
  it('pede o relatorio da quinzena e mostra o resumo com os totais', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    expect(await screen.findByText('3 itens em 2 fontes')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/7/relatorio-compras');
    expect(screen.getByText('1 com data-limite vencida')).toBeTruthy();
    expect(screen.getByText('2 sem embalagem cadastrada')).toBeTruthy();
    expect(screen.getByText('1 com mais de uma embalagem')).toBeTruthy();
    expect(screen.getByText('Fora do relatório: 4 sem lead time, 5 sem consumo e sem falta')).toBeTruthy();
    expect(screen.getByText('Como as datas são calculadas')).toBeTruthy();
  });

  it('um bloco por fonte, na ordem recebida, com lead time e data mais urgente na legenda', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const tabelas = screen.getAllByRole('table');
    expect(tabelas).toHaveLength(2);
    expect(within(tabelas[0] as HTMLElement).getByText('FONTE 001 · lead time 90 dias · mais urgente 23/08/2026')).toBeTruthy();
    expect(within(tabelas[1] as HTMLElement).getByText('FONTE 002 · lead time 10 dias · sem data-limite')).toBeTruthy();
    const nomes = within(tabelas[0] as HTMLElement)
      .getAllByRole('rowheader')
      .map((h) => h.querySelector('.fcr-item__nome')?.textContent);
    expect(nomes).toEqual(['PRODUTO 002', 'PRODUTO 003']);
    expect(document.querySelector('.fc-grid')).toBeNull();
  });

  it('item vencido ganha a classe e o texto "Vencida" (nao so cor)', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const vencidas = document.querySelectorAll('.fcr-linha--vencida');
    expect(vencidas).toHaveLength(1);
    expect(within(vencidas[0] as HTMLElement).getByText('Vencida')).toBeTruthy();
    expect(within(vencidas[0] as HTMLElement).getByText('23/08/2026')).toBeTruthy();
    expect(screen.getByText('1 vencida')).toBeTruthy();
  });

  it('sem embalagem: chip "Embalagem nao cadastrada" e a quantidade final e a sugerida', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const linha = screen.getByText('PRODUTO 003').closest('tr') as HTMLElement;
    expect(within(linha).getByText('Embalagem não cadastrada')).toBeTruthy();
    expect(within(linha).getAllByText('40,0')).toHaveLength(2); // sugerida e final iguais (sem arredondar)
    expect(within(linha).getByText('-40,0')).toBeTruthy(); // demanda
  });

  it('varias embalagens: destaca a usada e lista as outras', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const linha = screen.getByText('PRODUTO 002').closest('tr') as HTMLElement;
    expect(within(linha).getByText('5 × 25 kg (código C0005)')).toBeTruthy();
    const chip = within(linha).getByText('Arredondado pela embalagem do código C0005');
    expect(chip.getAttribute('title')).toBe('Outras embalagens: C0004 (200 kg)');
    expect(within(linha).getByText('Outras: C0004 (200 kg)')).toBeTruthy();
    expect(within(linha).getByText('125,0')).toBeTruthy();
    expect(within(linha).queryByText('Embalagem não cadastrada')).toBeNull();
  });

  it('"nao fraciona" aparece como marca no item e nao muda a quantidade', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const linha = screen.getByText('PRODUTO 003').closest('tr') as HTMLElement;
    expect(within(linha).getByText('Não fraciona')).toBeTruthy();
    expect(screen.getAllByText('Não fraciona')).toHaveLength(1);
  });

  it('em andamento lista so os meses com valor; sem ruptura mostra aviso', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const comAndamento = screen.getByText('PRODUTO 002').closest('tr') as HTMLElement;
    expect(within(comAndamento).getByText('Chegada nov/2026: 300')).toBeTruthy();
    expect(within(comAndamento).getByText('Programação jan/2027: 20')).toBeTruthy();
    const semRuptura = screen.getByText('PRODUTO 004').closest('tr') as HTMLElement;
    expect(within(semRuptura).getByText('sem ruptura em 6 meses')).toBeTruthy();
    expect(within(comAndamento).getByText('nov/2026')).toBeTruthy(); // saldo zera
    expect(within(comAndamento).getAllByText('21/11/2026')).toHaveLength(1);
  });

  it('ruptura ja na data-base e descrita em texto', async () => {
    get.mockResolvedValue({
      data: relatorio({
        totais: { itens: 1, fontes: 1, vencidas: 0, semEmbalagem: 1, multiplasEmbalagens: 0 },
        grupos: [
          {
            fonte: 'FONTE 001',
            leadTimeDias: 30,
            dataLimiteMaisUrgente: '2026-09-15',
            vencidas: 0,
            itens: [
              item({
                ruptura: { indiceMes: 0, anoMes: '2026-10', data: '2026-10-15', jaNaDataBase: true },
                dataLimite: '2026-11-15',
              }),
            ],
          },
        ],
      }),
    });
    renderRelatorio();
    expect(await screen.findByText('já na data-base')).toBeTruthy();
  });

  it('sem itens: estado vazio', async () => {
    get.mockResolvedValue({
      data: relatorio({
        totais: { itens: 0, fontes: 0, vencidas: 0, semEmbalagem: 0, multiplasEmbalagens: 0 },
        grupos: [],
      }),
    });
    renderRelatorio();
    expect(await screen.findByText('Nenhum item com demanda ≤ 0 nesta quinzena.')).toBeTruthy();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('404 mostra a mensagem do servico; carregando mostra o spinner', async () => {
    get.mockRejectedValue(new ApiError(404, null));
    renderRelatorio();
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    expect(await screen.findByText('Quinzena não encontrada (pode ter sido removida).')).toBeTruthy();
  });
});
