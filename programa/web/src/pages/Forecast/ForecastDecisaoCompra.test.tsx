import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ForecastItemRelatorio } from '@/services/forecast';
import type { ForecastDecisao } from '@/services/forecastDecisoes';
import ForecastDecisaoCompra, { ProvedorDecisoesCompra } from './ForecastDecisaoCompra';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';

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

const get = vi.mocked(api.get);
const put = vi.mocked(api.put);

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

function renderCelula(it: ForecastItemRelatorio, opts: { podeEditar: boolean; decisoes?: ForecastDecisao[] }) {
  get.mockResolvedValue(resposta(opts.decisoes ?? []));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProvedorDecisoesCompra snapshotId={7} podeEditar={opts.podeEditar}>
        <ForecastDecisaoCompra item={it} />
      </ProvedorDecisoesCompra>
    </QueryClientProvider>,
  );
}

const campoKg = () => screen.findByLabelText('Qtd. decidida (kg) de PRODUTO 001') as Promise<HTMLInputElement>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForecastDecisaoCompra (celula)', () => {
  it('fora do provedor nao renderiza nada', () => {
    const { container } = render(<ForecastDecisaoCompra item={item()} />);
    expect(container.innerHTML).toBe('');
  });

  it('leitura (gestor/viewer): sem campos nem botoes; "Sem decisao" quando nao ha', async () => {
    renderCelula(item(), { podeEditar: false });
    expect(await screen.findByText('Sem decisão')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('leitura com decisao: quantidade, status, observacao e quando foi salva (horario de Brasilia)', async () => {
    renderCelula(item(), { podeEditar: false, decisoes: [decisao({ observacao: 'OBS SINTETICA' })] });
    expect(await screen.findByText('1.234,5 kg')).toBeTruthy();
    expect(screen.getByText('Confirmado, aguarda PO')).toBeTruthy();
    expect(screen.getByText('Obs.: OBS SINTETICA')).toBeTruthy();
    expect(screen.getByText('salva em 26/10 14:30')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('item sem productId: "Sem cadastro" e nenhum campo', async () => {
    renderCelula(item({ productId: null }), { podeEditar: true });
    const texto = await screen.findByText('Sem cadastro');
    expect(texto.getAttribute('title')).toMatch(/fora do cadastro/);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('edicao: "Usar sugerida" preenche com a Qtd. final (3 casas), nao com a sugerida', async () => {
    renderCelula(item(), { podeEditar: true });
    const kg = await campoKg();
    expect(kg.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /Usar sugerida/ }));
    expect(kg.value).toBe('125,123');
  });

  it('Salvar fica desabilitado sem mudanca e o status inicial e o congelado do item', async () => {
    renderCelula(item(), { podeEditar: true });
    const kg = await campoKg();
    expect((screen.getByRole('button', { name: /Salvar decisão/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Status da decisão de PRODUTO 001') as HTMLSelectElement).value).toBe('cotando');
    fireEvent.change(kg, { target: { value: '10' } });
    expect((screen.getByRole('button', { name: /Salvar decisão/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('grava por PUT com o corpo exato; mostra "Salvando…" e depois "salva em"', async () => {
    let resolver: (v: unknown) => void = () => {};
    put.mockReturnValue(new Promise((r) => (resolver = r)) as never);
    renderCelula(item(), { podeEditar: true });
    const kg = await campoKg();
    fireEvent.change(kg, { target: { value: '1.600,5' } });
    fireEvent.change(screen.getByLabelText('Status da decisão de PRODUTO 001'), { target: { value: 'po' } });
    fireEvent.change(screen.getByLabelText('Obs. da decisão de PRODUTO 001'), { target: { value: '  OBS SINTETICA ' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar decisão/ }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/decisoes/42', {
        quantidadeKg: 1600.5,
        status: 'po',
        observacao: 'OBS SINTETICA',
      }),
    );
    const botao = await screen.findByRole('button', { name: /Salvar decisão/ });
    expect(botao.textContent).toBe('Salvando…');
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    expect(botao.closest('[aria-busy="true"]')).not.toBeNull();

    resolver({
      data: {
        acao: 'create',
        decisao: decisao({ quantidadeKg: 1600.5, status: 'po', observacao: 'OBS SINTETICA' }),
      },
    });
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe('salva em 26/10 14:30');
    expect(kg.value).toBe('1600,5');
  });

  it('erro: alerta com a mensagem e "Tentar de novo" reenvia o MESMO corpo', async () => {
    put.mockRejectedValueOnce(new ApiError(409, { message: 'Gravada por outra pessoa.' }));
    put.mockResolvedValueOnce({ data: { acao: 'create', decisao: decisao({ quantidadeKg: 10 }) } });
    renderCelula(item(), { podeEditar: true });
    fireEvent.change(await campoKg(), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar decisão/ }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Gravada por outra pessoa.');
    const corpo = put.mock.calls[0]![1];
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    await screen.findByRole('status');
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1]![1]).toEqual(corpo);
  });

  it('campo vazio com decisao existente: "Apagar decisao" envia { quantidadeKg: null }', async () => {
    put.mockResolvedValue({ data: { acao: 'delete', decisao: null } });
    renderCelula(item(), { podeEditar: true, decisoes: [decisao()] });
    const kg = await campoKg();
    expect(kg.value).toBe('1234,5');
    fireEvent.change(kg, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Apagar decisão/ }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/decisoes/42', { quantidadeKg: null }),
    );
    expect((await screen.findByRole('status')).textContent).toBe('Decisão apagada');
  });

  it('campo vazio sem decisao: nada a salvar (botao desabilitado)', async () => {
    renderCelula(item(), { podeEditar: true });
    await campoKg();
    expect((screen.getByRole('button', { name: /Salvar decisão/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('validacao local: valor invalido mostra alerta e nao chama a API', async () => {
    renderCelula(item(), { podeEditar: true });
    fireEvent.change(await campoKg(), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar decisão/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Informe a quantidade em kg/);
    expect(put).not.toHaveBeenCalled();
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
      <ForecastRelatorioCompras snapshotId={7} podeEditar={podeEditar} />
    </QueryClientProvider>,
  );
}

const chamadasDeDecisoes = () => get.mock.calls.filter(([url]) => String(url).endsWith('/decisoes'));

describe('ForecastRelatorioCompras com a coluna Qtd. decidida', () => {
  it('1 GET de decisoes por quinzena e a coluna aparece em todas as tabelas', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).endsWith('/decisoes')
        ? resposta([decisao({ productId: 43, quantidadeKg: 77 })])
        : { data: relatorio() },
    );
    renderRelatorio(true);
    await screen.findByLabelText('Qtd. decidida (kg) de PRODUTO 002');
    const tabelas = screen.getAllByRole('table');
    expect(tabelas).toHaveLength(2);
    for (const t of tabelas) {
      expect(within(t).getAllByRole('columnheader').map((c) => c.textContent)).toContain('Qtd. decidida (kg)');
    }
    expect(chamadasDeDecisoes()).toHaveLength(1);
    expect(chamadasDeDecisoes()[0]![0]).toBe('/v1/forecast/snapshots/7/decisoes');
    expect((screen.getByLabelText('Qtd. decidida (kg) de PRODUTO 002') as HTMLInputElement).value).toBe('77');
    expect((screen.getByLabelText('Qtd. decidida (kg) de PRODUTO 001') as HTMLInputElement).value).toBe('');
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
    expect(await screen.findByLabelText('Qtd. decidida (kg) de PRODUTO 001')).toBeTruthy();
  });
});
