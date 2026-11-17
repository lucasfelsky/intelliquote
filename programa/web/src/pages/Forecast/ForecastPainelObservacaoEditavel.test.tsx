import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ForecastSnapshotDetail } from '@/services/forecast';
import Forecast from '../Forecast';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@exemplo.invalid', role: mockRole } }),
}));

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
const MONTHS = {
  consumo: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

function linha(over: Record<string, unknown> = {}) {
  return {
    linha: 3,
    O: 100,
    P: 50,
    Q: 100,
    R: 90,
    S: 80,
    T: 10,
    U: 500,
    chegadas: [0, 0, 0, 0, 0],
    AA: 5,
    programacoes: [0, 0, 0, 0],
    AG: 100,
    projecao: [400, 300, 200, 100, 50, 20],
    AN: -40,
    AQ: 30,
    AP: '2026-11-20',
    AR: 0,
    AS: 0,
    item: 'PRODUTO A',
    codigos: ['C0001'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: 50,
    productId: 42,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: 'AGUARDAR CONTRATO',
    precoFixo: false,
    ...over,
  };
}

// A: com observacao | B: sem cadastro (so leitura)
const LINHAS = [
  linha(),
  linha({ linha: 4, n: 2, item: 'PRODUTO B', codigos: ['C0002'], productId: null, obs: 'SEM CADASTRO' }),
];

const resumo = {
  id: 7,
  label: '10-2',
  baseDate: '2026-10-15T00:00:00.000Z',
  half: 2,
  origin: 'planilha',
  months: MONTHS,
  files: [],
  createdById: 1,
  createdAt: '2026-10-20T12:00:00.000Z',
};

const detalhe = {
  id: 7,
  label: '10-2',
  baseDate: '2026-10-15',
  half: 2,
  origin: 'planilha',
  hoje: '2026-10-20',
  months: MONTHS,
  files: [],
  createdAt: '2026-10-20T12:00:00.000Z',
  linhas: LINHAS,
  conferencia: { celulas: 84, batem: 84, porColuna: {}, totalDivergencias: 0, divergencias: [] },
};

function mockApi() {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: [resumo] };
    if (path === '/v1/forecast/products') return { data: [] };
    if (path.endsWith('/decisoes')) return { data: { decisoes: [] } };
    if (path.endsWith('/pendentes')) return { data: { aplicavel: false } };
    return { data: detalhe };
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/forecast']}>
        <Forecast />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

const rotulo = (item: string) => `Observação de ${item}`;
const botao = (item: string) => screen.findByRole('button', { name: rotulo(item) });

async function abrir(item: string): Promise<HTMLInputElement> {
  fireEvent.click(await botao(item));
  return (await screen.findByRole('textbox', { name: rotulo(item) })) as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'comprador';
  mockApi();
});

describe('Painel - OBS. editavel', () => {
  it.each(['admin', 'comprador'])('%s edita: o campo abre com a observacao atual', async (papel) => {
    mockRole = papel;
    renderPage();
    const campo = await abrir('PRODUTO A');
    expect(campo.value).toBe('AGUARDAR CONTRATO');
    expect(document.activeElement).toBe(campo);
  });

  it.each(['gestor', 'viewer'])('%s so le: texto visivel, sem botao de edicao', async (papel) => {
    mockRole = papel;
    renderPage();
    expect(await screen.findByText('AGUARDAR CONTRATO')).toBeTruthy();
    expect(screen.queryByRole('button', { name: rotulo('PRODUTO A') })).toBeNull();
  });

  it('item sem cadastro segue so leitura', async () => {
    renderPage();
    await botao('PRODUTO A');
    expect(screen.getByText('SEM CADASTRO')).toBeTruthy();
    expect(screen.queryByRole('button', { name: rotulo('PRODUTO B') })).toBeNull();
  });

  it('Enter grava, atualiza o cache da quinzena sem novo GET e avisa', async () => {
    put.mockResolvedValue({ data: { productId: 42, observacao: 'NOVA OBS', cadastroAtualizado: true } });
    const client = renderPage();
    const campo = await abrir('PRODUTO A');
    const antes = get.mock.calls.length;
    fireEvent.change(campo, { target: { value: '  NOVA OBS ' } });
    fireEvent.keyDown(campo, { key: 'Enter' });

    expect((await screen.findAllByText('NOVA OBS')).length).toBeGreaterThan(0);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/observacoes/42', { observacao: 'NOVA OBS' });
    expect(
      client.getQueryData<ForecastSnapshotDetail>(['forecast', 'snapshot', 7])?.linhas.find((l) => l.productId === 42)?.obs,
    ).toBe('NOVA OBS');
    expect(await screen.findByText(/Observação de PRODUTO A salva\. Ela virá nas próximas quinzenas importadas\./)).toBeTruthy();
    expect(get.mock.calls.length).toBe(antes);
  });

  it('campo vazio apaga a observacao', async () => {
    put.mockResolvedValue({ data: { productId: 42, observacao: '', cadastroAtualizado: false } });
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(await screen.findByText('Observação de PRODUTO A removida.')).toBeTruthy();
    expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/observacoes/42', { observacao: '' });
  });

  it('Esc cancela e sem mudanca nao envia nada', async () => {
    renderPage();
    let campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: 'OUTRA' } });
    fireEvent.keyDown(campo, { key: 'Escape' });
    await botao('PRODUTO A');
    campo = await abrir('PRODUTO A');
    fireEvent.blur(campo);
    await botao('PRODUTO A');
    expect(put).not.toHaveBeenCalled();
  });

  it('acima de 1000 caracteres: erro no lugar, sem enviar', async () => {
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: 'a'.repeat(1001) } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(await screen.findByText(/aceita no máximo 1000 caracteres/)).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });

  it('erro do servidor aparece e o campo continua aberto com o texto', async () => {
    put.mockRejectedValue(new ApiError(404, {}, 'Quinzena nao encontrada.'));
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: 'NOVA' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByText(/Item ou quinzena não encontrados/).length).toBeGreaterThan(0));
    expect((screen.getByRole('textbox', { name: rotulo('PRODUTO A') }) as HTMLInputElement).value).toBe('NOVA');
  });
});
