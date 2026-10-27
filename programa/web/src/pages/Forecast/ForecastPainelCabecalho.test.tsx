import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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

import { api } from '@/api/client';

const get = vi.mocked(api.get);

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
    AN: 200,
    AQ: 30,
    AP: '2026-11-20',
    AR: 0,
    AS: 0,
    item: 'PRODUTO A',
    codigos: ['C0001', 'C0002'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: null,
    productId: null,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: false,
    ...over,
  };
}

const LINHAS = [
  linha(),
  linha({ linha: 4, n: 2, item: 'PRODUTO B', codigos: ['C0003'], fonte: 'FONTE 2', status: 'cotando', AN: -40 }),
  linha({ linha: 5, n: 3, item: 'PRODUTO C', codigos: ['C0004'], fonte: 'FONTE 1', Q: 0, AN: null, AP: null }),
];

function detalhe(over: Record<string, unknown> = {}) {
  return {
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
    ...over,
  };
}

const RESUMOS = [
  { id: 7, label: '10-2', baseDate: '2026-10-15T00:00:00.000Z', half: 2, origin: 'planilha', months: MONTHS, files: [], createdById: 1, createdAt: '2026-10-20T12:00:00.000Z' },
];

function mockApi() {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: RESUMOS };
    if (path.endsWith('/decisoes')) return { data: { decisoes: [] } };
    if (path.endsWith('/pendentes')) return { data: { aplicavel: false } };
    const id = Number(path.split('/').pop());
    return { data: id === 7 ? detalhe() : undefined };
  });
}

function renderPage(url = '/forecast') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Forecast />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SUBTITULO = 'Quinzena 10-2 · base 15/10/2026 · 3 produtos · origem planilha';

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'comprador';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Forecast - subtitulo com a proxima analise', () => {
  it('mostra "· próxima análise dd/mm/aaaa" (PO.COMP.01) depois do subtitulo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T15:00:00Z'));
    mockApi();
    renderPage();
    const p = (await screen.findByText(SUBTITULO)).closest('p');
    expect(p?.textContent).toBe(`${SUBTITULO} · próxima análise 04/11/2026`);
  });

  it('usa o dia de Sao Paulo, nao o de UTC (02:30Z de 04/11 ainda e 03/11 em SP)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T02:30:00Z'));
    mockApi();
    renderPage();
    const p = (await screen.findByText(SUBTITULO)).closest('p');
    expect(p?.textContent).toBe(`${SUBTITULO} · próxima análise 04/11/2026`);
  });

  it('fora da tabela de feriados o trecho nao aparece', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-12-20T15:00:00Z'));
    mockApi();
    renderPage();
    const p = (await screen.findByText(SUBTITULO)).closest('p');
    expect(p?.textContent).toBe(SUBTITULO);
    expect(screen.queryByText(/próxima análise/)).toBeNull();
  });
});
