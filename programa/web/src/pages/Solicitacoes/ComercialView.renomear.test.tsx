import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Solicitacoes from '../Solicitacoes';

let mockRole = 'comercial';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: mockRole } }),
}));

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

const MINE_ROW_SEM_CLIENTE = {
  id: 7,
  status: 'pending',
  customerName: null,
  notes: null,
  rejectionReason: null,
  fulfillmentNote: null,
  createdAt: '2026-10-19T12:00:00.000Z',
  statusChangedAt: null,
  quote: null,
  items: [
    {
      id: 1,
      catalogItemId: 10,
      commercialName: 'Resina X',
      quantity: 5,
      unit: 'KG',
      targetPrice: null,
      targetCurrency: null,
      finalPrice: null,
    },
  ],
};

const COMEX_ROW_SEM_CLIENTE = {
  id: 9,
  status: 'pending',
  customerName: null,
  notes: null,
  rejectionReason: null,
  fulfillmentNote: null,
  createdAt: '2026-10-18T12:00:00.000Z',
  statusChangedAt: null,
  requestedBy: { id: 3, name: 'Ana Comercial', email: 'ana@x.com' },
  statusChangedBy: null,
  quoteRequest: null,
  items: [
    {
      id: 1,
      catalogItemId: 10,
      commercialName: 'Resina X',
      marketName: 'RX-100',
      dbcorpCode: null,
      quantity: 5,
      unit: 'KG',
      targetPrice: null,
      targetCurrency: null,
      quoteRequestItemId: null,
    },
  ],
};

function page<T>(data: T[]) {
  return { data, pagination: { page: 1, pageSize: 20, totalItems: data.length, totalPages: 1 } };
}

function mockApi(mineRows: unknown[] = [MINE_ROW_SEM_CLIENTE]) {
  vi.mocked(api.get).mockImplementation((async (path: string) => {
    if (path === '/api/v1/commercial-requests/mine') return page(mineRows);
    if (path === '/api/v1/commercial-requests/catalog-items') {
      return [{ id: 10, commercialName: 'Resina X', familyName: 'Resinas' }];
    }
    if (path === '/api/v1/commercial-requests/requesters') return [{ id: 3, name: 'Ana Comercial' }];
    if (path === '/api/v1/commercial-requests') return page([COMEX_ROW_SEM_CLIENTE]);
    return [];
  }) as typeof api.get);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/solicitacoes']}>
        <Routes>
          <Route path="*" element={<Solicitacoes />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  mockApi();
});

describe('Solicitacoes - comercial: "Solicitar uma cotacao" e cliente opcional', () => {
  beforeEach(() => {
    mockRole = 'comercial';
  });

  it('o botao e o titulo do modal dizem "Solicitar uma cotação"', async () => {
    renderPage();
    await screen.findByText('Pendente');
    expect(screen.queryByRole('button', { name: 'Nova solicitação' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Solicitar uma cotação' })).toBeTruthy();
  });

  it('o estado vazio usa o novo nome da acao', async () => {
    mockApi([]);
    renderPage();
    expect(await screen.findByText(/Use “Solicitar uma cotação” para pedir/)).toBeTruthy();
  });

  it('o rotulo do cliente diz "(opcional)" e o campo nao e obrigatorio', async () => {
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));

    const customer = screen.getByLabelText('Cliente (opcional)') as HTMLInputElement;
    expect(customer.required).toBe(false);
  });

  it('envio com cliente vazio manda customerName: null', async () => {
    vi.mocked(api.post).mockResolvedValue({ ...MINE_ROW_SEM_CLIENTE, id: 8 });
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    fireEvent.click(await screen.findByRole('button', { name: '+ Resina X · Resinas' }));

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [path, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/v1/commercial-requests');
    expect(body.customerName).toBeNull();
  });

  it('a lista mostra "Cliente não informado" quando o cliente e nulo', async () => {
    renderPage();
    await screen.findByText('Pendente');
    expect(screen.getByText('Cliente não informado')).toBeTruthy();
  });
});

describe('Solicitacoes - COMEX', () => {
  beforeEach(() => {
    mockRole = 'comprador';
  });

  it('nao mostra "Solicitar uma cotação" e usa o fallback de cliente', async () => {
    renderPage();
    await screen.findByText('Ana Comercial', { selector: 'td' });
    expect(screen.queryByRole('button', { name: 'Solicitar uma cotação' })).toBeNull();
    expect(screen.getByText('Cliente não informado')).toBeTruthy();
  });
});
