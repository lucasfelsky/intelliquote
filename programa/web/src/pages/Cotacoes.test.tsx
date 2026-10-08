import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/components/useConfirm';
import Cotacoes from './Cotacoes';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: 'comprador' } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

const PO_SENT_AT = '2026-10-05T15:30:00.000Z';

function quote(id: number, requestCode: string, purchaseOrderSentAt: string | null) {
  return {
    id,
    requestCode,
    productName: `Produto ${requestCode}`,
    quantity: 1234,
    description: null,
    desiredIncoterm: ['FOB'],
    currency: 'USD',
    deadlineAt: null,
    status: 'open',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    closedAt: null,
    purchaseOrderSentAt,
    createdById: 1,
    _count: { items: 2, quoteResponses: 3 },
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConfirmProvider>
          <Cotacoes />
        </ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Cotacoes (lista)', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation((async () => [
      quote(1, 'QR-001', PO_SENT_AT),
      quote(2, 'QR-002', null),
    ]) as typeof api.get);
  });

  it('cabecalho nao tem Produto nem Qtd e tem PO', async () => {
    renderPage();
    await screen.findByText('QR-001');

    expect(screen.queryByRole('columnheader', { name: 'Produto' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Qtd' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'PO' })).toBeTruthy();
    expect(screen.queryByText('Produto QR-001')).toBeNull();
  });

  it('linha com purchaseOrderSentAt mostra a tag "PO enviada" com a data no title', async () => {
    renderPage();
    const row = (await screen.findByText('QR-001')).closest('tr') as HTMLElement;

    const expectedDate = new Date(PO_SENT_AT).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const badge = within(row).getByText('PO enviada');
    expect(badge.getAttribute('title')).toBe(`PO enviada em ${expectedDate}`);
    expect(badge.getAttribute('title')).toMatch(/PO enviada em \d{2}\/\d{2}\/\d{4}$/);
  });

  it('linha sem data mostra traco e nao mostra "PO enviada"', async () => {
    renderPage();
    const row = (await screen.findByText('QR-002')).closest('tr') as HTMLElement;

    expect(within(row).queryByText('PO enviada')).toBeNull();
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('o filtro de PO envia poSent=true / false e omite quando "todas"', async () => {
    renderPage();
    await screen.findByText('QR-001');

    const select = screen.getByLabelText('Filtro de PO enviada');
    const lastParams = () => {
      const calls = vi.mocked(api.get).mock.calls;
      return calls[calls.length - 1] as unknown[];
    };

    expect(lastParams()[0]).toBe('/v1/quote-requests');
    expect(lastParams()[1]).not.toHaveProperty('poSent');

    fireEvent.change(select, { target: { value: 'enviada' } });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/v1/quote-requests',
        expect.objectContaining({ poSent: 'true' }),
      ),
    );

    fireEvent.change(select, { target: { value: 'nao-enviada' } });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/v1/quote-requests',
        expect.objectContaining({ poSent: 'false' }),
      ),
    );

    fireEvent.change(select, { target: { value: 'todas' } });
    await waitFor(() => expect(lastParams()[1]).not.toHaveProperty('poSent'));
    expect(lastParams()[1]).toEqual({ page: '1', pageSize: '50' });
  });

  it('mudar o filtro de PO estando na pagina 2 volta para page 1', async () => {
    vi.mocked(api.get).mockImplementation((async (_url: string, params?: Record<string, string>) => {
      const page = Number(params?.page ?? 1);
      return {
        data: page === 1 ? [quote(1, 'QR-001', PO_SENT_AT)] : [quote(55, 'QR-055', null)],
        pagination: { page, pageSize: 50, totalItems: 60, totalPages: 2 },
      };
    }) as unknown as typeof api.get);
    renderPage();
    await screen.findByText('QR-001');

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    await screen.findByText('QR-055');
    expect(vi.mocked(api.get)).toHaveBeenLastCalledWith(
      '/v1/quote-requests',
      expect.objectContaining({ page: '2' }),
    );

    fireEvent.change(screen.getByLabelText('Filtro de PO enviada'), { target: { value: 'enviada' } });

    await waitFor(() =>
      expect(vi.mocked(api.get)).toHaveBeenLastCalledWith(
        '/v1/quote-requests',
        expect.objectContaining({ poSent: 'true', page: '1', pageSize: '50' }),
      ),
    );
  });
});
