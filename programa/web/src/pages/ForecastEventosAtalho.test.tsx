import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Forecast from './Forecast';
import ForecastFontesModal from './Forecast/ForecastFontesModal';

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

const PRAZO_REAL = {
  quinzena: { id: 7, label: '10-2', baseDate: '2026-10-20' },
  disponivel: false,
  motivo: 'quinzena_sem_historico',
  janelaDias: 365,
  minChegadas: 3,
  padraoEtdDias: 35,
  fontes: [{ sourceId: 1, nome: 'FONTE 001', leadTimeDays: 90, clearanceDays: 7, etdDiasUsado: 35, real: null }],
  semFonte: { chegadas: 0 },
};

function mockApi() {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: [] };
    if (path === '/v1/forecast/sources/prazo-real') return { data: PRAZO_REAL };
    if (path === '/v1/forecast/sources') return { data: [] };
    if (path === '/v1/forecast/lead-time-events') return { data: [] };
    throw new Error(`GET inesperado: ${path}`);
  });
}

function renderComQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const renderPage = () =>
  renderComQuery(
    <MemoryRouter initialEntries={['/forecast']}>
      <Forecast />
    </MemoryRouter>,
  );

const chamouEventos = () => get.mock.calls.some((c) => c[0] === '/v1/forecast/lead-time-events');
// O texto muda com o papel (importar ou pedir a quem importa); o prefixo e o mesmo.
const NADA_IMPORTADO = /^Nenhuma quinzena importada ainda\./;

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
});

describe('botao "Eventos estrangeiros" no cabecalho do Forecast', () => {
  it.each(['admin', 'comprador', 'gestor', 'viewer'])('%s ve o botao logo depois de "Fontes e lead time"', async (papel) => {
    mockRole = papel;
    renderPage();
    await screen.findByText(NADA_IMPORTADO);
    const fontes = screen.getByRole('button', { name: 'Fontes e lead time' });
    const eventos = screen.getByRole('button', { name: 'Eventos estrangeiros' });
    expect(fontes.nextElementSibling).toBe(eventos);
    expect(fontes.compareDocumentPosition(eventos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(eventos.getAttribute('aria-haspopup')).toBe('dialog');
    expect(eventos.className).toBe(fontes.className);
  });

  it.each([
    ['admin', true],
    ['comprador', true],
    ['gestor', false],
    ['viewer', false],
  ])('%s abre o dialogo direto na aba de eventos (edicao: %s)', async (papel, podeEditar) => {
    mockRole = papel;
    renderPage();
    await screen.findByText(NADA_IMPORTADO);
    expect(chamouEventos()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Eventos estrangeiros' }));
    expect(await screen.findByRole('heading', { name: 'Eventos estrangeiros' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Eventos estrangeiros' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Lead time por fonte' }).getAttribute('aria-selected')).toBe('false');
    expect(await screen.findByText(/Eventos estrangeiros são períodos/)).toBeTruthy();
    await waitFor(() => expect(chamouEventos()).toBe(true));
    if (podeEditar) {
      expect(await screen.findByRole('button', { name: 'Novo evento' })).toBeTruthy();
    } else {
      expect(await screen.findByText('Só administrador e comprador cadastram ou alteram eventos.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Novo evento' })).toBeNull();
    }
  });

  it('fechar devolve o foco ao botao "Eventos estrangeiros"', async () => {
    mockRole = 'viewer';
    renderPage();
    await screen.findByText(NADA_IMPORTADO);
    const eventos = screen.getByRole('button', { name: 'Eventos estrangeiros' });
    fireEvent.click(eventos);
    await screen.findByRole('heading', { name: 'Eventos estrangeiros' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Fechar' })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Eventos estrangeiros' })).toBeNull());
    expect(document.activeElement).toBe(eventos);
  });

  it('"Fontes e lead time" continua abrindo na aba de lead time e devolvendo o foco ao proprio botao', async () => {
    mockRole = 'viewer';
    renderPage();
    await screen.findByText(NADA_IMPORTADO);
    const fontes = screen.getByRole('button', { name: 'Fontes e lead time' });
    fireEvent.click(fontes);
    expect(await screen.findByRole('heading', { name: 'Fontes e lead time' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Lead time por fonte' }).getAttribute('aria-selected')).toBe('true');
    expect(chamouEventos()).toBe(false);
    fireEvent.click(screen.getAllByRole('button', { name: 'Fechar' })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Fontes e lead time' })).toBeNull());
    expect(document.activeElement).toBe(fontes);
  });
});

describe('ForecastFontesModal com abaInicial', () => {
  it('abaInicial="ocasioes": tablist e titulo "Eventos estrangeiros"', async () => {
    renderComQuery(<ForecastFontesModal podeEditar={false} abaInicial="ocasioes" onFechar={() => undefined} />);
    expect(await screen.findByRole('tablist', { name: 'Seções do diálogo Eventos estrangeiros' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Eventos estrangeiros' })).toBeTruthy();
  });

  it('sem abaInicial: tablist e titulo "Fontes e lead time"', async () => {
    renderComQuery(<ForecastFontesModal podeEditar={false} onFechar={() => undefined} />);
    expect(await screen.findByRole('tablist', { name: 'Seções do diálogo Fontes e lead time' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fontes e lead time' })).toBeTruthy();
  });
});
