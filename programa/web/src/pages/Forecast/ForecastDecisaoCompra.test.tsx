import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ForecastItemRelatorio } from '@/services/forecast';
import type { ForecastDecisao } from '@/services/forecastDecisoes';
import { ForecastDecisaoLeitura, ProvedorDecisoesCompra } from './ForecastDecisaoCompra';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';
import { ProvedorGerarCotacao } from './ForecastGerarCotacao';

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

import { api, ApiError } from '@/api/client';
import { abrirCotar, expandirDetalhes } from '@/test/forecastDetalhes';

const get = vi.mocked(api.get);

// Dados 100% sinteticos.
function item(over: Record<string, unknown> = {}): ForecastItemRelatorio {
  return {
    linha: 3,
    n: 1,
    productId: 42,
    item: 'PRODUTO 001',
    codigos: ['C0001'],
    status: 'cotando',
    demanda: -40,
    quantidadeSugerida: 101,
    embalagem: { usada: null, cadastradas: [], multiplas: false },
    quantidadeEmbalagens: null,
    quantidadeFinal: 125.12345,
    naoFraciona: false,
    ruptura: { indiceMes: 1, anoMes: '2026-11', data: '2026-11-21', jaNaDataBase: false },
    dataLimite: '2026-10-22',
    vencida: false,
    leadTimeDias: 30,
    emAndamento: { chegadas: [], programacoes: [] },
    ...over,
  } as unknown as ForecastItemRelatorio;
}

function decisao(over: Partial<ForecastDecisao> = {}): ForecastDecisao {
  return {
    productId: 42,
    quantidadeKg: 1234.5,
    status: 'confirmado',
    observacao: null,
    sugeridaKg: 125,
    demandaKg: -40,
    decididaPorId: 3,
    criadaEm: '2026-10-26T17:30:00.000Z',
    atualizadaEm: '2026-10-26T17:30:00.000Z',
    ...over,
  };
}

const resposta = (decisoes: ForecastDecisao[]) => ({ data: { snapshotId: 7, label: '10-2', decisoes } });

function renderCelula(it: ForecastItemRelatorio, opts: { decisoes?: ForecastDecisao[] } = {}) {
  get.mockResolvedValue(resposta(opts.decisoes ?? []));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProvedorDecisoesCompra snapshotId={7}>
        <ForecastDecisaoLeitura item={it} />
      </ProvedorDecisoesCompra>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForecastDecisaoLeitura (resumo da decisao)', () => {
  it('fora do provedor nao renderiza nada', () => {
    const { container } = render(<ForecastDecisaoLeitura item={item()} />);
    expect(container.innerHTML).toBe('');
  });

  it('sem campos nem botoes; "Sem decisao" quando nao ha', async () => {
    renderCelula(item());
    expect(await screen.findByText('Sem decisão')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('leitura com decisao: quantidade, status, observacao e quando foi salva (horario de Brasilia)', async () => {
    renderCelula(item(), { decisoes: [decisao({ observacao: 'OBS SINTETICA' })] });
    expect(await screen.findByText('1.234,5 kg')).toBeTruthy();
    expect(screen.getByText('Confirmado, aguarda PO')).toBeTruthy();
    expect(screen.getByText('Obs.: OBS SINTETICA')).toBeTruthy();
    expect(screen.getByText('salva em 26/10 14:30')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('item sem productId: "Sem cadastro" e nenhum campo', async () => {
    renderCelula(item({ productId: null }));
    const texto = await screen.findByText('Sem cadastro');
    expect(texto.getAttribute('title')).toMatch(/fora do cadastro/);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// ---------- dentro do relatorio ----------

function relatorio() {
  const fonte = (nome: string, itens: unknown[]) => ({
    fonte: nome,
    leadTimeDias: 30,
    dataLimiteMaisUrgente: null,
    vencidas: 0,
    itens,
  });
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: 2, fontes: 2, vencidas: 0, semEmbalagem: 2, multiplasEmbalagens: 0 },
    fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
    grupos: [
      fonte('FONTE 001', [item({ linha: 5, item: 'PRODUTO 001', productId: 42 })]),
      fonte('FONTE 002', [item({ linha: 6, item: 'PRODUTO 002', productId: 43 })]),
    ],
  };
}

function renderRelatorio(podeEditar: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProvedorGerarCotacao snapshotId={7} podeCriar={podeEditar}>
        <ForecastRelatorioCompras snapshotId={7} podeEditar={podeEditar} />
      </ProvedorGerarCotacao>
    </QueryClientProvider>,
  );
}

const chamadasDeDecisoes = () => get.mock.calls.filter(([url]) => String(url).endsWith('/decisoes'));

describe('ForecastRelatorioCompras com o pop-up Criar cotacao e o resumo da decisao', () => {
  it('1 GET de decisoes por quinzena; a acao Cotar abre o pop-up Criar cotacao e as tabelas so mostram o resumo', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).endsWith('/decisoes')
        ? resposta([decisao({ productId: 43, quantidadeKg: 77 })])
        : { data: relatorio() },
    );
    renderRelatorio(true);
    await screen.findAllByRole('button', { name: /^Ver detalhes de / });
    expandirDetalhes();
    const tabelas = screen.getAllByRole('table');
    expect(tabelas).toHaveLength(2);
    // nas tabelas so o resumo (leitura) e a acao "Cotar"; o editor nao fica na linha nem no expansor
    expect(await screen.findByText('77 kg')).toBeTruthy();
    for (const t of tabelas) {
      expect(within(t).queryAllByRole('columnheader').map((c) => c.textContent)).not.toContain('Qtd. decidida (kg)');
      expect(t.querySelectorAll('.fdec-editor')).toHaveLength(0);
    }
    expect(screen.queryByLabelText(/Qtd\. decidida \(kg\) de/)).toBeNull();
    // no pop-up a quantidade a cotar nasce da decisao salva (77) ou, sem decisao, da Qtd. final calculada (125,12 -> 126 kg)
    const dialogo2 = await abrirCotar('PRODUTO 002');
    expect((within(dialogo2).getByLabelText('Quantidade a cotar de PRODUTO 002') as HTMLInputElement).value).toBe('77');
    expect(chamadasDeDecisoes()).toHaveLength(1);
    expect(chamadasDeDecisoes()[0]![0]).toBe('/v1/forecast/snapshots/7/decisoes');
    fireEvent.click(within(dialogo2).getByRole('button', { name: /^Fechar/ }));
    await waitFor(() => expect(screen.queryByLabelText('Quantidade a cotar de PRODUTO 002')).toBeNull());
    const dialogo1 = await abrirCotar('PRODUTO 001');
    expect((within(dialogo1).getByLabelText('Quantidade a cotar de PRODUTO 001') as HTMLInputElement).value).toBe('126');
  });

  it('pop-up Criar cotacao: abre com o item da linha, fecha pelo botao e devolve o foco a acao', async () => {
    get.mockImplementation(async (url: string) => (String(url).endsWith('/decisoes') ? resposta([]) : { data: relatorio() }));
    renderRelatorio(true);
    const acao = await screen.findByRole('button', { name: 'Cotar PRODUTO 001' });
    const dialogo = await abrirCotar('PRODUTO 001');
    expect(within(dialogo).getByLabelText('Quantidade a cotar de PRODUTO 001')).toBeTruthy();
    expect(within(dialogo).queryByRole('combobox')).toBeNull();
    fireEvent.click(within(dialogo).getByRole('button', { name: /^Fechar/ }));
    await waitFor(() => expect(document.activeElement).toBe(acao));
    expect(screen.queryByRole('heading', { name: 'Criar cotação' })).toBeNull();
  });

  it('quem so le nao ve a acao Cotar', async () => {
    get.mockImplementation(async (url: string) => (String(url).endsWith('/decisoes') ? resposta([]) : { data: relatorio() }));
    renderRelatorio(false);
    await screen.findAllByRole('button', { name: /^Ver detalhes de / });
    expect(screen.queryByRole('button', { name: /^Cotar / })).toBeNull();
  });

  it('sem permissao de edicao a coluna so le (sem campos)', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).endsWith('/decisoes') ? resposta([decisao({ productId: 43, quantidadeKg: 77 })]) : { data: relatorio() },
    );
    renderRelatorio(false);
    expect(await screen.findByText('77 kg')).toBeTruthy();
    expect(screen.queryByLabelText(/Qtd\. decidida \(kg\) de/)).toBeNull();
  });

  it('erro ao carregar as decisoes: 1 alerta com "Tentar de novo" e o relatorio segue utilizavel', async () => {
    get.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/decisoes')) throw new ApiError(500, null);
      return { data: relatorio() };
    });
    renderRelatorio(true);
    const alerta = await screen.findByRole('alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alerta.textContent).toMatch(/Não foi possível carregar as quantidades decididas/);
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.queryByLabelText(/Qtd\. decidida \(kg\) de/)).toBeNull();

    get.mockImplementation(async (url: string) =>
      String(url).endsWith('/decisoes') ? resposta([]) : { data: relatorio() },
    );
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    const dialogo = await abrirCotar('PRODUTO 001');
    expect(within(dialogo).getByLabelText('Quantidade a cotar de PRODUTO 001')).toBeTruthy();
  });
});
