import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Cotacoes from './Cotacoes';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Comprador', email: 'c@b.c', role: 'comprador' } }),
}));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

function quote(n: number, status: 'open' | 'closed' = 'open') {
  return {
    id: n,
    requestCode: `QR-${n}`,
    productName: `Produto ${n}`,
    quantity: 10,
    description: null,
    desiredIncoterm: ['FOB'],
    currency: 'USD',
    deadlineAt: null,
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    closedAt: null,
    createdById: 1,
    _count: { items: 1, quoteResponses: 0 },
  };
}

function range(from: number, to: number, status: 'open' | 'closed' = 'open') {
  const out = [];
  for (let n = from; n <= to; n += 1) out.push(quote(n, status));
  return out;
}

function paged(data: unknown[], page: number, totalItems: number, pageSize = 50) {
  return {
    data,
    pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) },
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Cotacoes />
    </QueryClientProvider>,
  );
}

function lastGetParams() {
  const calls = vi.mocked(api.get).mock.calls;
  return calls[calls.length - 1]?.[1] as Record<string, string>;
}

// 60 cotacoes sem filtro; 70 com status=open
function defaultImpl(_url: string, params?: Record<string, string>) {
  const page = Number(params?.page ?? 1);
  if (params?.status === 'open') {
    return Promise.resolve(
      paged(page === 1 ? range(1, 50) : range(51, 70), page, 70),
    );
  }
  return Promise.resolve(
    paged(page === 1 ? range(1, 50) : range(51, 60), page, 60),
  );
}

describe('Cotacoes - paginacao com filtros', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.del).mockReset();
    vi.mocked(api.get).mockImplementation(defaultImpl as never);
  });

  it('carga inicial pede page 1 / pageSize 50 e mostra o total', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('QR-1')).toBeTruthy());
    expect(api.get).toHaveBeenCalledWith(
      '/v1/quote-requests',
      expect.objectContaining({ page: '1', pageSize: '50' }),
    );
    expect(screen.getByText(/Página 1 de 2/)).toBeTruthy();
    expect(screen.getByText(/60 cotações no total/)).toBeTruthy();
  });

  it('Próxima página pede page 2 e mostra as linhas da segunda página', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('QR-1')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));

    await waitFor(() => expect(screen.getByText('QR-55')).toBeTruthy());
    expect(lastGetParams()).toEqual(expect.objectContaining({ page: '2' }));
    expect((screen.getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('filtro na página 2 volta para página 1 e continua paginando além de 20', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('QR-1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    await waitFor(() => expect(screen.getByText('QR-55')).toBeTruthy());

    fireEvent.change(screen.getByDisplayValue('Todas'), { target: { value: 'abertas' } });

    await waitFor(() => expect(screen.getByText(/70 cotações no total/)).toBeTruthy());
    expect(api.get).toHaveBeenCalledWith(
      '/v1/quote-requests',
      expect.objectContaining({ status: 'open', page: '1', pageSize: '50' }),
    );
    expect(screen.getByText(/Página 1 de 2/)).toBeTruthy();
    expect(screen.getByText('QR-50')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));

    await waitFor(() => expect(screen.getByText('QR-70')).toBeTruthy());
    expect(lastGetParams()).toEqual(expect.objectContaining({ status: 'open', page: '2' }));
    expect(screen.getByText('QR-51')).toBeTruthy();
    expect(screen.getByText(/Página 2 de 2/)).toBeTruthy();
  });

  it('busca envia search com page 1', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('QR-1')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('Buscar por código ou produto'), {
      target: { value: 'soda' },
    });

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/v1/quote-requests',
        expect.objectContaining({ search: 'soda', page: '1' }),
      ),
    );
  });

  it('resposta em array continua funcionando (uma página, botões desabilitados)', async () => {
    vi.mocked(api.get).mockImplementation((() => Promise.resolve(range(1, 3))) as never);
    renderPage();

    await waitFor(() => expect(screen.getByText('QR-3')).toBeTruthy());
    expect(screen.getByText('QR-1')).toBeTruthy();
    expect(screen.getByText('QR-2')).toBeTruthy();
    expect(screen.getByText(/Página 1 de 1 · 3 cotações no total/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('página fora do intervalo após apagar volta para a última página válida', async () => {
    let afterDelete = false;
    vi.mocked(api.get).mockImplementation(((_url: string, params?: Record<string, string>) => {
      if (params?.page === '2') {
        afterDelete = true;
        return Promise.resolve(paged([], 2, 50));
      }
      return Promise.resolve(paged(range(1, 50), 1, afterDelete ? 50 : 60));
    }) as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('QR-1')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));

    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(3);
      expect((calls[calls.length - 1]?.[1] as Record<string, string>).page).toBe('1');
    });
    await waitFor(() => expect(screen.getByText(/Página 1 de 1/)).toBeTruthy());
  });
});
